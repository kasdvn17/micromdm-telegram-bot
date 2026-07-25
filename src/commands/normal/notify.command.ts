import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { NotificationServiceApi } from "../../services/notificationService";
import { ValidationError } from "../../utils/errors";

export function createNotifyCommand(notificationService: NotificationServiceApi): CommandDefinition {
  return {
    name: "notify",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub] = ctx.effectiveArgs;
      switch (sub) {
        case "on":
          notificationService.setEnabled(true);
          return "🔔 Notification đã BẬT.";
        case "off":
          notificationService.setEnabled(false);
          return "🔕 Notification đã TẮT.";
        case "test": {
          await notificationService.send("🔔 Test notification từ bot.");
          return notificationService.isEnabled()
            ? "Đã gửi test notification."
            : "⚠️ Notify đang TẮT nên không có gì được gửi. Dùng /notify on trước.";
        }
        default:
          throw new ValidationError("Cú pháp: /notify on|off|test");
      }
    },
  };
}
