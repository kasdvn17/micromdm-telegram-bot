import { randomUUID } from "crypto";

export interface MobileConfigOptions {
  identifier: string;
  displayName: string;
  restrictedBundleIds: string[];
}

/**
 * Build một Configuration Profile (.mobileconfig, dạng plist XML) chứa
 * payload `com.apple.applicationaccess` với `blacklistedAppBundleIDs` -
 * dùng chung cho cả Focus Mode và Blacklist app (khác nhau ở `identifier`
 * và danh sách bundle ID truyền vào).
 *
 * Trả về chuỗi base64 sẵn sàng gửi trong field "Payload" của InstallProfile.
 */
export function buildRestrictedAppsProfile(options: MobileConfigOptions): string {
  const payloadUUID = randomUUID();
  const contentUUID = randomUUID();

  const bundleIdsXml = options.restrictedBundleIds
    .map((id) => `\t\t\t\t<string>${escapeXml(id)}</string>`)
    .join("\n");

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PayloadContent</key>
\t<array>
\t\t<dict>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.applicationaccess</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>${escapeXml(options.identifier)}.restrictions</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${contentUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>blacklistedAppBundleIDs</key>
\t\t\t<array>
${bundleIdsXml}
\t\t\t</array>
\t\t</dict>
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
