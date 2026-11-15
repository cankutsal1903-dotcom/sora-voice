-- Sora Voice: Günlük 2.000.000 kredi ödülü düzeltmesi, oda mesaj avatarları,
-- 34 özel tasarımlı hediye kataloğu ve kullanıcı seviye / çift seviye coin ödülü / 10'luk rozet sistemi.

-- 1. Oda mesajlarında gönderen profil fotoğrafı ve meta veri desteği
alter table public.room_messages
  add column if not exists sender_avatar_url text,
  add column if not exists sender_avatar_color text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.room_messages rm
set sender_avatar_url = p.avatar_url,
    sender_avatar_color = p.avatar_color
from public.profiles p
where p.id = rm.sender_id
  and (rm.sender_avatar_url is null or rm.sender_avatar_color is null);

create or replace function public.prepare_room_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.body := trim(new.body);
  select p.display_name, p.avatar_url, p.avatar_color
    into new.sender_name, new.sender_avatar_url, new.sender_avatar_color
  from public.profiles p
  where p.id = new.sender_id;

  if new.sender_name is null then
    raise exception 'Sender profile not found';
  end if;

  if not public.can_send_room_message(new.room_id, new.sender_id) then
    raise exception 'Room chat is unavailable';
  end if;

  if exists (
    select 1 from public.user_sanctions
    where user_id = new.sender_id
      and active
      and action in ('chat_mute', 'suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Messaging is restricted';
  end if;

  if coalesce(new.kind, 'text') = 'text' then
    if public.contains_blocked_term(new.body) then
      raise exception 'Message contains blocked language';
    end if;

    if exists (
      select 1 from public.room_messages
      where sender_id = new.sender_id
        and room_id = new.room_id
        and coalesce(kind, 'text') = 'text'
        and public.normalize_moderation_text(body) = public.normalize_moderation_text(new.body)
        and created_at > now() - interval '30 seconds'
    ) then
      raise exception 'Duplicate message';
    end if;
  end if;

  if (
    select count(*) from public.room_messages
    where sender_id = new.sender_id and created_at > now() - interval '10 seconds'
  ) >= 8 then
    raise exception 'Too many messages';
  end if;

  if (
    select count(*) from public.room_messages
    where sender_id = new.sender_id and created_at > now() - interval '5 minutes'
  ) >= 35 then
    raise exception 'Message limit exceeded';
  end if;

  return new;
end;
$$;

-- 2. Cüzdan hareket tiplerine 'level_reward' eklenmesi
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.wallet_transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%type%'
  loop
    execute format('alter table public.wallet_transactions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.wallet_transactions
  add constraint wallet_transactions_type_check
  check (type in (
    'daily_reward',
    'gift',
    'bank_transfer',
    'promo_grant',
    'cosmetic_purchase',
    'family_create',
    'level_reward'
  ));

-- 3. Kullanıcı seviye, çift seviye coin ödülü ve 10 seviyede bir şahşahlı rozet altyapısı
alter table public.profiles
  add column if not exists user_xp bigint not null default 0 check (user_xp >= 0),
  add column if not exists user_level integer not null default 1 check (user_level >= 1);

create table if not exists public.user_level_configs (
  level integer primary key check (level >= 1 and level <= 200),
  min_xp bigint not null check (min_xp >= 0),
  coin_reward integer not null default 0 check (coin_reward >= 0),
  badge_tier integer not null default 0 check (badge_tier >= 0),
  badge_code text not null,
  badge_name text not null
);

alter table public.user_level_configs enable row level security;

drop policy if exists "user_level_configs_select_all" on public.user_level_configs;
create policy "user_level_configs_select_all"
on public.user_level_configs for select
to authenticated
using (true);

create table if not exists public.user_xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  xp_delta bigint not null check (xp_delta > 0),
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

alter table public.user_xp_events enable row level security;

drop policy if exists "user_xp_events_select_own" on public.user_xp_events;
create policy "user_xp_events_select_own"
on public.user_xp_events for select
to authenticated
using (user_id = auth.uid());

create table if not exists public.user_level_reward_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  level integer not null check (level >= 2),
  coins_awarded integer not null default 0 check (coins_awarded >= 0),
  badge_tier integer not null default 0,
  claimed_at timestamptz not null default now(),
  primary key (user_id, level)
);

alter table public.user_level_reward_claims enable row level security;

drop policy if exists "user_level_reward_claims_select_own" on public.user_level_reward_claims;
create policy "user_level_reward_claims_select_own"
on public.user_level_reward_claims for select
to authenticated
using (user_id = auth.uid());

-- Çift seviye ödül fonksiyonu (2. seviyeden başlar; 42 -> 11.200.000, 44 -> 11.400.000, 46 -> 16.000.000, 48 -> 22.000.000)
create or replace function public.even_level_coin_reward(p_level integer)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_level is null or p_level < 2 or (p_level % 2) <> 0 then
    return 0;
  end if;

  return case p_level
    when 2  then 250000
    when 4  then 500000
    when 6  then 750000
    when 8  then 1000000
    when 10 then 1400000
    when 12 then 1800000
    when 14 then 2200000
    when 16 then 2700000
    when 18 then 3200000
    when 20 then 3800000
    when 22 then 4400000
    when 24 then 5000000
    when 26 then 5700000
    when 28 then 6400000
    when 30 then 7200000
    when 32 then 8000000
    when 34 then 8800000
    when 36 then 9600000
    when 38 then 10200000
    when 40 then 10800000
    when 42 then 11200000
    when 44 then 11400000
    when 46 then 16000000
    when 48 then 22000000
    when 50 then 30000000
    when 52 then 38000000
    when 54 then 46000000
    when 56 then 55000000
    when 58 then 65000000
    when 60 then 75000000
    else least(250000000, 75000000 + ((p_level - 60) / 2) * 10000000)
  end;
end;
$$;

create or replace function public.user_badge_tier_for_level(p_level integer)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select least(5, greatest(0, coalesce(p_level, 1) / 10));
$$;

create or replace function public.user_badge_meta_for_level(
  p_level integer,
  out badge_tier integer,
  out badge_code text,
  out badge_name text
)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  badge_tier := public.user_badge_tier_for_level(p_level);
  case badge_tier
    when 0 then
      badge_code := 'sora_crest_t0';
      badge_name := 'Başlangıç Arması';
    when 1 then
      badge_code := 'sora_crest_t1';
      badge_name := 'Gümüş Kanat Rozeti';
    when 2 then
      badge_code := 'sora_crest_t2';
      badge_name := 'Altın Hare Rozeti';
    when 3 then
      badge_code := 'sora_crest_t3';
      badge_name := 'Kristal Taç Rozeti';
    when 4 then
      badge_code := 'sora_crest_t4';
      badge_name := 'Asil Hükümran Rozeti';
    else
      badge_code := 'sora_crest_t5';
      badge_name := 'İmparatorluk Zirve Rozeti';
  end case;
end;
$$;

-- 1..60 kullanıcı seviye tablosu tohumlama
insert into public.user_level_configs (level, min_xp, coin_reward, badge_tier, badge_code, badge_name)
select
  lvl,
  case when lvl = 1 then 0::bigint else (250::bigint * (lvl - 1)::bigint * lvl::bigint) end as min_xp,
  public.even_level_coin_reward(lvl) as coin_reward,
  (public.user_badge_meta_for_level(lvl)).badge_tier,
  (public.user_badge_meta_for_level(lvl)).badge_code,
  (public.user_badge_meta_for_level(lvl)).badge_name
from generate_series(1, 60) as lvl
on conflict (level) do update set
  min_xp = excluded.min_xp,
  coin_reward = excluded.coin_reward,
  badge_tier = excluded.badge_tier,
  badge_code = excluded.badge_code,
  badge_name = excluded.badge_name;

create or replace function public.calculate_user_level_from_xp(p_xp bigint)
returns integer
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_xp bigint := greatest(0, coalesce(p_xp, 0));
  v_level integer := 1;
begin
  select coalesce(max(ulc.level), 1)
    into v_level
  from public.user_level_configs ulc
  where ulc.min_xp <= v_xp;

  if v_level >= 60 then
    while v_level < 120 and v_xp >= (250::bigint * v_level::bigint * (v_level + 1)::bigint) loop
      v_level := v_level + 1;
    end loop;
  end if;

  return v_level;
end;
$$;

-- İç yardımcı: kullanıcıya atomik XP ekler, seviye atlatır ve çift seviyelerdeki coin ödüllerini tekil olarak cüzdana yatırır
create or replace function public.award_user_xp_internal(
  p_user_id uuid,
  p_xp_delta bigint,
  p_event_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_xp bigint;
  v_new_level integer;
  v_lvl integer;
  v_reward integer;
  v_safe_credit integer;
  v_total_credited bigint := 0;
  v_inserted_level integer;
  v_cur_balance integer;
begin
  if p_user_id is null then
    return 0;
  end if;

  if coalesce(p_xp_delta, 0) > 0 then
    if p_event_key is not null then
      insert into public.user_xp_events (user_id, event_key, xp_delta)
      values (p_user_id, p_event_key, p_xp_delta)
      on conflict (user_id, event_key) do nothing;

      if not found then
        return 0;
      end if;
    end if;

    update public.profiles p
    set user_xp = p.user_xp + p_xp_delta,
        updated_at = now()
    where p.id = p_user_id
    returning p.user_xp into v_xp;
  else
    select p.user_xp into v_xp
    from public.profiles p
    where p.id = p_user_id
    for update;
  end if;

  if v_xp is null then
    return 0;
  end if;

  v_new_level := public.calculate_user_level_from_xp(v_xp);

  update public.profiles p
  set user_level = greatest(p.user_level, v_new_level)
  where p.id = p_user_id
  returning p.user_level into v_new_level;

  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  for v_lvl in 2..v_new_level by 2 loop
    v_reward := public.even_level_coin_reward(v_lvl);
    if v_reward > 0 then
      v_inserted_level := null;
      insert into public.user_level_reward_claims (user_id, level, coins_awarded, badge_tier)
      values (p_user_id, v_lvl, v_reward, public.user_badge_tier_for_level(v_lvl))
      on conflict (user_id, level) do nothing
      returning level into v_inserted_level;

      if v_inserted_level is not null then
        select w.balance into v_cur_balance
        from public.wallets w
        where w.user_id = p_user_id
        for update;

        v_safe_credit := greatest(0, least(v_reward, 2140000000 - coalesce(v_cur_balance, 0)));

        if v_safe_credit > 0 then
          update public.wallets w
          set promo_balance = w.promo_balance + v_safe_credit,
              balance = w.balance + v_safe_credit,
              updated_at = now()
          where w.user_id = p_user_id;

          insert into public.wallet_transactions (user_id, amount, type, description, metadata)
          values (
            p_user_id,
            v_safe_credit,
            'level_reward',
            'Seviye ' || v_lvl || ' ödülü',
            jsonb_build_object(
              'level', v_lvl,
              'badge_tier', public.user_badge_tier_for_level(v_lvl),
              'cashout', false,
              'transferable', false
            )
          );

          v_total_credited := v_total_credited + v_safe_credit;
        end if;
      end if;
    end if;
  end loop;

  return v_total_credited;
end;
$$;

create or replace function public.sync_my_user_level()
returns table (
  user_level integer,
  user_xp bigint,
  badge_tier integer,
  badge_code text,
  badge_name text,
  newly_awarded_coins bigint,
  balance integer,
  promo_balance integer,
  paid_balance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_awarded bigint := 0;
  v_lvl integer := 1;
  v_xp bigint := 0;
  v_meta record;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  v_awarded := public.award_user_xp_internal(v_uid, 0, null);

  select p.user_level, p.user_xp
    into v_lvl, v_xp
  from public.profiles p
  where p.id = v_uid;

  select * into v_meta from public.user_badge_meta_for_level(v_lvl);

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  return query
  select
    v_lvl,
    v_xp,
    v_meta.badge_tier,
    v_meta.badge_code,
    v_meta.badge_name,
    v_awarded,
    w.balance,
    w.promo_balance,
    w.paid_balance
  from public.wallets w
  where w.user_id = v_uid;
end;
$$;

revoke all on function public.award_user_xp_internal(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.sync_my_user_level() to authenticated;
grant execute on function public.even_level_coin_reward(integer) to authenticated;
grant execute on function public.calculate_user_level_from_xp(bigint) to authenticated;

-- 4. Günlük ödül RPC düzeltmesi: belirsiz 'balance' sütun hatası giderildi, tutar sunucuda sabit 2.000.000 kredi yapıldı (+500 XP -> ilk alışta Seviye 2 ödülünü de tetikleyebilir)
create or replace function public.claim_daily_reward(p_amount integer default 2000000)
returns table (balance integer, claimed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_daily_reward constant integer := 2000000;
  v_uid uuid := auth.uid();
  v_cur_balance integer;
  v_credit integer;
  v_next_balance integer;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  insert into public.wallets (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select w.balance
    into v_cur_balance
  from public.wallets w
  where w.user_id = v_uid
  for update;

  v_credit := greatest(0, least(c_daily_reward, 2140000000 - coalesce(v_cur_balance, 0)));

  update public.wallets w
  set promo_balance = w.promo_balance + v_credit,
      balance = w.balance + v_credit,
      last_daily_reward_at = current_date,
      updated_at = now()
  where w.user_id = v_uid
    and w.last_daily_reward_at is distinct from current_date
  returning w.balance into v_next_balance;

  if v_next_balance is null then
    select w.balance into v_next_balance
    from public.wallets w
    where w.user_id = v_uid;
    return query select v_next_balance, false;
    return;
  end if;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata)
  values (
    v_uid,
    v_credit,
    'daily_reward',
    'Günlük giriş ödülü',
    jsonb_build_object('cashout', false, 'transferable', false, 'reward_amount', c_daily_reward)
  );

  -- Günlük giriş ayrıca +250 XP kazandırır (seviye ödülü doğarsa cüzdana eklenir)
  perform public.award_user_xp_internal(v_uid, 250, 'daily_reward:' || current_date::text);

  select w.balance into v_next_balance
  from public.wallets w
  where w.user_id = v_uid;

  return query select v_next_balance, true;
end;
$$;

grant execute on function public.claim_daily_reward(integer) to authenticated;

-- 5. 34 Özel Tasarımlı Hediye Kataloğu (4 Kategori: Uygun fiyatlı, Orta seviye, Gösterişli, Oda temalı)
alter table public.gift_catalog
  add column if not exists category text not null default 'affordable',
  add column if not exists sort_order integer not null default 100;

-- Eski düşük fiyatlı ve geçici test hediyelerini silmeden pasifleştir (FK bütünlüğü korunur)
update public.gift_catalog
set active = false;

insert into public.gift_catalog (id, name, icon, color, cost, active, min_family_level, category, sort_order)
values
  -- Uygun fiyatlı (8)
  ('minik_kalp',        'Minik Kalp',        'heart',          '#FF5E8A',    10000, true, 0, 'affordable', 10),
  ('gulumseme',         'Gülümseme',         'happy',          '#FFB02E',    15000, true, 0, 'affordable', 11),
  ('kahve_molasi',      'Kahve Molası',      'cafe',           '#B87444',    25000, true, 0, 'affordable', 12),
  ('renkli_balon',      'Renkli Balon',      'balloon',        '#4DA6FF',    35000, true, 0, 'affordable', 13),
  ('sans_kurabiyesi',   'Şans Kurabiyesi',   'sparkles',       '#E89B2D',    45000, true, 0, 'affordable', 14),
  ('parilti',           'Parıltı',           'sparkles',       '#38B6FF',    60000, true, 0, 'affordable', 15),
  ('ucan_opucuk',       'Uçan Öpücük',       'heart',          '#F24976',    75000, true, 0, 'affordable', 16),
  ('tatli_kedi',        'Tatlı Kedi',        'happy',          '#8B6CEF',    90000, true, 0, 'affordable', 17),

  -- Oda temalı (8)
  ('dinleyici_destegi', 'Dinleyici Desteği', 'headset',        '#2F80ED',    50000, true, 0, 'room',       20),
  ('soz_sende',         'Söz Sende',         'mic',            '#2596FF',    80000, true, 0, 'room',       21),
  ('alkis_yagmuru',     'Alkış Yağmuru',     'sparkles',       '#36A2EB',   120000, true, 0, 'room',       22),
  ('sahne_isigi',       'Sahne Işığı',       'sunny',          '#F5A623',   175000, true, 0, 'room',       23),
  ('mikrofon_yildizi',  'Mikrofon Yıldızı',  'mic',            '#4E7BFF',   240000, true, 0, 'room',       24),
  ('dj_seti',           'DJ Seti',           'musical-notes',  '#7B5CFF',   320000, true, 0, 'room',       25),
  ('konusma_taci',      'Konuşma Tacı',      'trophy',         '#D99B1E',   400000, true, 0, 'room',       26),
  ('oda_yildizi',       'Oda Yıldızı',       'star',           '#1D6FE8',   500000, true, 0, 'room',       27),

  -- Orta seviye (10)
  ('gul_buketi',        'Gül Buketi',        'rose',           '#E03E65',   150000, true, 0, 'mid',        30),
  ('neon_mikrofon',     'Neon Mikrofon',     'mic',            '#00B4FF',   220000, true, 0, 'mid',        31),
  ('disko_topu',        'Disko Topu',        'sparkles',       '#8E54E9',   300000, true, 0, 'mid',        32),
  ('ay_isigi',          'Ay Işığı',          'moon',           '#4B6CB7',   400000, true, 0, 'mid',        33),
  ('yildiz_yagmuru',    'Yıldız Yağmuru',    'star',           '#2B5876',   520000, true, 0, 'mid',        34),
  ('gokkusagi',         'Gökkuşağı',         'sunny',          '#3A8DFF',   650000, true, 0, 'mid',        35),
  ('kristal_kelebek',   'Kristal Kelebek',   'diamond',        '#26C6DA',   800000, true, 0, 'mid',        36),
  ('altin_tac',         'Altın Taç',         'trophy',         '#D49A1A',  1000000, true, 0, 'mid',        37),
  ('ferrari',           'Ferrari',           'car-sport',      '#D92534',  1250000, true, 0, 'mid',        38),
  ('lamborghini',       'Lamborghini',       'car-sport',      '#E09F1F',  1500000, true, 0, 'mid',        39),

  -- Gösterişli (8)
  ('isik_selalesi',     'Işık Şelalesi',     'water',          '#1CA7EC',  2000000, true, 0, 'luxury',     40),
  ('gokyuzu_treni',     'Gökyüzü Treni',     'train',          '#2F6FE0',  3000000, true, 0, 'luxury',     41),
  ('kraliyet_arabasi',  'Kraliyet Arabası',  'car-sport',      '#B8860B',  4200000, true, 0, 'luxury',     42),
  ('kozmik_balina',     'Kozmik Balina',     'water',          '#1B3B82',  5500000, true, 0, 'luxury',     43),
  ('efsanevi_anka',     'Efsanevi Anka',     'flame',          '#E65C00',  7000000, true, 0, 'luxury',     44),
  ('elmas_aslan',       'Elmas Aslan',       'diamond',        '#1E56B5',  8500000, true, 0, 'luxury',     45),
  ('yildiz_gemisi',     'Yıldız Gemisi',     'rocket',         '#183468', 10000000, true, 0, 'luxury',     46),
  ('kraliyet_sahnesi',  'Kraliyet Sahnesi',  'trophy',         '#142952', 12000000, true, 0, 'luxury',     47)
on conflict (id) do update set
  name = excluded.name,
  icon = excluded.icon,
  color = excluded.color,
  cost = excluded.cost,
  active = excluded.active,
  min_family_level = excluded.min_family_level,
  category = excluded.category,
  sort_order = excluded.sort_order;

-- 6. Oda ve aile hediye gönderimlerinde kullanıcı XP + çift seviye coin ödülünü de atomik tetikle
create or replace function public.send_room_gift(
  p_room_id uuid,
  p_gift_id text,
  p_recipient_id uuid,
  p_request_id uuid
)
returns table (
  balance integer,
  message_id uuid,
  message_body text,
  gift_name text,
  gift_cost integer,
  promo_balance integer,
  paid_balance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g public.gift_catalog;
  total integer;
  promo_spent integer;
  paid_spent integer;
  sender_name text;
  recipient_name text;
  new_message public.room_messages;
  prior public.wallet_transactions;
  v_sender_family_id uuid;
  v_sender_family_level integer;
  v_user_xp_gain bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;

  select * into prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = auth.uid();

  if found then
    return query
    select
      w.balance,
      (prior.metadata->>'message_id')::uuid,
      coalesce((select m.body from public.room_messages m where m.id = (prior.metadata->>'message_id')::uuid), ''),
      coalesce(prior.metadata->>'gift_name', 'Hediye'),
      abs(prior.amount),
      w.promo_balance,
      w.paid_balance
    from public.wallets w
    where w.user_id = auth.uid();
    return;
  end if;

  select * into g from public.gift_catalog where id = p_gift_id and active;
  if not found then raise exception 'Gift is unavailable'; end if;
  if p_recipient_id is null then raise exception 'Invalid recipient'; end if;

  select cm.community_id, c.level
    into v_sender_family_id, v_sender_family_level
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  where cm.user_id = auth.uid();

  if coalesce(g.min_family_level, 0) > 0 and coalesce(v_sender_family_level, 0) < g.min_family_level then
    raise exception 'Family level required';
  end if;

  if p_recipient_id = auth.uid() then
    if not exists(
      select 1 from public.rooms r
      join public.room_members s on s.room_id = r.id
      where r.id = p_room_id and r.state = 'live'
        and s.user_id = auth.uid() and s.removed_at is null
    ) then
      raise exception 'Room membership required';
    end if;
  else
    if not exists(
      select 1 from public.rooms r
      join public.room_members s on s.room_id = r.id
      join public.room_members t on t.room_id = r.id
      where r.id = p_room_id and r.state = 'live'
        and s.user_id = auth.uid() and s.removed_at is null
        and t.user_id = p_recipient_id and t.removed_at is null
        and not public.users_blocked(auth.uid(), p_recipient_id)
    ) then
      raise exception 'Room membership required';
    end if;
  end if;

  insert into public.wallets(user_id) values (auth.uid()) on conflict(user_id) do nothing;
  select w.balance, w.promo_balance into total, promo_spent
  from public.wallets w
  where w.user_id = auth.uid()
  for update;

  if total < g.cost then raise exception 'Insufficient balance'; end if;
  promo_spent := least(promo_spent, g.cost);
  paid_spent := g.cost - promo_spent;

  update public.wallets w
  set balance = w.balance - g.cost,
      promo_balance = w.promo_balance - promo_spent,
      paid_balance = w.paid_balance - paid_spent,
      updated_at = now()
  where w.user_id = auth.uid();

  select display_name into sender_name from public.profiles where id = auth.uid();
  select display_name into recipient_name from public.profiles where id = p_recipient_id;

  insert into public.room_messages(room_id, sender_id, body, kind, metadata)
  values (
    p_room_id,
    auth.uid(),
    case
      when p_recipient_id = auth.uid() then sender_name || ' kendine ' || g.name || ' hediyesi gönderdi!'
      else sender_name || ' -> ' || recipient_name || ': ' || g.name || ' hediyesi gönderdi!'
    end,
    'gift',
    jsonb_build_object(
      'gift_id', g.id,
      'gift_name', g.name,
      'gift_icon', g.icon,
      'gift_color', g.color,
      'gift_cost', g.cost,
      'recipient_id', p_recipient_id,
      'recipient_name', recipient_name
    )
  )
  returning * into new_message;

  insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
  values (
    auth.uid(),
    -g.cost,
    'gift',
    g.name || ' hediyesi',
    jsonb_build_object(
      'gift_id', g.id,
      'room_id', p_room_id,
      'recipient_id', p_recipient_id,
      'promo_spent', promo_spent,
      'paid_spent', paid_spent,
      'message_id', new_message.id,
      'gift_name', g.name
    ),
    p_request_id
  );

  if v_sender_family_id is not null then
    perform public.award_family_gift_xp_internal(
      v_sender_family_id,
      auth.uid(),
      'room_gift_sent',
      g.cost::bigint,
      'room_gift:' || p_request_id::text
    );
  end if;

  v_user_xp_gain := greatest(1::bigint, (g.cost::bigint / 1000::bigint));
  perform public.award_user_xp_internal(auth.uid(), v_user_xp_gain, 'room_gift:' || p_request_id::text);

  return query
  select w.balance, new_message.id, new_message.body, g.name, g.cost, w.promo_balance, w.paid_balance
  from public.wallets w
  where w.user_id = auth.uid();
end;
$$;

create or replace function public.send_family_gift(
  p_community_id uuid,
  p_gift_id text,
  p_recipient_id uuid,
  p_quantity integer default 1,
  p_request_id uuid default null
)
returns table (
  message_id uuid,
  message_body text,
  message_metadata jsonb,
  created_at timestamptz,
  balance integer,
  promo_balance integer,
  paid_balance integer,
  gift_name text,
  total_cost bigint,
  awarded_xp bigint,
  family_xp bigint,
  family_level integer,
  gift_coins_total bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_qty integer := coalesce(p_quantity, 1);
  v_gift public.gift_catalog;
  v_family public.communities;
  v_prior public.wallet_transactions;
  v_total_cost bigint;
  v_wallet_balance integer;
  v_wallet_promo integer;
  v_promo_spent integer;
  v_paid_spent integer;
  v_sender_name text;
  v_recipient_name text;
  v_recipient_avatar text;
  v_body text;
  v_meta jsonb;
  v_msg public.family_messages;
  v_xp bigint := 0;
  v_user_xp_gain bigint := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_community_id is null then
    raise exception 'Family not found';
  end if;
  if p_request_id is null then
    raise exception 'Request ID required';
  end if;
  if v_qty < 1 or v_qty > 99 then
    raise exception 'Invalid gift quantity';
  end if;

  select * into v_prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = v_uid;

  if found then
    select * into v_msg
    from public.family_messages
    where id = (v_prior.metadata->>'family_message_id')::uuid;

    select * into v_family
    from public.communities
    where id = p_community_id;

    return query
    select
      v_msg.id,
      coalesce(v_msg.body, ''),
      coalesce(v_msg.metadata, '{}'::jsonb),
      coalesce(v_msg.created_at, v_prior.created_at),
      w.balance,
      w.promo_balance,
      w.paid_balance,
      coalesce(v_prior.metadata->>'gift_name', 'Hediye'),
      abs(v_prior.amount)::bigint,
      coalesce((v_prior.metadata->>'awarded_xp')::bigint, 0::bigint),
      coalesce(v_family.xp, 0::bigint),
      coalesce(v_family.level, 1),
      coalesce(v_family.gift_coins_total, 0::bigint)
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  select * into v_family
  from public.communities
  where id = p_community_id
  for update;

  if not found then
    raise exception 'Family not found';
  end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = v_uid
  ) then
    raise exception 'Family membership required';
  end if;

  if p_recipient_id is null then
    p_recipient_id := v_uid;
  end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = p_recipient_id
  ) then
    raise exception 'Recipient must be in the same family';
  end if;

  if p_recipient_id <> v_uid and public.users_blocked(v_uid, p_recipient_id) then
    raise exception 'Recipient unavailable';
  end if;

  if exists (
    select 1 from public.user_sanctions
    where user_id = v_uid
      and active
      and action in ('chat_mute', 'suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Messaging is restricted';
  end if;

  select * into v_gift
  from public.gift_catalog
  where id = p_gift_id and active;

  if not found then
    raise exception 'Gift is unavailable';
  end if;

  if coalesce(v_gift.min_family_level, 0) > coalesce(v_family.level, 1) then
    raise exception 'Family level required';
  end if;

  v_total_cost := (v_gift.cost::bigint) * (v_qty::bigint);
  if v_total_cost <= 0 or v_total_cost > 2000000000 then
    raise exception 'Invalid gift total';
  end if;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  select w.balance, w.promo_balance
    into v_wallet_balance, v_wallet_promo
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if v_wallet_balance < v_total_cost then
    raise exception 'Insufficient balance';
  end if;

  v_promo_spent := least(v_wallet_promo, v_total_cost::integer);
  v_paid_spent := (v_total_cost::integer) - v_promo_spent;

  update public.wallets w
  set balance = w.balance - (v_total_cost::integer),
      promo_balance = w.promo_balance - v_promo_spent,
      paid_balance = w.paid_balance - v_paid_spent,
      updated_at = now()
  where w.user_id = v_uid;

  v_xp := public.award_family_gift_xp_internal(
    p_community_id,
    v_uid,
    'family_gift_sent',
    v_total_cost,
    'family_gift:' || p_request_id::text
  );

  select display_name into v_sender_name from public.profiles where id = v_uid;
  select display_name, avatar_url
    into v_recipient_name, v_recipient_avatar
  from public.profiles
  where id = p_recipient_id;

  if p_recipient_id = v_uid then
    v_body := coalesce(v_sender_name, 'Üye') || ' kendine ' ||
      case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
      v_gift.name || ' hediyesi gönderdi.';
  else
    v_body := coalesce(v_sender_name, 'Üye') || ' -> ' || coalesce(v_recipient_name, 'Üye') || ' kişisine ' ||
      case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
      v_gift.name || ' hediyesi gönderdi.';
  end if;

  v_meta := jsonb_build_object(
    'gift_id', v_gift.id,
    'gift_name', v_gift.name,
    'gift_icon', v_gift.icon,
    'gift_color', v_gift.color,
    'unit_cost', v_gift.cost,
    'quantity', v_qty,
    'total_cost', v_total_cost,
    'recipient_id', p_recipient_id,
    'recipient_name', coalesce(v_recipient_name, 'Üye'),
    'recipient_avatar_url', v_recipient_avatar,
    'self_gift', (p_recipient_id = v_uid),
    'awarded_xp', v_xp
  );

  insert into public.family_messages (community_id, sender_id, body, kind, metadata, client_message_id)
  values (p_community_id, v_uid, v_body, 'gift', v_meta, p_request_id)
  returning * into v_msg;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -(v_total_cost::integer),
    'gift',
    'Aile hediyesi: ' || v_gift.name,
    v_meta || jsonb_build_object(
      'community_id', p_community_id,
      'family_message_id', v_msg.id,
      'promo_spent', v_promo_spent,
      'paid_spent', v_paid_spent
    ),
    p_request_id
  );

  v_user_xp_gain := greatest(1::bigint, (v_total_cost / 1000::bigint));
  perform public.award_user_xp_internal(v_uid, v_user_xp_gain, 'family_gift:' || p_request_id::text);

  select * into v_family from public.communities where id = p_community_id;

  return query
  select
    v_msg.id,
    v_msg.body,
    v_msg.metadata,
    v_msg.created_at,
    w.balance,
    w.promo_balance,
    w.paid_balance,
    v_gift.name,
    v_total_cost,
    v_xp,
    v_family.xp,
    v_family.level,
    v_family.gift_coins_total
  from public.wallets w
  where w.user_id = v_uid;
end;
$$;
