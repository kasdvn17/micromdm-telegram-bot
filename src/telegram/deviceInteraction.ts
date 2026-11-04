import TelegramBot from "node-telegram-bot-api";
import { DeviceManagerServiceApi } from "../services/deviceManagerService";
import { MicroMdmClient } from "../micromdm/client";
import { buildDeviceListReply } from "../commands/normal/device.command";
import { getLogger } from "../utils/logger";

export function attachDeviceInteraction(
  bot: TelegramBot,
  deviceManager: DeviceManagerServiceApi,
  client: MicroMdmClient | undefined,
  authorizedUsername: string,
  authorizedTelegramUserId?: number
): void {
  const authorized = authorizedUsername.toLocaleLowerCase().replace(/^@/, "");

  bot.on("callback_query", (query) => {
    void (async () => {
      if (!query.data?.startsWith("dev:") || !query.message) return;

      const identityMatches =
        authorizedTelegramUserId !== undefined
          ? query.from.id === authorizedTelegramUserId
          : query.from.username?.toLocaleLowerCase().replace(/^@/, "") === authorized;

      if (!identityMatches) {
        await bot.answerCallbackQuery(query.id, { text: "Bạn không có quyền.", show_alert: true });
        return;
      }

      const parts = query.data.split(":");
      const action = parts[1];
      const udid = parts[2];
      const message = query.message;

      try {
        if (action === "primary" && udid) {
          const dev = deviceManager.setPrimary(udid);
          await bot.answerCallbackQuery(query.id, {
            text: `⭐ Đã đặt ${dev.name} làm Primary`,
          });
        } else if (action === "target" && udid) {
          const dev = deviceManager.setTarget(udid);
          await bot.answerCallbackQuery(query.id, {
            text: `🎯 Đã chuyển target sang ${dev.name}`,
          });
        } else if (action === "sync") {
          await bot.answerCallbackQuery(query.id, { text: "🔄 Đang đồng bộ với MicroMDM..." });
          if (client) {
            await deviceManager.syncWithMicroMdm(client);
          }
        } else if (action === "refresh") {
          await bot.answerCallbackQuery(query.id, { text: "♻️ Đang làm mới danh sách..." });
        }

        const reply = buildDeviceListReply(deviceManager, true);
        if (typeof reply !== "string" && reply.text) {
          const inlineKeyboard =
            reply.options?.reply_markup && "inline_keyboard" in reply.options.reply_markup
              ? reply.options.reply_markup
              : undefined;
          await bot.editMessageText(reply.text, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            parse_mode: "Markdown",
            reply_markup: inlineKeyboard,
          });
        }
      } catch (err) {
        getLogger().error("[deviceInteraction] Thao tác thất bại", {
          action,
          udid,
          error: (err as Error).message,
        });
        await bot.answerCallbackQuery(query.id, {
          text: `❌ Lỗi: ${(err as Error).message}`,
          show_alert: true,
        });
      }
    })();
  });
}
