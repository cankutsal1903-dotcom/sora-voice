# Sora - Canlı Uygulama Testi

Bu belge, **canlı (release) uygulamayı** kendi bilgisayarınızda hiç derleme yapmadan,
Expo'nun bulut sunucularında derleyip Android telefonda test etme akışını anlatır.

## Özet

| Ne | Nerede çalışır | Komut |
|---|---|---|
| Token sunucusu | Kendi bilgisayarınız (LAN) | `npm run live:server` |
| **LiveKit (ses)** | **Kendi bilgisayarınız — kota yok** | `npm run live:server` |
| Supabase | Bulut (zaten kurulu) | — |
| Uygulama derlemesi | **EAS bulut** (bilgisayarınız kullanılmaz) | `npm run live:build` |

Derleme tamamen Expo sunucularında yapılır. Bilgisayarınız yalnızca dosyaları
yükler ve bitmiş APK'nın indirme bağlantısını alır.

---

## 0. Ses altyapısı: yerel LiveKit (kota yok)

LiveKit sunucusu bu projede **kendi bilgisayarınızda** çalışır; bulut kotası
kullanılmaz, dakika sınırı yoktur.

- Binary: `livekit-local/livekit-server.exe` (~55 MB, repoya girmez)
- Ayar: `livekit-local/livekit.yaml`
- Anahtarlar `server/.env` ile aynı olmalıdır (`devkey` / `sora_local_dev_secret_...`)

İndirme gerekirse:

```powershell
# https://github.com/livekit/livekit/releases adresinden
# livekit_<surum>_windows_amd64.zip indirip livekit-local/ icine cikarin
```

> **Not:** Yerel mod yalnızca test içindir. Yayına çıkarken LiveKit Cloud veya
> kendi VDS'inizi kullanın ve `keys:` altına `livekit-server.exe generate-keys`
> ile üretilmiş gerçek anahtarlar koyun.

## 1. Bulut kullanmak isterseniz (alternatif)

`server/.env` içine LiveKit Cloud değerlerini yazın:

```dotenv
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

Bu değerler [LiveKit Cloud](https://cloud.livekit.io) → proje → **Settings → Keys**
bölümündedir. Ücretsiz plan ayda 5.000 WebRTC dakikası verir.

Sunucu, örnek/placeholder değerlerle başlamayı reddeder ve hangi alanın eksik
olduğunu söyler. Bu bilinçli bir korumadır: aksi halde sunucu ayakta görünür ama
odaya girince hata verirdi.

## 2. Token sunucusunu başlatın

PowerShell'i **yönetici olarak** açın:

```powershell
npm run live:server
```

Betik şunları yapar:

1. Windows güvenlik duvarında gereken portları açar:
   - **TCP 3001** — token sunucusu
   - **TCP 7880, 7881 + UDP 7882** — yerel LiveKit (ses)
2. Bilgisayarın güncel LAN IP'sini gösterir
3. Yerel LiveKit'i başlatır (varsa)
4. Token sunucusunu başlatır

Yönetici yetkisi yoksa sunucu yine çalışır ama telefondan bağlanamazsınız.
Kuralı elle eklemek için:

```powershell
# Token sunucusu
New-NetFirewallRule -DisplayName "Sora Token Server 3001" `
  -Direction Inbound -Protocol TCP -LocalPort 3001 `
  -Action Allow -Profile Private,Public

# Yerel LiveKit (ses)
New-NetFirewallRule -DisplayName "Sora LiveKit 3001" `
  -Direction Inbound -Protocol TCP -LocalPort 7880,7881 `
  -Action Allow -Profile Private,Public
New-NetFirewallRule -DisplayName "Sora LiveKit 3001 (UDP)" `
  -Direction Inbound -Protocol UDP -LocalPort 7882 `
  -Action Allow -Profile Private,Public
```

> **Ağ profili önemli:** Windows, Wi-Fi ağınızı çoğu zaman **Public (Genel)**
> olarak işaretler. Yalnızca `-Profile Private` kullanırsanız kural işlemez ve
> telefon bağlanamaz. Bu yüzden `Private,Public` kullanın. Betik bunu otomatik
> algılar ve gerekirse kuralı günceller.

**Doğrulama:** Telefonun tarayıcısından `http://192.168.1.40:3001/health` açın.
`{"status":"ok"}` görmelisiniz. Görmüyorsanız telefon ve bilgisayar aynı Wi-Fi
ağında mı, IP değişmiş mi kontrol edin.

## 3. Canlı APK'yı bulutta derleyin

```powershell
npm run live:build
```

`release-apk` profili kullanılır ve şunları üretir:

- Gerçek release derlemesi (`__DEV__ = false`, demo verisi yok)
- R8/minify açık, debuggable kapalı
- **EAS'in yönettiği release keystore** ile imzalı
- `distribution: internal` → APK indirme bağlantısı

Derleme bitince terminalde bir QR kod ve bağlantı çıkar. Telefonda bağlantıyı açıp
APK'yı indirin.

Süre genellikle 10–15 dakikadır ve **bilgisayarınızı meşgul etmez**.

## 4. Telefona kurun

1. APK'yı indirin
2. "Bilinmeyen kaynaklardan yüklemeye izin ver" uyarısını onaylayın
3. Kurun ve açın
4. Mikrofon ve bildirim izinlerini verin

Uygulama açıldığında Supabase'e bağlanır; giriş yaptıktan sonra odalar gerçek
veriden gelir.

---

## Önemli: IP değişirse ne olur?

`EXPO_PUBLIC_TOKEN_SERVER_URL` **derleme anında APK'nın içine gömülür**. Yani:

- Bilgisayarın LAN IP'si değişirse (`192.168.1.40` → başka bir adres)
- Canlı APK eski adrese bağlanmaya çalışır ve ses çalışmaz

Bu durumda iki seçenek var:

**A) Bilgisayara sabit IP verin** (önerilen)
Router ayarlarından bilgisayarın MAC adresine sabit DHCP ataması yapın. IP bir kez
sabitlenince derleme bir daha bozulmaz.

**B) IP değişince yeni derleme alın**

IP'nin yazılı olduğu **tüm** yerleri güncelleyin:

| Dosya | Ne için |
|---|---|
| `eas.json` | Canlı APK'nın derlenmesi (2 profil) |
| `.env` | Yerel `npm start` geliştirmesi |
| `android/app/src/main/res/xml/network_security_config.xml` | Release'te cleartext izni |

```powershell
npm run live:build
```

`npm run live:server` betiği, `.env` içindeki adres ile güncel IP uyuşmuyorsa
sizi uyarır.

> **Not:** APK'ya gömülen adres derleme anında sabitlenir. Telefondaki uygulamayı
> her IP değişiminde yeniden derlemek zorunda kalmamak için A seçeneğini öneriyoruz.

---

## Derleme profilleri

| Profil | Ne üretir | Kullanım |
|---|---|---|
| `release-apk` | Release **APK**, dahili dağıtım | **Telefonda canlı test** ← bunu kullanın |
| `production` | Release **.aab** | Google Play yüklemesi |
| `preview` | APK | Hızlı önizleme (env değişkenleri yok) |
| `development` | Dev client | Yalnızca geliştirme |

`preview` profilinde **env değişkenleri tanımlı değildir**; bu yüzden orada
Supabase sessizce devre dışı kalır. Canlı test için `release-apk` kullanın.

---

## Yerel derleme neden kapalı?

Bilgisayarınızı yavaşlatmaması için yerel release derlemesi bilinçli olarak
engellenmiştir. `npx expo run:android --variant release` çalıştırırsanız Gradle
açık bir hata verip durur:

> Yayin imzalama anahtari tanimli degil. Yerel release derlemesi durduruldu.
> Canli APK'yi EAS bulutunda uretin: npx eas build --platform android --profile release-apk

Bu kontrol, daha önce sessizce debug anahtarı ile imzalanmış "release" APK'lar
üretilmesini önler. Öyle bir APK Play'e yüklenemez ve mevcut kurulumun üzerine
güncelleme olarak da geçmez.

Yine de yerel derleme gerekirse, dört ortam değişkenini tanımlayarak kontrolü
atlayabilirsiniz:

```powershell
$env:SORA_RELEASE_STORE_FILE="C:\yol\sora-release.keystore"
$env:SORA_RELEASE_STORE_PASSWORD="..."
$env:SORA_RELEASE_KEY_ALIAS="sora-key-alias"
$env:SORA_RELEASE_KEY_PASSWORD="..."
```

---

## Sorun giderme

### "Bağlantı servisi çevrimdışı"
- Token sunucusu çalışıyor mu? `curl http://192.168.1.40:3001/health`
- Güvenlik duvarı kuralı eklendi mi?
- Telefon aynı Wi-Fi'da mı? (misafir ağı veya mobil veri olmaz)

### "Ses oturumu oluşturulamadı"
- `server/.env` içindeki LiveKit anahtarları gerçek mi?
- Sunucu konsolunda hata var mı?

### "Uygulama açılıyor ama boş"
- APK'daki env değişkenleri boş olabilir. `eas.json` içindeki `env` bloğunu
  kontrol edin, sonra yeniden derleyin.

### "APK güncellenmiyor / yüklenmiyor"
- EAS keystore'u değişmiş olabilir. `npx eas credentials --platform android`
  ile kontrol edin.

---

## Güvenlik notları

- `eas.json` içindeki `EXPO_PUBLIC_*` değerleri **gizli değildir**; APK'nın
  içine gömülür ve herkes okuyabilir. Supabase publishable key ve IBAN bilgisi
  bu yüzden sorun değildir.
- `LIVEKIT_API_SECRET` **asla** `eas.json`, `.env` (kök) veya uygulama koduna
  konmaz. Yalnızca `server/.env` içinde durur ve sunucu `.gitignore` ile dışlanır.
- Canlıya çıkmadan önce token sunucusunu HTTPS/WSS adresine taşıyın ve
  `android/app/src/main/res/xml/network_security_config.xml` içindeki cleartext
  istisnasını kaldırın.
