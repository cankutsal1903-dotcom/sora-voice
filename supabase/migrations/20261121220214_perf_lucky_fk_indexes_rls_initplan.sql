-- Supabase performans danismani bulgulari:
-- 1) Sansli paket tablolarinda indekssiz yabanci anahtarlar (hesap silmede cascade taramasi, kullaniciya gore sorgular).
-- 2) Gorev/seri RLS politikalari auth.uid() fonksiyonunu her satirda yeniden hesapliyor; (select auth.uid()) bir kez hesaplar.
-- Davranis degismez; yalnizca performans.

create index if not exists room_lucky_packet_claims_user_id_idx
  on public.room_lucky_packet_claims (user_id);
create index if not exists room_lucky_packets_creator_id_idx
  on public.room_lucky_packets (creator_id);

alter policy "Users read own daily missions" on public.user_daily_missions
  using ((select auth.uid()) = user_id);
alter policy "Users read own login streak" on public.user_login_streaks
  using ((select auth.uid()) = user_id);
