import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { DeviceCommands } from "../../micromdm/deviceCommands";
import { loadProfileFileBase64, saveUploadedProfile } from "../../profiles/fileProfile";
import { BOT_MANAGED_PROFILE_IDENTIFIERS } from "../../profiles/profileBuilder";
import { DeviceManagerServiceApi } from "../../services/deviceManagerService";
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
 * /installprofile <password> [filename]
 * Hỗ trợ 2 cách:
 *  1. Upload trực tiếp file profile (.mobileconfig/.plist) lên Telegram kèm caption
 *     hoặc reply vào file đó bằng lệnh /installprofile <password>.
 *  2. Tìm `filename` trong thư mục data/ hoặc data/profiles/ để cài file có sẵn trên server.
 */
export function createInstallProfileCommand(
  deviceCommands: DeviceCommands,
  dataDir: string,
  deviceManager?: DeviceManagerServiceApi
): CommandDefinition {
  return {
    name: "installprofile",
    tier: AuthTier.Emergency,
    handler: async (ctx: CommandContext): Promise<string> => {
      const getPrefix = () => {
        const target = deviceManager?.getActiveTargetDevice();
        return target ? `[${target.name}] ` : "";
      };

      // Cách 1: Người dùng đính kèm file hoặc reply vào file
      if (ctx.document && ctx.downloadDocument) {
        await ctx.progress("📥 Đang tải file profile từ Telegram...");
        const { buffer, fileName } = await ctx.downloadDocument();

        if (buffer.length === 0) {
          throw new ValidationError("File profile rỗng.");
        }
        if (buffer.length > 10 * 1024 * 1024) {
          throw new ValidationError("File quá lớn (tối đa 10MB).");
        }

        const customName = ctx.effectiveArgs[0];
        const chosenName = customName || fileName || "uploaded_profile.mobileconfig";
        const { cleanFileName } = saveUploadedProfile(dataDir, chosenName, buffer);

        await ctx.progress("📤 Đang gửi lệnh cài profile tới thiết bị...");
        const base64 = buffer.toString("base64");
        await deviceCommands.installProfile(base64);

        return `📄 ${getPrefix()}Đã nhận file và gửi lệnh cài đặt profile "${cleanFileName}" (lưu tại data/profiles/${cleanFileName}).`;
      }

      // Cách 2: Cài file có sẵn trong data/
      const [filename] = ctx.effectiveArgs;
      if (!filename) {
        throw new ValidationError(
          "📄 Cú pháp /installprofile:\n" +
            "1. Gửi file (.mobileconfig / .plist) kèm caption:\n" +
            "   `/installprofile <password> [tên-lưu] [--target <1|2|tên>]`\n" +
            "2. Hoặc reply vào một file profile với nội dung:\n" +
            "   `/installprofile <password> [tên-lưu] [--target <1|2|tên>]`\n" +
            "3. Hoặc cài file có sẵn trên máy chủ (thư mục data/):\n" +
            "   `/installprofile <password> <tên-file>`"
        );
      }

      const base64 = loadProfileFileBase64(dataDir, filename);
      await deviceCommands.installProfile(base64);
      return `📄 ${getPrefix()}Đã gửi lệnh cài profile từ file "${filename}".`;
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
      if (BOT_MANAGED_PROFILE_IDENTIFIERS.includes(profileIdentifier)) {
        throw new ValidationError(
          `⛔ "${profileIdentifier}" là profile do BOT quản lý (Focus/Blacklist/Safe Mode) - không được xoá qua /removeprofile.\n` +
            "Dùng /focus off, /safe off, hoặc chỉnh danh sách app/website tương ứng thay vì gỡ thẳng profile."
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
