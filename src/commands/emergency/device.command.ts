import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { DeviceCommands } from "../../micromdm/deviceCommands";
import { DeviceInfoServiceApi } from "../../services/deviceInfoService";

export function createDeviceCommands(
  deviceCommands: DeviceCommands,
  deviceInfoService: DeviceInfoServiceApi
): CommandDefinition[] {
  return [
    {
      name: "lock",
      tier: AuthTier.Emergency,
      handler: async (): Promise<string> => {
        await deviceCommands.lock();
        return "🔒 Đã gửi lệnh khoá máy.";
      },
    },
    {
      name: "restart",
      tier: AuthTier.Emergency,
      handler: async (): Promise<string> => {
        await deviceCommands.restart();
        return "🔄 Đã gửi lệnh restart máy.";
      },
    },
    {
      name: "shutdown",
      tier: AuthTier.Emergency,
      handler: async (): Promise<string> => {
        await deviceCommands.shutdown();
        return "🔌 Đã gửi lệnh tắt máy.";
      },
    },
    {
      name: "playsound",
      tier: AuthTier.Emergency,
      handler: async (): Promise<string> => {
        await deviceCommands.playSound();
        return "🔊 Đã yêu cầu phát âm thanh.";
      },
    },
    {
      name: "battery",
      tier: AuthTier.Emergency,
      handler: async (ctx: CommandContext): Promise<string> => {
        const realtime = ctx.effectiveArgs[0] === "realtime";
        const info = await deviceInfoService.getBattery(realtime);
        return `🔋 Pin: ${Math.round(info.batteryLevel * 100)}% (${info.batteryState}) - nguồn: ${info.source}`;
      },
    },
    {
      name: "location",
      tier: AuthTier.Emergency,
      handler: async (): Promise<string> => {
        const info = await deviceInfoService.getLocation(true);
        return `📍 Vị trí: ${info.latitude}, ${info.longitude} (độ chính xác: ${info.horizontalAccuracy ?? "?"}m)`;
      },
    },
    {
      name: "deviceinfo",
      tier: AuthTier.Emergency,
      handler: async (ctx: CommandContext): Promise<string> => {
        const realtime = ctx.effectiveArgs[0] === "realtime";
        const info = await deviceInfoService.getDeviceInfo(realtime);

        const summary =
          `📱 ${info.deviceName ?? "?"} (${info.modelName ?? "?"})\n` +
          `OS: ${info.osVersion ?? "?"}\n` +
          `Pin: ${info.batteryLevel !== undefined ? Math.round(info.batteryLevel * 100) + "%" : "?"} (${info.batteryState ?? "?"})\n` +
          `Supervised: ${info.isSupervised ?? "?"}\n` +
          `Nguồn dữ liệu: ${info.source}`;

        // In toàn bộ field còn lại đã query được (raw) mà chưa có convenience
        // field riêng ở trên, để không "mất" dữ liệu đã fetch.
        const shown = new Set(["DeviceName", "Model", "OSVersion", "BatteryLevel", "BatteryState", "IsSupervised"]);
        const rest = Object.entries(info.raw ?? {})
          .filter(([key]) => !shown.has(key))
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join("\n");

        return rest ? `${summary}\n\n📋 Chi tiết đầy đủ:\n${rest}` : summary;
      },
    },
    {
      name: "status",
      tier: AuthTier.Emergency,
      handler: async (): Promise<string> => {
        const info = await deviceInfoService.getDeviceInfo(false);
        return `📊 Trạng thái thiết bị (cache): ${JSON.stringify(info, null, 2)}`;
      },
    },
  ];
}
