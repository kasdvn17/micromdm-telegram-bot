import { readJsonState, writeJsonState } from "../utils/jsonStore";
import { getLogger } from "../utils/logger";

interface AlarmState {
  date: string;
  stopped: boolean;
  firedStage: number;
}

interface AlarmStage {
  stage: number;
  time: string;
  repeatUntilStopped: boolean;
}

const STAGES: AlarmStage[] = [
  { stage: 1, time: "05:00", repeatUntilStopped: true },
  { stage: 2, time: "05:10", repeatUntilStopped: true },
  { stage: 3, time: "05:30", repeatUntilStopped: false },
];

const CALL_INTERVAL_MS = 35_000;
const CALL_TIMEOUT_MS = 12_000;

export interface AlarmServiceApi {
  start(): void;
  stop(): string;
  status(): string;
}

function partsInTimeZone(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

export function createAlarmService(
  filePath: string,
  targetUsername: string,
  timeZone: string,
  apiToken?: string
): AlarmServiceApi {
  // The Telegram voice-call endpoint currently authenticates the recipient
  // through CallMeBot's user authorization flow rather than an API key.
  // Keep apiToken in config/.env for deployments that want to store it, but
  // do not put it into the Telegram-call URL unless CallMeBot documents it.
  void apiToken;

  let tickHandle: NodeJS.Timeout | null = null;
  let callHandle: NodeJS.Timeout | null = null;
  let activeStage = 0;
  let callInFlight = false;

  function nowParts(): Record<string, string> {
    return partsInTimeZone(new Date(), timeZone);
  }

  function today(): string {
    const p = nowParts();
    return `${p.year}-${p.month}-${p.day}`;
  }

  function hhmm(): string {
    const p = nowParts();
    return `${p.hour}:${p.minute}`;
  }

  function readState(): AlarmState {
    const date = today();
    const state = readJsonState<AlarmState>(filePath, {
      date,
      stopped: false,
      firedStage: 0,
    });

    if (state.date !== date) {
      return { date, stopped: false, firedStage: 0 };
    }
    return state;
  }

  function saveState(state: AlarmState): void {
    writeJsonState(filePath, state);
  }

  async function callOnce(stage: number): Promise<void> {
    if (callInFlight) return;
    callInFlight = true;

    const text =
      stage === 1
        ? "Bao Lam, day la bao thuc. Hay thuc day ngay bay gio."
        : stage === 2
          ? "Bao Lam, day la lan bao thuc thu hai. Hay thuc day ngay bay gio."
          : "Bao Lam, day la lan bao thuc cuoi cung. Hay thuc day ngay bay gio.";

    try {
      const url = new URL("https://api.callmebot.com/start.php");
      url.searchParams.set("user", targetUsername);
      url.searchParams.set("text", text);
      url.searchParams.set("lang", "vi-VN-Standard-A");
      url.searchParams.set("rpt", "3");
      url.searchParams.set("cc", "yes");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
        });
        const body = await response.text();

        if (!response.ok) {
          throw new Error(`CallMeBot HTTP ${response.status}: ${body.slice(0, 300)}`);
        }

        getLogger().info("[alarm] CallMeBot call requested", {
          stage,
          targetUsername,
          response: body.slice(0, 300),
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      getLogger().error("[alarm] CallMeBot call failed", {
        stage,
        error: (err as Error).message,
      });
    } finally {
      callInFlight = false;
    }
  }

  function clearCallLoop(): void {
    if (callHandle) {
      clearTimeout(callHandle);
      callHandle = null;
    }
  }

  function scheduleNextCall(stage: number): void {
    clearCallLoop();
    callHandle = setTimeout(() => {
      void runCall(stage);
    }, CALL_INTERVAL_MS);
  }

  async function runCall(stage: number): Promise<void> {
    const state = readState();

    // /alarm_stop stops the whole alarm sequence for today.
    if (state.stopped || stage !== activeStage) return;

    await callOnce(stage);

    const after = readState();
    if (after.stopped || stage !== activeStage) return;

    const stageInfo = STAGES.find((s) => s.stage === stage);
    if (stageInfo?.repeatUntilStopped) {
      scheduleNextCall(stage);
    } else {
      // Stage 3 is explicitly the final call.
      after.firedStage = Math.max(after.firedStage, stage);
      saveState(after);
      activeStage = 0;
    }
  }

  function startStage(stage: AlarmStage, state: AlarmState): void {
    if (state.stopped || state.firedStage >= stage.stage) return;

    activeStage = stage.stage;
    state.firedStage = stage.stage;
    saveState(state);

    clearCallLoop();
    void runCall(stage.stage);

    getLogger().info("[alarm] Alarm stage started", {
      stage: stage.stage,
      time: stage.time,
      targetUsername,
    });
  }

  function tick(): void {
    const state = readState();
    const current = hhmm();

    // If today's alarm was stopped, nothing else is scheduled.
    if (state.stopped) {
      activeStage = 0;
      clearCallLoop();
      return;
    }

    // Escalate at exact minute boundaries. If the process starts late,
    // start the latest stage that should currently be active.
    let dueStage: AlarmStage | undefined;
    for (const stage of STAGES) {
      if (current >= stage.time && state.firedStage < stage.stage) {
        dueStage = stage;
      }
    }

    if (dueStage) {
      // Stage 3 is a one-shot final call; stages 1 and 2 repeat.
      if (activeStage !== dueStage.stage) {
        clearCallLoop();
        startStage(dueStage, state);
      }
    }
  }

  return {
    start(): void {
      if (tickHandle) return;
      tickHandle = setInterval(tick, 1_000);
      tick();
      getLogger().info("[alarm] Alarm scheduler started", {
        timeZone,
        targetUsername,
        stages: STAGES.map((s) => `${s.stage}@${s.time}`).join(", "),
      });
    },

    stop(): string {
      const state = readState();
      state.stopped = true;
      saveState(state);
      activeStage = 0;
      clearCallLoop();

      getLogger().info("[alarm] Alarm stopped for today", {
        date: state.date,
        targetUsername,
      });

      return `⏰ Đã tắt toàn bộ báo thức hôm nay (${state.date}). Sẽ không gọi tiếp các lần sau.`;
    },

    status(): string {
      const state = readState();
      const stage = activeStage || state.firedStage;
      if (state.stopped) {
        return `⏰ Báo thức hôm nay đã tắt.`;
      }
      if (stage === 0) {
        return `⏰ Báo thức đang chờ: 05:00 → 05:10 → 05:30 (${timeZone}).`;
      }
      return `⏰ Báo thức đang ở lần ${stage}.`;
    },
  };
}
