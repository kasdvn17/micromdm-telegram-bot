import "dotenv/config";
import { loadConfig } from "./config";
import { initLogger, getLogger } from "./utils/logger";
import { MicroMdmClient } from "./micromdm/client";
import { DeviceCommands } from "./micromdm/deviceCommands";
import { EventBus } from "./events/eventBus";
import { attachHistoryLogger } from "./events/historyLogger";
import { attachNotifyBridge } from "./events/notifyBridge";
import { createNotificationService } from "./services/notificationService";
import { createEmergencyAuthService } from "./services/emergencyAuthService";
import { createSafeModeService } from "./services/safeModeService";
import { createFocusService, handleFocusExpire } from "./services/focusService";
import { createMarkLostService } from "./services/markLostService";
import { createBlacklistService } from "./services/blacklistService";
import { createDeviceInfoService } from "./services/deviceInfoService";
import { createActivationLockService } from "./services/activationLockService";
import { FocusScheduler } from "./scheduler/focusScheduler";
import { createMarkLostPoller } from "./scheduler/markLostPoller";
import { createDeviceInfoPoller } from "./scheduler/deviceInfoPoller";
import { createBot } from "./telegram/bot";
import { createRouter } from "./telegram/router";
import { startWebhookServer } from "./enrollment/webhookServer";
import { CommandDefinition } from "./types/command.types";

import { createFocusCommand } from "./commands/normal/focus.command";
import { createNotifyCommand } from "./commands/normal/notify.command";
import {
  createPingCommand,
  createHealthCommand,
  createWhoamiCommand,
  createLogsCommand,
  createHistoryCommand,
  createAuthTestCommand,
} from "./commands/normal/system.command";
import { createBlacklistCommand } from "./commands/normal/blacklist.command";
import { createDeviceCommands } from "./commands/emergency/device.command";
import { createUnlockCommand, createLostCommand } from "./commands/emergency/lostAndUnlock.command";
import { createSafeCommand } from "./commands/emergency/safe.command";
import { createMarkLostCommand } from "./commands/emergency/markLost.command";
import { createApiCommand } from "./commands/emergency/api.command";

async function main(): Promise<void> {
  // 1. Config - fail-fast nếu thiếu biến môi trường
  const config = loadConfig();
  initLogger(config.constants.logDir);
  const logger = getLogger();
  logger.info("[main] Config loaded OK, khởi động bot...");

  // 2. Hạ tầng dùng chung
  const bus = new EventBus();
  const microMdmClient = new MicroMdmClient({
    baseUrl: config.secrets.microMdmUrl,
    apiKey: config.secrets.microMdmApiKey,
    commandResultTimeoutMs: config.constants.commandResultTimeoutMs,
  });
  const deviceCommands = new DeviceCommands(microMdmClient, config.constants.deviceUUID);

  // 3. Telegram bot + notification service
  const bot = createBot(config.secrets.telegramBotToken);
  const notificationService = createNotificationService(bot, config.secrets.authorizedTelegramChatId);

  // 4. Auth
  const emergencyAuthService = createEmergencyAuthService(
    config.secrets.emergencyPassword,
    config.secrets.authorizedTelegramUsername
  );

  // 5. Scheduler + services phụ thuộc scheduler
  const focusScheduler = new FocusScheduler(
    config.constants.scheduleFilePath,
    () => handleFocusExpire(deviceCommands, bus),
    async () => {
      /* recurring start/end trigger - tương lai mở rộng, hiện tại no-op an toàn */
    }
  );

  const safeModeService = createSafeModeService(
    deviceCommands,
    config.constants.restrictedAppsFilePath,
    bus
  );
  const focusService = createFocusService(
    deviceCommands,
    focusScheduler,
    config.constants.restrictedAppsFilePath,
    safeModeService,
    bus
  );

  const markLostPoller = createMarkLostPoller();
  const markLostService = createMarkLostService(
    deviceCommands,
    markLostPoller,
    config.constants.markLostPollIntervalMs,
    "./data/mark-lost-state.json",
    bus
  );

  const blacklistService = createBlacklistService(deviceCommands, config.constants.blacklistFilePath, bus);

  const deviceInfoPoller = createDeviceInfoPoller(deviceCommands);
  const deviceInfoService = createDeviceInfoService(deviceCommands, deviceInfoPoller);

  const activationLockService = createActivationLockService(deviceCommands, bus);

  // 6. Event subscribers
  attachHistoryLogger(bus, config.constants.historyFilePath);
  attachNotifyBridge(bus, notificationService);

  // 7. Webhook server (nhận Enrollment/Acknowledge/CheckIn từ MicroMDM)
  startWebhookServer(
    { port: config.constants.webhookPort, webhookPath: config.constants.webhookPath, deviceUUID: config.constants.deviceUUID },
    microMdmClient,
    bus,
    activationLockService
  );

  // 8. Đăng ký toàn bộ command
  const commands: CommandDefinition[] = [
    createFocusCommand(focusService),
    createNotifyCommand(notificationService),
    createPingCommand(),
    createHealthCommand(),
    createWhoamiCommand(),
    createLogsCommand(config.constants.logDir),
    createHistoryCommand(config.constants.historyFilePath),
    createAuthTestCommand(emergencyAuthService),
    createBlacklistCommand(blacklistService),
    ...createDeviceCommands(deviceCommands, deviceInfoService),
    createUnlockCommand(deviceCommands, safeModeService),
    createLostCommand(deviceCommands, bus),
    createSafeCommand(safeModeService),
    createMarkLostCommand(markLostService),
    createApiCommand(deviceCommands, bus),
  ];

  const router = createRouter(
    commands,
    config.secrets.authorizedTelegramUsername,
    emergencyAuthService,
    bus
  );

  bot.on("message", (msg) => {
    void router(bot, msg);
  });

  // 9. Start pollers/scheduler nền
  focusScheduler.start();
  deviceInfoPoller.start(config.constants.deviceInfoPollIntervalMs);
  markLostService.resumeIfActive();

  logger.info("[main] Bot đã khởi động thành công.");
}

main().catch((err) => {
  // Dùng console.error trực tiếp vì logger có thể chưa init được nếu lỗi xảy ra ở config
  // eslint-disable-next-line no-console
  console.error("[main] Khởi động thất bại:", err);
  process.exit(1);
});
