import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FocusScheduler } from "../src/scheduler/focusScheduler";

test("sleep unlock persists across midnight and ends after 05:00", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-focus-test-"));
  const file = path.join(dir, "schedule.json");
  try {
    const scheduler = new FocusScheduler(file, async () => {}, async () => {}, async () => {}, async () => {});
    const evening = new Date(2026, 8, 2, 22, 30);
    assert.equal(scheduler.isWithinSleepTimeRange(evening), true);
    const start = scheduler.getSleepUnlockStatus(evening).sessionStartedAt!;
    const accepted = [1, 2, 3].map((minute) =>
      new Date(new Date(start).getTime() + minute * 60_000).toISOString()
    );
    assert.equal(scheduler.recordSleepAcceptedTasks(accepted, evening).eligible, true);
    assert.equal(scheduler.disableSleepForCurrentSession(evening), true);
    const nextMorning = new Date(2026, 8, 3, 4, 30);
    assert.equal(scheduler.getSleepUnlockStatus(nextMorning).disabled, true);
    assert.equal(scheduler.isWithinSleepWindow(nextMorning), false);
    assert.equal(scheduler.isWithinSleepTimeRange(new Date(2026, 8, 3, 5, 1)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recurring schedule and sleep can overlap without losing either owner", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-focus-overlap-"));
  const file = path.join(dir, "schedule.json");
  try {
    const scheduler = new FocusScheduler(file, async () => {}, async () => {}, async () => {}, async () => {});
    const at2230 = new Date(2026, 8, 2, 22, 30);
    scheduler.addRecurring([at2230.getDay()], "06:00", "23:00");
    assert.equal(scheduler.isWithinScheduleWindowToday(at2230), true);
    assert.equal(scheduler.isWithinSleepWindow(at2230), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an earlier focus off unlocks sleep mode without three new AC tasks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-focus-prior-off-"));
  const file = path.join(dir, "schedule.json");
  try {
    const scheduler = new FocusScheduler(file, async () => {}, async () => {}, async () => {}, async () => {});
    const daytime = new Date(2026, 8, 2, 18, 0);
    scheduler.recordFocusOff(daytime);

    const evening = new Date(2026, 8, 2, 22, 30);
    const status = scheduler.getSleepUnlockStatus(evening);
    assert.equal(status.acceptedTaskCount, 0);
    assert.equal(status.unlockedByEarlierFocusOff, true);
    assert.equal(status.eligible, true);
    assert.equal(scheduler.disableSleepForCurrentSession(evening), true);

    const nextEvening = new Date(2026, 8, 3, 22, 30);
    assert.equal(scheduler.getSleepUnlockStatus(nextEvening).unlockedByEarlierFocusOff, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sleep break lasts one hour and is available once per sleep session on all days", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-sleep-break-"));
  const file = path.join(dir, "schedule.json");
  try {
    const scheduler = new FocusScheduler(file, async () => {}, async () => {}, async () => {}, async () => {});
    const fridayNight = new Date(2026, 8, 4, 22, 30);
    assert.equal(scheduler.getSleepUnlockStatus(fridayNight).weekendSession, true);

    const thursdayNight = new Date(2026, 8, 3, 22, 30);
    assert.equal(scheduler.getSleepUnlockStatus(thursdayNight).weekendSession, true);

    const saturdayNight = new Date(2026, 8, 5, 22, 30);
    assert.equal(scheduler.getSleepUnlockStatus(saturdayNight).weekendSession, true);
    assert.equal(scheduler.startWeekendSleepBreak(saturdayNight), true);

    const duringBreak = new Date(2026, 8, 5, 23, 0);
    const active = scheduler.getSleepUnlockStatus(duringBreak);
    assert.equal(active.breakUsed, true);
    assert.equal(active.breakActive, true);
    assert.equal(active.breakRemainingMs, 30 * 60 * 1000);
    assert.equal(scheduler.isWithinSleepWindow(duringBreak), false);
    assert.equal(scheduler.startWeekendSleepBreak(duringBreak), false);

    const afterMidnight = new Date(2026, 8, 6, 0, 45);
    const persisted = new FocusScheduler(file, async () => {}, async () => {}, async () => {}, async () => {});
    assert.equal(persisted.getSleepUnlockStatus(afterMidnight).weekendSession, true);
    assert.equal(persisted.getSleepUnlockStatus(afterMidnight).breakUsed, true);
    assert.equal(persisted.getSleepUnlockStatus(afterMidnight).breakActive, false);
    assert.equal(persisted.startWeekendSleepBreak(afterMidnight), false);

    const mondayNight = new Date(2026, 8, 7, 22, 30);
    assert.equal(persisted.getSleepUnlockStatus(mondayNight).weekendSession, true);
    assert.equal(persisted.startWeekendSleepBreak(mondayNight), true);

    const daytime = new Date(2026, 8, 8, 14, 0);
    assert.equal(persisted.getSleepUnlockStatus(daytime).withinTimeRange, false);
    assert.equal(persisted.startWeekendSleepBreak(daytime), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
