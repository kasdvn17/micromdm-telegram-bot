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
import { createFocusService } from "./services/focusService";
import { createMarkLostService } from "./services/markLostService";
import { createBlacklistService } from "./services/blacklistService";
import { createDeviceInfoService } from "./services/deviceInfoService";
import { createActivationLockService } from "./services/activationLockService";
import { createDefaultProfileService } from "./services/defaultProfileService";
import { createAppManagementService } from "./services/appManagementService";
import { createCodeforcesTaskService } from "./services/codeforcesTaskService";
import { FocusScheduler } from "./scheduler/focusScheduler";
import { createMarkLostPoller } from "./scheduler/markLostPoller";
import { createDeviceInfoPoller } from "./scheduler/deviceInfoPoller";
import { createQuoteScheduler } from "./scheduler/quoteScheduler";
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
import { createSearchCommand } from "./commands/normal/search.command";
import { createDeviceCommands } from "./commands/emergency/device.command";
import { createUnlockCommand, createLostCommand } from "./commands/emergency/lostAndUnlock.command";
import { createSafeCommand } from "./commands/emergency/safe.command";
import { createManageAppCommand } from "./commands/emergency/manageapp.command";
import { createApiCommand } from "./commands/emergency/api.command";
import {
  createInstallAppCommand,
  createListAppsCommand,
  createRemoveAppCommand,
} from "./commands/emergency/app.command";
import { createInstallProfileCommand, createListProfilesCommand, createRemoveProfileCommand } from "./commands/emergency/profile.command";
import { createHelpCommand } from "./commands/normal/help.command";
import { createRefreshCommand, createTaskCommand } from "./commands/normal/task.command";
import { createStatusCommand } from "./commands/normal/status.command";

async function main(): Promise<void> {
  // Bắt toàn cục unhandledRejection/uncaughtException - CHỈ LOG, không thoát
  // process. Lý do: các background job chạy nền qua setInterval (focusScheduler
  // tick, deviceInfoPoller, markLostPoller...) gọi async function nhưng không
  // await - nếu 1 lệnh gọi MicroMDM bên trong throw (mất mạng, timeout) mà
  // thiếu try/catch ở đâu đó, promise reject sẽ "unhandled". Từ Node 15+,
  // hành vi mặc định là CRASH CẢ PROCESS ngay lập tức và im lặng (chỉ in
  // stack trace ra stderr, dễ bị bỏ sót nếu không theo dõi log sát sao) -
  // đây chính xác là nguyên nhân khiến trước đây recurring schedule "sang
  // ngày mới không tự bật Focus": tick() gặp lỗi mạng lúc activate, cả bot
  // crash, và chỉ hoạt động lại (vô tình) khi có hành động khác kích hoạt
  // 1 process mới. Dùng logger thay vì console vì logger có thể chưa init -
  // fallback console nếu getLogger() cũng lỗi.
  process.on("unhandledRejection", (reason) => {
    try {
      getLogger().error("[process] Unhandled promise rejection - bot vẫn tiếp tục chạy", {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    } catch {
      // eslint-disable-next-line no-console
      console.error("[process] Unhandled promise rejection (logger chưa sẵn sàng):", reason);
    }
  });
  process.on("uncaughtException", (err) => {
    try {
      getLogger().error("[process] Uncaught exception - bot vẫn tiếp tục chạy", {
        error: err.message,
        stack: err.stack,
      });
    } catch {
      // eslint-disable-next-line no-console
      console.error("[process] Uncaught exception (logger chưa sẵn sàng):", err);
    }
  });

  // 1. Config - fail-fast nếu thiếu biến môi trường
  const config = loadConfig();
  // Date#getHours/getDay trong scheduler phải dùng cùng một múi giờ trên mọi host.
  process.env.TZ = config.constants.timeZone;
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
  // Ưu tiên chatId cấu hình sẵn để notify hoạt động ngay sau boot; nếu bỏ trống,
  // bind từ tin nhắn đầu tiên của Authorized Username.
  let primaryChatId: number | null = config.secrets.authorizedTelegramChatId ?? null;
  const notificationService = createNotificationService(bot, primaryChatId ?? undefined);
  const quoteScheduler = createQuoteScheduler(notificationService);

  // 4. Auth
  const emergencyAuthService = createEmergencyAuthService(
    config.secrets.emergencyPassword,
    config.secrets.authorizedTelegramUsername
  );

  // 5. Scheduler + services phụ thuộc scheduler
  // Ref tạm để onRecurringTrigger (định nghĩa TRƯỚC focusService vì focusScheduler
  // cần callback này ngay lúc khởi tạo) có thể gọi tới focusService thật sau khi
  // nó được tạo bên dưới - tránh circular dependency giữa scheduler <-> service.
  let focusServiceRef: import("./services/focusService").FocusServiceApi | null = null;

  const focusScheduler = new FocusScheduler(
    config.constants.scheduleFilePath,
    async () => {
      // Duration hết hạn cũng phải giữ profile nếu Sleep/recurring source khác còn active.
      if (focusServiceRef) await focusServiceRef.scheduleDeactivate();
    },
    async (action: "start" | "end") => {
      if (!focusServiceRef) return;
      // Dùng scheduleActivate/scheduleDeactivate (KHÔNG phải enable/disable
      // công khai) vì enable/disable giờ bị chặn khi đang trong khung giờ
      // schedule - chính scheduler mới là nguồn gọi hợp lệ duy nhất ở đây.
      if (action === "start") {
        await focusServiceRef.scheduleActivate();
      } else {
        await focusServiceRef.scheduleDeactivate();
      }
    },
    async () => {
      // Break hết hạn, scheduler đã tự kiểm tra vẫn còn trong khung giờ mới gọi tới đây
      if (!focusServiceRef) return;
      await focusServiceRef.scheduleActivate();
    },
    async (action: "start" | "end") => {
      if (!focusServiceRef) return;
      if (action === "start") {
        await focusServiceRef.sleepActivate();
      } else {
        // Sleep Mode kết thúc (05:00) - CHỈ gỡ profile nếu không còn lý do nào
        // khác (manual/duration/recurring schedule) đang giữ Focus bật, tránh
        // tắt nhầm Focus nếu user đã /focus on từ trước hoặc recurring schedule
        // khác đang chồng giờ. isFocusActiveNow() tại đúng thời điểm hhmm=05:00
        // tự động không tính Sleep Mode nữa (đã hết theo định nghĩa), nên kết
        // quả false nghĩa là THỰC SỰ không còn gì giữ Focus bật.
        if (!focusServiceRef.isFocusActiveNow()) {
          await focusServiceRef.sleepDeactivate();
        }
      }
    }
  );

  const safeModeService = createSafeModeService(
    deviceCommands,
    config.constants.sensitiveAppsFilePath,
    bus
  );
  const focusService = createFocusService(
    deviceCommands,
    focusScheduler,
    config.constants.restrictedAppsFilePath,
    config.constants.focusWebsitesFilePath,
    safeModeService,
    bus
  );
  focusServiceRef = focusService;

  const markLostPoller = createMarkLostPoller();
  const markLostService = createMarkLostService(
    deviceCommands,
    markLostPoller,
    config.constants.markLostPollIntervalMs,
    "./data/mark-lost-state.json",
    bus
  );

  const blacklistService = createBlacklistService(
    deviceCommands,
    config.constants.blacklistFilePath,
    config.constants.blacklistWebsitesFilePath,
    bus
  );

  const deviceInfoPoller = createDeviceInfoPoller(deviceCommands);
  const deviceInfoService = createDeviceInfoService(deviceCommands, deviceInfoPoller);

  const activationLockService = createActivationLockService(deviceCommands, bus);
  const defaultProfileService = createDefaultProfileService(
    deviceCommands,
    config.constants.defaultProfilePlistPath,
    bus
  );
  const appManagementService = createAppManagementService(deviceCommands, bus);
  const codeforcesTaskService = createCodeforcesTaskService(
    config.constants.codeforcesTasksFilePath,
    config.constants.codeforcesHandle,
    undefined,
    { timeZone: config.constants.timeZone }
  );

  // 6. Event subscribers
  attachHistoryLogger(bus, config.constants.historyFilePath);
  attachNotifyBridge(bus, notificationService);

  // 7. Webhook server (nhận Enrollment/Acknowledge/CheckIn từ MicroMDM)
  startWebhookServer(
    {
      port: config.constants.webhookPort,
      path: config.constants.webhookPath,
      deviceUUID: config.constants.deviceUUID,
      seenDevicesFilePath: "./data/seen-devices.json",
      checkinStateFilePath: config.constants.checkinStateFilePath,
    },
    microMdmClient,
    bus,
    activationLockService,
    defaultProfileService
  );

  // 8. Đăng ký toàn bộ command
  const commands: CommandDefinition[] = [
    createFocusCommand(focusService, codeforcesTaskService),
    createTaskCommand(codeforcesTaskService, focusService),
    createRefreshCommand(codeforcesTaskService, focusService),
    createStatusCommand(focusService, codeforcesTaskService, deviceInfoService),
    createNotifyCommand(notificationService),
    createPingCommand(),
    createHealthCommand(),
    createWhoamiCommand(),
    createLogsCommand(config.constants.logDir),
    createHistoryCommand(config.constants.historyFilePath),
    createAuthTestCommand(emergencyAuthService),
    createSearchCommand(),
    createBlacklistCommand(blacklistService),
    ...createDeviceCommands(deviceCommands, deviceInfoService),
    createUnlockCommand(deviceCommands),
    createLostCommand(deviceCommands, bus, markLostService),
    createSafeCommand(safeModeService),
    createManageAppCommand(appManagementService),
    createApiCommand(deviceCommands, bus),
    createInstallAppCommand(appManagementService),
    createListAppsCommand(appManagementService),
    createRemoveAppCommand(appManagementService),
    createListProfilesCommand(deviceCommands),
    createRemoveProfileCommand(deviceCommands),
    createInstallProfileCommand(deviceCommands, config.constants.dataDir),
    createHelpCommand(),
  ];

  const router = createRouter(
    commands,
    config.secrets.authorizedTelegramUsername,
    emergencyAuthService,
    bus
  );

  bot.on("message", (msg) => {
    // Bind primaryChatId lần đầu tiên tin nhắn tới từ đúng Authorized Username
    // (dùng để notificationService biết gửi notify chủ động về đâu).
    if (
      primaryChatId === null &&
      msg.from?.username?.toLowerCase().replace(/^@/, "") ===
      config.secrets.authorizedTelegramUsername
    ) {
      primaryChatId = msg.chat.id;
      notificationService.setChatId(primaryChatId);
      logger.info("[main] Đã bind primaryChatId cho notification", { primaryChatId });
    }
    void router(bot, msg);
  });

  // 9. Start pollers/scheduler nền
  focusScheduler.start();
  deviceInfoPoller.start(config.constants.deviceInfoPollIntervalMs);
  quoteScheduler.start(config.constants.quoteIntervalMs);
  markLostService.resumeIfActive();

  logger.info("[main] Bot đã khởi động thành công.");
}

main().catch((err) => {
  // Dùng console.error trực tiếp vì logger có thể chưa init được nếu lỗi xảy ra ở config
  // eslint-disable-next-line no-console
  console.error("[main] Khởi động thất bại:", err);
  process.exit(1);
});
