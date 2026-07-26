import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { SafeModeServiceApi } from "../../services/safeModeService";
import { ValidationError } from "../../utils/errors";

export function createSafeCommand(safeModeService: SafeModeServiceApi): CommandDefinition {
  return {
    name: "safe",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub] = ctx.effectiveArgs;
      if (sub === "on") {
        if (safeModeService.isActive()) return "🛡️ Safe mode đã đang BẬT rồi.";
        await safeModeService.enable();
        return "🛡️ Safe mode đã BẬT (vô thời hạn). Chỉ tắt bằng /safe off.";
      }
      if (sub === "off") {
        if (!safeModeService.isActive()) return "🛡️ Safe mode đang TẮT rồi.";
        await safeModeService.disable();
        return "🛡️ Safe mode đã TẮT.";
      }
      throw new ValidationError("Cú pháp: /safe on|off");
    },
  };
}
