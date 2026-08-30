import { CodeforcesTaskServiceApi } from "../../services/codeforcesTaskService";
import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { ValidationError } from "../../utils/errors";
import { FocusServiceApi } from "../../services/focusService";

function formatRating(rating?: number, source?: string): string {
  if (!rating) return "Unrated";
  if (source === "kira") return `${rating} (external: Kira)`;
  return `${rating} (Codeforces)`;
}

function formatTaskList(taskService: CodeforcesTaskServiceApi, telegramId: number): string {
  const tasks = taskService.listTasks(telegramId);
  if (tasks.length === 0) return "📋 Chưa có task Codeforces nào.";

  const active = tasks.filter((task) => task.status === "active");
  const solved = tasks.filter((task) => task.status === "solved");
  const lines = [
    `📋 Codeforces tasks: ${active.length} active, ${solved.length} đã AC`,
    ...active.map(
      (task) =>
        `⏳ ${task.contestId}${task.index} - ${task.name} — ${formatRating(task.rating, task.ratingSource)}\n${taskService.problemUrl(task)}`
    ),
    ...solved.map(
      (task) =>
        `✅ ${task.contestId}${task.index} - ${task.name} — ${formatRating(task.rating, task.ratingSource)}\n${taskService.problemUrl(task)}`
    ),
  ];
  return lines.join("\n");
}

export function createTaskCommand(taskService: CodeforcesTaskServiceApi): CommandDefinition {
  return {
    name: "task",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub, ...rest] = ctx.effectiveArgs;
      if (sub === "add") {
        const query = rest.join(" ").trim();
        if (!query) {
          throw new ValidationError(
            "Cú pháp: /task add <mã, URL hoặc đúng tên bài>, vd: /task add 4A"
          );
        }
        const task = await taskService.addTask(ctx.message.telegramId, query);
        return (
          `➕ Đã thêm task ${task.contestId}${task.index} - ${task.name}.\n` +
          `Difficulty: ${formatRating(task.rating, task.ratingSource)}\n` +
          `${taskService.problemUrl(task)}\n` +
          "Task này phải được /refresh xác nhận AC trước khi có thể /focus break."
        );
      }
      if (sub === "list") return formatTaskList(taskService, ctx.message.telegramId);

      throw new ValidationError("Cú pháp: /task add <problem>|list");
    },
  };
}

export function createRefreshCommand(
  taskService: CodeforcesTaskServiceApi,
  focusService: Pick<FocusServiceApi, "recordSleepAcceptedTasks">
): CommandDefinition {
  return {
    name: "refresh",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const result = await taskService.refresh(ctx.message.telegramId);
      const sleepUnlock = focusService.recordSleepAcceptedTasks(
        result.newlySolved.flatMap((task) => (task.solvedAt ? [task.solvedAt] : []))
      );
      const active = result.tasks.filter((task) => task.status === "active");
      const lines = [
        result.newlySolved.length > 0
          ? `🔄 Đã xác nhận thêm ${result.newlySolved.length} task AC: ${result.newlySolved
              .map((task) => `${task.contestId}${task.index}`)
              .join(", ")}.`
          : "🔄 Không có task AC mới.",
        result.ratingsUpdated > 0
          ? `📊 Đã cập nhật difficulty cho ${result.ratingsUpdated} task.`
          : "📊 Difficulty không có thay đổi.",
        active.length === 0
          ? "✅ Không còn task active. Bạn có thể dùng /focus break."
          : `⏳ Còn ${active.length} task chưa AC: ${active
              .map((task) => `${task.contestId}${task.index}`)
              .join(", ")}.`,
      ];
      if (result.unavailablePublicProblems.length > 0) {
        lines.push(
          `⚠️ Không còn tìm thấy trong problemset public: ${result.unavailablePublicProblems
            .map((task) => `${task.contestId}${task.index}`)
            .join(", ")}. Các task này vẫn active.`
        );
      }
      if (sleepUnlock.withinTimeRange) {
        if (sleepUnlock.disabled) {
          lines.push("🌙 Sleep Mode đã được tắt cho phiên hôm nay.");
        } else if (sleepUnlock.eligible) {
          lines.push(
            `🌙 Sleep unlock: ${sleepUnlock.acceptedTaskCount}/${sleepUnlock.requiredTaskCount}. Đã đủ điều kiện — dùng /focus off để tắt Sleep Mode hôm nay.`
          );
        } else {
          lines.push(
            `🌙 Sleep unlock: ${sleepUnlock.acceptedTaskCount}/${sleepUnlock.requiredTaskCount} bài AC đầu tiên sau 22:00.`
          );
        }
      }
      return lines.join("\n");
    },
  };
}
