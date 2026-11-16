#!/usr/bin/env bash
# Sora Admin Panel — masaüstü kurulumu
# Eski "Sora Arka Plan İnceleme" başlatıcılarını "Sora Admin Panel" ile değiştirir.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_APP="$SCRIPT_DIR/sora_admin_panel.py"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
DESKTOP_NAME="sora-admin-panel.desktop"
OLD_DESKTOP_NAME="sora-background-review.desktop"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/sora-admin-panel"
LEGACY_INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/sora-background-review"
APP="$INSTALL_DIR/sora_admin_panel.py"

if [ ! -f "$SOURCE_APP" ]; then
  echo "Hata: $SOURCE_APP bulunamadı." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
install -m 755 "$SOURCE_APP" "$APP"

# Simge kopyala
ICON="utilities-system-monitor"
for candidate in \
  "$REPO_ROOT/assets/images/sora-logo-blue.png" \
  "$REPO_ROOT/assets/images/sora-logo.png" \
  "$LEGACY_INSTALL_DIR/sora-logo.png" \
  "/home/omer/Uygulama/assets/images/sora-logo-blue.png" \
  "/home/omer/Uygulama/assets/images/sora-logo.png"; do
  if [ -f "$candidate" ]; then
    install -m 644 "$candidate" "$INSTALL_DIR/sora-logo.png"
    ICON="$INSTALL_DIR/sora-logo.png"
    break
  fi
done

# Eski yapılandırmayı ve oturumu taşı (şifre tekrar girilmesin)
CFG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
mkdir -p -m 700 "$CFG_BASE/sora-admin-panel"
for fname in config.env session.json prefs.json; do
  if [ -f "$CFG_BASE/sora-background-review/$fname" ] && [ ! -f "$CFG_BASE/sora-admin-panel/$fname" ]; then
    cp -p "$CFG_BASE/sora-background-review/$fname" "$CFG_BASE/sora-admin-panel/$fname"
    chmod 600 "$CFG_BASE/sora-admin-panel/$fname"
  fi
done

# Eski yol çağrılırsa yeni Sora Admin Panel açılsın
if [ -d "$LEGACY_INSTALL_DIR" ]; then
  cat > "$LEGACY_INSTALL_DIR/sora_background_review.py" <<EOF
#!/usr/bin/env bash
exec "$APP" "\$@"
EOF
  chmod 755 "$LEGACY_INSTALL_DIR/sora_background_review.py"
fi

escape_exec() {
  printf '%s' "$1" | sed -e 's/\\/\\\\\\\\/g' -e 's/"/\\\\"/g' -e 's/`/\\\\`/g' -e 's/\$/\\\\$/g'
}
EXEC_PATH="$(escape_exec "$APP")"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS_DIR"
rm -f "$APPS_DIR/$OLD_DESKTOP_NAME"
DESKTOP_FILE="$APPS_DIR/$DESKTOP_NAME"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Sora Admin Panel
Comment=Sora Voice kullanıcı, coin, ban, oda, aile, rapor ve arka plan yönetim paneli
Exec="$EXEC_PATH"
Icon=$ICON
Terminal=false
Categories=Utility;
Keywords=Sora;admin;panel;ban;coin;oda;aile;
StartupNotify=true
StartupWMClass=com.sora.AdminPanel
EOF
chmod 755 "$DESKTOP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

for dir_candidate in "$HOME/Desktop" "$HOME/Masaüstü"; do
  if [ -d "$dir_candidate" ]; then
    rm -f "$dir_candidate/$OLD_DESKTOP_NAME"
  fi
done

DESKTOP_DIR=""
if command -v xdg-user-dir >/dev/null 2>&1; then
  DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
fi
if [ -z "$DESKTOP_DIR" ] || [ "$DESKTOP_DIR" = "$HOME" ] || [ ! -d "$DESKTOP_DIR" ]; then
  DESKTOP_DIR=""
  for candidate in "$HOME/Desktop" "$HOME/Masaüstü"; do
    if [ -d "$candidate" ]; then
      DESKTOP_DIR="$candidate"
      break
    fi
  done
fi

if [ -n "$DESKTOP_DIR" ]; then
  TARGET="$DESKTOP_DIR/$DESKTOP_NAME"
  cp "$DESKTOP_FILE" "$TARGET"
  chmod 755 "$TARGET"
  if command -v gio >/dev/null 2>&1; then
    gio set "$TARGET" metadata::trusted true >/dev/null 2>&1 || true
  fi
  echo "Masaüstü başlatıcısı güncellendi: $TARGET"
fi

echo "Kurulum tamamlandı: Sora Admin Panel ($APP)"
