import { randomUUID } from "crypto";
import { readJsonState, writeJsonState } from "./store";
import { FocusSchedule, SchedulerState } from "../types/scheduler.types";
import { getLogger } from "../utils/logger";

type ExpireCallback = () => Promise<void>;
type RecurringTriggerCallback = (action: "start" | "end") => Promise<void>;

/**
 * Quản lý focus schedule (duration-based + recurring), lưu JSON, dùng
 * setInterval "tick" mỗi phút để kiểm tra thay vì 1 setTimeout riêng cho
 * mỗi schedule - đơn giản hoá việc restore state sau khi restart process
 * (không cần re-tính lại timer chính xác từng ms).
 */
export class FocusScheduler {
  private tickHandle: NodeJS.Timeout | null = null;
  private readonly firedRecurringToday = new Set<string>(); // key: `${scheduleId}:${dateStr}:${start|end}`

  constructor(
    private readonly filePath: string,
    private readonly onDurationExpire: ExpireCallback,
    private readonly onRecurringTrigger: RecurringTriggerCallback
  ) {}

  start(tickIntervalMs = 60_000): void {
    this.tickHandle = setInterval(() => {
      void this.tick();
    }, tickIntervalMs);
    // chạy ngay 1 lần khi start để bắt kịp state nếu process vừa restart
    void this.tick();
  }

  stop(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
  }

  scheduleDuration(ms: number): FocusSchedule {
    const state = this.readState();
    const schedule: FocusSchedule = {
      id: randomUUID(),
      type: "duration",
      createdAt: new Date().toISOString(),
      endAt: new Date(Date.now() + ms).toISOString(),
      enabled: true,
    };
    state.schedules.push(schedule);
    this.writeState(state);
    return schedule;
  }

  extendDuration(scheduleId: string, extraMs: number): FocusSchedule | null {
    const state = this.readState();
    const schedule = state.schedules.find((s) => s.id === scheduleId && s.type === "duration");
    if (!schedule || !schedule.endAt) return null;
    schedule.endAt = new Date(new Date(schedule.endAt).getTime() + extraMs).toISOString();
    this.writeState(state);
    return schedule;
  }

  cancel(scheduleId: string): void {
    const state = this.readState();
    state.schedules = state.schedules.filter((s) => s.id !== scheduleId);
    this.writeState(state);
  }

  listSchedules(): FocusSchedule[] {
    return this.readState().schedules;
  }

  enableRecurring(scheduleId: string): void {
    this.setRecurringEnabled(scheduleId, true);
  }

  disableRecurring(scheduleId: string): void {
    this.setRecurringEnabled(scheduleId, false);
  }

  remainingMs(scheduleId: string): number | null {
    const schedule = this.readState().schedules.find((s) => s.id === scheduleId);
    if (!schedule?.endAt) return null;
    return Math.max(0, new Date(schedule.endAt).getTime() - Date.now());
  }

  /** Tìm duration-schedule đang active gần nhất (dùng khi chỉ có 1 focus session tại 1 thời điểm) */
  activeDurationSchedule(): FocusSchedule | null {
    const now = Date.now();
    return (
      this.readState().schedules.find(
        (s) => s.type === "duration" && s.endAt && new Date(s.endAt).getTime() > now
      ) ?? null
    );
  }

  private setRecurringEnabled(scheduleId: string, enabled: boolean): void {
    const state = this.readState();
    const schedule = state.schedules.find((s) => s.id === scheduleId && s.type === "recurring");
    if (schedule) {
      schedule.enabled = enabled;
      this.writeState(state);
    }
  }

  private async tick(): Promise<void> {
    const state = this.readState();
    const now = new Date();

    // 1. Xử lý duration-based hết hạn
    const stillValid: FocusSchedule[] = [];
    for (const schedule of state.schedules) {
      if (schedule.type === "duration" && schedule.endAt) {
        if (new Date(schedule.endAt).getTime() <= now.getTime()) {
          getLogger().info("[focusScheduler] Duration schedule hết hạn", { id: schedule.id });
          try {
            await this.onDurationExpire();
          } catch (err) {
            getLogger().error("[focusScheduler] onDurationExpire lỗi", {
              error: (err as Error).message,
            });
          }
          continue; // không giữ lại schedule đã hết hạn
        }
      }
      stillValid.push(schedule);
    }
    if (stillValid.length !== state.schedules.length) {
      this.writeState({ schedules: stillValid });
    }

    // 2. Xử lý recurring
    const dateStr = now.toISOString().slice(0, 10);
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const dow = now.getDay();

    for (const schedule of stillValid) {
      if (schedule.type !== "recurring" || !schedule.enabled || !schedule.recurring) continue;
      if (!schedule.recurring.daysOfWeek.includes(dow)) continue;

      const startKey = `${schedule.id}:${dateStr}:start`;
      const endKey = `${schedule.id}:${dateStr}:end`;

      if (schedule.recurring.startTime === hhmm && !this.firedRecurringToday.has(startKey)) {
        this.firedRecurringToday.add(startKey);
        await this.onRecurringTrigger("start");
      }
      if (schedule.recurring.endTime === hhmm && !this.firedRecurringToday.has(endKey)) {
        this.firedRecurringToday.add(endKey);
        await this.onRecurringTrigger("end");
      }
    }
  }

  private readState(): SchedulerState {
    return readJsonState<SchedulerState>(this.filePath, { schedules: [] });
  }

  private writeState(state: SchedulerState): void {
    writeJsonState(this.filePath, state);
  }
}
