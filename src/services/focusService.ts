import { DeviceCommands } from "../micromdm/deviceCommands";
import { FocusScheduler } from "../scheduler/focusScheduler";
import { EventBus } from "../events/eventBus";
import { SafeModeServiceApi } from "./safeModeService";
import {
  buildRestrictedAppsProfile,
  FOCUS_PROFILE_IDENTIFIER,
} from "../profiles/profileBuilder";
import { loadFocusBundleIds, addFocusBundleId, removeFocusBundleId, loadFocusWebsites, addFocusWebsite, removeFocusWebsite } from "../profiles/restrictedApps";
import { ValidationError } from "../utils/errors";
import { formatDuration } from "../utils/time";
import { FocusSchedule, SleepUnlockStatus } from "../types/scheduler.types";

export interface FocusDisableResult {
  sleepModeDisabled: boolean;
  focusStillActive: boolean;
}

export interface FocusStatus {
  active: boolean;
  remainingMs: number | null;
  /** true nếu hiện tại đang trong khung giờ 1 recurring schedule (bất kể break) */
  withinSchedule: boolean;
  /** true nếu Sleep Mode đang có hiệu lực (chưa được mở khóa và tắt trong phiên này) */
  withinSleep: boolean;
  onBreak: boolean;
  breakRemainingMs: number | null;
  sleepUnlock: SleepUnlockStatus;
}

export interface FocusServiceApi {
  enable(durationMs?: number): Promise<void>;
  /** `unlockedForToday` chỉ được truyền true sau khi Codeforces gate xác nhận đủ 10 AC. */
  disable(unlockedForToday?: boolean): Promise<FocusDisableResult>;
  status(): FocusStatus;
  extend(ms: number): Promise<void>;
  cancel(): Promise<void>;
  /** /focus break <time> - tạm ngưng Focus trong lúc đang ở khung giờ recurring active */
  breakFocus(ms: number): Promise<void>;
  /** Số lần / tổng thời gian break CÒN LẠI trong hôm nay (sau giới hạn 4 lần / 1 giờ) */
  breakUsageRemainingToday(): { breaksRemaining: number; totalMsRemaining: number };
  recordSleepAcceptedTasks(acceptedAtValues: readonly string[]): SleepUnlockStatus;
  /** /focus schedule skip [scheduleId] - bỏ qua occurrence của schedule HÔM NAY */
  skipToday(scheduleId?: string): Promise<FocusSchedule>;
  listSchedules(): FocusSchedule[];
  addRecurringSchedule(daysOfWeek: number[], startTime: string, endTime: string): FocusSchedule;
  enableRecurring(scheduleId: string): void;
  disableRecurring(scheduleId: string): void;
  /** Trả về true nếu profile được đẩy xuống máy NGAY (Focus/Safe Mode đang bật),
   *  false nếu chỉ lưu vào danh sách để áp dụng ở lần bật Focus kế tiếp. */
  addBlockApplication(bundleId: string): Promise<boolean>;
  removeBlockApplication(bundleId: string): Promise<boolean>;
  listBlockApplications(): Promise<string[]>;
  /** /focus blwadd|blwremove|blwlist - chặn website, dùng CHUNG profile Focus
   *  (thêm payload Web Content Filter vào cùng profile với app restriction) */
  addBlockWebsite(url: string): Promise<boolean>;
  removeBlockWebsite(url: string): Promise<boolean>;
  listBlockWebsites(): Promise<string[]>;
  /**
   * Chỉ dùng nội bộ bởi main.ts (wiring FocusScheduler's onRecurringTrigger/
   * onBreakExpire) - KHÔNG expose qua Telegram command. Bỏ qua guard "đang
   * trong schedule" vì chính scheduler mới là nguồn gọi các hàm này.
   */
  scheduleActivate(): Promise<void>;
  scheduleDeactivate(): Promise<void>;
  /**
   * Giống scheduleActivate/scheduleDeactivate (cài/gỡ CÙNG profile Focus,
   * bỏ qua guard) nhưng publish event RIÊNG (focus.sleep.enabled/disabled)
   * để notify hiển thị message riêng cho Sleep Mode thay vì lẫn với message
   * "Focus mode: BẬT/TẮT" chung chung. Chỉ dùng bởi main.ts wiring
   * onSleepTrigger.
   */
  sleepActivate(): Promise<void>;
  sleepDeactivate(): Promise<void>;
  /**
   * true nếu Focus profile đang thực sự cần thiết trên máy VÌ MỘT LÝ DO NÀO
   * KHÁC NGOÀI Sleep Mode (manual/duration/recurring schedule). Dùng bởi
   * main.ts khi Sleep Mode kết thúc (05:00): chỉ gỡ profile nếu hàm này trả
   * false, tránh tắt nhầm Focus nếu vẫn đang bật vì lý do khác.
   */
  isFocusActiveNow(): boolean;
}

export function createFocusService(
  deviceCommands: DeviceCommands,
  scheduler: FocusScheduler,
  restrictedAppsFilePath: string,
  focusWebsitesFilePath: string,
  safeModeService: SafeModeServiceApi,
  bus: EventBus
): FocusServiceApi {
  let manuallyActive = false; // bật không kèm duration (không có endAt)

  const installFocusProfile = async (): Promise<void> => {
    const bundleIds = loadFocusBundleIds(restrictedAppsFilePath);
    const websites = loadFocusWebsites(focusWebsitesFilePath);
    const profile = buildRestrictedAppsProfile({
      identifier: FOCUS_PROFILE_IDENTIFIER,
      displayName: "Focus Mode",
      restrictedBundleIds: bundleIds,
      blockedWebsites: websites,
    });
    await deviceCommands.installProfile(profile, FOCUS_PROFILE_IDENTIFIER);
    bus.publish({ type: "profile.installed", identifier: FOCUS_PROFILE_IDENTIFIER });
  };

  const removeFocusProfile = async (): Promise<void> => {
    await deviceCommands.removeProfile(FOCUS_PROFILE_IDENTIFIER);
    bus.publish({ type: "profile.removed", identifier: FOCUS_PROFILE_IDENTIFIER });
  };

  /**
   * Focus (manual, duration, HOẶC recurring schedule đang trong khung giờ)
   * đang thực sự có profile Focus (FOCUS_PROFILE_IDENTIFIER) trên máy.
   *
   * Safe Mode ĐÃ TÁCH RIÊNG (dùng SAFE_PROFILE_IDENTIFIER + danh sách app
   * sensitive_apps.json độc lập) nên không còn liên quan tới việc profile
   * Focus có cần đẩy lại hay không - bỏ `safeModeService.isActive()` khỏi
   * điều kiện này.
   *
   * BUG ĐÃ SỬA (trước đây thiếu isWithinScheduleWindowToday()): khi Focus
   * đang BẬT do recurring schedule (không phải manual/duration), hàm luôn
   * trả về false. Hậu quả: /focus blockadd|blockremove tưởng Focus đang TẮT
   * nên chỉ lưu vào file mà KHÔNG đẩy xuống máy ngay, dù app trên thực tế
   * đang bị Focus schedule chặn - state trên bot và trên máy bị lệch nhau
   * cho tới tận lần recurring trigger tiếp theo (hôm sau).
   *
   * Giờ tính CẢ Sleep Mode khi nó chưa được override cho phiên hiện tại.
   */
  const isFocusActiveNow = (): boolean =>
    manuallyActive ||
    scheduler.activeDurationSchedule() !== null ||
    (scheduler.isWithinScheduleWindowToday() && !scheduler.isOnBreak()) ||
    scheduler.isWithinSleepWindow();

  const requireNotWithinSchedule = (actionLabel: string): void => {
    if (scheduler.isWithinSleepWindow()) {
      throw new ValidationError(
        `Đang trong Sleep Mode (${FocusScheduler.SLEEP_START} - ${FocusScheduler.SLEEP_END}) nên /focus ${actionLabel} không có tác dụng. ` +
          `Có thể mở khóa /focus off bằng cách AC 3 task Codeforces hợp lệ từ lúc Sleep bắt đầu rồi dùng /refresh.`
      );
    }
    if (scheduler.isWithinScheduleWindowToday()) {
      throw new ValidationError(
        `Đang trong khung giờ 1 schedule active nên /focus ${actionLabel} không có tác dụng. ` +
          `Dùng /focus break <time> để tạm ngưng (mặc định 15 phút), hoặc /focus schedule skip để bỏ qua schedule hôm nay.`
      );
    }
  };

  return {
    async enable(durationMs?: number): Promise<void> {
      if (safeModeService.isActive()) {
        throw new ValidationError(
          "Safe mode đang bật - dùng /safe off trước khi bật Focus."
        );
      }
      requireNotWithinSchedule("on");
      // BUG CŨ: enable() tạo schedule mới mà không dọn state cũ, nên gọi
      // /focus <duration> nhiều lần (hoặc /focus on sau khi đã có 1 duration
      // đang chạy) tạo ra NHIỀU duration-schedule cùng tồn tại - status()/
      // extend()/cancel() chỉ thao tác trên 1 cái (cái cũ nhất, do dùng
      // .find()), còn (các) cái kia vẫn tự hết hạn ngầm sau đó và tắt Focus
      // ngoài ý muốn dù người dùng tưởng đã set lại hoặc đã chuyển sang bật
      // vô thời hạn. Luôn dọn sạch state cũ trước khi set state mới để chỉ
      // có duy nhất 1 "nguồn sự thật" tại 1 thời điểm.
      scheduler.cancelAllDurations();
      manuallyActive = false;
      await installFocusProfile();
      if (durationMs) {
        scheduler.scheduleDuration(durationMs);
      } else {
        manuallyActive = true;
      }
      bus.publish({ type: "focus.enabled", durationMs });
    },

    async disable(unlockedForToday = false): Promise<FocusDisableResult> {
      if (safeModeService.isActive()) {
        throw new ValidationError(
          "Safe mode đang bật - dùng /safe off để tắt Focus."
        );
      }
      if (scheduler.isWithinSleepTimeRange()) {
        const unlock = scheduler.getSleepUnlockStatus();
        if (unlock.disabled && !unlockedForToday) {
          const focusStillActive =
            scheduler.isWithinScheduleWindowToday() && !scheduler.isOnBreak();
          return { sleepModeDisabled: true, focusStillActive };
        }
        if (!unlockedForToday && !unlock.eligible) {
          throw new ValidationError(
            "Đang trong Sleep Mode. Cần AC ít nhất 3 task Codeforces hợp lệ từ lúc Sleep bắt đầu rồi dùng /refresh trước khi tắt."
          );
        }
        scheduler.disableSleepForCurrentSession(new Date(), unlockedForToday);
        scheduler.cancelAllDurations();
        manuallyActive = false;
        if (unlockedForToday) {
          while (scheduler.scheduleWindowToday()) {
            scheduler.skipToday(scheduler.scheduleWindowToday()!.id);
          }
          scheduler.clearBreak();
        }
        const focusStillActive = scheduler.isWithinScheduleWindowToday() && !scheduler.isOnBreak();
        if (!focusStillActive) await removeFocusProfile();
        bus.publish({ type: "focus.sleep.overridden" });
        return { sleepModeDisabled: true, focusStillActive };
      }
      if (unlockedForToday) {
        while (scheduler.scheduleWindowToday()) {
          scheduler.skipToday(scheduler.scheduleWindowToday()!.id);
        }
        scheduler.clearBreak();
      } else {
        requireNotWithinSchedule("off");
      }
      // Dọn TOÀN BỘ duration-schedule (không chỉ 1 cái tìm được bởi
      // activeDurationSchedule()) để tránh còn sót schedule "ma" tự hết hạn
      // sau này và bắn thông báo "focus.disabled" giả dù người dùng đã tắt
      // Focus thủ công từ trước.
      scheduler.cancelAllDurations();
      manuallyActive = false;
      await removeFocusProfile();
      bus.publish({ type: "focus.disabled" });
      return { sleepModeDisabled: false, focusStillActive: false };
    },

    status(): FocusStatus {
      const active = scheduler.activeDurationSchedule();
      const withinSchedule = scheduler.isWithinScheduleWindowToday();
      const withinSleep = scheduler.isWithinSleepWindow();
      const onBreak = scheduler.isOnBreak();
      const breakRemainingMs = scheduler.breakRemainingMs();
      const sleepUnlock = scheduler.getSleepUnlockStatus();
      if (active) {
        return {
          active: true,
          remainingMs: scheduler.remainingMs(active.id),
          withinSchedule,
          withinSleep,
          onBreak,
          breakRemainingMs,
          sleepUnlock,
        };
      }
      return {
        active: manuallyActive || (withinSchedule && !onBreak) || withinSleep,
        remainingMs: null,
        withinSchedule,
        withinSleep,
        onBreak,
        breakRemainingMs,
        sleepUnlock,
      };
    },

    async extend(ms: number): Promise<void> {
      const active = scheduler.activeDurationSchedule();
      if (!active) {
        throw new ValidationError("Không có Focus session (duration-based) nào đang chạy để extend.");
      }
      scheduler.extendDuration(active.id, ms);
    },

    async cancel(): Promise<void> {
      requireNotWithinSchedule("cancel");
      scheduler.cancelAllDurations();
      manuallyActive = false;
      await removeFocusProfile();
      bus.publish({ type: "focus.disabled" });
    },

    async breakFocus(ms: number): Promise<void> {
      if (scheduler.isWithinSleepWindow()) {
        throw new ValidationError(
          `Đang trong Sleep Mode (${FocusScheduler.SLEEP_START} - ${FocusScheduler.SLEEP_END}) - không thể break. AC 3 task Codeforces hợp lệ từ lúc Sleep bắt đầu, /refresh rồi dùng /focus off nếu muốn tắt phiên này.`
        );
      }
      if (!scheduler.isWithinScheduleWindowToday()) {
        throw new ValidationError(
          "Không có schedule nào đang active để break. /focus break chỉ dùng được khi đang trong khung giờ 1 schedule."
        );
      }

      const usage = scheduler.getBreakUsageToday();
      if (usage.count >= FocusScheduler.MAX_BREAKS_PER_DAY) {
        throw new ValidationError(
          `Đã dùng hết ${FocusScheduler.MAX_BREAKS_PER_DAY} lần /focus break trong hôm nay. Thử lại vào ngày mai.`
        );
      }
      const remainingMs = FocusScheduler.MAX_BREAK_TOTAL_MS_PER_DAY - usage.totalMs;
      if (remainingMs <= 0) {
        throw new ValidationError(
          `Đã dùng hết tổng ${formatDuration(FocusScheduler.MAX_BREAK_TOTAL_MS_PER_DAY)} break trong hôm nay. Thử lại vào ngày mai.`
        );
      }
      if (ms > remainingMs) {
        throw new ValidationError(
          `Chỉ còn ${formatDuration(remainingMs)} thời gian break trong hôm nay (đã yêu cầu ${formatDuration(ms)}). ` +
            `Dùng /focus break ${Math.max(1, Math.floor(remainingMs / 60000))}m hoặc ít hơn.`
        );
      }

      scheduler.startBreak(ms);
      if (!isFocusActiveNow()) await removeFocusProfile();
      const usageAfter = scheduler.getBreakUsageToday();
      bus.publish({
        type: "focus.break.started",
        durationMs: ms,
        breaksRemainingToday: FocusScheduler.MAX_BREAKS_PER_DAY - usageAfter.count,
        breakMsRemainingToday: FocusScheduler.MAX_BREAK_TOTAL_MS_PER_DAY - usageAfter.totalMs,
      });
    },

    breakUsageRemainingToday(): { breaksRemaining: number; totalMsRemaining: number } {
      const usage = scheduler.getBreakUsageToday();
      return {
        breaksRemaining: Math.max(0, FocusScheduler.MAX_BREAKS_PER_DAY - usage.count),
        totalMsRemaining: Math.max(0, FocusScheduler.MAX_BREAK_TOTAL_MS_PER_DAY - usage.totalMs),
      };
    },

    recordSleepAcceptedTasks(acceptedAtValues: readonly string[]): SleepUnlockStatus {
      return scheduler.recordSleepAcceptedTasks(acceptedAtValues);
    },

    async skipToday(scheduleId?: string): Promise<FocusSchedule> {
      const now = new Date();
      const dow = now.getDay(); // 0 = Chủ nhật, 6 = Thứ bảy
      if (dow !== 0 && dow !== 6) {
        throw new ValidationError(
          "/focus schedule skip chỉ dùng được vào Thứ 7/Chủ Nhật - không dùng được các ngày trong tuần (Thứ 2 - Thứ 6)."
        );
      }

      const wasActive = scheduler.isWithinScheduleWindowToday();
      const skipped = scheduler.skipToday(scheduleId);
      if (!skipped) {
        throw new ValidationError(
          "Không tìm thấy schedule nào khớp hôm nay để skip. Dùng /focus schedule list để xem danh sách."
        );
      }
      if (wasActive) {
        scheduler.clearBreak();
        if (!isFocusActiveNow()) {
          await removeFocusProfile();
          bus.publish({ type: "focus.disabled" });
        }
      }
      bus.publish({ type: "focus.schedule.skipped", scheduleId: skipped.id });
      return skipped;
    },

    listSchedules(): FocusSchedule[] {
      return scheduler.listSchedules();
    },

    addRecurringSchedule(daysOfWeek: number[], startTime: string, endTime: string): FocusSchedule {
      return scheduler.addRecurring(daysOfWeek, startTime, endTime);
    },

    enableRecurring(scheduleId: string): void {
      scheduler.enableRecurring(scheduleId);
    },

    disableRecurring(scheduleId: string): void {
      scheduler.disableRecurring(scheduleId);
    },

    async addBlockApplication(bundleId: string): Promise<boolean> {
      addFocusBundleId(restrictedAppsFilePath, bundleId);
      // BUG CŨ: luôn gọi installFocusProfile() vô điều kiện, kể cả khi Focus
      // đang TẮT -> vô tình BẬT profile chặn app trên máy dù bot vẫn báo
      // /focus status là "TẮT" (state trên bot và trên máy lệch nhau), đồng
      // thời bỏ qua luôn kiểm tra Safe Mode. Giờ chỉ đẩy xuống máy NGAY khi
      // Focus (manual/duration) hoặc Safe Mode đang thực sự bật; nếu không,
      // chỉ lưu vào file để áp dụng ở lần bật Focus kế tiếp.
      const appliedNow = isFocusActiveNow();
      if (appliedNow) {
        await installFocusProfile();
      }
      return appliedNow;
    },
    async removeBlockApplication(bundleId: string): Promise<boolean> {
      removeFocusBundleId(restrictedAppsFilePath, bundleId);
      const appliedNow = isFocusActiveNow();
      if (appliedNow) {
        await installFocusProfile();
      }
      return appliedNow;
    },
    async listBlockApplications(): Promise<string[]> {
      return loadFocusBundleIds(restrictedAppsFilePath);
    },

    async addBlockWebsite(url: string): Promise<boolean> {
      addFocusWebsite(focusWebsitesFilePath, url);
      const appliedNow = isFocusActiveNow();
      if (appliedNow) {
        await installFocusProfile();
      }
      return appliedNow;
    },
    async removeBlockWebsite(url: string): Promise<boolean> {
      removeFocusWebsite(focusWebsitesFilePath, url);
      const appliedNow = isFocusActiveNow();
      if (appliedNow) {
        await installFocusProfile();
      }
      return appliedNow;
    },
    async listBlockWebsites(): Promise<string[]> {
      return loadFocusWebsites(focusWebsitesFilePath);
    },

    // --- Nội bộ, dùng bởi main.ts wiring FocusScheduler ---
    async scheduleActivate(): Promise<void> {
      await installFocusProfile();
      bus.publish({ type: "focus.enabled" });
    },
    async scheduleDeactivate(): Promise<void> {
      // Recurring/duration source vừa hết không đồng nghĩa profile được phép
      // gỡ: Sleep Mode hoặc một source Focus khác có thể vẫn đang giữ nó.
      if (!isFocusActiveNow()) {
        await removeFocusProfile();
        bus.publish({ type: "focus.disabled" });
      }
    },
    async sleepActivate(): Promise<void> {
      await installFocusProfile();
      bus.publish({ type: "focus.sleep.enabled" });
    },
    async sleepDeactivate(): Promise<void> {
      if (!isFocusActiveNow()) await removeFocusProfile();
      bus.publish({ type: "focus.sleep.disabled" });
    },
    isFocusActiveNow,
  };
}
