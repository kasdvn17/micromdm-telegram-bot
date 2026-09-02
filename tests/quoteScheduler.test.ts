import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createQuoteScheduler } from "../src/scheduler/quoteScheduler";

test("quote preferences persist and snooze prevents sending", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-quote-test-"));
  const file = path.join(dir, "quote.json");
  let sent = 0;
  const notifier = {
    send: async () => { sent++; return 1; },
    edit: async () => {},
    isEnabled: () => true,
    setEnabled: () => {},
    setChatId: () => {},
  };
  try {
    const scheduler = createQuoteScheduler(notifier, [{ text: "Test", author: "Tester" }], file);
    scheduler.snooze(60_000);
    await scheduler.sendNext();
    assert.equal(sent, 0);
    scheduler.setEnabled(false);
    assert.equal(scheduler.status().enabled, false);
    scheduler.setQuietHours("22:00", "05:00");
    assert.equal(scheduler.status().quietStart, "22:00");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
