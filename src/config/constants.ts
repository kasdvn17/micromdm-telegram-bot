import path from "path";

/**
 * Hằng số & cấu hình không nhạy cảm (khác secrets.ts).
 * Toàn bộ đều có thể override qua biến môi trường; nếu không set,
 * dùng default trong file này.
 */
export interface AppConstants {
  /** Thư mục data/ gốc - dùng để resolve file bất kỳ do người dùng chỉ định
   *  (vd /installprofile <filename> tìm trong đây), tránh mỗi chỗ tự path.resolve riêng. */
  dataDir: string;

  /** UDID của chiếc iPhone duy nhất mà bot điều khiển */
  deviceUUID: string;

  /** Chu kỳ poll battery/location/deviceinfo để cache (ms) */
  deviceInfoPollIntervalMs: number;

  /**
   * Chu kỳ poll location + heartbeat khi /mark lost đang bật (ms).
   * Yêu cầu: phải nhỏ hơn 2 phút (120_000ms).
   */
  markLostPollIntervalMs: number;

  /** Thư mục chứa log file (rotate theo ngày) */
  logDir: string;

  /** Đường dẫn file lưu event history */
  historyFilePath: string;

  /** Đường dẫn file lưu focus schedule (duration-based + recurring) */
  scheduleFilePath: string;

  /** Đường dẫn file lưu danh sách blacklist app */
  blacklistFilePath: string;

  /** Đường dẫn file JSON chứa Bundle ID cho Focus Mode (RestrictedApplications) */
  restrictedAppsFilePath: string;

  /** Đường dẫn file JSON chứa Bundle ID riêng cho Safe Mode (data/sensitive_apps.json),
   *  độc lập với danh sách của Focus Mode - dùng khi cho người khác mượn máy. */
  sensitiveAppsFilePath: string;

  /** Đường dẫn file JSON chứa danh sách website bị chặn cho Focus Mode (data/focus-websites.json) */
  focusWebsitesFilePath: string;

  /** Đường dẫn file JSON chứa danh sách website bị chặn cho Blacklist (data/blacklist-websites.json) */
  blacklistWebsitesFilePath: string;

  /**
   * Đường dẫn file .plist (mobileconfig XML) chứa profile MẶC ĐỊNH tự động
   * cài khi phát hiện enrollment mới. Lưu ra file thay vì hardcode trong code
   * để chỉnh sửa nội dung profile không cần đụng vào source/rebuild.
   */
  defaultProfilePlistPath: string;

  /** Đường dẫn file lưu hash raw_payload check-in gần nhất theo UDID (lọc heartbeat) */
  checkinStateFilePath: string;

  /**
   * Port HTTP server nội bộ lắng nghe webhook từ MicroMDM (--webhook-url trỏ vào đây).
   * MicroMDM gửi mọi sự kiện (Enrollment, CheckIn, Acknowledge/CommandResult, CheckOut)
   * qua webhook này thay vì trả về đồng bộ trong response HTTP ban đầu.
   */
  webhookPort: number;

  /**
   * Timeout (ms) khi chờ kết quả một command cần phản hồi đồng bộ-giả
   * (vd: DeviceInformation, DeviceLocation) thông qua webhook Acknowledge.
   * Nếu quá thời gian này mà chưa nhận được Acknowledge, coi như command đã queued
   * nhưng chưa xác nhận (device có thể đang offline).
   */
  commandResultTimeoutMs: number;

  /** Đường dẫn state JSON của báo thức */
  alarmStateFilePath: string;

  /** Múi giờ dùng cho báo thức */
  alarmTimeZone: string;
}

const DEFAULT_DEVICE_INFO_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 tiếng
const DEFAULT_MARK_LOST_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 phút

const DATA_DIR = path.resolve(process.cwd(), "data");

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConstants(env: NodeJS.ProcessEnv = process.env): AppConstants {
  const deviceUUID = env.DEVICE_UUID?.trim();
  if (!deviceUUID) {
    throw new Error(
      "[config/constants] Thiếu biến môi trường bắt buộc: DEVICE_UUID."
    );
  }

  const markLostPollIntervalMs = parseIntEnv(
    env.MARK_LOST_POLL_INTERVAL_MS,
    DEFAULT_MARK_LOST_POLL_INTERVAL_MS
  );

  return {
    dataDir: DATA_DIR,
    deviceUUID,
    deviceInfoPollIntervalMs: parseIntEnv(
      env.DEVICE_INFO_POLL_INTERVAL_MS,
      DEFAULT_DEVICE_INFO_POLL_INTERVAL_MS
    ),
    markLostPollIntervalMs,
    logDir: env.LOG_DIR?.trim() || path.join(DATA_DIR, "logs"),
    historyFilePath:
      env.HISTORY_FILE_PATH?.trim() || path.join(DATA_DIR, "history.json"),
    scheduleFilePath:
      env.SCHEDULE_FILE_PATH?.trim() || path.join(DATA_DIR, "schedule.json"),
    blacklistFilePath:
      env.BLACKLIST_FILE_PATH?.trim() || path.join(DATA_DIR, "blacklist.json"),
    restrictedAppsFilePath:
      env.RESTRICTED_APPS_FILE_PATH?.trim() ||
      path.join(DATA_DIR, "restricted-apps.json"),
    sensitiveAppsFilePath:
      env.SENSITIVE_APPS_FILE_PATH?.trim() || path.join(DATA_DIR, "sensitive_apps.json"),
    focusWebsitesFilePath:
      env.FOCUS_WEBSITES_FILE_PATH?.trim() || path.join(DATA_DIR, "focus-websites.json"),
    blacklistWebsitesFilePath:
      env.BLACKLIST_WEBSITES_FILE_PATH?.trim() || path.join(DATA_DIR, "blacklist-websites.json"),
    defaultProfilePlistPath:
      env.DEFAULT_PROFILE_PLIST_PATH?.trim() || path.join(DATA_DIR, "default.plist"),
    checkinStateFilePath:
      env.CHECKIN_STATE_FILE_PATH?.trim() || path.join(DATA_DIR, "checkin-state.json"),
    webhookPort: parseIntEnv(env.WEBHOOK_PORT, 6364),
    commandResultTimeoutMs: parseIntEnv(env.COMMAND_RESULT_TIMEOUT_MS, 30_000),
    alarmStateFilePath:
      env.ALARM_STATE_FILE_PATH?.trim() || path.join(DATA_DIR, "alarm-state.json"),
    alarmTimeZone: env.ALARM_TIMEZONE?.trim() || "Asia/Ho_Chi_Minh",
  };
}
