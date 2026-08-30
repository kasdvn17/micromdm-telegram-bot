import { randomUUID } from "crypto";
import { readJsonState, writeJsonState } from "./store";
import { FocusSchedule, SchedulerState, SleepUnlockStatus } from "../types/scheduler.types";
import { getLogger } from "../utils/logger";

type ExpireCallback = () => Promise<void>;
type RecurringTriggerCallback = (action: "start" | "end") => Promise<void>;
type BreakExpireCallback = () => Promise<void>;
type SleepTriggerCallback = (action: "start" | "end") => Promise<void>;

function todayDateStr(now: Date): string {
  // QUAN TRỌNG: phải dùng local date (khớp với hhmmOf() dùng getHours/getMinutes local),
  // KHÔNG dùng now.toISOString() (UTC) - nếu không, với server ở múi giờ UTC+N,
  // trong khoảng giờ đầu ngày local (00:00 tới N giờ sáng) ngày UTC vẫn là ngày
  // hôm trước, làm lệch so sánh skippedDate/dedup key với hhmm (đã là local).
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hhmmOf(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function sleepSessionDateStr(now: Date): string {
  if (hhmmOf(now) >= FocusScheduler.SLEEP_START) return todayDateStr(now);
  const previousDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return todayDateStr(previousDay);
}

function sleepSessionStart(now: Date): Date {
  const sessionDate = sleepSessionDateStr(now);
  const [year, month, day] = sessionDate.split("-").map(Number);
  const [hour, minute] = FocusScheduler.SLEEP_START.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

/**
 * Quản lý focus schedule (duration-based + recurring), lưu JSON, dùng
 * setInterval "tick" mỗi phút để kiểm tra thay vì 1 setTimeout riêng cho
 * mỗi schedule - đơn giản hoá việc restore state sau khi restart process
 * (không cần re-tính lại timer chính xác từng ms).
 *
 * Hỗ trợ /focus break <time> (tạm ngưng Focus trong lúc đang ở khung giờ
 * recurring, tự bật lại khi hết giờ break) và /focus schedule skip (bỏ qua
 * occurrence của schedule trong NGÀY HÔM NAY, tự hết hiệu lực sang ngày mới).
 */
export class FocusScheduler {
  /** Số lần /focus break tối đa trong 1 ngày. */
  static readonly MAX_BREAKS_PER_DAY = 4;
  /** Tổng thời gian TẤT CẢ các lần /focus break cộng dồn tối đa trong 1 ngày. */
  static readonly MAX_BREAK_TOTAL_MS_PER_DAY = 60 * 60 * 1000; // 1 giờ

  /**
   * Sleep Mode: khung giờ CỐ ĐỊNH, hardcode (KHÔNG cấu hình qua lệnh/JSON
   * như recurring schedule thường), qua đêm (22:00 -> 05:00 sáng hôm sau).
   * Mặc định không thể tắt. Ngoại lệ duy nhất: user AC lần đầu ít nhất 3 task
   * sau khi phiên bắt đầu và chạy /refresh; khi đó /focus off có thể tắt phần
   * còn lại của đúng phiên Sleep Mode hiện tại.
   */
  static readonly SLEEP_START = "22:00";
  static readonly SLEEP_END = "05:00";
  static readonly SLEEP_UNLOCK_REQUIRED_AC = 3;

  private tickHandle: NodeJS.Timeout | null = null;
  private readonly firedRecurringToday = new Set<string>(); // key: `${scheduleId}:${dateStr}:${start|end}`
  private readonly firedSleepToday = new Set<string>(); // key: `${dateStr}:${start|end}`

  constructor(
    private readonly filePath: string,
    private readonly onDurationExpire: ExpireCallback,
    private readonly onRecurringTrigger: RecurringTriggerCallback,
    private readonly onBreakExpire: BreakExpireCallback,
    private readonly onSleepTrigger: SleepTriggerCallback
  ) {}

  start(tickIntervalMs = 60_000): void {
    this.tickHandle = setInterval(() => {
      void this.tick();
    }, tickIntervalMs);
    // chạy ngay 1 lần khi start để bắt kịp state nếu process vừa restart
    void this.reconcileOnStart();
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

  /** Tạo recurring schedule mới, vd bật Focus 06:00 - 23:00 mỗi ngày. */
  addRecurring(daysOfWeek: number[], startTime: string, endTime: string): FocusSchedule {
    const state = this.readState();
    const schedule: FocusSchedule = {
      id: randomUUID(),
      type: "recurring",
      createdAt: new Date().toISOString(),
      recurring: { daysOfWeek, startTime, endTime },
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

  /**
   * Huỷ TOÀN BỘ duration-schedule đang có (không chỉ 1 cái được tìm thấy bởi
   * activeDurationSchedule()). Bắt buộc phải gọi trước khi tạo 1 duration mới
   * (hoặc chuyển sang chế độ manual) để đảm bảo tại 1 thời điểm chỉ tồn tại
   * duy nhất 1 "nguồn sự thật" cho trạng thái Focus theo thời gian - tránh
   * trường hợp còn sót lại schedule cũ vẫn tự hết hạn ngầm và tắt Focus
   * ngoài ý muốn dù người dùng đã set lại/chuyển sang bật vô thời hạn.
   */
  cancelAllDurations(): void {
    const state = this.readState();
    const remaining = state.schedules.filter((s) => s.type !== "duration");
    if (remaining.length !== state.schedules.length) {
      this.writeState({ ...state, schedules: remaining });
    }
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

  /**
   * Recurring schedule đang thật sự "active" NGAY LÚC NÀY: enabled, đúng
   * ngày trong tuần, đang trong khung giờ start-end, và KHÔNG bị skip hôm
   * nay. Không quan tâm break - dùng activeRecurringSchedule() nếu cần biết
   * cả trạng thái break.
   */
  scheduleWindowToday(now: Date = new Date()): FocusSchedule | null {
    const dateStr = todayDateStr(now);
    const hhmm = hhmmOf(now);
    const dow = now.getDay();

    return (
      this.readState().schedules.find((s) => {
        if (s.type !== "recurring" || !s.enabled || !s.recurring) return false;
        if (!s.recurring.daysOfWeek.includes(dow)) return false;
        if (s.recurring.skippedDate === dateStr) return false;
        const { startTime, endTime } = s.recurring;
        if (startTime >= endTime) return false; // chưa hỗ trợ khung giờ qua đêm
        return startTime <= hhmm && hhmm < endTime;
      }) ?? null
    );
  }

  /** true nếu hiện tại đang trong 1 khung giờ recurring active (chưa tính break). */
  isWithinScheduleWindowToday(now: Date = new Date()): boolean {
    return this.scheduleWindowToday(now) !== null;
  }

  /**
   * true nếu hiện tại đang trong khung giờ Sleep Mode CỐ ĐỊNH (22:00 -> 05:00
   * sáng hôm sau, qua đêm). Khác isWithinScheduleWindowToday() - không đọc
   * từ `schedules` trong state và hardcode SLEEP_START/SLEEP_END.
   */
  isWithinSleepTimeRange(now: Date = new Date()): boolean {
    const hhmm = hhmmOf(now);
    // Qua đêm: active nếu >= 22:00 (tối nay) HOẶC < 05:00 (sáng nay, phần đuôi
    // của khung bắt đầu từ tối hôm trước).
    return hhmm >= FocusScheduler.SLEEP_START || hhmm < FocusScheduler.SLEEP_END;
  }

  /** Sleep Mode đang có hiệu lực, đã tính trường hợp được mở khóa và tắt cho phiên này. */
  isWithinSleepWindow(now: Date = new Date()): boolean {
    return this.isWithinSleepTimeRange(now) && !this.getSleepUnlockStatus(now).disabled;
  }

  getSleepUnlockStatus(now: Date = new Date()): SleepUnlockStatus {
    if (!this.isWithinSleepTimeRange(now)) {
      return {
        withinTimeRange: false,
        acceptedTaskCount: 0,
        requiredTaskCount: FocusScheduler.SLEEP_UNLOCK_REQUIRED_AC,
        eligible: false,
        disabled: false,
      };
    }
    const sessionDate = sleepSessionDateStr(now);
    const state = this.readState();
    const current = state.sleepUnlock?.sessionDate === sessionDate ? state.sleepUnlock : undefined;
    const acceptedTaskCount = current?.acceptedTaskCount ?? 0;
    return {
      withinTimeRange: true,
      sessionDate,
      sessionStartedAt: sleepSessionStart(now).toISOString(),
      acceptedTaskCount,
      requiredTaskCount: FocusScheduler.SLEEP_UNLOCK_REQUIRED_AC,
      eligible: acceptedTaskCount >= FocusScheduler.SLEEP_UNLOCK_REQUIRED_AC,
      disabled: !!current?.disabledAt,
    };
  }

  /** Ghi nhận các task vừa được /refresh xác nhận, chỉ tính lần AC đầu tiên sau 22:00. */
  recordSleepAcceptedTasks(acceptedAtValues: readonly string[], now: Date = new Date()): SleepUnlockStatus {
    if (!this.isWithinSleepTimeRange(now) || acceptedAtValues.length === 0) {
      return this.getSleepUnlockStatus(now);
    }
    const state = this.ensureSleepSession(now);
    const sessionStartMs = sleepSessionStart(now).getTime();
    const nowMs = now.getTime();
    const qualifyingCount = acceptedAtValues.filter((value) => {
      const acceptedMs = new Date(value).getTime();
      return Number.isFinite(acceptedMs) && acceptedMs >= sessionStartMs && acceptedMs <= nowMs;
    }).length;
    if (qualifyingCount > 0 && !state.sleepUnlock?.disabledAt) {
      state.sleepUnlock!.acceptedTaskCount = Math.min(
        FocusScheduler.SLEEP_UNLOCK_REQUIRED_AC,
        state.sleepUnlock!.acceptedTaskCount + qualifyingCount
      );
      if (
        state.sleepUnlock!.acceptedTaskCount >= FocusScheduler.SLEEP_UNLOCK_REQUIRED_AC &&
        !state.sleepUnlock!.qualifiedAt
      ) {
        state.sleepUnlock!.qualifiedAt = now.toISOString();
      }
      this.writeState(state);
    }
    return this.getSleepUnlockStatus(now);
  }

  disableSleepForCurrentSession(now: Date = new Date()): boolean {
    if (!this.isWithinSleepTimeRange(now)) return false;
    const state = this.ensureSleepSession(now);
    if (
      !state.sleepUnlock ||
      state.sleepUnlock.acceptedTaskCount < FocusScheduler.SLEEP_UNLOCK_REQUIRED_AC
    ) {
      return false;
    }
    if (!state.sleepUnlock.disabledAt) {
      state.sleepUnlock.disabledAt = now.toISOString();
      this.writeState(state);
    }
    return true;
  }

  isOnBreak(now: Date = new Date()): boolean {
    const state = this.readState();
    return !!state.breakUntil && new Date(state.breakUntil).getTime() > now.getTime();
  }

  breakRemainingMs(now: Date = new Date()): number | null {
    const state = this.readState();
    if (!state.breakUntil) return null;
    return Math.max(0, new Date(state.breakUntil).getTime() - now.getTime());
  }

  /**
   * Số lần + tổng thời gian đã dùng /focus break HÔM NAY. Tự trả về {0, 0}
   * nếu chưa dùng lần nào hôm nay hoặc dữ liệu lưu là của ngày khác (đã
   * sang ngày mới - giới hạn tự reset theo ngày).
   */
  getBreakUsageToday(now: Date = new Date()): { count: number; totalMs: number } {
    const state = this.readState();
    const dateStr = todayDateStr(now);
    if (!state.breakUsage || state.breakUsage.date !== dateStr) {
      return { count: 0, totalMs: 0 };
    }
    return { count: state.breakUsage.count, totalMs: state.breakUsage.totalMs };
  }

  /** Bắt đầu tạm ngưng Focus trong `ms` - CHỈ hợp lệ khi đang trong 1 khung
   *  giờ recurring active VÀ chưa vượt giới hạn (caller - focusService -
   *  PHẢI tự kiểm tra cả 2 điều kiện này trước khi gọi, hàm này chỉ ghi
   *  nhận usage chứ không tự chặn). */
  startBreak(ms: number, now: Date = new Date()): void {
    const state = this.readState();
    const dateStr = todayDateStr(now);
    if (!state.breakUsage || state.breakUsage.date !== dateStr) {
      state.breakUsage = { date: dateStr, count: 0, totalMs: 0 };
    }
    state.breakUsage.count += 1;
    state.breakUsage.totalMs += ms;
    state.breakUntil = new Date(now.getTime() + ms).toISOString();
    this.writeState(state);
  }

  clearBreak(): void {
    const state = this.readState();
    if (state.breakUntil) {
      delete state.breakUntil;
      this.writeState(state);
    }
  }

  /**
   * Skip occurrence HÔM NAY của 1 recurring schedule. Nếu không truyền
   * `scheduleId`, tự tìm schedule khớp ngày hôm nay (ưu tiên cái đang active,
   * nếu không có thì cái sắp tới trong ngày). Trả về schedule đã skip, hoặc
   * null nếu không tìm thấy schedule nào phù hợp.
   */
  skipToday(scheduleId?: string, now: Date = new Date()): FocusSchedule | null {
    const state = this.readState();
    const dateStr = todayDateStr(now);
    const dow = now.getDay();

    let target: FocusSchedule | undefined;
    if (scheduleId) {
      target = state.schedules.find((s) => s.id === scheduleId && s.type === "recurring");
    } else {
      target =
        state.schedules.find(
          (s) => s.type === "recurring" && s.enabled && s.recurring?.daysOfWeek.includes(dow)
        ) ?? undefined;
    }
    if (!target?.recurring) return null;

    target.recurring.skippedDate = dateStr;
    this.writeState(state);
    return target;
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
      this.writeState({ ...state, schedules: stillValid });
    }

    // 2. Xử lý break hết hạn - nếu vẫn còn trong khung giờ recurring, tự bật lại
    if (state.breakUntil && new Date(state.breakUntil).getTime() <= now.getTime()) {
      this.clearBreak();
      if (this.isWithinScheduleWindowToday(now)) {
        getLogger().info("[focusScheduler] Break hết hạn, vẫn trong khung giờ - tự bật lại Focus");
        try {
          await this.onBreakExpire();
        } catch (err) {
          getLogger().error("[focusScheduler] onBreakExpire lỗi", { error: (err as Error).message });
        }
      }
    }

    // 3. Xử lý recurring start/end
    const dateStr = todayDateStr(now);
    const hhmm = hhmmOf(now);
    const dow = now.getDay();

    for (const schedule of stillValid) {
      if (schedule.type !== "recurring" || !schedule.enabled || !schedule.recurring) continue;
      if (!schedule.recurring.daysOfWeek.includes(dow)) continue;
      if (schedule.recurring.skippedDate === dateStr) continue; // bị skip hôm nay - không fire start/end

      const startKey = `${schedule.id}:${dateStr}:start`;
      const endKey = `${schedule.id}:${dateStr}:end`;

      if (schedule.recurring.startTime === hhmm && !this.firedRecurringToday.has(startKey)) {
        this.firedRecurringToday.add(startKey);
        try {
          await this.onRecurringTrigger("start");
        } catch (err) {
          getLogger().error(
            "[focusScheduler] onRecurringTrigger('start') lỗi - Focus có thể KHÔNG được bật dù đã sang khung giờ schedule",
            { scheduleId: schedule.id, error: (err as Error).message }
          );
        }
      }
      if (schedule.recurring.endTime === hhmm && !this.firedRecurringToday.has(endKey)) {
        this.firedRecurringToday.add(endKey);
        this.clearBreak(); // hết ngày làm việc thì break (nếu có) cũng hết ý nghĩa
        try {
          await this.onRecurringTrigger("end");
        } catch (err) {
          getLogger().error("[focusScheduler] onRecurringTrigger('end') lỗi", {
            scheduleId: schedule.id,
            error: (err as Error).message,
          });
        }
      }
    }

    // 4. Xử lý Sleep Mode cố định; mỗi phiên reset tiến độ AC/override riêng.
    // Dedup key theo dateStr của NGÀY XẢY RA sự kiện đó (start lúc 22:00 của
    // ngày D, end lúc 05:00 của ngày D+1) - tự nhiên khác nhau vì khác ngày,
    // không cần logic đặc biệt cho qua đêm ở đây.
    const sleepStartKey = `${dateStr}:sleepstart`;
    const sleepEndKey = `${dateStr}:sleepend`;

    if (hhmm === FocusScheduler.SLEEP_START && !this.firedSleepToday.has(sleepStartKey)) {
      this.firedSleepToday.add(sleepStartKey);
      this.ensureSleepSession(now);
      try {
        await this.onSleepTrigger("start");
      } catch (err) {
        getLogger().error(
          "[focusScheduler] onSleepTrigger('start') lỗi - Sleep Mode có thể KHÔNG được kích hoạt",
          { error: (err as Error).message }
        );
      }
    }
    if (hhmm === FocusScheduler.SLEEP_END && !this.firedSleepToday.has(sleepEndKey)) {
      this.firedSleepToday.add(sleepEndKey);
      try {
        await this.onSleepTrigger("end");
      } catch (err) {
        getLogger().error("[focusScheduler] onSleepTrigger('end') lỗi", {
          error: (err as Error).message,
        });
      }
    }
  }

  private readState(): SchedulerState {
    return readJsonState<SchedulerState>(this.filePath, { schedules: [] });
  }

  private writeState(state: SchedulerState): void {
    writeJsonState(this.filePath, state);
  }

  private ensureSleepSession(now: Date): SchedulerState {
    const state = this.readState();
    const sessionDate = sleepSessionDateStr(now);
    if (state.sleepUnlock?.sessionDate !== sessionDate) {
      state.sleepUnlock = { sessionDate, acceptedTaskCount: 0 };
      this.writeState(state);
    }
    return state;
  }

  /**
   * tick() chỉ trigger recurring đúng vào phút startTime/endTime khớp tuyệt
   * đối. Nếu process restart giữa chừng 1 khung giờ đang bật (vd restart lúc
   * 14:00 với schedule 06:00-23:00), sẽ không có gì bắt Focus bật lại - phải
   * đợi tới đúng 06:00 hôm sau. Hàm này chạy 1 lần lúc start() để đồng bộ
   * lại: nếu hiện tại đang nằm trong 1 recurring-window đang enabled và
   * KHÔNG bị skip hôm nay và KHÔNG đang break, fire "start" ngay lập tức.
   * Chỉ hỗ trợ khung giờ trong-ngày (startTime < endTime) như 06:00-23:00 -
   * chưa xử lý khung giờ qua đêm (vd 22:00-06:00).
   */
  private async reconcileOnStart(): Promise<void> {
    const now = new Date();
    const dateStr = todayDateStr(now);
    const schedule = this.scheduleWindowToday(now);

    if (schedule) {
      this.firedRecurringToday.add(`${schedule.id}:${dateStr}:start`);
      if (!this.isOnBreak(now)) {
        getLogger().info(
          "[focusScheduler] Reconcile lúc khởi động: đang trong khung giờ recurring, bật lại Focus",
          { id: schedule.id }
        );
        try {
          await this.onRecurringTrigger("start");
        } catch (err) {
          getLogger().error("[focusScheduler] reconcileOnStart lỗi", {
            error: (err as Error).message,
          });
        }
      } else {
        getLogger().info(
          "[focusScheduler] Reconcile lúc khởi động: đang trong khung giờ nhưng đang break - không bật lại"
        );
      }
    }

    // Khôi phục đúng phiên qua nửa đêm và tôn trọng sleep override đã persist.
    if (this.isWithinSleepTimeRange(now)) {
      const sessionDate = sleepSessionDateStr(now);
      this.ensureSleepSession(now);
      this.firedSleepToday.add(`${sessionDate}:sleepstart`);
    }
    if (this.isWithinSleepWindow(now)) {
      getLogger().info("[focusScheduler] Reconcile lúc khởi động: đang trong Sleep Mode, bật lại Focus");
      try {
        await this.onSleepTrigger("start");
      } catch (err) {
        getLogger().error("[focusScheduler] reconcileOnStart (sleep) lỗi", {
          error: (err as Error).message,
        });
      }
    }

    // Sau khi đồng bộ xong, vẫn chạy tick() bình thường để xử lý duration
    // hết hạn (nếu có) và các trường hợp khớp phút chính xác khác.
    await this.tick();
  }
}
