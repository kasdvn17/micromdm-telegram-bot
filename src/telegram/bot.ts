import TelegramBot from "node-telegram-bot-api";
import { getLogger } from "../utils/logger";

export function createBot(token: string): TelegramBot {
  const bot = new TelegramBot(token, { polling: true });

  bot.on("polling_error", (err) => {
    getLogger().error("[telegram] Polling error", { error: err.message });
  });

  return bot;
}
