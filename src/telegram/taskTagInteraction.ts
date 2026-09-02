import TelegramBot from "node-telegram-bot-api";
import {
  CodeforcesTask,
  CodeforcesTaskServiceApi,
} from "../services/codeforcesTaskService";
import { CommandResponse } from "../types/command.types";
import { formatError } from "./replyFormatter";
import { getLogger } from "../utils/logger";

const PAGE_SIZE = 8;
const CALLBACK_PREFIX = "cft";
const REPLY_MARKER = "TAGEDIT";

function problemId(task: Pick<CodeforcesTask, "contestId" | "index">): string {
  return `${task.contestId}${task.index}`;
}

function tagSummary(task: CodeforcesTask): string {
  return (task.tags ?? []).map((tag) => `#${tag}`).join(" ") || "chưa có tag";
}

function picker(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  requestedPage: number
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } | null {
  const tasks = taskService.listTasks(telegramId);
  if (tasks.length === 0) return null;
  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const visible = tasks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const rows: TelegramBot.InlineKeyboardButton[][] = visible.map((task) => [
    {
      text: `${task.status === "solved" ? "✅" : "⏳"} ${problemId(task)} · ${task.name}`.slice(0, 60),
      callback_data: `${CALLBACK_PREFIX}:s:${page}:${task.contestId}:${task.index}`,
    },
  ]);
  if (totalPages > 1) {
    rows.push([
      ...(page > 0
        ? [{ text: "‹ Trước", callback_data: `${CALLBACK_PREFIX}:p:${page - 1}` }]
        : []),
      { text: `${page + 1}/${totalPages}`, callback_data: `${CALLBACK_PREFIX}:noop` },
      ...(page + 1 < totalPages
        ? [{ text: "Sau ›", callback_data: `${CALLBACK_PREFIX}:p:${page + 1}` }]
        : []),
    ]);
  }
  return {
    text: `🏷 Chọn problem cần chỉnh tag (${tasks.length} task):`,
    reply_markup: { inline_keyboard: rows },
  };
}

export function buildTaskTagPickerReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number
): CommandResponse {
  const result = picker(taskService, telegramId, 0);
  if (!result) return "📋 Chưa có task Codeforces nào để gắn tag.";
  return { text: result.text, options: { reply_markup: result.reply_markup } };
}

function taskDetail(
  task: CodeforcesTask,
  page: number
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } {
  const id = problemId(task);
  const rows: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: "➕ Gán tag mới", callback_data: `${CALLBACK_PREFIX}:n:${page}:${task.contestId}:${task.index}` }],
    ...(task.tags ?? []).map((tag) => [
      { text: `✖ Gỡ #${tag}`, callback_data: `${CALLBACK_PREFIX}:r:${page}:${task.contestId}:${task.index}:${tag}` },
    ]),
    [{ text: "🧹 Xóa toàn bộ tags", callback_data: `${CALLBACK_PREFIX}:c:${page}:${task.contestId}:${task.index}` }],
    [{ text: "‹ Quay lại problem list", callback_data: `${CALLBACK_PREFIX}:p:${page}` }],
  ];
  return {
    text: `🏷 ${id} — ${task.name}\nTags: ${tagSummary(task)}`,
    reply_markup: { inline_keyboard: rows },
  };
}

export function attachTaskTagInteraction(
  bot: TelegramBot,
  taskService: CodeforcesTaskServiceApi,
  authorizedUsername: string
): void {
  const authorized = authorizedUsername.toLowerCase().replace(/^@/, "");
  const isAuthorized = (username?: string): boolean =>
    !!username && username.toLowerCase().replace(/^@/, "") === authorized;

  bot.on("callback_query", (query) => {
    void (async () => {
      const data = query.data;
      if (!data?.startsWith(`${CALLBACK_PREFIX}:`)) return;
      if (!isAuthorized(query.from.username)) {
        await bot.answerCallbackQuery(query.id, { text: "Bạn không có quyền.", show_alert: true });
        return;
      }
      const message = query.message;
      if (!message) return;
      const parts = data.split(":");
      const action = parts[1];
      const telegramId = query.from.id;
      try {
        if (action === "noop") {
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (action === "p") {
          const result = picker(taskService, telegramId, Number(parts[2]));
          if (result) {
            await bot.editMessageText(result.text, {
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: result.reply_markup,
            });
          }
          await bot.answerCallbackQuery(query.id);
          return;
        }

        const page = Number(parts[2]);
        const contestId = Number(parts[3]);
        const index = parts[4]?.toUpperCase();
        const id = `${contestId}${index}`;
        const findTask = (): CodeforcesTask | undefined =>
          taskService.listTasks(telegramId).find(
            (task) => task.contestId === contestId && task.index === index
          );

        if (action === "n") {
          await bot.sendMessage(
            message.chat.id,
            `${REPLY_MARKER} ${id}\nNhập tag mới cho ${id} (1-24 ký tự, không có khoảng trắng):`,
            { reply_markup: { force_reply: true, selective: true } }
          );
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (action === "r") taskService.editTaskTag(telegramId, id, "remove", parts[5]);
        if (action === "c") taskService.editTaskTag(telegramId, id, "clear");
        const task = findTask();
        if (!task) throw new Error(`Không còn tìm thấy task ${id}.`);
        const detail = taskDetail(task, page);
        await bot.editMessageText(detail.text, {
          chat_id: message.chat.id,
          message_id: message.message_id,
          reply_markup: detail.reply_markup,
        });
        await bot.answerCallbackQuery(query.id, {
          text: action === "r" ? "Đã gỡ tag." : action === "c" ? "Đã xóa tags." : undefined,
        });
      } catch (error) {
        getLogger().error("[taskTagInteraction] Callback lỗi", {
          error: error instanceof Error ? error.message : String(error),
        });
        await bot.answerCallbackQuery(query.id, {
          text: error instanceof Error ? error.message.slice(0, 180) : "Có lỗi xảy ra.",
          show_alert: true,
        });
      }
    })();
  });

  bot.on("message", (msg) => {
    void (async () => {
      const prompt = msg.reply_to_message?.text;
      const match = prompt?.match(new RegExp(`^${REPLY_MARKER}\\s+(\\d+[A-Z][A-Z0-9]*)`));
      if (!match || !msg.text || !isAuthorized(msg.from?.username)) return;
      try {
        const task = taskService.editTaskTag(msg.from!.id, match[1], "add", msg.text);
        await bot.sendMessage(msg.chat.id, `🏷 ${problemId(task)}: ${tagSummary(task)}.`);
      } catch (error) {
        await bot.sendMessage(msg.chat.id, formatError(error as Error));
      }
    })();
  });
}
