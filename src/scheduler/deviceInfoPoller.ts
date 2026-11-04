import { DeviceInformationResult } from "../types/micromdm.types";
import { DeviceCommands } from "../micromdm/deviceCommands";
import { DeviceManagerServiceApi } from "../services/deviceManagerService";
import { getLogger } from "../utils/logger";

export interface DeviceInfoPollerApi {
  start(intervalMs: number): void;
  stop(): void;
  getCached(udid?: string): DeviceInformationResult | null;
  setCached(udid: string, info: DeviceInformationResult): void;
}

/**
 * Poll định kỳ `getDeviceInfo()` để cache lại, phục vụ các lệnh
 * /battery /deviceinfo khi gọi ở chế độ "cache" (không cần chờ round-trip
 * MDM command mới). Query real-time (bypass cache) vẫn luôn khả dụng qua
 * services/deviceInfoService.ts gọi thẳng DeviceCommands.
 */
export function createDeviceInfoPoller(
  deviceCommands: DeviceCommands,
  deviceManager?: DeviceManagerServiceApi
): DeviceInfoPollerApi {
  let handle: NodeJS.Timeout | null = null;
  const cacheMap = new Map<string, DeviceInformationResult>();

  const tick = async (): Promise<void> => {
    if (deviceManager) {
      const devices = deviceManager.listDevices();
      for (const dev of devices) {
        try {
          const info = await deviceCommands.forDevice(dev.udid).getDeviceInfo();
          const cached = { ...info, source: "cache" as const };
          cacheMap.set(dev.udid.toLowerCase(), cached);
          deviceManager.registerOrUpdate(dev.udid, {
            name: info.deviceName,
            model: info.modelName,
            osVersion: info.osVersion,
            batteryLevel: info.batteryLevel,
            batteryState: info.batteryState,
            isSupervised: info.isSupervised,
            status: "online",
            lastSeenAt: new Date().toISOString(),
          });
        } catch (err) {
          getLogger().warn("[deviceInfoPoller] Poll thất bại (thiết bị có thể offline)", {
            udid: dev.udid,
            error: (err as Error).message,
          });
        }
      }
    } else {
      try {
        const info = await deviceCommands.getDeviceInfo();
        const cached = { ...info, source: "cache" as const };
        cacheMap.set("default", cached);
      } catch (err) {
        getLogger().warn("[deviceInfoPoller] Poll thất bại (thiết bị có thể offline)", {
          error: (err as Error).message,
        });
      }
    }
  };

  return {
    start(intervalMs: number): void {
      if (handle) return;
      handle = setInterval(() => {
        void tick();
      }, intervalMs);
      void tick();
    },
    stop(): void {
      if (handle) {
        clearInterval(handle);
        handle = null;
      }
    },
    getCached(udid?: string): DeviceInformationResult | null {
      if (udid) {
        return cacheMap.get(udid.toLowerCase()) ?? null;
      }
      const targetUdid = deviceManager?.getActiveTargetUDID()?.toLowerCase();
      if (targetUdid && cacheMap.has(targetUdid)) {
        return cacheMap.get(targetUdid) ?? null;
      }
      const primaryUdid = deviceManager?.getPrimaryUDID()?.toLowerCase();
      if (primaryUdid && cacheMap.has(primaryUdid)) {
        return cacheMap.get(primaryUdid) ?? null;
      }
      return cacheMap.get("default") ?? cacheMap.values().next().value ?? null;
    },
    setCached(udid: string, info: DeviceInformationResult): void {
      cacheMap.set(udid.toLowerCase(), { ...info, source: "cache" });
    },
  };
}
