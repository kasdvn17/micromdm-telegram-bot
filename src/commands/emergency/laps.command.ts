import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { LapsServiceApi } from "../../services/lapsService";
import { ValidationError } from "../../utils/errors";

export function createLapsCommand(lapsService: LapsServiceApi): CommandDefinition {
  return {
    name: "laps",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub, ...rest] = ctx.effectiveArgs;

      if (!sub || sub === "status") {
        const state = lapsService.getStatus();
        const lines: string[] = [
          "🔐 **TRẠNG THÁI QUẢN TRỊ LAPS & AGENT**",
          `• Thiết bị: \`${state.hostname ?? "Chưa rõ"}\` (${state.serialNumber ?? "Chưa có serial"})`,
          `• IP: \`${state.ipAddress ?? "Chưa rõ"}\``,
          `• Tài khoản Admin: \`${state.adminUser}\``,
          `• Người dùng blamm01: ${
            state.isBlamm01Admin
              ? "⚠️ **Vẫn còn quyền Admin**"
              : "👤 **Standard User (Đã hạ quyền)**"
          }`,
          `• Check-in gần nhất: ${state.lastCheckinAt ? new Date(state.lastCheckinAt).toLocaleString("vi-VN") : "Chưa có"}`,
          `• Xoay pass gần nhất: ${state.lastRotatedAt ? new Date(state.lastRotatedAt).toLocaleString("vi-VN") : "Chưa có"}`,
        ];

        if (state.pendingAction) {
          lines.push(`• ⏳ **Lệnh chờ thực thi:** [${state.pendingAction.type}] (tạo lúc ${new Date(state.pendingAction.createdAt).toLocaleTimeString()})`);
        } else {
          lines.push("• ⏳ Lệnh chờ: Không có");
        }

        return lines.join("\n");
      }

      if (sub === "pass" || sub === "password") {
        const creds = lapsService.getPassword();
        if (!creds.password) {
          return `⚠️ Chưa có mật khẩu được lưu cho tài khoản [${creds.adminUser}]. Hãy đảm bảo daemon đã chạy lần đầu.`;
        }
        return [
          `🔑 **MẬT KHẨU ADMIN HIỆN TẠI**`,
          `• Tài khoản: \`${creds.adminUser}\``,
          `• Mật khẩu: \`${creds.password}\``,
          `• Xoay lần cuối: ${creds.lastRotatedAt ? new Date(creds.lastRotatedAt).toLocaleString("vi-VN") : "Chưa rõ"}`,
          `\n*(Khuyên dùng: Xoá tin nhắn này sau khi sử dụng để bảo mật)*`,
        ].join("\n");
      }

      if (sub === "rotate") {
        return await lapsService.requestRotateNow();
      }

      if (sub === "demote") {
        const target = rest[0] || "blamm01";
        return await lapsService.requestDemote(target);
      }

      if (sub === "elevate") {
        const duration = rest[0] ? parseInt(rest[0], 10) : 30;
        if (isNaN(duration) || duration <= 0) {
          throw new ValidationError("Thời gian cấp quyền phải là số phút dương. Vd: /laps <password> elevate 30");
        }
        return await lapsService.requestElevate("blamm01", duration);
      }

      if (sub === "exec") {
        const command = rest.join(" ");
        if (!command) {
          throw new ValidationError("Cú pháp: /laps <password> exec <command>");
        }
        return await lapsService.requestExec(command);
      }

      if (sub === "cancel") {
        const cancelled = await lapsService.cancelPendingAction();
        return cancelled
          ? "✅ Đã huỷ lệnh chờ thực thi thành công."
          : "ℹ️ Hiện không có lệnh nào đang chờ.";
      }

      throw new ValidationError(
        "Cú pháp /laps <password>:\n" +
          "• /laps status : Xem trạng thái agent & tài khoản\n" +
          "• /laps pass : Xem mật khẩu admin hiện tại\n" +
          "• /laps rotate : Yêu cầu xoay mật khẩu ngay\n" +
          "• /laps demote [user] : Hạ quyền admin của blamm01\n" +
          "• /laps elevate [phút] : Cấp quyền admin tạm thời cho blamm01\n" +
          "• /laps exec <cmd> : Gửi lệnh shell root cho daemon\n" +
          "• /laps cancel : Huỷ lệnh chờ"
      );
    },
  };
}
