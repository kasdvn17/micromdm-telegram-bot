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
- Tự động xử lý enrollment mới và profile mặc định.
- Báo thức bằng Discord Voice Call thông qua tài khoản Discord selfbot.

## Quyền truy cập

Bot có 3 mức xác thực:

| Mức | Xác thực | Lệnh |
|---|---|---|
| Normal | Telegram username trong `AUTHORIZED_TELEGRAM_USERNAME` | Các lệnh thông thường, Focus, Blacklist, Alarm... |
| Emergency | `EMERGENCY_PASSWORD` | Các lệnh điều khiển thiết bị |
| Two-Factor | Username chính chủ + `EMERGENCY_PASSWORD` | `/api` |

Emergency không yêu cầu đúng username; vì vậy `EMERGENCY_PASSWORD` phải được giữ bí mật.

## Báo thức Discord

Báo thức sử dụng múi giờ `ALARM_TIMEZONE` (mặc định `Asia/Ho_Chi_Minh`) và thực hiện cuộc gọi Discord tới `DISCORD_TARGET_USER_ID`.

- **05:00 — lần 1:** gọi lặp lại khoảng mỗi 35 giây cho tới khi dùng `/alarm_stop`.
- **05:10 — lần 2:** nếu chưa dừng, chuyển sang lần 2 và tiếp tục gọi cho tới `/alarm_stop`.
- **05:30 — lần 3:** nếu vẫn chưa dừng, thực hiện cuộc gọi cuối cùng rồi kết thúc báo thức.
- `/alarm_stop`: dừng toàn bộ các lần còn lại trong ngày và ngắt cuộc gọi đang hoạt động.
- `/alarm_status`: xem trạng thái hiện tại.
- `/call test`: thực hiện ngay một cuộc gọi Discord để kiểm tra cấu hình.

Mỗi cuộc gọi **không có thời gian tự ngắt**. Bot giữ cuộc gọi cho tới khi Discord hoặc iPhone kết thúc cuộc gọi, hoặc bạn dùng `/alarm_stop`. Discord không cung cấp cho selfbot một cờ API để biến cuộc gọi thành Critical Alert hoặc buộc vượt qua Do Not Disturb; việc cuộc gọi có đổ chuông phụ thuộc vào Discord và cài đặt thông báo của thiết bị.

> **Lưu ý:** `discord.js-selfbot-v13` là thư viện không chính thức cho user account và dự án gốc đã bị archive/deprecated. Việc sử dụng selfbot có thể vi phạm Discord Terms of Service và có rủi ro khóa tài khoản.

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
/focus blockadd|blockremove <bundleId>
/focus blocklist
/focus blwadd|blwremove <website>
/focus blwlist

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

/call test
/alarm_stop
/alarm_status
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

DISCORD_SELF_TOKEN=token_tai_khoan_Discord
DISCORD_TARGET_USER_ID=123456789012345678
ALARM_TIMEZONE=Asia/Ho_Chi_Minh
```

Các biến bắt buộc để bot khởi động gồm `DEVICE_UUID`, `TELEGRAM_BOT_TOKEN`, `AUTHORIZED_TELEGRAM_USERNAME`, `EMERGENCY_PASSWORD`, `MICROMDM_URL` và `MICROMDM_API_KEY`.

### MicroMDM webhook

Trỏ command webhook của MicroMDM về bot:

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

## Dữ liệu

Bot lưu trạng thái bằng JSON trong `data/`, gồm:

- `blacklist.json` — app blacklist.
- `restricted-apps.json` — app bị chặn bởi Focus/Safe Mode.
- `sensitive_apps.json` — danh sách app Safe Mode.
- `schedule.json` — Focus schedule.
- `history.json` — lịch sử sự kiện.
- `alarm-state.json` — trạng thái báo thức.
- `mark-lost-state.json` — trạng thái Mark Lost.
- `logs/` — log theo ngày.

## Bảo mật

- Không commit `.env` thật lên Git.
- Giữ `EMERGENCY_PASSWORD` và token dịch vụ ở nơi an toàn.
- Chỉ cho phép MicroMDM truy cập webhook port nếu có thể.
- `/api` chỉ nên được dùng khi thực sự cần gửi command MDM trực tiếp.
