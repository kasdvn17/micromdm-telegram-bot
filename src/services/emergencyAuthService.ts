import { timingSafeEqual } from "crypto";

export interface EmergencyAuthServiceApi {
  verifyEmergencyPassword(password: string | undefined): boolean;
  verifyTwoFactor(username: string | undefined, password: string | undefined): boolean;
}

/**
 * So khớp password bằng constant-time comparison dùng `crypto.timingSafeEqual`.
 *
 * Bug #5 fix: Phiên bản cũ dùng vòng lặp XOR nhưng vẫn có early-exit khi độ dài
 * khác nhau (`if (a.length !== b.length) return false`) — điều này cho phép attacker
 * đo thời gian phản hồi để biết độ dài mật khẩu đúng (timing attack).
 *
 * `crypto.timingSafeEqual` so sánh hai Buffer cùng độ dài trong thời gian hằng số.
 * Để xử lý trường hợp độ dài khác nhau mà vẫn không thoát sớm, ta pad cả hai
 * chuỗi về cùng độ dài trước khi compare — kết quả vẫn false nhưng timing đồng đều.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  const maxLen = Math.max(bufA.length, bufB.length);
  // Pad về cùng kích thước để timingSafeEqual không ném lỗi
  const paddedA = Buffer.concat([bufA, Buffer.alloc(maxLen - bufA.length)]);
  const paddedB = Buffer.concat([bufB, Buffer.alloc(maxLen - bufB.length)]);
  // timingSafeEqual luôn chạy hết toàn bộ so sánh, không thoát sớm
  const equal = timingSafeEqual(paddedA, paddedB);
  // Phải check lại độ dài gốc — nếu khác nhau, kết quả phải là false
  // (padding làm cho 2 buffer bằng nhau khi cả 2 chuỗi rỗng ở vùng padded)
  return equal && bufA.length === bufB.length;
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

