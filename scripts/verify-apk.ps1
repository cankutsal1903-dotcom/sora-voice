# Indirilen APK'nin gercekten yayin anahtariyla imzalandigini dogrular.
#
# Neden gerekli: debug anahtariyla imzalanmis bir APK da telefona kurulur ve
# calisir; farki ancak Google Play'e yuklerken veya guncelleme yaparken anlasilir.
#
# Kullanim:
#   powershell -ExecutionPolicy Bypass -File scripts\verify-apk.ps1 -Apk "C:\yol\sora.apk"

param(
    [Parameter(Mandatory = $true)]
    [string]$Apk
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Apk)) {
    Write-Host "APK bulunamadi: $Apk" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== APK Imza Dogrulamasi ===" -ForegroundColor Cyan
Write-Host "Dosya: $Apk" -ForegroundColor Gray
Write-Host ("Boyut: {0:N1} MB" -f ((Get-Item $Apk).Length / 1MB)) -ForegroundColor Gray
Write-Host ""

# apksigner'i Android SDK build-tools icinde ara
$sdkCandidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk")
) | Where-Object { $_ -and (Test-Path $_) }

$apksigner = $null
foreach ($sdk in $sdkCandidates) {
    $buildTools = Join-Path $sdk "build-tools"
    if (-not (Test-Path $buildTools)) { continue }

    $candidate = Get-ChildItem $buildTools -Directory |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName "apksigner.bat" } |
        Where-Object { Test-Path $_ } |
        Select-Object -First 1

    if ($candidate) { $apksigner = $candidate; break }
}

if (-not $apksigner) {
    Write-Host "apksigner bulunamadi." -ForegroundColor Yellow
    Write-Host "Android SDK build-tools kurulu degil. Android Studio > SDK Manager'dan" -ForegroundColor Yellow
    Write-Host "'Android SDK Build-Tools' kurun." -ForegroundColor Yellow
    exit 1
}

$output = & $apksigner verify --print-certs $Apk 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "APK imzasi DOGRULANAMADI:" -ForegroundColor Red
    $output | ForEach-Object { Write-Host "  $_" }
    exit 1
}

$dnLines = $output | Select-String "certificate DN:"
$dn = ($dnLines | Select-Object -First 1) -replace '.*certificate DN:\s*', ''

Write-Host "Sertifika:" -ForegroundColor Green
Write-Host "  $dn" -ForegroundColor White
Write-Host ""

if ($dn -match "CN=Android Debug|O=Unknown") {
    Write-Host "SONUC: BU BIR DEBUG IMZASI." -ForegroundColor Red
    Write-Host "" -ForegroundColor Red
    Write-Host "  Bu APK yalnizca yerel test icindir:" -ForegroundColor Yellow
    Write-Host "   - Google Play'e YUKLENEMEZ" -ForegroundColor Yellow
    Write-Host "   - Mevcut kurulumun uzerine guncelleme olarak GECMEZ" -ForegroundColor Yellow
    Write-Host "" -ForegroundColor Yellow
    Write-Host "  Canli APK uretin: npm run live:build" -ForegroundColor Yellow
    exit 2
}

Write-Host "SONUC: YAYIN IMZASI GECERLI." -ForegroundColor Green
Write-Host "  Bu APK canli/test icin kullanilabilir." -ForegroundColor Green
Write-Host ""

# AAB oldugunu sanmiyoruz; yalnizca bilgi amacli paket adini goster
$manifestCheck = & $apksigner verify --print-certs $Apk 2>&1 | Select-String "v2|v3" | Select-Object -First 1
if ($manifestCheck) {
    Write-Host "Imza surumu: $manifestCheck" -ForegroundColor Gray
}