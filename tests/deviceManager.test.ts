import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeviceManagerService } from "../src/services/deviceManagerService";
import { DeviceCommands } from "../src/micromdm/deviceCommands";
import { createRouter } from "../src/telegram/router";
import { AuthTier, CommandDefinition } from "../src/types/command.types";
import { EventBus } from "../src/events/eventBus";
import { EmergencyAuthServiceApi } from "../src/services/emergencyAuthService";
import { MicroMdmClient } from "../src/micromdm/client";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "device-test-"));
}

test("deviceManager initializes, lists devices, sets primary and switches target", () => {
  const tmpDir = createTempDir();
  const filePath = path.join(tmpDir, "devices.json");
  const initialUdid = "UDID-PRIMARY-001";

  const dm = createDeviceManagerService(filePath, initialUdid);

  // Danh sách ban đầu chứa initialUdid và đặt làm Primary & Target
  const devices = dm.listDevices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].udid, initialUdid);
  assert.equal(devices[0].isPrimary, true);
  assert.equal(dm.getPrimaryUDID(), initialUdid);
  assert.equal(dm.getTargetUDID(), initialUdid);

  // Thêm thiết bị thứ 2
  const dev2 = dm.registerOrUpdate("UDID-IPAD-002", {
    name: "iPad Mini",
    model: "iPad Mini 6",
    osVersion: "17.4",
  });
  assert.equal(dm.listDevices().length, 2);
  assert.equal(dev2.name, "iPad Mini");
  assert.equal(dev2.isPrimary, false);

  // Đổi target sang thiết bị 2 bằng index "2"
  dm.setTarget("2");
  assert.equal(dm.getTargetUDID(), "UDID-IPAD-002");
  assert.equal(dm.getTargetDevice()?.name, "iPad Mini");
  // Primary vẫn giữ nguyên là thiết bị 1
  assert.equal(dm.getPrimaryUDID(), initialUdid);

  // Đổi target sang thiết bị bằng tên "iPad"
  dm.setTarget("iPad");
  assert.equal(dm.getTargetUDID(), "UDID-IPAD-002");

  // Đổi Primary sang thiết bị 2
  dm.setPrimary("2");
  assert.equal(dm.getPrimaryUDID(), "UDID-IPAD-002");
  assert.equal(dm.listDevices().find((d) => d.udid === "UDID-IPAD-002")?.isPrimary, true);
  assert.equal(dm.listDevices().find((d) => d.udid === initialUdid)?.isPrimary, false);

  // Reset target về primary
  dm.resetTarget();
  assert.equal(dm.getTargetUDID(), "UDID-IPAD-002");

  // Đổi tên thiết bị
  dm.renameDevice("1", "iPhone 15 Pro");
  assert.equal(dm.resolveDevice("1")?.name, "iPhone 15 Pro");

  // Xóa thiết bị không phải primary
  dm.removeDevice(initialUdid);
  assert.equal(dm.listDevices().length, 1);

  // Không thể xóa thiết bị đang là primary
  assert.throws(() => dm.removeDevice("UDID-IPAD-002"));
});

test("deviceManager resolves by index, name, udid and primary/target keywords", () => {
  const tmpDir = createTempDir();
  const filePath = path.join(tmpDir, "devices.json");
  const dm = createDeviceManagerService(filePath, "00008101-0001");

  dm.registerOrUpdate("00008110-0002", { name: "iPad Pro 11" });

  assert.equal(dm.resolveDevice("1")?.udid, "00008101-0001");
  assert.equal(dm.resolveDevice("2")?.udid, "00008110-0002");
  assert.equal(dm.resolveDevice("primary")?.udid, "00008101-0001");
  assert.equal(dm.resolveDevice("target")?.udid, "00008101-0001");
  assert.equal(dm.resolveDevice("iPad")?.udid, "00008110-0002");
  assert.equal(dm.resolveDevice("8110")?.udid, "00008110-0002");
  assert.equal(dm.resolveDevice("không-tồn-tại"), undefined);
});

test("DeviceCommands dynamically resolves target UDID from DeviceManager", async () => {
  const tmpDir = createTempDir();
  const filePath = path.join(tmpDir, "devices.json");
  const dm = createDeviceManagerService(filePath, "DEV-A");
  dm.registerOrUpdate("DEV-B", { name: "Device B" });

  const queuedUdids: string[] = [];
  const fakeClient = {
    queueCommand: async (payload: { udid: string }) => {
      queuedUdids.push(payload.udid);
      return { commandUUID: "uuid-1", requestType: "DeviceLock", queuedAt: "" };
    },
  } as unknown as MicroMdmClient;

  const deviceCommands = new DeviceCommands(fakeClient, () => dm.getActiveTargetUDID());

  // Mặc định gọi DEV-A
  await deviceCommands.lock();
  assert.equal(queuedUdids[queuedUdids.length - 1], "DEV-A");

  // Đổi target sang DEV-B
  dm.setTarget("DEV-B");
  await deviceCommands.lock();
  assert.equal(queuedUdids[queuedUdids.length - 1], "DEV-B");

  // Sử dụng runWithTarget (scoping một lần cho DEV-A)
  await dm.runWithTarget("DEV-A", async () => {
    await deviceCommands.lock();
  });
  assert.equal(queuedUdids[queuedUdids.length - 1], "DEV-A");

  // Sau scope, target trở lại DEV-B
  await deviceCommands.lock();
  assert.equal(queuedUdids[queuedUdids.length - 1], "DEV-B");
});

test("Router parses --target and --device flags and scopes execution", async () => {
  const tmpDir = createTempDir();
  const filePath = path.join(tmpDir, "devices.json");
  const dm = createDeviceManagerService(filePath, "DEV-MAIN");
  dm.registerOrUpdate("DEV-SECONDARY", { name: "Second Phone" });

  let capturedTarget: string | undefined;
  let capturedEffectiveArgs: string[] = [];

  const testCmd: CommandDefinition = {
    name: "testtarget",
    tier: AuthTier.Normal,
    handler: async (ctx) => {
      capturedTarget = dm.getActiveTargetUDID();
      capturedEffectiveArgs = ctx.effectiveArgs;
      return `Target: ${capturedTarget}`;
    },
  };

  const fakeEmergencyAuth = {} as EmergencyAuthServiceApi;
  const bus = new EventBus();
  const router = createRouter([testCmd], "user1", 100, fakeEmergencyAuth, bus, dm);

  const fakeBot = {
    sendMessage: async () => ({ message_id: 1 }),
    deleteMessage: async () => true,
    sendChatAction: async () => true,
  } as unknown as import("node-telegram-bot-api");

  // Gọi lệnh thường -> target DEV-MAIN
  await router(fakeBot, {
    text: "/testtarget arg1 arg2",
    chat: { id: 100, type: "private" },
    from: { id: 100, username: "user1" },
  } as unknown as import("node-telegram-bot-api").Message);

  assert.equal(capturedTarget, "DEV-MAIN");
  assert.deepEqual(capturedEffectiveArgs, ["arg1", "arg2"]);

  // Gọi lệnh kèm --target 2
  await router(fakeBot, {
    text: "/testtarget arg1 arg2 --target 2",
    chat: { id: 100, type: "private" },
    from: { id: 100, username: "user1" },
  } as unknown as import("node-telegram-bot-api").Message);

  assert.equal(capturedTarget, "DEV-SECONDARY");
  assert.deepEqual(capturedEffectiveArgs, ["arg1", "arg2"]);

  // Gọi lệnh kèm -d "Second Phone"
  await router(fakeBot, {
    text: "/testtarget foo -d \"Second Phone\"",
    chat: { id: 100, type: "private" },
    from: { id: 100, username: "user1" },
  } as unknown as import("node-telegram-bot-api").Message);

  assert.equal(capturedTarget, "DEV-SECONDARY");

  // Sau khi gọi xong, target mặc định của DM vẫn là DEV-MAIN
  assert.equal(dm.getActiveTargetUDID(), "DEV-MAIN");
});

test("createDeviceManagementCommands handles list, primary, target, rename, add and remove", async () => {
  const tmpDir = createTempDir();
  const filePath = path.join(tmpDir, "devices.json");
  const dm = createDeviceManagerService(filePath, "DEV-MAIN");
  dm.registerOrUpdate("DEV-SECONDARY", { name: "iPad Air" });

  const { createDeviceManagementCommands } = await import("../src/commands/normal/device.command");
  const cmds = createDeviceManagementCommands(dm);

  const deviceCmd = cmds.find((c) => c.name === "device")!;
  const devicesCmd = cmds.find((c) => c.name === "devices")!;
  const targetCmd = cmds.find((c) => c.name === "target")!;

  const createFakeCtx = (args: string[]) => ({
    message: { telegramId: 100, chatId: 100, rawText: "" },
    parsed: { name: "device", subcommand: args[0], args },
    effectiveArgs: args,
    progress: async () => undefined,
  });

  // 1. /devices
  const listRes = await devicesCmd.handler(createFakeCtx([]));
  assert.match(typeof listRes === "string" ? listRes : listRes.text, /Danh sách thiết bị \(2\)/);

  // 2. /device primary 2
  const primaryRes = await deviceCmd.handler(createFakeCtx(["primary", "2"]));
  assert.match(String(primaryRes), /Đã đặt thiết bị \*\*iPad Air\*\*.*làm Primary/);
  assert.equal(dm.getPrimaryUDID(), "DEV-SECONDARY");

  // 3. /device target 1
  const targetRes = await deviceCmd.handler(createFakeCtx(["target", "1"]));
  assert.match(String(targetRes), /Đã chuyển target sang thiết bị/);
  assert.equal(dm.getTargetUDID(), "DEV-MAIN");

  // 4. /target primary
  const targetPrimaryRes = await targetCmd.handler(createFakeCtx(["primary"]));
  assert.match(String(targetPrimaryRes), /Đã chuyển target về thiết bị Primary/);
  assert.equal(dm.getTargetUDID(), "DEV-SECONDARY");

  // 5. /device rename 1 "iPhone 16"
  const renameRes = await deviceCmd.handler(createFakeCtx(["rename", "1", "iPhone 16"]));
  assert.match(String(renameRes), /Đã đổi tên thiết bị.*iPhone 16/);
  assert.equal(dm.resolveDevice("1")?.name, "iPhone 16");

  // 6. /device add <udid> "Apple Watch"
  const addRes = await deviceCmd.handler(createFakeCtx(["add", "DEV-WATCH", "Apple Watch"]));
  assert.match(String(addRes), /Đã thêm thiết bị \*\*Apple Watch\*\*/);
  assert.equal(dm.listDevices().length, 3);

  // 7. /device remove "Apple Watch"
  const removeRes = await deviceCmd.handler(createFakeCtx(["remove", "Apple Watch"]));
  assert.match(String(removeRes), /Đã xóa thiết bị \*\*Apple Watch\*\*/);
  assert.equal(dm.listDevices().length, 2);
});

