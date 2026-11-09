# Indirilen APK'yi bagli Android cihaza kurup acar.
#
# Kullanim:
#   powershell -ExecutionPolicy Bypass -File scripts\install-apk.ps1 -Apk "C:\yol\sora.apk"
#
# Not: Telefonda "USB hata ayiklama" acik olmali ve "Bilinmeyen kaynaklardan
# yuklemeye izin ver" (bagli PC icin) onaylanmis olmalidir.

param(
    [Parameter(Mandatory = $true)]
    [string]$Apk,
    [switch]$CleanInstall
)

$ErrorActionPreference = "Stop"
$packageName = "com.arescan.soravoice"

$adbCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"),
    (Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"),
    (Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe")
) | Where-Object { $_ -and (Test-Path $_) }

$adb = $adbCandidates | Select-Object -First 1

if (-not $adb) {
    Write-Host "adb bulunamadi. Android SDK platform-tools kurulu mu?" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $Apk)) {
    Write-Host "APK bulunamadi: $Apk" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== APK Kurulumu ===" -ForegroundColor Cyan
Write-Host "Dosya: $Apk" -ForegroundColor Gray
Write-Host ("Boyut: {0:N1} MB" -f ((Get-Item $Apk).Length / 1MB)) -ForegroundColor Gray
Write-Host ""

# 1) Cihaz kontrolu
$devices = & $adb devices | Select-String "device$" | ForEach-Object { ($_ -split "\s")[0] }
if (-not $devices) {
    Write-Host "Bagli Android cihaz yok." -ForegroundColor Red
    Write-Host "Telefonda USB hata ayiklama acik mi ve kabloyu bildirim modunda taktin mi?" -ForegroundColor Yellow
    exit 1
}
Write-Host "[1/4] Bagli cihaz: $($devices -join ', ')" -ForegroundColor Green

# 2) Onceki uygulamayi kaldir (imza/anahtar degistiyse gerekir)
if ($CleanInstall) {
    Write-Host "[2/4] Mevcut uygulama kaldiriliyor..." -ForegroundColor Yellow
    & $adb uninstall $packageName 2>&1 | Out-Null
    Write-Host "      Kaldirildi (veriler de silindi)." -ForegroundColor Gray
} else {
    Write-Host "[2/4] Mevcut uygulama uzerine kurulacak." -ForegroundColor Gray
}

# 3) Kurulum
Write-Host "[3/4] Kuruluyor..." -ForegroundColor Green
$installOutput = & $adb install -r -d $Apk 2>&1
$installOutput | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }

if ($installOutput -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match") {
    Write-Host ""
    Write-Host "IMZA UYUŞMUYOR: Cihazdaki eski APK farkli bir anahtarla imzalanmis." -ForegroundColor Red
    Write-Host "Once kaldirip yeniden kurun:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\install-apk.ps1 -Apk `"$Apk`" -CleanInstall" -ForegroundColor Yellow
    exit 2
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Kurulum basarisiz (cikis kodu $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}
Write-Host "[3/4] Kuruldu." -ForegroundColor Green

# 4) Uygulamayi ac ve surumu dogrula
Write-Host "[4/4] Uygulama baslatiliyor..." -ForegroundColor Green
& $adb shell monkey -p $packageName -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
Start-Sleep -Seconds 3

$version = (& $adb shell dumpsys package $packageName 2>$null | Select-String "versionCode=" | Select-Object -First 1) -replace '.*versionCode=(\d+).*', '$1'
if ($version) {
    Write-Host "      Kurulu surum kodu: $version" -ForegroundColor Gray
}

$running = & $adb shell pidof $packageName 2>$null
if ($running) {
    Write-Host "      Uygulama CALISIYOR (PID $($running.Trim()))" -ForegroundColor Green
} else {
    Write-Host "      Uygulama calismiyor - cokmus olabilir. Log icin:" -ForegroundColor Red
    Write-Host "      & `"$adb`" logcat -d -t 200 | Select-String 'FATAL EXCEPTION' -Context 0,15" -ForegroundColor Yellow
    exit 3
}

Write-Host ""
Write-Host "Kurulum tamamlandi." -ForegroundColor Cyan
Write-Host ""