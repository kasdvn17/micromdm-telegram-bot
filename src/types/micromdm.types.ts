/** Các RequestType được MicroMDM/Apple MDM protocol hỗ trợ mà bot này dùng tới. */
export type MdmRequestType =
  | "DeviceLock"
  | "ClearPasscode"
  | "RestartDevice"
  | "ShutDownDevice"
  | "EnableLostMode"
  | "DisableLostMode"
  | "PlayLostModeSound"
  | "DeviceInformation"
  /**
   * DeviceLocation: chỉ hoạt động khi thiết bị đang ở trong Lost Mode (MDM Lost Mode bật).
   * Khi thiết bị KHÔNG ở Lost Mode, command sẽ bị thiết bị từ chối (Error/NotNow).
   * Xem thêm: Apple MDM Protocol Reference – DeviceLocation command.
   */
  | "DeviceLocation"
  | "InstallProfile"
  | "RemoveProfile"
  | "EraseDevice"
  /**
   * EnableActivationLock: bật User-Linked Activation Lock trên thiết bị Supervised.
   * Yêu cầu thiết bị đã Supervised và iOS đủ phiên bản; cần BypassCode từ SecurityInfo
   * để có thể tắt lại sau này. Không giống DeviceLock – không khoá màn hình.
   */
  | "EnableActivationLock";

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
}

/**
 * Payload webhook do MicroMDM gửi (workflow/webhook/webhook.go).
 *
 * Lưu ý quan trọng:
 * - Không có trường `udid` nào ở cấp root – UDID chỉ nằm trong sub-event
 *   (acknowledge_event.udid hoặc checkin_event.udid).
 * - raw_payload trong các sub-event là []byte được JSON-encode thành chuỗi
 *   base64, KHÔNG phải object (phải decode trước khi dùng).
 * - Các topic thực tế MicroMDM phát: mdm.Authenticate, mdm.TokenUpdate,
 *   mdm.CheckOut, mdm.Acknowledge, mdm.Connect.
 *   Không có "mdm.Enrollment" hay "mdm.CheckinEvent".
 */
export interface MicroMdmWebhookEvent {
  topic:
  | "mdm.Authenticate"
  | "mdm.TokenUpdate"
  | "mdm.CheckOut"
  | "mdm.Acknowledge"
  | "mdm.Connect";
  event_id: string;
  created_at: string;
  acknowledge_event?: {
    /** UDID của thiết bị – nằm trong sub-event, không phải root */
    udid: string;
    enrollment_id?: string;
    command_uuid: string;
    status: "Acknowledged" | "Error" | "NotNow";
    /**
     * Dữ liệu trả về từ thiết bị, JSON-encoded thành base64 ([]byte trong Go).
     * Phải decode: Buffer.from(raw_payload, "base64") → JSON.parse trước khi dùng.
     */
    raw_payload?: string;
  };
  checkin_event?: {
    /** UDID của thiết bị – nằm trong sub-event, không phải root */
    udid: string;
    enrollment_id?: string;
    /** URL params MicroMDM gắn vào webhook request */
    url_params?: Record<string, string>;
    /**
     * Dữ liệu checkin gốc (plist XML từ thiết bị), JSON-encoded thành base64.
     * Thường không cần parse trừ khi cần đọc thông tin sâu hơn.
     */
    raw_payload?: string;
  };
}
