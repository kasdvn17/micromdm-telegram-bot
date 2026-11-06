import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { FocusServiceApi } from "../../services/focusService";
import { formatDuration } from "../../utils/time";

export function createRedoCommand(focusService: FocusServiceApi): CommandDefinition[] {
  const handler = async (_ctx: CommandContext): Promise<string> => {
    const result = await focusService.redoBreak();
    const timeRemaining = formatDuration(result.remainingMs);
    if (result.breakType === "sleep") {
      const endsAtText = result.breakUntil
        ? ` (kết thúc lúc ${new Date(result.breakUntil).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })})`
        : "";
      return (
        `🔄 Đã refresh trạng thái và redo thao tác gỡ profile Focus thành công.\n` +
        `🌙 Phiên Sleep break 60p vẫn giữ nguyên thời gian cũ: còn lại ${timeRemaining}${endsAtText}.\n` +
        `• Điện thoại: Đã gửi lệnh gỡ profile Focus.\n` +
        `• macOS: Đã unblock website trong /etc/hosts và gỡ profile web filter.`
      );
    }
    return (
      `🔄 Đã refresh trạng thái và redo thao tác gỡ profile Focus thành công.\n` +
      `☕ Thời gian break còn lại: ${timeRemaining}.\n` +
      `• Đã gửi lại lệnh gỡ profile trên cả 2 máy.`
    );
  };

  return [
    {
      name: "redo",
      tier: AuthTier.Normal,
      handler,
    },
    {
      name: "retry",
      tier: AuthTier.Normal,
      handler,
    },
  ];
}
