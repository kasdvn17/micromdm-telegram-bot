# MicroMDM Telegram Bot

Một Telegram Bot cá nhân được viết bằng TypeScript, hoạt động như một client/controller cho [MicroMDM](https://github.com/micromdm/micromdm). Bot này cho phép bạn quản lý, giám sát và gửi các lệnh MDM (Mobile Device Management) tới thiết bị iOS của mình trực tiếp thông qua Telegram.

## 🌟 Tính năng nổi bật

- **Quản lý qua Telegram:** Thay vì phải mở trình duyệt truy cập dashboard của MicroMDM, bạn có thể điều khiển thiết bị thông qua các lệnh Telegram tiện lợi.
- **Webhook Integration:** Tích hợp sẵn Webhook server lắng nghe các sự kiện trực tiếp từ MicroMDM (`mdm.Authenticate`, `mdm.TokenUpdate`, `mdm.Acknowledge`, `mdm.Connect`, `mdm.CheckOut`).
- **Lấy thông tin thiết bị:** Xem pin (`/battery`), định vị (`/location`), và thông tin thiết bị (`/deviceinfo`) trực tiếp.
- **Quản lý Profile:** Hỗ trợ tạo và đẩy cấu hình (Configuration Profile) theo thời gian thực:
  - **Focus Mode:** Giới hạn ứng dụng theo thời gian hẹn trước (`/focus`).
  - **Blacklist:** Chặn các ứng dụng cụ thể không cho phép mở trên máy (`/blacklist`), hỗ trợ hoàn hảo cho cả iOS cũ (dùng `blacklistedAppBundleIDs`) và iOS 15+ (dùng `blockedAppBundleIDs`).
- **Emergency Mode (Bảo mật 3 lớp):**
  - **Lớp 1 (Normal):** Chỉ cho phép Telegram ID/Username đã cấu hình tương tác với bot.
  - **Lớp 2 (Emergency):** Các lệnh nguy hiểm như `/lost`, `/unlock` yêu cầu mật khẩu riêng.
  - **Lớp 3 (Two-Factor):** Các lệnh can thiệp sâu (như gửi raw MDM request qua `/api`) yêu cầu cả Username hợp lệ LẪN mật khẩu.
- **Bảo mật:** Sử dụng constant-time comparison (thông qua `crypto.timingSafeEqual`) để chống lại Timing Attacks khi xác thực mật khẩu.

## 📂 Cấu trúc dữ liệu (Data Persistence)

Dự án không yêu cầu cài đặt Database phức tạp (như MySQL/PostgreSQL). Toàn bộ dữ liệu động được lưu dưới dạng file JSON trong thư mục `data/`:
- `data/blacklist.json`: Danh sách các App Bundle ID đang bị chặn.
- `data/restricted-apps.json`: Danh sách App Bundle ID dùng cho chế độ Focus Mode.
- `data/schedule.json`: Các lịch trình Focus Mode đã hẹn.
- `data/history.json`: Lịch sử các lệnh MDM đã thực thi.
- `data/logs/`: Thư mục chứa log của hệ thống.

## ⚙️ Yêu cầu hệ thống

- **Bun** (hoặc Node.js >= 18)
- Một server **MicroMDM** đã được cài đặt và cấu hình chứng chỉ đẩy (APNs) thành công.
- Một con Bot Telegram (Tạo qua [@BotFather](https://t.me/botfather)).
- Thiết bị iOS đã được Supervised và Enroll vào MicroMDM server.

## 🚀 Cài đặt & Cấu hình

1. **Clone project và cài đặt thư viện:**
   ```bash
   bun install
   ```

2. **Cấu hình biến môi trường:**
   Tạo file `.env` từ file mẫu:
   ```bash
   cp .env.example .env
   ```
   Sau đó mở file `.env` và điền các thông tin của bạn:
   ```env
   TELEGRAM_BOT_TOKEN=token_tu_botfather
   AUTHORIZED_TELEGRAM_USERNAME=username_cua_ban_khong_co_a_cong
   EMERGENCY_PASSWORD=mat_khau_bi_mat_cua_ban
   
   MICROMDM_URL=https://mdm.yourdomain.com
   MICROMDM_API_KEY=api_key_cua_micromdm
   WEBHOOK_PORT=6364
   WEBHOOK_PATH=/webhook/micromdm
   
   DEVICE_UUID=udid_thiet_bi_ios_cua_ban
   ```

3. **Cấu hình MicroMDM Server:**
   Khi khởi chạy MicroMDM server, hãy nhớ cấu hình tham số `-webhook-url` trỏ về IP/Domain và Port của Bot này.
   Ví dụ:
   ```bash
   ./micromdm serve -webhook-url="http://<IP_CUA_BOT>:6364/webhook/micromdm" ...
   ```

## 🛠 Chạy ứng dụng

Sử dụng Bun để chạy trực tiếp (nhờ tích hợp sẵn TypeScript compiler):
```bash
bun start
```
*Hoặc nếu bạn muốn chạy ở chế độ dev (tự động reload khi sửa code):*
```bash
bun run dev
```

## ⌨️ Danh sách lệnh Telegram

### Lệnh thông thường (Normal Tier)
Yêu cầu bạn phải dùng đúng account Telegram có Username khớp với `AUTHORIZED_TELEGRAM_USERNAME`.
- `/ping` - Kiểm tra bot còn sống không.
- `/health` - Xem uptime.
- `/whoami` - Xem thông tin Telegram ID của bạn.
- `/logs` - Xem 20 dòng log cuối cùng.
- `/history` - Xem lịch sử webhook/MDM event gần nhất.
- `/battery` - Xem % pin thiết bị.
- `/location` - Định vị thiết bị (Chỉ trả về toạ độ khi máy đang ở MDM Lost Mode).
- `/deviceinfo` - Lấy thông tin cơ bản của máy.
- `/reboot` - Khởi động lại thiết bị (Yêu cầu Supervised).
- `/shutdown` - Tắt nguồn thiết bị (Yêu cầu Supervised).
- `/blacklist add|remove <bundleId>|list` - Quản lý app bị chặn.
- `/focus on|off|status|remaining|extend <d>|cancel|schedule ...` - Quản lý Focus Mode.

### Lệnh khẩn cấp (Emergency Tier)
Yêu cầu gửi kèm Mật khẩu ở cuối lệnh. Bất kỳ ai có mật khẩu này đều dùng được lệnh.
- `/lost enable|disable <password>` - Bật/Tắt chế độ Lost Mode.
- `/unlock <password>` - Mở khoá thiết bị và tự động tắt Safe Mode (nếu có).

### Lệnh hệ thống (Two-Factor Tier)
Yêu cầu vừa đúng Username vừa đúng Mật khẩu.
- `/api <password> <RequestType> [ArgsJSON]` - Gửi raw payload tuỳ ý tới MicroMDM. Vd: `/api secret123 DeviceInformation {"Queries":["BatteryLevel"]}`

## ⚠️ Lưu ý Bảo mật
- **EMERGENCY_PASSWORD** được lưu dưới dạng plaintext trong file `.env` để tiện lợi cho cá nhân. **TUYỆT ĐỐI KHÔNG** commit file `.env` lên Github hoặc chia sẻ cho người khác.
- Đảm bảo port Webhook (mặc định `6364`) chỉ cho phép MicroMDM truy cập, tránh mở public ra toàn bộ internet (hoặc nên cấu hình Web Application Firewall nếu cần thiết). Webhook đã được bảo vệ bước đầu bằng cách chặn các endpoint rác nhờ xác thực đường dẫn `/webhook/micromdm`.
