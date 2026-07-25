import { EventBus } from "./eventBus";
import { AppEvent } from "../types/event.types";
import { appendJsonArray } from "../utils/jsonStore";
import { getLogger } from "../utils/logger";

interface HistoryRecord {
  timestamp: string;
  event: AppEvent;
}

/**
 * Ghi TOÀN BỘ event (kể cả heartbeat) vào history.json, khác với notifyBridge
 * vốn lọc bớt để tránh spam Telegram. History là nguồn dữ liệu đầy đủ cho
 * lệnh /history và cho việc debug sau này.
 */
export function attachHistoryLogger(bus: EventBus, historyFilePath: string): () => void {
  return bus.subscribe((event) => {
    try {
      appendJsonArray<HistoryRecord>(historyFilePath, {
        timestamp: new Date().toISOString(),
        event,
      });
    } catch (err) {
      getLogger().error("[historyLogger] Ghi history thất bại", {
        error: (err as Error).message,
      });
    }
  });
}
