import fs from "fs";
import path from "path";
import { ValidationError } from "../utils/errors";

export function saveUploadedProfile(
  dataDir: string,
  fileName: string,
  buffer: Buffer
): { savedPath: string; cleanFileName: string } {
  const profilesDir = path.resolve(dataDir, "profiles");
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }

  // Sanitize filename tránh path traversal và ký tự lạ
  const base = path.basename(fileName).replace(/[^\w.-]/g, "_") || "uploaded_profile.mobileconfig";
  const ext = path.extname(base).toLowerCase();
  const cleanFileName = ext ? base : `${base}.mobileconfig`;
  const savedPath = path.join(profilesDir, cleanFileName);

  fs.writeFileSync(savedPath, buffer);
  return { savedPath, cleanFileName };
}

/**
 * Đọc 1 file profile (.plist/.mobileconfig) theo TÊN FILE trong thư mục
 * `dataDir` hoặc `dataDir/profiles` (vd /installprofile default.plist),
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
  let resolvedFilePath = path.resolve(resolvedDataDir, trimmed);

  if (!fs.existsSync(resolvedFilePath) || !fs.statSync(resolvedFilePath).isFile()) {
    const inProfiles = path.resolve(resolvedDataDir, "profiles", trimmed);
    if (fs.existsSync(inProfiles) && fs.statSync(inProfiles).isFile()) {
      resolvedFilePath = inProfiles;
    }
  }

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
      `Không tìm thấy file "${trimmed}" trong thư mục data/ hoặc data/profiles/. Kiểm tra lại tên file (phân biệt hoa/thường).`
    );
  }

  const buf = fs.readFileSync(resolvedFilePath);
  return buf.toString("base64");
}
