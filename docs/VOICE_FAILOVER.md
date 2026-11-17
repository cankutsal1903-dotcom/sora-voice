# Sıralı Çoklu Ses Sağlayıcı Sistemi (Kota Devri)

Sora Voice ses altyapısı, ücretsiz dakika kotalarını tek bir havuz gibi sırayla tüketir ve bir servis %95 eşiğine ulaştığında yeni açılan odaları otomatik olarak sıradaki servise geçirir:

1. **LiveKit Cloud (`livekit`)** — Aylık `5.000` katılımcı-dakika (`%95` = `4.750` dk eşiği, şu an aktif)
2. **Agora RTC (`agora`)** — Aylık `10.000` ücretsiz dakika (`%95` = `9.500` dk eşiği)
3. **Cloudflare Realtime SFU (`cloudflare`)** — Aylık `1.000 GB` ücretsiz trafik (~`250.000+` ses dakikası)
4. **LiveKit Yedek / Kendi Sunucun (`livekit_backup`)** — Sınırsız / yapılandırılabilir dakika

## Temel Kurallar
- **Oda bütünlüğü:** Aynı anda açık ve aktif konuşmacısı olan bir oda ortadan bölünmez; o odadaki herkes başladığı sağlayıcıda kalır, kota eşiği aşıldığında **yeni açılan odalar** sıradaki sağlayıcıya yönlendirilir.
- **Otomatik hata geçişi:** Bir sağlayıcıya erişilemezse istemci `excludeProviders` ile otomatik olarak sıradaki sağlıklı sağlayıcıya geçer.
- **Anahtar eklenene kadar güvenli:** Anahtarı tanımlanmamış sağlayıcılar otomatik devre dışıdır; mevcut LiveKit akışı kesintisiz çalışır.

## Yeni Servis Anahtarlarını Aktifleştirme (APK Yenilemeden)
Mobil uygulama tüm adaptörleri (`LiveKit`, `Agora`, `Cloudflare`) hazır içerir. Yalnızca Supabase Edge Function gizli anahtarlarını tanımlamanız yeterlidir:

```bash
# Agora (10.000 ücretsiz dk/ay ekler)
supabase secrets set --remote=jamvnkspjaatffdgvsxi \
  AGORA_APP_ID="..." \
  AGORA_APP_CERTIFICATE="..."

# Cloudflare Realtime Calls (250.000+ ücretsiz dk/ay ekler)
supabase secrets set --remote=jamvnkspjaatffdgvsxi \
  CF_CALLS_APP_ID="..." \
  CF_CALLS_APP_SECRET="..."

# İkinci / Kendi LiveKit Sunucun (sınırsız dk ekler)
supabase secrets set --remote=jamvnkspjaatffdgvsxi \
  LIVEKIT_BACKUP_URL="wss://..." \
  LIVEKIT_BACKUP_API_KEY="..." \
  LIVEKIT_BACKUP_API_SECRET="..."
```

Anahtar eklendikten sonra `/functions/v1/livekit-token/health` uç noktası aktif sağlayıcı listesini `configuredProviders` alanında otomatik gösterir.
