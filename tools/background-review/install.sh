#!/usr/bin/env bash
# Sora Arka Plan İnceleme — masaüstü kurulumu
# Uygulama menüsüne ve masaüstüne bir başlatıcı ekler. Yeniden çalıştırmak güvenlidir.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_APP="$SCRIPT_DIR/sora_background_review.py"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
DESKTOP_NAME="sora-background-review.desktop"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/sora-background-review"
APP="$INSTALL_DIR/sora_background_review.py"

if [ ! -f "$SOURCE_APP" ]; then
  echo "Hata: $SOURCE_APP bulunamadı." >&2
  exit 1
fi

if ! python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk' 2>/dev/null; then
  echo "Uyarı: python3 için GTK 3 (PyGObject) bulunamadı. Örn: sudo apt install python3-gi gir1.2-gtk-3.0" >&2
fi

mkdir -p "$INSTALL_DIR"
install -m 755 "$SOURCE_APP" "$APP"

# Simge: depo kökündeki logoyu kullan (klasör ana projeye taşınsa da çalışır)
ICON="image-x-generic"
for candidate in "$REPO_ROOT/assets/images/sora-logo-blue.png" "$REPO_ROOT/assets/images/sora-logo.png"; do
  if [ -f "$candidate" ]; then
    install -m 644 "$candidate" "$INSTALL_DIR/sora-logo.png"
    ICON="$INSTALL_DIR/sora-logo.png"
    break
  fi
done

# Desktop Entry "Exec" için tırnak içi kaçış: \ " ` $
escape_exec() {
  printf '%s' "$1" | sed -e 's/\\/\\\\\\\\/g' -e 's/"/\\\\"/g' -e 's/`/\\\\`/g' -e 's/\$/\\\\$/g'
}
EXEC_PATH="$(escape_exec "$APP")"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS_DIR"
DESKTOP_FILE="$APPS_DIR/$DESKTOP_NAME"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Sora Arka Plan İnceleme
Comment=Sora Voice oda arka plan isteklerini incele ve onayla
Exec="$EXEC_PATH"
Icon=$ICON
Terminal=false
Categories=Utility;
Keywords=Sora;arka plan;background;admin;
StartupNotify=true
StartupWMClass=com.sora.BackgroundReview
EOF
chmod 755 "$DESKTOP_FILE"
echo "Uygulama menüsü başlatıcısı: $DESKTOP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

# Masaüstü klasörünü bul
DESKTOP_DIR=""
if command -v xdg-user-dir >/dev/null 2>&1; then
  DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
fi
if [ -z "$DESKTOP_DIR" ] || [ "$DESKTOP_DIR" = "$HOME" ] || [ ! -d "$DESKTOP_DIR" ]; then
  DESKTOP_DIR=""
  for candidate in "$HOME/Masaüstü" "$HOME/Desktop"; do
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
  echo "Masaüstü başlatıcısı: $TARGET"
  echo "(Simge 'güvenilmiyor' görünürse sağ tıklayıp 'Başlatmaya İzin Ver' seçin.)"
else
  echo "Masaüstü klasörü bulunamadı; yalnızca uygulama menüsüne eklendi."
fi

echo "Kurulum tamam. Uygulamayı menüden 'Sora Arka Plan İnceleme' ile ya da doğrudan şu komutla açabilirsiniz:"
echo "  $APP"
