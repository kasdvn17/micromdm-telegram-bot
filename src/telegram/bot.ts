import TelegramBot from "node-telegram-bot-api";
import { getLogger } from "../utils/logger";

export function createBot(token: string): TelegramBot {
  const bot = new TelegramBot(token, { polling: true });

  bot.on("polling_error", (err) => {
    getLogger().error("[telegram] Polling error", { error: err.message });
  });

  void bot.setMyCommands([
    { command: "menu", description: "Bảng điều khiển" },
    { command: "status", description: "Trạng thái tổng quan" },
    { command: "task", description: "Quản lý task Codeforces" },
    { command: "refresh", description: "Cập nhật submission Codeforces" },
    { command: "focus", description: "Quản lý Focus và break" },
    { command: "quote", description: "Cài đặt danh ngôn" },
    { command: "help", description: "Danh sách lệnh" },
  ]).catch((err) => {
    getLogger().warn("[telegram] Không cập nhật được command menu", { error: err.message });
  });

  return bot;
}
