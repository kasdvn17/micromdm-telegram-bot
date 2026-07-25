import { ValidationError } from "./errors";

const DURATION_REGEX = /^(\d+)(m|h)$/i;

/**
 * Parse chuỗi duration kiểu "90m" / "2h" thành milliseconds.
 * Chỉ hỗ trợ phút (m) và giờ (h) - đúng theo ví dụ trong yêu cầu gốc.
 */
export function parseDurationToMs(input: string): number {
  const match = DURATION_REGEX.exec(input.trim());
  if (!match) {
    throw new ValidationError(
      `Định dạng thời lượng không hợp lệ: "${input}". Ví dụ hợp lệ: "90m", "2h".`
    );
  }
  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = unit === "h" ? value * 60 * 60 * 1000 : value * 60 * 1000;
  if (ms <= 0) {
    throw new ValidationError(`Thời lượng phải lớn hơn 0: "${input}".`);
  }
  return ms;
}

/** Format milliseconds thành chuỗi dễ đọc, vd "1h 30m" hoặc "45m" */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
