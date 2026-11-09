# Sora - Yerel Sunucu Baslatma (Windows PowerShell)

Bu betik, canlı uygulamanın (release APK) telefondan erişebilmesi için token
sunucusunu başlatır ve gerekli Windows güvenlik duvarı kuralını ekler.

## Kullanim

PowerShell'i **yonetici olarak** acin ve proje klasorunde calistirin:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-live-server.ps1
```

Yonetici yetkisi yoksa betik yalnizca sunucuyu baslatir; güvenlik duvarı
kuralını elle eklemeniz gerekir (asagidaki komut).

## Guvenlik duvari kuralini elle ekleme

```powershell
New-NetFirewallRule -DisplayName "Sora Token Server 3001" `
  -Direction Inbound -Protocol TCP -LocalPort 3001 `
  -Action Allow -Profile Private,Public
```

Kuralı kaldırmak için:

```powershell
Remove-NetFirewallRule -DisplayName "Sora Token Server 3001"
```

## Dogrulama

Telefonla ayni Wi-Fi agina bagli oldugunuzdan emin olun, ardindan
telefonun tarayicisindan su adresi acin:

```
http://192.168.1.40:3001/health
```

Beklenen yanit: `{"status":"ok"}`

Yanit gelmiyorsa: bilgisayarin IP'si degismis olabilir (`ipconfig`), güvenlik
duvarı kuralı eklenmemis olabilir veya telefon farkli bir agda olabilir.
