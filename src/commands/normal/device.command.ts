import { AuthTier, CommandContext, CommandDefinition, CommandResponse } from "../../types/command.types";
import { DeviceManagerServiceApi } from "../../services/deviceManagerService";
import { MicroMdmClient } from "../../micromdm/client";
import { ValidationError } from "../../utils/errors";

export function buildDeviceListReply(
  deviceManager: DeviceManagerServiceApi,
  interactive = true
): CommandResponse {
  const devices = deviceManager.listDevices();
  const primaryUdid = deviceManager.getPrimaryUDID();
  const targetUdid = deviceManager.getTargetUDID();

  if (devices.length === 0) {
    return "📱 Chưa có thiết bị nào được ghi nhận. Thiết bị sẽ tự động xuất hiện khi enroll hoặc dùng /device add <udid>.";
  }

  const lines: string[] = [`📱 Danh sách thiết bị (${devices.length}):\n`];

  devices.forEach((dev, idx) => {
    const isPrimary = dev.udid.toLowerCase() === primaryUdid.toLowerCase();
    const isTarget = dev.udid.toLowerCase() === targetUdid.toLowerCase();

    const badges: string[] = [];
    if (isPrimary) badges.push("⭐ Primary");
    if (isTarget) badges.push("🎯 Target");
    const badgeText = badges.length > 0 ? ` [${badges.join(" · ")}]` : "";

    const statusIcon = dev.status === "online" ? "🟢" : dev.status === "offline" ? "🔴" : "🟡";
    const batteryText =
      dev.batteryLevel !== undefined
        ? `• Pin: ${Math.round(dev.batteryLevel * 100)}%${dev.batteryState ? ` (${dev.batteryState})` : ""}`
        : undefined;
    const modelText = dev.model || dev.modelName ? `• Model: ${dev.modelName ?? dev.model}${dev.osVersion ? ` (iOS ${dev.osVersion})` : ""}` : undefined;

    lines.push(
      `${idx + 1}. 📱 ${dev.name}${badgeText}\n` +
      `   • UDID: \`${dev.udid}\`\n` +
      (modelText ? `   ${modelText}\n` : "") +
      (batteryText ? `   ${batteryText}\n` : "") +
      `   • Trạng thái: ${statusIcon} ${dev.status} (Check-in: ${dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleTimeString("vi-VN") : "chưa rõ"})\n`
    );
  });

  lines.push(
    "💡 Hướng dẫn:\n" +
    "• Đổi target: `/target <1|2|tên|udid>`\n" +
    "• Đặt primary: `/device primary <1|2|tên|udid>`\n" +
    "• Đổi tên: `/device rename <1|2> <tên mới>`\n" +
    "• Thêm thiết bị: `/device add <udid> [tên]`\n" +
    "• Xoá thiết bị: `/device remove <1|2>`\n" +
    "• Đồng bộ MDM: `/device sync`\n" +
    "• Dùng trong lệnh: `/lock <pass> --target 2`"
  );

  const text = lines.join("\n");
  if (!interactive) return text;

  // Xây dựng inline keyboard cho các thao tác nhanh
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  devices.forEach((dev, idx) => {
    const isPrimary = dev.udid.toLowerCase() === primaryUdid.toLowerCase();
    const isTarget = dev.udid.toLowerCase() === targetUdid.toLowerCase();
    const row: Array<{ text: string; callback_data: string }> = [];

    if (!isTarget) {
      row.push({
        text: `🎯 Chọn Target #${idx + 1}`,
        callback_data: `dev:target:${dev.udid}`,
      });
    }
    if (!isPrimary) {
      row.push({
        text: `⭐ Đặt Primary #${idx + 1}`,
        callback_data: `dev:primary:${dev.udid}`,
      });
    }

    if (row.length > 0) keyboard.push(row);
  });

  keyboard.push([
    { text: "🔄 Đồng bộ MicroMDM", callback_data: "dev:sync" },
    { text: "♻️ Làm mới", callback_data: "dev:refresh" },
  ]);

  return {
    text,
    options: {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: keyboard,
      },
    },
  };
}

export function createDeviceManagementCommands(
  deviceManager: DeviceManagerServiceApi,
  client?: MicroMdmClient
): CommandDefinition[] {
  const deviceHandler = async (ctx: CommandContext): Promise<CommandResponse> => {
    const [sub, ...rest] = ctx.effectiveArgs;

    if (!sub || sub === "list") {
      return buildDeviceListReply(deviceManager, true);
    }

    if (sub === "primary") {
      const query = rest.join(" ");
      if (!query) throw new ValidationError("Cú pháp: /device primary <1|2|tên|udid>");
      const dev = deviceManager.setPrimary(query);
      return `⭐ Đã đặt thiết bị **${dev.name}** (\`${dev.udid}\`) làm Primary.`;
    }

    if (sub === "target") {
      const query = rest.join(" ");
      if (!query) throw new ValidationError("Cú pháp: /device target <1|2|tên|udid|primary>");
      const dev = query.toLowerCase() === "primary" ? deviceManager.resetTarget() : deviceManager.setTarget(query);
      return `🎯 Đã chuyển target sang thiết bị **${dev.name}** (\`${dev.udid}\`).\nCác lệnh tiếp theo sẽ áp dụng lên thiết bị này. (Dùng \`/target primary\` để quay lại thiết bị chính).`;
    }

    if (sub === "rename") {
      const targetQuery = rest[0];
      const newName = rest.slice(1).join(" ");
      if (!targetQuery || !newName) {
        throw new ValidationError("Cú pháp: /device rename <1|2|tên|udid> <tên mới>");
      }
      const dev = deviceManager.renameDevice(targetQuery, newName);
      return `✏️ Đã đổi tên thiết bị (\`${dev.udid}\`) thành: **${dev.name}**.`;
    }

    if (sub === "add") {
      const udid = rest[0];
      const name = rest.slice(1).join(" ") || undefined;
      if (!udid) throw new ValidationError("Cú pháp: /device add <udid> [tên]");
      const dev = deviceManager.registerOrUpdate(udid, { name });
      return `➕ Đã thêm thiết bị **${dev.name}** (\`${dev.udid}\`) vào danh sách quản lý.`;
    }

    if (sub === "remove") {
      const targetQuery = rest.join(" ");
      if (!targetQuery) throw new ValidationError("Cú pháp: /device remove <1|2|tên|udid>");
      const dev = deviceManager.removeDevice(targetQuery);
      return `🗑️ Đã xóa thiết bị **${dev.name}** (\`${dev.udid}\`) khỏi danh sách quản lý.`;
    }

    if (sub === "sync") {
      if (!client) {
        return "⚠️ Không có kết nối tới MicroMDM client để đồng bộ.";
      }
      const list = await deviceManager.syncWithMicroMdm(client);
      return `🔄 Đã đồng bộ với MicroMDM. Hiện có ${list.length} thiết bị trong danh sách. Dùng /devices để xem chi tiết.`;
    }

    if (sub === "info") {
      const query = rest.join(" ") || "target";
      const dev = deviceManager.resolveDevice(query);
      if (!dev) throw new ValidationError(`Không tìm thấy thiết bị nào khớp với "${query}".`);

      return (
        `📱 Chi tiết thiết bị: **${dev.name}**\n` +
        `• UDID: \`${dev.udid}\`\n` +
        `• Primary: ${dev.isPrimary ? "Có ⭐" : "Không"}\n` +
        `• Active Target: ${dev.udid.toLowerCase() === deviceManager.getTargetUDID().toLowerCase() ? "Có 🎯" : "Không"}\n` +
        `• Model: ${dev.modelName ?? dev.model ?? "chưa rõ"}\n` +
        `• OS Version: ${dev.osVersion ?? "chưa rõ"}\n` +
        `• Serial: ${dev.serialNumber ?? "chưa rõ"}\n` +
        `• Supervised: ${dev.isSupervised !== undefined ? (dev.isSupervised ? "Có" : "Không") : "chưa rõ"}\n` +
        `• Pin: ${dev.batteryLevel !== undefined ? `${Math.round(dev.batteryLevel * 100)}% (${dev.batteryState ?? "?"})` : "chưa rõ"}\n` +
        `• Trạng thái: ${dev.status}\n` +
        `• Enroll lần đầu: ${dev.enrolledAt ? new Date(dev.enrolledAt).toLocaleString("vi-VN") : "chưa rõ"}\n` +
        `• Check-in gần nhất: ${dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleString("vi-VN") : "chưa rõ"}`
      );
    }

    throw new ValidationError(
      "Cú pháp /device:\n" +
      "/device list — xem danh sách\n" +
      "/device primary <target> — đặt làm Primary\n" +
      "/device target <target> — đổi target sang thiết bị khác\n" +
      "/device rename <target> <tên mới> — đổi tên\n" +
      "/device add <udid> [tên] — thêm thiết bị thủ công\n" +
      "/device remove <target> — xóa thiết bị\n" +
      "/device sync — đồng bộ từ MicroMDM\n" +
      "/device info [target] — xem chi tiết"
    );
  };

  return [
    {
      name: "device",
      tier: AuthTier.Normal,
      handler: deviceHandler,
    },
    {
      name: "devices",
      tier: AuthTier.Normal,
      handler: async () => buildDeviceListReply(deviceManager, true),
    },
    {
      name: "target",
      tier: AuthTier.Normal,
      handler: async (ctx: CommandContext): Promise<string> => {
        const query = ctx.effectiveArgs.join(" ").trim();
        if (!query) {
          const target = deviceManager.getTargetDevice();
          const primary = deviceManager.getPrimaryDevice();
          return (
            `🎯 Target hiện tại: **${target?.name ?? "?"}** (\`${target?.udid ?? "?"}\`)${target?.isPrimary ? " [Primary ⭐]" : ""}\n` +
            `⭐ Thiết bị chính (Primary): **${primary?.name ?? "?"}** (\`${primary?.udid ?? "?"}\`)\n\n` +
            `👉 Để đổi target, gõ: \`/target <1|2|tên|udid>\` hoặc \`/target primary\``
          );
        }

        if (query.toLowerCase() === "primary" || query.toLowerCase() === "reset") {
          const dev = deviceManager.resetTarget();
          return `🎯 Đã chuyển target về thiết bị Primary: **${dev.name}** (\`${dev.udid}\`).`;
        }

        const dev = deviceManager.setTarget(query);
        return `🎯 Đã đổi target sang: **${dev.name}** (\`${dev.udid}\`).\nCác lệnh tiếp theo sẽ áp dụng lên thiết bị này. (Dùng \`/target primary\` để quay lại thiết bị chính).`;
      },
    },
  ];
}
