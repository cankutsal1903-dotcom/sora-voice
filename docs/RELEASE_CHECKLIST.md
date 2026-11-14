# Sora Yayın Kontrol Listesi

Bu dosya Android ve iOS mağaza yayınını hazırlamak içindir. Yapılandırma tamamlanmıştır; bu kontrol listesi **derleme komutu değildir**. Kullanıcı açıkça `tamam derleyelim` demeden APK, AAB veya IPA derlemesi başlatılmayacaktır.

## Hazır olanlar

- Uygulama kimlikleri sabittir: Android `com.arescan.soravoice`, iOS `com.arescan.soravoice`.
- Sora logosu uygulama simgesi, açılış ekranı ve Android uyarlanabilir simgesi olarak yapılandırılmıştır.
- Mikrofon, bildirim ve arka planda ses için gerekli uygulama açıklamaları eklenmiştir.
- `eas.json` içinde geliştirme, test APK'sı ve mağaza AAB üretim profilleri bulunur.
- JavaScript hataları, etkinleştirildiğinde token sunucusunun `/errors` yoluna hassas verileri ayıklanarak kaydedilir. Sunucu günlüklerini kalıcı diske ve log rotasyonuna sahip bir barındırmada tutun.

## Yayından önce zorunlu işlemler

1. `docs/PRIVACY_POLICY.md` içindeki `DESTEK_E_POSTA_ADRESI` alanını gerçek destek adresiyle değiştirin.
2. Politikayı kendi alan adınızda HTTPS ile yayımlayın; mağaza listelerinde bu açık URL'yi kullanın.
3. Üretim `.env` dosyasında erişilebilir HTTPS token sunucusu adresini ve `EXPO_PUBLIC_ERROR_REPORTING_ENABLED=true` değerini ayarlayın. Bu değerler gizli değildir; LiveKit ve Supabase sunucu sırlarını sadece sunucu ortamında saklayın.
4. Supabase, LiveKit, push bildirimleri ve moderasyon akışlarını gerçek cihazda üretim adresleriyle doğrulayın.
5. Android dijital kredileri için Google Play Billing'i ve sunucuda satın alma doğrulamasını yapılandırıp gerçek cihazda doğrulayın. iOS sürümünde App Store'un uygulama içi satın alma akışını kullanın.

## Android: imzalama ve Play Store

1. Google Play Console'da uygulamayı **aynı paket adıyla** oluşturun. Paket adı yayımlandıktan sonra değiştirilemez.
2. Expo hesabınızla EAS yapılandırmasını bağlayın: `npx eas init`. Bu adım `EXPO_PUBLIC_EAS_PROJECT_ID` değerini uygulama yapılandırmasına ekler.
3. İmzalama anahtarını EAS ile yönetin: `npx eas credentials --platform android`. Keystore'u dışa aktarırsanız güvenli, şifreli bir yerde saklayın; projeye veya `.env` dosyasına koymayın.
4. Yayın zamanı üretim profili Android App Bundle (`.aab`) oluşturur. Telefonda
   canlı test için `release-apk` profilini kullanın — bu da gerçek release
   derlemesidir, yalnızca paket biçimi APK'dır. `preview` profili artık test
   amaçlı önerilmez (env değişkenleri eksik kalabilir).
5. Play Console'a AAB'yi önce dahili test kanalına gönderin; izin beyanlarını, Data Safety formunu, mağaza açıklamasını, ekran görüntülerini ve gizlilik URL'sini tamamlayın.

## iOS: imzalama ve App Store

1. Apple Developer Program hesabında `com.arescan.soravoice` için App ID oluşturun ve mikrofon/Push Notifications yeteneklerini açın.
2. App Store Connect'te aynı bundle identifier ile uygulama kaydını oluşturun.
3. EAS, bağlı Apple hesabı üzerinden dağıtım sertifikası ve provisioning profile oluşturabilir veya mevcut kimlik bilgilerinizi kullanabilir: `npx eas credentials --platform ios`.
4. iOS paketi Windows'ta yerel olarak derlenmez; EAS'ın bulut derlemesiyle üretim IPA'sı hazırlanır ve App Store Connect'e yüklenir.
5. App Privacy formunu bu projedeki gizlilik politikasına ve gerçekten etkin olan sağlayıcılara göre doldurun.

## Derleme zamanı komutları

Bu komutları yalnızca yayın kontrolü tamamlanıp `tamam derleyelim` denildiğinde çalıştırın:

```powershell
npx eas login
npx eas init
npx eas credentials --platform android

# Telefonda canli test icin (gercek release derlemesi, APK):
npm run live:build

# Google Play icin (AAB):
npm run store:build

npx eas build --platform ios --profile production
```

İndirdiğiniz APK'nın gerçekten yayın anahtarıyla imzalı olduğunu doğrulayın:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-apk.ps1 -Apk "C:\yol\sora.apk"
```

Teslim komutlarını derleme tamamlandıktan ve mağaza hesapları bağlandıktan sonra kullanın:

```powershell
npx eas submit --platform android --profile production
npx eas submit --platform ios --profile production
```

## Mağaza içerik kontrolü

- Mağaza adı, kısa/açıklayıcı metinler, kategori, destek e-postası ve gizlilik URL'si tamamdır.
- En az telefon ve tablet ekran görüntüleri hazırdır.
- Hesap oluşturma varsa mağaza incelemesi için çalışan demo hesap veya giriş talimatı vardır.
- Kullanıcı içeriği, şikâyet, engelleme ve moderasyon akışları görünür ve çalışır durumdadır.
- Her yeni mağaza gönderiminde sürüm numarası ve sürüm notu güncellenir.
