import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { FocusServiceApi } from "../../services/focusService";
import { parseDurationToMs, formatDuration, normalizeTimeOfDay, parseDaysOfWeek } from "../../utils/time";
import { ValidationError } from "../../utils/errors";
import { CodeforcesTaskServiceApi } from "../../services/codeforcesTaskService";

const DAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function focusOffGateOptions(status: ReturnType<FocusServiceApi["status"]>) {
  return status.sleepUnlock.withinTimeRange && status.sleepUnlock.sessionStartedAt
    ? { since: status.sleepUnlock.sessionStartedAt, requiredCount: 3 }
    : { requiredCount: 7 };
}

export function createFocusCommand(
  focusService: FocusServiceApi,
  codeforcesTasks?: Pick<
    CodeforcesTaskServiceApi,
    | "assertBreakAllowed"
    | "recordBreakStarted"
    | "assertFocusOffAllowed"
    | "getDailyGateStatus"
  >
): CommandDefinition {
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
          {
            const status = focusService.status();
            codeforcesTasks?.assertFocusOffAllowed(
              ctx.message.telegramId,
              focusOffGateOptions(status)
            );
            const result = await focusService.disable(!!codeforcesTasks);
            if (result.sleepModeDisabled) {
              return result.focusStillActive
                ? "🌙 Sleep Mode đã tắt cho phiên hôm nay, nhưng Focus vẫn bật do recurring schedule đang active."
                : "🌙 Sleep Mode đã tắt cho phần còn lại của phiên hôm nay.";
            }
            return "🎯 Focus mode đã TẮT.";
          }

        case "status": {
          const status = focusService.status();
          const remaining = focusService.breakUsageRemainingToday();
          const gate = codeforcesTasks?.getDailyGateStatus(
            ctx.message.telegramId,
            focusOffGateOptions(status)
          );
          const codeforcesInfo = gate
            ? `\nCodeforces tasks: ${gate.acceptedSinceLastBreak}/${gate.breakRequiredCount} task mới cho break; ${gate.focusOffAcceptedCount}/${gate.focusOffRequiredCount} task cho /focus off.`
            : "";
          const breakInfo = `\nBreak còn lại hôm nay: ${remaining.breaksRemaining} lần / ${formatDuration(remaining.totalMsRemaining)}.${codeforcesInfo}`;
          if (status.sleepUnlock.withinTimeRange && status.sleepUnlock.disabled) {
            return `🌙 Sleep Mode đã được TẮT cho phiên hôm nay.${breakInfo}`;
          }
          if (status.withinSleep) {
            return `😴 Đang trong Sleep Mode (22:00 - 05:00). Cần đủ 3 task AC từ lúc Sleep bắt đầu và /refresh để dùng /focus off.${breakInfo}`;
          }
          if (status.onBreak) {
            return `🎯 Focus đang TẠM NGƯNG (break) - còn ${formatDuration(status.breakRemainingMs ?? 0)}, sẽ tự bật lại nếu vẫn trong khung giờ schedule.${breakInfo}`;
          }
          const scheduleNote = status.withinSchedule ? " (theo schedule)" : "";
          return (
            (status.active
              ? `🎯 Focus đang BẬT${scheduleNote}${status.remainingMs ? ` - còn ${formatDuration(status.remainingMs)}` : ""}`
              : "🎯 Focus đang TẮT.") + breakInfo
          );
        }

        case "break": {
          codeforcesTasks?.assertBreakAllowed(ctx.message.telegramId);
          const durationArg = rest[0] ?? "15m";
          const ms = parseDurationToMs(durationArg);
          await focusService.breakFocus(ms);
          codeforcesTasks?.recordBreakStarted(ctx.message.telegramId);
          const remaining = focusService.breakUsageRemainingToday();
          return (
            `⏸️ Đã tạm ngưng Focus trong ${formatDuration(ms)}. Sẽ tự bật lại nếu vẫn còn trong khung giờ schedule.\n` +
            `Còn lại hôm nay: ${remaining.breaksRemaining} lần / ${formatDuration(remaining.totalMsRemaining)}.`
          );
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
              .map((s) => {
                const label = `[${s.id.slice(0, 8)}] ${s.type} - ${s.enabled ? "enabled" : "disabled"}`;
                if (s.type === "recurring" && s.recurring) {
                  const days = s.recurring.daysOfWeek.map((d) => DAY_NAMES[d]).join(",");
                  return `- ${label} - ${s.recurring.startTime}-${s.recurring.endTime} (${days})`;
                }
                return `- ${label}`;
              })
              .join("\n");
          }
          if (scheduleAction === "add") {
            const startTime = normalizeTimeOfDay(rest[1] ?? "");
            const endTime = normalizeTimeOfDay(rest[2] ?? "");
            if (startTime >= endTime) {
              throw new ValidationError(
                `Giờ bắt đầu (${startTime}) phải nhỏ hơn giờ kết thúc (${endTime}). Chưa hỗ trợ khung giờ qua đêm.`
              );
            }
            const daysOfWeek = parseDaysOfWeek(rest[3]);
            const schedule = focusService.addRecurringSchedule(daysOfWeek, startTime, endTime);
            const days = daysOfWeek.map((d) => DAY_NAMES[d]).join(",");
            return `📋 Đã tạo schedule [${schedule.id.slice(0, 8)}]: Focus BẬT ${startTime}-${endTime} (${days}).`;
          }
          if (scheduleAction === "enable" || scheduleAction === "disable") {
            const scheduleId = rest[1];
            if (!scheduleId) throw new ValidationError("Cú pháp: /focus schedule enable|disable <scheduleId>");
            if (scheduleAction === "enable") focusService.enableRecurring(scheduleId);
            else focusService.disableRecurring(scheduleId);
            return `📋 Schedule ${scheduleId} đã ${scheduleAction === "enable" ? "bật" : "tắt"}.`;
          }
          if (scheduleAction === "skip") {
            const scheduleId = rest[1]; // optional - không truyền thì tự tìm schedule của hôm nay
            const skipped = await focusService.skipToday(scheduleId);
            return `⏭️ Đã bỏ qua schedule [${skipped.id.slice(0, 8)}] cho HÔM NAY. Sẽ tự hoạt động lại bình thường từ ngày mai.`;
          }
          throw new ValidationError(
            "Cú pháp: /focus schedule list|add <start> <end> [days]|enable <id>|disable <id>|skip [id]\n" +
              'Vd: /focus schedule add 06:00 23:00 (mặc định tất cả các ngày, hoặc truyền "1,2,3,4,5" cho T2-T6, 0=CN)'
          );
        }

        case "blockadd": {
          const bundleId = rest[0];
          if (!bundleId) throw new ValidationError("Cú pháp: /focus blockadd <bundleId>");
          const appliedNow = await focusService.addBlockApplication(bundleId);
          return appliedNow
            ? `🚫 Đã thêm "${bundleId}" vào danh sách chặn và áp dụng NGAY (Focus/Safe Mode đang bật).`
            : `🚫 Đã thêm "${bundleId}" vào danh sách chặn. Sẽ áp dụng khi bật Focus lần tới (hiện Focus đang TẮT nên chưa đẩy xuống máy).`;
        }

        case "blockremove": {
          throw new ValidationError("Lệnh /focus blockremove đã bị vô hiệu hóa.");
        }

        case "blocklist": {
          const blockList = await focusService.listBlockApplications();
          return blockList.length === 0
            ? "📋 Danh sách chặn ứng dụng trong Focus mode đang trống."
            : blockList.map((b) => `- ${b}`).join("\n");
        }

        case "blwadd": {
          const url = rest[0];
          if (!url) throw new ValidationError("Cú pháp: /focus blwadd <website>");
          const appliedNow = await focusService.addBlockWebsite(url);
          return appliedNow
            ? `🚫 Đã thêm website "${url}" vào danh sách chặn và áp dụng NGAY (Focus đang bật).`
            : `🚫 Đã thêm website "${url}" vào danh sách chặn. Sẽ áp dụng khi bật Focus lần tới (hiện Focus đang TẮT nên chưa đẩy xuống máy).`;
        }

        case "blwremove": {
          const url = rest[0];
          if (!url) throw new ValidationError("Cú pháp: /focus blwremove <website>");
          const appliedNow = await focusService.removeBlockWebsite(url);
          return appliedNow
            ? `✅ Đã xóa website "${url}" khỏi danh sách chặn và cập nhật profile NGAY (Focus đang bật).`
            : `✅ Đã xóa website "${url}" khỏi danh sách chặn. Thay đổi sẽ áp dụng khi bật Focus lần tới.`;
        }

        case "blwlist": {
          const websites = await focusService.listBlockWebsites();
          return websites.length === 0
            ? "📋 Danh sách chặn website trong Focus mode đang trống."
            : websites.map((w) => `- ${w}`).join("\n");
        }

        default: {
          // không match subcommand nào -> thử parse như duration, vd "/focus 90m"
          if (!sub) throw new ValidationError("Cú pháp: /focus on|off|status|remaining|extend <d>|cancel|break [d]|schedule|blockadd|blocklist|blwadd|blwremove|blwlist ...");
          const ms = parseDurationToMs(sub);
          await focusService.enable(ms);
          return `🎯 Focus mode đã BẬT trong ${formatDuration(ms)}.`;
        }
      }
    },
  };
}
