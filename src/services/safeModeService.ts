import { DeviceCommands } from "../micromdm/deviceCommands";
import { EventBus } from "../events/eventBus";
import { buildRestrictedAppsProfile, SAFE_PROFILE_IDENTIFIER } from "../profiles/profileBuilder";
import {
  loadSensitiveBundleIds,
  addSensitiveBundleId,
  removeSensitiveBundleId,
} from "../profiles/restrictedApps";

export interface SafeModeServiceApi {
  enable(): Promise<void>;
  disable(): Promise<void>;
  isActive(): boolean;
  /** Trả về true nếu profile được đẩy xuống máy NGAY (Safe Mode đang bật),
   *  false nếu chỉ lưu vào danh sách để áp dụng ở lần bật Safe Mode kế tiếp. */
  addBlockApplication(bundleId: string): Promise<boolean>;
  removeBlockApplication(bundleId: string): Promise<boolean>;
  listBlockApplications(): Promise<string[]>;
}

/**
 * Safe Mode = chặn app RIÊNG (data/sensitive_apps.json), ĐỘC LẬP hoàn toàn
 * với Focus Mode - dùng khi cho người khác mượn máy và muốn ẩn các app
 * riêng tư (ngân hàng, tin nhắn...) mà không đụng tới cấu hình Focus Mode
 * hằng ngày. Dùng profile identifier RIÊNG (SAFE_PROFILE_IDENTIFIER, khác
 * FOCUS_PROFILE_IDENTIFIER) nên 2 profile không đè lên nhau.
 *
 * Vô thời hạn, không gắn với scheduler/timer. Chỉ tắt qua disable() (được
 * gọi từ /safe off - KHÔNG còn tự động qua /unlock, xem lostAndUnlock.command.ts).
 */
export function createSafeModeService(
  deviceCommands: DeviceCommands,
  sensitiveAppsFilePath: string,
  bus: EventBus
): SafeModeServiceApi {
  let active = false;

  const installSafeProfile = async (): Promise<void> => {
    const bundleIds = loadSensitiveBundleIds(sensitiveAppsFilePath);
    const profile = buildRestrictedAppsProfile({
      identifier: SAFE_PROFILE_IDENTIFIER,
      displayName: "Safe Mode (sensitive apps)",
      restrictedBundleIds: bundleIds,
    });
    await deviceCommands.installProfile(profile);
    bus.publish({ type: "profile.installed", identifier: SAFE_PROFILE_IDENTIFIER });
  };

  return {
    async enable(): Promise<void> {
      await installSafeProfile();
      active = true;
      bus.publish({ type: "safe.enabled" });
    },
    async disable(): Promise<void> {
      await deviceCommands.removeProfile(SAFE_PROFILE_IDENTIFIER);
      active = false;
      bus.publish({ type: "profile.removed", identifier: SAFE_PROFILE_IDENTIFIER });
      bus.publish({ type: "safe.disabled" });
    },
    isActive(): boolean {
      return active;
    },
    async addBlockApplication(bundleId: string): Promise<boolean> {
      addSensitiveBundleId(sensitiveAppsFilePath, bundleId);
      if (active) {
        await installSafeProfile();
      }
      return active;
    },
    async removeBlockApplication(bundleId: string): Promise<boolean> {
      removeSensitiveBundleId(sensitiveAppsFilePath, bundleId);
      if (active) {
        await installSafeProfile();
      }
      return active;
    },
    async listBlockApplications(): Promise<string[]> {
      return loadSensitiveBundleIds(sensitiveAppsFilePath);
    },
  };
}
