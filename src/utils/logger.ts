import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

let instance: winston.Logger | null = null;

/**
 * Khởi tạo logger toàn cục. Gọi 1 lần tại main.ts trước khi mọi module khác
 * gọi `getLogger()`.
 */
export function initLogger(logDir: string): winston.Logger {
  const fileTransport = new DailyRotateFile({
    dirname: logDir,
    filename: "bot-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    maxFiles: "30d",
    zippedArchive: true,
  });

  instance = winston.createLogger({
    level: "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
            return `[${timestamp as string}] ${level}: ${message as string} ${metaStr}`;
          })
        ),
      }),
      fileTransport,
    ],
  });

  return instance;
}

export function getLogger(): winston.Logger {
  if (!instance) {
    // fallback an toàn nếu module nào đó gọi getLogger() trước initLogger()
    // (không nên xảy ra nếu main.ts tuân thủ thứ tự khởi tạo)
    instance = initLogger(path.resolve(process.cwd(), "data", "logs"));
    instance.warn("[logger] getLogger() được gọi trước initLogger() - dùng fallback config");
  }
  return instance;
}
