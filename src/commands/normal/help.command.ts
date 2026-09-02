import { AuthTier, CommandDefinition } from "../../types/command.types";

/**
 * Nội dung help hiển thị các lệnh đang được hỗ trợ thực tế.
 * Không đưa các chi tiết triển khai hoặc lịch sử thay đổi vào /help.
 */
const HELP_TEXT = `📖 DANH SÁCH LỆNH

Quy ước: lệnh Emergency/Two-Factor đặt password ngay sau tên lệnh:
/lệnh <password> [tham số...]

── NORMAL ──

/focus on|off|status|remaining|extend <d>|cancel
/focus <duration> — bật Focus theo thời lượng, vd /focus 90m
/focus break [d] — cần 1 task AC mới kể từ break trước
/focus off — cần 7 task/ngày; Sleep Mode cần 3 task từ 22:00
/focus schedule list
/focus schedule add <start> <end> [days]
/focus schedule enable|disable <id>
/focus schedule skip [id]
/focus blockadd <bundleId>
/focus blocklist
/focus blwadd <website>
/focus blwremove <website>
/focus blwlist

/task add <problem> — chỉ nhận bài rating >= 1600
/task add bulk <id|url>... [--atomic] — hỗ trợ dấu phẩy, chọn gắn chung tag sau khi thêm
/task list — chỉ xem task active
/task list all — xem cả task đã AC
/task list [all] [tag] — lọc và nhóm task theo tag
/task list archived [tag] — xem task đã archive
/task tag add [tag] — tạo tag rồi chọn problem
/task tag edit [tag] — toggle tag trên toàn bộ problem
/task tag remove [tag] [id] — gỡ từng problem hoặc xóa tag toàn bộ
/task tag list — liệt kê từng problem và các tags
/task tagedit ... — cú pháp problem-first cũ
/task remove <id> — xóa task active
/task clear [tag] CONFIRM — xóa các task active
/task archive [id] — ẩn task đã AC nhưng giữ solvedAt
/task status — tiến độ task, break và Focus off
/refresh [full] — incremental mặc định, full để quét lại toàn bộ
/status — dashboard Focus, task, gate, break và thiết bị

/notify on|off|test
/blacklist add <bundleId>
/blacklist list
/blacklist blwadd <website>
/blacklist blwlist
/search <bundleId1> [bundleId2]...

/ping — kiểm tra bot
/health — uptime
/whoami — Telegram ID/username
/logs — log gần nhất
/history — lịch sử sự kiện gần nhất
/auth test <password> — kiểm tra Emergency Password
/help — xem danh sách lệnh

── EMERGENCY ──

/lock <password>
/restart <password>
/shutdown <password>
/unlock <password>
/playsound <password>
/battery <password> [realtime]
/location <password>
/deviceinfo <password> [realtime]
/devicestatus <password>
/lost <password> enable <phone> [footnote]
/lost <password> disable
/safe <password> on|off
/safe <password> blockadd|blockremove <bundleId>
/safe <password> blocklist
/securityinfo <password>
/networkinformation <password>
/wallpaper <password> <url-ảnh>
/refreshcellularplans <password>

/installapp <password> manifest <https-url>
/installapp <password> appstore <iTunesStoreID>
/listapps <password> [managed|all]
/removeapp <password> <bundleId>
/manageapp <password> enable|add <bundleId>|list

/profiles <password>
/installprofile <password> <filename>
/removeprofile <password> <profileIdentifier>

── TWO-FACTOR ──

/api <password> <name> [params...]

Whitelist: Lock, Unlock, Restart, Shutdown, PlaySound, GetBattery,
GetLocation, GetDeviceInfo, EnableLostMode, DisableLostMode,
ListProfiles, RemoveProfile, GetActivationLockBypassCode, EraseDevice.

Shutdown, EnableLostMode, RemoveProfile, GetActivationLockBypassCode
và EraseDevice yêu cầu thêm CONFIRM ở cuối lệnh.`;

export function createHelpCommand(): CommandDefinition {
  return {
    name: "help",
    tier: AuthTier.Normal,
    handler: async (): Promise<string> => HELP_TEXT,
  };
}
