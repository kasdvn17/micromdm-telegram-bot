import { CodeforcesTaskServiceApi } from "../../services/codeforcesTaskService";
import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { ValidationError } from "../../utils/errors";

function formatTaskList(taskService: CodeforcesTaskServiceApi, telegramId: number): string {
  const tasks = taskService.listTasks(telegramId);
  if (tasks.length === 0) return "📋 Chưa có task Codeforces nào.";

  const active = tasks.filter((task) => task.status === "active");
  const solved = tasks.filter((task) => task.status === "solved");
  const lines = [
    `📋 Codeforces tasks: ${active.length} active, ${solved.length} đã AC`,
    ...active.map(
      (task) =>
        `⏳ ${task.contestId}${task.index} - ${task.name}\n${taskService.problemUrl(task)}`
    ),
    ...solved.map(
      (task) =>
        `✅ ${task.contestId}${task.index} - ${task.name}\n${taskService.problemUrl(task)}`
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
          `${taskService.problemUrl(task)}\n` +
          "Task này phải được /refresh xác nhận AC trước khi có thể /focus break."
        );
      }
      if (sub === "list") return formatTaskList(taskService, ctx.message.telegramId);

      throw new ValidationError("Cú pháp: /task add <problem>|list");
    },
  };
}

export function createRefreshCommand(taskService: CodeforcesTaskServiceApi): CommandDefinition {
  return {
    name: "refresh",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const result = await taskService.refresh(ctx.message.telegramId);
      const active = result.tasks.filter((task) => task.status === "active");
      const lines = [
        result.newlySolved.length > 0
          ? `🔄 Đã xác nhận thêm ${result.newlySolved.length} task AC: ${result.newlySolved
              .map((task) => `${task.contestId}${task.index}`)
              .join(", ")}.`
          : "🔄 Không có task AC mới.",
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
      return lines.join("\n");
    },
  };
}
