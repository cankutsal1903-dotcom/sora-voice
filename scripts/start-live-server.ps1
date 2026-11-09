# Sora token sunucusunu canli test icin baslatir.
#
# Yaptiklari:
#   1. Windows guvenlik duvarinda 3001 portunu yerel aga acar (yonetici gerekir)
#   2. Bilgisayarin guncel LAN IP'sini gosterir
#   3. Token sunucusunu baslatir
#
# Kullanim: powershell -ExecutionPolicy Bypass -File scripts\start-live-server.ps1

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 3001
$ruleName = "Sora Token Server $port"

Write-Host ""
Write-Host "=== Sora Token Sunucusu ===" -ForegroundColor Cyan
Write-Host ""

$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Guvenlik duvari kurallari yonetici yetkisi ister. Yetki yoksa betik kendini
# yonetici olarak yeniden baslatir; Windows UAC onayi ister.
if (-not $isAdmin -and -not $env:SORA_ELEVATED) {
    Write-Host "Yonetici yetkisi gerekiyor (guvenlik duvari kurallari icin)." -ForegroundColor Yellow
    Write-Host "Yeni bir pencere acilacak. UAC uyarisinda 'Evet' secin." -ForegroundColor Yellow
    Write-Host ""
    $env:SORA_ELEVATED = "1"
    try {
        Start-Process -FilePath "powershell.exe" `
          -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"") `
          -Verb RunAs -ErrorAction Stop
        Write-Host "Yonetici penceresi acildi. Bu pencereyi kapatabilirsiniz." -ForegroundColor Green
        Start-Sleep -Seconds 2
        exit 0
    } catch {
        Write-Host "Yonetici olarak baslatilamadi (UAC reddedildi olabilir)." -ForegroundColor Red
        Write-Host "Sunucular yine de baslatilacak, ancak TELEFONDAN ERISILEMEZ." -ForegroundColor Yellow
        Write-Host ""
    }
}

# Aktif ag profili: Windows agi "Public" olarak isaretlerse yalnizca Private
# kurali ise yaramaz. Kurali mevcut profile gore olusturuyoruz.
$netCategory = (Get-NetConnectionProfile -ErrorAction SilentlyContinue |
    Select-Object -First 1).NetworkCategory
if ($netCategory -eq "Public") {
    $fwProfile = "Private,Public"
    Write-Host "UYARI: Aktif ag 'Public' olarak isaretli." -ForegroundColor Yellow
    Write-Host "       Kural hem Ozel hem Genel profil icin eklenecek." -ForegroundColor Yellow
    Write-Host ""
} else {
    $fwProfile = "Private"
}

# 1) Guvenlik duvari kurali
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($existingRule) {
    Write-Host "[1/4] Guvenlik duvari kurali zaten var: $ruleName" -ForegroundColor Green
    $existingProfiles = ($existingRule | Get-NetFirewallProfile).Name -join ","
    if ($netCategory -eq "Public" -and $existingProfiles -notmatch "Public") {
        Write-Host "      Ancak kural Public profili kapsamiyor. Guncelleniyor..." -ForegroundColor Yellow
        if ($isAdmin) {
            Set-NetFirewallRule -DisplayName $ruleName -Profile Private,Public
            Write-Host "      Kural guncellendi." -ForegroundColor Green
        } else {
            Write-Host "      Yonetici yetkisi gerekli." -ForegroundColor Red
        }
    }
} elseif ($isAdmin) {
    New-NetFirewallRule -DisplayName $ruleName `
      -Direction Inbound -Protocol TCP -LocalPort $port `
      -Action Allow -Profile $fwProfile -Description "Sora mobil uygulama token sunucusu" | Out-Null
    Write-Host "[1/4] Guvenlik duvari kurali eklendi: TCP $port ($fwProfile)" -ForegroundColor Green
} else {
    Write-Host "[1/4] YONETICI YETKISI YOK - guvenlik duvari kurali eklenemedi." -ForegroundColor Red
    Write-Host "      Telefondan baglanti KURULAMAZ. PowerShell'i yonetici olarak acip" -ForegroundColor Yellow
    Write-Host "      bu betigi yeniden calistirin veya su komutu kullanin:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "      New-NetFirewallRule -DisplayName `"$ruleName`" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile $fwProfile" -ForegroundColor Gray
    Write-Host ""
}

# 1b) LiveKit portlari (yerel LiveKit kullaniliyorsa)
$liveKitRule = "Sora LiveKit $port"
$liveKitExe = Join-Path $projectRoot "livekit-local\livekit-server.exe"
$useLocalLiveKit = Test-Path $liveKitExe

if ($useLocalLiveKit) {
    $existingLiveKitRule = Get-NetFirewallRule -DisplayName $liveKitRule -ErrorAction SilentlyContinue
    if ($existingLiveKitRule) {
        Write-Host "[1b] LiveKit guvenlik duvari kurali zaten var." -ForegroundColor Green
    } elseif ($isAdmin) {
        # 7880 = HTTP/WebSocket (ws:// istemci baglantisi), 7881 = TCP fallback, 7882 = UDP medya
        New-NetFirewallRule -DisplayName $liveKitRule `
          -Direction Inbound -Protocol TCP -LocalPort 7880,7881 `
          -Action Allow -Profile $fwProfile -Description "Sora yerel LiveKit sunucusu (TCP)" | Out-Null
        New-NetFirewallRule -DisplayName "$liveKitRule (UDP)" `
          -Direction Inbound -Protocol UDP -LocalPort 7882 `
          -Action Allow -Profile $fwProfile -Description "Sora yerel LiveKit sunucusu (UDP medya)" | Out-Null
        Write-Host "[1b] LiveKit kurallari eklendi: TCP 7880-7881, UDP 7882" -ForegroundColor Green
    } else {
        Write-Host "[1b] YONETICI YETKISI YOK - LiveKit portlari (7880,7881,7882) acilamadi." -ForegroundColor Red
        Write-Host "     Ses baglantisi KURULAMAZ. Betigi yonetici olarak calistirin." -ForegroundColor Yellow
    }
} else {
    Write-Host "[1b] Yerel LiveKit bulunamadi - bulut kurulumu kullaniliyor." -ForegroundColor Gray
}

# 2) LAN IP
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1).IPAddress

Write-Host "[2/4] Bilgisayarin LAN adresi: $lanIp" -ForegroundColor Green
Write-Host "      Telefon ayni Wi-Fi agindaysa su adresi acabilmeli:" -ForegroundColor Gray
Write-Host "      http://${lanIp}:$port/health" -ForegroundColor Gray

$envUrl = Join-Path $projectRoot ".env"
if (Test-Path $envUrl) {
    $configured = Select-String -Path $envUrl -Pattern '^EXPO_PUBLIC_TOKEN_SERVER_URL=(.+)$' |
        Select-Object -First 1
    if ($configured) {
        $configuredUrl = $configured.Matches[0].Groups[1].Value.Trim()
        if ($configuredUrl -notmatch [regex]::Escape($lanIp)) {
            Write-Host ""
            Write-Host "      UYARI: .env dosyasindaki adres ($configuredUrl) guncel IP ile uyusmuyor." -ForegroundColor Yellow
            Write-Host "      Canli APK'yi yeniden derlemeden bu degisiklik uygulanmaz." -ForegroundColor Yellow
            Write-Host ""
        }
    }
}

# 3) Yerel LiveKit + token sunucusu
if ($useLocalLiveKit) {
    Write-Host "[3/4] Yerel LiveKit baslatiliyor..." -ForegroundColor Green
    $running = Get-Process livekit-server -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "      LiveKit zaten calisiyor (PID $($running.Id -join ', '))." -ForegroundColor Gray
    } else {
        Start-Process -FilePath $liveKitExe `
          -ArgumentList "--config", (Join-Path $projectRoot "livekit-local\livekit.yaml") `
          -WorkingDirectory (Join-Path $projectRoot "livekit-local") `
          -WindowStyle Minimized
        Start-Sleep -Seconds 4
        Write-Host "      LiveKit: ws://${lanIp}:7880" -ForegroundColor Gray
    }
}

Write-Host "[4/4] Token sunucusu baslatiliyor..." -ForegroundColor Green

# Onceki calismadan kalan sunucu varsa portu tutuyordur; temiz baslangic icin durdur.
$stale = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($stale) {
    $stalePids = $stale.OwningProcess | Select-Object -Unique
    foreach ($stalePid in $stalePids) {
        $proc = Get-Process -Id $stalePid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            Write-Host "      Port $port kullanan eski token sunucusu durduruluyor (PID $stalePid)..." -ForegroundColor Yellow
            Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
    }
    $still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($still) {
        Write-Host "      Port $port baska bir uygulama tarafindan kullaniliyor." -ForegroundColor Red
        Write-Host "      Bu programi kapatip betigi yeniden calistirin." -ForegroundColor Red
        exit 1
    }
}

Write-Host "      Durdurmak icin Ctrl+C" -ForegroundColor Gray
Write-Host ""

Push-Location (Join-Path $projectRoot "server")
try {
    npm start
} finally {
    Pop-Location
}
