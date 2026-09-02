import { DeviceCommands } from "../micromdm/deviceCommands";
import {
  buildRestrictedAppsProfile,
  BLACKLIST_PROFILE_IDENTIFIER,
} from "../profiles/profileBuilder";
import {
  addBlacklistBundleId,
  loadBlacklistBundleIds,
  removeBlacklistBundleId,
  loadBlacklistWebsites,
  addBlacklistWebsite,
} from "../profiles/restrictedApps";
import { EventBus } from "../events/eventBus";

export interface BlacklistServiceApi {
  add(bundleId: string): Promise<void>;
  /** ĐANG TẠM VÔ HIỆU HOÁ ở tầng command (commands/normal/blacklist.command.ts) -
   *  method này vẫn giữ nguyên logic, chỉ chặn ở command layer để dễ bật lại sau. */
  remove(bundleId: string): Promise<void>;
  list(): Promise<string[]>;
  /** /blacklist blwadd <url> - chặn website, dùng CHUNG profile Blacklist */
  addWebsite(url: string): Promise<void>;
  listWebsites(): Promise<string[]>;
}

/**
 * Blacklist app: chặn mở app cụ thể, ĐỘC LẬP với Focus Mode's RestrictedApplications
 * (profile identifier khác nhau: com.personal.micromdmbot.blacklist vs .focus).
 * Mỗi lần add/remove sẽ rebuild + re-install lại profile ngay để có hiệu lực.
 */
export function createBlacklistService(
  deviceCommands: DeviceCommands,
  blacklistFilePath: string,
  blacklistWebsitesFilePath: string,
  bus: EventBus
): BlacklistServiceApi {
  const reinstallProfile = async (): Promise<void> => {
    const bundleIds = loadBlacklistBundleIds(blacklistFilePath);
    const websites = loadBlacklistWebsites(blacklistWebsitesFilePath);
    const profile = buildRestrictedAppsProfile({
      identifier: BLACKLIST_PROFILE_IDENTIFIER,
      displayName: "App Blacklist",
      restrictedBundleIds: bundleIds,
      blockedWebsites: websites,
    });
    await deviceCommands.installProfile(profile, BLACKLIST_PROFILE_IDENTIFIER);
    bus.publish({ type: "profile.installed", identifier: BLACKLIST_PROFILE_IDENTIFIER });
  };

  return {
    async add(bundleId: string): Promise<void> {
      addBlacklistBundleId(blacklistFilePath, bundleId);
      await reinstallProfile();
    },
    async remove(bundleId: string): Promise<void> {
      removeBlacklistBundleId(blacklistFilePath, bundleId);
      await reinstallProfile();
    },
    async list(): Promise<string[]> {
      return loadBlacklistBundleIds(blacklistFilePath);
    },
    async addWebsite(url: string): Promise<void> {
      addBlacklistWebsite(blacklistWebsitesFilePath, url);
      await reinstallProfile();
    },
    async listWebsites(): Promise<string[]> {
      return loadBlacklistWebsites(blacklistWebsitesFilePath);
    },
  };
}
