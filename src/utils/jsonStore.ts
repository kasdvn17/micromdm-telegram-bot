import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { getLogger } from "./logger";

let database: DatabaseSync | null = null;

function useSqlite(): boolean {
  return (process.env.STATE_STORAGE ?? "sqlite").toLowerCase() !== "json";
}

function getDatabase(): DatabaseSync {
  if (database) return database;
  const databasePath = path.resolve(
    process.env.STATE_DATABASE_PATH?.trim() || path.join(process.cwd(), "data", "state.sqlite")
  );
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL");
  database.exec(
    "CREATE TABLE IF NOT EXISTS json_state (state_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)"
  );
  return database;
}

function stateKey(filePath: string): string {
  return path.resolve(filePath);
}

function readLegacyJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw.trim().length === 0 ? fallback : (JSON.parse(raw) as T);
}

/**
 * Đọc file JSON tại `filePath`. Nếu file chưa tồn tại hoặc parse lỗi,
 * trả về `fallback` (và tự tạo file với fallback nếu chưa tồn tại)
 * thay vì throw - các state file (schedule/history/blacklist) không nên
 * làm crash app chỉ vì chưa được khởi tạo lần đầu.
 */
export function readJsonState<T>(filePath: string, fallback: T): T {
  if (useSqlite()) {
    try {
      const db = getDatabase();
      const row = db
        .prepare("SELECT payload FROM json_state WHERE state_key = ?")
        .get(stateKey(filePath)) as { payload: string } | undefined;
      if (row) return JSON.parse(row.payload) as T;

      // Lazy one-time migration: import JSON cũ, nhưng giữ file làm backup.
      const initial = readLegacyJson(filePath, fallback);
      db.prepare(
        "INSERT INTO json_state (state_key, payload, updated_at) VALUES (?, ?, ?)"
      ).run(stateKey(filePath), JSON.stringify(initial), new Date().toISOString());
      return initial;
    } catch (err) {
      getLogger().error("[jsonStore] Lỗi đọc SQLite state", {
        filePath,
        error: (err as Error).message,
      });
      return fallback;
    }
  }
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
  if (useSqlite()) {
    const payload = JSON.stringify(data);
    const updatedAt = new Date().toISOString();
    getDatabase()
      .prepare(
        "INSERT INTO json_state (state_key, payload, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(state_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at"
      )
      .run(stateKey(filePath), payload, updatedAt);
    return;
  }
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
