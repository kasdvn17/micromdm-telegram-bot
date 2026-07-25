/**
 * Toàn bộ secret của ứng dụng.
 *
 * Nguyên tắc: đây là NƠI DUY NHẤT đọc `process.env` cho các giá trị nhạy cảm.
 * Mọi module khác phải import object `Secrets` đã được load & validate từ
 * `config/index.ts`, không được tự ý đọc process.env ở nơi khác.
 */
export interface Secrets {
  /** Token của bot, lấy từ BotFather */
  telegramBotToken: string;

  /**
   * Username Telegram duy nhất được phép chạy Normal commands.
   * Lưu KHÔNG kèm dấu "@", so khớp không phân biệt hoa/thường.
   */
  authorizedTelegramUsername: string;

  /**
   * Mật khẩu dùng cho:
   *  - Toàn bộ Emergency commands (chỉ cần đúng mật khẩu, không cần đúng username)
   *  - Một trong hai lớp xác thực của lệnh /api (two-factor: username + password)
   *
   * Theo yêu cầu của chủ dự án: lưu plaintext trong biến môi trường (secret cá nhân,
   * chấp nhận đánh đổi để đơn giản hoá). KHÔNG log giá trị này ra bất kỳ đâu.
   */
  emergencyPassword: string;

  /** Base URL của MicroMDM server đang chạy sẵn, không có dấu "/" ở cuối */
  microMdmUrl: string;

  /** API key (Basic Auth password, username mặc định là "micromdm") của MicroMDM */
  microMdmApiKey: string;
}

/**
 * Tên các biến môi trường bắt buộc phải có giá trị non-empty.
 * Dùng để validate tập trung tại `loadSecrets()`.
 */
const REQUIRED_ENV_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "AUTHORIZED_TELEGRAM_USERNAME",
  "EMERGENCY_PASSWORD",
  "MICROMDM_URL",
  "MICROMDM_API_KEY",
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

/**
 * Đọc và validate secrets từ process.env.
 * Ném lỗi (fail-fast) ngay khi boot nếu thiếu bất kỳ biến bắt buộc nào,
 * thay vì để lỗi xuất hiện âm thầm lúc runtime khi gọi Telegram/MicroMDM.
 */
export function loadSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  const missing: RequiredEnvKey[] = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const value = env[key];
    if (value === undefined || value.trim().length === 0) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[config/secrets] Thiếu biến môi trường bắt buộc: ${missing.join(", ")}. ` +
        `Kiểm tra lại file .env (tham khảo .env.example).`
    );
  }

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN!.trim(),
    // chuẩn hoá: bỏ "@" nếu người dùng lỡ điền kèm, lowercase để so khớp không phân biệt hoa/thường
    authorizedTelegramUsername: env.AUTHORIZED_TELEGRAM_USERNAME!.trim()
      .replace(/^@/, "")
      .toLowerCase(),
    emergencyPassword: env.EMERGENCY_PASSWORD!,
    microMdmUrl: env.MICROMDM_URL!.trim().replace(/\/+$/, ""),
    microMdmApiKey: env.MICROMDM_API_KEY!.trim(),
  };
}
