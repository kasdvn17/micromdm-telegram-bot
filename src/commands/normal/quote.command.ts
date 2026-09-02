import { QuoteSchedulerApi } from "../../scheduler/quoteScheduler";
import { AuthTier, CommandDefinition } from "../../types/command.types";
import { ValidationError } from "../../utils/errors";
import { normalizeTimeOfDay, parseDurationToMs } from "../../utils/time";

export function createQuoteCommand(scheduler: QuoteSchedulerApi): CommandDefinition {
  return {
    name: "quote",
    tier: AuthTier.Normal,
    handler: async (ctx) => {
      const [action, ...rest] = ctx.effectiveArgs;
      if (!action || action === "status") {
        const status = scheduler.status();
        return [
          `💬 Quote: ${status.enabled ? "BẬT" : "TẮT"}`,
          `Snooze tới: ${status.snoozedUntil ?? "không"}`,
          `Quiet hours: ${status.quietStart && status.quietEnd ? `${status.quietStart}-${status.quietEnd}` : "không"}`,
        ].join("\n");
      }
      if (action === "on" || action === "off") {
        scheduler.setEnabled(action === "on");
        return `💬 Quote đã ${action === "on" ? "BẬT" : "TẮT"}.`;
      }
      if (action === "now") {
        await scheduler.sendNext();
        return "💬 Đã yêu cầu gửi quote ngay (quiet hours/snooze vẫn được tôn trọng).";
      }
      if (action === "snooze") {
        if (!rest[0]) throw new ValidationError("Cú pháp: /quote snooze <duration>");
        scheduler.snooze(parseDurationToMs(rest[0]));
        return `💤 Đã snooze quote trong ${rest[0]}.`;
      }
      if (action === "quiet") {
        if (rest[0] === "off") {
          scheduler.setQuietHours();
          return "💬 Đã tắt quiet hours cho quote.";
        }
        if (rest.length !== 2) throw new ValidationError("Cú pháp: /quote quiet <start> <end>|off");
        const start = normalizeTimeOfDay(rest[0]);
        const end = normalizeTimeOfDay(rest[1]);
        scheduler.setQuietHours(start, end);
        return `🌙 Quote quiet hours: ${start}-${end}.`;
      }
      throw new ValidationError("Cú pháp: /quote on|off|now|status|snooze <d>|quiet <start> <end>|off");
    },
  };
}
