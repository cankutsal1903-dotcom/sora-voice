# Mevcut bir APK'nin ICINDEN yalnizca JS paketini degistirir.
#
# Elle ZIP yazmak yerine .NET'in Update modunu kullanir: diger tum girdiler
# (res/*.xml, classes.dex, lib/*.so) bayt bayt korunur. Boylece Android kaynak
# kimlikleri bozulmaz.
#
# Kullanim:
#   powershell -ExecutionPolicy Bypass -File scripts\swap-bundle.ps1 `
#     -Apk builds\Sora-v12.apk `
#     -Bundle C:\yol\index.android.bundle `
#     -Out  builds\Sora-v13.apk

param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [Parameter(Mandatory = $true)][string]$Bundle,
    [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

if (-not (Test-Path $Apk))    { Write-Host "APK yok: $Apk" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $Bundle)) { Write-Host "Bundle yok: $Bundle" -ForegroundColor Red; exit 1 }

$Apk    = (Resolve-Path $Apk).Path
$Bundle = (Resolve-Path $Bundle).Path
$OutDir = Split-Path -Parent $Out
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }

Write-Host ""
Write-Host "=== APK Bundle Degistirme ===" -ForegroundColor Cyan

# Kopya uzerinde calis; kaynak APK bozulmasin
Copy-Item $Apk $Out -Force
Write-Host "Kopyalandi: $Out" -ForegroundColor Gray

$zip = [System.IO.Compression.ZipFile]::Open($Out, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $zip.GetEntry("assets/index.android.bundle")
    if (-not $entry) {
        Write-Host "assets/index.android.bundle APK icinde bulunamadi." -ForegroundColor Red
        exit 1
    }

    $oldSize = $entry.Length
    $entry.Delete()

    $new = $zip.CreateEntry("assets/index.android.bundle", [System.IO.Compression.CompressionLevel]::NoCompression)
    $stream = $new.Open()
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Bundle)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }

    Write-Host ("Eski paket: {0:N1} MB" -f ($oldSize / 1MB)) -ForegroundColor Gray
    Write-Host ("Yeni paket: {0:N1} MB" -f ((Get-Item $Bundle).Length / 1MB)) -ForegroundColor Gray
} finally {
    $zip.Dispose()
}

Write-Host "Degistirildi." -ForegroundColor Green
Write-Host ""

# Dogrulama: res/xml dosyalari hala okunabiliyor mu
$zip = [System.IO.Compression.ZipFile]::OpenRead($Out)
try {
    $xmlCount = ($zip.Entries | Where-Object { $_.FullName -like "res/*.xml" }).Count
    $soCount  = ($zip.Entries | Where-Object { $_.FullName -like "lib/*.so" }).Count
    $arsc     = $zip.GetEntry("resources.arsc")
    Write-Host ("Dogrulama: res/*.xml={0}, lib/*.so={1}, resources.arsc={2}" -f `
        $xmlCount, $soCount, $(if ($arsc) { "var" } else { "YOK" })) -ForegroundColor Gray
} finally {
    $zip.Dispose()
}

Write-Host ""
Write-Host "Sonraki adim: zipalign + apksigner" -ForegroundColor Cyan
Write-Host ""