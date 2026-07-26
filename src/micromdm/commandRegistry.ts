import { DeviceCommands } from "./deviceCommands";
import { MdmCommandQueuedResult } from "../types/micromdm.types";

export interface CommandRegistryEntry {
  name: string;
  /** true = lệnh nguy hiểm, bắt buộc từ khoá CONFIRM khi gọi qua /api */
  requiresConfirm: boolean;
  handler: (deviceCommands: DeviceCommands, params: string[]) => Promise<MdmCommandQueuedResult | unknown>;
}

/**
 * Whitelist các command name được phép gọi qua `/api <password> <name> [params...]`.
 * Đây là điểm kiểm soát duy nhất quyết định lệnh nào /api có thể chạm tới -
 * KHÔNG suy ra danh sách này từ DeviceCommands bằng reflection, để tránh
 * vô tình expose thêm method mới thêm sau này mà chưa được rà soát an toàn.
 *
 * EraseDevice CÓ trong whitelist (theo yêu cầu: /api xác thực two-factor nên
 * được phép), nhưng `requiresConfirm: true` bắt buộc người gọi phải thêm
 * từ khoá CONFIRM ở cuối lệnh Telegram.
 */
const REGISTRY: CommandRegistryEntry[] = [
  { name: "Lock", requiresConfirm: false, handler: (dc) => dc.lock() },
  { name: "Unlock", requiresConfirm: false, handler: (dc) => dc.unlock() },
  { name: "Restart", requiresConfirm: false, handler: (dc) => dc.restart() },
  { name: "Shutdown", requiresConfirm: true, handler: (dc) => dc.shutdown() },
  { name: "PlaySound", requiresConfirm: false, handler: (dc) => dc.playSound() },
  { name: "GetBattery", requiresConfirm: false, handler: (dc) => dc.getBattery() },
  { name: "GetLocation", requiresConfirm: false, handler: (dc) => dc.getLocation() },
  { name: "GetDeviceInfo", requiresConfirm: false, handler: (dc) => dc.getDeviceInfo() },
  { name: "EnableLostMode", requiresConfirm: true, handler: (dc, p) => dc.enableLostMode(p[0]) },
  { name: "DisableLostMode", requiresConfirm: false, handler: (dc) => dc.disableLostMode() },
  { name: "ListProfiles", requiresConfirm: false, handler: (dc) => dc.listProfiles() },
  { name: "RemoveProfile", requiresConfirm: true, handler: (dc, p) => dc.removeProfile(p[0]) },
  {
    // Cực nhạy cảm (xem cảnh báo tại deviceCommands.getActivationLockBypassCode) -
    // luôn bắt buộc CONFIRM dù đã ở Two-Factor tier.
    name: "GetActivationLockBypassCode",
    requiresConfirm: true,
    handler: (dc) => dc.getActivationLockBypassCode(),
  },
  {
    name: "EraseDevice",
    requiresConfirm: true, // nguy hiểm nhất - luôn bắt buộc CONFIRM dù đã two-factor
    handler: (dc, p) => dc.eraseDevice(p[0]),
  },
];

const REGISTRY_MAP = new Map<string, CommandRegistryEntry>(
  REGISTRY.map((entry) => [entry.name.toLowerCase(), entry])
);

export function resolveApiCommand(name: string): CommandRegistryEntry | undefined {
  return REGISTRY_MAP.get(name.toLowerCase());
}

export function listApiCommandNames(): string[] {
  return REGISTRY.map((e) => e.name);
}
