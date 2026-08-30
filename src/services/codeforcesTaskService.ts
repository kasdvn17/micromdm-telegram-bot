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

export interface CodeforcesTaskServiceApi {
  addTask(telegramId: number, problemQuery: string): Promise<CodeforcesTask>;
  listTasks(telegramId: number): CodeforcesTask[];
  refresh(telegramId: number): Promise<RefreshResult>;
  assertBreakAllowed(telegramId: number): void;
  problemUrl(task: Pick<CodeforcesTask, "contestId" | "index">): string;
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

    async refresh(telegramId: number): Promise<RefreshResult> {
      const currentState = readState();
      const currentTasks = getTasks(currentState, telegramId);
      const sourcePriority: Record<CodeforcesProblemRatingSource, number> = {
        unrated: 0,
        kira: 1,
        codeforces: 2,
      };
      let ratingsUpdated = 0;
      for (const task of currentTasks) {
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
          // Task cũ có thể không còn trong problemset; vẫn tiếp tục refresh AC.
        }
      }
      const activeTasks = currentTasks.filter((task) => task.status === "active");
      if (activeTasks.length === 0) {
        if (ratingsUpdated > 0) writeJsonState(filePath, currentState);
        return {
          tasks: [...currentTasks],
          newlySolved: [],
          unavailablePublicProblems: [],
          ratingsUpdated,
        };
      }

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

      if (newlySolved.length > 0 || ratingsUpdated > 0) writeJsonState(filePath, currentState);
      return {
        tasks: [...currentTasks],
        newlySolved: [...newlySolved],
        unavailablePublicProblems: [...unavailablePublicProblems],
        ratingsUpdated,
      };
    },

    assertBreakAllowed(telegramId: number): void {
      const activeTasks = getTasks(readState(), telegramId).filter(
        (task) => task.status === "active"
      );
      if (activeTasks.length === 0) return;

      const preview = activeTasks
        .slice(0, 8)
        .map((task) => `${task.contestId}${task.index} - ${task.name}`)
        .join("\n");
      const remaining =
        activeTasks.length > 8 ? `\n... và ${activeTasks.length - 8} bài khác.` : "";
      throw new ValidationError(
        `Không thể break: còn ${activeTasks.length} task Codeforces chưa AC.\n${preview}${remaining}\n` +
          "Sau khi AC, dùng /refresh để cập nhật trạng thái."
      );
    },

    problemUrl,
  };
}
