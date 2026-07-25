import { DeviceInformationResult } from "../types/micromdm.types";
import { DeviceCommands } from "../micromdm/deviceCommands";
import { getLogger } from "../utils/logger";

export interface DeviceInfoPollerApi {
  start(intervalMs: number): void;
  stop(): void;
  getCached(): DeviceInformationResult | null;
}

/**
 * Poll định kỳ `getDeviceInfo()` để cache lại, phục vụ các lệnh
 * /battery /deviceinfo khi gọi ở chế độ "cache" (không cần chờ round-trip
 * MDM command mới). Query real-time (bypass cache) vẫn luôn khả dụng qua
 * services/deviceInfoService.ts gọi thẳng DeviceCommands.
 */
export function createDeviceInfoPoller(deviceCommands: DeviceCommands): DeviceInfoPollerApi {
  let handle: NodeJS.Timeout | null = null;
  let cached: DeviceInformationResult | null = null;

  const tick = async (): Promise<void> => {
    try {
      cached = { ...(await deviceCommands.getDeviceInfo()), source: "cache" };
    } catch (err) {
      getLogger().warn("[deviceInfoPoller] Poll thất bại (thiết bị có thể offline)", {
        error: (err as Error).message,
      });
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
    getCached(): DeviceInformationResult | null {
      return cached;
    },
  };
}
