import { AuthTier, CommandDefinition, CommandResponse } from "../../types/command.types";
import { CodeforcesTaskServiceApi } from "../../services/codeforcesTaskService";
import { DeviceInfoServiceApi } from "../../services/deviceInfoService";
import { FocusServiceApi } from "../../services/focusService";
import { formatDuration } from "../../utils/time";

export function createStatusCommand(
  focusService: Pick<FocusServiceApi, "status" | "breakUsageRemainingToday">,
  taskService: CodeforcesTaskServiceApi,
  deviceInfoService: DeviceInfoServiceApi
): CommandDefinition {
  return {
    name: "status",
    tier: AuthTier.Normal,
    handler: async (ctx): Promise<CommandResponse> =>
      buildDashboardReply(focusService, taskService, deviceInfoService, ctx.message.telegramId, false),
  };
}

export async function buildDashboardReply(
  focusService: Pick<FocusServiceApi, "status" | "breakUsageRemainingToday">,
  taskService: CodeforcesTaskServiceApi,
  deviceInfoService: DeviceInfoServiceApi,
  telegramId: number,
  interactive = true
): Promise<CommandResponse> {
      const focus = focusService.status();
      const breakRemaining = focusService.breakUsageRemainingToday();
      const gate = taskService.getDailyGateStatus(telegramId);
      const tasks = taskService.listTasks(telegramId);
      const activeTasks = tasks.filter((task) => task.status === "active" && !task.archivedAt);
      const device = await deviceInfoService.getDeviceInfo(false);
      const text = [
        "📊 Tổng quan",
        `📱 ${device.deviceName ?? "Thiết bị"}: ${device.batteryLevel === undefined ? "pin ?" : `${Math.round(device.batteryLevel * 100)}%`} (${device.source})`,
        `🎯 Focus: ${focus.active ? "BẬT" : "TẮT"}${focus.withinSleep ? " · Sleep Mode" : ""}${focus.sleepUnlock.breakActive ? ` · Sleep break còn ${formatDuration(focus.sleepUnlock.breakRemainingMs)}` : focus.onBreak ? ` · break còn ${formatDuration(focus.breakRemainingMs ?? 0)}` : ""}`,
        `☕ Gate break: ${gate.acceptedSinceLastBreak}/${gate.breakRequiredCount}${gate.breakAllowed ? " ✅" : " ⏳"}`,
        "⏹ Focus off: luôn khả dụng, không yêu cầu task AC",
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
                    focus.sleepUnlock.withinTimeRange && focus.sleepUnlock.weekendSession
                      ? focus.sleepUnlock.breakUsed
                        ? "🌙 Sleep break đã dùng"
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
              [{ text: "↻ Cập nhật dashboard", callback_data: "dash:reload" }],
            ],
          },
        },
      };
}
