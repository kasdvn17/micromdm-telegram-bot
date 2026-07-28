import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { AppManagementServiceApi } from "../../services/appManagementService";
import { ValidationError } from "../../utils/errors";
import { readJsonState, writeJsonState } from "../../utils/jsonStore";

const MANAGED_APPS_FILE = "./data/managed_apps.json";

interface ManagedAppsStore {
  bundleIds: string[];
}

export function createManageAppCommand(
  appManagementService: AppManagementServiceApi
): CommandDefinition {
  return {
    name: "manageapp",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub, bundleIdArg] = ctx.effectiveArgs;

      if (sub === "list") {
        const store = readJsonState<ManagedAppsStore>(MANAGED_APPS_FILE, { bundleIds: [] });
        if (store.bundleIds.length === 0) {
          return "📋 Danh sách managed apps đang trống.";
        }
        return `📋 Danh sách managed apps (${store.bundleIds.length}):\n` + store.bundleIds.map((b) => `- ${b}`).join("\n");
      }

      if (sub === "add") {
        if (!bundleIdArg) {
          throw new ValidationError("Cú pháp: /manageapp <password> add <bundleId>");
        }
        
        const store = readJsonState<ManagedAppsStore>(MANAGED_APPS_FILE, { bundleIds: [] });
        if (!store.bundleIds.includes(bundleIdArg)) {
          store.bundleIds.push(bundleIdArg);
          writeJsonState(MANAGED_APPS_FILE, store);
        }

        try {
          const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleIdArg)}&country=vn`;
          const response = await fetch(url);
          if (!response.ok) {
            return `❌ Đã thêm vào danh sách, nhưng lỗi HTTP ${response.status} khi tìm kiếm iTunes ID.`;
          }
          const data = (await response.json()) as any;
          if (data && data.resultCount > 0 && data.results && data.results.length > 0) {
            const trackId = data.results[0].trackId;
            await appManagementService.installFromAppStore(trackId);
            return `✅ Đã thêm ${bundleIdArg} vào danh sách và gửi lệnh convert sang managed (ID: ${trackId}).`;
          } else {
            return `❌ Đã thêm vào danh sách, nhưng không tìm thấy ứng dụng ${bundleIdArg} trên iTunes Store VN.`;
          }
        } catch (err) {
          return `❌ Đã thêm vào danh sách, nhưng có lỗi khi xử lý: ${(err as Error).message}`;
        }
      }

      if (sub === "enable") {
        const store = readJsonState<ManagedAppsStore>(MANAGED_APPS_FILE, { bundleIds: [] });
        if (store.bundleIds.length === 0) {
          return "📋 Danh sách managed apps đang trống, không có app nào để convert.";
        }

        const results: string[] = [];
        for (const bundleId of store.bundleIds) {
          try {
            const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=vn`;
            const response = await fetch(url);
            if (!response.ok) {
              results.push(`❌ ${bundleId}: Lỗi HTTP ${response.status}`);
              continue;
            }
            const data = (await response.json()) as any;
            if (data && data.resultCount > 0 && data.results && data.results.length > 0) {
              const trackId = data.results[0].trackId;
              await appManagementService.installFromAppStore(trackId);
              results.push(`✅ ${bundleId} (ID: ${trackId}): Đã gửi lệnh Install`);
            } else {
              results.push(`❌ ${bundleId}: Không tìm thấy trên App Store VN`);
            }
          } catch (error) {
            results.push(`❌ ${bundleId}: Lỗi xử lý - ${(error as Error).message}`);
          }
        }
        return `📦 Kết quả convert sang managed:\n\n${results.join("\n")}`;
      }

      throw new ValidationError("Cú pháp: /manageapp <password> enable|add <bundleId>|list");
    },
  };
}
