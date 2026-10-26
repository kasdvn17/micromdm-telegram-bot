import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createFocusCommand } from "../src/commands/normal/focus.command";
import { EventBus } from "../src/events/eventBus";
import { DeviceCommands } from "../src/micromdm/deviceCommands";
import { FocusScheduler } from "../src/scheduler/focusScheduler";
import type { CodeforcesTaskServiceApi } from "../src/services/codeforcesTaskService";
import { createFocusService, type FocusServiceApi } from "../src/services/focusService";
import type { SafeModeServiceApi } from "../src/services/safeModeService";
import type { CommandContext } from "../src/types/command.types";
import { ValidationError } from "../src/utils/errors";

function makeContext(subcommand: string, args: string[] = []): CommandContext {
  return {
    message: {
      telegramId: 42,
      chatId: 42,
      rawText: `/focus ${subcommand} ${args.join(" ")}`.trim(),
    },
    parsed: { name: "focus", subcommand, args },
    effectiveArgs: [subcommand, ...args],
    progress: async () => undefined,
  };
}

test("focus schedule skip is strictly blocked on weekdays and allowed on weekends", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-skip-test-"));
  try {
    const schedulePath = path.join(dir, "schedule.json");
    const restrictedAppsPath = path.join(dir, "restricted-apps.json");
    const websitesPath = path.join(dir, "websites.json");
    writeFileSync(restrictedAppsPath, "[]");
    writeFileSync(websitesPath, "[]");

    const scheduler = new FocusScheduler(
      schedulePath,
      async () => {},
      async () => {},
      async () => {},
      async () => {}
    );
    const bus = new EventBus();
    const dummyDevice = {
      installProfile: async () => {},
      removeProfile: async () => {},
    } as unknown as DeviceCommands;
    const dummySafe = {
      isActive: () => false,
    } as unknown as SafeModeServiceApi;

    const focusService = createFocusService(
      dummyDevice,
      scheduler,
      restrictedAppsPath,
      websitesPath,
      dummySafe,
      bus
    );

    // Monday: 2026-10-19
    const monday = new Date(2026, 9, 19, 10, 0);
    assert.equal(monday.getDay(), 1);
    await assert.rejects(
      async () => {
        await focusService.skipToday(undefined, monday);
      },
      (err: unknown) => {
        assert(err instanceof ValidationError);
        assert.equal(
          err.message,
          "/focus schedule skip chỉ dùng được vào Thứ 7/Chủ Nhật - không dùng được các ngày trong tuần (Thứ 2 - Thứ 6)."
        );
        return true;
      }
    );

    // Wednesday: 2026-10-21
    const wednesday = new Date(2026, 9, 21, 14, 0);
    assert.equal(wednesday.getDay(), 3);
    await assert.rejects(
      async () => {
        await focusService.skipToday(undefined, wednesday);
      },
      (err: unknown) => {
        assert(err instanceof ValidationError);
        assert.equal(
          err.message,
          "/focus schedule skip chỉ dùng được vào Thứ 7/Chủ Nhật - không dùng được các ngày trong tuần (Thứ 2 - Thứ 6)."
        );
        return true;
      }
    );

    // Saturday: 2026-10-24
    const saturday = new Date(2026, 9, 24, 10, 0);
    assert.equal(saturday.getDay(), 6);
    // Add schedule on Saturday
    scheduler.addRecurring([6], "08:00", "20:00");
    const skippedSat = await focusService.skipToday(undefined, saturday);
    assert.equal(skippedSat.recurring?.skippedDate, "2026-10-24");

    // Sunday: 2026-10-25
    const sunday = new Date(2026, 9, 25, 10, 0);
    assert.equal(sunday.getDay(), 0);
    scheduler.addRecurring([0], "08:00", "20:00");
    const skippedSun = await focusService.skipToday(undefined, sunday);
    assert.equal(skippedSun.recurring?.skippedDate, "2026-10-25");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("focus off in sleep mode enforces 3 new AC tasks unless previously unlocked", async () => {
  let disableCalls = 0;
  let disableUnlockedArg: boolean | undefined;
  const status = {
    active: true,
    remainingMs: null,
    onBreak: false,
    breakRemainingMs: null,
    withinSchedule: false,
    withinSleep: true,
    sleepUnlock: {
      withinTimeRange: true,
      sessionStartedAt: "2026-10-23T22:00:00.000Z",
      acceptedTaskCount: 0,
      requiredTaskCount: 3,
      eligible: false,
      unlockedByEarlierFocusOff: false,
      disabled: false,
      weekendSession: true,
      breakUsed: true,
      breakActive: false,
      breakRemainingMs: 0,
    },
  };

  const focusService = {
    status: () => status,
    disable: async (unlocked?: boolean) => {
      disableCalls++;
      disableUnlockedArg = unlocked;
      return { sleepModeDisabled: true, focusStillActive: false };
    },
  } as unknown as FocusServiceApi;

  let assertedSince: string | undefined;
  let assertedCount: number | undefined;
  let gateAllowed = false;

  const taskService = {
    assertFocusOffAllowed: (_userId: number, options?: { since?: string; requiredCount?: number }) => {
      assertedSince = options?.since;
      assertedCount = options?.requiredCount;
      if (!gateAllowed) {
        throw new ValidationError("Đang trong Sleep Mode: bạn mới AC 0/3 bài.");
      }
    },
    getDailyGateStatus: () => ({
      date: "2026-10-23",
      breakAllowed: false,
      focusOffAllowed: false,
      breakRequiredCount: 1,
      focusOffRequiredCount: 7,
      acceptedSinceLastBreak: 0,
      focusOffAcceptedCount: 0,
    }),
  } as unknown as CodeforcesTaskServiceApi;

  const command = createFocusCommand(focusService, taskService);

  // Attempt 1: Sleep mode, 0 tasks solved -> must assert gate with 3 tasks and throw
  await assert.rejects(
    async () => {
      await command.handler(makeContext("off"));
    },
    (err: unknown) => {
      assert(err instanceof ValidationError);
      assert.equal((err as Error).message, "Đang trong Sleep Mode: bạn mới AC 0/3 bài.");
      return true;
    }
  );
  assert.equal(disableCalls, 0);
  assert.equal(assertedSince, "2026-10-23T22:00:00.000Z");
  assert.equal(assertedCount, 3);

  // Attempt 2: Gate passes (3 tasks solved) -> disable(true) is called
  gateAllowed = true;
  const replySuccess = await command.handler(makeContext("off"));
  assert.equal(disableCalls, 1);
  assert.equal(disableUnlockedArg, true);
  assert.equal(replySuccess, "🌙 Sleep Mode đã tắt cho phần còn lại của phiên hôm nay.");

  // Attempt 3: unlockedByEarlierFocusOff is true -> bypasses gate assertion
  disableCalls = 0;
  gateAllowed = false; // Even if gate is not allowed, bypass applies
  status.sleepUnlock.unlockedByEarlierFocusOff = true;
  assertedSince = undefined;
  assertedCount = undefined;

  const replyBypass = await command.handler(makeContext("off"));
  assert.equal(disableCalls, 1);
  assert.equal(disableUnlockedArg, true);
  assert.equal(assertedCount, undefined, "assertFocusOffAllowed should not be called when bypassed");
  assert.equal(replyBypass, "🌙 Sleep Mode đã tắt cho phần còn lại của phiên hôm nay.");
});

test("focus off in daytime enforces 7 daily AC tasks", async () => {
  let disableCalls = 0;
  let disableUnlockedArg: boolean | undefined;
  const status = {
    active: true,
    remainingMs: null,
    onBreak: false,
    breakRemainingMs: null,
    withinSchedule: true,
    withinSleep: false,
    sleepUnlock: {
      withinTimeRange: false,
      sessionStartedAt: null,
      acceptedTaskCount: 0,
      requiredTaskCount: 3,
      eligible: false,
      unlockedByEarlierFocusOff: false,
      disabled: false,
      weekendSession: true,
      breakUsed: true,
      breakActive: false,
      breakRemainingMs: 0,
    },
  };

  const focusService = {
    status: () => status,
    disable: async (unlocked?: boolean) => {
      disableCalls++;
      disableUnlockedArg = unlocked;
      return { sleepModeDisabled: false, focusStillActive: false };
    },
  } as unknown as FocusServiceApi;

  let assertedCount: number | undefined;
  let gateAllowed = false;

  const taskService = {
    assertFocusOffAllowed: (_userId: number, options?: { since?: string; requiredCount?: number }) => {
      assertedCount = options?.requiredCount;
      if (!gateAllowed) {
        throw new ValidationError("Chưa đủ 7 task/ngày.");
      }
    },
    getDailyGateStatus: () => ({
      date: "2026-10-23",
      breakAllowed: false,
      focusOffAllowed: false,
      breakRequiredCount: 1,
      focusOffRequiredCount: 7,
      acceptedSinceLastBreak: 0,
      focusOffAcceptedCount: 0,
    }),
  } as unknown as CodeforcesTaskServiceApi;

  const command = createFocusCommand(focusService, taskService);

  // Daytime: not enough tasks -> throws, disable not called
  await assert.rejects(
    async () => {
      await command.handler(makeContext("off"));
    },
    (err: unknown) => {
      assert(err instanceof ValidationError);
      assert.equal((err as Error).message, "Chưa đủ 7 task/ngày.");
      return true;
    }
  );
  assert.equal(disableCalls, 0);
  assert.equal(assertedCount, 7);

  // Daytime: tasks met -> calls disable(true)
  gateAllowed = true;
  const reply = await command.handler(makeContext("off"));
  assert.equal(disableCalls, 1);
  assert.equal(disableUnlockedArg, true);
  assert.equal(reply, "🎯 Focus mode đã TẮT.");
});

test("focus off passes false to disable when codeforces task service is absent", async () => {
  let disableCalls = 0;
  let disableUnlockedArg: boolean | undefined;
  const status = {
    active: true,
    remainingMs: null,
    onBreak: false,
    breakRemainingMs: null,
    withinSchedule: false,
    withinSleep: false,
    sleepUnlock: {
      withinTimeRange: false,
      sessionStartedAt: null,
      acceptedTaskCount: 0,
      requiredTaskCount: 3,
      eligible: false,
      unlockedByEarlierFocusOff: false,
      disabled: false,
      weekendSession: true,
      breakUsed: true,
      breakActive: false,
      breakRemainingMs: 0,
    },
  };

  const focusService = {
    status: () => status,
    disable: async (unlocked?: boolean) => {
      disableCalls++;
      disableUnlockedArg = unlocked;
      return { sleepModeDisabled: false, focusStillActive: false };
    },
  } as unknown as FocusServiceApi;

  const command = createFocusCommand(focusService, undefined);
  const reply = await command.handler(makeContext("off"));

  assert.equal(disableCalls, 1);
  assert.equal(disableUnlockedArg, false);
  assert.equal(reply, "🎯 Focus mode đã TẮT.");
});

test("focus off in any sleep session allows 1-hour break without AC tasks", async () => {
  let breakFocusCalls = 0;
  let breakMsArg: number | undefined;
  let disableCalls = 0;

  const status = {
    active: true,
    remainingMs: null,
    onBreak: false,
    breakRemainingMs: null,
    withinSchedule: false,
    withinSleep: true,
    sleepUnlock: {
      withinTimeRange: true,
      sessionStartedAt: "2026-10-23T22:00:00.000Z",
      acceptedTaskCount: 0,
      requiredTaskCount: 3,
      eligible: false,
      unlockedByEarlierFocusOff: false,
      disabled: false,
      weekendSession: true,
      breakUsed: false,
      breakActive: false,
      breakRemainingMs: 0,
    },
  };

  const focusService = {
    status: () => status,
    breakFocus: async (ms: number) => {
      breakFocusCalls++;
      breakMsArg = ms;
      status.sleepUnlock.breakUsed = true;
      status.sleepUnlock.breakActive = true;
      status.sleepUnlock.breakRemainingMs = ms;
    },
    disable: async () => {
      disableCalls++;
      return { sleepModeDisabled: true, focusStillActive: false };
    },
  } as unknown as FocusServiceApi;

  let gateAllowed = false;
  const taskService = {
    assertFocusOffAllowed: () => {
      if (!gateAllowed) {
        throw new ValidationError("Đang trong Sleep Mode: cần 3 task AC.");
      }
    },
    getDailyGateStatus: () => ({
      date: "2026-10-23",
      breakAllowed: false,
      focusOffAllowed: false,
      breakRequiredCount: 1,
      focusOffRequiredCount: 7,
      acceptedSinceLastBreak: 0,
      focusOffAcceptedCount: 0,
    }),
  } as unknown as CodeforcesTaskServiceApi;

  const command = createFocusCommand(focusService, taskService);

  // Case 1: /focus off 1h -> starts 1h break directly
  const reply1 = await command.handler(makeContext("off", ["1h"]));
  assert.equal(breakFocusCalls, 1);
  assert.equal(breakMsArg, 3600000);
  assert.equal(disableCalls, 0);
  assert.equal(
    reply1,
    "🌙 Đã bắt đầu tắt Focus 1 giờ (Sleep break). Đây là lượt duy nhất của phiên Sleep này."
  );

  // Reset breakUsed for next test
  status.sleepUnlock.breakUsed = false;
  status.sleepUnlock.breakActive = false;
  breakFocusCalls = 0;
  breakMsArg = undefined;

  // Case 2: /focus off (no args, 0 tasks solved) -> falls back to 1h break
  const reply2 = await command.handler(makeContext("off"));
  assert.equal(breakFocusCalls, 1);
  assert.equal(breakMsArg, 3600000);
  assert.equal(disableCalls, 0);
  assert.equal(
    reply2,
    "🌙 Đã bắt đầu tắt Focus 1 giờ (Sleep break). Đây là lượt duy nhất của phiên Sleep này."
  );

  // Case 3: Once break is used, /focus off cannot use break again, requires 3 tasks
  await assert.rejects(
    async () => {
      await command.handler(makeContext("off"));
    },
    (err: unknown) => {
      assert(err instanceof ValidationError);
      assert.equal((err as Error).message, "Đang trong Sleep Mode: cần 3 task AC.");
      return true;
    }
  );

  // Case 4: When 3 tasks are solved, /focus off completely disables Sleep Mode
  gateAllowed = true;
  const reply4 = await command.handler(makeContext("off"));
  assert.equal(disableCalls, 1);
  assert.equal(reply4, "🌙 Sleep Mode đã tắt cho phần còn lại của phiên hôm nay.");
});
