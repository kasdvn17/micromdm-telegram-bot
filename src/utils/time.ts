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

const TIME_OF_DAY_REGEX = /^(\d{1,2}):(\d{2})$/;

/**
 * Parse + chuẩn hoá giờ dạng "6:00"/"06:00" thành "HH:mm" (luôn 2 chữ số) -
 * đúng định dạng mà FocusScheduler.tick() so sánh (`String(hours).padStart(2,"0")`).
 */
export function normalizeTimeOfDay(input: string): string {
  const match = TIME_OF_DAY_REGEX.exec(input.trim());
  if (!match) {
    throw new ValidationError(`Định dạng giờ không hợp lệ: "${input}". Ví dụ hợp lệ: "06:00", "23:00".`);
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new ValidationError(`Giờ không hợp lệ: "${input}". Giờ phải trong khoảng 00:00-23:59.`);
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Parse danh sách ngày trong tuần dạng "0,1,2,3,4,5,6" (0 = Chủ nhật).
 * Không truyền gì -> mặc định cả 7 ngày.
 */
export function parseDaysOfWeek(input?: string): number[] {
  if (!input) return [0, 1, 2, 3, 4, 5, 6];
  const days = input.split(",").map((part) => Number.parseInt(part.trim(), 10));
  if (days.some((d) => Number.isNaN(d) || d < 0 || d > 6)) {
    throw new ValidationError(
      `Danh sách ngày không hợp lệ: "${input}". Dùng số 0-6 (0=Chủ nhật...6=Thứ bảy), cách nhau bởi dấu phẩy.`
    );
  }
  return [...new Set(days)].sort((a, b) => a - b);
}
