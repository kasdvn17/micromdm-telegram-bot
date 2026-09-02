export enum AuthTier {
  Normal = "normal",
  Emergency = "emergency",
  TwoFactor = "two-factor",
}

export interface IncomingMessageContext {
  telegramId: number;
  telegramUsername?: string;
  chatId: number;
  rawText: string;
}

export interface ParsedCommand {
  /** Tên lệnh gốc, lowercase, không kèm "/" - vd "focus", "api", "mark" */
  name: string;
  /** Subcommand nếu có, vd "on"/"off"/"status" cho /focus, "lost" cho /mark lost */
  subcommand?: string;
  /** Toàn bộ token còn lại sau name (+subcommand) */
  args: string[];
}

export interface AuthCheckInput {
  tier: AuthTier;
  telegramUsername?: string;
  telegramId: number;
  /** Với Emergency/TwoFactor: token đầu tiên trong args được coi là password */
  passwordProvided?: string;
}

export type AuthFailureReason =
  | "unauthorized_user"
  | "wrong_password"
  | "missing_password"
  | "missing_confirm";

export interface AuthResult {
  ok: boolean;
  reason?: AuthFailureReason;
}

export interface CommandContext {
  message: IncomingMessageContext;
  parsed: ParsedCommand;
  /** args đã loại bỏ password (nếu tier != Normal) để handler không phải tự cắt */
  effectiveArgs: string[];
}

export type CommandResponse =
  | string
  | { text: string; options?: TelegramBot.SendMessageOptions };

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResponse>;

export interface CommandDefinition {
  name: string;
  tier: AuthTier;
  handler: CommandHandler;
}
import type TelegramBot from "node-telegram-bot-api";
