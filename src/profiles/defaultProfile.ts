import fs from "fs";
import path from "path";
import { getLogger } from "../utils/logger";

export const DEFAULT_PROFILE_IDENTIFIER = "com.personal.micromdmbot.default";

const PROFILE_UUID = "8f6a5c1e-2b3d-4e5f-9a0b-1c2d3e4f5a6b";

/**
 * Nội dung mẫu - CHỈ dùng để tự tạo file lần đầu nếu `data/default.plist`
 * chưa tồn tại. Sau lần tạo đầu tiên, sửa NỘI DUNG FILE trực tiếp (vd thêm
 * PayloadContent thật: Restrictions, WiFi, Passcode...), không cần đụng code
 * hay rebuild - đây chính là lý do chuyển từ hardcode trong source sang file
 * riêng trong data/.
 */
const TEMPLATE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PayloadContent</key>
\t<array>
\t</array>
\t<key>PayloadDisplayName</key>
\t<string>Default Bot Profile</string>
\t<key>PayloadDescription</key>
\t<string>Profile mac dinh tu dong cai khi enroll lan dau - chinh sua truc tiep file nay (data/default.plist)</string>
\t<key>PayloadIdentifier</key>
\t<string>${DEFAULT_PROFILE_IDENTIFIER}</string>
\t<key>PayloadUUID</key>
\t<string>${PROFILE_UUID}</string>
\t<key>PayloadType</key>
\t<string>Configuration</string>
\t<key>PayloadVersion</key>
\t<integer>1</integer>
\t<key>PayloadRemovalDisallowed</key>
\t<false/>
</dict>
</plist>`;

/**
 * Đọc profile mặc định từ `defaultProfilePlistPath` (data/default.plist).
 * Nếu file chưa tồn tại, tự tạo ra với nội dung mẫu (kèm PayloadIdentifier
 * cố định như trên) rồi đọc lại - để lần chạy đầu tiên không bị lỗi thiếu file.
 *
 * PayloadUUID trong file mẫu CỐ ĐỊNH (không random mỗi lần) vì đây là 1
 * profile TĨNH - giữ UUID cố định giúp việc "update" profile (cài lại sau
 * khi sửa PayloadContent trong file) được iOS nhận diện đúng là bản cập nhật
 * của cùng 1 profile, theo PayloadIdentifier ở top-level (xem Apple: "Intro
 * to device management payloads" - profile trùng PayloadIdentifier = coi là
 * update, không phải cài mới).
 */
export function getDefaultProfileBase64(plistFilePath: string): string {
  if (!fs.existsSync(plistFilePath)) {
    const dir = path.dirname(plistFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(plistFilePath, TEMPLATE_PLIST, "utf-8");
    getLogger().info("[defaultProfile] Chưa có file default.plist - đã tự tạo từ template", {
      plistFilePath,
    });
  }
  const xml = fs.readFileSync(plistFilePath, "utf-8");
  return Buffer.from(xml, "utf-8").toString("base64");
}
