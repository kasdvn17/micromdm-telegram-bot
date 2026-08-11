import { randomUUID } from "crypto";

export interface MobileConfigOptions {
  identifier: string;
  displayName: string;
  restrictedBundleIds: string[];
  /**
   * Danh sách URL bị chặn (Web Content Filter). Optional - nếu rỗng/không
   * truyền, profile chỉ chứa payload chặn app như trước (không thêm payload
   * web filter thừa).
   */
  blockedWebsites?: string[];
}

/**
 * Build một Configuration Profile (.mobileconfig, dạng plist XML).
 * Luôn chứa payload `com.apple.applicationaccess` (blacklistedAppBundleIDs).
 * Nếu có `blockedWebsites`, THÊM payload `com.apple.webcontent-filter`
 * (BlacklistedURLs) vào CÙNG profile - dùng chung cho Focus Mode, Blacklist,
 * Safe Mode (khác nhau ở `identifier` + danh sách truyền vào).
 *
 * com.apple.webcontent-filter: chỉ hoạt động trên thiết bị Supervised (đã
 * verify qua profiledocs/Apple support - phù hợp với setup của project này).
 * FilterType=BuiltIn + AutoFilterEnabled=false + BlacklistedURLs = chặn đúng
 * URL trong danh sách mà KHÔNG bật thêm bộ lọc nội dung người lớn tự động
 * (tránh chặn nhầm site khác ngoài ý muốn).
 *
 * Gửi CẢ 2 key `BlacklistedURLs` (tên legacy, đa số bản iOS/tài liệu cộng
 * đồng dùng tên này) VÀ `DenylistURLs` (tên mới hơn xuất hiện trong tài liệu
 * Apple Developer gần đây - developer.apple.com/documentation/devicemanagement/webcontentfilter)
 * - cùng trỏ vào 1 danh sách URL, để tối đa tương thích across iOS versions
 * mà không cần biết chính xác bản iOS trên máy dùng tên key nào. iOS không
 * lỗi khi gặp key thừa không nhận diện được, nên gửi cả 2 là an toàn.
 *
 * Trả về chuỗi base64 sẵn sàng gửi trong field "payload" của InstallProfile.
 */
export function buildRestrictedAppsProfile(options: MobileConfigOptions): string {
  const payloadUUID = randomUUID();
  const appContentUUID = randomUUID();

  const bundleIdsXml = options.restrictedBundleIds
    .map((id) => `\t\t\t\t<string>${escapeXml(id)}</string>`)
    .join("\n");

  const appPayload = `\t\t<dict>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.applicationaccess</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>${escapeXml(options.identifier)}.restrictions</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${appContentUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>blacklistedAppBundleIDs</key>
\t\t\t<array>
${bundleIdsXml}
\t\t\t</array>
\t\t</dict>`;

  const websites = options.blockedWebsites ?? [];
  let webPayload = "";
  if (websites.length > 0) {
    const webContentUUID = randomUUID();
    const urlsXml = websites.map((url) => `\t\t\t\t<string>${escapeXml(url)}</string>`).join("\n");
    webPayload = `
\t\t<dict>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.webcontent-filter</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>${escapeXml(options.identifier)}.webfilter</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${webContentUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>PayloadDisplayName</key>
\t\t\t<string>${escapeXml(options.displayName)} - Web Filter</string>
\t\t\t<key>FilterType</key>
\t\t\t<string>BuiltIn</string>
\t\t\t<key>AutoFilterEnabled</key>
\t\t\t<false/>
\t\t\t<key>FilterBrowsers</key>
\t\t\t<true/>
\t\t\t<key>FilterSockets</key>
\t\t\t<true/>
\t\t\t<key>BlacklistedURLs</key>
\t\t\t<array>
${urlsXml}
\t\t\t</array>
\t\t\t<key>DenylistURLs</key>
\t\t\t<array>
${urlsXml}
\t\t\t</array>
\t\t</dict>`;
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PayloadContent</key>
\t<array>
${appPayload}${webPayload}
\t</array>
\t<key>PayloadDisplayName</key>
\t<string>${escapeXml(options.displayName)}</string>
\t<key>PayloadIdentifier</key>
\t<string>${escapeXml(options.identifier)}</string>
\t<key>PayloadUUID</key>
\t<string>${payloadUUID}</string>
\t<key>PayloadType</key>
\t<string>Configuration</string>
\t<key>PayloadVersion</key>
\t<integer>1</integer>
\t<key>PayloadRemovalDisallowed</key>
\t<false/>
</dict>
</plist>`;

  return Buffer.from(plist, "utf-8").toString("base64");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const FOCUS_PROFILE_IDENTIFIER = "com.personal.micromdmbot.focus";
export const BLACKLIST_PROFILE_IDENTIFIER = "com.personal.micromdmbot.blacklist";
/** Riêng cho Safe Mode - độc lập hoàn toàn với Focus (profile + danh sách app khác nhau) */
export const SAFE_PROFILE_IDENTIFIER = "com.personal.micromdmbot.safe";

/**
 * 3 profile identifier do BOT quản lý - dùng để chặn /removeprofile xoá nhầm
 * (xem commands/emergency/profile.command.ts).
 */
export const BOT_MANAGED_PROFILE_IDENTIFIERS: readonly string[] = [
  FOCUS_PROFILE_IDENTIFIER,
  BLACKLIST_PROFILE_IDENTIFIER,
  SAFE_PROFILE_IDENTIFIER,
];
