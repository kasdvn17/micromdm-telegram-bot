import { AuthTier, CommandDefinition } from "../../types/command.types";
import { AlarmServiceApi } from "../../services/alarmService";

export function createAlarmStopCommand(alarmService: AlarmServiceApi): CommandDefinition {
  return {
    name: "alarm_stop",
    tier: AuthTier.Normal,
    handler: async (): Promise<string> => alarmService.stop(),
  };
}

export function createAlarmStatusCommand(alarmService: AlarmServiceApi): CommandDefinition {
  return {
    name: "alarm_status",
    tier: AuthTier.Normal,
    handler: async (): Promise<string> => alarmService.status(),
  };
}
