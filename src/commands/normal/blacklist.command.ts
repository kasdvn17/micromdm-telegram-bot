import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { BlacklistServiceApi } from "../../services/blacklistService";
import { ValidationError } from "../../utils/errors";

export function createBlacklistCommand(blacklistService: BlacklistServiceApi): CommandDefinition {
  return {
    name: "blacklist",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub, bundleId] = ctx.effectiveArgs;
      switch (sub) {
        case "add":
          if (!bundleId) throw new ValidationError("Cú pháp: /blacklist add <bundleId>");
          await blacklistService.add(bundleId);
          return `🚫 Đã thêm "${bundleId}" vào blacklist.`;
        case "remove":
          if (!bundleId) throw new ValidationError("Cú pháp: /blacklist remove <bundleId>");
          await blacklistService.remove(bundleId);
          return `✅ Đã gỡ "${bundleId}" khỏi blacklist.`;
        case "list": {
          const list = await blacklistService.list();
          return list.length === 0 ? "📋 Blacklist đang trống." : list.map((b) => `- ${b}`).join("\n");
        }
        default:
          throw new ValidationError("Cú pháp: /blacklist add|remove <bundleId>|list");
      }
    },
  };
}
