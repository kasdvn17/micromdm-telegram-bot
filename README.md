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
- Codeforces task gate: mỗi break cần 1 task AC mới kể từ break trước; Focus off cần 7 task AC trong ngày, riêng Sleep Mode cần 3 task AC từ lúc phiên bắt đầu. Phiên Sleep tối Thứ 7/Chủ Nhật được một lượt break cố định 1 giờ không cần AC. Bài AC trước khi được thêm vào task list vẫn được tính theo thời gian submission thật.

## Quyền truy cập

Bot có 3 mức xác thực:

| Mức | Xác thực | Lệnh |
|---|---|---|
| Normal | `AUTHORIZED_TELEGRAM_USER_ID` nếu có, nếu không dùng username | Các lệnh thông thường, Focus, Blacklist... |
| Emergency | `EMERGENCY_PASSWORD` | Các lệnh điều khiển thiết bị |
| Two-Factor | Username chính chủ + `EMERGENCY_PASSWORD` | `/api` |

Emergency không yêu cầu đúng username; vì vậy `EMERGENCY_PASSWORD` phải được giữ bí mật.
Bot chỉ nhận command trong private chat. Message chứa Emergency password được tự xóa; sau 5 lần nhập sai, nguồn gửi bị khóa 10 phút. Nên cấu hình `AUTHORIZED_TELEGRAM_USER_ID` vì numeric ID không thay đổi khi đổi username.

## Danh sách lệnh

### Normal

```text
/focus on|off|status|remaining|extend <duration>|cancel
/focus debug
/focus <duration>
/focus break [duration] # Sleep tối T7/CN: mặc định 1h, chỉ 1 lần mỗi phiên
/focus off # cần 7 task/ngày; trong Sleep Mode cần 3 task từ lúc phiên bắt đầu
/focus schedule list
/focus schedule add <start> <end> [days]
/focus schedule enable|disable <id>
/focus schedule skip [id]
/focus blockadd <bundleId>
/focus blocklist
/focus blwadd <website>
/focus blwremove <website>
/focus blwlist

/task add <problem>
/task add bulk <problemId|url>... [--atomic]
/task list [all|archived] [tag]
/task next [tag] [minRating] [maxRating]
/task suggest [tag] [minRating] [maxRating]
/task stats
/task tag add [tag]
/task tag edit [tag]
/task tag remove [tag] [problemId]
/task tag list
/task tagedit ... # tương thích cú pháp cũ
/task remove <problemId>
/task clear [tag] CONFIRM
/task archive [problemId]
/task archive auto on|off|status
/task undo
/task status
/refresh [full]
/status
/menu

/notify on|off|test
/quote on|off|now|status
/quote snooze <duration>
/quote quiet <start> <end>|off
/blacklist add <bundleId>
/blacklist list
/blacklist blwadd <website>
/blacklist blwlist
/search <bundleId1> [bundleId2]...

/ping
/health
/whoami
/logs
/history
/auth test <password>
/help

```

`/task tag list` liệt kê theo quan hệ problem → tags. `/task tag edit <tag>` mở toàn bộ problem với dấu `✅/❌`; bấm vào problem để toggle tag. `/task tag remove <tag>` cho phép gỡ riêng từng problem hoặc xóa tag khỏi toàn bộ problem. `/task tag add` dùng Force Reply để tạo tag rỗng rồi mở ngay màn hình edit. `/task tagedit` cũ vẫn được giữ để tương thích.

Sau khi `/task add bulk` thêm được ít nhất một bài, bot hỏi có muốn gắn toàn bộ các bài vừa thêm thành công vào cùng một tag hay không. Chọn **Yes** để chọn tag hiện có hoặc tạo tag mới; chọn **No** để kết thúc interactive. Phiên chọn tag hết hạn sau 15 phút.

`/task list` được phân trang bằng inline keyboard. `/task next` chọn task active lâu nhất phù hợp bộ lọc; `/task suggest` tìm bài public chưa nằm trong task list/chưa được refresh xác nhận AC và có nút thêm từng bài hoặc thêm tất cả. `/task stats` hiển thị tiến độ 7 ngày, rating trung bình, streak và tag. Auto-archive được điều khiển bằng `/task archive auto`; `/task undo` phục hồi thay đổi task/tag gần nhất mà không rollback submission gate.

`/menu` mở dashboard với các nút Refresh, Break, Focus off, Tasks, Next task và Tags. **Break và Focus off không tự refresh:** phải bấm Refresh hoặc dùng `/refresh` trước, sau đó mới thực hiện thao tác gate.

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

Trong khoảng **22:00–05:00**, Focus tự động được bật. Vào phiên Sleep bắt đầu tối **Thứ 7 hoặc Chủ Nhật**, `/focus break` được dùng đúng một lần với thời lượng cố định **1 giờ** và không yêu cầu task AC; lượt đã dùng được lưu trong JSON nên không reset khi restart hoặc qua nửa đêm. Các phiên còn lại không thể break. Để dùng `/focus off`, cần `/refresh` xác nhận ít nhất 3 task Codeforces AC hợp lệ kể từ lúc phiên Sleep bắt đầu lúc 22:00.

Các nguồn Focus dùng chung một profile và được tính theo kiểu reference guard: recurring Focus kết thúc lúc 23:00 hoặc duration hết hạn sẽ không gỡ profile nếu Sleep Mode 22:00–05:00 vẫn đang giữ nó.

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
AUTHORIZED_TELEGRAM_USER_ID=123456789
AUTHORIZED_TELEGRAM_CHAT_ID=
EMERGENCY_PASSWORD=mat_khau_bi_mat

MICROMDM_URL=https://mdm.yourdomain.com
MICROMDM_API_KEY=api_key_cua_micromdm
WEBHOOK_PORT=6364
WEBHOOK_PATH=/webhook/micromdm

DEVICE_UUID=udid_thiet_bi_ios
```

Các biến bắt buộc để bot khởi động gồm `DEVICE_UUID`, `TELEGRAM_BOT_TOKEN`, `AUTHORIZED_TELEGRAM_USERNAME`, `EMERGENCY_PASSWORD`, `MICROMDM_URL` và `MICROMDM_API_KEY`. `AUTHORIZED_TELEGRAM_USER_ID` và `AUTHORIZED_TELEGRAM_CHAT_ID` không bắt buộc. Khi có user ID, bot ưu tiên xác thực bằng ID; nếu chat ID trống, bot bind chat riêng sau tin nhắn đầu tiên từ tài khoản được uỷ quyền.

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
bun run test
```

## Codeforces utility

Các hàm trong `src/utils/codeforces.ts` chỉ dùng API anonymous nên chỉ đọc dữ liệu public. Client tự phân trang và giữ khoảng cách tối thiểu 2 giây giữa các request theo [giới hạn API chính thức của Codeforces](https://codeforces.com/apiHelp).

```ts
import {
  fetchAllUserSubmissions,
  getCodeforcesProblemRating,
  hasUserSolvedPublicProblem,
} from "./utils/codeforces";

const submissions = await fetchAllUserSubmissions("tourist");
const solved = await hasUserSolvedPublicProblem("tourist", 4, "A");
const difficulty = await getCodeforcesProblemRating(4, "A");
```

`hasUserSolvedPublicProblem()` chỉ trả `true` khi bài vẫn có trong problemset public và user có submission với `verdict === "OK"` cho đúng `contestId` và `index`.

`getCodeforcesProblemRating()` ưu tiên rating chính thức từ Codeforces. Nếu API chưa có rating, hàm dùng dataset JSON công khai của [Codeforces Problems](https://github.com/kira924age/CodeforcesProblems), cache 1 giờ và trả nguồn `kira`; nếu cả hai nguồn đều thiếu thì trả `source: "unrated"`. Dataset này cũng cung cấp metadata fallback khi `problemset.problems` bỏ sót các bài archive vẫn tồn tại, như `1350C`. `/task add` và `/task list` hiển thị difficulty kèm nguồn.

Đặt `CODEFORCES_HANDLE` trong `.env`, sau đó dùng `/task add <problem>` (hỗ trợ mã, URL hoặc đúng tên bài). `/task add bulk` nhận mã/URL cách nhau bằng khoảng trắng hoặc dấu phẩy; thêm `--atomic` để nếu một bài lỗi thì không thêm bài nào. Sau bulk, bot cho phép gắn các bài vừa thêm thành công vào một tag chung. Chỉ bài có rating xác định và **từ 1600 trở lên** mới được thêm; rating chính thức và rating external Kira đều hợp lệ. Mỗi problem có thể chứa nhiều tag qua `/task tag`; `/task list` chỉ hiện task active chưa archive, còn `all` hiện cả task đã AC. Bài đã AC trước khi `/task add` vẫn được tính bình thường. `/refresh` dùng cache tăng dần; `/refresh full` hoặc full-sync tự động mỗi 24 giờ sẽ quét toàn bộ lịch sử. `solvedAt` luôn lấy submission `OK` đầu tiên, không lấy thời điểm refresh. Mỗi lần `/focus break` cần 1 task có `solvedAt` sau lần break trước. Ngoài Sleep Mode, `/focus off` cần 7 task có `solvedAt` trong ngày hiện tại; trong Sleep Mode, cần 3 task có `solvedAt` từ lúc phiên bắt đầu.

Trong Sleep Mode (22:00–05:00), `/focus off` đếm từ đúng 22:00 của phiên, kể cả sau khi qua nửa đêm, và tắt Sleep Mode cho phần còn lại của phiên hiện tại. Gate ngoài Sleep tự reset khi sang ngày mới.

## Danh ngôn mỗi giờ

Bot gửi một câu trong danh sách cục bộ sau mỗi 60 phút kể từ lúc khởi động. Không có tin nhắn gửi ngay lúc boot và mỗi interval chỉ gửi một câu. Có thể đổi chu kỳ bằng `QUOTE_INTERVAL_MS`; `/notify off` cũng tạm dừng toàn bộ notification. `/quote` có thể bật/tắt riêng, snooze hoặc đặt quiet hours; thiết lập được lưu trong `data/quote-settings.json`.

## Dữ liệu

Bot lưu trạng thái bằng JSON trong `data/`, gồm:

- `blacklist.json` — app blacklist.
- `restricted-apps.json` — app bị chặn bởi Focus/Safe Mode.
- `sensitive_apps.json` — danh sách app Safe Mode.
- `schedule.json` — Focus schedule.
- `history.json` — lịch sử sự kiện.
- `mark-lost-state.json` — trạng thái Mark Lost.
- `codeforces-tasks.json` — task Codeforces active/đã AC theo Telegram user ID.
- `quote-settings.json` — trạng thái, snooze và quiet hours của danh ngôn.
- Mỗi JSON state quan trọng có file `.bak` để phục hồi khi file chính bị hỏng.
- `logs/` — log theo ngày.

## Bảo mật

- Không commit `.env` thật lên Git.
- Nên đặt `AUTHORIZED_TELEGRAM_USER_ID`; bot chỉ xử lý command trong private chat.
- Emergency message chứa password được tự xóa và có rate limit thử sai.
- Giữ `EMERGENCY_PASSWORD` và token dịch vụ ở nơi an toàn.
- Chỉ cho phép MicroMDM truy cập webhook port nếu có thể.
- `/api` chỉ nên được dùng khi thực sự cần gửi command MDM trực tiếp.
