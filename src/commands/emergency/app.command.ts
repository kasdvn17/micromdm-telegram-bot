import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { AppManagementServiceApi } from "../../services/appManagementService";
import { ValidationError } from "../../utils/errors";

/**
 * Cú pháp (Emergency tier - password ngay sau tên lệnh, theo quy ước chung):
 *   /installapp <password> manifest <https-url-tới-Manifest.plist>
 *   /installapp <password> appstore <iTunesStoreID>
 *   /listapps <password> [managed|all]   (mặc định "all")
 *   /removeapp <password> <bundleId>
 */
export function createInstallAppCommand(appManagement: AppManagementServiceApi): CommandDefinition {
  return {
    name: "installapp",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [mode, value] = ctx.effectiveArgs;
      if (mode === "manifest") {
        if (!value) throw new ValidationError("Cú pháp: /installapp <password> manifest <https-url>");
        await appManagement.installFromManifest(value);
        return (
          "📦 Đã gửi lệnh cài app (managed) từ Manifest URL.\n" +
          "⚠️ Chỉ hoạt động đáng tin cậy với app enterprise/in-house tự ký."
        );
      }
      if (mode === "appstore") {
        const id = Number.parseInt(value ?? "", 10);
        if (!Number.isFinite(id)) throw new ValidationError("Cú pháp: /installapp <password> appstore <iTunesStoreID>");
        await appManagement.installFromAppStore(id);
        return (
          "📦 Đã gửi lệnh cài app từ App Store (iTunesStoreID).\n" +
          "⚠️ CẢNH BÁO: không có VPP (không dùng ABM) nên app CÓ THỂ không cài được dạng managed, " +
          "có thể báo lỗi 'This Apple ID cannot be used to make purchases' hoặc kẹt ở trạng thái Installing " +
          "trên máy. Dùng /listapps để kiểm tra kết quả thực tế."
        );
      }
      throw new ValidationError("Cú pháp: /installapp <password> manifest <url> | appstore <iTunesStoreID>");
    },
  };
}

export function createListAppsCommand(appManagement: AppManagementServiceApi): CommandDefinition {
  return {
    name: "listapps",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [mode] = ctx.effectiveArgs;
      const managedOnly = mode === "managed";
      const apps = await appManagement.listApps(managedOnly);
      if (apps.length === 0) return "📋 Không có app nào (hoặc thiết bị chưa phản hồi).";
      return apps
        .map(
          (a) =>
            `- ${a.name ?? a.identifier} (${a.identifier})${a.version ? ` v${a.version}` : ""}${
              a.managed ? " [managed]" : ""
            }`
        )
        .join("\n");
    },
  };
}

export function createRemoveAppCommand(appManagement: AppManagementServiceApi): CommandDefinition {
  return {
    name: "removeapp",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [bundleId] = ctx.effectiveArgs;
      if (!bundleId) throw new ValidationError("Cú pháp: /removeapp <password> <bundleId>");
      await appManagement.removeApp(bundleId);
      return (
        `🗑️ Đã gửi lệnh gỡ "${bundleId}".\n` +
        "⚠️ Chỉ hoạt động nếu app đang được MDM quản lý (managed) - app cài thủ công/App Store thường sẽ báo lỗi."
      );
    },
  };
}
