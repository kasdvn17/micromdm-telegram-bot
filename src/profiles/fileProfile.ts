import fs from "fs";
import path from "path";
import { ValidationError } from "../utils/errors";

/**
 * Đọc 1 file profile (.plist/.mobileconfig) theo TÊN FILE trong thư mục
 * `dataDir` (vd /installprofile default.plist -> tìm data/default.plist),
 * trả về base64 sẵn sàng gửi InstallProfile.
 *
 * Chặn path traversal (vd "../../etc/passwd" hoặc absolute path) bằng cách
 * resolve rồi kiểm tra kết quả vẫn nằm trong `dataDir` - chỉ được cài file
 * đã có sẵn trong data/, không cho đọc file bất kỳ trên hệ thống.
 */
export function loadProfileFileBase64(dataDir: string, filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    throw new ValidationError("Thiếu tên file. Cú pháp: /installprofile <password> <filename>");
  }

  const resolvedDataDir = path.resolve(dataDir);
  const resolvedFilePath = path.resolve(resolvedDataDir, trimmed);

  if (
    resolvedFilePath !== resolvedDataDir &&
    !resolvedFilePath.startsWith(resolvedDataDir + path.sep)
  ) {
    throw new ValidationError(
      `Tên file không hợp lệ (chỉ được cài file nằm trong thư mục data/): "${filename}"`
    );
  }

  if (!fs.existsSync(resolvedFilePath) || !fs.statSync(resolvedFilePath).isFile()) {
    throw new ValidationError(
      `Không tìm thấy file "${trimmed}" trong thư mục data/. Kiểm tra lại tên file (phân biệt hoa/thường).`
    );
  }

  const xml = fs.readFileSync(resolvedFilePath, "utf-8");
  return Buffer.from(xml, "utf-8").toString("base64");
}
