# Sora Voice — Proje Notları

Expo / React Native (SDK 58) + Supabase + LiveKit sesli sohbet uygulaması.

## Bağlam kuralları (token tasarrufu)
- Yalnızca görevin gerektirdiği dosyaları oku; tüm dosyayı okumak yerine
  `search_files` + aralıklı `read_file` kullan.
- `android/`, `node_modules/`, `assets/`, `*.log`, `*.backup`,
  `package-lock.json` ve `supabase/.temp/` içeriğini bağlama alma.
- Değişiklik yapmadan önce ilgili dosyanın sadece hedef bölümünü oku.
- Yeni paket eklemeden önce `package.json` içeriğini kontrol et.
- Yanıtları kısa tut: kod için yalnızca değişen kısmı/diff özetini ver,
  uzun açıklama ve tekrar eden dosya dökümü yazma.
- Aynı bilgiyi birden fazla dosyada arama; ilk bulguyu kullan.

## Yapı
- `App.js` — ana uygulama kabuğu (tek dosyada büyük UI)
- `src/` — `auth/`, `screens/`, `voice/`, `payments/`, `notifications/`,
  `security/`, `data/`, `theme/`, `ui/`, `observability/`
- `server/` — Express + LiveKit token sunucusu
- `supabase/` — `schema.sql`, `migrations/`, `functions/`
- `docs/` — kurulum ve yayın notları

## Komutlar
- `npm start` — Expo dev sunucusu
- `npm run android` — yerel Android derlemesi
- `npm run check` — `App.js` sözdizimi kontrolü
- `npm run live:server` — LiveKit + token sunucusu (PowerShell)
