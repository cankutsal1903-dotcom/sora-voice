# Projeyi GitHub'a yukler.
#
# Kullanim:
#   powershell -ExecutionPolicy Bypass -File scripts\push-to-github.ps1 -Url "https://github.com/KULLANICI/sora-voice.git"
#
# Betik yuklemeden once gizli dosyalarin depoya girmeedigini dogrular.

param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
    Write-Host ""
    Write-Host "=== GitHub'a Yukleme ===" -ForegroundColor Cyan
    Write-Host ""

    # 1) URL bicimi
    if ($Url -notmatch '^https://github\.com/[^/]+/[^/]+(\.git)?$') {
        Write-Host "Gecersiz GitHub adresi: $Url" -ForegroundColor Red
        Write-Host "Beklenen bicim: https://github.com/KULLANICI/sora-voice.git" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "[1/5] Adres gecerli." -ForegroundColor Green

    # 2) Sir kontrolu: bu dosyalar ASLA commit edilmemeli
    $forbidden = @("credentials.json", ".env", "server/.env")
    $tracked = git ls-files
    $leaks = @()
    foreach ($pattern in @("*.jks", "*.keystore", "credentials.json", ".env", "server/.env")) {
        $hit = $tracked | Where-Object { $_ -like $pattern }
        if ($pattern -eq ".env") {
            $hit = $tracked | Where-Object { $_ -eq ".env" -or $_ -eq "server/.env" }
        }
        if ($hit) { $leaks += $hit }
    }

    if ($leaks.Count -gt 0) {
        Write-Host "[2/5] GIZLI DOSYA DEPODA - yukleme durduruldu:" -ForegroundColor Red
        $leaks | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        Write-Host "      Bu dosyalari 'git rm --cached' ile cikarip tekrar deneyin." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "[2/5] Depoda gizli dosya yok." -ForegroundColor Green

    # 3) Bekleyen degisiklik
    $dirty = git status --porcelain
    if ($dirty) {
        Write-Host "[3/5] Commit edilmemis degisiklik var:" -ForegroundColor Yellow
        $dirty | Select-Object -First 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
        Write-Host "      Once commit edin, sonra tekrar calistirin." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "[3/5] Calisma alani temiz." -ForegroundColor Green

    # 4) Remote
    $existing = git remote get-url origin 2>$null
    if ($existing) {
        Write-Host "[4/5] Mevcut origin guncelleniyor: $existing" -ForegroundColor Yellow
        git remote set-url origin $Url
    } else {
        git remote add origin $Url
        Write-Host "[4/5] origin eklendi." -ForegroundColor Green
    }

    # 5) Push
    Write-Host "[5/5] Gonderiliyor..." -ForegroundColor Green
    Write-Host ""
    git push -u origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Gonderim basarisiz." -ForegroundColor Red
        Write-Host "OlasI nedenler:" -ForegroundColor Yellow
        Write-Host "  - Depo GitHub'da henuz olusturulmadi" -ForegroundColor Yellow
        Write-Host "  - Kimlik dogrulama gerekli (Git Credential Manager acilir)" -ForegroundColor Yellow
        Write-Host "  - Depo adi veya kullanici adi yanlis" -ForegroundColor Yellow
        exit 1
    }

    Write-Host ""
    Write-Host "Yukleme tamamlandi." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Sonraki adimlar:" -ForegroundColor Cyan
    Write-Host "  1. GitHub > Settings > Secrets and variables > Actions > Secrets:" -ForegroundColor Gray
    Write-Host "     powershell -ExecutionPolicy Bypass -File scripts\github-secrets.ps1" -ForegroundColor Gray
    Write-Host "  2. Ayni sayfada Variables sekmesine 8 adet EXPO_PUBLIC_* degeri" -ForegroundColor Gray
    Write-Host "  3. Actions > 'Android Release APK' > Run workflow" -ForegroundColor Gray
    Write-Host ""
} finally {
    Pop-Location
}