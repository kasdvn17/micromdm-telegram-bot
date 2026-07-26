import { createHash } from "crypto";

/** Hash ổn định (sha256 hex) của 1 giá trị bất kỳ - dùng để so sánh 2 payload
 *  đã decode có giống hệt nhau hay không mà không cần lưu nguyên payload. */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
