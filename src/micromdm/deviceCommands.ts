import { randomUUID } from "crypto";
import { MicroMdmClient } from "./client";
import {
  BatteryInfo,
  DeviceInformationResult,
  LocationInfo,
  MdmCommandQueuedResult,
  MdmCommandResult,
} from "../types/micromdm.types";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * High-level API tương đương chức năng của `tools/api` trong MicroMDM,
 * viết lại bằng TypeScript. Đây là tầng DUY NHẤT mà `services/` được phép
 * gọi để tương tác với thiết bị - không service nào được gọi thẳng `MicroMdmClient`.
 */
export class DeviceCommands {
  constructor(private readonly client: MicroMdmClient, private readonly deviceUUID: string) {}

  lock(pin?: string): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "DeviceLock",
      ...(pin ? { PIN: pin } : {}),
    });
  }

  unlock(): Promise<MdmCommandQueuedResult> {
    // ClearPasscode: MicroMDM RequestType tương ứng để gỡ passcode (unlock)
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "ClearPasscode",
    });
  }

  restart(): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "RestartDevice",
    });
  }

  shutdown(): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "ShutDownDevice",
    });
  }

  enableLostMode(phone: string, message?: string): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "EnableLostMode",
      phone_number: phone,
      ...(message ? { Message: message } : {}),
    });
  }

  disableLostMode(): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "DisableLostMode",
    });
  }

  playSound(): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "PlaySound",
    });
  }

  async getBattery(): Promise<BatteryInfo> {
    const result: MdmCommandResult = await this.client.sendCommandAndWait({
      udid: this.deviceUUID,
      request_type: "DeviceInformation",
      queries: ["BatteryLevel", "BatteryState"],
    });
    // Response thật của Apple bọc kết quả trong "QueryResponses"
    const raw = (result.raw?.["QueryResponses"] as Record<string, unknown>) ?? result.raw ?? {};
    return {
      batteryLevel: Number(raw["BatteryLevel"] ?? 0),
      batteryState: (raw["BatteryState"] as BatteryInfo["batteryState"]) ?? "Unknown",
      fetchedAt: new Date().toISOString(),
      source: "realtime",
    };
  }

  /**
   * ⚠️ Theo Apple's official MDM command list (support.apple.com/guide/mdm):
   * "Get device location" chỉ khả dụng khi thiết bị đang ở Managed Lost Mode.
   * Nghĩa là gọi lệnh này khi KHÔNG bật EnableLostMode trước đó sẽ trả lỗi
   * hoặc không có dữ liệu - đây là giới hạn của chính Apple MDM protocol,
   * không phải giới hạn của MicroMDM hay bot. /mark lost và /location vì vậy
   * KHÔNG thể lấy toạ độ GPS thật nếu không bật Lost Mode thật trước.
   */
  async getLocation(): Promise<LocationInfo> {
    const result: MdmCommandResult = await this.client.sendCommandAndWait({
      udid: this.deviceUUID,
      request_type: "DeviceLocation",
    });
    const raw = result.raw ?? {};
    return {
      latitude: Number(raw["Latitude"] ?? 0),
      longitude: Number(raw["Longitude"] ?? 0),
      horizontalAccuracy: raw["HorizontalAccuracy"] as number | undefined,
      fetchedAt: new Date().toISOString(),
      source: "realtime",
    };
  }

  /**
   * Query TOÀN BỘ field khả dụng cho iOS/iPadOS theo bảng chính thức:
   * support.apple.com/guide/deployment/device-information-queries-depa9e8e14a4
   * (đã lọc bỏ các query chỉ dành cho macOS/tvOS/Shared iPad không áp dụng
   * cho 1 iPhone cá nhân). Trả về NGUYÊN object QueryResponses đầy đủ, không
   * chỉ cherry-pick vài field như bản trước.
   *
   * ⚠️ Vài query trong danh sách cần điều kiện riêng mới có giá trị:
   * - "MDMLostModeLocation"/vị trí: chỉ có khi đang ở Managed Lost Mode.
   * - "AutoSetupAdminAccounts": chỉ áp dụng macOS + ABM, sẽ rỗng trên iPhone này.
   */
  async getDeviceInfo(): Promise<DeviceInformationResult> {
    const result: MdmCommandResult = await this.client.sendCommandAndWait({
      udid: this.deviceUUID,
      request_type: "DeviceInformation",
      queries: [
        // Định danh & phần cứng
        "UDID",
        "DeviceName",
        "Model",
        "ModelName",
        "ModelNumber",
        "ProductName",
        "SerialNumber",
        // Dung lượng
        "DeviceCapacity",
        "AvailableDeviceCapacity",
        // Pin
        "BatteryLevel",
        "BatteryState",
        // Hệ điều hành (nhóm "Operating system queries" nhưng vẫn cùng command)
        "OSVersion",
        "BuildVersion",
        "ModemFirmwareVersion",
        // Quản lý / bảo mật
        "IsSupervised",
        "IsActivationLockEnabled",
        "IsDeviceLocatorServiceEnabled", // Find My bật hay không
        "IsMDMLostModeEnabled",
        "IsDoNotDisturbInEffect",
        "IsCloudBackupEnabled",
        "LastCloudBackupDate",
        "IsAppAnalyticsEnabled",
        "IsDiagnosticSubmissionEnabled",
        // Mạng di động
        "CellularTechnology",
        "EASDeviceIdentifier",
        "EID",
        "ESIMIdentifier",
        // Khác
        "TimeZone",
        "ITunesStoreAccountIsActive",
      ],
    });
    const raw = (result.raw?.["QueryResponses"] as Record<string, unknown>) ?? result.raw ?? {};
    return {
      deviceName: raw["DeviceName"] as string | undefined,
      modelName: raw["Model"] as string | undefined,
      osVersion: raw["OSVersion"] as string | undefined,
      batteryLevel: raw["BatteryLevel"] as number | undefined,
      batteryState: raw["BatteryState"] as string | undefined,
      isSupervised: raw["IsSupervised"] as boolean | undefined,
      fetchedAt: new Date().toISOString(),
      source: "realtime",
      raw,
    };
  }

  installProfile(mobileConfigBase64: string): Promise<MdmCommandQueuedResult> {
    return this.client.installProfile(this.deviceUUID, mobileConfigBase64);
  }

  removeProfile(profileIdentifier: string): Promise<MdmCommandQueuedResult> {
    return this.client.removeProfile(this.deviceUUID, profileIdentifier);
  }

  /**
   * EraseDevice - CHỈ được gọi qua commandRegistry với whitelist two-factor
   * của lệnh /api + xác nhận CONFIRM. Không expose ở bất kỳ command tier nào khác.
   */
  eraseDevice(pin?: string): Promise<MdmCommandQueuedResult> {
    return this.client.queueCommand({
      udid: this.deviceUUID,
      request_type: "EraseDevice",
      ...(pin ? { PIN: pin } : {}),
    });
  }

  /**
   * Cài app dưới dạng "managed app" qua ManifestURL (chỉ áp dụng cho app
   * enterprise/in-house tự ký .ipa, KHÔNG áp dụng cho app App Store công khai
   * như TikTok/Facebook/Instagram nếu không có VPP - xem cảnh báo ở services/).
   * Dùng raw plist (đã verify từ ví dụ request thật trên developer.apple.com
   * forums) vì cấu trúc JSON của InstallApplication trong MicroMDM chưa
   * verify chắc chắn.
   */
  installApplication(manifestURL: string, managed = true): Promise<MdmCommandQueuedResult> {
    const commandUUID = randomUUID();
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Command</key>
\t<dict>
\t\t<key>RequestType</key>
\t\t<string>InstallApplication</string>
\t\t<key>ManifestURL</key>
\t\t<string>${escapeXml(manifestURL)}</string>
\t\t<key>ManagementFlags</key>
\t\t<integer>${managed ? 1 : 0}</integer>
\t</dict>
\t<key>CommandUUID</key>
\t<string>${commandUUID}</string>
</dict>
</plist>`;
    return this.client.sendRawCommand(this.deviceUUID, "InstallApplication", plistXml);
  }

  /**
   * Cài app từ App Store qua iTunesStoreID. ⚠️ KHÔNG có VPP (project này
   * không dùng ABM) → theo nhiều báo cáo thực tế, app sẽ cài dạng UNMANAGED
   * hoặc kẹt "Installing"/báo lỗi "This Apple ID cannot be used to make
   * purchases" trên máy. Giữ lại để thử nghiệm nhưng không đảm bảo managed.
   */
  installApplicationFromAppStore(iTunesStoreID: number): Promise<MdmCommandQueuedResult> {
    const commandUUID = randomUUID();
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Command</key>
\t<dict>
\t\t<key>RequestType</key>
\t\t<string>InstallApplication</string>
\t\t<key>iTunesStoreID</key>
\t\t<integer>${iTunesStoreID}</integer>
\t\t<key>ManagementFlags</key>
\t\t<integer>1</integer>
\t\t<key>InstallAsManaged</key>
\t\t<true/>
\t\t<key>ChangeManagementState</key>
\t\t<string>Managed</string>
\t</dict>
\t<key>CommandUUID</key>
\t<string>${commandUUID}</string>
</dict>
</plist>`;
    return this.client.sendRawCommand(this.deviceUUID, "InstallApplication", plistXml);
  }

  /**
   * Liệt kê app đã cài. `managedOnly=false` trả về CẢ app thường lẫn managed
   * (đúng yêu cầu "list all apps cả normal app và managed app").
   * Kết quả trả về qua webhook mdm.Connect như mọi command khác - hàm này
   * chờ và trả list đã parse.
   */
  async listInstalledApps(managedOnly = false): Promise<
    Array<{ identifier: string; name?: string; version?: string; managed?: boolean }>
  > {
    const commandUUID = randomUUID();
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Command</key>
\t<dict>
\t\t<key>RequestType</key>
\t\t<string>InstalledApplicationList</string>
\t\t<key>ManagedAppsOnly</key>
\t\t<${managedOnly ? "true" : "false"}/>
\t</dict>
\t<key>CommandUUID</key>
\t<string>${commandUUID}</string>
</dict>
</plist>`;

    const result = await this.client.sendRawCommandAndWait(
      this.deviceUUID,
      commandUUID,
      plistXml
    );
    const list = (result.raw?.["InstalledApplicationList"] as Array<Record<string, unknown>>) ?? [];
    return list.map((item) => ({
      identifier: String(item["Identifier"] ?? ""),
      name: item["Name"] as string | undefined,
      version: item["ShortVersion"] as string | undefined,
      managed: item["ManagementFlags"] !== undefined,
    }));
  }

  /**
   * Gỡ app - CHỈ hoạt động với app đang được MDM quản lý (managed). App gỡ
   * bằng lệnh này sẽ mất luôn dữ liệu cục bộ, theo đúng semantics Apple.
   */
  removeApplication(bundleId: string): Promise<MdmCommandQueuedResult> {
    const commandUUID = randomUUID();
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Command</key>
\t<dict>
\t\t<key>RequestType</key>
\t\t<string>RemoveApplication</string>
\t\t<key>Identifier</key>
\t\t<string>${escapeXml(bundleId)}</string>
\t</dict>
\t<key>CommandUUID</key>
\t<string>${commandUUID}</string>
</dict>
</plist>`;
    return this.client.sendRawCommand(this.deviceUUID, "RemoveApplication", plistXml);
  }

  /**
   * User-Linked Activation Lock (không phải Enable Activation Lock kiểu ABM -
   * cái đó CẦN enroll qua Apple Business/School Manager, mà project này không dùng).
   * Đây là "Allow Activation Lock" - cho phép activation lock kích hoạt khi user
   * tự bật Find My trên thiết bị supervised, dùng field `ActivationLockAllowedWhileSupervised`
   * trong payload MDMOptions của command "Settings".
   *
   * Dùng RAW plist command (không qua JSON schema đoán mò) vì cách JSON hoá
   * command "Settings" trong MicroMDM chưa được verify chắc chắn - plist XML dưới
   * đây đã verify khớp với ví dụ thật từ github.com/micromdm/micromdm/issues/996.
   */
  enableActivationLock(): Promise<MdmCommandQueuedResult> {
    const commandUUID = randomUUID();
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Command</key>
\t<dict>
\t\t<key>RequestType</key>
\t\t<string>Settings</string>
\t\t<key>Settings</key>
\t\t<array>
\t\t\t<dict>
\t\t\t\t<key>Item</key>
\t\t\t\t<string>MDMOptions</string>
\t\t\t\t<key>MDMOptions</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>ActivationLockAllowedWhileSupervised</key>
\t\t\t\t\t<true/>
\t\t\t\t</dict>
\t\t\t</dict>
\t\t</array>
\t</dict>
\t<key>CommandUUID</key>
\t<string>${commandUUID}</string>
</dict>
</plist>`;
    return this.client.sendRawCommand(this.deviceUUID, "Settings", plistXml);
  }
}
