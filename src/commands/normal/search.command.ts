import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { ValidationError } from "../../utils/errors";

export function createSearchCommand(): CommandDefinition {
  return {
    name: "search",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const bundleIds = ctx.effectiveArgs;
      if (bundleIds.length === 0) {
        throw new ValidationError("Cú pháp: /search <bundleId1> [bundleId2] ...");
      }

      const results: string[] = [];

      for (const bundleId of bundleIds) {
        try {
          const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=vn`;
          const response = await fetch(url);
          
          if (!response.ok) {
            results.push(`❌ ${bundleId}: Lỗi HTTP ${response.status}`);
            continue;
          }

          const data = (await response.json()) as any;

          if (data && data.resultCount > 0 && data.results && data.results.length > 0) {
            const app = data.results[0];
            results.push(`✅ ${bundleId}\nTên: ${app.trackName}\nID: ${app.trackId}`);
          } else {
            results.push(`❌ ${bundleId}: Không tìm thấy`);
          }
        } catch (error) {
          results.push(`❌ ${bundleId}: Lỗi khi tìm kiếm`);
        }
      }

      return results.join("\n\n");
    },
  };
}
