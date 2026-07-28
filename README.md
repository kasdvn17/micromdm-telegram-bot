# MicroMDM Telegram Bot

Một Telegram Bot cá nhân viết bằng TypeScript, đóng vai trò client/controller cho [MicroMDM](https://github.com/micromdm/micromdm). Bot cho phép quản lý, giám sát và gửi lệnh MDM (Mobile Device Management) tới **một** thiết bị iOS Supervised duy nhất, trực tiếp qua Telegram.

> ⚠️ MicroMDM "v1" (bản mà bot này dùng) hiện đang ở chế độ maintenance; hãy theo dõi thông báo từ [micromdm/micromdm](https://github.com/micromdm/micromdm) nếu bạn định dùng lâu dài.

## 🌟 Tính năng

- **Điều khiển thiết bị qua Telegram**: khoá/mở khoá máy, restart, shutdown, phát âm thanh, xem pin/vị trí/thông tin máy, cài/gỡ/liệt kê app, Lost Mode, Activation Lock tự động khi enroll mới...
- **Webhook server riêng**: lắng nghe đúng 4 topic mà MicroMDM thực sự expose - `mdm.Authenticate`, `mdm.TokenUpdate`, `mdm.CheckOut` (payload `checkin_event`) và `mdm.Connect` (payload `acknowledge_event` - đây là nơi nhận **kết quả** của mọi command, kể cả DeviceInformation/DeviceLocation). MicroMDM không có topic `mdm.Enrollment` riêng nên bot tự phát hiện enrollment mới qua `mdm.TokenUpdate` đầu tiên của một UDID.
- **Lọc thông báo "heartbeat"**: mọi lần check-in lặp lại (`mdm.TokenUpdate`) mà nội dung raw payload (đã decode) giống hệt lần gần nhất bị coi là heartbeat thuần tuý và **không** gửi Telegram (vẫn ghi đầy đủ vào `history.json`). Với các check-in **có ý nghĩa thật** (enrollment, thay đổi nội dung, `mdm.Authenticate`, `mdm.CheckOut`), bot decode raw payload và đính kèm nguyên văn trong tin nhắn Telegram.
- **Profile mặc định tự động cài khi enroll**: hardcode sẵn 1 Configuration Profile (`src/profiles/defaultProfile.ts`) tự động đẩy xuống máy ngay khi phát hiện enrollment mới, cùng lúc với việc bật Activation Lock.
- **Quản lý Profile**: xem toàn bộ profile đã cài (`/profiles`) và gỡ theo Profile Identifier (`/removeprofile`).
- **Activation Lock Bypass Code**: lấy mã bypass Activation Lock của máy qua `/api ... GetActivationLockBypassCode CONFIRM` (Two-Factor tier, luôn yêu cầu CONFIRM do cực kỳ nhạy cảm).
- **Focus Mode**: bật giới hạn ứng dụng theo yêu cầu (`/focus on`), theo thời lượng (`/focus 90m`), hoặc theo lịch lặp lại hằng ngày/theo thứ (`/focus schedule add 06:00 23:00`). Có danh sách app bị chặn riêng cho Focus (`/focus blockadd|blockremove|blocklist`), chỉ đẩy xuống máy ngay khi Focus/Safe Mode đang thực sự bật - nếu đang tắt thì chỉ lưu lại, áp dụng ở lần bật kế tiếp.
- **Safe Mode**: bản Focus vô thời hạn, độc lập với schedule/timer, chỉ tắt bằng `/safe off`.
- **Blacklist ứng dụng**: chặn app cụ thể, độc lập hoàn toàn với Focus Mode (profile riêng), hỗ trợ cả `blacklistedAppBundleIDs` (trước iOS 15) lẫn `blockedAppBundleIDs` (iOS 15+).
- **Bảo mật 3 lớp** (xem chi tiết bên dưới), chống timing attack bằng `crypto.timingSafeEqual` khi so khớp mật khẩu.
- **`/unlock` và Safe Mode độc lập hoàn toàn**: `/unlock` chỉ gửi lệnh mở khoá máy (ClearPasscode), không còn tự động tắt Safe Mode - muốn tắt phải dùng riêng `/safe off`.
- **Lưu trạng thái bằng file JSON** trong `data/` - không cần Database ngoài.

## 🔐 Bảo mật 3 lớp

| Lớp | Điều kiện | Áp dụng cho |
|---|---|---|
| **Normal** | Đúng Telegram username = `AUTHORIZED_TELEGRAM_USERNAME` | `/ping`, `/health`, `/whoami`, `/logs`, `/history`, `/notify`, `/blacklist`, `/focus`, `/auth test`, `/help` |
| **Emergency** | Đúng `EMERGENCY_PASSWORD` (**không** cần đúng username - bất kỳ ai biết mật khẩu đều gọi được) | `/lock`, `/restart`, `/shutdown`, `/playsound`, `/battery`, `/location`, `/deviceinfo`, `/status`, `/lost`, `/unlock`, `/safe`, `/mark`, `/installapp`, `/listapps`, `/removeapp` |
| **Two-Factor** | Đúng username **VÀ** đúng mật khẩu | `/api` |

> Lưu ý thiết kế: Lớp Emergency không kiểm tra username, chỉ kiểm tra mật khẩu - nếu `EMERGENCY_PASSWORD` bị lộ, người ngoài vẫn gọi được các lệnh này từ bất kỳ tài khoản Telegram nào. Cân nhắc đổi mật khẩu định kỳ và không chia sẻ.

## ⌨️ Danh sách lệnh

### Normal (không cần mật khẩu)
- `/ping` - kiểm tra bot còn sống.
- `/health` - xem uptime.
- `/whoami` - xem Telegram ID/username của bạn.
- `/logs` - 20 dòng log gần nhất.
- `/history` - 20 sự kiện gần nhất (webhook + lệnh emergency/two-factor đã chạy).
- `/auth test <password>` - kiểm tra thử một mật khẩu có đúng `EMERGENCY_PASSWORD` không.
- `/help` - xem toàn bộ danh sách lệnh (đầy đủ hơn README, luôn khớp với code hiện tại).
- `/notify on|off|test` - bật/tắt/test thông báo chủ động từ bot.
- `/blacklist add|remove <bundleId>|list` - quản lý app bị chặn (độc lập với Focus).
- `/focus on|off|status|remaining|extend <d>|cancel` - bật/tắt Focus Mode thủ công hoặc theo thời lượng (`/focus 90m`, `/focus 2h`).
- `/focus schedule list|add <start> <end> [days]|enable <id>|disable <id>` - quản lý lịch lặp lại. Vd: `/focus schedule add 06:00 23:00` (mặc định cả 7 ngày), hoặc thêm `1,2,3,4,5` để chỉ áp dụng Thứ 2 - Thứ 6 (0=CN...6=T7).
- `/focus blockadd|blockremove <bundleId>` / `/focus blocklist` - quản lý danh sách app bị chặn riêng của Focus Mode.
- `/search <bundleId1> [bundleId2]...` - tìm thông tin ứng dụng (Tên, iTunes Store ID) trên iTunes Store Việt Nam bằng Bundle ID.

### Emergency (thêm mật khẩu ngay sau tên lệnh)
- `/lock <password>` - khoá máy ngay.
- `/restart <password>` / `/shutdown <password>` - khởi động lại / tắt máy (yêu cầu Supervised).
- `/playsound <password>` - phát âm thanh trên máy.
- `/battery <password> [realtime]` / `/deviceinfo <password> [realtime]` / `/status <password>` - thông tin thiết bị (mặc định dùng cache, thêm `realtime` để query trực tiếp).
- `/location <password>` - định vị (chỉ trả toạ độ khi máy đang ở MDM Lost Mode).
- `/lost <password> enable <phone> [footnote]` / `/lost <password> disable` - bật/tắt Lost Mode thật trên thiết bị.
- `/unlock <password>` - gửi lệnh mở khoá máy. **Không** còn ảnh hưởng tới Safe Mode.
- `/safe <password> on|off` - bật/tắt Safe Mode (Focus vô thời hạn), độc lập với `/unlock`.
- `/securityinfo <password>` - xem thông tin bảo mật thiết bị (có đặt mật khẩu không, đang mã hoá không...).
- `/wallpaper <password> <url-ảnh>` - đổi hình nền (Lock & Home screen) thông qua link ảnh.
- `/installapp <password> manifest <https-url>` / `/installapp <password> appstore <iTunesStoreID>` - cài app (lưu ý app App Store không qua VPP có thể không cài được ở dạng managed).
- `/listapps <password> [managed|all]` - liệt kê app đã cài.
- `/removeapp <password> <bundleId>` - gỡ app (chỉ hoạt động với app managed).
- `/manageapp <password> enable|add <bundleId>|list` - lưu trữ danh sách bundle ID và tự động tìm kiếm, gửi lệnh cài đặt để chuyển đổi ứng dụng sang dạng managed.
- `/profiles <password>` - liệt kê toàn bộ Configuration Profile đã cài trên máy.
- `/removeprofile <password> <profileIdentifier>` - gỡ 1 profile theo Profile Identifier (vd `com.personal.micromdmbot.focus`) - **không** phải app Bundle ID. Thất bại nếu profile có `PayloadRemovalDisallowed=true` hoặc yêu cầu removal passcode (vd profile MDM gốc dùng để enroll máy).

### Two-Factor (`/api <password> <name> [params...] [CONFIRM]`)
Whitelist cố định trong `commandRegistry.ts` - không suy ra bằng reflection để tránh vô tình lộ thêm method mới:
`Lock`, `Unlock`, `Restart`, `Shutdown` (cần `CONFIRM`), `PlaySound`, `GetBattery`, `GetLocation`, `GetDeviceInfo`, `EnableLostMode` (cần `CONFIRM`), `DisableLostMode`, `ListProfiles`, `RemoveProfile` (cần `CONFIRM`), `GetActivationLockBypassCode` (cần `CONFIRM` - cực nhạy cảm, xem cảnh báo bên dưới), `EraseDevice` (cần `CONFIRM`, nguy hiểm nhất).

Ví dụ: `/api secret123 GetBattery`, `/api secret123 Shutdown CONFIRM`, `/api secret123 GetActivationLockBypassCode CONFIRM`.

> ⚠️ **`GetActivationLockBypassCode`**: mã trả về có thể gỡ Activation Lock (chống trộm) của máy vĩnh viễn mà không cần Apple ID/mật khẩu. Vì vậy đây là lệnh Two-Factor DUY NHẤT thay vì Emergency, dù các lệnh đọc thông tin khác (`/battery`, `/deviceinfo`...) chỉ ở tier Emergency. Chỉ có giá trị khi máy đã Supervised và Activation Lock đã được bật qua MDM (tự động khi enroll, xem tính năng "Activation Lock tự động" ở trên) - nếu Find My chưa từng được bật trên máy, response có thể không có `BypassCode`.

## 📂 Cấu trúc dữ liệu (`data/`)

- `blacklist.json` - Bundle ID bị chặn bởi `/blacklist`.
- `restricted-apps.json` - Bundle ID bị chặn bởi Focus Mode/Safe Mode (`blockadd`/`blockremove`).
- `schedule.json` - Lịch Focus (duration-based + recurring).
- `history.json` - Lịch sử sự kiện (tối đa 5000 bản ghi gần nhất).
- `mark-lost-state.json` - Trạng thái bật/tắt của `/mark lost`.
- `seen-devices.json` - UDID đã từng thấy, dùng để phát hiện enrollment mới.
- `checkin-state.json` - Hash raw payload check-in gần nhất theo UDID, dùng để phát hiện heartbeat.
- `logs/` - Log file xoay vòng theo ngày.

Tất cả được ghi atomic (ghi file tạm rồi rename) để tránh hỏng file nếu process bị kill giữa chừng.

## ⚙️ Yêu cầu hệ thống

- **Bun** (hoặc Node.js ≥ 18)
- Server **MicroMDM** đã chạy, có chứng chỉ đẩy APNs hợp lệ.
- Bot Telegram (tạo qua [@BotFather](https://t.me/botfather)).
- Thiết bị iOS đã **Supervised** và **enroll** vào MicroMDM (nhiều lệnh như restart/shutdown/lost mode yêu cầu Supervised, nếu không sẽ bị Apple từ chối với lỗi "not a valid request type").

## 🚀 Cài đặt & cấu hình

1. Cài thư viện:
   ```bash
   bun install
   ```

2. Tạo `.env` từ mẫu:
   ```bash
   cp .env.example .env
   ```
   Điền các giá trị:
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

   # Tuỳ chọn - để trống dùng default trong constants.ts
   DEVICE_INFO_POLL_INTERVAL_MS=
   MARK_LOST_POLL_INTERVAL_MS=
   LOG_DIR=
   HISTORY_FILE_PATH=
   SCHEDULE_FILE_PATH=
   BLACKLIST_FILE_PATH=
   RESTRICTED_APPS_FILE_PATH=
   ```
   `DEVICE_UUID`, `TELEGRAM_BOT_TOKEN`, `AUTHORIZED_TELEGRAM_USERNAME`, `EMERGENCY_PASSWORD`, `MICROMDM_URL`, `MICROMDM_API_KEY` là bắt buộc - bot fail-fast (từ chối khởi động) nếu thiếu.

3. Cấu hình MicroMDM trỏ webhook về bot:
   ```bash
   ./micromdm serve -command-webhook-url="http://<IP_CUA_BOT>:6364/webhook/micromdm" ...
   ```

4. **(Tuỳ chọn) Chỉnh profile mặc định**: mở `src/profiles/defaultProfile.ts` và sửa `PayloadContent` theo nhu cầu thực tế (mặc định là profile rỗng, không làm gì) - profile này tự động cài vào máy ngay khi phát hiện enrollment mới.

## 🛠 Chạy ứng dụng

```bash
bun start        # chạy production (tsc build trước đó qua `bun run build`)
bun run dev       # dev mode, tự reload khi sửa code
bun run typecheck # chỉ kiểm tra type, không build
```

## ⚠️ Lưu ý bảo mật

- `EMERGENCY_PASSWORD` lưu **plaintext** trong `.env` để đơn giản hoá cho dùng cá nhân. **Tuyệt đối không** commit `.env` thật lên Git hay chia sẻ cho ai.
- Chỉ cho phép MicroMDM truy cập port webhook (mặc định `6364`), không mở public ra internet nếu không cần thiết; cân nhắc thêm firewall/WAF.
- Lớp Emergency không ràng buộc theo username (xem bảng bảo mật ở trên) - đổi `EMERGENCY_PASSWORD` ngay nếu nghi ngờ bị lộ.

