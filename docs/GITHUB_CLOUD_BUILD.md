# GitHub Actions ile APK Derleme

EAS kotası kullanmadan, bilgisayarı yormadan imzalı release APK üretme.
Derleme GitHub'ın Linux sunucusunda yapılır (`ubuntu-latest`).

## Neden bu yöntem

| Yöntem | Süre | Bilgisayar yükü | Kota |
|---|---|---|---|
| Yerel Gradle | 15-25 dk | Yüksek | — |
| EAS Build | 8-15 dk | Yok | Aylık sınır (doldu) |
| **GitHub Actions** | 15-25 dk (ilk), 5-8 dk (sonra) | Yok | Aylık 2.000 dk |

## Bir defalık kurulum

### 1. Depoyu oluşturun ve gönderin

GitHub'da **boş ve özel** bir depo açın (`sora-voice`), sonra proje kökünde:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\push-to-github.ps1 -Url "https://github.com/KULLANICI/sora-voice.git"
```

Betik yüklemeden önce gizli dosya taraması yapar; `.env`, `*.jks` veya
`credentials.json` depoda bulursa **yüklemeyi durdurur**.

### 2. Secret'ları girin

GitHub → **Settings → Secrets and variables → Actions → Secrets**:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\github-secrets.ps1
```

Betik değerleri **ekrana basmadan** sırayla panoya kopyalar; siz GitHub'a
yapıştırıp Enter'a basarsınız.

| Secret | Kaynak |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `credentials/android/keystore.jks` base64 hali |
| `ANDROID_KEYSTORE_PASSWORD` | `credentials.json` → `android.keystore.keystorePassword` |
| `ANDROID_KEY_ALIAS` | `credentials.json` → `android.keystore.keyAlias` |
| `ANDROID_KEY_PASSWORD` | `credentials.json` → `android.keystore.keyPassword` |

### 3. Variables'ı girin

Aynı sayfada **Variables** sekmesi (`eas.json` → `build.release-apk.env`):

- `EXPO_PUBLIC_TOKEN_SERVER_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_EAS_PROJECT_ID`
- `EXPO_PUBLIC_ERROR_REPORTING_ENABLED`

Bunlar gizli değildir; APK'nın içine gömülür.

## APK üretme

**Actions → Android Release APK → Run workflow**

Bitince sayfanın altındaki **Artifacts** bölümünden `Sora-release-*` dosyasını
indirin. Bu APK bağımsız release uygulamasıdır; Expo Go veya geliştirme
sunucusu gerektirmez.

## İmza eşleşmesi

Telefonda kurulu uygulamanın **üzerine** sorunsuz kurulabilmesi için aynı
keystore kullanılmalıdır. Doğrulama:

```powershell
# APK'nın imzası
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0\apksigner.bat" verify --print-certs sora.apk

# Keystore'un imzası
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v `
  -keystore credentials\android\keystore.jks -storepass <SIFRE> -alias <ALIAS>
```

İki SHA-256 parmak izi aynı olmalı. Bu projede doğrulandı:
`9D:9F:2D:55:E5:06:B0:D6:...:B0:03:0C:AC:6B`

Farklıysa yeni APK eski uygulamanın üzerine kurulmaz; telefondaki uygulamayı
önce kaldırmanız gerekir (veriler silinir).

## Sürüm yükseltme

Her derlemede `versionCode` artmalıdır:

1. `android/app/build.gradle` → `versionCode` (13 → 14)
2. `android/app/build.gradle` → `versionName` (1.0.2 → 1.0.3)
3. `app.json` → `expo.version`
4. `package.json` → `version`

Sonra commit edip push edin.

## Sorun giderme

### "Yayin imzalama anahtari tanimli degil"
Secret'lar eksik veya workflow secret'ları okumuyor.
`scripts\github-secrets.ps1` ile 4 secret'ı tekrar girin.

### "SORA_RELEASE_STORE_FILE tanimli ancak dosya bulunamadi"
`ANDROID_KEYSTORE_BASE64` bozuk veya yarım kopyalanmış. Base64'ü yeniden
üretin; değerin sonunda satır sonu/boşluk olmamalı.

### "INSTALL_FAILED_UPDATE_INCOMPATIBLE"
İmza anahtarı telefondakinden farklı. Eski uygulamayı kaldırıp yeniden kurun.

### Gradle bağımlılık hatası
Actions'ta **Run workflow** ile tekrar deneyin; geçici ağ hataları olabilir.
Kalıcıysa workflow dosyasındaki `--stacktrace` çıktısından nedeni okuyun.

### Uygulama açılıp hemen kapanıyorsa
APK'yı elle yeniden paketlemeyin. Kaynakta `node --check` çalıştırıp commit
edip yeniden derleyin — elle paketleme Android kaynaklarını bozar.
