import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { DeviceCommands } from "../../micromdm/deviceCommands";
import { EventBus } from "../../events/eventBus";
import { ValidationError } from "../../utils/errors";

export function createUnlockCommand(deviceCommands: DeviceCommands): CommandDefinition {
  return {
    name: "unlock",
    tier: AuthTier.Emergency,
    handler: async (): Promise<string> => {
      // Theo yêu cầu: /unlock và Safe Mode là 2 cơ chế ĐỘC LẬP - /unlock chỉ
      // gửi lệnh mở khoá máy (ClearPasscode), KHÔNG còn tự động tắt Safe Mode
      // nữa. Muốn tắt Safe Mode, dùng riêng /safe off.
      await deviceCommands.unlock();
      return "🔓 Đã gửi lệnh mở khoá máy.";
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
