import path from "path";

/**
 * Hằng số & cấu hình không nhạy cảm (khác secrets.ts).
 * Toàn bộ đều có thể override qua biến môi trường; nếu không set,
 * dùng default trong file này.
 */
export interface AppConstants {
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

  /**
   * URL path MicroMDM sẽ POST vào (ví dụ: "/webhook/micromdm").
   * Phải khớp với giá trị được set trong --webhook-url của MicroMDM server.
   */
  webhookPath: string;
}

const DEFAULT_DEVICE_INFO_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 phút
const DEFAULT_MARK_LOST_POLL_INTERVAL_MS = 90 * 1000; // 90 giây, < 2 phút theo yêu cầu
const MARK_LOST_MAX_INTERVAL_MS = 2 * 60 * 1000; // 2 phút - ngưỡng cứng, không được vượt

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

  if (markLostPollIntervalMs >= MARK_LOST_MAX_INTERVAL_MS) {
    throw new Error(
      `[config/constants] MARK_LOST_POLL_INTERVAL_MS phải nhỏ hơn ${MARK_LOST_MAX_INTERVAL_MS}ms (2 phút), ` +
      `hiện tại đang cấu hình ${markLostPollIntervalMs}ms.`
    );
  }

  return {
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
    webhookPort: parseIntEnv(env.WEBHOOK_PORT, 6364),
    webhookPath: env.WEBHOOK_PATH?.trim() || "/webhook/micromdm",
    commandResultTimeoutMs: parseIntEnv(env.COMMAND_RESULT_TIMEOUT_MS, 30_000),
  };
}
