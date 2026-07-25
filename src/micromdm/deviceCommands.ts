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
      ...(message ? { Message: message } : {}),
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
    return {
      batteryLevel: Number(raw["BatteryLevel"] ?? 0),
      batteryState: (raw["BatteryState"] as BatteryInfo["batteryState"]) ?? "Unknown",
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
    return {
      latitude: Number(raw["Latitude"] ?? 0),
      longitude: Number(raw["Longitude"] ?? 0),
      horizontalAccuracy: raw["HorizontalAccuracy"] as number | undefined,
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
    return {
      deviceName: raw["DeviceName"] as string | undefined,
      modelName: raw["Model"] as string | undefined,
      osVersion: raw["OSVersion"] as string | undefined,
      batteryLevel: raw["BatteryLevel"] as number | undefined,
      batteryState: raw["BatteryState"] as string | undefined,
      isSupervised: raw["IsSupervised"] as boolean | undefined,
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
