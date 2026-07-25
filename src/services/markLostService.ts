import { DeviceCommands } from "../micromdm/deviceCommands";
import { MarkLostPollerApi } from "../scheduler/markLostPoller";
import { EventBus } from "../events/eventBus";
import { readJsonState, writeJsonState } from "../utils/jsonStore";
import { MarkLostState } from "../types/scheduler.types";
import { getLogger } from "../utils/logger";

export interface MarkLostServiceApi {
  toggle(): Promise<{ nowActive: boolean }>;
  isActive(): boolean;
  /** Gọi 1 lần lúc khởi động app: nếu state persisted đang active, resume poller đúng logic. */
  resumeIfActive(): void;
}

/**
 * "/mark lost": chế độ theo dõi kín đáo - CHỈ query location + kiểm tra
 * online/offline định kỳ, KHÔNG bật Lost Mode thật (tránh "bứt dây động rừng"
 * nếu máy đang bị người khác cầm). Toggle bằng cách gọi lại chính lệnh này.
 */
export function createMarkLostService(
  deviceCommands: DeviceCommands,
  poller: MarkLostPollerApi,
  pollIntervalMs: number,
  stateFilePath: string,
  bus: EventBus
): MarkLostServiceApi {
  const loadState = (): MarkLostState =>
    readJsonState<MarkLostState>(stateFilePath, { active: false });

  const saveState = (state: MarkLostState): void => writeJsonState(stateFilePath, state);

  const onTick = async (): Promise<void> => {
    try {
      const location = await deviceCommands.getLocation();
      bus.publish({
        type: "marklost.location",
        lat: location.latitude,
        lng: location.longitude,
        timestamp: location.fetchedAt,
      });
      bus.publish({ type: "marklost.heartbeat", online: true });
    } catch (err) {
      getLogger().warn("[markLostService] Poll location thất bại - coi như offline", {
        error: (err as Error).message,
      });
      bus.publish({ type: "marklost.heartbeat", online: false });
    }
  };

  return {
    async toggle(): Promise<{ nowActive: boolean }> {
      const state = loadState();
      if (state.active) {
        poller.stop();
        saveState({ active: false });
        bus.publish({ type: "marklost.disabled" });
        return { nowActive: false };
      }
      poller.start(pollIntervalMs, onTick);
      saveState({ active: true, startedAt: new Date().toISOString() });
      bus.publish({ type: "marklost.enabled" });
      return { nowActive: true };
    },
    isActive(): boolean {
      return loadState().active;
    },
    resumeIfActive(): void {
      const state = loadState();
      if (state.active && !poller.isRunning()) {
        getLogger().info("[markLostService] Resume mark-lost poller sau khi restart process");
        poller.start(pollIntervalMs, onTick);
      }
    },
  };
}
