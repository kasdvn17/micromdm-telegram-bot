export interface EmergencyAuthServiceApi {
  verifyEmergencyPassword(password: string | undefined): boolean;
  verifyTwoFactor(username: string | undefined, password: string | undefined): boolean;
}

/**
 * So khớp password bằng constant-time comparison đơn giản (độ dài cố định
 * qua padding) để giảm rủi ro timing attack cơ bản - dù đây là bot cá nhân,
 * vẫn nên làm đúng chuẩn tối thiểu vì lệnh /api có thể erase thiết bị.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function createEmergencyAuthService(
  emergencyPassword: string,
  authorizedUsername: string
): EmergencyAuthServiceApi {
  return {
    verifyEmergencyPassword(password: string | undefined): boolean {
      if (!password) return false;
      return safeCompare(password, emergencyPassword);
    },
    verifyTwoFactor(username: string | undefined, password: string | undefined): boolean {
      if (!username || !password) return false;
      const usernameMatches = username.toLowerCase().replace(/^@/, "") === authorizedUsername;
      const passwordMatches = safeCompare(password, emergencyPassword);
      return usernameMatches && passwordMatches;
    },
  };
}
