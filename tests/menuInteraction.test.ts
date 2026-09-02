import assert from "node:assert/strict";
import test from "node:test";
import type TelegramBot from "node-telegram-bot-api";
import type { CodeforcesTaskServiceApi } from "../src/services/codeforcesTaskService";
import type { DeviceInfoServiceApi } from "../src/services/deviceInfoService";
import type { FocusServiceApi, FocusStatus } from "../src/services/focusService";
import { attachMenuInteraction } from "../src/telegram/menuInteraction";

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

test("dashboard break and focus off require previously refreshed gate state", async () => {
  let callback: ((query: TelegramBot.CallbackQuery) => void) | undefined;
  const bot = {
    on: (event: string, handler: (query: TelegramBot.CallbackQuery) => void) => {
      if (event === "callback_query") callback = handler;
    },
    answerCallbackQuery: async () => true,
    editMessageText: async () => ({}),
    sendMessage: async () => ({}),
  } as unknown as TelegramBot;

  const status: FocusStatus = {
    active: true,
    remainingMs: null,
    withinSchedule: true,
    withinSleep: false,
    onBreak: false,
    breakRemainingMs: null,
    sleepUnlock: {
      withinTimeRange: false,
      acceptedTaskCount: 0,
      requiredTaskCount: 3,
      eligible: false,
      disabled: false,
    },
  };
  let refreshCalls = 0;
  let breakAssertions = 0;
  let offAssertions = 0;
  const taskService = {
    refresh: async () => {
      refreshCalls++;
      return { checked: 0, newlySolved: [], stillActive: [], ratingsUpdated: 0 };
    },
    assertBreakAllowed: () => { breakAssertions++; },
    recordBreakStarted: () => undefined,
    assertFocusOffAllowed: () => { offAssertions++; },
    getDailyGateStatus: () => ({
      date: "2026-09-02",
      focusOffAcceptedCount: 7,
      acceptedSinceLastBreak: 1,
      breakRequiredCount: 1,
      focusOffRequiredCount: 7,
      breakAllowed: true,
      focusOffAllowed: true,
    }),
    listTasks: () => [],
  } as unknown as CodeforcesTaskServiceApi;
  const focusService = {
    status: () => status,
    breakFocus: async () => undefined,
    disable: async () => ({ sleepModeDisabled: false, focusStillActive: false }),
    breakUsageRemainingToday: () => ({ breaksRemaining: 4, totalMsRemaining: 3_600_000 }),
  } as unknown as FocusServiceApi;
  const deviceInfoService = {
    getDeviceInfo: async () => ({ source: "cache" }),
  } as unknown as DeviceInfoServiceApi;

  attachMenuInteraction(bot, focusService, taskService, deviceInfoService, "owner", 42);
  assert.ok(callback);
  const query = (action: string): TelegramBot.CallbackQuery => ({
    id: `query-${action}`,
    from: { id: 42, is_bot: false, first_name: "Owner" },
    chat_instance: "test",
    data: `dash:${action}`,
    message: {
      message_id: 9,
      date: 0,
      chat: { id: 42, type: "private", first_name: "Owner" },
    },
  });

  callback!(query("break"));
  await flush();
  callback!(query("off"));
  await flush();

  assert.equal(refreshCalls, 0, "break/off must never fetch submissions implicitly");
  assert.equal(breakAssertions, 1);
  assert.equal(offAssertions, 1);
});
