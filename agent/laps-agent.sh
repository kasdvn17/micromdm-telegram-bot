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

SERVER_URL="${SERVER_URL:-http://localhost:6364}"
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
        if sysadminctl -adminUser "$ADMIN_USER" -adminPassword "$OLD_PASS" -resetPassword "$NEW_PASS" 2>/dev/null; then
            log "Đã đổi mật khẩu $ADMIN_USER thành công."
            
            # Cập nhật System Keychain
            security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$ADMIN_USER" -w "$NEW_PASS" /Library/Keychains/System.keychain 2>/dev/null || true
            echo "$NOW_TS" > "$LAST_ROTATE_FILE"
            
            # Báo cáo mật khẩu mới về Server
            curl -s -k -X POST "$SERVER_URL/api/laps/report" \
                -H "Authorization: Bearer $API_KEY" \
                -H "Content-Type: application/json" \
                -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"rotate_result\",\"success\":true,\"newPassword\":\"$NEW_PASS\"}" >/dev/null || true
        else
            log "LỖI: sysadminctl đổi mật khẩu thất bại."
            curl -s -k -X POST "$SERVER_URL/api/laps/report" \
                -H "Authorization: Bearer $API_KEY" \
                -H "Content-Type: application/json" \
                -d "{\"actionId\":\"$ACTION_ID\",\"type\":\"rotate_result\",\"success\":false,\"error\":\"sysadminctl failed\"}" >/dev/null || true
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
