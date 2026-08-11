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


export function createCallCommand(alarmService: AlarmServiceApi): CommandDefinition {
  return {
    name: "call",
    tier: AuthTier.Normal,
    handler: async (ctx): Promise<string> => {
      const [subcommand] = ctx.effectiveArgs;
      if (subcommand?.toLowerCase() !== "test") {
        return "ERROR: Cú pháp: /call test";
      }
      return alarmService.testCall();
    },
  };
}
