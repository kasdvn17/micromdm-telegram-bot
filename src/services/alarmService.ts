import { readJsonState, writeJsonState } from "../utils/jsonStore";
import { getLogger } from "../utils/logger";
import { DiscordCallServiceApi } from "./discordCallService";

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

export interface AlarmServiceApi {
  start(): void;
  stop(): string;
  status(): string;
  testCall(): Promise<string>;
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
  discordCallService: DiscordCallServiceApi,
  timeZone: string
): AlarmServiceApi {
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

  function clearCallLoop(): void {
    if (callHandle) {
      clearTimeout(callHandle);
      callHandle = null;
    }
  }

  async function callOnce(stage: number): Promise<void> {
    if (callInFlight) return;
    callInFlight = true;

    try {
      const result = await discordCallService.call();
      if (!result.ok) {
        getLogger().error("[alarm] Discord call failed", {
          stage,
          detail: result.detail,
        });
      }
    } catch (err) {
      getLogger().error("[alarm] Discord call failed", {
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      callInFlight = false;
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

    if (state.stopped || stage !== activeStage) return;

    await callOnce(stage);

    const after = readState();
    if (after.stopped || stage !== activeStage) return;

    const stageInfo = STAGES.find((s) => s.stage === stage);
    if (stageInfo?.repeatUntilStopped) {
      scheduleNextCall(stage);
    } else {
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
    });
  }

  function tick(): void {
    const state = readState();
    const current = hhmm();

    if (state.stopped) {
      activeStage = 0;
      clearCallLoop();
      return;
    }

    let dueStage: AlarmStage | undefined;
    for (const stage of STAGES) {
      if (current >= stage.time && state.firedStage < stage.stage) {
        dueStage = stage;
      }
    }

    if (dueStage && activeStage !== dueStage.stage) {
      clearCallLoop();
      startStage(dueStage, state);
    }
  }

  return {
    start(): void {
      if (tickHandle) return;
      tickHandle = setInterval(tick, 1_000);
      tick();
      void discordCallService.start().catch((error) => {
        getLogger().error("[alarm] Discord selfbot login failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      getLogger().info("[alarm] Alarm scheduler started", {
        timeZone,
        stages: STAGES.map((s) => `${s.stage}@${s.time}`).join(", "),
      });
    },

    stop(): string {
      const state = readState();
      state.stopped = true;
      saveState(state);
      activeStage = 0;
      clearCallLoop();
      discordCallService.stopActiveCall();

      getLogger().info("[alarm] Alarm stopped for today", {
        date: state.date,
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

    async testCall(): Promise<string> {
      if (callInFlight) {
        return `ERROR: Đang có một cuộc gọi khác đang được gửi.`;
      }

      callInFlight = true;
      try {
        const result = await discordCallService.call();
        return result.ok ? `OK: ${result.detail}` : `ERROR: ${result.detail}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        getLogger().error("[alarm] Test Discord call failed", { error: message });
        return `ERROR: ${message}`;
      } finally {
        callInFlight = false;
      }
    },
  };
}
