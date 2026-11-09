# Hesap Sistemi Yayın Ayarları

Bu proje e-posta/parola, telefon OTP, Google ve Apple girişini destekler. Uygulama kodu hazırdır; sağlayıcıların güvenlik bilgileri yalnızca Supabase panosunda tutulur.

## 1. Veritabanı ve hesap silme

1. Proje kökünde Supabase CLI ile oturum açıp projeyi bağla.
2. `supabase/migrations/20261106_account_system.sql` dahil tüm migration'ları uygula.
3. Hesap silme fonksiyonunu dağıt: `npx supabase functions deploy delete-account`.
4. Dağıtımdan sonra Edge Function ortamında `SUPABASE_URL`, `SUPABASE_ANON_KEY` (veya `SUPABASE_PUBLISHABLE_KEY`) ve `SUPABASE_SERVICE_ROLE_KEY` değişkenlerinin bulunduğunu doğrula. Hosted Supabase bunları varsayılan olarak sağlar; service-role anahtarını uygulamaya veya `.env` dosyasına koyma.

Bu migration kullanıcı adını küçük/büyük harf fark etmeksizin benzersiz yapar. Uygulama kayıttan önce kontrol eder; veritabanı aynı anda gelen iki kayıtta da kesin korumayı sağlar.

## 2. Redirect URL'leri

Supabase Dashboard > Authentication > URL Configuration bölümüne şu URL'leri ekle:

- `sora://auth/callback`
- `sora://auth/reset-password`

`app.json` içindeki `scheme` değeri `sora` olarak kalmalıdır. Bu akış geliştirme derlemesi veya imzalı APK/IPA içindir; Expo Go özel URL scheme dönüşlerini üretim uygulaması gibi garanti etmez.

## 3. Google ve Apple

Supabase Dashboard > Authentication > Providers bölümünde Google ve Apple sağlayıcılarını etkinleştir.

- **Google:** Google Cloud Console'da OAuth istemcisi oluştur; Supabase'in gösterdiği callback URL'sini yetkili redirect URL olarak ekle. Client ID ve secret değerlerini yalnızca Supabase sağlayıcı formuna gir.
- **Apple:** Apple Developer hesabında Sign in with Apple özelliğini ve Services ID'yi oluştur; Supabase'in callback URL'sini Return URL olarak ekle. Apple Team ID, Key ID ve özel anahtarı yalnızca Supabase sağlayıcı ayarlarına gir.

Google/Apple ile ilk kez gelen kullanıcıya güvenli varsayılan bir kullanıcı adı verilir. Kullanıcı profil düzenleme ekranından benzersiz adını seçebilir.

## 4. Telefonla giriş

Authentication > Providers bölümünde Phone sağlayıcısını etkinleştir ve bir SMS sağlayıcısı bağla. OTP gönderimleri SMS sağlayıcısına göre ücretlidir; Supabase'in ücretsiz veritabanı planı SMS maliyetini karşılamaz. Canlıya çıkmadan önce Authentication > Rate Limits alanındaki SMS limitlerini ayarla ve CAPTCHA'yı etkinleştir.

Telefon numarası uygulamada E.164 biçimine dönüştürülür. Türkiye için `532 123 45 67` girişi otomatik olarak `+905321234567` olur.

## 5. E-posta ve parola kurtarma

Authentication > Providers > Email bölümünde e-posta doğrulamasını açık tut. Parola sıfırlama bağlantısı `sora://auth/reset-password` adresine döner ve uygulama kullanıcıdan yeni parolasını ister. E-posta şablonlarındaki doğrulama ve kurtarma bağlantılarını Supabase'in varsayılan `ConfirmationURL` değişkeniyle bırak.

## Yayın öncesi kontrol

- E-posta kaydı, doğrulama ve parola sıfırlamayı imzalı Android derlemesinde dene.
- Google ve Apple ile ayrı ayrı yeni kullanıcı ve mevcut kullanıcı girişi dene.
- Telefon OTP için gönderim, yanlış kod ve yeniden gönderim akışlarını dene.
- Aynı kullanıcı adını farklı büyük/küçük harfle kaydetmeyi dene.
- Ayarlar > Hesap ve güvenlik > Hesabımı sil akışını test hesabıyla dene.
