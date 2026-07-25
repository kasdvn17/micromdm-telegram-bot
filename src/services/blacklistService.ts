import { DeviceCommands } from "../micromdm/deviceCommands";
import {
  buildRestrictedAppsProfile,
  BLACKLIST_PROFILE_IDENTIFIER,
} from "../profiles/profileBuilder";
import {
  addBlacklistBundleId,
  loadBlacklistBundleIds,
  removeBlacklistBundleId,
} from "../profiles/restrictedApps";
import { EventBus } from "../events/eventBus";

export interface BlacklistServiceApi {
  add(bundleId: string): Promise<void>;
  remove(bundleId: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * Blacklist app: chặn mở app cụ thể, ĐỘC LẬP với Focus Mode's RestrictedApplications
 * (profile identifier khác nhau: com.personal.micromdmbot.blacklist vs .focus).
 * Mỗi lần add/remove sẽ rebuild + re-install lại profile ngay để có hiệu lực.
 */
export function createBlacklistService(
  deviceCommands: DeviceCommands,
  blacklistFilePath: string,
  bus: EventBus
): BlacklistServiceApi {
  const reinstallProfile = async (bundleIds: string[]): Promise<void> => {
    const profile = buildRestrictedAppsProfile({
      identifier: BLACKLIST_PROFILE_IDENTIFIER,
      displayName: "App Blacklist",
      restrictedBundleIds: bundleIds,
    });
    await deviceCommands.installProfile(profile);
    bus.publish({ type: "profile.installed", identifier: BLACKLIST_PROFILE_IDENTIFIER });
  };

  return {
    async add(bundleId: string): Promise<void> {
      const bundleIds = addBlacklistBundleId(blacklistFilePath, bundleId);
      await reinstallProfile(bundleIds);
    },
    async remove(bundleId: string): Promise<void> {
      const bundleIds = removeBlacklistBundleId(blacklistFilePath, bundleId);
      await reinstallProfile(bundleIds);
    },
    async list(): Promise<string[]> {
      return loadBlacklistBundleIds(blacklistFilePath);
    },
  };
}
