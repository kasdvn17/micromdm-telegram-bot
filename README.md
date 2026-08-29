# MicroMDM Telegram Bot

Telegram bot cá nhân để quản lý một thiết bị iOS Supervised thông qua MicroMDM.

## Tính năng

- Điều khiển thiết bị qua Telegram: lock, unlock, restart, shutdown, phát âm thanh, xem pin/vị trí/thông tin, Lost Mode.
- Quản lý ứng dụng: cài, gỡ, liệt kê và chuyển app sang managed app.
- Quản lý Configuration Profile.
- Focus Mode với thời lượng, schedule, danh sách app/website bị chặn và break.
- Safe Mode với danh sách app riêng.
- Blacklist app.
- Theo dõi webhook MicroMDM và lưu lịch sử/log.
- Tự động gửi một câu danh ngôn của người nổi tiếng mỗi giờ qua Telegram.
- Tự động xử lý enrollment mới và profile mặc định.
- Codeforces task gate: yêu cầu AC các bài đã thêm trước khi được phép Focus break.

## Quyền truy cập

Bot có 3 mức xác thực:

| Mức | Xác thực | Lệnh |
|---|---|---|
| Normal | Telegram username trong `AUTHORIZED_TELEGRAM_USERNAME` | Các lệnh thông thường, Focus, Blacklist... |
| Emergency | `EMERGENCY_PASSWORD` | Các lệnh điều khiển thiết bị |
| Two-Factor | Username chính chủ + `EMERGENCY_PASSWORD` | `/api` |

Emergency không yêu cầu đúng username; vì vậy `EMERGENCY_PASSWORD` phải được giữ bí mật.

## Danh sách lệnh

### Normal

```text
/focus on|off|status|remaining|extend <duration>|cancel
/focus <duration>
/focus break [duration]
/focus schedule list
/focus schedule add <start> <end> [days]
/focus schedule enable|disable <id>
/focus schedule skip [id]
/focus blockadd <bundleId>
/focus blocklist
/focus blwadd <website>
/focus blwlist

/task add <problem>
/task list
/refresh

/notify on|off|test
/blacklist add <bundleId>
/blacklist list
/blacklist blwadd <website>
/search <bundleId1> [bundleId2]...

/ping
/health
/whoami
/logs
/history
/auth test <password>
/help

```

### Emergency

Cú pháp chung:

```text
/lệnh <password> [tham số...]
```

Các lệnh:

```text
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
```

### Two-Factor

```text
/api <password> <name> [params...]
```

Whitelist hiện tại:

```text
Lock
Unlock
Restart
Shutdown
PlaySound
GetBattery
GetLocation
GetDeviceInfo
EnableLostMode
DisableLostMode
ListProfiles
RemoveProfile
GetActivationLockBypassCode
EraseDevice
```

Các lệnh nguy hiểm yêu cầu `CONFIRM` ở cuối:

```text
/api <password> Shutdown CONFIRM
/api <password> EnableLostMode <phone> CONFIRM
/api <password> RemoveProfile <profileIdentifier> CONFIRM
/api <password> GetActivationLockBypassCode CONFIRM
/api <password> EraseDevice <id> CONFIRM
```

## Sleep Mode

Trong khoảng **22:00–05:00**, Focus tự động được bật. Trong thời gian này không thể tắt Focus bằng các lệnh thông thường.

## Cài đặt

### Yêu cầu

- Bun hoặc Node.js >= 18.
- MicroMDM đang chạy và có APNs push certificate hợp lệ.
- Telegram Bot tạo bằng BotFather.
- Thiết bị iOS đã Supervised và enrolled vào MicroMDM.

### Cài đặt dependencies

```bash
bun install
```

### Tạo `.env`

```bash
cp .env.example .env
```

Cấu hình tối thiểu:

```env
TELEGRAM_BOT_TOKEN=token_tu_botfather
AUTHORIZED_TELEGRAM_USERNAME=username_khong_co_a_cong
AUTHORIZED_TELEGRAM_CHAT_ID=
EMERGENCY_PASSWORD=mat_khau_bi_mat

MICROMDM_URL=https://mdm.yourdomain.com
MICROMDM_API_KEY=api_key_cua_micromdm
WEBHOOK_PORT=6364
WEBHOOK_PATH=/webhook/micromdm

DEVICE_UUID=udid_thiet_bi_ios
```

Các biến bắt buộc để bot khởi động gồm `DEVICE_UUID`, `TELEGRAM_BOT_TOKEN`, `AUTHORIZED_TELEGRAM_USERNAME`, `EMERGENCY_PASSWORD`, `MICROMDM_URL` và `MICROMDM_API_KEY`. `AUTHORIZED_TELEGRAM_CHAT_ID` không bắt buộc; nếu bỏ trống, bot bind chat riêng sau tin nhắn đầu tiên từ username được uỷ quyền.

### MicroMDM webhook

Trỏ command webhook của MicroMDM về đúng `WEBHOOK_PATH` của bot:

```bash
./micromdm serve -command-webhook-url="http://<IP_CUA_BOT>:6364/webhook/micromdm" ...
```

## Chạy

```bash
bun run dev
bun run build
bun start
bun run typecheck
```

## Codeforces utility

Các hàm trong `src/utils/codeforces.ts` chỉ dùng API anonymous nên chỉ đọc dữ liệu public. Client tự phân trang và giữ khoảng cách tối thiểu 2 giây giữa các request theo [giới hạn API chính thức của Codeforces](https://codeforces.com/apiHelp).

```ts
import {
  fetchAllUserSubmissions,
  hasUserSolvedPublicProblem,
} from "./utils/codeforces";

const submissions = await fetchAllUserSubmissions("tourist");
const solved = await hasUserSolvedPublicProblem("tourist", 4, "A");
```

`hasUserSolvedPublicProblem()` chỉ trả `true` khi bài vẫn có trong problemset public và user có submission với `verdict === "OK"` cho đúng `contestId` và `index`.

Đặt `CODEFORCES_HANDLE` trong `.env`, sau đó dùng `/task add 4A` (cũng hỗ trợ URL hoặc đúng tên bài). `/refresh` lấy submission mới nhất, đánh dấu các bài đã AC và `/focus break` sẽ bị từ chối khi còn ít nhất một task active.

## Danh ngôn mỗi giờ

Bot gửi một câu trong danh sách cục bộ sau mỗi 60 phút kể từ lúc khởi động. Không có tin nhắn gửi ngay lúc boot và mỗi interval chỉ gửi một câu. Có thể đổi chu kỳ bằng `QUOTE_INTERVAL_MS`; `/notify off` cũng tạm dừng các tin nhắn danh ngôn.

## Dữ liệu

Bot lưu trạng thái bằng JSON trong `data/`, gồm:

- `blacklist.json` — app blacklist.
- `restricted-apps.json` — app bị chặn bởi Focus/Safe Mode.
- `sensitive_apps.json` — danh sách app Safe Mode.
- `schedule.json` — Focus schedule.
- `history.json` — lịch sử sự kiện.
- `mark-lost-state.json` — trạng thái Mark Lost.
- `codeforces-tasks.json` — task Codeforces active/đã AC theo Telegram user ID.
- `logs/` — log theo ngày.

## Bảo mật

- Không commit `.env` thật lên Git.
- Giữ `EMERGENCY_PASSWORD` và token dịch vụ ở nơi an toàn.
- Chỉ cho phép MicroMDM truy cập webhook port nếu có thể.
- `/api` chỉ nên được dùng khi thực sự cần gửi command MDM trực tiếp.
