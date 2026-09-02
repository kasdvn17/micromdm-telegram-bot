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
  const name = tokens[0].slice(1).toLowerCase();
  if (!name) return null;
  return { name, args: tokens.slice(1) };
}

export function createRouter(
  commands: CommandDefinition[],
  authorizedUsername: string,
  emergencyAuth: EmergencyAuthServiceApi,
  bus: EventBus
) {
  const checkAuth = createAuthChecker(authorizedUsername, emergencyAuth);
  const commandMap = new Map(commands.map((c) => [c.name.toLowerCase(), c]));

  return async function handleMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    if (!msg.text) return;
    const parsed = parseMessage(msg.text);
    if (!parsed) return;

    const definition = commandMap.get(parsed.name);
    if (!definition) return; // không phải lệnh của bot này, bỏ qua im lặng

    const message: IncomingMessageContext = {
      telegramId: msg.from?.id ?? 0,
      telegramUsername: msg.from?.username,
      chatId: msg.chat.id,
      rawText: msg.text,
    };

    const needsPassword = definition.tier !== AuthTier.Normal;
    const passwordProvided = needsPassword ? parsed.args[0] : undefined;
    const effectiveArgs = needsPassword ? parsed.args.slice(1) : parsed.args;

    const authResult = checkAuth({
      tier: definition.tier,
      telegramUsername: message.telegramUsername,
      telegramId: message.telegramId,
      passwordProvided,
    });

    if (!authResult.ok) {
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
    };

    try {
      const response = await definition.handler(ctx);
      const reply =
        typeof response === "string" ? { text: response } : response;
      // Telegram giới hạn 4096 ký tự cho 1 tin nhắn, nếu reply quá dài thì cắt làm nhiều tin nhắn
      if (reply.text.length <= 4096) {
        await bot.sendMessage(message.chatId, reply.text, reply.options);
      } else {
        const chunks = reply.text.match(/.{1,4096}/gs) ?? [];
        for (const chunk of chunks) {
          await bot.sendMessage(message.chatId, chunk);
        }
      }
    } catch (err) {
      getLogger().error("[router] Command handler lỗi", {
        command: parsed.name,
        error: (err as Error).message,
      });
      await bot.sendMessage(message.chatId, formatError(err as Error));
      bus.publish({ type: "error", source: `command:${parsed.name}`, message: (err as Error).message });
    }
  };
}
