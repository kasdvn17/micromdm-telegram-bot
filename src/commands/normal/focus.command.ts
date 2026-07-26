import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { FocusServiceApi } from "../../services/focusService";
import { parseDurationToMs, formatDuration } from "../../utils/time";
import { ValidationError } from "../../utils/errors";

export function createFocusCommand(focusService: FocusServiceApi): CommandDefinition {
  return {
    name: "focus",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub, ...rest] = ctx.effectiveArgs;

      switch (sub) {
        case "on":
          await focusService.enable();
          return "🎯 Focus mode đã BẬT (vô thời hạn cho tới khi /focus off).";

        case "off":
          await focusService.disable();
          return "🎯 Focus mode đã TẮT.";

        case "status": {
          const status = focusService.status();
          return status.active
            ? `🎯 Focus đang BẬT${status.remainingMs ? ` - còn ${formatDuration(status.remainingMs)}` : ""}`
            : "🎯 Focus đang TẮT.";
        }

        case "remaining": {
          const status = focusService.status();
          if (!status.active || status.remainingMs === null) {
            return "🎯 Không có Focus session giới hạn thời gian nào đang chạy.";
          }
          return `⏱️ Còn lại: ${formatDuration(status.remainingMs)}`;
        }

        case "extend": {
          const durationArg = rest[0];
          if (!durationArg) throw new ValidationError("Cú pháp: /focus extend <duration>, vd: /focus extend 30m");
          await focusService.extend(parseDurationToMs(durationArg));
          return `🎯 Đã gia hạn thêm ${durationArg}.`;
        }

        case "cancel":
          await focusService.cancel();
          return "🎯 Đã huỷ Focus session hiện tại.";

        case "schedule": {
          const scheduleAction = rest[0];
          if (scheduleAction === "list") {
            const schedules = focusService.listSchedules();
            if (schedules.length === 0) return "📋 Chưa có schedule nào.";
            return schedules
              .map((s) => `- [${s.id.slice(0, 8)}] ${s.type} - ${s.enabled ? "enabled" : "disabled"}`)
              .join("\n");
          }
          if (scheduleAction === "enable" || scheduleAction === "disable") {
            const scheduleId = rest[1];
            if (!scheduleId) throw new ValidationError("Cú pháp: /focus schedule enable|disable <scheduleId>");
            if (scheduleAction === "enable") focusService.enableRecurring(scheduleId);
            else focusService.disableRecurring(scheduleId);
            return `📋 Schedule ${scheduleId} đã ${scheduleAction === "enable" ? "bật" : "tắt"}.`;
          }
          throw new ValidationError("Cú pháp: /focus schedule list|enable <id>|disable <id>");
        }

        case "blockadd": {
          const bundleId = rest[0];
          if (!bundleId) throw new ValidationError("Cú pháp: /focus blockadd <bundleId>");
          await focusService.addBlockApplication(bundleId);
          return `🚫 Đã thêm "${bundleId}" vào danh sách chặn ứng dụng trong Focus mode.`;
        }

        case "blockremove": {
          const bundleId = rest[0];
          if (!bundleId) throw new ValidationError("Cú pháp: /focus blockremove <bundleId>");
          await focusService.removeBlockApplication(bundleId);
          return `✅ Đã gỡ "${bundleId}" khỏi danh sách chặn ứng dụng trong Focus mode.`;
        }

        case "blocklist": {
          const blockList = await focusService.listBlockApplications();
          return blockList.length === 0
            ? "📋 Danh sách chặn ứng dụng trong Focus mode đang trống."
            : blockList.map((b) => `- ${b}`).join("\n");
        }

        default: {
          // không match subcommand nào -> thử parse như duration, vd "/focus 90m"
          if (!sub) throw new ValidationError("Cú pháp: /focus on|off|status|remaining|extend <d>|cancel|schedule|blockadd|blockremove|blocklist ...");
          const ms = parseDurationToMs(sub);
          await focusService.enable(ms);
          return `🎯 Focus mode đã BẬT trong ${formatDuration(ms)}.`;
        }
      }
    },
  };
}
