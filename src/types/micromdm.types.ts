/** Các RequestType được MicroMDM/Apple MDM protocol hỗ trợ mà bot này dùng tới. */
export type MdmRequestType =
  | "DeviceLock"
  | "ClearPasscode"
  | "RestartDevice"
  | "ShutDownDevice"
  | "EnableLostMode"
  | "DisableLostMode"
  | "PlaySound"
  | "DeviceInformation"
  | "DeviceLocation"
  | "InstallProfile"
  | "RemoveProfile"
  | "EraseDevice"
  | "InstallApplication"
  | "RemoveApplication"
  | "InstalledApplicationList"
  | "ProfileList"
  | "ActivationLockBypassCode"
  | "SecurityInfo"
  | "NetworkInformation"
  | "RefreshCellularPlans"
  | "Settings";

/**
 * 1 item trong response của command "ProfileList" - theo Apple MDM Protocol
 * Reference (đã verify qua "Inside Apple's MDM Black Box" + support.apple.com):
 * mỗi item mô tả TOÀN BỘ 1 profile đã cài (không phải 1 payload con bên trong).
 */
export interface ProfileListItem {
  identifier: string;
  displayName?: string;
  isEncrypted?: boolean;
  hasRemovalPasscode?: boolean;
  removalDisallowed?: boolean;
  /** Số payload con bên trong PayloadContent - không list chi tiết từng field để tránh tin nhắn quá dài. */
  payloadCount: number;
}

/** Payload chung gửi lên MicroMDM /v1/commands */
export interface MdmCommandPayload {
  udid: string;
  request_type: MdmRequestType;
  /** Tham số tuỳ command, vd: { Queries: ["BatteryLevel"] } cho DeviceInformation */
  [key: string]: unknown;
}

/** Kết quả trả về ngay khi queue command (chưa phải kết quả thực thi trên máy) */
export interface MdmCommandQueuedResult {
  commandUUID: string;
  requestType: MdmRequestType;
  queuedAt: string;
}

/** Kết quả cuối cùng sau khi thiết bị đã Acknowledge (nhận qua webhook) */
export interface MdmCommandResult {
  commandUUID: string;
  requestType: MdmRequestType;
  status: "Acknowledged" | "Error" | "NotNow" | "TimedOut";
  raw?: Record<string, unknown>;
}

export interface BatteryInfo {
  batteryLevel: number; // 0..1
  batteryState: "Charging" | "Unplugged" | "Full" | "Unknown";
  fetchedAt: string;
  source: "cache" | "realtime";
}

export interface LocationInfo {
  latitude: number;
  longitude: number;
  horizontalAccuracy?: number;
  fetchedAt: string;
  source: "cache" | "realtime";
}

export interface DeviceInformationResult {
  deviceName?: string;
  modelName?: string;
  osVersion?: string;
  batteryLevel?: number;
  batteryState?: string;
  isSupervised?: boolean;
  fetchedAt: string;
  source: "cache" | "realtime";
  /** Toàn bộ QueryResponses gốc từ thiết bị - chứa mọi field đã query,
   *  không chỉ các field tiện convenience ở trên. */
  raw: Record<string, unknown>;
}

/** Payload webhook do MicroMDM gửi thật (đã verify qua docs/user-guide/api-and-webhooks.md
 *  của micromdm/micromdm - CHỈ có 4 topic này, không có "mdm.Enrollment" riêng). */
export interface MicroMdmCheckinEvent {
  udid: string;
  url_params: Record<string, string> | null;
  /** base64-encoded RAW plist XML - phải decode + parse plist, KHÔNG phải JSON */
  raw_payload: string;
}

export interface MicroMdmAcknowledgeEvent {
  udid: string;
  status: "Acknowledged" | "Error" | "NotNow";
  command_uuid: string;
  url_params: Record<string, string> | null;
  /** base64-encoded RAW plist XML - phải decode + parse plist, KHÔNG phải JSON */
  raw_payload: string;
}

export interface MicroMdmWebhookEvent {
  topic: "mdm.Authenticate" | "mdm.TokenUpdate" | "mdm.CheckOut" | "mdm.Connect";
  event_id: string;
  created_at: string;
  checkin_event?: MicroMdmCheckinEvent;
  acknowledge_event?: MicroMdmAcknowledgeEvent;
}
