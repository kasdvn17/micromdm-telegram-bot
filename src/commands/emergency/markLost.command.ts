import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { MarkLostServiceApi } from "../../services/markLostService";
import { ValidationError } from "../../utils/errors";

export function createMarkLostCommand(markLostService: MarkLostServiceApi): CommandDefinition {
  return {
    name: "mark",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub] = ctx.effectiveArgs;
      if (sub !== "lost") {
        throw new ValidationError("Cú pháp: /mark <password> lost");
      }
      const { nowActive } = await markLostService.toggle();
      return nowActive
        ? "🕵️ Mark Lost đã BẬT - sẽ gửi vị trí + trạng thái online/offline định kỳ. Gửi lại /mark lost để tắt."
        : "🕵️ Mark Lost đã TẮT.";
    },
  };
}
