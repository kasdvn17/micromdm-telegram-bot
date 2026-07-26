import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { DeviceCommands } from "../../micromdm/deviceCommands";
import { SafeModeServiceApi } from "../../services/safeModeService";
import { EventBus } from "../../events/eventBus";
import { ValidationError } from "../../utils/errors";

export function createUnlockCommand(
  deviceCommands: DeviceCommands,
  safeModeService: SafeModeServiceApi
): CommandDefinition {
  return {
    name: "unlock",
    tier: AuthTier.Emergency,
    handler: async (): Promise<string> => {
      await deviceCommands.unlock();
      // Theo yêu cầu: /unlock cũng tự động tắt Safe Mode nếu đang bật
      let safeNote = "";
      if (safeModeService.isActive()) {
        await safeModeService.disable();
        safeNote = " (Safe mode cũng đã được tắt.)";
      }
      return `🔓 Đã gửi lệnh mở khoá máy.${safeNote}`;
    },
  };
}

export function createLostCommand(deviceCommands: DeviceCommands, bus: EventBus): CommandDefinition {
  return {
    name: "lost",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub, phone, ...rest] = ctx.effectiveArgs;
      if (sub === "enable") {
        await deviceCommands.enableLostMode(phone, rest.join(" "));
        bus.publish({ type: "lostmode.enabled" });
        return "🚨 Đã bật Lost Mode (thật) trên thiết bị.";
      }
      if (sub === "disable") {
        await deviceCommands.disableLostMode();
        bus.publish({ type: "lostmode.disabled" });
        return "🚨 Đã tắt Lost Mode.";
      }
      throw new ValidationError("Cú pháp: /lost enable|disable");
    },
  };
}
