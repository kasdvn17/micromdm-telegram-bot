import { CodeforcesTaskServiceApi } from "../../services/codeforcesTaskService";
import { DeviceInfoServiceApi } from "../../services/deviceInfoService";
import { FocusServiceApi } from "../../services/focusService";
import { AuthTier, CommandDefinition } from "../../types/command.types";
import { buildDashboardReply } from "./status.command";

export function createMenuCommand(
  focusService: Pick<FocusServiceApi, "status" | "breakUsageRemainingToday">,
  taskService: CodeforcesTaskServiceApi,
  deviceInfoService: DeviceInfoServiceApi
): CommandDefinition {
  return {
    name: "menu",
    tier: AuthTier.Normal,
    handler: (ctx) => buildDashboardReply(
      focusService,
      taskService,
      deviceInfoService,
      ctx.message.telegramId,
      true
    ),
  };
}
