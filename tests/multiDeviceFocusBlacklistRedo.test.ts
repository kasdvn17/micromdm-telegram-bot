import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FOCUS_PROFILE_IDENTIFIER,
  BLACKLIST_PROFILE_IDENTIFIER,
} from "../src/profiles/profileBuilder";
import { createDeviceManagerService } from "../src/services/deviceManagerService";
import { createFocusService } from "../src/services/focusService";
import { createBlacklistService } from "../src/services/blacklistService";
import { createFocusCommand } from "../src/commands/normal/focus.command";
import { createRedoCommand } from "../src/commands/normal/redo.command";
import { DeviceCommands } from "../src/micromdm/deviceCommands";
import { FocusScheduler } from "../src/scheduler/focusScheduler";
import { EventBus } from "../src/events/eventBus";
import { SafeModeServiceApi } from "../src/services/safeModeService";
import { LapsServiceApi } from "../src/services/lapsService";
import { ValidationError } from "../src/utils/errors";
import { CommandContext } from "../src/types/command.types";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "multi-device-test-"));
}

test("focus and blacklist auto-apply profile to BOTH machines regardless of active target", async () => {
  const tmpDir = createTempDir();
  const restrictedAppsPath = path.join(tmpDir, "restricted-apps.json");
  const focusWebsitesPath = path.join(tmpDir, "focus-websites.json");
  const blacklistAppsPath = path.join(tmpDir, "blacklist.json");
  const blacklistWebsitesPath = path.join(tmpDir, "blacklist-websites.json");
  const schedulePath = path.join(tmpDir, "schedule.json");
  const devicesPath = path.join(tmpDir, "devices.json");

  fs.writeFileSync(restrictedAppsPath, JSON.stringify({ bundleIds: ["com.apple.mobilesafari"] }));
  fs.writeFileSync(focusWebsitesPath, JSON.stringify({ websites: ["youtube.com"] }));
  fs.writeFileSync(blacklistAppsPath, JSON.stringify({ bundleIds: [] }));
  fs.writeFileSync(blacklistWebsitesPath, JSON.stringify({ websites: [] }));
  fs.writeFileSync(schedulePath, JSON.stringify({ schedules: [] }));

  // Khởi tạo DeviceManager với 2 thiết bị: iPhone (Primary) và MacBook Air (Target)
  const dm = createDeviceManagerService(devicesPath, "UDID-IPHONE-MAIN");
  dm.registerOrUpdate("UDID-MACBOOK-AIR", {
    name: "Nguyễn’s MacBook Air",
    model: "MacBookAir10,1",
    osVersion: "15.8",
  });

  // Đổi active target sang MACBOOK AIR để kiểm tra tính năng "ko phân biệt target"
  dm.setTarget("UDID-MACBOOK-AIR");
  assert.equal(dm.getActiveTargetUDID(), "UDID-MACBOOK-AIR");

  const installedProfiles: Record<string, string[]> = {};
  const removedProfiles: Record<string, string[]> = {};

  const fakeDeviceCommands = {
    get deviceUUID() {
      return dm.getActiveTargetUDID();
    },
    forDevice(udid: string) {
      return {
        installProfile: async (payload: string) => {
          if (!installedProfiles[udid]) installedProfiles[udid] = [];
          installedProfiles[udid].push(payload);
          return { commandUUID: "cmd-in", requestType: "InstallProfile" as const, status: "Acknowledged" as const };
        },
        removeProfile: async (identifier: string) => {
          if (!removedProfiles[udid]) removedProfiles[udid] = [];
          removedProfiles[udid].push(identifier);
          return { commandUUID: "cmd-rm", requestType: "RemoveProfile" as const, status: "Acknowledged" as const };
        },
      } as unknown as DeviceCommands;
    },
  } as unknown as DeviceCommands;

  const scheduler = new FocusScheduler(
    schedulePath,
    async () => {},
    async () => {},
    async () => {},
    async () => {}
  );
  scheduler.isWithinSleepWindow = () => false;
  scheduler.isWithinSleepTimeRange = () => false;
  const safeMode = { isActive: () => false } as unknown as SafeModeServiceApi;
  const bus = new EventBus();

  let lapsFocusActive = false;
  let lapsFocusWebsites: string[] = [];
  const fakeLapsService = {
    getStatus: () => ({ serialNumber: "C02SERIALMAC" }),
    setFocusState: (active: boolean, websites: string[]) => {
      lapsFocusActive = active;
      lapsFocusWebsites = websites;
    },
    getFocusState: () => ({ active: lapsFocusActive, websites: lapsFocusWebsites }),
  } as unknown as LapsServiceApi;

  const focusService = createFocusService(
    fakeDeviceCommands,
    scheduler,
    restrictedAppsPath,
    focusWebsitesPath,
    safeMode,
    bus,
    dm,
    fakeLapsService
  );

  const blacklistService = createBlacklistService(
    fakeDeviceCommands,
    blacklistAppsPath,
    blacklistWebsitesPath,
    bus,
    dm,
    fakeLapsService
  );

  // 1. FOCUS ON: Dù target đang là Mac, profile phải tự apply cho CẢ 2 MÁY
  await focusService.enable();

  assert.ok(installedProfiles["UDID-IPHONE-MAIN"]?.length === 1, "iPhone phải nhận được profile Focus");
  assert.ok(installedProfiles["UDID-MACBOOK-AIR"]?.length === 1, "MacBook phải nhận được profile Focus");
  assert.equal(lapsFocusActive, true, "LAPS /etc/hosts phải được bật cho macOS");
  assert.deepEqual(lapsFocusWebsites, ["youtube.com"]);

  // iPhone có cả app restriction và web filter
  const iphoneXml = Buffer.from(installedProfiles["UDID-IPHONE-MAIN"][0], "base64").toString("utf-8");
  assert.ok(iphoneXml.includes("com.apple.applicationaccess"));
  assert.ok(iphoneXml.includes("com.apple.mobilesafari"));
  assert.ok(iphoneXml.includes("youtube.com"));

  // Mac chỉ có web filter (không chặn app)
  const macXml = Buffer.from(installedProfiles["UDID-MACBOOK-AIR"][0], "base64").toString("utf-8");
  assert.ok(!macXml.includes("com.apple.applicationaccess"));
  assert.ok(macXml.includes("com.apple.webcontentfilter.dns"));
  assert.ok(macXml.includes("*.youtube.com"));

  // 2. FOCUS OFF: Dù target đang là Mac:
  // - Điện thoại phải được bỏ profile
  // - Mac phải được bỏ profile và unblock ở file hosts (lapsFocusActive = false)
  await focusService.disable();

  assert.ok(
    removedProfiles["UDID-IPHONE-MAIN"]?.includes(FOCUS_PROFILE_IDENTIFIER),
    "iPhone phải được gỡ profile Focus khi Focus off"
  );
  assert.ok(
    removedProfiles["UDID-MACBOOK-AIR"]?.includes(FOCUS_PROFILE_IDENTIFIER),
    "MacBook phải được gỡ profile Focus khi Focus off"
  );
  assert.equal(lapsFocusActive, false, "LAPS /etc/hosts phải được gỡ chặn (active = false)");
  assert.deepEqual(lapsFocusWebsites, [], "LAPS websites phải được xóa rỗng");

  // 3. BLACKLIST: Tự apply profile cho cả 2 máy (ko phân biệt target)
  // 3a. Thêm bundleId vào blacklist
  await blacklistService.add("com.facebook.Facebook");

  // iPhone nhận profile blacklist chặn Facebook
  const iphoneProfiles = installedProfiles["UDID-IPHONE-MAIN"] ?? [];
  assert.equal(iphoneProfiles.length, 2, "iPhone phải nhận thêm profile blacklist");
  const iphoneBlXml = Buffer.from(iphoneProfiles[1], "base64").toString("utf-8");
  assert.ok(iphoneBlXml.includes(BLACKLIST_PROFILE_IDENTIFIER));
  assert.ok(iphoneBlXml.includes("com.apple.applicationaccess"));
  assert.ok(iphoneBlXml.includes("com.facebook.Facebook"));

  // 3b. Thêm website vào blacklist
  await blacklistService.addWebsite("tiktok.com");

  // Cả iPhone và MacBook đều nhận tiktok.com
  const iphoneBlXml2 = Buffer.from(
    installedProfiles["UDID-IPHONE-MAIN"][installedProfiles["UDID-IPHONE-MAIN"].length - 1],
    "base64"
  ).toString("utf-8");
  assert.ok(iphoneBlXml2.includes("tiktok.com"));

  const macBlProfiles = installedProfiles["UDID-MACBOOK-AIR"] ?? [];
  const macBlXml = Buffer.from(macBlProfiles[macBlProfiles.length - 1], "base64").toString("utf-8");
  assert.ok(!macBlXml.includes("com.apple.applicationaccess"), "Mac không chặn app trong blacklist");
  assert.ok(macBlXml.includes("com.apple.webcontentfilter.dns"), "Mac dùng DNS filter cho blacklist");
  assert.ok(macBlXml.includes(BLACKLIST_PROFILE_IDENTIFIER));
  assert.ok(macBlXml.includes("tiktok.com"));
});

test("sleep break 60p error recovery: redoBreak refreshes state and re-removes profile keeping original breakUntil", async () => {
  const tmpDir = createTempDir();
  const restrictedAppsPath = path.join(tmpDir, "restricted-apps.json");
  const focusWebsitesPath = path.join(tmpDir, "focus-websites.json");
  const schedulePath = path.join(tmpDir, "schedule.json");
  const devicesPath = path.join(tmpDir, "devices.json");

  fs.writeFileSync(restrictedAppsPath, JSON.stringify({ bundleIds: [] }));
  fs.writeFileSync(focusWebsitesPath, JSON.stringify({ websites: ["game.com"] }));
  fs.writeFileSync(schedulePath, JSON.stringify({ schedules: [] }));

  const dm = createDeviceManagerService(devicesPath, "UDID-IPHONE");
  dm.registerOrUpdate("UDID-MACBOOK", { name: "MacBook", model: "MacBookAir10,1" });

  const removedProfiles: Record<string, string[]> = {};
  let shouldFailRemove = false;

  const fakeDeviceCommands = {
    get deviceUUID() {
      return dm.getActiveTargetUDID();
    },
    forDevice(udid: string) {
      return {
        installProfile: async () => ({ commandUUID: "cmd", requestType: "InstallProfile" as const, status: "Acknowledged" as const }),
        removeProfile: async (identifier: string) => {
          if (shouldFailRemove) {
            throw new Error("Mạng chập chờn / MicroMDM timeout khi gửi gỡ profile!");
          }
          if (!removedProfiles[udid]) removedProfiles[udid] = [];
          removedProfiles[udid].push(identifier);
          return { commandUUID: "cmd", requestType: "RemoveProfile" as const, status: "Acknowledged" as const };
        },
      } as unknown as DeviceCommands;
    },
  } as unknown as DeviceCommands;

  const scheduler = new FocusScheduler(
    schedulePath,
    async () => {},
    async () => {},
    async () => {},
    async () => {}
  );
  scheduler.isWithinSleepWindow = () => false;
  scheduler.isWithinSleepTimeRange = () => false;
  // Đảm bảo test chạy độc lập với giờ chạy thực tế của máy
  scheduler.isWithinSleepTimeRange = () => true;

  const safeMode = { isActive: () => false } as unknown as SafeModeServiceApi;
  const bus = new EventBus();

  let lapsFocusActive = true;
  let lapsFocusWebsites: string[] = ["game.com"];
  const fakeLapsService = {
    getStatus: () => ({ serialNumber: "C02TEST" }),
    setFocusState: (active: boolean, websites: string[]) => {
      lapsFocusActive = active;
      lapsFocusWebsites = websites;
    },
    getFocusState: () => ({ active: lapsFocusActive, websites: lapsFocusWebsites }),
  } as unknown as LapsServiceApi;

  const focusService = createFocusService(
    fakeDeviceCommands,
    scheduler,
    restrictedAppsPath,
    focusWebsitesPath,
    safeMode,
    bus,
    dm,
    fakeLapsService
  );

  // 1. Khởi động Sleep break 1h, nhưng lúc gửi lệnh gỡ profile thì bị lỗi MicroMDM
  shouldFailRemove = true;
  await focusService.breakFocus(60 * 60 * 1000);

  // Trạng thái scheduler: phiên break đã được ghi nhận breakUntil và breakUsedAt
  const statusAfterFail = focusService.status();
  assert.equal(statusAfterFail.sleepUnlock.breakUsed, true, "Break đã được đánh dấu used");
  assert.equal(statusAfterFail.sleepUnlock.breakActive, true, "Break vẫn đang active theo time");
  const originalBreakUntil = statusAfterFail.sleepUnlock.breakUntil;
  const originalRemainingMs = statusAfterFail.sleepUnlock.breakRemainingMs;
  assert.ok(originalBreakUntil, "Phải có breakUntil");
  assert.ok(originalRemainingMs > 0, "Thời gian còn lại > 0");

  // Profile chưa được gỡ thành công do lỗi mạng
  assert.equal(removedProfiles["UDID-IPHONE"]?.length ?? 0, 0);

  // 2. Thử gọi lại /focus break -> Bị chặn vì đã dùng lượt duy nhất và hướng dẫn dùng /focus redo
  await assert.rejects(
    async () => {
      await focusService.breakFocus(60 * 60 * 1000);
    },
    (err: unknown) => {
      assert(err instanceof ValidationError);
      assert.ok(err.message.includes("/focus redo"));
      return true;
    }
  );

  // 3. Thực hiện redoBreak()
  // Mạng đã ổn định trở lại
  shouldFailRemove = false;
  const redoResult = await focusService.redoBreak();

  assert.equal(redoResult.breakType, "sleep");
  assert.ok(redoResult.remainingMs > 0);
  assert.equal(redoResult.breakUntil, originalBreakUntil, "breakUntil phải được giữ nguyên thời gian cũ!");

  // Cả iPhone và MacBook đều đã được gỡ profile thành công
  assert.ok(removedProfiles["UDID-IPHONE"]?.includes(FOCUS_PROFILE_IDENTIFIER));
  assert.ok(removedProfiles["UDID-MACBOOK"]?.includes(FOCUS_PROFILE_IDENTIFIER));
  assert.equal(lapsFocusActive, false, "hosts macOS đã được unblock");

  // 4. Kiểm tra qua Command handlers (/focus redo và /redo)
  const focusCmd = createFocusCommand(focusService);
  const redoCmds = createRedoCommand(focusService);
  const redoCmd = redoCmds.find((c) => c.name === "redo")!;

  const dummyCtx = {
    message: { telegramId: 123456 },
    effectiveArgs: ["redo"],
  } as unknown as CommandContext;

  const focusRedoReply = await focusCmd.handler(dummyCtx);
  const focusRedoText = typeof focusRedoReply === "string" ? focusRedoReply : focusRedoReply.text;
  assert.ok(focusRedoText.includes("Đã refresh trạng thái và redo thao tác gỡ profile Focus thành công"));
  assert.ok(focusRedoText.includes("giữ nguyên thời gian cũ"));

  const standaloneRedoReply = await redoCmd.handler(dummyCtx);
  const standaloneRedoText = typeof standaloneRedoReply === "string" ? standaloneRedoReply : standaloneRedoReply.text;
  assert.ok(standaloneRedoText.includes("Đã refresh trạng thái và redo thao tác gỡ profile Focus thành công"));
  assert.ok(standaloneRedoText.includes("giữ nguyên thời gian cũ"));

  // 5. Khi không có phiên break nào đang chạy -> redoBreak báo lỗi validation rõ ràng
  scheduler.isWithinSleepTimeRange = () => false;
  await assert.rejects(
    async () => {
      await focusService.redoBreak();
    },
    (err: unknown) => {
      assert(err instanceof ValidationError);
      assert.ok(err.message.includes("không có phiên Sleep break"));
      return true;
    }
  );
});
