import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readJsonState, writeJsonState } from "../src/utils/jsonStore";

test("JSON store restores the last valid backup when the main file is corrupt", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-json-test-"));
  const file = path.join(dir, "state.json");
  try {
    writeJsonState(file, { value: 1 });
    writeJsonState(file, { value: 2 });
    writeFileSync(file, "{broken", "utf-8");
    assert.deepEqual(readJsonState(file, { value: 0 }), { value: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
