import { createHash, timingSafeEqual } from "node:crypto";

export interface EmergencyAuthServiceApi {
  verifyEmergencyPassword(password: string | undefined): boolean;
  verifyTwoFactor(username: string | undefined, telegramId: number, password: string | undefined): boolean;
}

/**
 * So khớp password bằng constant-time comparison đơn giản (độ dài cố định
 * qua padding) để giảm rủi ro timing attack cơ bản - dù đây là bot cá nhân,
 * vẫn nên làm đúng chuẩn tối thiểu vì lệnh /api có thể erase thiết bị.
 */
function safeCompare(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function createEmergencyAuthService(
  emergencyPassword: string,
  authorizedUsername: string,
  authorizedTelegramUserId?: number
): EmergencyAuthServiceApi {
  return {
    verifyEmergencyPassword(password: string | undefined): boolean {
      if (!password) return false;
      return safeCompare(password, emergencyPassword);
    },
    verifyTwoFactor(username: string | undefined, telegramId: number, password: string | undefined): boolean {
      if (!password) return false;
      const identityMatches = authorizedTelegramUserId !== undefined
        ? telegramId === authorizedTelegramUserId
        : !!username && username.toLowerCase().replace(/^@/, "") === authorizedUsername;
      const passwordMatches = safeCompare(password, emergencyPassword);
      return identityMatches && passwordMatches;
    },
  };
}
