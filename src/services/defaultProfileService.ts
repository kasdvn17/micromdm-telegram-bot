import { DeviceCommands } from "../micromdm/deviceCommands";
import { getDefaultProfileBase64, DEFAULT_PROFILE_IDENTIFIER } from "../profiles/defaultProfile";
import { EventBus } from "../events/eventBus";
import { getLogger } from "../utils/logger";

export interface DefaultProfileServiceApi {
  /** Gọi bởi webhookServer khi phát hiện enrollment MỚI (UDID chưa từng thấy). */
  installOnEnrollment(deviceUUID: string): Promise<void>;
}

export function createDefaultProfileService(
  deviceCommands: DeviceCommands,
  defaultProfilePlistPath: string,
  bus: EventBus
): DefaultProfileServiceApi {
  return {
    async installOnEnrollment(deviceUUID: string): Promise<void> {
      try {
        await deviceCommands.installProfile(getDefaultProfileBase64(defaultProfilePlistPath));
        bus.publish({ type: "profile.installed", identifier: DEFAULT_PROFILE_IDENTIFIER });
        getLogger().info("[defaultProfileService] Đã cài profile mặc định cho enrollment mới", {
          deviceUUID,
        });
      } catch (err) {
        // Không throw ra ngoài - lỗi cài profile mặc định không nên chặn các bước
        // xử lý enrollment khác (activation lock...). Log + publish error để notify.
        getLogger().error("[defaultProfileService] Cài profile mặc định khi enroll thất bại", {
          error: (err as Error).message,
        });
        bus.publish({
          type: "error",
          source: "defaultProfileService",
          message: `Cài profile mặc định khi enroll thất bại: ${(err as Error).message}`,
        });
      }
    },
  };
}
