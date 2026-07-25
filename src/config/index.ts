import { loadSecrets, Secrets } from "./secrets";
import { loadConstants, AppConstants } from "./constants";

export interface AppConfig {
  secrets: Secrets;
  constants: AppConstants;
}

/**
 * Điểm load config DUY NHẤT của toàn bộ ứng dụng.
 * Gọi 1 lần tại `main.ts` khi khởi động; mọi module khác nhận `AppConfig`
 * qua tham số hàm/constructor (dependency injection thủ công), KHÔNG tự
 * import và gọi lại `loadConfig()` ở nơi khác để tránh đọc process.env rải rác.
 *
 * Fail-fast: nếu thiếu biến môi trường bắt buộc, ứng dụng sẽ throw và
 * dừng ngay tại đây, không khởi động bot ở trạng thái cấu hình thiếu sót.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const secrets = loadSecrets(env);
  const constants = loadConstants(env);
  return { secrets, constants };
}

export type { Secrets, AppConstants };
