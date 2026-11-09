# Push Notifications — Tasarım Belgesi (v2)
_2026-11-06 — Revize edildi_

## Amaç ve Neden
Uygulama kapalıyken de kullanıcıya gerçek telefon bildirimi göndermek:
1. Takip ettiği biri odayı **canlıya** aldığında (`state = 'live'`)
2. Hatırlatıcı koyduğu planlı oda başlamadan ~1 dakika önce

---

## Hedefler
- Çok cihaz desteği: bir kullanıcı birden fazla telefon/tablet kullanabilir
- Android'de tamamen ücretsiz (EAS + FCM v1 + Expo Push)
- iOS'ta sertifika kurulana kadar yalnızca Android hedeflenir
- Webhook gizli header ile doğrulanır; `service_role` anahtarı istemciye asla ulaşmaz
- Yinelenen bildirim gönderilmez (idempotency)
- Geçersiz tokenlar otomatik temizlenir
- Webhook ve migration SQL/CLI ile tekrarlanabilir şekilde kurulur

## Hedef Dışı
- Mevcut uygulama içi bildirim merkezi değiştirilmez
- DM bildirimleri bu kapsamda değil
- APK derleme bu kapsamda değil

## Anti-Hedefler
- `service_role` anahtarı istemciye gitmez
- Ücretli push servisi kullanılmaz
- `profiles.push_token` kolonu eklenmez

---

## Mimari Özet

```
[Telefon]
  ↓ (Expo Push Token)
[device_push_tokens tablosu — RLS korumalı]

[rooms güncellenir → state='live']
  ↓ (Supabase DB Webhook — INSERT veya UPDATE)
[notify-room-live Edge Function]
  ↓ secret header doğrulama
  ↓ takipçi tokenları çek
  ↓ notification_log kontrolü (idempotency)
  ↓ 100'lük batch → Expo Push API
  ↓ geçersiz token temizle

[Kullanıcı hatırlatıcı açar]
  ↓ (client-side)
[expo-notifications scheduleNotificationAsync]
  ↓ notificationId → AsyncStorage (roomId ile eşleştirilmiş)
```

---

## Bileşen 1 — Veritabanı

### `device_push_tokens` tablosu
```sql
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, token)
);

-- RLS
ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Kullanici kendi tokenlarini yonetir"
  ON public.device_push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### `notification_log` tablosu (idempotency)
```sql
CREATE TABLE IF NOT EXISTS public.notification_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key   TEXT NOT NULL UNIQUE,  -- örn: 'room-live:{roomId}:{userId}'
  sent_at     TIMESTAMPTZ DEFAULT now()
);

-- 7 günden eski kayıtlar otomatik silinsin (pg_cron veya TTL politikası)
CREATE INDEX ON public.notification_log (sent_at);
```

### Migration dosyası
`supabase/migrations/20261106_push_notifications.sql` olarak kaydedilir; `supabase db push` ile uygulanır.

---

## Bileşen 2 — Supabase Edge Function: `notify-room-live`

### Tetikleyici
Supabase Webhook: `rooms` tablosu üzerinde **INSERT** ve **UPDATE** olayı.
Edge Function içinde `new.state === 'live' && old?.state !== 'live'` kontrolü yapılır — böylece tekrarlı UPDATE'lerde bildirim gönderilmez.

### Webhook gizli doğrulama
- `WEBHOOK_SECRET` ortam değişkeni Edge Function'a tanımlanır (Supabase paneli → Edge Functions → Secrets)
- Supabase Webhook isteği `x-webhook-secret: <değer>` header'ı ile gönderilir
- Edge Function bu değeri doğrulamadan gelen isteği reddeder (401)

### Çekirdek akış (pseudo-code)
```
1. x-webhook-secret doğrula
2. payload.new.state !== 'live' || payload.old?.state === 'live' → 200 dön, çık
3. roomId = payload.new.id, hostId = payload.new.host_id
4. notification_log'da 'room-live:{roomId}' kaydı var mı? → varsa 200 dön, çık
5. follows tablosundan hostId'yi takip eden userId'leri çek
6. device_push_tokens tablosundan bu userId'lerin tokenlarını çek
7. notification_log'a 'room-live:{roomId}:{userId}' kayıtları ekle (upsert)
8. Expo Push API'ya 100'lük batch'ler halinde gönder
9. Yanıtta DeviceNotRegistered → o tokenı device_push_tokens'tan sil
```

### Servis rolü güvenliği
Edge Function, Supabase'e `service_role` anahtarıyla bağlanır — bu anahtar **yalnızca** Edge Function'ın Supabase Secrets'ında saklanır, istemci koduna hiçbir şekilde girmez.

### Batch ve hata toleransı
- Expo Push API tek çağrıda max 100 token kabul eder; tokenlar 100'lük gruplara bölünür
- Her grup ayrı `fetch` çağrısıyla gönderilir; hata olan grup sessizce loglanır, diğerleri devam eder
- `DeviceNotRegistered` ve `InvalidCredentials` alınan tokenlar `device_push_tokens`'tan silinir

---

## Bileşen 3 — Webhook Kurulumu (CLI ile tekrarlanabilir)

Supabase Webhook panele alternatif olarak SQL ile kurulur:
```sql
-- supabase/migrations/20261106_room_webhook.sql
SELECT supabase_functions.http_request(
  'POST',
  'https://<project>.supabase.co/functions/v1/notify-room-live',
  '{"Content-Type":"application/json","x-webhook-secret":"<secret>"}',
  '{}',
  '5000'
);
```
> Gerçek Supabase Webhook kaydı panelden veya Management API ile yapılır;
> migration dosyası bağımsız dokümantasyon için tutulur.

---

## Bileşen 4 — Android FCM v1 / EAS Credentials

Expo Push, Android'de FCM v1 protokolünü kullanır. Ücretsiz kurulum adımları:

1. **Firebase Console** → proje oluştur (ücretsiz Spark planı)
2. Android uygulaması ekle → `google-services.json` indir
3. `eas credentials` komutuyla EAS'a FCM servis hesabı JSON'ı tanımla
4. `app.json`'a notification channel tanımla:
```json
{
  "expo": {
    "android": {
      "googleServicesFile": "./google-services.json",
      "notification": {
        "channelId": "sora-default",
        "color": "#B5FF78"
      }
    }
  }
}
```
5. EAS Build ile APK/AAB üretildiğinde FCM otomatik devreye girer

> **iOS notu:** Uzak push için Apple Developer sertifikası ($99/yıl) gereklidir.
> iOS desteği bu kapsamda ertelendi; lokal bildirimler simulator'da çalışır.

---

## Bileşen 5 — İstemci (App.js)

### Expo Push Token kayıt akışı
```
Uygulama açılır
  → expo-device ile fiziksel cihaz mı kontrol et
  → expo-notifications izin iste
  → getExpoPushTokenAsync({ projectId }) çağır
  → Supabase'e upsert: device_push_tokens (user_id, token, platform)
```

### Bildirime basma — 3 senaryo

| Durum | Davranış |
|---|---|
| Uygulama **açık** | `addNotificationReceivedListener` yakalanır, uygulama içi bildirim gösterilir |
| Uygulama **arka planda** | `addNotificationResponseReceivedListener` ile `roomId` alınır, ilgili oda açılır |
| Uygulama **tamamen kapalı** | Bildirime basılınca uygulama başlar; `getLastNotificationResponseAsync` ile `roomId` okunur, oda açılır |

Tüm senaryolarda bildirim payload'ı `{ roomId, roomTitle }` içerir.

---

## Bileşen 6 — Yerel Hatırlatıcılar

```
Kullanıcı hatırlatıcı açar (toggleReminder)
  → starts_at ISO string'i Date'e çevir
  → starts_at - 60 saniye = tetikleme zamanı
  → scheduleNotificationAsync({ trigger: { date: triggerDate }, content: {...} })
  → notificationId → AsyncStorage'a kaydet: '@sora/reminder-notif-ids' = { [roomId]: notifId }

Kullanıcı hatırlatıcı kapatır
  → AsyncStorage'dan notifId oku
  → cancelScheduledNotificationAsync(notifId)
  → AsyncStorage'dan sil

Planlı oda güncellenirse (starts_at değişirse)
  → cancel + yeniden schedule (aynı akış)
```

---

## Yaklaşımlar (Tasarım Kararı)

### A: `profiles.push_token` (tek kolon) — REDDEDİLDİ
Birden fazla cihaz desteklenmez; token çakışması yönetilemez.

### B: `device_push_tokens` ayrı tablo — SEÇİLDİ
Çok cihaz, RLS, geçersiz token temizleme, platform ayrımı desteklenir.

### C: FCM doğrudan entegrasyon — REDDEDİLDİ
Expo Push bu katmanı soyutlar; fazladan karmaşıklık gerektirmez.

---

## Güvenlik Özeti
| Kaygı | Çözüm |
|---|---|
| `service_role` istemciye gitmesin | Yalnızca Edge Function Secrets'ta |
| Webhook sahte isteklere açık olmasın | `x-webhook-secret` header zorunluluğu |
| Kullanıcı başka kullanıcının tokenını görmesín | RLS: `auth.uid() = user_id` |
| Yinelenen bildirim | `notification_log` idempotency |
| Geçersiz token birikmesi | `DeviceNotRegistered` alınınca otomatik silme |
