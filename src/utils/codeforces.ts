import fetch, { RequestInit, Response } from "node-fetch";
import {
  CodeforcesApiResponse,
  CodeforcesProblem,
  CodeforcesProblemsetResult,
  CodeforcesSubmission,
} from "../types/codeforces.types";
import { CodeforcesApiError, ValidationError } from "./errors";

const DEFAULT_BASE_URL = "https://codeforces.com/api";
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 2_000;
const DEFAULT_PUBLIC_PROBLEMS_CACHE_TTL_MS = 15 * 60 * 1000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CodeforcesClientOptions {
  baseUrl?: string;
  pageSize?: number;
  /** Codeforces giới hạn API ở 1 request / 2 giây. Chỉ nên đặt 0 trong test. */
  minRequestIntervalMs?: number;
  publicProblemsCacheTtlMs?: number;
  fetchImpl?: FetchLike;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function normalizeProblemIndex(index: string): string {
  const normalized = index.trim().toUpperCase();
  if (!normalized) throw new ValidationError("Codeforces problem index không được để trống.");
  return normalized;
}

function validateHandle(handle: string): string {
  const normalized = handle.trim();
  if (!normalized) throw new ValidationError("Codeforces handle không được để trống.");
  return normalized;
}

export function isSubmissionForProblem(
  submission: CodeforcesSubmission,
  contestId: number,
  problemIndex: string
): boolean {
  const submissionContestId = submission.problem.contestId ?? submission.contestId;
  return (
    submissionContestId === contestId &&
    submission.problem.index.toUpperCase() === normalizeProblemIndex(problemIndex)
  );
}

export function hasAcceptedSubmissionForProblem(
  submissions: readonly CodeforcesSubmission[],
  contestId: number,
  problemIndex: string
): boolean {
  return submissions.some(
    (submission) =>
      submission.verdict === "OK" &&
      isSubmissionForProblem(submission, contestId, problemIndex)
  );
}

/** Anonymous Codeforces API client: chỉ đọc dữ liệu public, không cần API key. */
export class CodeforcesClient {
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly minRequestIntervalMs: number;
  private readonly publicProblemsCacheTtlMs: number;
  private readonly fetchImpl: FetchLike;
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private publicProblemsCache: { expiresAt: number; problems: CodeforcesProblem[] } | null = null;
  private publicProblemsInFlight: Promise<CodeforcesProblem[]> | null = null;

  constructor(options: CodeforcesClientOptions = {}) {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 10_000) {
      throw new ValidationError("Codeforces pageSize phải là số nguyên trong khoảng 1..10000.");
    }

    const minRequestIntervalMs =
      options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS;
    if (!Number.isFinite(minRequestIntervalMs) || minRequestIntervalMs < 0) {
      throw new ValidationError("Codeforces minRequestIntervalMs phải là số không âm.");
    }

    const publicProblemsCacheTtlMs =
      options.publicProblemsCacheTtlMs ?? DEFAULT_PUBLIC_PROBLEMS_CACHE_TTL_MS;
    if (!Number.isFinite(publicProblemsCacheTtlMs) || publicProblemsCacheTtlMs < 0) {
      throw new ValidationError("Codeforces publicProblemsCacheTtlMs phải là số không âm.");
    }

    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!baseUrl) throw new ValidationError("Codeforces baseUrl không được để trống.");

    this.baseUrl = baseUrl;
    this.pageSize = pageSize;
    this.minRequestIntervalMs = minRequestIntervalMs;
    this.publicProblemsCacheTtlMs = publicProblemsCacheTtlMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Lấy toàn bộ submission public của user, phân trang cho tới trang cuối. */
  async fetchAllUserSubmissions(handle: string): Promise<CodeforcesSubmission[]> {
    const normalizedHandle = validateHandle(handle);
    const submissions: CodeforcesSubmission[] = [];
    const seenIds = new Set<number>();
    let from = 1;

    while (true) {
      const page = await this.request<CodeforcesSubmission[]>("user.status", {
        handle: normalizedHandle,
        from: String(from),
        count: String(this.pageSize),
      });

      for (const submission of page) {
        if (!seenIds.has(submission.id)) {
          seenIds.add(submission.id);
          submissions.push(submission);
        }
      }

      if (page.length < this.pageSize) break;
      from += page.length;
    }

    return submissions;
  }

  /** Lấy danh sách bài hiện có trong problemset public của Codeforces. */
  async fetchPublicProblems(forceRefresh = false): Promise<CodeforcesProblem[]> {
    if (
      !forceRefresh &&
      this.publicProblemsCache &&
      this.publicProblemsCache.expiresAt > Date.now()
    ) {
      return this.publicProblemsCache.problems;
    }
    if (!forceRefresh && this.publicProblemsInFlight) return this.publicProblemsInFlight;

    const request = this.request<CodeforcesProblemsetResult>("problemset.problems", {}).then(
      (result) => {
        const problems = result.problems;
        this.publicProblemsCache = {
          expiresAt: Date.now() + this.publicProblemsCacheTtlMs,
          problems,
        };
        return problems;
      }
    );
    this.publicProblemsInFlight = request;

    try {
      return await request;
    } finally {
      if (this.publicProblemsInFlight === request) this.publicProblemsInFlight = null;
    }
  }

  /**
   * true khi bài thuộc problemset public hiện tại VÀ user có ít nhất một
   * submission Accepted (verdict OK) cho đúng cặp contestId + index.
   */
  async hasUserSolvedPublicProblem(
    handle: string,
    contestId: number,
    problemIndex: string
  ): Promise<boolean> {
    if (!Number.isInteger(contestId) || contestId <= 0) {
      throw new ValidationError("Codeforces contestId phải là số nguyên dương.");
    }
    const normalizedIndex = normalizeProblemIndex(problemIndex);
    const submissions = await this.fetchAllUserSubmissions(handle);

    if (!hasAcceptedSubmissionForProblem(submissions, contestId, normalizedIndex)) {
      return false;
    }

    const publicProblems = await this.fetchPublicProblems();
    return publicProblems.some(
      (problem) =>
        problem.contestId === contestId &&
        problem.index.toUpperCase() === normalizedIndex
    );
  }

  private async request<T>(
    method: string,
    params: Record<string, string>
  ): Promise<T> {
    const query = new URLSearchParams(params);
    const queryString = query.toString();
    const url = `${this.baseUrl}/${method}${queryString ? `?${queryString}` : ""}`;

    return this.enqueue(async () => {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
      } catch (err) {
        throw new CodeforcesApiError(
          `Không thể kết nối Codeforces API: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const body = await response.text();
      if (!response.ok) {
        throw new CodeforcesApiError(
          `Codeforces API trả HTTP ${response.status}.`,
          response.status,
          body
        );
      }

      let parsed: CodeforcesApiResponse<T>;
      try {
        parsed = JSON.parse(body) as CodeforcesApiResponse<T>;
      } catch {
        throw new CodeforcesApiError("Codeforces API trả JSON không hợp lệ.", response.status, body);
      }

      if (!parsed || typeof parsed !== "object" || parsed.status !== "OK") {
        const comment =
          parsed && typeof parsed === "object" && "comment" in parsed
            ? parsed.comment
            : undefined;
        throw new CodeforcesApiError(
          `Codeforces API thất bại: ${comment ?? "không rõ nguyên nhân"}`,
          response.status,
          body
        );
      }
      return parsed.result;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.requestQueue.then(async () => {
      await delay(Math.max(0, this.nextRequestAt - Date.now()));
      this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
      return task();
    });
    this.requestQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

const defaultClient = new CodeforcesClient();

export function fetchAllUserSubmissions(handle: string): Promise<CodeforcesSubmission[]> {
  return defaultClient.fetchAllUserSubmissions(handle);
}

export function fetchPublicCodeforcesProblems(forceRefresh = false): Promise<CodeforcesProblem[]> {
  return defaultClient.fetchPublicProblems(forceRefresh);
}

export function hasUserSolvedPublicProblem(
  handle: string,
  contestId: number,
  problemIndex: string
): Promise<boolean> {
  return defaultClient.hasUserSolvedPublicProblem(handle, contestId, problemIndex);
}
