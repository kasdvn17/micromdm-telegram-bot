import TelegramBot from "node-telegram-bot-api";
import { CodeforcesTaskServiceApi } from "../services/codeforcesTaskService";
import { DeviceInfoServiceApi } from "../services/deviceInfoService";
import { FocusServiceApi } from "../services/focusService";
import { buildDashboardReply } from "../commands/normal/status.command";
import { buildTagSelectorReply, buildTaskListReply } from "./taskTagInteraction";
import { formatError } from "./replyFormatter";

function gateOptions(status: ReturnType<FocusServiceApi["status"]>) {
  return status.sleepUnlock.withinTimeRange && status.sleepUnlock.sessionStartedAt
    ? { since: status.sleepUnlock.sessionStartedAt, requiredCount: 3 }
    : { requiredCount: 7 };
}

export function attachMenuInteraction(
  bot: TelegramBot,
  focusService: FocusServiceApi,
  taskService: CodeforcesTaskServiceApi,
  deviceInfoService: DeviceInfoServiceApi,
  authorizedUsername: string,
  authorizedTelegramUserId?: number
): void {
  const authorized = authorizedUsername.toLocaleLowerCase().replace(/^@/, "");
  const running = new Set<number>();
  bot.on("callback_query", (query) => {
    void (async () => {
      if (!query.data?.startsWith("dash:") || !query.message) return;
      const identityMatches = authorizedTelegramUserId !== undefined
        ? query.from.id === authorizedTelegramUserId
        : query.from.username?.toLocaleLowerCase().replace(/^@/, "") === authorized;
      if (!identityMatches) {
        await bot.answerCallbackQuery(query.id, { text: "Bạn không có quyền.", show_alert: true });
        return;
      }
      if (running.has(query.from.id)) {
        await bot.answerCallbackQuery(query.id, { text: "Một thao tác menu đang chạy." });
        return;
      }
      running.add(query.from.id);
      const action = query.data.split(":")[1];
      const message = query.message;
      try {
        await bot.answerCallbackQuery(query.id, { text: "Đang xử lý..." });
        if (action === "tasks") {
          const reply = buildTaskListReply(taskService, query.from.id);
          if (typeof reply === "string") await bot.sendMessage(message.chat.id, reply);
          else await bot.sendMessage(message.chat.id, reply.text, reply.options);
          return;
        }
        if (action === "tags") {
          const reply = buildTagSelectorReply(taskService, query.from.id, "edit");
          if (typeof reply === "string") await bot.sendMessage(message.chat.id, reply);
          else await bot.sendMessage(message.chat.id, reply.text, reply.options);
          return;
        }
        if (action === "next") {
          const task = taskService.nextTask(query.from.id);
          await bot.sendMessage(
            message.chat.id,
            `🎯 ${task.contestId}${task.index} — ${task.name} — ${task.rating ?? "Unrated"}`,
            { reply_markup: { inline_keyboard: [[{ text: "🔗 Mở Codeforces", url: taskService.problemUrl(task) }]] } }
          );
          return;
        }
        if (action === "refresh") {
          await bot.editMessageText("🔄 Đang kiểm tra submission Codeforces...", {
            chat_id: message.chat.id,
            message_id: message.message_id,
          });
          await taskService.refresh(query.from.id);
        }
        if (action === "break") {
          taskService.assertBreakAllowed(query.from.id);
          await focusService.breakFocus(15 * 60 * 1000);
          taskService.recordBreakStarted(query.from.id);
        }
        if (action === "off") {
          const status = focusService.status();
          taskService.assertFocusOffAllowed(query.from.id, gateOptions(status));
          await focusService.disable(true);
        }
        const reply = await buildDashboardReply(
          focusService,
          taskService,
          deviceInfoService,
          query.from.id,
          true
        );
        if (typeof reply !== "string") {
          await bot.editMessageText(reply.text, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: reply.options?.reply_markup && "inline_keyboard" in reply.options.reply_markup
              ? reply.options.reply_markup
              : undefined,
          });
        }
      } catch (error) {
        try {
          const dashboard = await buildDashboardReply(
            focusService,
            taskService,
            deviceInfoService,
            query.from.id,
            true
          );
          if (typeof dashboard !== "string") {
            await bot.editMessageText(dashboard.text, {
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: dashboard.options?.reply_markup && "inline_keyboard" in dashboard.options.reply_markup
                ? dashboard.options.reply_markup
                : undefined,
            });
          }
        } catch {
          // Message gốc có thể đã bị xóa; error chính vẫn được gửi bên dưới.
        }
        await bot.sendMessage(message.chat.id, formatError(error as Error));
      } finally {
        running.delete(query.from.id);
      }
    })();
  });
}
