import fetch, { RequestInit, Response } from "node-fetch";
import {
  CodeforcesApiResponse,
  CodeforcesProblem,
  CodeforcesProblemsetResult,
  ResolvedCodeforcesProblemRating,
  CodeforcesSubmission,
} from "../types/codeforces.types";
import { CodeforcesApiError, ValidationError } from "./errors";
import { getLogger } from "./logger";

const DEFAULT_BASE_URL = "https://codeforces.com/api";
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 2_000;
const DEFAULT_PUBLIC_PROBLEMS_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_EXTERNAL_RATINGS_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_KIRA_RATINGS_URLS = [
  "https://raw.githubusercontent.com/kira924age/CodeforcesProblems/main/cf-problems-crawler/contests.json",
  "https://cdn.jsdelivr.net/gh/kira924age/CodeforcesProblems@main/cf-problems-crawler/contests.json",
] as const;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CodeforcesClientOptions {
  baseUrl?: string;
  pageSize?: number;
  /** Codeforces giới hạn API ở 1 request / 2 giây. Chỉ nên đặt 0 trong test. */
  minRequestIntervalMs?: number;
  publicProblemsCacheTtlMs?: number;
  externalRatingsCacheTtlMs?: number;
  kiraRatingsUrl?: string;
  kiraRatingsUrls?: string[];
  fetchImpl?: FetchLike;
}

interface KiraProblem {
  index?: string;
  name?: string;
  rating?: number | string | null;
}

interface KiraContest {
  id?: number;
  problems?: Array<KiraProblem | null> | null;
}

interface KiraProblemMetadata {
  contestId: number;
  index: string;
  name: string;
  rating?: number;
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
  private readonly kiraRatingsUrls: string[];
  private readonly fetchImpl: FetchLike;
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private publicProblemsCache: { expiresAt: number; problems: CodeforcesProblem[] } | null = null;
  private publicProblemsInFlight: Promise<CodeforcesProblem[]> | null = null;
  private kiraProblemsCache: {
    expiresAt: number;
    problems: Map<string, KiraProblemMetadata>;
  } | null = null;
  private kiraProblemsInFlight: Promise<Map<string, KiraProblemMetadata>> | null = null;

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
    const configuredKiraUrls = options.kiraRatingsUrls?.map((url) => url.trim()).filter(Boolean);
    this.kiraRatingsUrls = configuredKiraUrls?.length
      ? configuredKiraUrls
      : options.kiraRatingsUrl?.trim()
        ? [options.kiraRatingsUrl.trim()]
        : [...DEFAULT_KIRA_RATINGS_URLS];
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

  /** Lấy trang submission mới nhất để refresh tăng dần, tránh quét toàn bộ lịch sử mỗi lần. */
  async fetchRecentUserSubmissions(
    handle: string,
    count = DEFAULT_PAGE_SIZE
  ): Promise<CodeforcesSubmission[]> {
    const normalizedHandle = validateHandle(handle);
    if (!Number.isInteger(count) || count <= 0 || count > 10_000) {
      throw new ValidationError("Codeforces submission count phải trong khoảng 1..10000.");
    }
    return this.request<CodeforcesSubmission[]>("user.status", {
      handle: normalizedHandle,
      from: "1",
      count: String(count),
    });
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
   * Danh sách problem có thể resolve. Codeforces đôi lúc loại một phần archive khỏi
   * problemset.problems; khi đó dùng metadata Kira để khôi phục ID, tên và rating.
   */
  async fetchResolvableProblems(forceRefresh = false): Promise<CodeforcesProblem[]> {
    const official = await this.fetchPublicProblems(forceRefresh);
    try {
      const external = await this.fetchKiraProblems(forceRefresh);
      const known = new Set(
        official
          .filter((problem) => problem.contestId)
          .map((problem) => `${problem.contestId}:${problem.index.toUpperCase()}`)
      );
      const fallback: CodeforcesProblem[] = [];
      for (const [key, problem] of external) {
        if (known.has(key)) continue;
        fallback.push({
          contestId: problem.contestId,
          index: problem.index,
          name: problem.name,
          type: "PROGRAMMING",
          rating: problem.rating,
          tags: [],
        });
      }
      return [...official, ...fallback];
    } catch (err) {
      getLogger().warn("[codeforces] Không lấy được metadata problem external", {
        urls: this.kiraRatingsUrls,
        error: err instanceof Error ? err.message : String(err),
      });
      return official;
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

    const publicProblems = await this.fetchResolvableProblems();
    return publicProblems.some(
      (problem) =>
        problem.contestId === contestId &&
        problem.index.toUpperCase() === normalizedIndex
    );
  }

  /**
   * Lấy difficulty theo thứ tự: Codeforces official -> dataset public của
   * cf.kira924age.com -> unrated. Dataset external được cache 1 giờ mặc định.
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
    if (problem && Number.isFinite(problem.rating)) {
      return { rating: problem.rating, source: "codeforces" };
    }

    try {
      const externalProblem = (await this.fetchKiraProblems()).get(
        `${contestId}:${normalizedIndex}`
      );
      if (!problem && !externalProblem) {
        throw new ValidationError(`Không tìm thấy bài public ${contestId}${normalizedIndex}.`);
      }
      return Number.isFinite(externalProblem?.rating)
        ? { rating: externalProblem!.rating, source: "kira" }
        : { source: "unrated" };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      if (!problem) {
        throw new ValidationError(
          `Không thể xác minh bài public ${contestId}${normalizedIndex} vì nguồn metadata external đang lỗi.`
        );
      }
      // External fallback không được làm /task add thất bại khi nguồn tạm offline.
      getLogger().warn("[codeforces] Không lấy được rating external", {
        contestId,
        problemIndex: normalizedIndex,
        urls: this.kiraRatingsUrls,
        error: err instanceof Error ? err.message : String(err),
      });
      return { source: "unrated" };
    }
  }

  private async fetchKiraProblems(
    forceRefresh = false
  ): Promise<Map<string, KiraProblemMetadata>> {
    if (
      !forceRefresh &&
      this.kiraProblemsCache &&
      this.kiraProblemsCache.expiresAt > Date.now()
    ) {
      return this.kiraProblemsCache.problems;
    }
    if (!forceRefresh && this.kiraProblemsInFlight) return this.kiraProblemsInFlight;

    const request = (async (): Promise<Map<string, KiraProblemMetadata>> => {
      let contests: KiraContest[] | null = null;
      const errors: string[] = [];
      for (const url of this.kiraRatingsUrls) {
        try {
          const response = await this.fetchImpl(url, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          const body = await response.text();
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const parsed = JSON.parse(body) as KiraContest[];
          if (!Array.isArray(parsed)) throw new Error("response không phải mảng contest");
          contests = parsed;
          break;
        } catch (err) {
          errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!contests) {
        throw new CodeforcesApiError(
          `Không thể tải nguồn rating Kira từ mọi mirror: ${errors.join(" | ")}`
        );
      }

      const problems = new Map<string, KiraProblemMetadata>();
      for (const contest of contests) {
        if (!Number.isInteger(contest?.id) || !Array.isArray(contest.problems)) continue;
        for (const problem of contest.problems) {
          if (!problem?.index || !problem.name?.trim()) continue;
          const index = problem.index.trim().toUpperCase();
          const rating = Number(problem.rating);
          problems.set(`${contest.id}:${index}`, {
            contestId: contest.id!,
            index,
            name: problem.name.trim(),
            rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
          });
        }
      }
      this.kiraProblemsCache = {
        expiresAt: Date.now() + this.externalRatingsCacheTtlMs,
        problems,
      };
      return problems;
    })();
    this.kiraProblemsInFlight = request;
    try {
      return await request;
    } finally {
      if (this.kiraProblemsInFlight === request) this.kiraProblemsInFlight = null;
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

export function fetchResolvableCodeforcesProblems(
  forceRefresh = false
): Promise<CodeforcesProblem[]> {
  return defaultClient.fetchResolvableProblems(forceRefresh);
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
