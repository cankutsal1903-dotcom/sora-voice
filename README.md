# Sora Voice

Sora; Android ve iOS için modern, oda tabanlı bir sesli sohbet uygulamasıdır.

## Özellikler

- Keşfet, arama, kategori ve favori oda akışları
- Oda oluşturma ve planlama
- Katılımcı listesi, el kaldırma, anket, tepki, hediye ve oda içi yazılı sohbet
- Profil, cüzdan, bildirim ve yerel veri denetimleri
- LiveKit ile gerçek zamanlı çok kullanıcılı ses bağlantısı
- Android/iOS uygulama simgesi ve açılış ekranında Sora logosu

## Hızlı başlangıç

### Tek yönetici komutla

```powershell
# 1) Bağımlılıkları kur
npm install
npm --prefix server install

# 2) Ayarları kopyala ve doldur
Copy-Item .env.example .env
Copy-Item server\.env.example server\.env

# 3) Token sunucusunu başlat (yönetici PowerShell)
npm run live:server
```

### Telefonda canlı uygulamayı test etme

EAS kotası kullanmadan, bilgisayarı yormadan GitHub Actions üzerinde imzalı
release APK üretilebilir. Kurulum: **[docs/GITHUB_CLOUD_BUILD.md](docs/GITHUB_CLOUD_BUILD.md)**

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm start` | Metro geliştirme sunucusu |
| `npm run android` | Yerel **debug** derlemesi |
| `npm run live:server` | Token sunucusu + güvenlik duvarı kuralı |
| `npm run live:build` | **Canlı (release) APK** — EAS bulutunda |
| `npm run store:build` | Google Play için `.aab` |
| `npm run check` | Sözdizimi kontrolü |

Yerel release derlemesi bilinçli olarak kapalıdır; ayrıntısı
[DEPLOYMENT.md](DEPLOYMENT.md#yerel-derleme-kapalı) içinde.

## Gereksinimler

- **LiveKit Cloud** projesi (canlı ses için zorunlu)
- **Supabase** projesi (`supabase/schema.sql` çalıştırılmış olmalı)
- Node.js 20+

## Kontrol

```powershell
npm run check
npx expo config --type public
```

Canlı ses özelliği yerel WebRTC kullandığından Expo Go yerine Android/iOS
derlemesinde çalışır. `npx expo run:android` yalnızca **debug** için kullanılır.
