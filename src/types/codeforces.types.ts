export type CodeforcesVerdict =
  | "FAILED"
  | "OK"
  | "PARTIAL"
  | "COMPILATION_ERROR"
  | "RUNTIME_ERROR"
  | "WRONG_ANSWER"
  | "PRESENTATION_ERROR"
  | "TIME_LIMIT_EXCEEDED"
  | "MEMORY_LIMIT_EXCEEDED"
  | "IDLENESS_LIMIT_EXCEEDED"
  | "SECURITY_VIOLATED"
  | "CRASHED"
  | "INPUT_PREPARATION_CRASHED"
  | "CHALLENGED"
  | "SKIPPED"
  | "TESTING"
  | "REJECTED"
  | "SUBMITTED";

export interface CodeforcesProblem {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  type: "PROGRAMMING" | "QUESTION";
  points?: number;
  rating?: number;
  tags: string[];
}

export type CodeforcesProblemRatingSource = "codeforces" | "kira" | "unrated";

export interface ResolvedCodeforcesProblemRating {
  rating?: number;
  source: CodeforcesProblemRatingSource;
}

export interface CodeforcesMember {
  handle: string;
  name?: string;
}

export interface CodeforcesParty {
  contestId?: number;
  members: CodeforcesMember[];
  participantType: "CONTESTANT" | "PRACTICE" | "VIRTUAL" | "MANAGER" | "OUT_OF_COMPETITION";
  teamId?: number;
  teamName?: string;
  ghost: boolean;
  room?: number;
  startTimeSeconds?: number;
}

export interface CodeforcesSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  relativeTimeSeconds: number;
  problem: CodeforcesProblem;
  author: CodeforcesParty;
  programmingLanguage: string;
  verdict?: CodeforcesVerdict;
  testset: string;
  passedTestCount: number;
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
  points?: number;
}

export interface CodeforcesProblemStatistics {
  contestId?: number;
  index: string;
  solvedCount: number;
}

export interface CodeforcesProblemsetResult {
  problems: CodeforcesProblem[];
  problemStatistics: CodeforcesProblemStatistics[];
}

export type CodeforcesApiResponse<T> =
  | { status: "OK"; result: T }
  | { status: "FAILED"; comment?: string };
