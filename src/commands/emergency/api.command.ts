import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { DeviceCommands } from "../../micromdm/deviceCommands";
import { resolveApiCommand, listApiCommandNames } from "../../micromdm/commandRegistry";
import { NotWhitelistedCommandError, ConfirmRequiredError, ValidationError } from "../../utils/errors";
import { EventBus } from "../../events/eventBus";
import { getLogger } from "../../utils/logger";

/**
 * /api <password> <name> [params...] [CONFIRM]
 *
 * - tier = TwoFactor: router đã bắt buộc VÀ username chính chủ VÀ đúng password
 *   trước khi handler này được gọi.
 * - `name` được resolve qua commandRegistry (whitelist) - không nhận command
 *   name ngoài whitelist.
 * - Nếu entry.requiresConfirm = true, token CUỐI CÙNG trong params phải là
 *   chuỗi "CONFIRM" (case-sensitive) - thiếu thì reject, không thực thi.
 */
export function createApiCommand(
  deviceCommands: DeviceCommands,
  bus: EventBus
): CommandDefinition {
  return {
    name: "api",
    tier: AuthTier.TwoFactor,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [commandName, ...rest] = ctx.effectiveArgs;

      if (!commandName) {
        return `Cú pháp: /api <password> <name> [params...]\nCommand khả dụng: ${listApiCommandNames().join(", ")}`;
      }

      const entry = resolveApiCommand(commandName);
      if (!entry) {
        throw new NotWhitelistedCommandError(commandName);
      }

      let params = rest;
      let confirmed = false;

      if (entry.requiresConfirm) {
        const last = params[params.length - 1];
        if (last !== "CONFIRM") {
          throw new ConfirmRequiredError(entry.name);
        }
        confirmed = true;
        params = params.slice(0, -1);
      }

      getLogger().warn("[api.command] Thực thi lệnh two-factor", {
        commandName: entry.name,
        telegramUsername: ctx.message.telegramUsername,
        telegramId: ctx.message.telegramId,
        confirmed,
      });

      bus.publish({
        type: "api.command.executed",
        commandName: entry.name,
        telegramUsername: ctx.message.telegramUsername ?? "unknown",
        telegramId: ctx.message.telegramId,
        confirmed,
      });

      try {
        const result = await entry.handler(deviceCommands, params);
        return `✅ /api ${entry.name} thực thi thành công.\n${JSON.stringify(result, null, 2)}`;
      } catch (err) {
        throw new ValidationError(`Lệnh "${entry.name}" thất bại: ${(err as Error).message}`);
      }
    },
  };
}
