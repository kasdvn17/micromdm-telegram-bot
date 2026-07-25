import { DeviceCommands } from "../micromdm/deviceCommands";
import { DeviceInfoPollerApi } from "../scheduler/deviceInfoPoller";
import { BatteryInfo, DeviceInformationResult, LocationInfo } from "../types/micromdm.types";

export interface DeviceInfoServiceApi {
  getBattery(realtime: boolean): Promise<BatteryInfo>;
  getLocation(realtime: boolean): Promise<LocationInfo>;
  getDeviceInfo(realtime: boolean): Promise<DeviceInformationResult>;
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
    async getBattery(realtime: boolean): Promise<BatteryInfo> {
      if (!realtime) {
        const cached = poller.getCached();
        if (cached?.batteryLevel !== undefined) {
          return {
            batteryLevel: cached.batteryLevel,
            batteryState: (cached.batteryState as BatteryInfo["batteryState"]) ?? "Unknown",
            fetchedAt: cached.fetchedAt,
            source: "cache",
          };
        }
      }
      return deviceCommands.getBattery();
    },

    async getLocation(realtime: boolean): Promise<LocationInfo> {
      // location không được cache bởi deviceInfoPoller (DeviceInformation query
      // không trả toạ độ) - luôn query real-time, tham số realtime giữ lại cho
      // tương lai nếu bổ sung cache riêng cho location.
      void realtime;
      return deviceCommands.getLocation();
    },

    async getDeviceInfo(realtime: boolean): Promise<DeviceInformationResult> {
      if (!realtime) {
        const cached = poller.getCached();
        if (cached) return cached;
      }
      return deviceCommands.getDeviceInfo();
    },
  };
}
