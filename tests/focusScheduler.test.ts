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
