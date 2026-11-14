# Oda sahibi kontrolleri

Bu dal şunları ekler: bütünleşik oda sohbeti, yeni alt bar, Oda Ayarları (ad,
açıklama, duyuru, incelemeli arka plan), oda müziği, yöneticiler, mikrofon
istekleri, mikrofondan indirme (10 dk), süreli ban, 4 haneli oda kilidi,
9 / 13 mikrofon + çift koltuğu ve arka plana alınan odanın keşfette kalması.

## Kurulum sırası

1. **Veritabanı:** `supabase/migrations/20261114213000_room_owner_controls.sql`
   - `npx supabase db push` ya da dosya içeriğini Supabase SQL Editor'da bir kez çalıştır.
   - `room-backgrounds` ve `room-music` depolama alanlarını ve ilgili izinleri de oluşturur.
2. **Token sunucusu:** `server/src/index.js` güncellendi. Sunucuyu yeniden başlat
   (`npm run voice:server`). Yeni uç noktalar: `/rooms/:id/seat`, `/rooms/:id/ban`,
   `/rooms/:id/layout`, `/rooms/presence`.
3. **Uygulama:** `expo-image-picker` ve `expo-document-picker` eklendi; yeni APK gerekir.
4. **Arka plan inceleme programı:** `tools/background-review/install.sh` dosyasını çalıştır.
   Ayrıntılar için [README](../tools/background-review/README.md) dosyasına bak. Giriş
   yapan hesabın `app_admins` tablosunda olması gerekir.

## Nasıl çalışır

- **Koltuklar:** Koltuk bilgisi LiveKit katılımcı özniteliğinde (`seat`) tutulur.
  - Koltuk numaraları: oda sahibi 0, çift koltuğu 1, diğer koltuklar 2–13.
  - Kullanıcı odadan çıkınca koltuğu kendiliğinden boşalır.
  - Yalnızca koltukta oturan kişi yayın yapabilir; oda sahibi her zaman yayın yapabilir.
- **Mikrofon isteği:** Dinleyici istek gönderir (`hand_raised_at`). Oda sahibi ya da
  bir yönetici isteği onaylar veya reddeder.
- **Mikrofondan indirme:** İndirilen kişiye `room_members.mic_banned_until` = şimdi + 10 dk
  yazılır. Bu süre dolana kadar yeni istek gönderemez.
- **Ban:** `room_members.banned_until` alanına yazılır; boş bırakılırsa ban kalıcıdır.
  Süre dolunca kullanıcı odaya yeniden girebilir.
- **Oda kilidi:** Şifrenin bcrypt özeti `room_secrets` tablosunda tutulur; istemciler
  bu tabloyu okuyamaz.
  - Oda sahibi ve yöneticiler şifre girmeden girer.
  - 15 dakikada 5 yanlış denemeden sonra deneme engellenir.
- **Oda müziği:** Müzik dosyası `room-music` depolama alanına yüklenir. Çalma durumu
  `rooms.music_state` alanında tutulur ve herkesin cihazında aynı anda çalar.
- **Arka plan:** Görsel önce `room_background_requests` tablosuna inceleme isteği olarak
  düşer. Masaüstü programında onaylanınca `rooms.background_path` güncellenir.
- **Keşfet:** Oda sahibinin uygulaması arka plandayken kalp atışı gecikebilir. Bu
  durumda token sunucusu, oda sahibinin LiveKit'te hâlâ bağlı olup olmadığını kontrol
  eder; bağlıysa oda keşfette kalır.
