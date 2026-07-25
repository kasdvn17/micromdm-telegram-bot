import { EventBus } from "./eventBus";
import { AppEvent } from "../types/event.types";
import { NotificationServiceApi } from "../services/notificationService";

/**
 * Các loại event KHÔNG được notify mặc định (heartbeat / check-in thuần tuý
 * không kèm thay đổi trạng thái) - theo yêu cầu gốc "Ignore heartbeat-only events".
 */
const SUPPRESSED_TYPES = new Set<AppEvent["type"]>(["heartbeat"]);

/**
 * marklost.* LUÔN được gửi bất kể có nằm trong danh sách suppress hay không -
 * đây là ngoại lệ tường minh theo yêu cầu: khi /mark lost bật, muốn nhận cả
 * heartbeat để biết máy còn bật/tắt.
 */
function shouldNotify(event: AppEvent): boolean {
  if (event.type.startsWith("marklost.")) return true;
  return !SUPPRESSED_TYPES.has(event.type);
}

function formatEvent(event: AppEvent): string {
  switch (event.type) {
    case "device.enrolled":
      return `📱 Thiết bị đã enroll: ${event.deviceUUID}`;
    case "device.checkin":
      return `✅ Check-in: ${event.requestType}`;
    case "device.online":
      return `🟢 Thiết bị online`;
    case "device.offline":
      return `🔴 Thiết bị offline`;
    case "profile.installed":
      return `📄 Profile đã cài: ${event.identifier}`;
    case "profile.removed":
      return `🗑️ Profile đã gỡ: ${event.identifier}`;
    case "focus.enabled":
      return `🎯 Focus mode: BẬT${event.durationMs ? ` (${Math.round(event.durationMs / 60000)} phút)` : ""}`;
    case "focus.disabled":
      return `🎯 Focus mode: TẮT`;
    case "safe.enabled":
      return `🛡️ Safe mode: BẬT (vô thời hạn)`;
    case "safe.disabled":
      return `🛡️ Safe mode: TẮT`;
    case "marklost.enabled":
      return `🕵️ Mark Lost: BẬT (theo dõi vị trí + trạng thái máy)`;
    case "marklost.disabled":
      return `🕵️ Mark Lost: TẮT`;
    case "marklost.location":
      return `📍 [Mark Lost] Vị trí: ${event.lat}, ${event.lng} lúc ${event.timestamp}`;
    case "marklost.heartbeat":
      return `💓 [Mark Lost] Máy đang ${event.online ? "ONLINE" : "OFFLINE"}`;
    case "lostmode.enabled":
      return `🚨 Lost Mode (thật): BẬT`;
    case "lostmode.disabled":
      return `🚨 Lost Mode (thật): TẮT`;
    case "playsound.requested":
      return `🔊 Đã yêu cầu phát âm thanh`;
    case "activationlock.result":
      return event.success
        ? `🔒 Activation Lock: bật thành công`
        : `⚠️ Activation Lock: thất bại (${event.reason ?? "không rõ lý do"})`;
    case "mdm.command.queued":
      return `⏳ Lệnh MDM đã queue: ${event.command}`;
    case "mdm.command.acked":
      return `📬 Lệnh MDM đã ack: ${event.command}`;
    case "mdm.command.succeeded":
      return `✅ Lệnh MDM thành công: ${event.command}`;
    case "mdm.command.failed":
      return `❌ Lệnh MDM thất bại: ${event.command} - ${event.error}`;
    case "scheduler.started":
      return `⏰ Scheduler bắt đầu: ${event.scheduleId}`;
    case "scheduler.stopped":
      return `⏰ Scheduler dừng: ${event.scheduleId}`;
    case "error":
      return `⚠️ Lỗi [${event.source}]: ${event.message}`;
    case "emergency.command.executed":
      return `🚨 Emergency command "${event.command}" được thực thi bởi @${
        event.telegramUsername ?? "unknown"
      } (id=${event.telegramId})`;
    case "api.command.executed":
      return `🔧 /api "${event.commandName}" thực thi bởi @${event.telegramUsername} (confirmed=${event.confirmed})`;
    case "heartbeat":
      return `💓 heartbeat`;
    default:
      return `ℹ️ Event: ${JSON.stringify(event)}`;
  }
}

export function attachNotifyBridge(
  bus: EventBus,
  notifier: NotificationServiceApi
): () => void {
  return bus.subscribe(async (event) => {
    if (!shouldNotify(event)) return;
    await notifier.send(formatEvent(event));
  });
}
