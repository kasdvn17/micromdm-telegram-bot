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
          "Task phải được thêm trước khi AC thì mới được tính cho /focus break và /focus off."
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
  taskService: CodeforcesTaskServiceApi,
  focusService: Pick<FocusServiceApi, "status">
): CommandDefinition {
  return {
    name: "refresh",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const result = await taskService.refresh(ctx.message.telegramId);
      const focusStatus = focusService.status();
      const inSleep =
        focusStatus.sleepUnlock.withinTimeRange &&
        !!focusStatus.sleepUnlock.sessionStartedAt;
      const gate = taskService.getDailyGateStatus(
        ctx.message.telegramId,
        inSleep
          ? { since: focusStatus.sleepUnlock.sessionStartedAt, requiredCount: 3 }
          : { requiredCount: 7 }
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
        `☕ Break kế tiếp: ${gate.acceptedSinceLastBreak}/${gate.breakRequiredCount} bài AC mới${gate.breakAllowed ? " — đã mở khóa." : "."}`,
        `${inSleep ? "🌙 Từ lúc Sleep bắt đầu" : "📅 Hôm nay"}: ${gate.focusOffAcceptedCount}/${gate.focusOffRequiredCount} task AC cho Focus off${gate.focusOffAllowed ? " — đã mở khóa." : "."}`,
        active.length === 0
          ? "✅ Không còn task active."
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
      return lines.join("\n");
    },
  };
}
