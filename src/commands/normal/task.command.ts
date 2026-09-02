import {
  CodeforcesTaskServiceApi,
  isCodeforcesProblemIdOrUrl,
} from "../../services/codeforcesTaskService";
import {
  AuthTier,
  CommandContext,
  CommandDefinition,
  CommandResponse,
} from "../../types/command.types";
import { ValidationError } from "../../utils/errors";
import { FocusServiceApi } from "../../services/focusService";
import {
  buildCreateTagPrompt,
  buildTagEditorReply,
  buildTagRemoveReply,
  buildTagSelectorReply,
  buildTaskTagPickerReply,
} from "../../telegram/taskTagInteraction";

function formatRating(rating?: number, source?: string): string {
  if (!rating) return "Unrated";
  if (source === "kira") return `${rating} (external: Kira)`;
  return `${rating} (Codeforces)`;
}

function formatTaskList(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  includeSolved: boolean,
  tagFilter?: string,
  archivedOnly = false
): string {
  const normalizedFilter = tagFilter?.trim().replace(/^#/, "").toLocaleLowerCase();
  const tasks = taskService
    .listTasks(telegramId)
    .filter((task) => (archivedOnly ? !!task.archivedAt : !task.archivedAt))
    .filter((task) => !normalizedFilter || (task.tags ?? []).includes(normalizedFilter));
  if (tasks.length === 0) return "📋 Chưa có task Codeforces nào.";

  const active = tasks.filter((task) => task.status === "active");
  const solved = tasks.filter((task) => task.status === "solved");
  if (!includeSolved && active.length === 0) {
    return `✅ Không còn task active. Có ${solved.length} task đã AC; dùng /task list all để xem.`;
  }
  const formatOne = (task: (typeof tasks)[number]): string => {
    const tags = (task.tags ?? []).map((tag) => `#${tag}`).join(" ");
    return `${task.status === "active" ? "⏳" : "✅"} ${task.contestId}${task.index} - ${task.name} — ${formatRating(task.rating, task.ratingSource)}${tags ? ` — ${tags}` : ""}\n${taskService.problemUrl(task)}`;
  };
  const visible = includeSolved ? [...active, ...solved] : active;
  const groups = new Map<string, typeof visible>();
  for (const task of visible) {
    const group = task.tags?.[0] ? `#${task.tags[0]}` : "Chưa gắn tag";
    groups.set(group, [...(groups.get(group) ?? []), task]);
  }
  const groupedLines = [...groups.entries()].flatMap(([group, groupTasks]) => [
    `\n🏷 ${group}`,
    ...groupTasks.map(formatOne),
  ]);
  const lines = [
    archivedOnly
      ? `🗄 Codeforces archive: ${tasks.length} task`
      : includeSolved
      ? `📋 Codeforces tasks: ${active.length} active, ${solved.length} đã AC`
      : `📋 Codeforces tasks: ${active.length} active`,
    ...(normalizedFilter ? [`Bộ lọc: #${normalizedFilter}`] : []),
    ...groupedLines,
  ];
  return lines.join("\n");
}

export function createTaskCommand(
  taskService: CodeforcesTaskServiceApi,
  focusService?: Pick<FocusServiceApi, "status">
): CommandDefinition {
  return {
    name: "task",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<CommandResponse> => {
      const [sub, ...rest] = ctx.effectiveArgs;
      if (sub === "add") {
        if (rest[0]?.toLowerCase() === "bulk") {
          const atomic = rest.some((value) => value.toLowerCase() === "--atomic");
          const references = rest
            .slice(1)
            .filter((value) => value.toLowerCase() !== "--atomic")
            .flatMap((value) => value.split(","))
            .map((value) => value.trim())
            .filter(Boolean);
          if (references.length === 0) {
            throw new ValidationError(
              "Cú pháp: /task add bulk <problemId|url> [problemId|url]..."
            );
          }
          const invalid = references.filter(
            (reference) => !isCodeforcesProblemIdOrUrl(reference)
          );
          if (invalid.length > 0) {
            throw new ValidationError(
              `Bulk chỉ nhận problem ID hoặc URL Codeforces. Không hợp lệ: ${invalid.join(", ")}`
            );
          }

          if (atomic) {
            const tasks = await taskService.addTasksAtomic(ctx.message.telegramId, references);
            return [
              `📦 Atomic bulk: đã thêm đủ ${tasks.length}/${references.length} task.`,
              ...tasks.map((task) => `✅ ${task.contestId}${task.index} - ${task.name} — ${formatRating(task.rating, task.ratingSource)}`),
            ].join("\n");
          }

          const added: string[] = [];
          const failed: string[] = [];
          // Phải chạy tuần tự vì mỗi addTask đọc rồi ghi cùng một JSON state.
          for (const reference of references) {
            try {
              const task = await taskService.addTask(
                ctx.message.telegramId,
                reference
              );
              added.push(
                `✅ ${task.contestId}${task.index} - ${task.name} — ${formatRating(task.rating, task.ratingSource)}`
              );
            } catch (error) {
              const message =
                error instanceof Error ? error.message.replace(/\s*\n\s*/g, " ") : String(error);
              failed.push(`❌ ${reference}: ${message}`);
            }
          }
          return [
            `📦 Bulk add: ${added.length} thành công, ${failed.length} lỗi.`,
            ...added,
            ...failed,
          ].join("\n");
        }

        const query = rest.join(" ").trim();
        if (!query) {
          throw new ValidationError(
            "Cú pháp: /task add <problem>. Chỉ nhận bài có rating >= 1600."
          );
        }
        const task = await taskService.addTask(ctx.message.telegramId, query);
        return (
          `➕ Đã thêm task ${task.contestId}${task.index} - ${task.name}.\n` +
          `Difficulty: ${formatRating(task.rating, task.ratingSource)}\n` +
          `${taskService.problemUrl(task)}\n` +
          "Nếu bài đã AC trước khi thêm, /refresh vẫn dùng submission OK đầu tiên để tính gate."
        );
      }
      if (sub === "list") {
        const includeSolved = rest.some((arg) => arg.toLowerCase() === "all");
        const archivedOnly = rest.some((arg) => arg.toLowerCase() === "archived");
        if (includeSolved && archivedOnly) {
          throw new ValidationError("Chỉ chọn một mode: all hoặc archived.");
        }
        const tagArgs = rest.filter(
          (arg) => !["all", "archived"].includes(arg.toLowerCase())
        );
        if (tagArgs.length > 1) {
          throw new ValidationError("Cú pháp: /task list [all] [tag]");
        }
        await taskService.refreshRatings(ctx.message.telegramId);
        return formatTaskList(
          taskService,
          ctx.message.telegramId,
          includeSolved || archivedOnly,
          tagArgs[0],
          archivedOnly
        );
      }
      if (sub === "tagedit") {
        if (rest.length === 0) {
          return buildTaskTagPickerReply(taskService, ctx.message.telegramId);
        }
        const [problemReference, operationOrTag, ...tagParts] = rest;
        let action: "add" | "remove" | "clear" = "add";
        let tag: string | undefined;
        if (operationOrTag?.toLowerCase() === "clear") {
          if (tagParts.length > 0) throw new ValidationError("Cú pháp: /task tagedit <problemId> clear");
          action = "clear";
        } else if (operationOrTag?.toLowerCase() === "remove") {
          action = "remove";
          tag = tagParts.join(" ");
        } else {
          tag = [operationOrTag, ...tagParts].filter(Boolean).join(" ");
        }
        if (action !== "clear" && !tag) {
          throw new ValidationError("Cú pháp: /task tagedit <problemId> <tag>");
        }
        const task = taskService.editTaskTag(
          ctx.message.telegramId,
          problemReference,
          action,
          tag
        );
        const tags = (task.tags ?? []).map((value) => `#${value}`).join(" ") || "không còn tag";
        return `🏷 ${task.contestId}${task.index}: ${tags}.`;
      }
      if (sub === "tag") {
        const [action, rawTag, problemReference, ...extra] = rest;
        if (extra.length > 0) {
          throw new ValidationError("Cú pháp: /task tag add|edit|remove|list ...");
        }
        if (action === "list") {
          if (rawTag || problemReference) throw new ValidationError("Cú pháp: /task tag list");
          const tasks = taskService.listTasks(ctx.message.telegramId);
          if (tasks.length === 0) return "📋 Chưa có problem nào trong task list.";
          return [
            "🏷 Problem → tags",
            ...tasks.map((task) => {
              const tags = (task.tags ?? []).map((tag) => `#${tag}`).join(", ") || "không có tag";
              return `• ${task.contestId}${task.index} — ${task.name}\n  ${tags}`;
            }),
          ].join("\n");
        }
        if (action === "add") {
          if (problemReference) throw new ValidationError("Cú pháp: /task tag add [tag]");
          if (!rawTag) return buildCreateTagPrompt();
          const tag = taskService.createTag(ctx.message.telegramId, rawTag);
          return buildTagEditorReply(taskService, ctx.message.telegramId, tag);
        }
        if (action === "edit") {
          if (problemReference) throw new ValidationError("Cú pháp: /task tag edit [tag]");
          if (!rawTag) return buildTagSelectorReply(taskService, ctx.message.telegramId, "edit");
          return buildTagEditorReply(
            taskService,
            ctx.message.telegramId,
            rawTag.replace(/^#/, "").toLocaleLowerCase()
          );
        }
        if (action === "remove") {
          if (!rawTag) return buildTagSelectorReply(taskService, ctx.message.telegramId, "remove");
          const tag = rawTag.replace(/^#/, "").toLocaleLowerCase();
          if (problemReference) {
            const task = taskService.editTaskTag(
              ctx.message.telegramId,
              problemReference,
              "remove",
              tag
            );
            return `➖ Đã gỡ #${tag} khỏi ${task.contestId}${task.index}.`;
          }
          return buildTagRemoveReply(taskService, ctx.message.telegramId, tag);
        }
        throw new ValidationError(
          "Cú pháp: /task tag add [tag]|edit [tag]|remove [tag] [problemId]|list"
        );
      }
      if (sub === "remove") {
        if (rest.length !== 1) throw new ValidationError("Cú pháp: /task remove <problemId|url>");
        const removed = taskService.removeTask(ctx.message.telegramId, rest[0]);
        return `🗑 Đã xóa task active ${removed.contestId}${removed.index}.`;
      }
      if (sub === "clear") {
        const confirmIndex = rest.findIndex((value) => value.toUpperCase() === "CONFIRM");
        if (confirmIndex < 0) throw new ValidationError("Cú pháp: /task clear [tag] CONFIRM");
        const tag = rest.filter((_, index) => index !== confirmIndex)[0];
        if (rest.filter((_, index) => index !== confirmIndex).length > 1) {
          throw new ValidationError("Cú pháp: /task clear [tag] CONFIRM");
        }
        const removed = taskService.clearActiveTasks(ctx.message.telegramId, tag);
        return `🧹 Đã xóa ${removed} task active${tag ? ` thuộc #${tag.replace(/^#/, "")}` : ""}.`;
      }
      if (sub === "archive") {
        if (rest.length > 1) throw new ValidationError("Cú pháp: /task archive [problemId|url]");
        const count = taskService.archiveSolvedTasks(ctx.message.telegramId, rest[0]);
        return `🗄 Đã archive ${count} task đã AC. Dữ liệu solvedAt vẫn được giữ để tính gate.`;
      }
      if (sub === "status") {
        const focusStatus = focusService?.status();
        const inSleep = !!(
          focusStatus?.sleepUnlock.withinTimeRange && focusStatus.sleepUnlock.sessionStartedAt
        );
        const gate = taskService.getDailyGateStatus(
          ctx.message.telegramId,
          inSleep
            ? { since: focusStatus!.sleepUnlock.sessionStartedAt, requiredCount: 3 }
            : { requiredCount: 7 }
        );
        const tasks = taskService.listTasks(ctx.message.telegramId);
        const active = tasks.filter((task) => task.status === "active" && !task.archivedAt);
        const solved = tasks.filter((task) => task.status === "solved" && !task.archivedAt);
        const archived = tasks.filter((task) => !!task.archivedAt);
        const tags = taskService.listTags(ctx.message.telegramId);
        return [
          `📊 Task status (${gate.date})`,
          `Task: ${active.length} active, ${solved.length} đã AC, ${archived.length} archived`,
          `Tags: ${tags.length ? tags.map((tag) => `#${tag}`).join(", ") : "chưa có"}`,
          `Break: ${gate.acceptedSinceLastBreak}/${gate.breakRequiredCount}${gate.breakAllowed ? " ✅" : " ⏳"}`,
          `${inSleep ? "Sleep Focus off" : "Daily Focus off"}: ${gate.focusOffAcceptedCount}/${gate.focusOffRequiredCount}${gate.focusOffAllowed ? " ✅" : " ⏳"}`,
        ].join("\n");
      }

      throw new ValidationError(
        "Cú pháp: /task add ...|list ...|tag add|edit|remove|list ...|tagedit ..."
      );
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
      const mode = ctx.effectiveArgs[0]?.toLowerCase();
      if (ctx.effectiveArgs.length > 1 || (mode && mode !== "full")) {
        throw new ValidationError("Cú pháp: /refresh [full]");
      }
      const result = await taskService.refresh(ctx.message.telegramId, { full: mode === "full" });
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
        `⚙️ Submission sync: ${result.syncMode === "full" ? "full history" : "incremental cache"}.`,
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
