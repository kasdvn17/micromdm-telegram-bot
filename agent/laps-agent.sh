#!/bin/bash
# ==============================================================================
# MicroMDM LAPS & Remote Agent for macOS
# Quản lý tài khoản Admin, xoay mật khẩu, và nhận lệnh điều khiển từ Telegram Bot
# ==============================================================================

set -uo pipefail

CONF_FILE="/etc/micromdm-agent.conf"
if [[ -f "$CONF_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$CONF_FILE"
fi

SERVER_URL="${SERVER_URL:-http://192.168.1.96:6364}"
API_KEY="${API_KEY:-}"
ADMIN_USER="${ADMIN_USER:-sysadmin}"
TARGET_USER="${TARGET_USER:-blamm01}"
KEYCHAIN_SERVICE="${KEYCHAIN_SERVICE:-LocalAdminLAPS}"
LOG_FILE="${LOG_FILE:-/var/log/laps-agent.log}"
STATE_DIR="/var/run/micromdm-laps"
LAST_ROTATE_FILE="$STATE_DIR/last_rotate.time"
ELEVATE_EXPIRE_FILE="$STATE_DIR/elevate.expire"
AGENT_VERSION="1.1.0"

mkdir -p "$STATE_DIR"
exec >> "$LOG_FILE" 2>&1

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 1. Thu thập thông tin thiết bị
SERIAL=$(ioreg -c IOPlatformExpertDevice -d 2 2>/dev/null | awk -F\" '/IOPlatformSerialNumber/{print $(NF-1)}')
if [[ -z "$SERIAL" ]]; then
    SERIAL=$(system_profiler SPHardwareDataType 2>/dev/null | awk '/Serial Number/ {print $4}')
fi
HOSTNAME=$(hostname -s 2>/dev/null || hostname)
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")

# Kiểm tra xem user target (blamm01) có đang thuộc group admin không
IS_ADMIN="false"
if dseditgroup -o checkmember -m "$TARGET_USER" admin 2>/dev/null | grep -q "yes"; then
    IS_ADMIN="true"
fi

# 2. Kiểm tra quyền Admin tạm thời (Elevation expiration)
if [[ -f "$ELEVATE_EXPIRE_FILE" ]]; then
    EXPIRE_TIME=$(cat "$ELEVATE_EXPIRE_FILE")
    NOW=$(date +%s)
    if [[ "$NOW" -ge "$EXPIRE_TIME" ]]; then
        log "Quyền Admin tạm thời của $TARGET_USER đã hết hạn. Đang thu hồi quyền..."
        dseditgroup -o edit -d "$TARGET_USER" -t user admin 2>/dev/null || true
        rm -f "$ELEVATE_EXPIRE_FILE"
        IS_ADMIN="false"
        
        # Báo cáo về server
        curl -s -k -X POST "$SERVER_URL/api/laps/report" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"demote_result\",\"success\":true,\"output\":\"Quyền admin tạm thời của $TARGET_USER đã tự động hết hạn.\"}" >/dev/null || true
    fi
fi

# 3. Gửi Check-in lên Server
CHECKIN_PAYLOAD=$(cat <<EOF
{
  "serial": "$SERIAL",
  "hostname": "$HOSTNAME",
  "ip": "$IP",
  "adminUser": "$ADMIN_USER",
  "isTargetAdmin": $IS_ADMIN,
  "targetUser": "$TARGET_USER",
  "agentVersion": "$AGENT_VERSION"
}
EOF
)

CHECKIN_RESP=$(curl -s -k -X POST "$SERVER_URL/api/laps/checkin" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$CHECKIN_PAYLOAD" 2>/dev/null || true)

if [[ -z "$CHECKIN_RESP" ]]; then
    log "Không thể kết nối đến server LAPS tại $SERVER_URL"
    exit 0
fi

if echo "$CHECKIN_RESP" | grep -q '"error"'; then
    log "LỖI từ server LAPS: $CHECKIN_RESP"
    exit 0
fi

log "Check-in thành công tới $SERVER_URL (blamm01 is admin: $IS_ADMIN)"

# 3.1. Báo cáo mật khẩu khởi tạo nếu chưa từng báo
INITIAL_REPORT_FLAG="$STATE_DIR/initial_reported.flag"
if [[ ! -f "$INITIAL_REPORT_FLAG" ]]; then
    CURR_PASS=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$ADMIN_USER" -w /Library/Keychains/System.keychain 2>/dev/null || echo "")
    if [[ -n "$CURR_PASS" ]]; then
        log "Gửi mật khẩu khởi tạo của $ADMIN_USER lên server..."
        curl -s -k -X POST "$SERVER_URL/api/laps/report" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"initial_password\",\"success\":true,\"newPassword\":\"$CURR_PASS\"}" >/dev/null || true
        touch "$INITIAL_REPORT_FLAG"
    fi
fi

# 4. Kiểm tra xem có cần xoay mật khẩu không
DO_ROTATE=false
ACTION_ID=""

# Kiểm tra lệnh rotate từ server
if echo "$CHECKIN_RESP" | grep -q '"type":"rotate_now"'; then
    DO_ROTATE=true
    ACTION_ID=$(echo "$CHECKIN_RESP" | awk -F'"id":"' '{print $2}' | awk -F'"' '{print $1}')
fi

# Kiểm tra chu kỳ tự động (24h = 86400s)
NOW_TS=$(date +%s)
if [[ ! -f "$LAST_ROTATE_FILE" ]]; then
    echo "$NOW_TS" > "$LAST_ROTATE_FILE"
else
    LAST_ROTATE_TS=$(cat "$LAST_ROTATE_FILE" 2>/dev/null || echo 0)
    DIFF=$((NOW_TS - LAST_ROTATE_TS))
    if [[ "$DIFF" -ge 86400 ]]; then
        DO_ROTATE=true
    fi
fi

# Thực hiện xoay mật khẩu nếu cần
if [[ "$DO_ROTATE" == "true" ]]; then
    log "Bắt đầu quy trình xoay mật khẩu cho $ADMIN_USER..."
    
    # Lấy mật khẩu cũ từ System Keychain
    OLD_PASS=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$ADMIN_USER" -w /Library/Keychains/System.keychain 2>/dev/null || echo "")
    
    if [[ -z "$OLD_PASS" ]]; then
        log "LỖI: Không tìm thấy mật khẩu hiện tại trong System Keychain! Hãy kiểm tra cài đặt ban đầu."
        curl -s -k -X POST "$SERVER_URL/api/laps/report" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"rotate_result\",\"success\":false,\"error\":\"Không tìm thấy mật khẩu trong System Keychain\"}" >/dev/null || true
    else
        # Sinh mật khẩu ngẫu nhiên mạnh
        NEW_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9!@#$%&*=' | head -c 20)
        
        # Đổi mật khẩu qua sysadminctl để giữ SecureToken
        ROTATE_OUTPUT=$(sysadminctl -adminUser "$ADMIN_USER" -adminPassword "$OLD_PASS" -resetPasswordFor "$ADMIN_USER" -newPassword "$NEW_PASS" 2>&1 || true)
        log "sysadminctl output: $ROTATE_OUTPUT"
        
        # Xác thực chắc chắn mật khẩu đã được đổi thành công trên hệ thống
        if dscl /Local/Default -authonly "$ADMIN_USER" "$NEW_PASS" >/dev/null 2>&1; then
            log "Đã đổi và xác thực mật khẩu $ADMIN_USER thành công."
            
            # Cập nhật System Keychain
            security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$ADMIN_USER" -w "$NEW_PASS" /Library/Keychains/System.keychain 2>/dev/null || true
            echo "$NOW_TS" > "$LAST_ROTATE_FILE"
            
            # Báo cáo mật khẩu mới về Server
            curl -s -k -X POST "$SERVER_URL/api/laps/report" \
                -H "Authorization: Bearer $API_KEY" \
                -H "Content-Type: application/json" \
                -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"rotate_result\",\"success\":true,\"newPassword\":\"$NEW_PASS\"}" >/dev/null || true
        else
            log "LỖI: sysadminctl đổi mật khẩu thất bại hoặc xác thực không khớp!"
            curl -s -k -X POST "$SERVER_URL/api/laps/report" \
                -H "Authorization: Bearer $API_KEY" \
                -H "Content-Type: application/json" \
                -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"rotate_result\",\"success\":false,\"error\":\"Xác thực mật khẩu mới thất bại: $ROTATE_OUTPUT\"}" >/dev/null || true
        fi
    fi
fi

# 5. Xử lý các lệnh khác từ Server (Demote, Elevate, Exec)
if echo "$CHECKIN_RESP" | grep -q '"type":"demote"'; then
    ACTION_ID=$(echo "$CHECKIN_RESP" | awk -F'"id":"' '{print $2}' | awk -F'"' '{print $1}')
    log "Nhận lệnh hạ quyền $TARGET_USER xuống Standard User..."
    if dseditgroup -o edit -d "$TARGET_USER" -t user admin 2>/dev/null; then
        log "Đã hạ quyền $TARGET_USER thành công."
        curl -s -k -X POST "$SERVER_URL/api/laps/report" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"demote_result\",\"success\":true}" >/dev/null || true
    else
        log "LỖI: Không thể gỡ $TARGET_USER khỏi admin group."
        curl -s -k -X POST "$SERVER_URL/api/laps/report" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"demote_result\",\"success\":false,\"error\":\"dseditgroup failed\"}" >/dev/null || true
    fi
fi

if echo "$CHECKIN_RESP" | grep -q '"type":"elevate"'; then
    ACTION_ID=$(echo "$CHECKIN_RESP" | awk -F'"id":"' '{print $2}' | awk -F'"' '{print $1}')
    MINUTES=$(echo "$CHECKIN_RESP" | awk -F'"durationMinutes":' '{print $2}' | awk -F'[,}]' '{print $1}' | tr -dc '0-9')
    if [[ -z "$MINUTES" || "$MINUTES" -le 0 ]]; then
        MINUTES=30
    fi
    log "Nhận lệnh nâng quyền Admin tạm thời cho $TARGET_USER trong $MINUTES phút..."
    if dseditgroup -o edit -a "$TARGET_USER" -t user admin 2>/dev/null; then
        NOW=$(date +%s)
        EXPIRE=$((NOW + MINUTES * 60))
        echo "$EXPIRE" > "$ELEVATE_EXPIRE_FILE"
        log "Đã cấp quyền admin cho $TARGET_USER đến $(date -r "$EXPIRE")."
        curl -s -k -X POST "$SERVER_URL/api/laps/report" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"elevate_result\",\"success\":true,\"output\":\"Đã cấp quyền Admin trong $MINUTES phút\"}" >/dev/null || true
    else
        log "LỖI: Không thể thêm $TARGET_USER vào admin group."
        curl -s -k -X POST "$SERVER_URL/api/laps/report" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"elevate_result\",\"success\":false,\"error\":\"dseditgroup failed\"}" >/dev/null || true
    fi
fi

if echo "$CHECKIN_RESP" | grep -q '"type":"exec"'; then
    ACTION_ID=$(echo "$CHECKIN_RESP" | awk -F'"id":"' '{print $2}' | awk -F'"' '{print $1}')
    CMD=$(echo "$CHECKIN_RESP" | awk -F'"command":"' '{print $2}' | awk -F'"' '{print $1}')
    log "Nhận lệnh thực thi từ xa: $CMD"
    OUTPUT=$(eval "$CMD" 2>&1 || true)
    # Escape output cho JSON
    ESCAPED_OUTPUT=$(echo "$OUTPUT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"$OUTPUT\"")
    curl -s -k -X POST "$SERVER_URL/api/laps/report" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"exec_result\",\"success\":true,\"output\":$ESCAPED_OUTPUT}" >/dev/null || true
fi

# 6. Quản lý Focus Blocked Websites trên macOS qua /etc/hosts
if echo "$CHECKIN_RESP" | grep -q '"focus"'; then
    HOSTS_OUTPUT=$(python3 -c '
import sys, json, os, re, subprocess

try:
    resp = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)

focus = resp.get("focus")
if not focus:
    sys.exit(0)

active = bool(focus.get("active", False))
raw_websites = focus.get("websites", [])
if not isinstance(raw_websites, list):
    raw_websites = []

hosts_path = "/etc/hosts"
try:
    with open(hosts_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
except Exception as e:
    print(f"LỖI đọc {hosts_path}: {e}")
    sys.exit(0)

# Xoá khối quản lý cũ (nếu có)
cleaned = re.sub(
    r"\n*# BEGIN MICROMDM FOCUS BLOCKED WEBSITES[\s\S]*?# END MICROMDM FOCUS BLOCKED WEBSITES\n*",
    "\n",
    content
).strip() + "\n"

new_content = cleaned

if active and raw_websites:
    domains = set()
    for w in raw_websites:
        if not isinstance(w, str):
            continue
        w = w.strip().lower()
        if not w:
            continue
        w = re.sub(r"^https?://", "", w)
        w = w.split("/")[0].split(":")[0]
        domains.add(w)
        if not w.startswith("www."):
            domains.add("www." + w)
        if w == "x.com":
            domains.update(["api.x.com", "mobile.x.com", "m.x.com", "twitter.com", "www.twitter.com"])
        elif w == "tiktok.com":
            domains.update(["m.tiktok.com", "v.tiktok.com"])

    if domains:
        sorted_domains = sorted(domains)
        block_lines = ["\n# BEGIN MICROMDM FOCUS BLOCKED WEBSITES"]
        for d in sorted_domains:
            block_lines.append(f"127.0.0.1\t{d}")
        for d in sorted_domains:
            block_lines.append(f"::1\t{d}")
        block_lines.append("# END MICROMDM FOCUS BLOCKED WEBSITES\n")
        new_content = cleaned.rstrip() + "\n" + "\n".join(block_lines)

if new_content != content:
    tmp_path = "/etc/hosts.tmp." + str(os.getpid())
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, hosts_path)
        subprocess.run(["dscacheutil", "-flushcache"], capture_output=True)
        subprocess.run(["killall", "-HUP", "mDNSResponder"], capture_output=True)
        status_msg = f"BẬT (chặn {len(raw_websites)} website)" if (active and raw_websites) else "TẮT (đã gỡ chặn)"
        print(f"Cập nhật /etc/hosts: Focus {status_msg}")
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        print(f"LỖI ghi {hosts_path}: {e}")
' "$CHECKIN_RESP" 2>&1 || true)
    if [[ -n "$HOSTS_OUTPUT" ]]; then
        log "$HOSTS_OUTPUT"
    fi
fi

# Tự động cập nhật StartInterval xuống 15 giây nếu đang là 120 giây
PLIST_FILE="/Library/LaunchDaemons/com.micromdm.laps-agent.plist"
if [[ -f "$PLIST_FILE" ]] && grep -q '<integer>120</integer>' "$PLIST_FILE"; then
    log "Cập nhật StartInterval trong $PLIST_FILE từ 120s xuống 15s..."
    sed -i '' 's/<integer>120<\/integer>/<integer>15<\/integer>/g' "$PLIST_FILE" 2>/dev/null || true
fi
