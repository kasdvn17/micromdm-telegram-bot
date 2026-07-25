import TelegramBot from "node-telegram-bot-api";
import { getLogger } from "../utils/logger";

export interface NotificationServiceApi {
  send(message: string): Promise<void>;
  isEnabled(): boolean;
  setEnabled(v: boolean): void;
  setChatId(chatId: number): void;
}

/**
 * Gửi notification tới chat của tài khoản chính chủ. `chatId` chưa biết
 * tại thời điểm khởi tạo (Telegram không cấp sẵn chatId qua config - chỉ
 * biết được khi chính chủ nhắn tin lần đầu), nên khởi tạo với `null` và
 * bind qua `setChatId()` tại main.ts khi bắt được tin nhắn đầu tiên từ
 * đúng Authorized Username. Trước khi bind, `send()` là no-op (log warning).
 *
 * `enabled` mặc định true, có thể tắt/bật qua /notify on|off - lưu in-memory
 * (không cần persist ra file vì đây là preference phiên chạy hiện tại của bot,
 * và bot luôn khởi động lại với mặc định "bật" để không âm thầm im lặng mãi
 * nếu quên bật lại sau khi restart).
 */
export function createNotificationService(bot: TelegramBot): NotificationServiceApi {
  let enabled = true;
  let chatId: number | null = null;

  return {
    async send(message: string): Promise<void> {
      if (!enabled) return;
      if (chatId === null) {
        getLogger().warn("[notificationService] Chưa bind chatId - bỏ qua notify", { message });
        return;
      }
      try {
        await bot.sendMessage(chatId, message);
      } catch (err) {
        getLogger().error("[notificationService] Gửi Telegram thất bại", {
          error: (err as Error).message,
        });
      }
    },
    isEnabled(): boolean {
      return enabled;
    },
    setEnabled(v: boolean): void {
      enabled = v;
    },
    setChatId(id: number): void {
      chatId = id;
    },
  };
}
