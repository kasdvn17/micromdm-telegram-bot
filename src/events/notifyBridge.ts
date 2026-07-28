import { EventBus } from "./eventBus";
import { AppEvent } from "../types/event.types";
import { NotificationServiceApi } from "../services/notificationService";

/**
 * Đã rollback: KHÔNG lọc heartbeat nữa - mọi event đều được notify.
 */
function shouldNotify(event: AppEvent): boolean {
  if (
    (event.type === "mdm.command.queued" ||
      event.type === "mdm.command.acked" ||
      event.type === "mdm.command.succeeded") &&
    event.command === "DeviceInformation"
  ) {
    return false;
  }
  return true;
}

function truncateJson(details: Record<string, unknown> | undefined, maxLen = 800): string {
  if (!details || Object.keys(details).length === 0) return "";
  const json = JSON.stringify(details, null, 2);
  return json.length > maxLen ? `${json.slice(0, maxLen)}\n... (đã cắt bớt)` : json;
}

function formatEvent(event: AppEvent): string {
  switch (event.type) {
    case "device.enrolled":
      return `📱 Thiết bị đã enroll: ${event.deviceUUID}`;
    case "device.checkin": {
      const details = truncateJson(event.details);
      return `✅ Check-in: ${event.requestType}${details ? `\n\`\`\`\n${details}\n\`\`\`` : ""}`;
    }
    case "device.heartbeat":
      return `💓 Check-in định kỳ (heartbeat): ${event.requestType}`;
    case "device.online":
      return `🟢 Thiết bị online`;
    case "device.offline": {
      const details = truncateJson(event.details);
      return `🔴 Thiết bị offline${details ? `\n\`\`\`\n${details}\n\`\`\`` : ""}`;
    }
    case "profile.installed":
      return `📄 Profile đã cài: ${event.identifier}`;
    case "profile.removed":
      return `🗑️ Profile đã gỡ: ${event.identifier}`;
    case "focus.enabled":
      return `🎯 Focus mode: BẬT${event.durationMs ? ` (${Math.round(event.durationMs / 60000)} phút)` : ""}`;
    case "focus.disabled":
      return `🎯 Focus mode: TẮT`;
    case "focus.break.started":
      return `⏸️ Focus tạm ngưng (break) trong ${Math.round(event.durationMs / 60000)} phút, sẽ tự bật lại nếu vẫn còn trong khung giờ schedule.`;
    case "focus.schedule.skipped":
      return `⏭️ Đã skip schedule [${event.scheduleId.slice(0, 8)}] cho hôm nay.`;
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
    case "marklost.deviceinfo": {
      const info = event.info;
      const batteryStr = info.batteryLevel !== undefined ? Math.round(info.batteryLevel * 100) + "%" : "?";
      return `📊 [Mark Lost] Device Info:
📱 ${info.deviceName ?? "?"} (${info.modelName ?? "?"})
OS: ${info.osVersion ?? "?"}
Pin: ${batteryStr} (${info.batteryState ?? "?"})`;
    }
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
