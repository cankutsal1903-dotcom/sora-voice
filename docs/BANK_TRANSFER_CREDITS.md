# IBAN ile Manuel Kredi Yükleme

Bu akış otomatik banka doğrulaması yapmaz. Kullanıcı, cüzdandan bir kredi talebi oluşturur; uygulama ona tekil bir `SORA-...` referansı verir. Kullanıcı bu referansı banka transferinin açıklamasına yazar. Yalnızca yönetici hesap hareketini gördükten sonra krediyi ekler.

## Kurulum

1. Supabase SQL Editor'da önce `supabase/migrations/20261106_safety_moderation.sql`, ardından `supabase/migrations/20261106_manual_bank_transfer_credits.sql` dosyasını çalıştır.
2. Kendi kullanıcı hesabını yönetici yap. Supabase Authentication ekranındaki kullanıcının UUID değerini kullan:

```sql
insert into public.app_admins (user_id, role)
values ('KULLANICI_UUID', 'owner')
on conflict (user_id) do update set role = excluded.role;
```

3. Banka bilgileri `src/payments/bankTransfer.js` içinde varsayılan olarak tanımlıdır. Hesap değişirse `.env` dosyasına aşağıdaki `EXPO_PUBLIC_` değerlerini ekleyip Expo sunucusunu yeniden başlat:

```dotenv
EXPO_PUBLIC_BANK_ACCOUNT_HOLDER=Hesap Sahibi
EXPO_PUBLIC_BANK_NAME=Banka Adı
EXPO_PUBLIC_BANK_IBAN=TR000000000000000000000000
```

## Yönetici işlemi

1. Profil → **Yönetim paneli** yolunu aç.
2. Banka hareketindeki tutarı ve transfer açıklamasındaki `SORA-...` referansını talep ile karşılaştır.
3. **Yüklenecek kredi** alanını doğrula veya düzelt.
4. **Onayla ve yükle** seçeneğine bas.

Onay RPC'si talebi kilitler, cüzdanı günceller ve `wallet_transactions` kaydını aynı veritabanı işlemi içinde oluşturur. Aynı talep ikinci kez onaylanamaz.

## Operasyon notları

- Talep oluşturmak kredi vermez; kredi yalnızca `admin` veya `owner` rolü tarafından eklenir.
- Kullanıcının girdiği TL tutarı sadece talep kaydıdır. Bankadaki gerçek tutar, referans ve gönderici bilgisi kontrol edilmeden onay verilmemelidir.
- Fiyat paketlerini uygulama içinde netleştirmeden önce kullanıcıya güncel fiyat listesini duyur. Yönetici gerektiğinde talepteki kredi miktarını düzeltebilir.
- IBAN bilgisi uygulama kullanıcılarına görünür; bu yüzden yalnızca ödeme almak için kullanılacak hesabı tanımla.
