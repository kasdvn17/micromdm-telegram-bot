import fetch, { RequestInit, Response } from "node-fetch";
import {
  CodeforcesApiResponse,
  CodeforcesProblem,
  CodeforcesProblemsetResult,
  ResolvedCodeforcesProblemRating,
  CodeforcesSubmission,
} from "../types/codeforces.types";
import { CodeforcesApiError, ValidationError } from "./errors";

const DEFAULT_BASE_URL = "https://codeforces.com/api";
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 2_000;
const DEFAULT_PUBLIC_PROBLEMS_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_EXTERNAL_RATINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_KIRA_RATINGS_URL =
  "https://raw.githubusercontent.com/kira924age/CodeforcesProblems/main/cf-problems-crawler/contests.json";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CodeforcesClientOptions {
  baseUrl?: string;
  pageSize?: number;
  /** Codeforces giới hạn API ở 1 request / 2 giây. Chỉ nên đặt 0 trong test. */
  minRequestIntervalMs?: number;
  publicProblemsCacheTtlMs?: number;
  externalRatingsCacheTtlMs?: number;
  kiraRatingsUrl?: string;
  fetchImpl?: FetchLike;
}

interface KiraProblem {
  index?: string;
  rating?: number | string | null;
}

interface KiraContest {
  id?: number;
  problems?: Array<KiraProblem | null> | null;
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
  return findFirstAcceptedSubmissionForProblem(submissions, contestId, problemIndex) !== undefined;
}

/** Submission OK đầu tiên theo thời gian của đúng bài, dùng để chống tính AC cũ vào phiên hiện tại. */
export function findFirstAcceptedSubmissionForProblem(
  submissions: readonly CodeforcesSubmission[],
  contestId: number,
  problemIndex: string
): CodeforcesSubmission | undefined {
  return submissions
    .filter(
    (submission) =>
      submission.verdict === "OK" &&
      isSubmissionForProblem(submission, contestId, problemIndex)
    )
    .reduce<CodeforcesSubmission | undefined>(
      (earliest, submission) =>
        !earliest || submission.creationTimeSeconds < earliest.creationTimeSeconds
          ? submission
          : earliest,
      undefined
    );
}

/** Anonymous Codeforces API client: chỉ đọc dữ liệu public, không cần API key. */
export class CodeforcesClient {
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly minRequestIntervalMs: number;
  private readonly publicProblemsCacheTtlMs: number;
  private readonly externalRatingsCacheTtlMs: number;
  private readonly kiraRatingsUrl: string;
  private readonly fetchImpl: FetchLike;
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private publicProblemsCache: { expiresAt: number; problems: CodeforcesProblem[] } | null = null;
  private publicProblemsInFlight: Promise<CodeforcesProblem[]> | null = null;
  private kiraRatingsCache: { expiresAt: number; ratings: Map<string, number> } | null = null;
  private kiraRatingsInFlight: Promise<Map<string, number>> | null = null;

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

    const externalRatingsCacheTtlMs =
      options.externalRatingsCacheTtlMs ?? DEFAULT_EXTERNAL_RATINGS_CACHE_TTL_MS;
    if (!Number.isFinite(externalRatingsCacheTtlMs) || externalRatingsCacheTtlMs < 0) {
      throw new ValidationError("Codeforces externalRatingsCacheTtlMs phải là số không âm.");
    }

    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!baseUrl) throw new ValidationError("Codeforces baseUrl không được để trống.");

    this.baseUrl = baseUrl;
    this.pageSize = pageSize;
    this.minRequestIntervalMs = minRequestIntervalMs;
    this.publicProblemsCacheTtlMs = publicProblemsCacheTtlMs;
    this.externalRatingsCacheTtlMs = externalRatingsCacheTtlMs;
    this.kiraRatingsUrl = options.kiraRatingsUrl?.trim() || DEFAULT_KIRA_RATINGS_URL;
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

  /**
   * Lấy difficulty theo thứ tự: Codeforces official -> dataset public của
   * cf.kira924age.com -> unrated. Dataset external được cache 24 giờ mặc định.
   */
  async getProblemRating(
    contestId: number,
    problemIndex: string
  ): Promise<ResolvedCodeforcesProblemRating> {
    if (!Number.isInteger(contestId) || contestId <= 0) {
      throw new ValidationError("Codeforces contestId phải là số nguyên dương.");
    }
    const normalizedIndex = normalizeProblemIndex(problemIndex);
    const problem = (await this.fetchPublicProblems()).find(
      (item) =>
        item.contestId === contestId && item.index.toUpperCase() === normalizedIndex
    );
    if (!problem) {
      throw new ValidationError(`Không tìm thấy bài public ${contestId}${normalizedIndex}.`);
    }
    if (Number.isFinite(problem.rating)) {
      return { rating: problem.rating, source: "codeforces" };
    }

    try {
      const externalRating = (await this.fetchKiraRatings()).get(
        `${contestId}:${normalizedIndex}`
      );
      return Number.isFinite(externalRating)
        ? { rating: externalRating, source: "kira" }
        : { source: "unrated" };
    } catch {
      // External fallback không được làm /task add thất bại khi nguồn tạm offline.
      return { source: "unrated" };
    }
  }

  private async fetchKiraRatings(forceRefresh = false): Promise<Map<string, number>> {
    if (
      !forceRefresh &&
      this.kiraRatingsCache &&
      this.kiraRatingsCache.expiresAt > Date.now()
    ) {
      return this.kiraRatingsCache.ratings;
    }
    if (!forceRefresh && this.kiraRatingsInFlight) return this.kiraRatingsInFlight;

    const request = (async (): Promise<Map<string, number>> => {
      let response: Response;
      try {
        response = await this.fetchImpl(this.kiraRatingsUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
      } catch (err) {
        throw new CodeforcesApiError(
          `Không thể kết nối nguồn rating Kira: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      const body = await response.text();
      if (!response.ok) {
        throw new CodeforcesApiError(
          `Nguồn rating Kira trả HTTP ${response.status}.`,
          response.status,
          body
        );
      }

      let contests: KiraContest[];
      try {
        contests = JSON.parse(body) as KiraContest[];
      } catch {
        throw new CodeforcesApiError("Nguồn rating Kira trả JSON không hợp lệ.");
      }
      if (!Array.isArray(contests)) {
        throw new CodeforcesApiError("Nguồn rating Kira không trả về một mảng contest.");
      }

      const ratings = new Map<string, number>();
      for (const contest of contests) {
        if (!Number.isInteger(contest?.id) || !Array.isArray(contest.problems)) continue;
        for (const problem of contest.problems) {
          if (!problem?.index) continue;
          const rating = Number(problem.rating);
          if (!Number.isFinite(rating) || rating <= 0) continue;
          ratings.set(`${contest.id}:${problem.index.trim().toUpperCase()}`, rating);
        }
      }
      this.kiraRatingsCache = {
        expiresAt: Date.now() + this.externalRatingsCacheTtlMs,
        ratings,
      };
      return ratings;
    })();
    this.kiraRatingsInFlight = request;
    try {
      return await request;
    } finally {
      if (this.kiraRatingsInFlight === request) this.kiraRatingsInFlight = null;
    }
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

export function getCodeforcesProblemRating(
  contestId: number,
  problemIndex: string
): Promise<ResolvedCodeforcesProblemRating> {
  return defaultClient.getProblemRating(contestId, problemIndex);
}
