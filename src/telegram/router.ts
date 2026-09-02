import TelegramBot from "node-telegram-bot-api";
import {
  AuthTier,
  CommandContext,
  CommandDefinition,
  IncomingMessageContext,
  ParsedCommand,
} from "../types/command.types";
import { createAuthChecker } from "./authMiddleware";
import { EmergencyAuthServiceApi } from "../services/emergencyAuthService";
import { getLogger } from "../utils/logger";
import { formatError, formatUnauthorized } from "./replyFormatter";
import { EventBus } from "../events/eventBus";

/**
 * Quy ước tham số theo tier (đã chốt trong Phase 3/4, áp dụng nhất quán
 * cho MỌI command, không chỉ riêng /api):
 *  - Normal:            /cmd <args...>              - không có password
 *  - Emergency:         /cmd <password> <args...>     - password ngay sau tên lệnh
 *  - TwoFactor (/api):  /api <password> <name> <args...>
 *
 * `effectiveArgs` trả cho handler LUÔN đã loại bỏ password (nếu có),
 * handler tự parse subcommand/tham số còn lại theo nhu cầu riêng.
 */
function parseMessage(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const tokens = trimmed.split(/\s+/);
  const name = tokens[0].slice(1).split("@")[0].toLowerCase();
  if (!name) return null;
  return { name, args: tokens.slice(1) };
}

function splitTelegramText(text: string, limit = 4096): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const candidates = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")];
    const cut = candidates.find((value) => value >= Math.floor(limit * 0.55)) ?? limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function createRouter(
  commands: CommandDefinition[],
  authorizedUsername: string,
  authorizedTelegramUserId: number | undefined,
  emergencyAuth: EmergencyAuthServiceApi,
  bus: EventBus
) {
  const checkAuth = createAuthChecker(authorizedUsername, authorizedTelegramUserId, emergencyAuth);
  const commandMap = new Map(commands.map((c) => [c.name.toLowerCase(), c]));
  const running = new Set<string>();
  const failedPasswordAttempts = new Map<number, number[]>();

  return async function handleMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    if (!msg.text) return;
    const parsed = parseMessage(msg.text);
    if (!parsed) return;

    const definition = commandMap.get(parsed.name);
    if (!definition) return; // không phải lệnh của bot này, bỏ qua im lặng
    if (msg.chat.type !== "private") {
      await bot.sendMessage(msg.chat.id, "🔒 Bot chỉ nhận lệnh trong private chat.");
      return;
    }

    const message: IncomingMessageContext = {
      telegramId: msg.from?.id ?? 0,
      telegramUsername: msg.from?.username,
      chatId: msg.chat.id,
      rawText: msg.text,
    };

    const needsPassword = definition.tier !== AuthTier.Normal;
    const containsSecret = needsPassword || parsed.name === "auth";
    const passwordProvided = needsPassword ? parsed.args[0] : undefined;
    const effectiveArgs = needsPassword ? parsed.args.slice(1) : parsed.args;

    if (containsSecret) {
      await bot.deleteMessage(message.chatId, msg.message_id).catch(() => undefined);
    }
    if (needsPassword) {
      const recent = (failedPasswordAttempts.get(message.telegramId) ?? [])
        .filter((timestamp) => Date.now() - timestamp < 10 * 60 * 1000);
      failedPasswordAttempts.set(message.telegramId, recent);
      if (recent.length >= 5) {
        await bot.sendMessage(message.chatId, "🔒 Quá nhiều lần thử sai. Hãy chờ 10 phút.");
        return;
      }
    }

    const authResult = checkAuth({
      tier: definition.tier,
      telegramUsername: message.telegramUsername,
      telegramId: message.telegramId,
      passwordProvided,
    });

    if (!authResult.ok) {
      if (authResult.reason === "wrong_password") {
        const attempts = failedPasswordAttempts.get(message.telegramId) ?? [];
        attempts.push(Date.now());
        failedPasswordAttempts.set(message.telegramId, attempts);
        if (attempts.length >= 3) {
          bus.publish({
            type: "error",
            source: "telegram-auth",
            message: `${attempts.length} lần thử Emergency password sai từ Telegram ID ${message.telegramId}.`,
          });
        }
      }
      getLogger().warn("[router] Auth thất bại", {
        command: parsed.name,
        tier: definition.tier,
        telegramId: message.telegramId,
        telegramUsername: message.telegramUsername,
        reason: authResult.reason,
      });
      await bot.sendMessage(message.chatId, formatUnauthorized(authResult.reason));
      return;
    }
    if (needsPassword) failedPasswordAttempts.delete(message.telegramId);

    // Emergency/TwoFactor command hợp lệ -> luôn log + notify tài khoản chính
    if (definition.tier !== AuthTier.Normal) {
      bus.publish({
        type: "emergency.command.executed",
        command: parsed.name,
        telegramUsername: message.telegramUsername,
        telegramId: message.telegramId,
      });
    }

    const ctx: CommandContext = {
      message,
      parsed: { ...parsed, subcommand: effectiveArgs[0] },
      effectiveArgs,
      progress: async () => undefined,
    };

    const lockKey = `${message.telegramId}:${parsed.name}`;
    if (running.has(lockKey)) {
      await bot.sendMessage(message.chatId, `⏳ /${parsed.name} đang được xử lý, vui lòng đợi.`);
      return;
    }
    running.add(lockKey);
    let progressMessageId: number | undefined;
    ctx.progress = async (text: string): Promise<void> => {
      if (!progressMessageId) {
        const sent = await bot.sendMessage(message.chatId, text);
        progressMessageId = sent.message_id;
      } else {
        await bot.editMessageText(text, {
          chat_id: message.chatId,
          message_id: progressMessageId,
        });
      }
    };

    try {
      await bot.sendChatAction(message.chatId, "typing");
      const response = await definition.handler(ctx);
      const reply =
        typeof response === "string" ? { text: response } : response;
      // Telegram giới hạn 4096 ký tự cho 1 tin nhắn, nếu reply quá dài thì cắt làm nhiều tin nhắn
      if (progressMessageId) {
        await bot.deleteMessage(message.chatId, progressMessageId).catch(() => undefined);
        progressMessageId = undefined;
      }
      if (reply.text.length <= 4096) {
        await bot.sendMessage(message.chatId, reply.text, reply.options);
      } else {
        const chunks = splitTelegramText(reply.text);
        for (let index = 0; index < chunks.length; index++) {
          await bot.sendMessage(
            message.chatId,
            chunks[index],
            index === chunks.length - 1 ? reply.options : undefined
          );
        }
      }
    } catch (err) {
      getLogger().error("[router] Command handler lỗi", {
        command: parsed.name,
        error: (err as Error).message,
      });
      await bot.sendMessage(message.chatId, formatError(err as Error));
      bus.publish({ type: "error", source: `command:${parsed.name}`, message: (err as Error).message });
    } finally {
      if (progressMessageId) {
        await bot.deleteMessage(message.chatId, progressMessageId).catch(() => undefined);
      }
      running.delete(lockKey);
    }
  };
}
