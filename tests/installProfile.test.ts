import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveUploadedProfile, loadProfileFileBase64 } from "../src/profiles/fileProfile";
import { createInstallProfileCommand } from "../src/commands/emergency/profile.command";
import { createDeviceManagerService } from "../src/services/deviceManagerService";
import { DeviceCommands } from "../src/micromdm/deviceCommands";
import { createRouter } from "../src/telegram/router";
import { CommandDefinition, AuthTier } from "../src/types/command.types";
import { EventBus } from "../src/events/eventBus";
import { EmergencyAuthServiceApi } from "../src/services/emergencyAuthService";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "installprofile-test-"));
}

test("saveUploadedProfile saves and sanitizes file in profiles directory", () => {
  const tmpDir = createTempDir();
  const content = Buffer.from("<plist><dict><key>PayloadIdentifier</key><string>test</string></dict></plist>");

  const { savedPath, cleanFileName } = saveUploadedProfile(tmpDir, "../../evil name.mobileconfig", content);
  assert.equal(cleanFileName, "evil_name.mobileconfig");
  assert.equal(fs.existsSync(savedPath), true);
  assert.equal(savedPath, path.join(tmpDir, "profiles", "evil_name.mobileconfig"));

  // loadProfileFileBase64 có thể tìm file trong thư mục profiles/
  const base64 = loadProfileFileBase64(tmpDir, "evil_name.mobileconfig");
  assert.equal(base64, content.toString("base64"));
});

test("createInstallProfileCommand installs uploaded document from Telegram", async () => {
  const tmpDir = createTempDir();
  const dm = createDeviceManagerService(path.join(tmpDir, "devices.json"), "UDID-1");

  let installedPayload: string | undefined;
  const fakeDeviceCommands = {
    installProfile: async (payload: string) => {
      installedPayload = payload;
      return { commandUUID: "cmd-1", requestType: "InstallProfile", status: "Acknowledged" };
    },
  } as unknown as DeviceCommands;

  const cmd = createInstallProfileCommand(fakeDeviceCommands, tmpDir, dm);

  const fakeProfileXml = "<plist><dict><key>PayloadIdentifier</key><string>com.test.vpn</string></dict></plist>";
  const fakeBuffer = Buffer.from(fakeProfileXml);

  // Giả lập ctx có document tải từ Telegram
  const ctx = {
    message: { telegramId: 100, chatId: 100, rawText: "/installprofile" },
    parsed: { name: "installprofile", args: [] },
    effectiveArgs: [],
    document: { fileId: "file-123", fileName: "MyVpn.mobileconfig" },
    downloadDocument: async () => ({
      buffer: fakeBuffer,
      fileName: "MyVpn.mobileconfig",
    }),
    progress: async () => undefined,
  };

  const res = await cmd.handler(ctx);
  assert.match(String(res), /Đã nhận file và gửi lệnh cài đặt profile "MyVpn\.mobileconfig"/);
  assert.equal(installedPayload, fakeBuffer.toString("base64"));

  // File đã được lưu vào data/profiles/MyVpn.mobileconfig
  const savedPath = path.join(tmpDir, "profiles", "MyVpn.mobileconfig");
  assert.equal(fs.existsSync(savedPath), true);
  assert.equal(fs.readFileSync(savedPath, "utf-8"), fakeProfileXml);
});

test("createInstallProfileCommand installs existing file from data directory", async () => {
  const tmpDir = createTempDir();
  const dm = createDeviceManagerService(path.join(tmpDir, "devices.json"), "UDID-1");

  // Tạo file sẵn trong tmpDir
  fs.writeFileSync(path.join(tmpDir, "existing.mobileconfig"), "<plist>existing</plist>");

  let installedPayload: string | undefined;
  const fakeDeviceCommands = {
    installProfile: async (payload: string) => {
      installedPayload = payload;
      return { commandUUID: "cmd-2", requestType: "InstallProfile", status: "Acknowledged" };
    },
  } as unknown as DeviceCommands;

  const cmd = createInstallProfileCommand(fakeDeviceCommands, tmpDir, dm);

  const ctx = {
    message: { telegramId: 100, chatId: 100, rawText: "/installprofile pass existing.mobileconfig" },
    parsed: { name: "installprofile", subcommand: "existing.mobileconfig", args: ["existing.mobileconfig"] },
    effectiveArgs: ["existing.mobileconfig"],
    progress: async () => undefined,
  };

  const res = await cmd.handler(ctx);
  assert.match(String(res), /Đã gửi lệnh cài profile từ file "existing\.mobileconfig"/);
  assert.equal(installedPayload, Buffer.from("<plist>existing</plist>").toString("base64"));
});

test("createInstallProfileCommand throws validation error if neither document nor filename provided", async () => {
  const tmpDir = createTempDir();
  const fakeDeviceCommands = {} as DeviceCommands;
  const cmd = createInstallProfileCommand(fakeDeviceCommands, tmpDir);

  const ctx = {
    message: { telegramId: 100, chatId: 100, rawText: "/installprofile pass" },
    parsed: { name: "installprofile", args: [] },
    effectiveArgs: [],
    progress: async () => undefined,
  };

  await assert.rejects(async () => cmd.handler(ctx), /Cú pháp \/installprofile/);
});

test("Router routes message with caption and document attachment", async () => {
  let executed = false;
  let receivedDocFileName: string | undefined;

  const testCmd: CommandDefinition = {
    name: "installprofile",
    tier: AuthTier.Normal,
    handler: async (ctx) => {
      executed = true;
      receivedDocFileName = ctx.document?.fileName;
      return "OK";
    },
  };

  const bus = new EventBus();
  const fakeAuth = {} as EmergencyAuthServiceApi;
  const router = createRouter([testCmd], "user1", 100, fakeAuth, bus);

  const fakeBot = {
    sendMessage: async () => ({ message_id: 1 }),
    deleteMessage: async () => true,
    sendChatAction: async () => true,
    getFileLink: async () => "https://example.com/file",
  } as unknown as import("node-telegram-bot-api");

  // Message không có `text` mà có `caption` và `document`
  await router(fakeBot, {
    caption: "/installprofile",
    document: { file_id: "doc-999", file_name: "test.mobileconfig" },
    chat: { id: 100, type: "private" },
    from: { id: 100, username: "user1" },
  } as unknown as import("node-telegram-bot-api").Message);

  assert.equal(executed, true);
  assert.equal(receivedDocFileName, "test.mobileconfig");
});
