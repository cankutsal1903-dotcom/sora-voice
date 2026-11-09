# Sora - Deployment Guide

> Telefonda canlı uygulamayı test etme akışı için **[docs/LIVE_TESTING.md](docs/LIVE_TESTING.md)**
> belgesine bakın. Bu dosya genel yayın sürecini özetler.

## 📱 Derleme: her zaman EAS bulutunda

Derleme bilinçli olarak bilgisayarda yapılmaz. Yerel Gradle derlemesi makineyi
ağır şekilde yorduğu için kaldırılmıştır.

```bash
# Canlı test APK'sı (dahili dağıtım, gerçek release)
npm run live:build

# Google Play için .aab
npm run store:build
```

Her iki komut da Expo sunucularında çalışır. Bilgisayarınız yalnızca dosyaları
yükler ve bitmiş ürünün bağlantısını alır.

### Profiller

| Profil | Çıktı | Amaç |
|---|---|---|
| `release-apk` | `.apk` | Telefonda canlı test |
| `production` | `.aab` | Google Play |
| `preview` | `.apk` | Hızlı önizleme (env değişkeni yok) |
| `development` | dev client | Geliştirme |

### Ortam değişkenleri

`EXPO_PUBLIC_*` değerleri `eas.json` içindeki profil `env` bloklarında tanımlıdır.
`.env` dosyası bilinçli olarak `.gitignore` içindedir ve **EAS'e yüklenmez**;
bu yüzden değerler `eas.json` üzerinden verilir.

Yeni bir değişken eklerseniz **hem** kök `.env`'e (yerel geliştirme için) **hem**
`eas.json` içindeki ilgili profillere ekleyin.

## 🔐 İmzalama

### Bulut derlemesi (önerilen)

EAS, release keystore'unu kendi sunucularında yönetir ve derleme sırasında
`android/app/eas-build.gradle` üzerinden `credentials.json`'dan okur. Ek bir
kurulum gerekmez.

Kimlik bilgilerini görmek/yönetmek için:

```bash
npx eas credentials --platform android
```

Keystore'u dışa aktarırsanız şifreli ve güvenli bir yerde saklayın. Projeye veya
`.env` dosyasına **koymayın**.

### Yerel derleme (kapalı)

Yerel release derlemesi artık kasıtlı olarak engellenmiştir. Nedeni: keystore
tanımlı değilken sessizce `debug.keystore`'a düşülüyordu ve ortaya Play'e
yüklenemeyen bir "release" APK çıkıyordu.

Zorunluysa dört ortam değişkenini tanımlayın:

```powershell
$env:SORA_RELEASE_STORE_FILE="C:\yol\sora-release.keystore"
$env:SORA_RELEASE_STORE_PASSWORD="..."
$env:SORA_RELEASE_KEY_ALIAS="sora-key-alias"
$env:SORA_RELEASE_KEY_PASSWORD="..."
```

## 🚀 Sunucu bileşenleri

### Token sunucusu

```bash
# Yönetici PowerShell — güvenlik duvarı kuralını da ekler
npm run live:server
```

Sunucu `0.0.0.0:3001` üzerinde dinler. `GET /health` ile durum verir,
`POST /token` ile kısa ömürlü LiveKit tokenı üretir.

`server/.env` içinde şunlar **zorunludur**:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Sunucu, eksik ya da örnek (`your_api_key` gibi) değerlerle başlamayı reddeder.

### LiveKit

[LiveKit Cloud](https://cloud.livekit.io) projesi oluşturun ve anahtarları alın.
Kendi sunucunuzda barındıracaksanız UDP portlarının açık olması gerekir; canlı
kullanım için Cloud veya VDS önerilir.

### Supabase

`supabase/schema.sql` dosyasını Supabase SQL Editor'de çalıştırın.

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

Supabase **service_role** anahtarı asla istemci tarafına konmaz.

## 📊 Sürüm yönetimi

`app.json` içindeki `android.versionCode` alanı kaldırılmıştır: `android/`
klasörü bulunduğu için yok sayılıyordu ve kafa karışıklığı yaratıyordu.

- **versionCode:** EAS uzak sayaç yönetir (`appVersionSource: "remote"`).
  `autoIncrement: true` olduğu için her derlemede artar.
- **versionName:** `app.json` → `expo.version` ve `android/app/build.gradle` →
  `versionName` aynı olmalıdır. `package.json` sürümü de bunlarla eşleşir.

Sürüm yükseltirken üç yeri birlikte güncelleyin:

1. `app.json` → `expo.version`
2. `android/app/build.gradle` → `versionName`
3. `package.json` → `version`

## 🔒 Güvenlik kontrol listesi

- [x] `.env` ve `server/.env` `.gitignore` içinde
- [x] Keystore dosyaları git'te değil
- [x] `LIVEKIT_API_SECRET` yalnızca sunucuda
- [x] ProGuard aktif (release) — LiveKit/WebRTC kuralları eklendi
- [x] Release'te cleartext HTTP yalnızca yerel ağ adreslerine açık
- [ ] Canlıda token sunucusu HTTPS/WSS adresine taşınacak
- [ ] `docs/PRIVACY_POLICY.md` içindeki destek e-postası doldurulacak

## 🐛 Sorun giderme

### "Ses bağlantısı kurulamadı"
- Token sunucusu çalışıyor mu? `http://IP:3001/health`
- `server/.env` içindeki LiveKit anahtarları gerçek mi?
- Telefon ve bilgisayar aynı ağda mı?

### "Yerel release derlemesi durduruldu"
- Bu beklenen davranıştır. `npm run live:build` kullanın.

### "Uygulama boş açılıyor, giriş çalışmıyor"
- APK'daki env değişkenleri eksik olabilir. `eas.json` içindeki `env` bloğunu
  kontrol edip yeniden derleyin.

### "Supabase hatası"
- `supabase/schema.sql` çalıştırıldı mı?
- Publishable (public) anahtar kullanılıyor mu?

## 📱 Dağıtım

### Dahili test
`release-apk` profili ile APK üretin, bağlantıyı test ekibiyle paylaşın.

### Google Play
1. `npm run store:build` ile `.aab` üretin
2. Play Console → Dahili test kanalına yükleyin
3. Data Safety formunu ve gizlilik URL'sini tamamlayın
4. Alpha/Beta kanallarına ilerletin

---
