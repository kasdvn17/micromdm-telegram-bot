import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { DeviceCommands } from "../../micromdm/deviceCommands";
import { loadProfileFileBase64 } from "../../profiles/fileProfile";
import { ValidationError } from "../../utils/errors";

/**
 * Lưu ý thuật ngữ: đây là "Profile Identifier" (PayloadIdentifier của cả
 * Configuration Profile, vd "com.personal.micromdmbot.focus"), KHÔNG phải
 * app Bundle ID (vd "com.apple.mobilesafari") - hai khái niệm khác nhau
 * trong Apple MDM protocol dù người dùng hay gọi chung là "bundle id".
 * Muốn quản lý app thì dùng /listapps, /removeapp (app.command.ts).
 */
export function createListProfilesCommand(deviceCommands: DeviceCommands): CommandDefinition {
  return {
    name: "profiles",
    tier: AuthTier.Emergency,
    handler: async (): Promise<string> => {
      const profiles = await deviceCommands.listProfiles();
      if (profiles.length === 0) return "📋 Không có profile nào (hoặc thiết bị chưa phản hồi).";
      return profiles
        .map((p) => {
          const flags = [
            p.isEncrypted ? "encrypted" : null,
            p.hasRemovalPasscode ? "removal passcode" : null,
            p.removalDisallowed ? "removal disallowed" : null,
          ].filter(Boolean);
          return (
            `- ${p.displayName ?? p.identifier} (${p.identifier})` +
            ` - ${p.payloadCount} payload${p.payloadCount === 1 ? "" : "s"}` +
            (flags.length > 0 ? ` [${flags.join(", ")}]` : "")
          );
        })
        .join("\n");
    },
  };
}

/**
 * /installprofile <password> <filename>
 * Tìm `filename` trong thư mục data/ (vd "default.plist" -> data/default.plist)
 * rồi cài trực tiếp qua InstallProfile - dùng cho profile tuỳ ý bạn tự
 * chuẩn bị sẵn (không giới hạn ở default.plist/Focus/Blacklist).
 */
export function createInstallProfileCommand(
  deviceCommands: DeviceCommands,
  dataDir: string
): CommandDefinition {
  return {
    name: "installprofile",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [filename] = ctx.effectiveArgs;
      if (!filename) {
        throw new ValidationError("Cú pháp: /installprofile <password> <filename>\nVd: /installprofile <password> default.plist");
      }
      const base64 = loadProfileFileBase64(dataDir, filename);
      await deviceCommands.installProfile(base64);
      return `📄 Đã gửi lệnh cài profile từ file "data/${filename}".`;
    },
  };
}

export function createRemoveProfileCommand(deviceCommands: DeviceCommands): CommandDefinition {
  return {
    name: "removeprofile",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [profileIdentifier] = ctx.effectiveArgs;
      if (!profileIdentifier) {
        throw new ValidationError(
          "Cú pháp: /removeprofile <password> <profileIdentifier>\n" +
            "Dùng /profiles <password> để xem danh sách profileIdentifier hiện có."
        );
      }
      await deviceCommands.removeProfile(profileIdentifier);
      return (
        `🗑️ Đã gửi lệnh gỡ profile "${profileIdentifier}".\n` +
        "⚠️ Sẽ thất bại nếu profile có PayloadRemovalDisallowed=true hoặc yêu cầu removal passcode " +
        "(vd profile MDM gốc dùng để enroll máy thường không thể tự gỡ qua đường này)."
      );
    },
  };
}
