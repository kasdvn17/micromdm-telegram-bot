import fs from "fs";
import path from "path";
import { getLogger } from "./logger";

/**
 * Đọc file JSON tại `filePath`. Nếu file chưa tồn tại hoặc parse lỗi,
 * trả về `fallback` (và tự tạo file với fallback nếu chưa tồn tại)
 * thay vì throw - các state file (schedule/history/blacklist) không nên
 * làm crash app chỉ vì chưa được khởi tạo lần đầu.
 */
export function readJsonState<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      writeJsonState(filePath, fallback);
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    if (raw.trim().length === 0) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    getLogger().error("[jsonStore] Lỗi đọc file, dùng fallback", {
      filePath,
      error: (err as Error).message,
    });
    return fallback;
  }
}

/**
 * Ghi JSON atomic: ghi ra file tạm rồi rename, tránh trường hợp process bị
 * kill giữa chừng làm hỏng file state (schedule.json/history.json...).
 */
export function writeJsonState<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Append 1 record vào một file JSON dạng mảng (dùng cho history.json).
 * Giới hạn `maxRecords` để tránh file phình vô hạn theo thời gian.
 */
export function appendJsonArray<T>(
  filePath: string,
  record: T,
  maxRecords = 5000
): void {
  const current = readJsonState<T[]>(filePath, []);
  current.push(record);
  const trimmed =
    current.length > maxRecords ? current.slice(current.length - maxRecords) : current;
  writeJsonState(filePath, trimmed);
}
