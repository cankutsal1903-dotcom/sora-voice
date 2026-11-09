#!/usr/bin/env bash
# Yerel imzali release APK uretir (EAS ve GitHub kullanmadan).
#
# Android Studio'nun JDK'sini kullanir; sistemdeki Java 8 Gradle icin yetersiz.
# Imzalama bilgileri credentials.json'dan okunur, ekrana basilmaz.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGNING_ENV="${TMPDIR:-/tmp}/sora-signing.env"

echo ""
echo "=== Yerel Release APK Derlemesi ==="
echo ""

# 1) JDK secimi
JBR="/c/Program Files/Android/Android Studio/jbr"
if [ -x "$JBR/bin/java.exe" ] || [ -x "$JBR/bin/java" ]; then
  export JAVA_HOME="$JBR"
  echo "[1/3] JDK: Android Studio JBR"
else
  echo "[1/3] Android Studio JBR bulunamadi; sistem Java'si denenecek"
fi

# 2) Imzalama bilgileri
if [ ! -f "$SIGNING_ENV" ]; then
  echo "      Imzalama dosyasi yok, uretiliyor..."
  node "$ROOT/scripts/write-signing-env.js" >/dev/null
fi
# shellcheck disable=SC1090
set -a; . "$SIGNING_ENV"; set +a
echo "[2/3] Imzalama anahtari hazir"

# 3) Derleme
echo "[3/3] Gradle calisiyor (ilk derleme uzun surebilir)..."
echo ""
cd "$ROOT/android"
./gradlew :app:assembleRelease --no-daemon --console=plain

echo ""
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK" ]; then
  echo "APK hazir: $APK"
  ls -lh "$APK"
else
  echo "APK uretilmedi!" >&2
  exit 1
fi