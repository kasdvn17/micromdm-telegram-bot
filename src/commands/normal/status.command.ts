import { AuthTier, CommandDefinition } from "../../types/command.types";
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
    handler: async (ctx): Promise<string> => {
      const focus = focusService.status();
      const breakRemaining = focusService.breakUsageRemainingToday();
      const inSleep = !!(
        focus.sleepUnlock.withinTimeRange && focus.sleepUnlock.sessionStartedAt
      );
      const gate = taskService.getDailyGateStatus(
        ctx.message.telegramId,
        inSleep
          ? { since: focus.sleepUnlock.sessionStartedAt, requiredCount: 3 }
          : { requiredCount: 7 }
      );
      const tasks = taskService.listTasks(ctx.message.telegramId);
      const activeTasks = tasks.filter((task) => task.status === "active" && !task.archivedAt);
      const device = await deviceInfoService.getDeviceInfo(false);
      return [
        "📊 Tổng quan",
        `📱 ${device.deviceName ?? "Thiết bị"}: ${device.batteryLevel === undefined ? "pin ?" : `${Math.round(device.batteryLevel * 100)}%`} (${device.source})`,
        `🎯 Focus: ${focus.active ? "BẬT" : "TẮT"}${focus.withinSleep ? " · Sleep Mode" : ""}${focus.onBreak ? ` · break còn ${formatDuration(focus.breakRemainingMs ?? 0)}` : ""}`,
        `☕ Gate break: ${gate.acceptedSinceLastBreak}/${gate.breakRequiredCount}${gate.breakAllowed ? " ✅" : " ⏳"}`,
        `${inSleep ? "🌙" : "📅"} Gate Focus off: ${gate.focusOffAcceptedCount}/${gate.focusOffRequiredCount}${gate.focusOffAllowed ? " ✅" : " ⏳"}`,
        `📋 Task: ${activeTasks.length} active / ${tasks.filter((task) => task.status === "solved" && !task.archivedAt).length} đã AC`,
        `⏱ Hạn mức break còn: ${breakRemaining.breaksRemaining} lần / ${formatDuration(breakRemaining.totalMsRemaining)}`,
      ].join("\n");
    },
  };
}
