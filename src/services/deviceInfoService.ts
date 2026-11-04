import { DeviceCommands } from "../micromdm/deviceCommands";
import { DeviceInfoPollerApi } from "../scheduler/deviceInfoPoller";
import { BatteryInfo, DeviceInformationResult, LocationInfo } from "../types/micromdm.types";

export interface DeviceInfoServiceApi {
  getBattery(realtime: boolean, targetUDID?: string): Promise<BatteryInfo>;
  getLocation(realtime: boolean, targetUDID?: string): Promise<LocationInfo>;
  getDeviceInfo(realtime: boolean, targetUDID?: string): Promise<DeviceInformationResult>;
}

/**
 * `realtime=true`: luôn query mới qua MDM command, chờ Acknowledge.
 * `realtime=false`: dùng cache từ deviceInfoPoller nếu có, fallback sang
 * realtime nếu cache chưa có dữ liệu (lần đầu chạy) - theo quyết định đã
 * chốt "cả hai, real-time override cache".
 */
export function createDeviceInfoService(
  deviceCommands: DeviceCommands,
  poller: DeviceInfoPollerApi
): DeviceInfoServiceApi {
  return {
    async getBattery(realtime: boolean, targetUDID?: string): Promise<BatteryInfo> {
      if (!realtime) {
        const cached = poller.getCached(targetUDID);
        if (cached?.batteryLevel !== undefined) {
          return {
            batteryLevel: cached.batteryLevel,
            batteryState: (cached.batteryState as BatteryInfo["batteryState"]) ?? "Unknown",
            fetchedAt: cached.fetchedAt,
            source: "cache",
          };
        }
      }
      const targetDc = targetUDID ? deviceCommands.forDevice(targetUDID) : deviceCommands;
      return targetDc.getBattery();
    },

    async getLocation(realtime: boolean, targetUDID?: string): Promise<LocationInfo> {
      // location không được cache bởi deviceInfoPoller (DeviceInformation query
      // không trả toạ độ) - luôn query real-time, tham số realtime giữ lại cho
      // tương lai nếu bổ sung cache riêng cho location.
      void realtime;
      const targetDc = targetUDID ? deviceCommands.forDevice(targetUDID) : deviceCommands;
      return targetDc.getLocation();
    },

    async getDeviceInfo(realtime: boolean, targetUDID?: string): Promise<DeviceInformationResult> {
      if (!realtime) {
        const cached = poller.getCached(targetUDID);
        if (cached) return cached;
      }
      const targetDc = targetUDID ? deviceCommands.forDevice(targetUDID) : deviceCommands;
      return targetDc.getDeviceInfo();
    },
  };
}
