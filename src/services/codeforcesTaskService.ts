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
  dailyAccepted?: DailyAcceptedProgress;
}

interface CodeforcesTaskState {
  users: Record<string, UserTaskState>;
}

export interface RefreshResult {
  tasks: CodeforcesTask[];
  newlySolved: CodeforcesTask[];
  unavailablePublicProblems: CodeforcesTask[];
  ratingsUpdated: number;
  dailyAccepted: DailyAcceptedProgress;
}

export interface DailyAcceptedProgress {
  date: string;
  problemKeys: string[];
  refreshedAt: string;
  /** Các bài đã có tại thời điểm bắt đầu break gần nhất trong ngày. */
  breakBaselineProblemKeys?: string[];
}

export interface DailyCodeforcesGateStatus {
  date: string;
  dailyAcceptedCount: number;
  acceptedSinceLastBreak: number;
  breakRequiredCount: number;
  focusOffRequiredCount: number;
  breakAllowed: boolean;
  focusOffAllowed: boolean;
}

export interface CodeforcesTaskServiceApi {
  addTask(telegramId: number, problemQuery: string): Promise<CodeforcesTask>;
  listTasks(telegramId: number): CodeforcesTask[];
  refreshRatings(telegramId: number): Promise<number>;
  refresh(telegramId: number): Promise<RefreshResult>;
  getDailyGateStatus(telegramId: number): DailyCodeforcesGateStatus;
  assertBreakAllowed(telegramId: number): void;
  recordBreakStarted(telegramId: number): void;
  assertFocusOffAllowed(telegramId: number): void;
  problemUrl(task: Pick<CodeforcesTask, "contestId" | "index">): string;
}

const BREAK_REQUIRED_NEW_AC = 3;
const FOCUS_OFF_REQUIRED_DAILY_AC = 10;

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

  const getDailyAccepted = (
    state: CodeforcesTaskState,
    telegramId: number,
    now: Date = new Date()
  ): DailyAcceptedProgress => {
    const date = localDateStr(now);
    const stored = state.users[String(telegramId)]?.dailyAccepted;
    return stored?.date === date
      ? stored
      : { date, problemKeys: [], refreshedAt: now.toISOString() };
  };

  const getDailyGateStatus = (
    state: CodeforcesTaskState,
    telegramId: number,
    now: Date = new Date()
  ): DailyCodeforcesGateStatus => {
    const progress = getDailyAccepted(state, telegramId, now);
    const baseline = new Set(progress.breakBaselineProblemKeys ?? []);
    const acceptedSinceLastBreak = progress.problemKeys.filter((key) => !baseline.has(key)).length;
    const dailyAcceptedCount = progress.problemKeys.length;
    return {
      date: progress.date,
      dailyAcceptedCount,
      acceptedSinceLastBreak,
      breakRequiredCount: BREAK_REQUIRED_NEW_AC,
      focusOffRequiredCount: FOCUS_OFF_REQUIRED_DAILY_AC,
      breakAllowed: acceptedSinceLastBreak >= BREAK_REQUIRED_NEW_AC,
      focusOffAllowed: dailyAcceptedCount >= FOCUS_OFF_REQUIRED_DAILY_AC,
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
      const activeTasks = currentTasks.filter((task) => task.status === "active");
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
      const refreshedAt = new Date();
      const today = localDateStr(refreshedAt);
      const dailyProblemKeys = new Set<string>();
      for (const submission of submissions) {
        const contestId = submission.problem.contestId ?? submission.contestId;
        if (submission.verdict !== "OK" || !contestId) continue;
        if (localDateStr(new Date(submission.creationTimeSeconds * 1000)) !== today) continue;
        const key = problemKey(contestId, submission.problem.index);
        if (publicKeys.has(key)) dailyProblemKeys.add(key);
      }
      const dailyAccepted: DailyAcceptedProgress = {
        date: today,
        problemKeys: [...dailyProblemKeys].sort(),
        refreshedAt: refreshedAt.toISOString(),
        breakBaselineProblemKeys:
          currentState.users[String(telegramId)]?.dailyAccepted?.date === today
            ? currentState.users[String(telegramId)].dailyAccepted?.breakBaselineProblemKeys ?? []
            : [],
      };
      const newlySolved: CodeforcesTask[] = [];
      const unavailablePublicProblems: CodeforcesTask[] = [];

      for (const task of activeTasks) {
        if (!publicKeys.has(problemKey(task.contestId, task.index))) {
          unavailablePublicProblems.push(task);
          continue;
        }
        const firstAccepted = findFirstAcceptedSubmissionForProblem(
          submissions as readonly CodeforcesSubmission[],
          task.contestId,
          task.index
        );
        if (firstAccepted) {
          task.status = "solved";
          task.solvedAt = new Date(firstAccepted.creationTimeSeconds * 1000).toISOString();
          newlySolved.push(task);
        }
      }

      if (!currentState.users[String(telegramId)]) {
        currentState.users[String(telegramId)] = { tasks: currentTasks };
      }
      currentState.users[String(telegramId)].dailyAccepted = dailyAccepted;
      writeJsonState(filePath, currentState);
      return {
        tasks: [...currentTasks],
        newlySolved: [...newlySolved],
        unavailablePublicProblems: [...unavailablePublicProblems],
        ratingsUpdated,
        dailyAccepted,
      };
    },

    getDailyGateStatus(telegramId: number): DailyCodeforcesGateStatus {
      return getDailyGateStatus(readState(), telegramId);
    },

    assertBreakAllowed(telegramId: number): void {
      const status = getDailyGateStatus(readState(), telegramId);
      if (status.breakAllowed) return;

      throw new ValidationError(
        `Không thể break: mới xác nhận ${status.acceptedSinceLastBreak}/${status.breakRequiredCount} bài Codeforces AC mới kể từ lần break gần nhất.\n` +
          `Hãy AC thêm ${status.breakRequiredCount - status.acceptedSinceLastBreak} bài rồi dùng /refresh để cập nhật. ` +
          "Không bắt buộc các bài đó phải nằm trong task list."
      );
    },

    recordBreakStarted(telegramId: number): void {
      const state = readState();
      const progress = getDailyAccepted(state, telegramId);
      if (!state.users[String(telegramId)]) {
        state.users[String(telegramId)] = { tasks: [] };
      }
      state.users[String(telegramId)].dailyAccepted = {
        ...progress,
        breakBaselineProblemKeys: [...progress.problemKeys],
      };
      writeJsonState(filePath, state);
    },

    assertFocusOffAllowed(telegramId: number): void {
      const status = getDailyGateStatus(readState(), telegramId);
      if (status.focusOffAllowed) return;
      throw new ValidationError(
        `Không thể tắt Focus: hôm nay mới xác nhận ${status.dailyAcceptedCount}/${status.focusOffRequiredCount} bài Codeforces AC khác nhau.\n` +
          `Hãy AC thêm ${status.focusOffRequiredCount - status.dailyAcceptedCount} bài rồi dùng /refresh để cập nhật.`
      );
    },

    problemUrl,
  };
}
