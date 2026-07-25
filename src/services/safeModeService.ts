import { DeviceCommands } from "../micromdm/deviceCommands";
import { EventBus } from "../events/eventBus";
import {
  buildRestrictedAppsProfile,
  FOCUS_PROFILE_IDENTIFIER,
} from "../profiles/profileBuilder";
import { loadFocusBundleIds } from "../profiles/restrictedApps";

export interface SafeModeServiceApi {
  enable(): Promise<void>;
  disable(): Promise<void>;
  isActive(): boolean;
}

/**
 * Safe Mode = Focus Mode vô thời hạn, KHÔNG gắn với scheduler/timer.
 * Dùng chung profile RestrictedApplications với Focus (cùng identifier),
 * chỉ khác là không có cơ chế tự hết hạn. Chỉ tắt qua disable() (được gọi
 * từ /safe off hoặc /unlock).
 */
export function createSafeModeService(
  deviceCommands: DeviceCommands,
  restrictedAppsFilePath: string,
  bus: EventBus
): SafeModeServiceApi {
  let active = false;

  return {
    async enable(): Promise<void> {
      const bundleIds = loadFocusBundleIds(restrictedAppsFilePath);
      const profile = buildRestrictedAppsProfile({
        identifier: FOCUS_PROFILE_IDENTIFIER,
        displayName: "Safe Mode (indefinite Focus)",
        restrictedBundleIds: bundleIds,
      });
      await deviceCommands.installProfile(profile);
      active = true;
      bus.publish({ type: "profile.installed", identifier: FOCUS_PROFILE_IDENTIFIER });
      bus.publish({ type: "safe.enabled" });
    },
    async disable(): Promise<void> {
      await deviceCommands.removeProfile(FOCUS_PROFILE_IDENTIFIER);
      active = false;
      bus.publish({ type: "profile.removed", identifier: FOCUS_PROFILE_IDENTIFIER });
      bus.publish({ type: "safe.disabled" });
    },
    isActive(): boolean {
      return active;
    },
  };
}
