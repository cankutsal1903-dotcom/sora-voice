# Sora Güvenlik Kurulumu

Uygulama tarafındaki şikâyet, engelleme, spam/küfür filtresi ve yönetim paneli
`supabase/migrations/20261106_safety_moderation.sql` veritabanı güncellemesini kullanır.

## Veritabanı güncellemesi

Supabase CLI proje ile bağlıysa:

```powershell
npx supabase db push
```

CLI bağlı değilse migration dosyasının içeriğini Supabase Dashboard içindeki SQL Editor'da bir kez çalıştır.

## İlk yöneticiyi tanımlama

Önce uygulamada oturum aç. Ardından SQL Editor'da kendi profilini yönetici yap:

```sql
insert into public.app_admins (user_id, role)
select id, 'owner'
from public.profiles
where handle = 'KULLANICI_ADIN'
on conflict (user_id) do update set role = excluded.role;
```

Uygulamayı yeniden açtığında Profil ekranında **Yönetim paneli** görünür. Bu bağlantı sadece
`app_admins` tablosunda kaydı bulunan hesaplara gösterilir; panel sorguları ayrıca veritabanında
yetki kontrolünden geçer.

## Koruma katmanları

- Engelleme karşılıklı takip bağlantısını siler ve engellenen kişinin oda mesajlarını gizler.
- Engellenen kullanıcılar birbirlerinin odalarını göremez ve oda kimliğiyle doğrudan katılamaz.
- Mesaj filtresi tekrar mesajı, kısa süreli yoğun gönderimi ve yönetilen yasaklı terimleri reddeder.
- Şikâyet gönderimi kullanıcı başına saatte 10 kayıtla sınırlandırılır.
- Şikâyet kayıtları kullanıcı tarafından değiştirilemez; yalnızca yönetici inceleyebilir.
- Moderatör raporu inceleyebilir, kapatabilir, uyarı veya en fazla 24 saat sohbet susturması uygulayabilir.
- Yönetici hesapları 7 gün askıya alabilir; yalnızca owner rolü süresiz yasak uygulayabilir.
- Askıya alınan veya yasaklanan ev sahibinin aktif odaları kapatılır ve yeni oda oluşturması engellenir.
- Filtre ve spam kontrolleri yalnızca arayüzde değil, veritabanı tetikleyicisinde de uygulanır.
