import {
  CodeforcesProblem,
  CodeforcesProblemRatingSource,
  CodeforcesSubmission,
} from "../types/codeforces.types";
import { CodeforcesClient } from "../utils/codeforces";
import { ValidationError } from "../utils/errors";
import { readJsonState, writeJsonState } from "../utils/jsonStore";

export type CodeforcesTaskStatus = "active" | "solved";

export interface CodeforcesTask {
  contestId: number;
  index: string;
  name: string;
  status: CodeforcesTaskStatus;
  addedAt: string;
  solvedAt?: string;
  rating?: number;
  ratingSource?: CodeforcesProblemRatingSource;
  /** Một task có thể nằm trong nhiều nhóm; field optional để tương thích JSON cũ. */
  tags?: string[];
  archivedAt?: string;
}

interface UserTaskState {
  tasks: CodeforcesTask[];
  /** Registry cho phép tag tồn tại ngay cả khi chưa gắn vào problem nào. */
  tags?: string[];
  breakGate?: {
    date: string;
    lastBreakAt: string;
  };
  submissionSync?: {
    lastFullSyncAt: string;
    newestSubmissionId?: number;
    /** problemKey -> epoch seconds của submission OK đầu tiên. */
    firstAcceptedAt: Record<string, number>;
  };
}

interface CodeforcesTaskState {
  users: Record<string, UserTaskState>;
}

export interface RefreshResult {
  tasks: CodeforcesTask[];
  newlySolved: CodeforcesTask[];
  unavailablePublicProblems: CodeforcesTask[];
  ratingsUpdated: number;
  syncMode: "full" | "incremental";
}

export interface DailyCodeforcesGateStatus {
  date: string;
  focusOffAcceptedCount: number;
  acceptedSinceLastBreak: number;
  breakRequiredCount: number;
  focusOffRequiredCount: number;
  breakAllowed: boolean;
  focusOffAllowed: boolean;
}

export interface FocusOffGateOptions {
  since?: string;
  requiredCount?: number;
}

export interface CodeforcesTaskServiceOptions {
  now?: () => Date;
  timeZone?: string;
}

export interface CodeforcesTaskServiceApi {
  addTask(telegramId: number, problemQuery: string): Promise<CodeforcesTask>;
  addTasksAtomic(telegramId: number, problemReferences: readonly string[]): Promise<CodeforcesTask[]>;
  listTasks(telegramId: number): CodeforcesTask[];
  listTags(telegramId: number): string[];
  createTag(telegramId: number, tag: string): string;
  removeTag(telegramId: number, tag: string): number;
  editTaskTag(
    telegramId: number,
    problemReference: string,
    action: "add" | "remove" | "clear",
    tag?: string
  ): CodeforcesTask;
  removeTask(telegramId: number, problemReference: string): CodeforcesTask;
  clearActiveTasks(telegramId: number, tag?: string): number;
  archiveSolvedTasks(telegramId: number, problemReference?: string): number;
  refreshRatings(telegramId: number): Promise<number>;
  refresh(telegramId: number, options?: { full?: boolean }): Promise<RefreshResult>;
  getDailyGateStatus(
    telegramId: number,
    focusOffOptions?: FocusOffGateOptions
  ): DailyCodeforcesGateStatus;
  assertBreakAllowed(telegramId: number): void;
  recordBreakStarted(telegramId: number): void;
  assertFocusOffAllowed(telegramId: number, options?: FocusOffGateOptions): void;
  problemUrl(task: Pick<CodeforcesTask, "contestId" | "index">): string;
}

const BREAK_REQUIRED_NEW_AC = 1;
const FOCUS_OFF_REQUIRED_DAILY_AC = 7;
const MIN_TASK_RATING_INCLUSIVE = 1600;
const FULL_SUBMISSION_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

function localDateStr(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function problemKey(contestId: number, index: string): string {
  return `${contestId}:${index.trim().toUpperCase()}`;
}

function normalizeTag(value: string): string {
  const tag = value.trim().replace(/^#/, "").toLocaleLowerCase();
  if (!tag || tag.length > 24 || !/^[\p{L}\p{N}_.-]+$/u.test(tag)) {
    throw new ValidationError(
      "Tag phải dài 1-24 ký tự và chỉ gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới."
    );
  }
  return tag;
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function parseProblemReference(query: string): { contestId: number; index: string } | null {
  const trimmed = query.trim();
  const urlMatch = trimmed.match(
    /codeforces\.com\/(?:contest\/(\d+)\/problem\/|problemset\/problem\/(\d+)\/)([a-z0-9]+)/i
  );
  if (urlMatch) {
    return {
      contestId: Number(urlMatch[1] ?? urlMatch[2]),
      index: urlMatch[3].toUpperCase(),
    };
  }

  const shortMatch = trimmed.match(/^(\d+)\s*(?:\/|-|\s)?\s*([a-z][a-z0-9]*)$/i);
  if (!shortMatch) return null;
  return { contestId: Number(shortMatch[1]), index: shortMatch[2].toUpperCase() };
}

/** Bulk mode intentionally accepts only an exact short ID or Codeforces URL, never a title. */
export function isCodeforcesProblemIdOrUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/^\d+(?:\/|-)?[a-z][a-z0-9]*$/i.test(trimmed)) return true;
  return /^https?:\/\/(?:www\.)?codeforces\.com\/(?:contest\/\d+\/problem\/[a-z0-9]+|problemset\/problem\/\d+\/[a-z0-9]+)\/?(?:[?#].*)?$/i.test(
    trimmed
  );
}

function resolvePublicProblem(problems: readonly CodeforcesProblem[], query: string): CodeforcesProblem {
  const reference = parseProblemReference(query);
  let matches: CodeforcesProblem[];

  if (reference) {
    matches = problems.filter(
      (problem) =>
        problem.contestId === reference.contestId &&
        problem.index.toUpperCase() === reference.index
    );
  } else {
    const normalizedQuery = normalizeTitle(query);
    if (!normalizedQuery) {
      throw new ValidationError(
        "Cú pháp: /task add <mã, URL hoặc đúng tên bài Codeforces>."
      );
    }
    matches = problems.filter((problem) => normalizeTitle(problem.name) === normalizedQuery);
  }

  if (matches.length === 0) {
    throw new ValidationError(
      `Không tìm thấy bài public Codeforces "${query}". Dùng mã như 4A, URL, hoặc đúng tên bài.`
    );
  }
  if (matches.length > 1) {
    const suggestions = matches
      .slice(0, 5)
      .map((problem) => `${problem.contestId}${problem.index}`)
      .join(", ");
    throw new ValidationError(
      `Tên bài "${query}" không duy nhất. Hãy dùng mã contest + index: ${suggestions}.`
    );
  }

  const problem = matches[0];
  if (!problem.contestId) {
    throw new ValidationError("Bài Codeforces này không có contestId nên chưa được hỗ trợ.");
  }
  return problem;
}

export function createCodeforcesTaskService(
  filePath: string,
  handle: string | undefined,
  client: CodeforcesClient = new CodeforcesClient(),
  options: CodeforcesTaskServiceOptions = {}
): CodeforcesTaskServiceApi {
  const normalizedHandle = handle?.trim();
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const readState = (): CodeforcesTaskState =>
    readJsonState<CodeforcesTaskState>(filePath, { users: {} });

  const getTasks = (state: CodeforcesTaskState, telegramId: number): CodeforcesTask[] =>
    state.users[String(telegramId)]?.tasks ?? [];

  const getDailyGateStatus = (
    state: CodeforcesTaskState,
    telegramId: number,
    now: Date = new Date(),
    focusOffOptions: FocusOffGateOptions = {}
  ): DailyCodeforcesGateStatus => {
    const date = localDateStr(now, timeZone);
    const userState = state.users[String(telegramId)];
    const lastBreakAt =
      userState?.breakGate?.date === date
        ? new Date(userState.breakGate.lastBreakAt).getTime()
        : 0;
    const eligibleTasks = (userState?.tasks ?? []).filter((task) => {
      if (task.status !== "solved" || !task.solvedAt) return false;
      const solvedAt = new Date(task.solvedAt);
      const solvedMs = solvedAt.getTime();
      return (
        Number.isFinite(solvedMs) &&
        solvedMs <= now.getTime()
      );
    });
    const dailyTasks = eligibleTasks.filter(
      (task) => localDateStr(new Date(task.solvedAt!), timeZone) === date
    );
    const acceptedSinceLastBreak = dailyTasks.filter(
      (task) => new Date(task.solvedAt!).getTime() > lastBreakAt
    ).length;
    const configuredSinceMs = focusOffOptions.since
      ? new Date(focusOffOptions.since).getTime()
      : Number.NaN;
    const focusOffTasks = Number.isFinite(configuredSinceMs)
      ? eligibleTasks.filter(
          (task) => new Date(task.solvedAt!).getTime() >= configuredSinceMs
        )
      : dailyTasks;
    const focusOffRequiredCount =
      focusOffOptions.requiredCount ?? FOCUS_OFF_REQUIRED_DAILY_AC;
    const focusOffAcceptedCount = focusOffTasks.length;
    return {
      date,
      focusOffAcceptedCount,
      acceptedSinceLastBreak,
      breakRequiredCount: BREAK_REQUIRED_NEW_AC,
      focusOffRequiredCount,
      breakAllowed: acceptedSinceLastBreak >= BREAK_REQUIRED_NEW_AC,
      focusOffAllowed: focusOffAcceptedCount >= focusOffRequiredCount,
    };
  };

  const requireHandle = (): string => {
    if (!normalizedHandle) {
      throw new ValidationError(
        "Chưa cấu hình CODEFORCES_HANDLE trong .env nên không thể kiểm tra submission."
      );
    }
    return normalizedHandle;
  };

  const problemUrl = (task: Pick<CodeforcesTask, "contestId" | "index">): string =>
    `https://codeforces.com/problemset/problem/${task.contestId}/${task.index}`;

  const updateRatings = async (tasks: CodeforcesTask[]): Promise<number> => {
    const sourcePriority: Record<CodeforcesProblemRatingSource, number> = {
      unrated: 0,
      kira: 1,
      codeforces: 2,
    };
    let ratingsUpdated = 0;
    for (const task of tasks) {
      try {
        const resolved = await client.getProblemRating(task.contestId, task.index);
        const currentSource = task.ratingSource ?? "unrated";
        const isUpgrade = sourcePriority[resolved.source] > sourcePriority[currentSource];
        const isSameSourceChange =
          resolved.source === currentSource && resolved.rating !== task.rating;
        if (isUpgrade || isSameSourceChange) {
          task.rating = resolved.rating;
          task.ratingSource = resolved.source;
          ratingsUpdated++;
        }
      } catch {
        // Một bài lỗi không được làm hỏng việc cập nhật các task còn lại.
      }
    }
    return ratingsUpdated;
  };

  return {
    async addTask(telegramId: number, problemQuery: string): Promise<CodeforcesTask> {
      requireHandle();
      const problem = resolvePublicProblem(
        await client.fetchPublicProblems(),
        problemQuery
      );
      const resolvedRating = await client.getProblemRating(problem.contestId!, problem.index);
      if (
        !Number.isFinite(resolvedRating.rating) ||
        resolvedRating.rating! < MIN_TASK_RATING_INCLUSIVE
      ) {
        const ratingLabel = Number.isFinite(resolvedRating.rating)
          ? String(resolvedRating.rating)
          : "Unrated";
        throw new ValidationError(
          `Không thể thêm ${problem.contestId}${problem.index}: rating hiện tại là ${ratingLabel}. ` +
            `Chỉ được thêm bài có rating >= ${MIN_TASK_RATING_INCLUSIVE}.`
        );
      }
      const state = readState();
      const tasks = getTasks(state, telegramId);
      const key = problemKey(problem.contestId!, problem.index);
      const existing = tasks.find(
        (task) => problemKey(task.contestId, task.index) === key
      );
      if (existing) {
        throw new ValidationError(
          existing.status === "active"
            ? `Bài ${problem.contestId}${problem.index} đã nằm trong danh sách task active.`
            : `Bài ${problem.contestId}${problem.index} đã được đánh dấu AC trước đó.`
        );
      }

      const task: CodeforcesTask = {
        contestId: problem.contestId!,
        index: problem.index.toUpperCase(),
        name: problem.name,
        status: "active",
        addedAt: now().toISOString(),
        rating: resolvedRating.rating,
        ratingSource: resolvedRating.source,
      };
      if (!state.users[String(telegramId)]) {
        state.users[String(telegramId)] = { tasks: [] };
      }
      state.users[String(telegramId)].tasks.push(task);
      writeJsonState(filePath, state);
      return task;
    },

    async addTasksAtomic(telegramId, problemReferences): Promise<CodeforcesTask[]> {
      requireHandle();
      if (problemReferences.length === 0) {
        throw new ValidationError("Danh sách bulk không được để trống.");
      }
      const problems = await client.fetchPublicProblems();
      const state = readState();
      const tasks = getTasks(state, telegramId);
      const existingKeys = new Set(tasks.map((task) => problemKey(task.contestId, task.index)));
      const pendingKeys = new Set<string>();
      const added: CodeforcesTask[] = [];

      for (const reference of problemReferences) {
        const problem = resolvePublicProblem(problems, reference);
        const key = problemKey(problem.contestId!, problem.index);
        if (existingKeys.has(key) || pendingKeys.has(key)) {
          throw new ValidationError(`Bài ${problem.contestId}${problem.index} đã tồn tại hoặc bị lặp trong bulk.`);
        }
        const resolvedRating = await client.getProblemRating(problem.contestId!, problem.index);
        if (!Number.isFinite(resolvedRating.rating) || resolvedRating.rating! < MIN_TASK_RATING_INCLUSIVE) {
          throw new ValidationError(
            `Không thể thêm ${problem.contestId}${problem.index}: rating là ${resolvedRating.rating ?? "Unrated"}; yêu cầu >= ${MIN_TASK_RATING_INCLUSIVE}. Không task nào được thêm.`
          );
        }
        pendingKeys.add(key);
        added.push({
          contestId: problem.contestId!,
          index: problem.index.toUpperCase(),
          name: problem.name,
          status: "active",
          addedAt: now().toISOString(),
          rating: resolvedRating.rating,
          ratingSource: resolvedRating.source,
        });
      }
      if (!state.users[String(telegramId)]) state.users[String(telegramId)] = { tasks: [] };
      state.users[String(telegramId)].tasks.push(...added);
      writeJsonState(filePath, state);
      return added.map((task) => ({ ...task }));
    },

    listTasks(telegramId: number): CodeforcesTask[] {
      return [...getTasks(readState(), telegramId)];
    },

    listTags(telegramId: number): string[] {
      const state = readState();
      const user = state.users[String(telegramId)];
      const tags = new Set((user?.tags ?? []).map(normalizeTag));
      for (const task of user?.tasks ?? []) {
        for (const tag of task.tags ?? []) tags.add(normalizeTag(tag));
      }
      return [...tags].sort((a, b) => a.localeCompare(b));
    },

    createTag(telegramId: number, rawTag: string): string {
      const tag = normalizeTag(rawTag);
      const state = readState();
      if (!state.users[String(telegramId)]) state.users[String(telegramId)] = { tasks: [] };
      const user = state.users[String(telegramId)];
      const tags = new Set([
        ...(user.tags ?? []).map(normalizeTag),
        ...user.tasks.flatMap((task) => (task.tags ?? []).map(normalizeTag)),
      ]);
      if (tags.has(tag)) throw new ValidationError(`Tag #${tag} đã tồn tại.`);
      tags.add(tag);
      user.tags = [...tags].sort((a, b) => a.localeCompare(b));
      writeJsonState(filePath, state);
      return tag;
    },

    removeTag(telegramId: number, rawTag: string): number {
      const tag = normalizeTag(rawTag);
      const state = readState();
      const user = state.users[String(telegramId)];
      if (!user) throw new ValidationError(`Không tìm thấy tag #${tag}.`);
      const known = new Set([
        ...(user.tags ?? []).map(normalizeTag),
        ...user.tasks.flatMap((task) => (task.tags ?? []).map(normalizeTag)),
      ]);
      if (!known.has(tag)) throw new ValidationError(`Không tìm thấy tag #${tag}.`);
      let affected = 0;
      for (const task of user.tasks) {
        const before = task.tags?.length ?? 0;
        task.tags = (task.tags ?? []).filter((value) => normalizeTag(value) !== tag);
        if (task.tags.length < before) affected++;
      }
      user.tags = (user.tags ?? []).filter((value) => normalizeTag(value) !== tag);
      writeJsonState(filePath, state);
      return affected;
    },

    editTaskTag(telegramId, problemReference, action, rawTag): CodeforcesTask {
      const reference = parseProblemReference(problemReference);
      if (!reference) {
        throw new ValidationError("Hãy chọn task bằng problem ID hoặc URL Codeforces.");
      }
      const state = readState();
      const task = getTasks(state, telegramId).find(
        (item) => problemKey(item.contestId, item.index) === problemKey(reference.contestId, reference.index)
      );
      if (!task) {
        throw new ValidationError(
          `Không tìm thấy ${reference.contestId}${reference.index} trong task list.`
        );
      }

      if (action === "clear") {
        task.tags = [];
      } else {
        if (!rawTag) throw new ValidationError("Thiếu tag cần chỉnh sửa.");
        const tag = normalizeTag(rawTag);
        if (!state.users[String(telegramId)]) state.users[String(telegramId)] = { tasks: [] };
        const registry = new Set((state.users[String(telegramId)].tags ?? []).map(normalizeTag));
        if (action === "add") registry.add(tag);
        state.users[String(telegramId)].tags = [...registry].sort((a, b) => a.localeCompare(b));
        const tags = new Set((task.tags ?? []).map(normalizeTag));
        if (action === "add") tags.add(tag);
        else tags.delete(tag);
        task.tags = [...tags].sort((a, b) => a.localeCompare(b));
      }
      writeJsonState(filePath, state);
      return { ...task, tags: [...(task.tags ?? [])] };
    },

    removeTask(telegramId, problemReference): CodeforcesTask {
      const reference = parseProblemReference(problemReference);
      if (!reference) throw new ValidationError("Hãy chọn task bằng problem ID hoặc URL Codeforces.");
      const state = readState();
      const tasks = getTasks(state, telegramId);
      const index = tasks.findIndex(
        (task) => problemKey(task.contestId, task.index) === problemKey(reference.contestId, reference.index)
      );
      if (index < 0) throw new ValidationError(`Không tìm thấy ${reference.contestId}${reference.index} trong task list.`);
      if (tasks[index].status === "solved") {
        throw new ValidationError("Task đã AC không được xóa vì còn dùng để tính gate; hãy dùng /task archive.");
      }
      const [removed] = tasks.splice(index, 1);
      writeJsonState(filePath, state);
      return removed;
    },

    clearActiveTasks(telegramId, rawTag): number {
      const state = readState();
      const user = state.users[String(telegramId)];
      if (!user) return 0;
      const tag = rawTag ? normalizeTag(rawTag) : undefined;
      const before = user.tasks.length;
      user.tasks = user.tasks.filter(
        (task) => task.status !== "active" || (tag && !(task.tags ?? []).includes(tag))
      );
      const removed = before - user.tasks.length;
      if (removed > 0) writeJsonState(filePath, state);
      return removed;
    },

    archiveSolvedTasks(telegramId, problemReference): number {
      const state = readState();
      const tasks = getTasks(state, telegramId);
      let selected = tasks.filter((task) => task.status === "solved" && !task.archivedAt);
      if (problemReference) {
        const reference = parseProblemReference(problemReference);
        if (!reference) throw new ValidationError("Hãy chọn task bằng problem ID hoặc URL Codeforces.");
        selected = selected.filter(
          (task) => problemKey(task.contestId, task.index) === problemKey(reference.contestId, reference.index)
        );
      }
      const archivedAt = now().toISOString();
      for (const task of selected) task.archivedAt = archivedAt;
      if (selected.length > 0) writeJsonState(filePath, state);
      return selected.length;
    },

    async refreshRatings(telegramId: number): Promise<number> {
      const state = readState();
      const updated = await updateRatings(getTasks(state, telegramId));
      if (updated > 0) writeJsonState(filePath, state);
      return updated;
    },

    async refresh(telegramId: number, refreshOptions = {}): Promise<RefreshResult> {
      const currentState = readState();
      const currentTasks = getTasks(currentState, telegramId);
      const ratingsUpdated = await updateRatings(currentTasks);
      const codeforcesHandle = requireHandle();
      if (!currentState.users[String(telegramId)]) {
        currentState.users[String(telegramId)] = { tasks: currentTasks };
      }
      const userState = currentState.users[String(telegramId)];
      const lastFullSyncMs = userState.submissionSync
        ? new Date(userState.submissionSync.lastFullSyncAt).getTime()
        : Number.NaN;
      const full =
        !!refreshOptions.full ||
        !userState.submissionSync ||
        !Number.isFinite(lastFullSyncMs) ||
        now().getTime() - lastFullSyncMs >= FULL_SUBMISSION_SYNC_INTERVAL_MS;
      const [submissions, publicProblems] = await Promise.all([
        full
          ? client.fetchAllUserSubmissions(codeforcesHandle)
          : client.fetchRecentUserSubmissions(codeforcesHandle),
        client.fetchPublicProblems(),
      ]);
      const firstAcceptedAt = full
        ? ({} as Record<string, number>)
        : { ...(userState.submissionSync?.firstAcceptedAt ?? {}) };
      for (const submission of submissions as readonly CodeforcesSubmission[]) {
        if (submission.verdict !== "OK") continue;
        const contestId = submission.problem.contestId ?? submission.contestId;
        if (!contestId) continue;
        const key = problemKey(contestId, submission.problem.index);
        const previous = firstAcceptedAt[key];
        if (!Number.isFinite(previous) || submission.creationTimeSeconds < previous) {
          firstAcceptedAt[key] = submission.creationTimeSeconds;
        }
      }
      userState.submissionSync = {
        lastFullSyncAt: full
          ? now().toISOString()
          : userState.submissionSync!.lastFullSyncAt,
        newestSubmissionId: submissions.reduce(
          (largest, submission) => Math.max(largest, submission.id),
          userState.submissionSync?.newestSubmissionId ?? 0
        ),
        firstAcceptedAt,
      };
      const publicKeys = new Set(
        publicProblems
          .filter((problem) => problem.contestId)
          .map((problem) => problemKey(problem.contestId!, problem.index))
      );
      const newlySolved: CodeforcesTask[] = [];
      const unavailablePublicProblems: CodeforcesTask[] = [];

      for (const task of currentTasks) {
        if (!publicKeys.has(problemKey(task.contestId, task.index))) {
          if (task.status === "active") unavailablePublicProblems.push(task);
          continue;
        }
        const acceptedAtSeconds = firstAcceptedAt[problemKey(task.contestId, task.index)];
        if (Number.isFinite(acceptedAtSeconds)) {
          const firstAcceptedAtIso = new Date(acceptedAtSeconds * 1000).toISOString();
          if (task.status === "active") {
            task.status = "solved";
            newlySolved.push(task);
          }
          // Luôn sửa lại cả task solved cũ: mốc là submission OK đầu tiên,
          // tuyệt đối không dùng thời điểm người dùng gọi /refresh.
          task.solvedAt = firstAcceptedAtIso;
        }
      }

      writeJsonState(filePath, currentState);
      return {
        tasks: [...currentTasks],
        newlySolved: [...newlySolved],
        unavailablePublicProblems: [...unavailablePublicProblems],
        ratingsUpdated,
        syncMode: full ? "full" : "incremental",
      };
    },

    getDailyGateStatus(
      telegramId: number,
      focusOffOptions?: FocusOffGateOptions
    ): DailyCodeforcesGateStatus {
      return getDailyGateStatus(readState(), telegramId, now(), focusOffOptions);
    },

    assertBreakAllowed(telegramId: number): void {
      const status = getDailyGateStatus(readState(), telegramId);
      if (status.breakAllowed) return;

      throw new ValidationError(
        `Không thể break: mới xác nhận ${status.acceptedSinceLastBreak}/${status.breakRequiredCount} task AC mới kể từ lần break gần nhất.\n` +
          `Hãy AC thêm ${status.breakRequiredCount - status.acceptedSinceLastBreak} bài rồi dùng /refresh để cập nhật. ` +
          "Bài phải nằm trong task list và được /refresh xác nhận."
      );
    },

    recordBreakStarted(telegramId: number): void {
      const state = readState();
      if (!state.users[String(telegramId)]) {
        state.users[String(telegramId)] = { tasks: [] };
      }
      const currentTime = now();
      state.users[String(telegramId)].breakGate = {
        date: localDateStr(currentTime, timeZone),
        lastBreakAt: currentTime.toISOString(),
      };
      writeJsonState(filePath, state);
    },

    assertFocusOffAllowed(telegramId: number, options?: FocusOffGateOptions): void {
      const status = getDailyGateStatus(readState(), telegramId, now(), options);
      if (status.focusOffAllowed) return;
      throw new ValidationError(
        `Không thể tắt Focus: mới xác nhận ${status.focusOffAcceptedCount}/${status.focusOffRequiredCount} task AC hợp lệ trong khoảng thời gian yêu cầu.\n` +
          `Hãy AC thêm ${status.focusOffRequiredCount - status.focusOffAcceptedCount} task rồi dùng /refresh để cập nhật.`
      );
    },

    problemUrl,
  };
}
