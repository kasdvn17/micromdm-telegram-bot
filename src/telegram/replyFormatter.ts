import { AuthFailureReason } from "../types/command.types";

export function formatSuccess(message: string): string {
  return message;
}

export function formatError(err: Error): string {
  return `⚠️ Lỗi: ${err.message}`;
}

export function formatUnauthorized(reason?: AuthFailureReason): string {
  switch (reason) {
    case "unauthorized_user":
      return "⛔ Bạn không có quyền dùng lệnh này.";
    case "missing_password":
      return "⛔ Thiếu mật khẩu. Cú pháp: /<lệnh> <password> [tham số...]";
    case "wrong_password":
      return "⛔ Sai mật khẩu.";
    case "missing_confirm":
      return "⛔ Lệnh nguy hiểm cần thêm từ khoá CONFIRM ở cuối.";
    default:
      return "⛔ Không có quyền thực hiện.";
  }
}
