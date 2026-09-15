import assert from "node:assert/strict";
import test from "node:test";
import { createFocusCommand } from "../src/commands/normal/focus.command";
import type { CodeforcesTaskServiceApi } from "../src/services/codeforcesTaskService";
import type { FocusServiceApi } from "../src/services/focusService";
import type { CommandContext } from "../src/types/command.types";

test("focus off bypasses every Codeforces gate", async () => {
  let disableCalls = 0;
  let gateCalls = 0;
  const focusService = {
    disable: async () => {
      disableCalls++;
      return { sleepModeDisabled: true, focusStillActive: false };
    },
  } as unknown as FocusServiceApi;
  const taskService = {
    assertBreakAllowed: () => undefined,
    recordBreakStarted: () => undefined,
    getDailyGateStatus: () => {
      gateCalls++;
      throw new Error("focus off must not inspect the Codeforces gate");
    },
  } as unknown as CodeforcesTaskServiceApi;
  const command = createFocusCommand(focusService, taskService);
  const ctx: CommandContext = {
    message: {
      telegramId: 42,
      chatId: 42,
      rawText: "/focus off",
    },
    parsed: { name: "focus", subcommand: "off", args: [] },
    effectiveArgs: ["off"],
    progress: async () => undefined,
  };

  const response = await command.handler(ctx);
  assert.equal(disableCalls, 1);
  assert.equal(gateCalls, 0);
  assert.equal(response, "🌙 Sleep Mode đã tắt cho phần còn lại của phiên hôm nay.");
});
