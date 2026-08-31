import { CodeforcesTaskServiceApi } from "../../services/codeforcesTaskService";
import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { ValidationError } from "../../utils/errors";

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
          "Task chỉ dùng để theo dõi; mỗi lần /focus break cần 3 bài AC mới kể từ lần break trước."
        );
      }
      if (sub === "list") {
        await taskService.refreshRatings(ctx.message.telegramId);
        return formatTaskList(taskService, ctx.message.telegramId);
      }

      throw new ValidationError("Cú pháp: /task add <problem>|list");
    },
  };
}

export function createRefreshCommand(
  taskService: CodeforcesTaskServiceApi
): CommandDefinition {
  return {
    name: "refresh",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const result = await taskService.refresh(ctx.message.telegramId);
      const gate = taskService.getDailyGateStatus(ctx.message.telegramId);
      const active = result.tasks.filter((task) => task.status === "active");
      const dailyAcceptedCount = result.dailyAccepted.problemKeys.length;
      const lines = [
        result.newlySolved.length > 0
          ? `🔄 Đã xác nhận thêm ${result.newlySolved.length} task AC: ${result.newlySolved
              .map((task) => `${task.contestId}${task.index}`)
              .join(", ")}.`
          : "🔄 Không có task AC mới.",
        result.ratingsUpdated > 0
          ? `📊 Đã cập nhật difficulty cho ${result.ratingsUpdated} task.`
          : "📊 Difficulty không có thay đổi.",
        `☕ Break kế tiếp: ${gate.acceptedSinceLastBreak}/${gate.breakRequiredCount} bài AC mới${gate.breakAllowed ? " — đã mở khóa." : "."}`,
        `📅 Focus off: ${dailyAcceptedCount}/${gate.focusOffRequiredCount} bài AC hôm nay${gate.focusOffAllowed ? " — đã mở khóa." : "."}`,
        active.length === 0
          ? "✅ Không còn task active."
          : `⏳ Còn ${active.length} task chưa AC (không ảnh hưởng điều kiện break): ${active
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
      return lines.join("\n");
    },
  };
}
