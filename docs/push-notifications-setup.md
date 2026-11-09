# Canlı Push Bildirimleri Kurulumu

Bu proje oda bildirimi için Expo Push, takip verisi için Supabase ve güvenli tetikleyici olarak Supabase Database Webhook kullanır. İstemciye yalnızca Expo proje kimliği girilir; LiveKit veya Supabase gizli anahtarları hiçbir zaman mobil uygulamaya eklenmez.

## 1. Veritabanı ve Edge Function

Proje kökünde aşağıdaki komutları çalıştır:

```powershell
npx supabase login
npx supabase link --project-ref PROJE_REFERANSIN
npx supabase db push
npx supabase secrets set WEBHOOK_SECRET=UZUN_RASTGELE_BIR_DEGER
npx supabase functions deploy notify-room-live --no-verify-jwt
```

`WEBHOOK_SECRET` için güvenli, uzun ve benzersiz bir değer kullan. Bu değer yalnızca Supabase Edge Function gizli değişkeninde ve webhook başlığında bulunmalıdır.

## 2. Database Webhook

Supabase Dashboard'da **Database → Webhooks** sayfasından yeni bir webhook oluştur:

- Tablo: `public.rooms`
- Olaylar: `INSERT` ve `UPDATE`
- HTTP yöntemi: `POST`
- URL: `https://PROJE_REFERANSIN.supabase.co/functions/v1/notify-room-live`
- Başlık: `x-webhook-secret: WEBHOOK_SECRET_DEGERIN`

Function yalnızca oda durumu `live` olduğunda ve önceki durum `live` değilken gönderim yapar. Aynı oda için idempotency kaydı yinelenen bildirimleri engeller.

## 3. Expo ve Android

`npx eas init` komutunu çalıştırıp oluşan proje kimliğini yalnızca yerel `.env` dosyandaki `EXPO_PUBLIC_EAS_PROJECT_ID` değişkenine yaz. Android uzaktan bildirimleri için Expo/EAS içinde Firebase Cloud Messaging kimlik bilgileri de yapılandırılmalıdır.

Expo Go ile yerel hatırlatıcı bildirimleri denenebilir. Takip edilen kişinin oda açması gibi uzaktan bildirimler için FCM yapılandırılmış bir development veya production build gerekir.

## 4. Kontrol Listesi

1. Telefonda uygulamaya giriş yap ve bildirim iznini onayla.
2. `device_push_tokens` tablosunda cihaz tokeninin oluştuğunu doğrula.
3. Bir hesabı diğer hesapla takip et.
4. Takip edilen hesabın odasını `scheduled` durumundan `live` durumuna geçir.
5. Edge Function günlüklerinde başarı kaydını ve telefonda bildirimi doğrula.
