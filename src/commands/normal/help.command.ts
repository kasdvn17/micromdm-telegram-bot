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
/focus break [d] — tạm ngưng Focus trong schedule
/focus schedule list
/focus schedule add <start> <end> [days]
/focus schedule enable|disable <id>
/focus schedule skip [id]
/focus blockadd|blockremove <bundleId>
/focus blocklist
/focus blwadd|blwremove <website>
/focus blwlist

/notify on|off|test
/blacklist add <bundleId>
/blacklist list
/blacklist blwadd <website>
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
/status <password>
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
