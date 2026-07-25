import TelegramBot from "node-telegram-bot-api";
import { getLogger } from "../utils/logger";

export interface NotificationServiceApi {
  send(message: string): Promise<void>;
  isEnabled(): boolean;
  setEnabled(v: boolean): void;
}

/**
 * Gửi notification tới chat của tài khoản chính chủ sử dụng chatId từ file cấu hình (.env).
 *
 * `enabled` mặc định true, có thể tắt/bật qua /notify on|off - lưu in-memory
 * (không cần persist ra file vì đây là preference phiên chạy hiện tại của bot,
 * và bot luôn khởi động lại với mặc định "bật" để không âm thầm im lặng mãi
 * nếu quên bật lại sau khi restart).
 */
export function createNotificationService(bot: TelegramBot, chatId: number): NotificationServiceApi {
  let enabled = true;

  return {
    async send(message: string): Promise<void> {
      if (!enabled) return;
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
  };
}
