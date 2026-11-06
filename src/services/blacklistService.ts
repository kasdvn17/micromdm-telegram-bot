import { DeviceCommands } from "../micromdm/deviceCommands";
import {
  buildRestrictedAppsProfile,
  buildMacOsFocusProfile,
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
import { DeviceManagerServiceApi, isMacDevice } from "./deviceManagerService";
import { LapsServiceApi } from "./lapsService";
import { getLogger } from "../utils/logger";

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
 * Blacklist app & website: chặn mở app cụ thể trên iOS và chặn website trên cả hai thiết bị (iOS + macOS),
 * ĐỘC LẬP với Focus Mode (profile identifier khác nhau: com.personal.micromdmbot.blacklist vs .focus).
 * Mỗi lần add/remove sẽ rebuild + re-install lại profile ngay để có hiệu lực trên cả 2 máy (ko phân biệt target).
 */
export function createBlacklistService(
  deviceCommands: DeviceCommands,
  blacklistFilePath: string,
  blacklistWebsitesFilePath: string,
  bus: EventBus,
  deviceManager?: DeviceManagerServiceApi,
  lapsService?: LapsServiceApi,
  macDeviceUUID?: string
): BlacklistServiceApi {
  const getDeviceCmd = (udid: string): {
    installProfile(payload: string, expectedIdentifier?: string): Promise<unknown>;
    removeProfile(identifier: string): Promise<unknown>;
  } => {
    if (typeof deviceCommands.forDevice === "function") {
      return deviceCommands.forDevice(udid);
    }
    return deviceCommands;
  };

  const reinstallProfile = async (): Promise<void> => {
    const bundleIds = loadBlacklistBundleIds(blacklistFilePath);
    const websites = loadBlacklistWebsites(blacklistWebsitesFilePath);
    const lapsSerial = lapsService?.getStatus().serialNumber;

    const allDevices = deviceManager ? deviceManager.listDevices() : [];
    const targetDevices = allDevices.length > 0
      ? allDevices
      : [{ udid: deviceCommands.deviceUUID || "default", name: "Default" }];

    for (const dev of targetDevices) {
      const isMac = isMacDevice(dev, lapsSerial, macDeviceUUID);
      const cmd = getDeviceCmd(dev.udid);

      try {
        if (isMac) {
          // macOS: chỉ chặn website (không chặn app)
          if (websites.length > 0) {
            const macProfile = buildMacOsFocusProfile({
              identifier: BLACKLIST_PROFILE_IDENTIFIER,
              displayName: "App Blacklist",
              blockedWebsites: websites,
            });
            getLogger().info("[blacklistService] Đang đẩy profile Blacklist web filter xuống macOS", {
              udid: dev.udid,
              name: dev.name,
              websiteCount: websites.length,
            });
            await cmd.installProfile(macProfile, BLACKLIST_PROFILE_IDENTIFIER);
          } else {
            await cmd.removeProfile(BLACKLIST_PROFILE_IDENTIFIER).catch(() => undefined);
          }
        } else {
          // iOS / Phone: chặn cả app + website
          if (bundleIds.length > 0 || websites.length > 0) {
            const profile = buildRestrictedAppsProfile({
              identifier: BLACKLIST_PROFILE_IDENTIFIER,
              displayName: "App Blacklist",
              restrictedBundleIds: bundleIds,
              blockedWebsites: websites,
            });
            getLogger().info("[blacklistService] Đang đẩy profile Blacklist xuống iOS", {
              udid: dev.udid,
              name: dev.name,
              bundleIdCount: bundleIds.length,
              websiteCount: websites.length,
            });
            await cmd.installProfile(profile, BLACKLIST_PROFILE_IDENTIFIER);
          } else {
            await cmd.removeProfile(BLACKLIST_PROFILE_IDENTIFIER).catch(() => undefined);
          }
        }
      } catch (err) {
        getLogger().warn("[blacklistService] Không thể cài đặt profile Blacklist trên thiết bị", {
          udid: dev.udid,
          name: dev.name,
          error: (err as Error).message,
        });
      }
    }

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
