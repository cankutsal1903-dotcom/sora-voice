# Kalıcı Veri Kurulumu

1. Supabase projesinde **SQL Editor** bölümünü aç.
2. `supabase/schema.sql` dosyasının tamamını yeni sorguya yapıştırıp **Run** seçeneğini çalıştır.
3. Uygulamada kayıtlı bir hesapla giriş yapıp yeni bir oda oluştur.

Bu şema; `rooms`, `room_messages`, `follows`, `wallets` ve `wallet_transactions` tablolarını RLS kurallarıyla oluşturur. Cüzdan bakiyesi yalnızca güvenli veritabanı fonksiyonları üzerinden değişir; istemci doğrudan bakiye güncelleyemez.

Uygulamada yalnızca Supabase URL ve publishable key bulunur. Veritabanı şifresi ile secret/service-role anahtarlarını mobil uygulamaya eklemeyin.
