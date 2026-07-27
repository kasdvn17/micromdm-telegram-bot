import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { SafeModeServiceApi } from "../../services/safeModeService";
import { ValidationError } from "../../utils/errors";

export function createSafeCommand(safeModeService: SafeModeServiceApi): CommandDefinition {
  return {
    name: "safe",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub] = ctx.effectiveArgs;
      if (sub === "on") {
        if (safeModeService.isActive()) return "🛡️ Safe mode đã đang BẬT rồi.";
        await safeModeService.enable();
        return "🛡️ Safe mode đã BẬT (vô thời hạn). Chỉ tắt bằng /safe off.";
      }
      if (sub === "off") {
        if (!safeModeService.isActive()) return "🛡️ Safe mode đang TẮT rồi.";
        await safeModeService.disable();
        return "🛡️ Safe mode đã TẮT.";
      }
      if (sub === "blockadd") {
        const bundleId = ctx.effectiveArgs[1];
        if (!bundleId) throw new ValidationError("Cú pháp: /safe <password> blockadd <bundleId>");
        const appliedNow = await safeModeService.addBlockApplication(bundleId);
        return appliedNow
          ? `🚫 Đã thêm "${bundleId}" vào danh sách chặn của Safe Mode và áp dụng NGAY (đang bật).`
          : `🚫 Đã thêm "${bundleId}" vào danh sách chặn của Safe Mode. Sẽ áp dụng khi bật Safe Mode lần tới (hiện đang TẮT).`;
      }
      if (sub === "blockremove") {
        const bundleId = ctx.effectiveArgs[1];
        if (!bundleId) throw new ValidationError("Cú pháp: /safe <password> blockremove <bundleId>");
        const appliedNow = await safeModeService.removeBlockApplication(bundleId);
        return appliedNow
          ? `✅ Đã gỡ "${bundleId}" khỏi danh sách chặn của Safe Mode và áp dụng NGAY (đang bật).`
          : `✅ Đã gỡ "${bundleId}" khỏi danh sách chặn của Safe Mode. Sẽ áp dụng khi bật Safe Mode lần tới (hiện đang TẮT).`;
      }
      if (sub === "blocklist") {
        const list = await safeModeService.listBlockApplications();
        return list.length === 0
          ? "📋 Danh sách chặn của Safe Mode đang trống (data/sensitive_apps.json)."
          : list.map((b) => `- ${b}`).join("\n");
      }
      throw new ValidationError("Cú pháp: /safe on|off|blockadd <bundleId>|blockremove <bundleId>|blocklist");
    },
  };
}
