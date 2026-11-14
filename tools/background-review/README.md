# Sora · Arka Plan İnceleme (masaüstü)

Oda sahiplerinin gönderdiği arka plan görsellerini bu bilgisayardan incelemek,
onaylamak veya reddetmek için küçük bir GTK 3 uygulaması. Ek paket gerekmez
(Python 3 + `python3-gi` / `gir1.2-gtk-3.0` yeterli).

## Kurulum

```bash
cd tools/background-review
./install.sh
```

Uygulama menüsüne ve masaüstüne **Sora Arka Plan İnceleme** başlatıcısı eklenir.
Masaüstü simgesi "güvenilmiyor" görünürse sağ tıklayıp *Başlatmaya İzin Ver*
seçin. Kurmadan denemek için: `./sora_background_review.py`

Supabase ayarları şu sırayla aranır (ilk bulunan kullanılır):

1. `$SORA_ENV_FILE`
2. `~/.config/sora-background-review/config.env`
3. `/home/omer/Uygulama/.env`

Dosyada `EXPO_PUBLIC_SUPABASE_URL` ve `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
bulunmalıdır.

## Giriş

Yönetici e-posta ve şifrenizle giriş yapın. Hesabın Supabase'deki
`app_admins` tablosunda olması gerekir; değilse uygulama "yönetici yetkisi yok"
uyarısı verir. Oturum `~/.config/sora-background-review/session.json`
dosyasında (yalnızca sizin okuyabileceğiniz şekilde) saklanır ve süresi
dolunca otomatik yenilenir. **Çıkış yap** düğmesi oturumu siler.

## Kullanım

- Bekleyen istekler kart olarak listelenir (oda, gönderen, İstanbul saati,
  küçük resim). Görsele tıklayınca büyük hali açılır.
- **Onayla**: oda arka planı hemen bu görselle değişir.
- **Reddet**: isteğe bağlı bir not yazılabilir.
- Üstteki seçiciyle onaylanan / reddedilen geçmiş istekler görülebilir.
- Liste 30 saniyede bir yenilenir; yeni istek gelince masaüstü bildirimi
  gösterilir. Elle yenilemek için ⟳ düğmesi veya F5.

## "Arka plan değiştirme" anahtarı

Başlıktaki anahtar `room_background_uploads_enabled` ayarını değiştirir.
**Açık**: oda sahipleri uygulamadan yeni arka plan yükleyebilir.
**Kapalı**: yeni yükleme yapılamaz (bekleyen istekler yine incelenebilir).

## Test

```bash
./sora_background_review.py --self-test   # ağ kullanmadan iç testler
```
