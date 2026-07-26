import { DeviceCommands } from "../micromdm/deviceCommands";
import { FocusScheduler } from "../scheduler/focusScheduler";
import { EventBus } from "../events/eventBus";
import { SafeModeServiceApi } from "./safeModeService";
import {
  buildRestrictedAppsProfile,
  FOCUS_PROFILE_IDENTIFIER,
} from "../profiles/profileBuilder";
import { loadFocusBundleIds, addFocusBundleId, removeFocusBundleId } from "../profiles/restrictedApps";
import { ValidationError } from "../utils/errors";
import { FocusSchedule } from "../types/scheduler.types";

export interface FocusStatus {
  active: boolean;
  remainingMs: number | null;
  /** true nếu hiện tại đang trong khung giờ 1 recurring schedule (bất kể break) */
  withinSchedule: boolean;
  onBreak: boolean;
  breakRemainingMs: number | null;
}

export interface FocusServiceApi {
  enable(durationMs?: number): Promise<void>;
  disable(): Promise<void>;
  status(): FocusStatus;
  extend(ms: number): Promise<void>;
  cancel(): Promise<void>;
  /** /focus break <time> - tạm ngưng Focus trong lúc đang ở khung giờ recurring active */
  breakFocus(ms: number): Promise<void>;
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
  /**
   * Chỉ dùng nội bộ bởi main.ts (wiring FocusScheduler's onRecurringTrigger/
   * onBreakExpire) - KHÔNG expose qua Telegram command. Bỏ qua guard "đang
   * trong schedule" vì chính scheduler mới là nguồn gọi các hàm này.
   */
  scheduleActivate(): Promise<void>;
  scheduleDeactivate(): Promise<void>;
}

export function createFocusService(
  deviceCommands: DeviceCommands,
  scheduler: FocusScheduler,
  restrictedAppsFilePath: string,
  safeModeService: SafeModeServiceApi,
  bus: EventBus
): FocusServiceApi {
  let manuallyActive = false; // bật không kèm duration (không có endAt)

  const installFocusProfile = async (): Promise<void> => {
    const bundleIds = loadFocusBundleIds(restrictedAppsFilePath);
    const profile = buildRestrictedAppsProfile({
      identifier: FOCUS_PROFILE_IDENTIFIER,
      displayName: "Focus Mode",
      restrictedBundleIds: bundleIds,
    });
    await deviceCommands.installProfile(profile);
    bus.publish({ type: "profile.installed", identifier: FOCUS_PROFILE_IDENTIFIER });
  };

  const removeFocusProfile = async (): Promise<void> => {
    await deviceCommands.removeProfile(FOCUS_PROFILE_IDENTIFIER);
    bus.publish({ type: "profile.removed", identifier: FOCUS_PROFILE_IDENTIFIER });
  };

  /**
   * Focus (manual hoặc duration) HOẶC Safe Mode đang bật - cả 2 dùng chung
   * profile identifier (FOCUS_PROFILE_IDENTIFIER) nên khi bất kỳ cái nào
   * đang bật, danh sách app bị chặn hiện diện thật sự trên máy.
   */
  const isFocusOrSafeModeActive = (): boolean =>
    manuallyActive || scheduler.activeDurationSchedule() !== null || safeModeService.isActive();

  const requireNotWithinSchedule = (actionLabel: string): void => {
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

    async disable(): Promise<void> {
      if (safeModeService.isActive()) {
        throw new ValidationError(
          "Safe mode đang bật - dùng /safe off để tắt Focus."
        );
      }
      requireNotWithinSchedule("off");
      // Dọn TOÀN BỘ duration-schedule (không chỉ 1 cái tìm được bởi
      // activeDurationSchedule()) để tránh còn sót schedule "ma" tự hết hạn
      // sau này và bắn thông báo "focus.disabled" giả dù người dùng đã tắt
      // Focus thủ công từ trước.
      scheduler.cancelAllDurations();
      manuallyActive = false;
      await removeFocusProfile();
      bus.publish({ type: "focus.disabled" });
    },

    status(): FocusStatus {
      const active = scheduler.activeDurationSchedule();
      const withinSchedule = scheduler.isWithinScheduleWindowToday();
      const onBreak = scheduler.isOnBreak();
      const breakRemainingMs = scheduler.breakRemainingMs();
      if (active) {
        return {
          active: true,
          remainingMs: scheduler.remainingMs(active.id),
          withinSchedule,
          onBreak,
          breakRemainingMs,
        };
      }
      return {
        active: manuallyActive || (withinSchedule && !onBreak),
        remainingMs: null,
        withinSchedule,
        onBreak,
        breakRemainingMs,
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
      if (!scheduler.isWithinScheduleWindowToday()) {
        throw new ValidationError(
          "Không có schedule nào đang active để break. /focus break chỉ dùng được khi đang trong khung giờ 1 schedule."
        );
      }
      scheduler.startBreak(ms);
      await removeFocusProfile();
      bus.publish({ type: "focus.break.started", durationMs: ms });
    },

    async skipToday(scheduleId?: string): Promise<FocusSchedule> {
      const wasActive = scheduler.isWithinScheduleWindowToday();
      const skipped = scheduler.skipToday(scheduleId);
      if (!skipped) {
        throw new ValidationError(
          "Không tìm thấy schedule nào khớp hôm nay để skip. Dùng /focus schedule list để xem danh sách."
        );
      }
      if (wasActive) {
        scheduler.clearBreak();
        await removeFocusProfile();
        bus.publish({ type: "focus.disabled" });
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
      const appliedNow = isFocusOrSafeModeActive();
      if (appliedNow) {
        await installFocusProfile();
      }
      return appliedNow;
    },
    async removeBlockApplication(bundleId: string): Promise<boolean> {
      removeFocusBundleId(restrictedAppsFilePath, bundleId);
      const appliedNow = isFocusOrSafeModeActive();
      if (appliedNow) {
        await installFocusProfile();
      }
      return appliedNow;
    },
    async listBlockApplications(): Promise<string[]> {
      return loadFocusBundleIds(restrictedAppsFilePath);
    },

    // --- Nội bộ, dùng bởi main.ts wiring FocusScheduler ---
    async scheduleActivate(): Promise<void> {
      await installFocusProfile();
      bus.publish({ type: "focus.enabled" });
    },
    async scheduleDeactivate(): Promise<void> {
      await removeFocusProfile();
      bus.publish({ type: "focus.disabled" });
    },
  };
}

/** Gọi bởi FocusScheduler khi 1 duration-schedule hết hạn (wiring ở main.ts) */
export async function handleFocusExpire(
  deviceCommands: DeviceCommands,
  bus: EventBus
): Promise<void> {
  await deviceCommands.removeProfile(FOCUS_PROFILE_IDENTIFIER);
  bus.publish({ type: "profile.removed", identifier: FOCUS_PROFILE_IDENTIFIER });
  bus.publish({ type: "focus.disabled" });
}
