import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { BlacklistServiceApi } from "../../services/blacklistService";
import { ValidationError } from "../../utils/errors";

/**
 * /blacklist remove ĐANG TẠM VÔ HIỆU HOÁ theo yêu cầu - chỉ được add, không
 * remove được app khỏi blacklist qua bot nữa. Muốn bật lại: xoá đoạn chặn
 * ở case "remove" bên dưới (blacklistService.remove() vẫn còn nguyên logic,
 * không bị xoá - chỉ chặn ở tầng command này).
 */
export function createBlacklistCommand(blacklistService: BlacklistServiceApi): CommandDefinition {
  return {
    name: "blacklist",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub, value] = ctx.effectiveArgs;
      switch (sub) {
        case "add":
          if (!value) throw new ValidationError("Cú pháp: /blacklist add <bundleId>");
          await blacklistService.add(value);
          return `🚫 Đã thêm "${value}" vào blacklist.`;
        case "remove":
          throw new ValidationError(
            "⛔ /blacklist remove đang TẠM bị vô hiệu hoá - chỉ được phép thêm (add), không gỡ được app khỏi blacklist qua bot."
          );
        case "list": {
          const list = await blacklistService.list();
          return list.length === 0 ? "📋 Blacklist đang trống." : list.map((b) => `- ${b}`).join("\n");
        }
        case "blwadd":
          if (!value) throw new ValidationError("Cú pháp: /blacklist blwadd <website>");
          await blacklistService.addWebsite(value);
          return `🚫 Đã thêm website "${value}" vào blacklist.`;
        default:
          throw new ValidationError("Cú pháp: /blacklist add <bundleId>|list|blwadd <website>");
      }
    },
  };
}
