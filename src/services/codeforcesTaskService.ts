import {
  CodeforcesProblem,
  CodeforcesProblemRatingSource,
  CodeforcesSubmission,
} from "../types/codeforces.types";
import {
  CodeforcesClient,
  findFirstAcceptedSubmissionForProblem,
} from "../utils/codeforces";
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
}

interface UserTaskState {
  tasks: CodeforcesTask[];
  breakGate?: {
    date: string;
    lastBreakAt: string;
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

export interface CodeforcesTaskServiceApi {
  addTask(telegramId: number, problemQuery: string): Promise<CodeforcesTask>;
  listTasks(telegramId: number): CodeforcesTask[];
  refreshRatings(telegramId: number): Promise<number>;
  refresh(telegramId: number): Promise<RefreshResult>;
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
const MIN_TASK_RATING_EXCLUSIVE = 1600;

function localDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function problemKey(contestId: number, index: string): string {
  return `${contestId}:${index.trim().toUpperCase()}`;
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
  client: CodeforcesClient = new CodeforcesClient()
): CodeforcesTaskServiceApi {
  const normalizedHandle = handle?.trim();

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
    const date = localDateStr(now);
    const userState = state.users[String(telegramId)];
    const lastBreakAt =
      userState?.breakGate?.date === date
        ? new Date(userState.breakGate.lastBreakAt).getTime()
        : new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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
      (task) => localDateStr(new Date(task.solvedAt!)) === date
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
        resolvedRating.rating! <= MIN_TASK_RATING_EXCLUSIVE
      ) {
        const ratingLabel = Number.isFinite(resolvedRating.rating)
          ? String(resolvedRating.rating)
          : "Unrated";
        throw new ValidationError(
          `Không thể thêm ${problem.contestId}${problem.index}: rating hiện tại là ${ratingLabel}. ` +
            `Chỉ được thêm bài có rating > ${MIN_TASK_RATING_EXCLUSIVE}.`
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
        addedAt: new Date().toISOString(),
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

    listTasks(telegramId: number): CodeforcesTask[] {
      return [...getTasks(readState(), telegramId)];
    },

    async refreshRatings(telegramId: number): Promise<number> {
      const state = readState();
      const updated = await updateRatings(getTasks(state, telegramId));
      if (updated > 0) writeJsonState(filePath, state);
      return updated;
    },

    async refresh(telegramId: number): Promise<RefreshResult> {
      const currentState = readState();
      const currentTasks = getTasks(currentState, telegramId);
      const ratingsUpdated = await updateRatings(currentTasks);
      const codeforcesHandle = requireHandle();
      const [submissions, publicProblems] = await Promise.all([
        client.fetchAllUserSubmissions(codeforcesHandle),
        client.fetchPublicProblems(),
      ]);
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
        const firstAccepted = findFirstAcceptedSubmissionForProblem(
          submissions as readonly CodeforcesSubmission[],
          task.contestId,
          task.index
        );
        if (firstAccepted) {
          const firstAcceptedAt = new Date(
            firstAccepted.creationTimeSeconds * 1000
          ).toISOString();
          if (task.status === "active") {
            task.status = "solved";
            newlySolved.push(task);
          }
          // Luôn sửa lại cả task solved cũ: mốc là submission OK đầu tiên,
          // tuyệt đối không dùng thời điểm người dùng gọi /refresh.
          task.solvedAt = firstAcceptedAt;
        }
      }

      if (!currentState.users[String(telegramId)]) {
        currentState.users[String(telegramId)] = { tasks: currentTasks };
      }
      writeJsonState(filePath, currentState);
      return {
        tasks: [...currentTasks],
        newlySolved: [...newlySolved],
        unavailablePublicProblems: [...unavailablePublicProblems],
        ratingsUpdated,
      };
    },

    getDailyGateStatus(
      telegramId: number,
      focusOffOptions?: FocusOffGateOptions
    ): DailyCodeforcesGateStatus {
      return getDailyGateStatus(readState(), telegramId, new Date(), focusOffOptions);
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
      const now = new Date();
      state.users[String(telegramId)].breakGate = {
        date: localDateStr(now),
        lastBreakAt: now.toISOString(),
      };
      writeJsonState(filePath, state);
    },

    assertFocusOffAllowed(telegramId: number, options?: FocusOffGateOptions): void {
      const status = getDailyGateStatus(readState(), telegramId, new Date(), options);
      if (status.focusOffAllowed) return;
      throw new ValidationError(
        `Không thể tắt Focus: mới xác nhận ${status.focusOffAcceptedCount}/${status.focusOffRequiredCount} task AC hợp lệ trong khoảng thời gian yêu cầu.\n` +
          `Hãy AC thêm ${status.focusOffRequiredCount - status.focusOffAcceptedCount} task rồi dùng /refresh để cập nhật.`
      );
    },

    problemUrl,
  };
}
