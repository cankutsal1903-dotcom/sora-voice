# GitHub Actions secret'larini hazirlar.
#
# Sir degerlerini ekrana YAZDIRMAZ; yalnizca panoya kopyalar ve ozet gosterir.
# Boylece sirlar terminal gecmisinde / ekran goruntusunde kalmaz.
#
# Kullanim:
#   powershell -ExecutionPolicy Bypass -File scripts\github-secrets.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$credPath = Join-Path $root "credentials.json"

if (-not (Test-Path $credPath)) {
    Write-Host "credentials.json bulunamadi: $credPath" -ForegroundColor Red
    exit 1
}

$cred = Get-Content $credPath -Raw | ConvertFrom-Json
$ks = $cred.android.keystore

$ksPath = $ks.keystorePath
if (-not [System.IO.Path]::IsPathRooted($ksPath)) {
    $ksPath = Join-Path $root $ksPath
}

if (-not (Test-Path $ksPath)) {
    Write-Host "Keystore bulunamadi: $ksPath" -ForegroundColor Red
    exit 1
}

function Copy-Secret {
    param([string]$Label, [string]$Value)
    if (-not $Value) {
        Write-Host ("  {0,-32} BOS!" -f $Label) -ForegroundColor Red
        return
    }
    Set-Clipboard -Value $Value
    Write-Host ("  {0,-32} panoya kopyalandi ({1} karakter)" -f $Label, $Value.Length) -ForegroundColor Green
}

Write-Host ""
Write-Host "=== GitHub Actions Secrets ===" -ForegroundColor Cyan
Write-Host "Her komuttan sonra degeri GitHub'a yapistirin." -ForegroundColor Gray
Write-Host ""

Write-Host "1) ANDROID_KEYSTORE_BASE64" -ForegroundColor Yellow
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ksPath))
Set-Clipboard -Value $b64
Write-Host ("   panoya kopyalandi ({0:N0} karakter, {1:N1} KB)" -f $b64.Length, ($b64.Length/1KB)) -ForegroundColor Green
Write-Host ""
Read-Host "   GitHub'a yapistirdiktan sonra Enter'a basin"

Copy-Secret "2) ANDROID_KEYSTORE_PASSWORD" $ks.keystorePassword
Read-Host "   GitHub'a yapistirdiktan sonra Enter'a basin"

Copy-Secret "3) ANDROID_KEY_ALIAS" $ks.keyAlias
Read-Host "   GitHub'a yapistirdiktan sonra Enter'a basin"

Copy-Secret "4) ANDROID_KEY_PASSWORD" $ks.keyPassword
Read-Host "   GitHub'a yapistirdiktan sonra Enter'a basin"

Write-Host ""
Write-Host "=== GitHub Actions Variables (secret degil, herkese acik) ===" -ForegroundColor Cyan
Write-Host "eas.json icindeki env degerlerini Settings > Variables bolumune girin:" -ForegroundColor Gray
Write-Host ""

$easPath = Join-Path $root "eas.json"
if (Test-Path $easPath) {
    $eas = Get-Content $easPath -Raw | ConvertFrom-Json
    $envBlock = $eas.build."release-apk".env
    if ($envBlock) {
        $envBlock.PSObject.Properties | ForEach-Object {
            Write-Host ("  {0,-38} = {1}" -f $_.Name, $_.Value) -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "Tamamlandi." -ForegroundColor Cyan
Write-Host ""