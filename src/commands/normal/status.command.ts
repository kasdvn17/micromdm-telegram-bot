import { AuthTier, CommandDefinition, CommandResponse } from "../../types/command.types";
import { CodeforcesTaskServiceApi } from "../../services/codeforcesTaskService";
import { DeviceInfoServiceApi } from "../../services/deviceInfoService";
import { DeviceManagerServiceApi } from "../../services/deviceManagerService";
import { FocusServiceApi } from "../../services/focusService";
import { formatDuration } from "../../utils/time";

export function createStatusCommand(
  focusService: Pick<FocusServiceApi, "status" | "breakUsageRemainingToday">,
  taskService: CodeforcesTaskServiceApi,
  deviceInfoService: DeviceInfoServiceApi,
  deviceManager?: DeviceManagerServiceApi
): CommandDefinition {
  return {
    name: "status",
    tier: AuthTier.Normal,
    handler: async (ctx): Promise<CommandResponse> =>
      buildDashboardReply(focusService, taskService, deviceInfoService, ctx.message.telegramId, false, deviceManager),
  };
}

export async function buildDashboardReply(
  focusService: Pick<FocusServiceApi, "status" | "breakUsageRemainingToday">,
  taskService: CodeforcesTaskServiceApi,
  deviceInfoService: DeviceInfoServiceApi,
  telegramId: number,
  interactive = true,
  deviceManager?: DeviceManagerServiceApi
): Promise<CommandResponse> {
      const focus = focusService.status();
      const breakRemaining = focusService.breakUsageRemainingToday();
      const inSleep = !!(
        focus.sleepUnlock.withinTimeRange && focus.sleepUnlock.sessionStartedAt
      );
      const gate = taskService.getDailyGateStatus(
        telegramId,
        inSleep
          ? { since: focus.sleepUnlock.sessionStartedAt, requiredCount: 3 }
          : { requiredCount: 7 }
      );
      const legacyDailyUnlock = !!(
        inSleep &&
        taskService.getDailyGateStatus(telegramId, { requiredCount: 7 }).focusOffAllowed
      );
      const tasks = taskService.listTasks(telegramId);
      const activeTasks = tasks.filter((task) => task.status === "active" && !task.archivedAt);
      const device = await deviceInfoService.getDeviceInfo(false);

      const target = deviceManager?.getActiveTargetDevice();
      const primary = deviceManager?.getPrimaryDevice();
      const isPrimary = target && primary && target.udid.toLowerCase() === primary.udid.toLowerCase();
      const deviceTitle = target
        ? `${target.name} (${isPrimary ? "⭐ Primary · 🎯 Target" : "🎯 Target"})`
        : (device.deviceName ?? "Thiết bị");

      const text = [
        "📊 Tổng quan",
        `📱 ${deviceTitle}: ${device.batteryLevel === undefined ? "pin ?" : `${Math.round(device.batteryLevel * 100)}%`} (${device.source})`,
        `🎯 Focus: ${focus.active ? "BẬT" : "TẮT"}${focus.withinSleep ? " · Sleep Mode" : ""}${focus.sleepUnlock.breakActive ? ` · Sleep break còn ${formatDuration(focus.sleepUnlock.breakRemainingMs)}` : focus.onBreak ? ` · break còn ${formatDuration(focus.breakRemainingMs ?? 0)}` : ""}`,
        `☕ Gate break: ${gate.acceptedSinceLastBreak}/${gate.breakRequiredCount}${gate.breakAllowed ? " ✅" : " ⏳"}`,
        focus.sleepUnlock.unlockedByEarlierFocusOff || legacyDailyUnlock
          ? "🌙 Gate Focus off: đã mở khóa vì hôm nay từng Focus off ✅"
          : `${inSleep ? "🌙" : "📅"} Gate Focus off: ${gate.focusOffAcceptedCount}/${gate.focusOffRequiredCount}${gate.focusOffAllowed ? " ✅" : " ⏳"}`,
        `📋 Task: ${activeTasks.length} active / ${tasks.filter((task) => task.status === "solved" && !task.archivedAt).length} đã AC`,
        `⏱ Hạn mức break còn: ${breakRemaining.breaksRemaining} lần / ${formatDuration(breakRemaining.totalMsRemaining)}`,
      ].join("\n");
      if (!interactive) return text;
      return {
        text,
        options: {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔄 Refresh", callback_data: "dash:refresh" },
                {
                  text:
                    focus.sleepUnlock.withinTimeRange
                      ? focus.sleepUnlock.breakUsed
                        ? focus.sleepUnlock.breakActive
                          ? "🔄 Redo Sleep break"
                          : "🌙 Sleep break đã dùng"
                        : "🌙 Sleep break 1h"
                      : "☕ Break 15m",
                  callback_data: "dash:break",
                },
              ],
              [
                { text: "⏹ Focus off", callback_data: "dash:off" },
                { text: "📋 Tasks", callback_data: "dash:tasks" },
              ],
              [
                { text: "🎯 Next task", callback_data: "dash:next" },
                { text: "🏷 Tags", callback_data: "dash:tags" },
              ],
              [
                { text: "📱 Thiết bị", callback_data: "dash:devices" },
                { text: "↻ Cập nhật dashboard", callback_data: "dash:reload" },
              ],
            ],
          },
        },
      };
}
