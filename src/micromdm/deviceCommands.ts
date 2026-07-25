import { MicroMdmClient } from "./client";
import {
  BatteryInfo,
  DeviceInformationResult,
  LocationInfo,
  MdmCommandQueuedResult,
  MdmCommandResult,
} from "../types/micromdm.types";

/**
 * High-level API tương đương chức năng của `tools/api` trong MicroMDM,
 * viết lại bằng TypeScript. Đây là tầng DUY NHẤT mà `services/` được phép
 * gọi để tương tác với thiết bị - không service nào được gọi thẳng `MicroMdmClient`.
 */
export class DeviceCommands {
  constructor(private readonly client: MicroMdmClient, private readonly deviceUUID: string) {}

  lock(pin?: string): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "DeviceLock",
      ...(pin ? { PIN: pin } : {}),
    });
  }

  unlock(): Promise<MdmCommandQueuedResult> {
    // ClearPasscode: MicroMDM RequestType tương ứng để gỡ passcode (unlock)
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "ClearPasscode",
    });
  }

  restart(): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "RestartDevice",
    });
  }

  shutdown(): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "ShutDownDevice",
    });
  }

  enableLostMode(message?: string): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "EnableLostMode",
      Message: message ?? "Thiết bị đã bị khoá Chế độ Mất",
    });
  }

  disableLostMode(): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "DisableLostMode",
    });
  }

  playSound(): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "PlaySound",
    });
  }

  async getBattery(): Promise<BatteryInfo> {
    const result: MdmCommandResult = await this.client.sendCommandAndWait({
      udid: this.deviceUUID,
      request_type: "DeviceInformation",
      Queries: ["BatteryLevel", "BatteryState"],
    });
    const raw = result.raw ?? {};
    const queryResponses = (raw["QueryResponses"] as Record<string, unknown>) ?? raw;
    return {
      batteryLevel: Number(queryResponses["BatteryLevel"] ?? 0),
      batteryState: (queryResponses["BatteryState"] as BatteryInfo["batteryState"]) ?? "Unknown",
      fetchedAt: new Date().toISOString(),
      source: "realtime",
    };
  }

  /**
   * Lưu ý: Lệnh DeviceLocation của MDM protocol chỉ hoạt động khi thiết bị
   * đang ở trong Lost Mode (MDM Lost Mode). Nếu thiết bị đang ở trạng thái
   * bình thường, lệnh này sẽ bị thiết bị từ chối (trả về Error hoặc NotNow).
   */
  async getLocation(): Promise<LocationInfo> {
    const result: MdmCommandResult = await this.client.sendCommandAndWait({
      udid: this.deviceUUID,
      request_type: "DeviceLocation",
    });
    const raw = result.raw ?? {};
    const locationDict = (raw["QueryResponses"] as Record<string, unknown>) ?? raw;
    return {
      latitude: Number(locationDict["Latitude"] ?? 0),
      longitude: Number(locationDict["Longitude"] ?? 0),
      horizontalAccuracy: locationDict["HorizontalAccuracy"] as number | undefined,
      fetchedAt: new Date().toISOString(),
      source: "realtime",
    };
  }

  async getDeviceInfo(): Promise<DeviceInformationResult> {
    const result: MdmCommandResult = await this.client.sendCommandAndWait({
      udid: this.deviceUUID,
      request_type: "DeviceInformation",
      Queries: [
        "DeviceName",
        "Model",
        "OSVersion",
        "BatteryLevel",
        "BatteryState",
        "IsSupervised",
      ],
    });
    const raw = result.raw ?? {};
    const queryResponses = (raw["QueryResponses"] as Record<string, unknown>) ?? raw;
    return {
      deviceName: queryResponses["DeviceName"] as string | undefined,
      modelName: queryResponses["Model"] as string | undefined,
      osVersion: queryResponses["OSVersion"] as string | undefined,
      batteryLevel: queryResponses["BatteryLevel"] as number | undefined,
      batteryState: queryResponses["BatteryState"] as string | undefined,
      isSupervised: queryResponses["IsSupervised"] as boolean | undefined,
      fetchedAt: new Date().toISOString(),
      source: "realtime",
    };
  }

  installProfile(mobileConfigBase64: string): Promise<MdmCommandQueuedResult> {
    return this.client.installProfile(this.deviceUUID, mobileConfigBase64);
  }

  removeProfile(profileIdentifier: string): Promise<MdmCommandQueuedResult> {
    return this.client.removeProfile(this.deviceUUID, profileIdentifier);
  }

  /**
   * EraseDevice - CHỈ được gọi qua commandRegistry với whitelist two-factor
   * của lệnh /api + xác nhận CONFIRM. Không expose ở bất kỳ command tier nào khác.
   */
  eraseDevice(pin?: string): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "EraseDevice",
      ...(pin ? { PIN: pin } : {}),
    });
  }

  enableActivationLock(): Promise<MdmCommandQueuedResult> {
    /**
     * Bug #8 fix: Lệnh đúng để bật User-Linked Activation Lock là "EnableActivationLock",
     * KHÔNG phải "DeviceLock". Gửi "DeviceLock" chỉ khoá màn hình, không ảnh hưởng
     * đến Activation Lock.
     *
     * Lưu ý: EnableActivationLock yêu cầu thiết bị đang Supervised + iOS đủ phiên bản.
     * Để có thể bypass sau này (vd: xoá máy rồi restore), cần lưu ActivationLockBypassCode
     * từ SecurityInfo command trước khi bật. Hiện tại bot chưa xử lý bypass code.
     */
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "EnableActivationLock",
    });
  }
}
