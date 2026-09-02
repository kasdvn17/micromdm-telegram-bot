import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Response } from "node-fetch";
import { createCodeforcesTaskService } from "../src/services/codeforcesTaskService";
import { CodeforcesClient } from "../src/utils/codeforces";

function fixture(state: unknown): { filePath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-cf-test-"));
  const filePath = path.join(dir, "tasks.json");
  writeFileSync(filePath, JSON.stringify(state));
  return { filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("daily gate uses configured timezone and injected clock", () => {
  const data = fixture({
    users: {
      "42": {
        tasks: [
          {
            contestId: 1,
            index: "A",
            name: "A",
            status: "solved",
            addedAt: "2026-09-01T00:00:00.000Z",
            solvedAt: "2026-09-02T17:10:00.000Z",
          },
        ],
      },
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist", undefined, {
      now: () => new Date("2026-09-02T17:30:00.000Z"),
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const status = service.getDailyGateStatus(42);
    assert.equal(status.date, "2026-09-03");
    assert.equal(status.acceptedSinceLastBreak, 1);
    assert.equal(status.breakAllowed, true);
  } finally {
    data.cleanup();
  }
});

test("task tags can be assigned, removed and cleared without losing solvedAt", () => {
  const data = fixture({
    users: {
      "42": {
        tasks: [
          {
            contestId: 2255,
            index: "B",
            name: "A Ribbon for Tomorrow",
            status: "solved",
            addedAt: "2026-09-01T00:00:00.000Z",
            solvedAt: "2026-09-01T01:00:00.000Z",
          },
        ],
      },
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist");
    assert.deepEqual(service.editTaskTag(42, "2255B", "add", "DP").tags, ["dp"]);
    assert.deepEqual(service.editTaskTag(42, "2255B", "add", "hard").tags, ["dp", "hard"]);
    assert.deepEqual(service.editTaskTag(42, "2255B", "remove", "dp").tags, ["hard"]);
    const cleared = service.editTaskTag(42, "2255B", "clear");
    assert.deepEqual(cleared.tags, []);
    assert.equal(cleared.solvedAt, "2026-09-01T01:00:00.000Z");
  } finally {
    data.cleanup();
  }
});

test("archiving solved tasks preserves their gate contribution", () => {
  const data = fixture({
    users: {
      "42": {
        tasks: [
          {
            contestId: 2255,
            index: "B",
            name: "A Ribbon for Tomorrow",
            status: "solved",
            addedAt: "2026-09-02T00:00:00.000Z",
            solvedAt: "2026-09-02T03:00:00.000Z",
          },
        ],
      },
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist", undefined, {
      now: () => new Date("2026-09-02T04:00:00.000Z"),
      timeZone: "UTC",
    });
    assert.equal(service.archiveSolvedTasks(42), 1);
    assert.equal(service.getDailyGateStatus(42).acceptedSinceLastBreak, 1);
  } finally {
    data.cleanup();
  }
});

test("atomic bulk writes nothing when one task is below rating threshold", async () => {
  const data = fixture({ users: {} });
  const client = new CodeforcesClient({
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (url.includes("problemset.problems")) {
        return new Response(JSON.stringify({
          status: "OK",
          result: {
            problems: [
              { contestId: 100, index: "A", name: "Allowed", type: "PROGRAMMING", rating: 1600, tags: [] },
              { contestId: 100, index: "B", name: "Too Easy", type: "PROGRAMMING", rating: 1500, tags: [] },
            ],
            problemStatistics: [],
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist", client);
    await assert.rejects(() => service.addTasksAtomic(42, ["100A", "100B"]), />= 1600/);
    assert.equal(service.listTasks(42).length, 0);
  } finally {
    data.cleanup();
  }
});

test("refresh stores earliest AC then switches to incremental submission sync", async () => {
  const data = fixture({
    users: {
      "42": {
        tasks: [{
          contestId: 100,
          index: "A",
          name: "Allowed",
          status: "active",
          addedAt: "2026-09-02T03:00:00.000Z",
          rating: 1600,
          ratingSource: "codeforces",
        }],
      },
    },
  });
  const submission = (id: number, seconds: number) => ({
    id,
    contestId: 100,
    creationTimeSeconds: seconds,
    relativeTimeSeconds: 0,
    problem: { contestId: 100, index: "A", name: "Allowed", type: "PROGRAMMING", rating: 1600, tags: [] },
    author: { members: [{ handle: "tourist" }], participantType: "PRACTICE", ghost: false },
    programmingLanguage: "C++",
    verdict: "OK",
    testset: "TESTS",
    passedTestCount: 1,
    timeConsumedMillis: 1,
    memoryConsumedBytes: 1,
  });
  const userStatusCounts: string[] = [];
  const client = new CodeforcesClient({
    pageSize: 100,
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (url.includes("problemset.problems")) {
        return new Response(JSON.stringify({
          status: "OK",
          result: {
            problems: [{ contestId: 100, index: "A", name: "Allowed", type: "PROGRAMMING", rating: 1600, tags: [] }],
            problemStatistics: [],
          },
        }), { status: 200 });
      }
      const count = new URL(url).searchParams.get("count") ?? "";
      userStatusCounts.push(count);
      return new Response(JSON.stringify({
        status: "OK",
        result: [submission(2, 200), submission(1, 100)],
      }), { status: 200 });
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist", client, {
      now: () => new Date("2026-09-02T04:00:00.000Z"),
      timeZone: "UTC",
    });
    const first = await service.refresh(42);
    assert.equal(first.syncMode, "full");
    assert.equal(first.tasks[0].solvedAt, "1970-01-01T00:01:40.000Z");
    const second = await service.refresh(42);
    assert.equal(second.syncMode, "incremental");
    assert.deepEqual(userStatusCounts, ["100", "1000"]);
  } finally {
    data.cleanup();
  }
});
