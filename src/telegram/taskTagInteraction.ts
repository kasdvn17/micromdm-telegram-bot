import TelegramBot from "node-telegram-bot-api";
import {
  CodeforcesTask,
  CodeforcesTaskServiceApi,
} from "../services/codeforcesTaskService";
import { CommandResponse } from "../types/command.types";
import { formatError } from "./replyFormatter";
import { getLogger } from "../utils/logger";
import { createHash, randomBytes } from "node:crypto";

const PAGE_SIZE = 8;
const TASK_LIST_PAGE_SIZE = 6;
const CALLBACK_PREFIX = "cft";
const REPLY_MARKER = "TAGEDIT";
const CREATE_TAG_MARKER = "TAGCREATE";
const BULK_TAG_CREATE_MARKER = "BULKTAGCREATE";
const BULK_TAG_TTL_MS = 15 * 60 * 1000;

interface BulkTagSession {
  telegramId: number;
  problemIds: string[];
  expiresAt: number;
}

const bulkTagSessions = new Map<string, BulkTagSession>();

function problemId(task: Pick<CodeforcesTask, "contestId" | "index">): string {
  return `${task.contestId}${task.index}`;
}

function tagSummary(task: CodeforcesTask): string {
  return (task.tags ?? []).map((tag) => `#${tag}`).join(" ") || "chưa có tag";
}

function codeforcesTagSummary(task: CodeforcesTask): string {
  return (task.codeforcesTags ?? []).join(", ") || "chưa đồng bộ";
}

function taskMatchesTag(task: CodeforcesTask, tag?: string): boolean {
  if (!tag) return true;
  const normalized = tag.replace(/^#/, "").trim().toLocaleLowerCase();
  return (task.tags ?? []).some((value) => value.toLocaleLowerCase() === normalized) ||
    (task.codeforcesTags ?? []).some((value) => value.toLocaleLowerCase() === normalized);
}

function tagToken(tag: string): string {
  return createHash("sha256").update(tag).digest("hex").slice(0, 12);
}

function resolveTagToken(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  token: string
): string {
  const tag = taskService.listTags(telegramId).find((value) => tagToken(value) === token);
  if (!tag) throw new Error("Tag không còn tồn tại.");
  return tag;
}

function resolveTaskFilterTagToken(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  token: string
): string | undefined {
  if (token === "-") return undefined;
  const tags = [...new Set([
    ...taskService.listTags(telegramId),
    ...taskService.listCodeforcesTags(telegramId, false),
  ])];
  const tag = tags.find((value) => tagToken(value) === token);
  if (!tag) throw new Error("Tag lọc không còn tồn tại trong task active.");
  return tag;
}

function createBulkTagSession(
  telegramId: number,
  tasks: readonly Pick<CodeforcesTask, "contestId" | "index">[]
): string {
  const now = Date.now();
  for (const [token, session] of bulkTagSessions) {
    if (session.expiresAt <= now) bulkTagSessions.delete(token);
  }
  const token = randomBytes(6).toString("hex");
  bulkTagSessions.set(token, {
    telegramId,
    problemIds: [...new Set(tasks.map(problemId))],
    expiresAt: now + BULK_TAG_TTL_MS,
  });
  return token;
}

function getBulkTagSession(token: string, telegramId: number): BulkTagSession {
  const session = bulkTagSessions.get(token);
  if (!session || session.telegramId !== telegramId || session.expiresAt <= Date.now()) {
    bulkTagSessions.delete(token);
    throw new Error("Phiên gắn tag đã hết hạn. Hãy chạy lại /task add bulk.");
  }
  return session;
}

function assignBulkTag(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  session: BulkTagSession,
  tag: string
): { assigned: number; failed: number } {
  let assigned = 0;
  let failed = 0;
  for (const id of session.problemIds) {
    try {
      taskService.editTaskTag(telegramId, id, "add", tag);
      assigned += 1;
    } catch {
      failed += 1;
    }
  }
  return { assigned, failed };
}

export function buildBulkTagPrompt(
  summaryText: string,
  telegramId: number,
  tasks: readonly Pick<CodeforcesTask, "contestId" | "index">[]
): CommandResponse {
  if (tasks.length === 0) return summaryText;
  const token = createBulkTagSession(telegramId, tasks);
  return {
    text: `${summaryText}\n\n🏷 Gắn ${tasks.length} bài vừa thêm vào cùng một tag?`,
    options: {
      reply_markup: {
        inline_keyboard: [[
          { text: "Yes", callback_data: `${CALLBACK_PREFIX}:by:${token}` },
          { text: "No", callback_data: `${CALLBACK_PREFIX}:bn:${token}` },
        ]],
      },
    },
  };
}

type TaskListMode = "active" | "all" | "solved" | "archived";

function formatSolvedAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function taskListPage(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  mode: TaskListMode,
  requestedPage: number,
  tag?: string
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } {
  const normalizedTag = tag?.replace(/^#/, "").toLocaleLowerCase();
  const all = taskService.listTasks(telegramId)
    .filter((task) => mode === "archived" ? !!task.archivedAt : !task.archivedAt)
    .filter((task) => mode !== "active" || task.status === "active")
    .filter((task) => mode !== "solved" || task.status === "solved")
    .filter((task) => taskMatchesTag(task, normalizedTag))
    .sort((a, b) => {
      const priorityOrder = Number(!!b.prioritizedAt) - Number(!!a.prioritizedAt);
      if (priorityOrder) return priorityOrder;
      if (mode !== "solved") return 0;
      return new Date(b.solvedAt ?? 0).getTime() - new Date(a.solvedAt ?? 0).getTime();
    });
  const totalPages = Math.max(1, Math.ceil(all.length / TASK_LIST_PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const visible = all.slice(page * TASK_LIST_PAGE_SIZE, (page + 1) * TASK_LIST_PAGE_SIZE);
  const modeCode = mode === "active" ? "v" : mode === "all" ? "a" : mode === "solved" ? "s" : "r";
  const token = normalizedTag ? tagToken(normalizedTag) : "-";
  const rows: TelegramBot.InlineKeyboardButton[][] = visible.map((task) => [{
    text: `${task.prioritizedAt ? "📌" : task.status === "solved" ? "✅" : "⏳"} ${problemId(task)} · ${task.rating ?? "?"} · ${task.name}`.slice(0, 60),
    url: taskService.problemUrl(task),
  }]);
  if (totalPages > 1) {
    rows.push([
      ...(page > 0 ? [{ text: "‹ Trước", callback_data: `${CALLBACK_PREFIX}:tl:${modeCode}:${page - 1}:${token}` }] : []),
      { text: `${page + 1}/${totalPages}`, callback_data: `${CALLBACK_PREFIX}:noop` },
      ...(page + 1 < totalPages ? [{ text: "Sau ›", callback_data: `${CALLBACK_PREFIX}:tl:${modeCode}:${page + 1}:${token}` }] : []),
    ]);
  }
  rows.push([
    { text: "Active", callback_data: `${CALLBACK_PREFIX}:tl:v:0:${token}` },
    { text: "Solved", callback_data: `${CALLBACK_PREFIX}:tl:s:0:${token}` },
  ]);
  rows.push([
    { text: "All", callback_data: `${CALLBACK_PREFIX}:tl:a:0:${token}` },
    { text: "Archived", callback_data: `${CALLBACK_PREFIX}:tl:r:0:${token}` },
  ]);
  return {
    text: [
      `📋 Tasks · ${mode}${normalizedTag ? ` · #${normalizedTag}` : ""}`,
      `${all.length} problem · trang ${page + 1}/${totalPages}`,
      ...(visible.length ? visible.map((task) => {
        const userTags = (task.tags ?? []).map((value) => `#${value}`).join(" ") || "—";
        return [
          `${task.prioritizedAt ? "📌" : task.status === "solved" ? "✅" : "⏳"} ${problemId(task)} — ${task.name} — ${task.rating ?? "Unrated"}`,
          ...(task.solvedAt ? [`   🕒 AC: ${formatSolvedAt(task.solvedAt)}`] : []),
          `   👤 ${userTags} · CF: ${codeforcesTagSummary(task)}`,
        ].join("\n");
      }) : ["Không có task phù hợp."]),
    ].join("\n"),
    reply_markup: { inline_keyboard: rows },
  };
}

export function buildTaskListReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  options: { mode?: TaskListMode; tag?: string } = {}
): CommandResponse {
  const normalizedTag = options.tag?.replace(/^#/, "").toLocaleLowerCase();
  const availableTags = new Set([
    ...taskService.listTags(telegramId),
    ...taskService.listCodeforcesTags(telegramId, false),
  ]);
  if (normalizedTag && !availableTags.has(normalizedTag)) {
    return `⚠️ Không tìm thấy tag #${normalizedTag}.`;
  }
  const result = taskListPage(taskService, telegramId, options.mode ?? "active", 0, options.tag);
  return { text: result.text, options: { reply_markup: result.reply_markup } };
}

function rowsOf<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export function buildNextTaskFilterReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  shuffle = false
): CommandResponse {
  const active = taskService.listTasks(telegramId).filter(
    (task) => task.status === "active" && !task.archivedAt
  );
  if (!active.length) return "📋 Không còn task active.";
  const userTags = taskService.listTags(telegramId).filter((tag) =>
    active.some((task) => taskMatchesTag(task, tag))
  );
  const codeforcesTags = taskService.listCodeforcesTags(telegramId).filter(
    (tag) => !userTags.includes(tag)
  );
  const mode = shuffle ? "s" : "n";
  const tagButtons: TelegramBot.InlineKeyboardButton[] = [
    { text: "Tất cả tags", callback_data: `${CALLBACK_PREFIX}:nf:${mode}:-` },
    ...userTags.map((tag) => ({
      text: `👤 #${tag}`,
      callback_data: `${CALLBACK_PREFIX}:nf:${mode}:${tagToken(tag)}`,
    })),
    ...codeforcesTags.map((tag) => ({
      text: `CF · ${tag}`,
      callback_data: `${CALLBACK_PREFIX}:nf:${mode}:${tagToken(tag)}`,
    })),
  ];
  return {
    text: [
      shuffle ? "🔀 Shuffle task" : "🎯 Chọn task tiếp theo",
      "Bước 1/2: chọn tag muốn luyện.",
      "👤 = tag tự tạo · CF = tag chính thức Codeforces",
    ].join("\n"),
    options: { reply_markup: { inline_keyboard: rowsOf(tagButtons, 2) } },
  };
}

function prioritizeTaskPage(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  requestedPage: number
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } | null {
  const active = taskService.listTasks(telegramId).filter(
    (task) => task.status === "active" && !task.archivedAt
  );
  if (!active.length) return null;
  const totalPages = Math.max(1, Math.ceil(active.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const visible = active.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const rows: TelegramBot.InlineKeyboardButton[][] = visible.map((task) => [{
    text: `${task.prioritizedAt ? "📌" : "○"} ${problemId(task)} · ${task.rating ?? "?"} · ${task.name}`.slice(0, 60),
    callback_data: `${CALLBACK_PREFIX}:ps:${page}:${task.contestId}:${task.index}`,
  }]);
  if (totalPages > 1) {
    rows.push([
      ...(page > 0
        ? [{ text: "‹ Trước", callback_data: `${CALLBACK_PREFIX}:pp:${page - 1}` }]
        : []),
      { text: `${page + 1}/${totalPages}`, callback_data: `${CALLBACK_PREFIX}:noop` },
      ...(page + 1 < totalPages
        ? [{ text: "Sau ›", callback_data: `${CALLBACK_PREFIX}:pp:${page + 1}` }]
        : []),
    ]);
  }
  if (active.some((task) => !!task.prioritizedAt)) {
    rows.push([{ text: "✖ Bỏ prioritize", callback_data: `${CALLBACK_PREFIX}:pc` }]);
  }
  return {
    text: "📌 Chọn một task cần làm trước các task khác:",
    reply_markup: { inline_keyboard: rows },
  };
}

export function buildPrioritizeTaskReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number
): CommandResponse {
  const result = prioritizeTaskPage(taskService, telegramId, 0);
  if (!result) return "📋 Không có task active để prioritize.";
  return { text: result.text, options: { reply_markup: result.reply_markup } };
}

function nextRatingPicker(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  tag: string | undefined,
  shuffle: boolean
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } {
  const ratings = [...new Set(
    taskService.listTasks(telegramId)
      .filter((task) => task.status === "active" && !task.archivedAt && taskMatchesTag(task, tag))
      .flatMap((task) => Number.isFinite(task.rating) ? [task.rating!] : [])
  )].sort((a, b) => a - b);
  if (!ratings.length) throw new Error("Không có task rated phù hợp tag đã chọn.");
  const mode = shuffle ? "s" : "n";
  const token = tag ? tagToken(tag) : "-";
  const buttons = ratings.map((rating) => ({
    text: `≥ ${rating}`,
    callback_data: `${CALLBACK_PREFIX}:nm:${mode}:${token}:${rating}`,
  }));
  return {
    text: `${shuffle ? "🔀" : "🎯"} ${tag ? `Tag: ${tag}` : "Tất cả tags"}\nBước 2/2: chọn rating tối thiểu.`,
    reply_markup: {
      inline_keyboard: [
        ...rowsOf(buttons, 3),
        [{ text: "‹ Chọn lại tag", callback_data: `${CALLBACK_PREFIX}:ni:${mode}` }],
      ],
    },
  };
}

export function buildNextTaskResultReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  options: { tag?: string; minRating?: number; maxRating?: number; shuffle?: boolean; excludeProblem?: string }
): CommandResponse {
  const task = taskService.nextTask(telegramId, options);
  const token = options.tag ? tagToken(options.tag) : "-";
  const min = options.minRating ?? 0;
  return {
    text: [
      `${options.shuffle ? "🔀" : "🎯"} ${task.contestId}${task.index} — ${task.name}`,
      ...(task.prioritizedAt ? ["📌 Task đang được prioritize"] : []),
      `Rating: ${task.rating ?? "Unrated"}`,
      `👤 Tags: ${tagSummary(task)}`,
      `🏷 Codeforces: ${codeforcesTagSummary(task)}`,
      taskService.problemUrl(task),
    ].join("\n"),
    options: {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔗 Mở Codeforces", url: taskService.problemUrl(task) }],
          [{
            text: "🔀 Shuffle bài khác",
            callback_data: `${CALLBACK_PREFIX}:nm:s:${token}:${min}:${task.contestId}:${task.index}`,
          }],
          [{
            text: "⚙️ Chọn lại bộ lọc",
            callback_data: `${CALLBACK_PREFIX}:ni:${options.shuffle ? "s" : "n"}`,
          }],
        ],
      },
    },
  };
}

function bulkTagSelector(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  token: string,
  taskCount: number
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } {
  const tags = taskService.listTags(telegramId);
  return {
    text: `🏷 Chọn tag cho ${taskCount} bài vừa thêm:`,
    reply_markup: {
      inline_keyboard: [
        ...tags.map((tag) => [{
          text: `#${tag}`,
          callback_data: `${CALLBACK_PREFIX}:bt:${token}:${tagToken(tag)}`,
        }]),
        [{ text: "➕ Tạo tag mới", callback_data: `${CALLBACK_PREFIX}:bc:${token}` }],
      ],
    },
  };
}

function tagEditor(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  tag: string,
  requestedPage: number
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } {
  const tasks = taskService.listTasks(telegramId);
  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const token = tagToken(tag);
  const rows: TelegramBot.InlineKeyboardButton[][] = tasks
    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    .map((task) => {
      const selected = (task.tags ?? []).includes(tag);
      return [{
        text: `${selected ? "✅" : "❌"} ${problemId(task)} · ${task.name}`.slice(0, 60),
        callback_data: `${CALLBACK_PREFIX}:gt:${page}:${task.contestId}:${task.index}:${token}`,
      }];
    });
  if (totalPages > 1) {
    rows.push([
      ...(page > 0
        ? [{ text: "‹ Trước", callback_data: `${CALLBACK_PREFIX}:ge:${page - 1}:${token}` }]
        : []),
      { text: `${page + 1}/${totalPages}`, callback_data: `${CALLBACK_PREFIX}:noop` },
      ...(page + 1 < totalPages
        ? [{ text: "Sau ›", callback_data: `${CALLBACK_PREFIX}:ge:${page + 1}:${token}` }]
        : []),
    ]);
  }
  return {
    text: `🏷 Edit #${tag}\n✅ Có tag · ❌ Chưa có tag\nBấm problem để toggle.`,
    reply_markup: { inline_keyboard: rows },
  };
}

function tagRemovePicker(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  tag: string,
  requestedPage: number
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } {
  const tasks = taskService.listTasks(telegramId).filter((task) => (task.tags ?? []).includes(tag));
  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const token = tagToken(tag);
  const rows: TelegramBot.InlineKeyboardButton[][] = tasks
    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    .map((task) => [{
      text: `➖ Chỉ gỡ ${problemId(task)} · ${task.name}`.slice(0, 60),
      callback_data: `${CALLBACK_PREFIX}:go:${page}:${task.contestId}:${task.index}:${token}`,
    }]);
  if (totalPages > 1) {
    rows.push([
      ...(page > 0
        ? [{ text: "‹ Trước", callback_data: `${CALLBACK_PREFIX}:gr:${page - 1}:${token}` }]
        : []),
      { text: `${page + 1}/${totalPages}`, callback_data: `${CALLBACK_PREFIX}:noop` },
      ...(page + 1 < totalPages
        ? [{ text: "Sau ›", callback_data: `${CALLBACK_PREFIX}:gr:${page + 1}:${token}` }]
        : []),
    ]);
  }
  rows.push([{
    text: `🗑 Xóa #${tag} khỏi toàn bộ ${tasks.length} bài`,
    callback_data: `${CALLBACK_PREFIX}:ga:${token}`,
  }]);
  return {
    text: `🏷 Remove #${tag}\nChọn một problem để chỉ gỡ khỏi bài đó, hoặc xóa tag khỏi toàn bộ problem.`,
    reply_markup: { inline_keyboard: rows },
  };
}

export function buildTagEditorReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  tag: string
): CommandResponse {
  if (!taskService.listTags(telegramId).includes(tag)) return `⚠️ Không tìm thấy tag #${tag}.`;
  if (taskService.listTasks(telegramId).length === 0) {
    return `🏷 Tag #${tag} đã tồn tại, nhưng task list chưa có problem để gắn.`;
  }
  const result = tagEditor(taskService, telegramId, tag, 0);
  return { text: result.text, options: { reply_markup: result.reply_markup } };
}

export function buildTagRemoveReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  tag: string
): CommandResponse {
  if (!taskService.listTags(telegramId).includes(tag)) return `⚠️ Không tìm thấy tag #${tag}.`;
  const result = tagRemovePicker(taskService, telegramId, tag, 0);
  return { text: result.text, options: { reply_markup: result.reply_markup } };
}

export function buildTagSelectorReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  mode: "edit" | "remove"
): CommandResponse {
  const tags = taskService.listTags(telegramId);
  if (tags.length === 0) return "📋 Chưa có tag nào. Dùng /task tag add <tag>.";
  const action = mode === "edit" ? "ge" : "gr";
  return {
    text: `🏷 Chọn tag cần ${mode === "edit" ? "edit" : "remove"}:`,
    options: {
      reply_markup: {
        inline_keyboard: tags.map((tag) => [{
          text: `#${tag}`,
          callback_data: `${CALLBACK_PREFIX}:${action}:0:${tagToken(tag)}`,
        }]),
      },
    },
  };
}

export function buildCreateTagPrompt(): CommandResponse {
  return {
    text: `${CREATE_TAG_MARKER}\nNhập tên tag mới (1-24 ký tự, không có khoảng trắng):`,
    options: { reply_markup: { force_reply: true, selective: true } },
  };
}

function picker(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number,
  requestedPage: number
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } | null {
  const tasks = taskService.listTasks(telegramId);
  if (tasks.length === 0) return null;
  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const visible = tasks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const rows: TelegramBot.InlineKeyboardButton[][] = visible.map((task) => [
    {
      text: `${task.status === "solved" ? "✅" : "⏳"} ${problemId(task)} · ${task.name}`.slice(0, 60),
      callback_data: `${CALLBACK_PREFIX}:s:${page}:${task.contestId}:${task.index}`,
    },
  ]);
  if (totalPages > 1) {
    rows.push([
      ...(page > 0
        ? [{ text: "‹ Trước", callback_data: `${CALLBACK_PREFIX}:p:${page - 1}` }]
        : []),
      { text: `${page + 1}/${totalPages}`, callback_data: `${CALLBACK_PREFIX}:noop` },
      ...(page + 1 < totalPages
        ? [{ text: "Sau ›", callback_data: `${CALLBACK_PREFIX}:p:${page + 1}` }]
        : []),
    ]);
  }
  return {
    text: `🏷 Chọn problem cần chỉnh tag (${tasks.length} task):`,
    reply_markup: { inline_keyboard: rows },
  };
}

export function buildTaskTagPickerReply(
  taskService: CodeforcesTaskServiceApi,
  telegramId: number
): CommandResponse {
  const result = picker(taskService, telegramId, 0);
  if (!result) return "📋 Chưa có task Codeforces nào để gắn tag.";
  return { text: result.text, options: { reply_markup: result.reply_markup } };
}

function taskDetail(
  task: CodeforcesTask,
  page: number
): { text: string; reply_markup: TelegramBot.InlineKeyboardMarkup } {
  const id = problemId(task);
  const rows: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: "➕ Gán tag mới", callback_data: `${CALLBACK_PREFIX}:n:${page}:${task.contestId}:${task.index}` }],
    ...(task.tags ?? []).map((tag) => [
      { text: `✖ Gỡ #${tag}`, callback_data: `${CALLBACK_PREFIX}:r:${page}:${task.contestId}:${task.index}:${tagToken(tag)}` },
    ]),
    [{ text: "🧹 Xóa toàn bộ tags", callback_data: `${CALLBACK_PREFIX}:c:${page}:${task.contestId}:${task.index}` }],
    [{ text: "‹ Quay lại problem list", callback_data: `${CALLBACK_PREFIX}:p:${page}` }],
  ];
  return {
    text: `🏷 ${id} — ${task.name}\n👤 Tags: ${tagSummary(task)}\n🏷 Codeforces: ${codeforcesTagSummary(task)}`,
    reply_markup: { inline_keyboard: rows },
  };
}

export function attachTaskTagInteraction(
  bot: TelegramBot,
  taskService: CodeforcesTaskServiceApi,
  authorizedUsername: string,
  authorizedTelegramUserId?: number
): void {
  const authorized = authorizedUsername.toLowerCase().replace(/^@/, "");
  const isAuthorized = (username?: string, telegramId?: number): boolean =>
    authorizedTelegramUserId !== undefined
      ? telegramId === authorizedTelegramUserId
      : !!username && username.toLowerCase().replace(/^@/, "") === authorized;

  bot.on("callback_query", (query) => {
    void (async () => {
      const data = query.data;
      if (!data?.startsWith(`${CALLBACK_PREFIX}:`)) return;
      if (!isAuthorized(query.from.username, query.from.id)) {
        await bot.answerCallbackQuery(query.id, { text: "Bạn không có quyền.", show_alert: true });
        return;
      }
      const message = query.message;
      if (!message) return;
      const parts = data.split(":");
      const action = parts[1];
      const telegramId = query.from.id;
      try {
        if (action === "noop") {
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (action === "pp" || action === "ps" || action === "pc") {
          let page = action === "pp" ? Number(parts[2]) : 0;
          let answer: string | undefined;
          if (action === "ps") {
            page = Number(parts[2]);
            const task = taskService.prioritizeTask(telegramId, `${parts[3]}${parts[4]}`);
            answer = `Đã prioritize ${problemId(task)}.`;
          }
          if (action === "pc") {
            taskService.clearPrioritizedTask(telegramId);
            answer = "Đã bỏ prioritize.";
          }
          const result = prioritizeTaskPage(taskService, telegramId, page);
          await bot.editMessageText(result?.text ?? "📋 Không có task active để prioritize.", {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: result?.reply_markup,
          });
          await bot.answerCallbackQuery(query.id, { text: answer });
          return;
        }
        if (action === "ni") {
          const reply = buildNextTaskFilterReply(taskService, telegramId, parts[2] === "s");
          if (typeof reply === "string") {
            await bot.editMessageText(reply, {
              chat_id: message.chat.id,
              message_id: message.message_id,
            });
          } else {
            await bot.editMessageText(reply.text, {
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: reply.options?.reply_markup && "inline_keyboard" in reply.options.reply_markup
                ? reply.options.reply_markup
                : undefined,
            });
          }
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (action === "nf") {
          const shuffle = parts[2] === "s";
          const tag = resolveTaskFilterTagToken(taskService, telegramId, parts[3]);
          const result = nextRatingPicker(taskService, telegramId, tag, shuffle);
          await bot.editMessageText(result.text, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: result.reply_markup,
          });
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (action === "nm") {
          const shuffle = parts[2] === "s";
          const tag = resolveTaskFilterTagToken(taskService, telegramId, parts[3]);
          const minRating = Number(parts[4]);
          const previous = parts[5] && parts[6] ? `${parts[5]}${parts[6]}` : undefined;
          const reply = buildNextTaskResultReply(taskService, telegramId, {
            tag,
            minRating,
            shuffle,
            excludeProblem: previous,
          });
          if (typeof reply === "string") throw new Error(reply);
          await bot.editMessageText(reply.text, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: reply.options?.reply_markup && "inline_keyboard" in reply.options.reply_markup
              ? reply.options.reply_markup
              : undefined,
          });
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (["by", "bn", "bt", "bc"].includes(action)) {
          const sessionToken = parts[2];
          const session = getBulkTagSession(sessionToken, telegramId);
          if (action === "bn") {
            bulkTagSessions.delete(sessionToken);
            await bot.editMessageText(`${message.text ?? "📦 Bulk add hoàn tất."}\n\nĐã bỏ qua gắn tag.`, {
              chat_id: message.chat.id,
              message_id: message.message_id,
            });
            await bot.answerCallbackQuery(query.id, { text: "Đã hủy gắn tag." });
            return;
          }
          if (action === "by") {
            const result = bulkTagSelector(
              taskService,
              telegramId,
              sessionToken,
              session.problemIds.length
            );
            await bot.editMessageText(result.text, {
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: result.reply_markup,
            });
            await bot.answerCallbackQuery(query.id);
            return;
          }
          if (action === "bc") {
            await bot.sendMessage(
              message.chat.id,
              `${BULK_TAG_CREATE_MARKER} ${sessionToken}\nNhập tên tag mới cho ${session.problemIds.length} bài (1-24 ký tự, không có khoảng trắng):`,
              { reply_markup: { force_reply: true, selective: true } }
            );
            await bot.answerCallbackQuery(query.id);
            return;
          }
          const tag = resolveTagToken(taskService, telegramId, parts[3]);
          const result = assignBulkTag(taskService, telegramId, session, tag);
          bulkTagSessions.delete(sessionToken);
          await bot.editMessageText(
            `🏷 Đã gắn #${tag} cho ${result.assigned} bài.${result.failed ? ` ${result.failed} bài không còn trong task list.` : ""}`,
            { chat_id: message.chat.id, message_id: message.message_id }
          );
          await bot.answerCallbackQuery(query.id, { text: "Đã gắn tag." });
          return;
        }
        if (action === "sa") {
          const reference = `${parts[2]}${parts[3]}`;
          await bot.answerCallbackQuery(query.id, { text: `Đang thêm ${reference}...` });
          const task = await taskService.addTask(telegramId, reference);
          const remainingRows = (message.reply_markup?.inline_keyboard ?? []).filter(
            (row) => !row.some((button) => button.callback_data === data)
          );
          await bot.editMessageText(
            `${message.text ?? "💡 Gợi ý"}\n\n✅ Đã thêm ${problemId(task)} — ${task.name}.`,
            {
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: { inline_keyboard: remainingRows },
            }
          );
          return;
        }
        if (action === "sx") {
          await bot.answerCallbackQuery(query.id, { text: "Đang thêm tất cả..." });
          const references = (parts[2] ?? "").split(",").filter(Boolean);
          const added: string[] = [];
          const failed: string[] = [];
          for (const reference of references) {
            try {
              const task = await taskService.addTask(telegramId, reference);
              added.push(problemId(task));
            } catch {
              failed.push(reference);
            }
          }
          await bot.editMessageText(
            `${message.text ?? "💡 Gợi ý"}\n\n✅ Đã thêm: ${added.join(", ") || "không có"}.${failed.length ? `\n❌ Lỗi/trùng: ${failed.join(", ")}.` : ""}`,
            { chat_id: message.chat.id, message_id: message.message_id }
          );
          return;
        }
        if (action === "tl") {
          const mode: TaskListMode = parts[2] === "a"
            ? "all"
            : parts[2] === "s"
              ? "solved"
              : parts[2] === "r"
                ? "archived"
                : "active";
          const tag = parts[4] && parts[4] !== "-"
            ? resolveTaskFilterTagToken(taskService, telegramId, parts[4])
            : undefined;
          const result = taskListPage(taskService, telegramId, mode, Number(parts[3]), tag);
          await bot.editMessageText(result.text, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: result.reply_markup,
          });
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (action === "p") {
          const result = picker(taskService, telegramId, Number(parts[2]));
          if (result) {
            await bot.editMessageText(result.text, {
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: result.reply_markup,
            });
          }
          await bot.answerCallbackQuery(query.id);
          return;
        }

        if (["ge", "gr", "gt", "go", "ga"].includes(action)) {
          if (action === "ga") {
            const tag = resolveTagToken(taskService, telegramId, parts[2]);
            const affected = taskService.removeTag(telegramId, tag);
            await bot.editMessageText(`🗑 Đã xóa #${tag} khỏi ${affected} problem và xóa tag.`, {
              chat_id: message.chat.id,
              message_id: message.message_id,
            });
            await bot.answerCallbackQuery(query.id, { text: "Đã xóa tag." });
            return;
          }
          const page = Number(parts[2]);
          const token = action === "ge" || action === "gr" ? parts[3] : parts[5];
          const tag = resolveTagToken(taskService, telegramId, token);
          if (action === "gt" || action === "go") {
            const id = `${parts[3]}${parts[4]}`;
            const task = taskService.listTasks(telegramId).find(
              (item) => problemId(item) === id
            );
            if (!task) throw new Error(`Không còn tìm thấy task ${id}.`);
            const hasTag = (task.tags ?? []).includes(tag);
            taskService.editTaskTag(
              telegramId,
              id,
              action === "go" || hasTag ? "remove" : "add",
              tag
            );
          }
          const result = action === "gr" || action === "go"
            ? tagRemovePicker(taskService, telegramId, tag, page)
            : tagEditor(taskService, telegramId, tag, page);
          await bot.editMessageText(result.text, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: result.reply_markup,
          });
          await bot.answerCallbackQuery(query.id, {
            text: action === "gt" ? "Đã toggle tag." : action === "go" ? "Đã gỡ khỏi problem." : undefined,
          });
          return;
        }

        const page = Number(parts[2]);
        const contestId = Number(parts[3]);
        const index = parts[4]?.toUpperCase();
        const id = `${contestId}${index}`;
        const findTask = (): CodeforcesTask | undefined =>
          taskService.listTasks(telegramId).find(
            (task) => task.contestId === contestId && task.index === index
          );

        if (action === "n") {
          await bot.sendMessage(
            message.chat.id,
            `${REPLY_MARKER} ${id}\nNhập tag mới cho ${id} (1-24 ký tự, không có khoảng trắng):`,
            { reply_markup: { force_reply: true, selective: true } }
          );
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (action === "r") {
          const tag = resolveTagToken(taskService, telegramId, parts[5]);
          taskService.editTaskTag(telegramId, id, "remove", tag);
        }
        if (action === "c") taskService.editTaskTag(telegramId, id, "clear");
        const task = findTask();
        if (!task) throw new Error(`Không còn tìm thấy task ${id}.`);
        const detail = taskDetail(task, page);
        await bot.editMessageText(detail.text, {
          chat_id: message.chat.id,
          message_id: message.message_id,
          reply_markup: detail.reply_markup,
        });
        await bot.answerCallbackQuery(query.id, {
          text: action === "r" ? "Đã gỡ tag." : action === "c" ? "Đã xóa tags." : undefined,
        });
      } catch (error) {
        getLogger().error("[taskTagInteraction] Callback lỗi", {
          error: error instanceof Error ? error.message : String(error),
        });
        await bot.answerCallbackQuery(query.id, {
          text: error instanceof Error ? error.message.slice(0, 180) : "Có lỗi xảy ra.",
          show_alert: true,
        });
      }
    })();
  });

  bot.on("message", (msg) => {
    void (async () => {
      const prompt = msg.reply_to_message?.text;
      const bulkCreateMatch = prompt?.match(new RegExp(`^${BULK_TAG_CREATE_MARKER}\\s+([a-f0-9]+)`));
      if (bulkCreateMatch && msg.text && isAuthorized(msg.from?.username, msg.from?.id)) {
        try {
          const sessionToken = bulkCreateMatch[1];
          const session = getBulkTagSession(sessionToken, msg.from!.id);
          const requestedTag = msg.text.trim().replace(/^#/, "").toLocaleLowerCase();
          const tag = taskService.listTags(msg.from!.id).find((value) => value === requestedTag)
            ?? taskService.createTag(msg.from!.id, msg.text);
          const result = assignBulkTag(taskService, msg.from!.id, session, tag);
          bulkTagSessions.delete(sessionToken);
          await bot.sendMessage(
            msg.chat.id,
            `🏷 Đã gắn #${tag} cho ${result.assigned} bài.${result.failed ? ` ${result.failed} bài không còn trong task list.` : ""}`
          );
        } catch (error) {
          await bot.sendMessage(msg.chat.id, formatError(error as Error));
        }
        return;
      }
      if (prompt?.startsWith(CREATE_TAG_MARKER) && msg.text && isAuthorized(msg.from?.username, msg.from?.id)) {
        try {
          const tag = taskService.createTag(msg.from!.id, msg.text);
          const reply = buildTagEditorReply(taskService, msg.from!.id, tag);
          if (typeof reply === "string") await bot.sendMessage(msg.chat.id, reply);
          else await bot.sendMessage(msg.chat.id, reply.text, reply.options);
        } catch (error) {
          await bot.sendMessage(msg.chat.id, formatError(error as Error));
        }
        return;
      }
      const match = prompt?.match(new RegExp(`^${REPLY_MARKER}\\s+(\\d+[A-Z][A-Z0-9]*)`));
      if (!match || !msg.text || !isAuthorized(msg.from?.username, msg.from?.id)) return;
      try {
        const task = taskService.editTaskTag(msg.from!.id, match[1], "add", msg.text);
        await bot.sendMessage(msg.chat.id, `🏷 ${problemId(task)}: ${tagSummary(task)}.`);
      } catch (error) {
        await bot.sendMessage(msg.chat.id, formatError(error as Error));
      }
    })();
  });
}
