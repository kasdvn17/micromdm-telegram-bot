import { AuthTier, CommandDefinition } from "../../types/command.types";

/**
 * Nội dung help là TĨNH (hardcode) thay vì tự sinh từ danh sách CommandDefinition,
 * vì CommandDefinition hiện chỉ có {name, tier, handler} - không có description.
 * Nếu thêm/sửa lệnh, nhớ cập nhật cả file này.
 *
 * Plain text (không dùng ký tự Markdown *_) vì bot hiện không set parse_mode
 * khi sendMessage - Markdown sẽ hiện ký tự thô thay vì được format.
 */
const HELP_TEXT = `📖 DANH SÁCH LỆNH

Quy ước: lệnh Emergency/Two-Factor đặt password ngay sau tên lệnh -
"/lệnh <password> [tham số...]"

── NORMAL (chỉ Authorized Username) ──

/focus on|off — bật/tắt Focus vô thời hạn (bị chặn nếu đang trong khung giờ schedule)
/focus <duration> — bật Focus theo thời lượng, vd /focus 90m, /focus 2h
/focus status|remaining — xem trạng thái/thời gian còn lại
/focus extend <d> — gia hạn Focus theo duration đang chạy
/focus cancel — huỷ Focus session hiện tại (bị chặn nếu đang trong schedule)
/focus break [d] — tạm ngưng Focus khi đang trong schedule, mặc định 15m, tự bật lại khi hết giờ
/focus schedule list — xem danh sách schedule
/focus schedule add <start> <end> [days] — tạo lịch lặp lại, vd 06:00 23:00 1,2,3,4,5
/focus schedule enable|disable <id> — bật/tắt 1 schedule
/focus schedule skip [id] — bỏ qua schedule HÔM NAY (không truyền id thì tự tìm)
/focus blockadd|blockremove <bundleId> — thêm/gỡ app khỏi danh sách chặn của Focus
/focus blocklist — xem danh sách app bị chặn bởi Focus

/notify on|off|test — bật/tắt/test notification
/blacklist add|remove <bundleId> — thêm/gỡ app khỏi blacklist (độc lập với Focus)
/blacklist list — xem blacklist

/search <bundleId1> [bundleId2]... — tìm thông tin ứng dụng trên iTunes Store VN

/ping — kiểm tra bot còn sống
/health — uptime của bot
/whoami — xem Telegram ID/username của bạn
/logs — 20 dòng log gần nhất
/history — 20 event gần nhất
/auth test <password> — kiểm tra Emergency Password có đúng không
/help — xem lại danh sách này

── EMERGENCY (chỉ cần đúng password, mọi tài khoản Telegram) ──

/lock <password> — khoá máy
/restart <password> — khởi động lại
/shutdown <password> — tắt máy
/unlock <password> — mở khoá máy (độc lập với Safe Mode, không tự tắt)
/playsound <password> — phát âm thanh tìm máy
/battery <password> [realtime] — mức pin
/location <password> — vị trí (chỉ có toạ độ khi đang Managed Lost Mode thật)
/deviceinfo <password> [realtime] — thông tin thiết bị đầy đủ (~25 field)
/status <password> — trạng thái thiết bị (cache)
/lost enable|disable <password> — bật/tắt Lost Mode THẬT
/safe on|off <password> — chặn app riêng tư (data/sensitive_apps.json), độc lập hoàn toàn với Focus, chỉ tắt bằng /safe off
/safe blockadd|blockremove <password> <bundleId> — thêm/gỡ app khỏi danh sách chặn của Safe Mode
/safe blocklist <password> — xem danh sách app bị Safe Mode chặn
/securityinfo <password> — xem thông tin bảo mật của thiết bị (mã hoá, mật khẩu...)
/wallpaper <password> <url-ảnh> — đổi hình nền (Lock & Home screen) từ link ảnh

/installapp <password> manifest <https-url> — cài managed app từ Manifest.plist
/installapp <password> appstore <iTunesStoreID> — cài app từ App Store (không đảm bảo managed)
/listapps <password> [managed|all] — liệt kê app đã cài
/removeapp <password> <bundleId> — gỡ app (chỉ app đang managed)
/manageapp <password> enable|add <bundleId>|list — quản lý và tự động convert app sang dạng managed

/profiles <password> — liệt kê Configuration Profile trên máy
/installprofile <password> <filename> — cài file .plist trong thư mục data/, vd default.plist
/removeprofile <password> <profileIdentifier> — gỡ 1 profile theo PayloadIdentifier

── TWO-FACTOR (bắt buộc đúng username chính chủ VÀ password) ──

/api <password> <name> [params...] — gọi thẳng lệnh MDM theo whitelist
Whitelist: Lock, Unlock, Restart, Shutdown, PlaySound, GetBattery, GetLocation, GetDeviceInfo, EnableLostMode, DisableLostMode, EraseDevice
Lệnh nguy hiểm (Shutdown, EnableLostMode, EraseDevice) bắt buộc thêm CONFIRM ở cuối, vd:
/api <password> EraseDevice CONFIRM`;

export function createHelpCommand(): CommandDefinition {
  return {
    name: "help",
    tier: AuthTier.Normal,
    handler: async (): Promise<string> => HELP_TEXT,
  };
}
