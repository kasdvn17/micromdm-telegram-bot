import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parsePlist } from "plist";
import {
  extractDomain,
  expandMacBlockedUrls,
  buildMacOsFocusProfile,
  FOCUS_PROFILE_IDENTIFIER,
} from "../src/profiles/profileBuilder";
import { isMacDevice, createDeviceManagerService } from "../src/services/deviceManagerService";
import { createFocusService } from "../src/services/focusService";
import { DeviceCommands } from "../src/micromdm/deviceCommands";
import { FocusScheduler } from "../src/scheduler/focusScheduler";
import { EventBus } from "../src/events/eventBus";
import { SafeModeServiceApi } from "../src/services/safeModeService";
import { LapsServiceApi } from "../src/services/lapsService";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mac-focus-test-"));
}

test("extractDomain extracts clean base domain from various URL formats", () => {
  assert.equal(extractDomain("facebook.com"), "facebook.com");
  assert.equal(extractDomain("https://facebook.com/feed"), "facebook.com");
  assert.equal(extractDomain("https://www.facebook.com/"), "facebook.com");
  assert.equal(extractDomain("http://cambridge.org:8080/test?param=1#anchor"), "cambridge.org");
  assert.equal(extractDomain("*.youtube.com"), "youtube.com");
  assert.equal(extractDomain("  https://WWW.TikTok.Com/  "), "tiktok.com");
  assert.equal(extractDomain("sub.example.com"), "sub.example.com");
  assert.equal(extractDomain("192.168.1.1"), "192.168.1.1");
  assert.equal(extractDomain(""), "");
});

test("expandMacBlockedUrls expands domain to all domains, subdomains and protocols", () => {
  const expanded = expandMacBlockedUrls(["cambridge.org", "https://www.youtube.com/feed"]);

  // Kiểm tra domain cambridge.org
  assert.ok(expanded.includes("cambridge.org"), "Chứa cambridge.org");
  assert.ok(expanded.includes("*.cambridge.org"), "Chứa *.cambridge.org");
  assert.ok(expanded.includes("https://cambridge.org"), "Chứa https://cambridge.org");
  assert.ok(expanded.includes("https://*.cambridge.org"), "Chứa https://*.cambridge.org");
  assert.ok(expanded.includes("http://cambridge.org"), "Chứa http://cambridge.org");
  assert.ok(expanded.includes("http://*.cambridge.org"), "Chứa http://*.cambridge.org");

  // Kiểm tra domain youtube.com
  assert.ok(expanded.includes("youtube.com"), "Chứa youtube.com");
  assert.ok(expanded.includes("*.youtube.com"), "Chứa *.youtube.com");
  assert.ok(expanded.includes("https://youtube.com"), "Chứa https://youtube.com");
  assert.ok(expanded.includes("https://*.youtube.com"), "Chứa https://*.youtube.com");
});

test("buildMacOsFocusProfile creates valid profile with DNS web filter and NO app restrictions", () => {
  const base64 = buildMacOsFocusProfile({
    identifier: FOCUS_PROFILE_IDENTIFIER,
    displayName: "Focus Mode",
    blockedWebsites: ["cambridge.org"],
  });

  const xml = Buffer.from(base64, "base64").toString("utf-8");
  const parsed = parsePlist(xml) as Record<string, unknown>;

  assert.equal(parsed["PayloadIdentifier"], FOCUS_PROFILE_IDENTIFIER);
  assert.equal(parsed["PayloadType"], "Configuration");

  const payloads = parsed["PayloadContent"] as Array<Record<string, unknown>>;
  assert.equal(payloads.length, 1, "Chỉ có 1 payload (Web Filter)");

  const filterPayload = payloads[0];
  assert.equal(filterPayload["PayloadType"], "com.apple.webcontent-filter");
  assert.equal(filterPayload["PluginBundleID"], "com.apple.webcontentfilter.dns");
  assert.equal(filterPayload["FilterType"], "Plugin");
  assert.equal(filterPayload["AutoFilterEnabled"], true);
  assert.equal(filterPayload["FilterBrowserTraffic"], true);
  assert.equal(filterPayload["FilterBrowsers"], true);
  assert.equal(filterPayload["FilterSockets"], true);

  const blacklisted = filterPayload["BlacklistedURLs"] as string[];
  assert.ok(blacklisted.includes("cambridge.org"));
  assert.ok(blacklisted.includes("*.cambridge.org"));
  assert.ok(blacklisted.includes("https://cambridge.org"));
  assert.ok(blacklisted.includes("https://*.cambridge.org"));

  // ĐẢM BẢO macOS KHÔNG có payload chặn app
  assert.ok(!xml.includes("com.apple.applicationaccess"), "macOS không được có com.apple.applicationaccess");
  assert.ok(!xml.includes("blacklistedAppBundleIDs"), "macOS không được có blacklistedAppBundleIDs");
});

test("isMacDevice identifies Mac devices correctly across various properties", () => {
  assert.equal(isMacDevice({ name: "MacBook Air", udid: "DEV-1" }), true);
  assert.equal(isMacDevice({ name: "Nguyễn's MacBook", udid: "DEV-2" }), true);
  assert.equal(isMacDevice({ name: "Work Laptop", model: "MacBookAir10,1", udid: "DEV-3" }), true);
  assert.equal(isMacDevice({ name: "Work Laptop", modelName: "Mac mini", udid: "DEV-4" }), true);
  assert.equal(isMacDevice({ name: "Work Machine", osVersion: "macOS 15.0", udid: "DEV-5" }), true);
  assert.equal(isMacDevice({ name: "Device", udid: "DEV-6", serialNumber: "C02XYZ123" }, "C02XYZ123"), true);
  assert.equal(isMacDevice({ name: "My PC", udid: "MAC-UDID-999" }, undefined, "MAC-UDID-999"), true);

  // Không phải Mac
  assert.equal(isMacDevice({ name: "iPhone chính", model: "iPhone14,2", udid: "DEV-IPHONE" }), false);
  assert.equal(isMacDevice({ name: "iPad Pro", model: "iPad13,4", udid: "DEV-IPAD" }), false);
});

test("focusService simultaneously blocks websites on iPhone and macOS, with app blocking only on iPhone", async () => {
  const tmpDir = createTempDir();
  const restrictedAppsPath = path.join(tmpDir, "restricted-apps.json");
  const focusWebsitesPath = path.join(tmpDir, "focus-websites.json");
  const schedulePath = path.join(tmpDir, "schedule.json");
  const devicesPath = path.join(tmpDir, "devices.json");

  fs.writeFileSync(restrictedAppsPath, JSON.stringify({ bundleIds: ["com.facebook.Facebook"] }));
  fs.writeFileSync(focusWebsitesPath, JSON.stringify({ websites: ["facebook.com"] }));
  fs.writeFileSync(schedulePath, JSON.stringify({ schedules: [] }));

  // Khởi tạo DeviceManager với 2 thiết bị: iPhone chính + MacBook Air
  const dm = createDeviceManagerService(devicesPath, "UDID-IPHONE");
  dm.registerOrUpdate("UDID-MACBOOK", {
    name: "MacBook Air",
    model: "MacBookAir10,1",
  });

  // Track profile được cài đặt và gỡ bỏ theo UDID
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
          return { commandUUID: "cmd-install", requestType: "InstallProfile" as const, status: "Acknowledged" as const };
        },
        removeProfile: async (identifier: string) => {
          if (!removedProfiles[udid]) removedProfiles[udid] = [];
          removedProfiles[udid].push(identifier);
          return { commandUUID: "cmd-remove", requestType: "RemoveProfile" as const, status: "Acknowledged" as const };
        },
      } as unknown as DeviceCommands;
    },
    installProfile: async (payload: string) => {
      const udid = dm.getActiveTargetUDID();
      if (!installedProfiles[udid]) installedProfiles[udid] = [];
      installedProfiles[udid].push(payload);
      return { commandUUID: "cmd-install", requestType: "InstallProfile" as const, status: "Acknowledged" as const };
    },
    removeProfile: async (identifier: string) => {
      const udid = dm.getActiveTargetUDID();
      if (!removedProfiles[udid]) removedProfiles[udid] = [];
      removedProfiles[udid].push(identifier);
      return { commandUUID: "cmd-remove", requestType: "RemoveProfile" as const, status: "Acknowledged" as const };
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

  // 1. BẬT Focus Mode
  await focusService.enable();

  // Kiểm tra LAPS focus state được cập nhật cho macOS /etc/hosts
  assert.equal(lapsFocusActive, true, "LAPS focusState.active phải là true");
  assert.deepEqual(lapsFocusWebsites, ["facebook.com"], "LAPS focusState.websites phải chứa facebook.com");

  // Kiểm tra: iPhone nhận profile có cả app restriction và web filter
  assert.ok(installedProfiles["UDID-IPHONE"]?.length === 1, "iPhone phải nhận được 1 profile");
  const iphoneXml = Buffer.from(installedProfiles["UDID-IPHONE"][0], "base64").toString("utf-8");
  assert.ok(iphoneXml.includes("com.apple.applicationaccess"), "iPhone phải có applicationaccess");
  assert.ok(iphoneXml.includes("com.facebook.Facebook"), "iPhone phải chặn app Facebook");
  assert.ok(iphoneXml.includes("com.apple.webcontent-filter"), "iPhone phải có webcontent-filter");
  assert.ok(iphoneXml.includes("facebook.com"), "iPhone phải chặn facebook.com");

  // Kiểm tra: MacBook đồng thời nhận profile CHỈ có web filter (không chặn app)
  assert.ok(installedProfiles["UDID-MACBOOK"]?.length === 1, "MacBook đồng thời phải nhận được 1 profile");
  const macXml = Buffer.from(installedProfiles["UDID-MACBOOK"][0], "base64").toString("utf-8");
  assert.ok(!macXml.includes("com.apple.applicationaccess"), "MacBook KHÔNG được có applicationaccess");
  assert.ok(!macXml.includes("com.facebook.Facebook"), "MacBook KHÔNG chặn app Facebook");
  assert.ok(macXml.includes("com.apple.webcontentfilter.dns"), "MacBook phải dùng com.apple.webcontentfilter.dns");
  assert.ok(macXml.includes("*.facebook.com"), "MacBook phải chặn *.facebook.com");
  assert.ok(macXml.includes("https://*.facebook.com"), "MacBook phải chặn https://*.facebook.com");

  // 2. TẮT Focus Mode
  await focusService.disable();

  assert.equal(lapsFocusActive, false, "LAPS focusState.active phải là false sau khi tắt");
  assert.deepEqual(lapsFocusWebsites, [], "LAPS focusState.websites phải rỗng");

  // Kiểm tra: Cả iPhone và MacBook đều được gỡ profile
  assert.ok(removedProfiles["UDID-IPHONE"]?.includes(FOCUS_PROFILE_IDENTIFIER), "iPhone phải được gỡ profile");
  assert.ok(removedProfiles["UDID-MACBOOK"]?.includes(FOCUS_PROFILE_IDENTIFIER), "MacBook đồng thời phải được gỡ profile");
});

test("addBlockWebsite updates both iPhone and macOS immediately if Focus is currently active", async () => {
  const tmpDir = createTempDir();
  const restrictedAppsPath = path.join(tmpDir, "restricted-apps.json");
  const focusWebsitesPath = path.join(tmpDir, "focus-websites.json");
  const schedulePath = path.join(tmpDir, "schedule.json");
  const devicesPath = path.join(tmpDir, "devices.json");

  fs.writeFileSync(restrictedAppsPath, JSON.stringify({ bundleIds: [] }));
  fs.writeFileSync(focusWebsitesPath, JSON.stringify({ websites: [] }));
  fs.writeFileSync(schedulePath, JSON.stringify({ schedules: [] }));

  const dm = createDeviceManagerService(devicesPath, "UDID-IPHONE");
  dm.registerOrUpdate("UDID-MACBOOK", { name: "MacBook Pro", model: "MacBookPro18,1" });

  const installedProfiles: Record<string, string[]> = {};
  const fakeDeviceCommands = {
    get deviceUUID() {
      return dm.getActiveTargetUDID();
    },
    forDevice(udid: string) {
      return {
        installProfile: async (payload: string) => {
          if (!installedProfiles[udid]) installedProfiles[udid] = [];
          installedProfiles[udid].push(payload);
          return { commandUUID: "cmd", requestType: "InstallProfile" as const, status: "Acknowledged" as const };
        },
        removeProfile: async () => ({ commandUUID: "cmd", requestType: "RemoveProfile" as const, status: "Acknowledged" as const }),
      } as unknown as DeviceCommands;
    },
    installProfile: async (payload: string) => {
      const udid = dm.getActiveTargetUDID();
      if (!installedProfiles[udid]) installedProfiles[udid] = [];
      installedProfiles[udid].push(payload);
      return { commandUUID: "cmd", requestType: "InstallProfile" as const, status: "Acknowledged" as const };
    },
    removeProfile: async () => ({ commandUUID: "cmd", requestType: "RemoveProfile" as const, status: "Acknowledged" as const }),
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

  const focusService = createFocusService(
    fakeDeviceCommands,
    scheduler,
    restrictedAppsPath,
    focusWebsitesPath,
    safeMode,
    bus,
    dm
  );

  // Bật focus khi danh sách website rỗng
  await focusService.enable();

  // Thêm website mới vào danh sách chặn khi Focus đang bật
  const applied = await focusService.addBlockWebsite("cambridge.org");
  assert.equal(applied, true, "Phải áp dụng ngay khi Focus đang bật");

  // Kiểm tra: MacBook nhận profile mới có cambridge.org và wildcard
  const macProfiles = installedProfiles["UDID-MACBOOK"] ?? [];
  assert.ok(macProfiles.length >= 1, "MacBook phải nhận được profile cập nhật");
  const latestMacXml = Buffer.from(macProfiles[macProfiles.length - 1], "base64").toString("utf-8");
  assert.ok(latestMacXml.includes("cambridge.org"));
  assert.ok(latestMacXml.includes("*.cambridge.org"));
  assert.ok(latestMacXml.includes("https://*.cambridge.org"));
});
