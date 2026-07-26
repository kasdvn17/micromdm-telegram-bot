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
}

export interface FocusServiceApi {
  enable(durationMs?: number): Promise<void>;
  disable(): Promise<void>;
  status(): FocusStatus;
  extend(ms: number): Promise<void>;
  cancel(): Promise<void>;
  listSchedules(): FocusSchedule[];
  enableRecurring(scheduleId: string): void;
  disableRecurring(scheduleId: string): void;
  addBlockApplication(bundleId: string): Promise<void>;
  removeBlockApplication(bundleId: string): Promise<void>;
  listBlockApplications(): Promise<string[]>;
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

  return {
    async enable(durationMs?: number): Promise<void> {
      if (safeModeService.isActive()) {
        throw new ValidationError(
          "Safe mode đang bật - dùng /safe off hoặc /unlock trước khi bật Focus."
        );
      }
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
          "Safe mode đang bật - dùng /safe off hoặc /unlock để tắt Focus."
        );
      }
      const active = scheduler.activeDurationSchedule();
      if (active) scheduler.cancel(active.id);
      manuallyActive = false;
      await removeFocusProfile();
      bus.publish({ type: "focus.disabled" });
    },

    status(): FocusStatus {
      const active = scheduler.activeDurationSchedule();
      if (active) {
        return { active: true, remainingMs: scheduler.remainingMs(active.id) };
      }
      return { active: manuallyActive, remainingMs: null };
    },

    async extend(ms: number): Promise<void> {
      const active = scheduler.activeDurationSchedule();
      if (!active) {
        throw new ValidationError("Không có Focus session (duration-based) nào đang chạy để extend.");
      }
      scheduler.extendDuration(active.id, ms);
    },

    async cancel(): Promise<void> {
      const active = scheduler.activeDurationSchedule();
      if (active) scheduler.cancel(active.id);
      manuallyActive = false;
      await removeFocusProfile();
      bus.publish({ type: "focus.disabled" });
    },

    listSchedules(): FocusSchedule[] {
      return scheduler.listSchedules();
    },

    enableRecurring(scheduleId: string): void {
      scheduler.enableRecurring(scheduleId);
    },

    disableRecurring(scheduleId: string): void {
      scheduler.disableRecurring(scheduleId);
    },

    async addBlockApplication(bundleId: string): Promise<void> {
      const bundleIds = addFocusBundleId(restrictedAppsFilePath, bundleId);
      await installFocusProfile();
    },
    async removeBlockApplication(bundleId: string): Promise<void> {
      const bundleIds = removeFocusBundleId(restrictedAppsFilePath, bundleId);
      await installFocusProfile();
    },
    async listBlockApplications(): Promise<string[]> {
      return loadFocusBundleIds(restrictedAppsFilePath);
    }
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
