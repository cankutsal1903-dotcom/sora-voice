# Bilgisayarı yormadan APK derleme

Bu proje EAS kotası kullanmadan GitHub Actions üzerinde release APK üretebilir.
Derleme GitHub'ın Linux sunucusunda yapılır.

## Bir defalık kurulum

1. Projeyi özel bir GitHub deposuna yükleyin.
2. Depoda **Settings > Secrets and variables > Actions** bölümünü açın.
3. Şu `Variables` değerlerini ekleyin:
   - `EXPO_PUBLIC_TOKEN_SERVER_URL`
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `EXPO_PUBLIC_EAS_PROJECT_ID`
   - `EXPO_PUBLIC_ERROR_REPORTING_ENABLED`
   - `EXPO_PUBLIC_BANK_ACCOUNT_HOLDER`
   - `EXPO_PUBLIC_BANK_NAME`
   - `EXPO_PUBLIC_BANK_IBAN`
4. Şu `Secrets` değerlerini ekleyin:
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`

`ANDROID_KEYSTORE_BASE64`, daha önceki canlı APK'yı imzalayan aynı `.jks` dosyasının
Base64 karşılığı olmalıdır. Farklı anahtar kullanılırsa eski kurulumun üzerine güncelleme
yapılamaz.

## APK üretme

GitHub'da **Actions > Android Release APK > Run workflow** seçilir. İşlem tamamlandığında
sayfanın `Artifacts` bölümündeki `Sora-release-*` dosyası indirilir.

Bu APK bağımsız release uygulamasıdır; Expo Go veya geliştirme sunucusu gerektirmez.
