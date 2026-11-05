#!/bin/bash
# ==============================================================================
# Setup script: Khởi tạo tài khoản Admin mới (sysadmin), nạp Keychain và cài LaunchDaemon
# Chạy với quyền sudo: sudo bash agent/setup.sh
# ==============================================================================

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "❌ Script này bắt buộc phải chạy dưới quyền root: sudo bash agent/setup.sh"
   exit 1
fi

echo "=========================================================="
echo "   CÀI ĐẶT HỆ THỐNG LAPS & REMOTE AGENT CHO MACOS        "
echo "=========================================================="

ADMIN_USER="sysadmin"
TARGET_USER="blamm01"
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$CURRENT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

# Đọc cấu hình từ .env nếu có
API_KEY=""
SERVER_PORT="6364"
if [[ -f "$ENV_FILE" ]]; then
    API_KEY=$(grep -E '^LAPS_API_KEY=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"'\'' ' || true)
    if [[ -z "$API_KEY" ]]; then
        API_KEY=$(grep -E '^EMERGENCY_PASSWORD=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"'\'' ' || true)
    fi
    PORT_IN_ENV=$(grep -E '^WEBHOOK_PORT=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"'\'' ' || true)
    if [[ -n "$PORT_IN_ENV" ]]; then
        SERVER_PORT="$PORT_IN_ENV"
    fi
fi

SERVER_URL="http://192.168.1.96:$SERVER_PORT"

echo "• Tài khoản Admin mới sẽ quản lý: $ADMIN_USER"
echo "• Tài khoản người dùng sẽ hạ quyền: $TARGET_USER"
echo "• Server LAPS URL: $SERVER_URL"

if [[ -z "$API_KEY" ]]; then
    read -rsp "Nhập API Key hoặc Emergency Password của Bot: " API_KEY
    echo ""
fi

# 1. Kiểm tra tài khoản sysadmin
if id "$ADMIN_USER" &>/dev/null; then
    echo "ℹ️ Tài khoản [$ADMIN_USER] đã tồn tại trên hệ thống."
    read -rsp "Nhập mật khẩu hiện tại của [$ADMIN_USER] (để lưu vào Keychain): " INITIAL_PASSWORD
    echo ""
else
    echo "⚙️ Đang tạo tài khoản Admin mới [$ADMIN_USER]..."
    # Sinh mật khẩu ngẫu nhiên ban đầu
    INITIAL_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9!@#$%&*=' | head -c 20)
    
    echo "Vui lòng nhập mật khẩu của tài khoản [$TARGET_USER] để cấp SecureToken cho [$ADMIN_USER]:"
    read -rsp "Mật khẩu của $TARGET_USER: " TARGET_PASS
    echo ""
    
    # Tạo user admin có SecureToken (dùng IT Administrator để tránh trùng với root)
    if sysadminctl -adminUser "$TARGET_USER" -adminPassword "$TARGET_PASS" \
        -addUser "$ADMIN_USER" \
        -fullName "IT Administrator" \
        -password "$INITIAL_PASSWORD" \
        -admin; then
        
        if id "$ADMIN_USER" &>/dev/null; then
            echo "✅ Đã tạo tài khoản [$ADMIN_USER] với quyền Admin và SecureToken thành công!"
        else
            echo "❌ Lỗi: sysadminctl báo hoàn tất nhưng tài khoản [$ADMIN_USER] không tồn tại!"
            exit 1
        fi
    else
        echo "❌ Lỗi: sysadminctl tạo tài khoản thất bại! Kiểm tra mật khẩu của [$TARGET_USER]."
        exit 1
    fi
fi

# 2. Lưu mật khẩu vào macOS System Keychain
echo "🔐 Đang lưu mật khẩu khởi tạo vào System Keychain..."
security add-generic-password -U -s "LocalAdminLAPS" -a "$ADMIN_USER" -w "$INITIAL_PASSWORD" /Library/Keychains/System.keychain
echo "✅ Đã lưu vào System Keychain an toàn."

# 3. Tạo file cấu hình /etc/micromdm-agent.conf
echo "📡 Đang kiểm tra kết nối tới Server LAPS ($SERVER_URL)..."
TEST_CHECKIN=$(curl -s -k -X POST "$SERVER_URL/api/laps/checkin" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"serial\":\"TEST\",\"hostname\":\"$(hostname)\",\"adminUser\":\"$ADMIN_USER\",\"isTargetAdmin\":true,\"targetUser\":\"$TARGET_USER\",\"agentVersion\":\"1.1.0\"}" 2>/dev/null || echo "")

if [[ -z "$TEST_CHECKIN" ]]; then
    echo "⚠️ CẢNH BÁO: Không thể kết nối tới $SERVER_URL! Hãy đảm bảo bot server đang chạy và mở port."
elif echo "$TEST_CHECKIN" | grep -q '"ok":true'; then
    echo "✅ Kết nối Server và API Key hợp lệ!"
elif echo "$TEST_CHECKIN" | grep -q "Unauthorized"; then
    echo "❌ LỖI: Sai API Key hoặc Emergency Password! Server từ chối xác thực (Unauthorized)."
    exit 1
else
    echo "⚠️ Phản hồi từ server: $TEST_CHECKIN"
fi

echo "📝 Đang ghi file cấu hình /etc/micromdm-agent.conf..."
cat <<EOF > /etc/micromdm-agent.conf
SERVER_URL="$SERVER_URL"
API_KEY="$API_KEY"
ADMIN_USER="$ADMIN_USER"
TARGET_USER="$TARGET_USER"
KEYCHAIN_SERVICE="LocalAdminLAPS"
LOG_FILE="/var/log/laps-agent.log"
EOF
chmod 600 /etc/micromdm-agent.conf

# 4. Copy và phân quyền file thực thi script
echo "📦 Đang cài đặt script daemon vào /usr/local/bin/laps-agent.sh..."
mkdir -p /usr/local/bin
cp "$CURRENT_DIR/laps-agent.sh" /usr/local/bin/laps-agent.sh
chown root:wheel /usr/local/bin/laps-agent.sh
chmod 700 /usr/local/bin/laps-agent.sh

# 5. Cài đặt LaunchDaemon
echo "⚙️ Đang đăng ký LaunchDaemon..."
PLIST_PATH="/Library/LaunchDaemons/com.micromdm.laps-agent.plist"
# Dỡ bỏ daemon cũ nếu đang chạy
launchctl bootout system/com.micromdm.laps-agent 2>/dev/null || true

cp "$CURRENT_DIR/com.micromdm.laps-agent.plist" "$PLIST_PATH"
chown root:wheel "$PLIST_PATH"
chmod 644 "$PLIST_PATH"

launchctl bootstrap system "$PLIST_PATH"
echo "✅ LaunchDaemon đã được nạp thành công!"

# 6. Kích hoạt chạy ngay lần đầu
echo "🚀 Đang kích hoạt lần check-in đầu tiên..."
launchctl kickstart -k system/com.micromdm.laps-agent || true

echo ""
echo "=========================================================="
echo "🎉 HOÀN TẤT THIẾT LẬP LAPS & AGENT!"
echo "=========================================================="
echo "• Tài khoản admin mới: $ADMIN_USER"
echo "• Mật khẩu khởi tạo: $INITIAL_PASSWORD"
echo "  (Mật khẩu này đã được lưu vào System Keychain và sẽ được gửi lên Bot Server)"
echo ""
echo "Các bước tiếp theo trên Telegram Bot:"
echo "1. Mở Telegram Bot và gõ:"
echo "   /laps <emergency_password> status"
echo "   để kiểm tra xem Bot đã nhận diện được máy Mac và tài khoản sysadmin chưa."
echo ""
echo "2. Kiểm tra lấy mật khẩu qua Bot:"
echo "   /laps <emergency_password> pass"
echo ""
echo "3. Khi mọi thứ đã sẵn sàng và chắc chắn sysadmin hoạt động tốt, gõ:"
echo "   /laps <emergency_password> demote"
echo "   để hạ quyền tài khoản $TARGET_USER xuống Standard User!"
echo "=========================================================="
