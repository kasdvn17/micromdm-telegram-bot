import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Response } from "node-fetch";
import { createCodeforcesTaskService } from "../src/services/codeforcesTaskService";
import { CodeforcesClient } from "../src/utils/codeforces";
import {
  buildBulkTagPrompt,
  buildNextTaskFilterReply,
  buildPrioritizeTaskReply,
  buildTagEditorReply,
  buildTagRemoveReply,
  buildTaskListReply,
  buildTaskTagPickerReply,
} from "../src/telegram/taskTagInteraction";

test("bulk tag prompt offers yes and no only when tasks were added", () => {
  const reply = buildBulkTagPrompt("📦 Done", 42, [
    { contestId: 2000, index: "A" },
    { contestId: 2001, index: "B" },
  ]);
  assert.notEqual(typeof reply, "string");
  if (typeof reply !== "string") {
    const keyboard = reply.options?.reply_markup;
    assert.ok(keyboard && "inline_keyboard" in keyboard);
    if (keyboard && "inline_keyboard" in keyboard) {
      assert.deepEqual(keyboard.inline_keyboard[0].map((button) => button.text), ["Yes", "No"]);
      assert.match(keyboard.inline_keyboard[0][0].callback_data ?? "", /^cft:by:/);
      assert.match(keyboard.inline_keyboard[0][1].callback_data ?? "", /^cft:bn:/);
    }
  }
  assert.equal(buildBulkTagPrompt("📦 No task", 42, []), "📦 No task");
});

test("task list pagination, next task, stats and auto-archive settings use JSON state", () => {
  const tasks = Array.from({ length: 8 }, (_, index) => ({
    contestId: 3000 + index,
    index: "A",
    name: `Problem ${index}`,
    status: index < 2 ? "solved" : "active",
    addedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
    solvedAt: index < 2 ? `2026-09-0${index + 1}T01:00:00.000Z` : undefined,
    rating: 1600 + index * 100,
    tags: index % 2 === 0 ? ["dp"] : ["graph"],
    codeforcesTags: index >= 2 && index <= 4 ? ["combinatorics", "data structures", "math"] : ["greedy"],
  }));
  const data = fixture({ users: { "42": { tasks } } });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist", undefined, {
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      timeZone: "UTC",
    });
    const list = buildTaskListReply(service, 42, { mode: "all" });
    assert.notEqual(typeof list, "string");
    if (typeof list !== "string") {
      const keyboard = list.options?.reply_markup;
      assert.ok(keyboard && "inline_keyboard" in keyboard);
      if (keyboard && "inline_keyboard" in keyboard) {
        assert.ok(keyboard.inline_keyboard.some((row) => row.some((button) => button.text === "1/2")));
      }
    }
    assert.equal(service.nextTask(42, { tag: "dp" }).contestId, 3002);
    assert.equal(service.nextTask(42, { tag: "combinatorics", minRating: 1800 }).contestId, 3002);
    assert.equal(service.nextTask(42, { tag: "data structures", minRating: 1800 }).contestId, 3002);
    assert.notEqual(
      service.nextTask(42, {
        tag: "combinatorics",
        minRating: 1800,
        shuffle: true,
        excludeProblem: "3002A",
      }).contestId,
      3002
    );
    assert.equal(service.prioritizeTask(42, "3004A").contestId, 3004);
    assert.equal(service.nextTask(42, { tag: "dp" }).contestId, 3004);
    assert.equal(service.nextTask(42, { tag: "dp", shuffle: true }).contestId, 3004);
    const prioritizedList = buildTaskListReply(service, 42, { mode: "all" });
    assert.notEqual(typeof prioritizedList, "string");
    if (typeof prioritizedList !== "string") {
      const keyboard = prioritizedList.options?.reply_markup;
      assert.ok(keyboard && "inline_keyboard" in keyboard);
      if (keyboard && "inline_keyboard" in keyboard) {
        assert.ok(keyboard.inline_keyboard[0][0].text.startsWith("📌 3004A"));
      }
    }
    assert.notEqual(
      service.nextTask(42, { tag: "dp", shuffle: true, excludeProblem: "3004A" }).contestId,
      3004
    );
    assert.throws(() => service.prioritizeTask(42, "3000A"), /active/);
    const prioritizePicker = buildPrioritizeTaskReply(service, 42);
    assert.notEqual(typeof prioritizePicker, "string");
    if (typeof prioritizePicker !== "string") {
      const keyboard = prioritizePicker.options?.reply_markup;
      assert.ok(keyboard && "inline_keyboard" in keyboard);
      if (keyboard && "inline_keyboard" in keyboard) {
        assert.ok(keyboard.inline_keyboard.flat().some((button) => button.text.startsWith("📌 3004A")));
      }
    }
    assert.equal(service.clearPrioritizedTask(42), true);
    assert.equal(service.nextTask(42, { tag: "dp" }).contestId, 3002);
    assert.deepEqual(service.listCodeforcesTags(42), ["combinatorics", "data structures", "greedy", "math"]);
    const picker = buildNextTaskFilterReply(service, 42, true);
    assert.notEqual(typeof picker, "string");
    if (typeof picker !== "string") {
      const keyboard = picker.options?.reply_markup;
      assert.ok(keyboard && "inline_keyboard" in keyboard);
      if (keyboard && "inline_keyboard" in keyboard) {
        assert.ok(keyboard.inline_keyboard.flat().some((button) => button.text === "CF · combinatorics"));
      }
    }
    const stats = service.getStats(42);
    assert.equal(stats.solvedTotal, 2);
    assert.equal(stats.active, 6);
    assert.equal(stats.averageSolvedRating, 1650);
    service.setAutoArchive(42, true);
    assert.equal(service.getAutoArchive(42), true);
    service.removeTask(42, "3002A");
    assert.equal(service.listTasks(42).some((task) => task.contestId === 3002), false);
    assert.match(service.undoLastTaskChange(42), /xóa task/);
    assert.equal(service.listTasks(42).some((task) => task.contestId === 3002), true);
  } finally {
    data.cleanup();
  }
});

test("metadata sync backfills official Codeforces tags for existing tasks", async () => {
  const data = fixture({
    users: {
      "42": {
        tasks: [{
          contestId: 1900,
          index: "D",
          name: "Tagged problem",
          status: "active",
          addedAt: "2026-09-01T00:00:00.000Z",
          rating: 1700,
          ratingSource: "codeforces",
        }],
      },
    },
  });
  const client = new CodeforcesClient({
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (url.includes("problemset.problems")) {
        return new Response(JSON.stringify({
          status: "OK",
          result: {
            problems: [{
              contestId: 1900,
              index: "D",
              name: "Tagged problem",
              type: "PROGRAMMING",
              rating: 1700,
              tags: ["dp", "combinatorics"],
            }],
            problemStatistics: [],
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist", client);
    assert.equal(await service.refreshRatings(42), 0);
    assert.deepEqual(service.listTasks(42)[0].codeforcesTags, ["combinatorics", "dp"]);
    assert.deepEqual(service.listCodeforcesTags(42), ["combinatorics", "dp"]);
  } finally {
    data.cleanup();
  }
});

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
      if (url.includes("contests.json")) {
        return new Response(JSON.stringify([]), { status: 200 });
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

test("contest add includes every eligible problem and skips existing or low-rated ones", async () => {
  const data = fixture({
    users: {
      "42": {
        tasks: [{
          contestId: 5000,
          index: "D",
          name: "Already added",
          status: "active",
          addedAt: "2026-09-01T00:00:00.000Z",
          rating: 1800,
        }],
      },
    },
  });
  const client = new CodeforcesClient({
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (url.includes("problemset.problems")) {
        return new Response(JSON.stringify({
          status: "OK",
          result: {
            problems: [
              { contestId: 5000, index: "A", name: "Easy", type: "PROGRAMMING", rating: 1500, tags: ["math"] },
              { contestId: 5000, index: "B", name: "Boundary", type: "PROGRAMMING", rating: 1600, tags: ["dp"] },
              { contestId: 5000, index: "C", name: "External rating", type: "PROGRAMMING", tags: ["combinatorics"] },
              { contestId: 5000, index: "D", name: "Already added", type: "PROGRAMMING", rating: 1800, tags: ["graphs"] },
            ],
            problemStatistics: [],
          },
        }), { status: 200 });
      }
      if (url.includes("contests.json")) {
        return new Response(JSON.stringify([{
          id: 5000,
          type: "Div2",
          name: "Test Round",
          problems: [
            { index: "A", name: "Easy", rating: 1500 },
            { index: "B", name: "Boundary", rating: 1600 },
            { index: "C", name: "External rating", rating: 1700 },
            { index: "D", name: "Already added", rating: 1800 },
          ],
        }]), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist", client);
    const result = await service.addContestTasks(
      42,
      "https://codeforces.com/contest/5000"
    );
    assert.equal(result.totalProblems, 4);
    assert.deepEqual(result.added.map((task) => `${task.contestId}${task.index}`), ["5000B", "5000C"]);
    assert.equal(result.added[0].rating, 1600);
    assert.equal(result.added[1].ratingSource, "kira");
    assert.deepEqual(result.added[1].codeforcesTags, ["combinatorics"]);
    assert.deepEqual(result.skippedExisting, ["5000D"]);
    assert.deepEqual(result.skippedRating, [{ problemId: "5000A", rating: 1500 }]);
    assert.equal(result.failed.length, 0);
    assert.equal(service.listTasks(42).length, 3);
  } finally {
    data.cleanup();
  }
});

test("task add resolves archived problems omitted by the official problemset API", async () => {
  const data = fixture({ users: {} });
  const client = new CodeforcesClient({
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (url.includes("problemset.problems")) {
        return new Response(JSON.stringify({
          status: "OK",
          result: {
            problems: [
              { contestId: 1350, index: "A", name: "Orac and Factors", type: "PROGRAMMING", rating: 900, tags: [] },
            ],
            problemStatistics: [],
          },
        }), { status: 200 });
      }
      if (url.includes("contests.json")) {
        return new Response(JSON.stringify([{
          id: 1350,
          type: "Div2",
          name: "Codeforces Round 641",
          problems: [{ index: "C", name: "Orac and LCM", rating: 1600 }],
        }]), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist", client);
    const task = await service.addTask(42, "1350C");
    assert.equal(task.name, "Orac and LCM");
    assert.equal(task.rating, 1600);
    assert.equal(task.ratingSource, "kira");
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
          prioritizedAt: "2026-09-02T03:05:00.000Z",
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
      if (url.includes("contests.json")) {
        return new Response(JSON.stringify([]), { status: 200 });
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
    assert.equal(first.tasks[0].prioritizedAt, undefined);
    const second = await service.refresh(42);
    assert.equal(second.syncMode, "incremental");
    assert.deepEqual(userStatusCounts, ["100", "1000"]);
  } finally {
    data.cleanup();
  }
});

test("interactive tag picker paginates task buttons", () => {
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    contestId: 2000 + index,
    index: "A",
    name: `Problem ${index}`,
    status: "active",
    addedAt: "2026-09-02T00:00:00.000Z",
  }));
  const data = fixture({ users: { "42": { tasks } } });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist");
    const reply = buildTaskTagPickerReply(service, 42);
    assert.notEqual(typeof reply, "string");
    if (typeof reply === "string") return;
    const keyboard = reply.options?.reply_markup;
    assert.ok(keyboard && "inline_keyboard" in keyboard);
    if (!keyboard || !("inline_keyboard" in keyboard)) return;
    assert.equal(keyboard.inline_keyboard.length, 9);
    assert.match(keyboard.inline_keyboard[0][0].callback_data ?? "", /^cft:s:0:/);
    assert.ok(keyboard.inline_keyboard[8].some((button) => button.text === "1/2"));
  } finally {
    data.cleanup();
  }
});

test("tag registry supports empty tags, editor states and global removal", () => {
  const data = fixture({
    users: {
      "42": {
        tasks: [
          { contestId: 2000, index: "A", name: "One", status: "active", addedAt: "2026-09-02T00:00:00.000Z", tags: ["dp"] },
          { contestId: 2001, index: "B", name: "Two", status: "active", addedAt: "2026-09-02T00:00:00.000Z" },
        ],
      },
    },
  });
  try {
    const service = createCodeforcesTaskService(data.filePath, "tourist");
    assert.deepEqual(service.listTags(42), ["dp"]);
    assert.throws(() => service.createTag(42, "dp"), /đã tồn tại/);
    assert.equal(service.createTag(42, "graph"), "graph");
    assert.deepEqual(service.listTags(42), ["dp", "graph"]);

    const editor = buildTagEditorReply(service, 42, "dp");
    assert.notEqual(typeof editor, "string");
    if (typeof editor !== "string") {
      const keyboard = editor.options?.reply_markup;
      assert.ok(keyboard && "inline_keyboard" in keyboard);
      if (keyboard && "inline_keyboard" in keyboard) {
        assert.match(keyboard.inline_keyboard[0][0].text, /^✅/);
        assert.match(keyboard.inline_keyboard[1][0].text, /^❌/);
      }
    }

    service.editTaskTag(42, "2001B", "add", "dp");
    const remove = buildTagRemoveReply(service, 42, "dp");
    assert.notEqual(typeof remove, "string");
    assert.equal(service.removeTag(42, "dp"), 2);
    assert.ok(service.listTasks(42).every((task) => !(task.tags ?? []).includes("dp")));
    assert.deepEqual(service.listTags(42), ["graph"]);
  } finally {
    data.cleanup();
  }
});
