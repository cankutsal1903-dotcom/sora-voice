-- Aile sistemi, 8 haneli benzersiz kullanıcı/aile ID'leri, 10.000.000 coin atomik aile kurma,
-- tek aile üyeliği kısıtı, RLS korumalı aile sohbeti, aile içi (kendine ve üyelere) hediye gönderimi
-- ve hediye hacmine bağlı 2x katlanan aile seviyeleri (10.000.000 coin = 100.000 XP).

begin;

-- ── 0. Cüzdan kova ve kozmetik önkoşulları (idempotent, yıkıcı olmayan) ─────────
alter table public.wallets
  add column if not exists promo_balance integer not null default 0 check (promo_balance >= 0);
alter table public.wallets
  add column if not exists paid_balance integer not null default 0 check (paid_balance >= 0);

update public.wallets
set paid_balance = balance
where paid_balance = 0 and promo_balance = 0 and balance > 0;

alter table public.wallets drop constraint if exists wallets_balance_buckets_check;
alter table public.wallets add constraint wallets_balance_buckets_check
  check (balance = promo_balance + paid_balance) not valid;
alter table public.wallets validate constraint wallets_balance_buckets_check;

create or replace function public.sync_wallet_balance_buckets()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.balance is distinct from old.balance
     and new.promo_balance is not distinct from old.promo_balance
     and new.paid_balance is not distinct from old.paid_balance then
    new.paid_balance := greatest(0, new.balance - new.promo_balance);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_wallet_balance_buckets_before_update on public.wallets;
create trigger sync_wallet_balance_buckets_before_update
  before update on public.wallets
  for each row execute function public.sync_wallet_balance_buckets();

alter table public.wallet_transactions
  add column if not exists idempotency_key uuid;

create unique index if not exists wallet_transactions_idempotency_key_idx
  on public.wallet_transactions(idempotency_key)
  where idempotency_key is not null;

alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check
  check (type in ('daily_reward', 'gift', 'bank_transfer', 'promo_grant', 'cosmetic_purchase', 'family_create'));

alter table public.profiles add column if not exists active_frame_id text;
alter table public.profiles add column if not exists active_profile_theme_id text;

create table if not exists public.profile_item_catalog (
  id text primary key,
  name text not null check (char_length(name) between 1 and 40),
  item_type text not null check (item_type in ('frame', 'theme')),
  appearance jsonb not null default '{}'::jsonb,
  cost integer not null check (cost > 0),
  active boolean not null default true,
  purchasable boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profile_item_catalog
  add column if not exists purchasable boolean not null default true;

alter table public.profile_item_catalog enable row level security;
drop policy if exists "Authenticated users read profile item catalog" on public.profile_item_catalog;
create policy "Authenticated users read profile item catalog"
  on public.profile_item_catalog for select to authenticated using (active);

create table if not exists public.user_profile_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.profile_item_catalog(id),
  purchased_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.user_profile_items enable row level security;
drop policy if exists "Users read their profile items" on public.user_profile_items;
create policy "Users read their profile items"
  on public.user_profile_items for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.profile_item_catalog, public.user_profile_items to authenticated;

insert into public.profile_item_catalog (id, name, item_type, appearance, cost, active, purchasable)
values
  ('frame_sky', 'Gökyüzü çerçevesi', 'frame', '{"color":"#58BCEB","width":3}'::jsonb, 180, true, true),
  ('frame_amber', 'Kehribar çerçeve', 'frame', '{"color":"#E5B94F","width":3}'::jsonb, 260, true, true),
  ('frame_lilac', 'Leylak çerçevesi', 'frame', '{"color":"#A78BFA","width":3}'::jsonb, 340, true, true),
  ('theme_ocean', 'Okyanus profili', 'theme', '{"background":"#E7F6FC","accent":"#258FB8"}'::jsonb, 220, true, true),
  ('theme_midnight', 'Gece profili', 'theme', '{"background":"#E8EAF5","accent":"#5B63B8"}'::jsonb, 300, true, true),
  ('theme_sunrise', 'Gün doğumu profili', 'theme', '{"background":"#FFF1E6","accent":"#D98257"}'::jsonb, 380, true, true),
  ('frame_family_silver', 'Aile Gümüş Çerçevesi', 'frame', '{"color":"#4C9AFF","width":3.5}'::jsonb, 1, true, false),
  ('frame_family_royal', 'Aile Asil Çerçevesi', 'frame', '{"color":"#1D5FBF","width":4}'::jsonb, 1, true, false)
on conflict (id) do update
set name = excluded.name,
    appearance = excluded.appearance,
    active = excluded.active,
    purchasable = excluded.purchasable;

-- ── 1. 8 Haneli Benzersiz Özel ID ve Üstel (2x) Aile XP Kolonları ────────────────
alter table public.profiles
  add column if not exists public_id text;

alter table public.communities
  add column if not exists family_code text,
  add column if not exists avatar_url text check (avatar_url is null or char_length(avatar_url) <= 600),
  add column if not exists xp bigint not null default 0 check (xp >= 0),
  add column if not exists gift_coins_total bigint not null default 0 check (gift_coins_total >= 0),
  add column if not exists level integer not null default 1 check (level >= 1);

alter table public.communities
  alter column xp type bigint using xp::bigint;

create or replace function public.generate_unique_8digit_code(p_target text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate text;
  v_exists boolean;
  v_attempt integer;
begin
  for v_attempt in 1..64 loop
    v_candidate := (floor(random() * 90000000)::bigint + 10000000)::text;
    if p_target = 'profiles' then
      select exists(select 1 from public.profiles where public_id = v_candidate) into v_exists;
    elsif p_target = 'communities' then
      select exists(select 1 from public.communities where family_code = v_candidate) into v_exists;
    else
      raise exception 'Unsupported code target';
    end if;
    if not v_exists then
      return v_candidate;
    end if;
  end loop;
  raise exception 'Could not allocate unique 8-digit code';
end;
$$;

do $$
declare
  r record;
begin
  for r in select id from public.profiles where public_id is null or public_id !~ '^[1-9][0-9]{7}$' loop
    update public.profiles
    set public_id = public.generate_unique_8digit_code('profiles')
    where id = r.id;
  end loop;

  for r in select id from public.communities where family_code is null or family_code !~ '^[1-9][0-9]{7}$' loop
    update public.communities
    set family_code = public.generate_unique_8digit_code('communities')
    where id = r.id;
  end loop;
end;
$$;

alter table public.profiles
  alter column public_id set not null;
alter table public.profiles drop constraint if exists profiles_public_id_format_check;
alter table public.profiles add constraint profiles_public_id_format_check
  check (public_id ~ '^[1-9][0-9]{7}$');
create unique index if not exists profiles_public_id_key on public.profiles(public_id);

alter table public.communities
  alter column family_code set not null;
alter table public.communities drop constraint if exists communities_family_code_format_check;
alter table public.communities add constraint communities_family_code_format_check
  check (family_code ~ '^[1-9][0-9]{7}$');
create unique index if not exists communities_family_code_key on public.communities(family_code);

create or replace function public.before_profile_public_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.public_id is null or new.public_id !~ '^[1-9][0-9]{7}$'
       or exists (select 1 from public.profiles where public_id = new.public_id) then
      new.public_id := public.generate_unique_8digit_code('profiles');
    end if;
  elsif tg_op = 'UPDATE' then
    new.public_id := old.public_id;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_profile_public_id on public.profiles;
create trigger ensure_profile_public_id
  before insert or update on public.profiles
  for each row execute function public.before_profile_public_id();

create or replace function public.before_community_family_code()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.family_code is null or new.family_code !~ '^[1-9][0-9]{7}$'
       or exists (select 1 from public.communities where family_code = new.family_code) then
      new.family_code := public.generate_unique_8digit_code('communities');
    end if;
  elsif tg_op = 'UPDATE' then
    new.family_code := old.family_code;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_community_family_code on public.communities;
create trigger ensure_community_family_code
  before insert or update on public.communities
  for each row execute function public.before_community_family_code();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt integer;
  v_constraint text;
begin
  for v_attempt in 1..8 loop
    begin
      insert into public.profiles (id, handle, display_name, public_id)
      values (
        new.id,
        lower(coalesce(nullif(new.raw_user_meta_data ->> 'handle', ''), 'user_' || substr(replace(new.id::text, '-', ''), 1, 12))),
        coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Sora kullanıcısı'),
        public.generate_unique_8digit_code('profiles')
      )
      on conflict (id) do nothing;
      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'profiles_public_id_key' or v_attempt = 8 then
          raise;
        end if;
    end;
  end loop;
  return new;
end;
$$;

-- ── 2. Aile Profil Fotoğrafı Deposu (family-avatars) ────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-avatars', 'family-avatars', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Family avatar images are public" on storage.objects;
create policy "Family avatar images are public" on storage.objects
  for select using (bucket_id = 'family-avatars');

drop policy if exists "Users upload family avatar in own folder" on storage.objects;
create policy "Users upload family avatar in own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'family-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update family avatar in own folder" on storage.objects;
create policy "Users update family avatar in own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'family-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete family avatar in own folder" on storage.objects;
create policy "Users delete family avatar in own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'family-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 3. Tek Aile Üyeliği Kısıtı & Doğrudan Yazma Kilidi ──────────────────────────
insert into public.community_members (community_id, user_id, role)
select c.id, c.owner_id, 'owner'
from public.communities c
where c.owner_id is not null
on conflict (community_id, user_id) do update set role = 'owner';

with ranked_memberships as (
  select community_id, user_id,
    row_number() over (
      partition by user_id
      order by case when role = 'owner' then 0 else 1 end, joined_at desc
    ) as rn
  from public.community_members
)
delete from public.community_members cm
using ranked_memberships rm
where cm.community_id = rm.community_id
  and cm.user_id = rm.user_id
  and rm.rn > 1;

create unique index if not exists community_members_single_family_idx
  on public.community_members(user_id);

drop policy if exists "Users create communities" on public.communities;
drop policy if exists "Owners update communities" on public.communities;
drop policy if exists "Owners delete communities" on public.communities;
drop policy if exists "Users join communities" on public.community_members;
drop policy if exists "Users leave communities" on public.community_members;

-- ── 4. Hediye Kataloğu ve 2x Katlanan Aile Seviyeleri (10M Coin = 100K XP) ──────
alter table public.gift_catalog
  add column if not exists min_family_level integer not null default 0 check (min_family_level >= 0);

update public.gift_catalog
set icon = 'trophy'
where icon = 'crown';

insert into public.gift_catalog (id, name, icon, color, cost, active, min_family_level)
values
  ('family_crest', 'Aile Sancağı', 'shield', '#2F80ED', 200, true, 4),
  ('crystal_mic', 'Kristal Mikrofon', 'mic', '#3B82F6', 5000, true, 0),
  ('sapphire_wing', 'Safir Kanat', 'airplane', '#2563EB', 50000, true, 0),
  ('northern_star', 'Kuzey Yıldızı', 'planet', '#1D5FBF', 250000, true, 0),
  ('sora_palace', 'Sora Kalesi', 'diamond', '#1E40AF', 1000000, true, 0)
on conflict (id) do update
  set name = excluded.name,
      icon = excluded.icon,
      color = excluded.color,
      cost = excluded.cost,
      active = excluded.active,
      min_family_level = excluded.min_family_level;

-- Her seviye geçişinde gereken XP bir öncekinin 2 katıdır:
-- Sv.1 -> Sv.2: 100.000 XP (10.000.000 kredi)   => toplam eşik: 100.000
-- Sv.2 -> Sv.3: 200.000 XP (20.000.000 kredi)   => toplam eşik: 300.000
-- Sv.3 -> Sv.4: 400.000 XP (40.000.000 kredi)   => toplam eşik: 700.000
-- Sv.4 -> Sv.5: 800.000 XP (80.000.000 kredi)   => toplam eşik: 1.500.000
-- Sv.5 -> Sv.6: 1.600.000 XP (160.000.000 kredi)=> toplam eşik: 3.100.000
create or replace function public.calculate_family_level(p_xp bigint)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_remaining bigint := greatest(0, coalesce(p_xp, 0));
  v_level integer := 1;
  v_step bigint := 100000;
begin
  while v_remaining >= v_step and v_level < 50 loop
    v_remaining := v_remaining - v_step;
    v_level := v_level + 1;
    v_step := v_step * 2;
  end loop;
  return v_level;
end;
$$;

create table if not exists public.family_level_configs (
  level integer primary key check (level >= 1),
  min_xp bigint not null check (min_xp >= 0),
  title text not null check (char_length(title) between 2 and 48),
  badge_code text,
  frame_item_id text references public.profile_item_catalog(id),
  gift_unlock_id text references public.gift_catalog(id),
  member_limit integer not null default 40 check (member_limit >= 5),
  perk_label text not null
);

alter table public.family_level_configs
  alter column min_xp type bigint using min_xp::bigint;

alter table public.family_level_configs enable row level security;
drop policy if exists "Authenticated users read family levels" on public.family_level_configs;
create policy "Authenticated users read family levels"
  on public.family_level_configs for select to authenticated using (true);

insert into public.family_level_configs (level, min_xp, title, badge_code, frame_item_id, gift_unlock_id, member_limit, perk_label)
values
  (1, 0, 'Başlangıç Ailesi', 'family_lv1', null, null, 30, 'Aile sohbeti, hediyeleşme ve 30 üye kapasitesi'),
  (2, 100000, 'Yükselen Aile', 'family_lv2', null, null, 45, 'Yükselen Aile rozeti ve 45 üye kapasitesi (+100.000 XP)'),
  (3, 300000, 'Parlayan Aile', 'family_lv3', 'frame_family_silver', null, 60, 'Aile Gümüş profil çerçevesi ve 60 üye kapasitesi (+200.000 XP)'),
  (4, 700000, 'Seçkin Aile', 'family_lv4', null, 'family_crest', 80, 'Aile Sancağı hediyesi kilidi ve 80 üye kapasitesi (+400.000 XP)'),
  (5, 1500000, 'Asil Aile', 'family_lv5', 'frame_family_royal', null, 100, 'Aile Asil profil çerçevesi ve 100 üye kapasitesi (+800.000 XP)'),
  (6, 3100000, 'Zirve Ailesi', 'family_lv6', null, null, 130, 'Zirve Ailesi rozeti ve 130 üye kapasitesi (+1.600.000 XP)'),
  (7, 6300000, 'Sancak Ailesi', 'family_lv7', null, null, 160, 'Sancak Ailesi rozeti ve 160 üye kapasitesi (+3.200.000 XP)'),
  (8, 12700000, 'Hükümran Aile', 'family_lv8', null, null, 200, 'Hükümran Aile rozeti ve 200 üye kapasitesi (+6.400.000 XP)'),
  (9, 25500000, 'Efsane Aile', 'family_lv9', null, null, 250, 'Efsane Aile rozeti ve 250 üye kapasitesi (+12.800.000 XP)'),
  (10, 51100000, 'İmparatorluk Ailesi', 'family_lv10', null, null, 300, 'İmparatorluk Ailesi rozeti ve 300 üye kapasitesi (+25.600.000 XP)')
on conflict (level) do update
  set min_xp = excluded.min_xp,
      title = excluded.title,
      badge_code = excluded.badge_code,
      frame_item_id = excluded.frame_item_id,
      gift_unlock_id = excluded.gift_unlock_id,
      member_limit = excluded.member_limit,
      perk_label = excluded.perk_label;

create table if not exists public.family_xp_rules (
  event_type text primary key,
  xp_amount integer not null check (xp_amount > 0),
  daily_user_cap integer not null default 1 check (daily_user_cap >= 1),
  label text not null
);

alter table public.family_xp_rules enable row level security;
drop policy if exists "Authenticated users read family xp rules" on public.family_xp_rules;
create policy "Authenticated users read family xp rules"
  on public.family_xp_rules for select to authenticated using (true);

delete from public.family_xp_rules
where event_type in ('daily_checkin', 'family_message', 'member_joined');

insert into public.family_xp_rules (event_type, xp_amount, daily_user_cap, label)
values
  ('family_gift_sent', 100000, 1000000, 'Aile içi hediye gönderimi: 10.000.000 kredi = +100.000 XP (100 kredi = +1 XP)'),
  ('room_gift_sent', 100000, 1000000, 'Canlı odada hediye gönderimi: 10.000.000 kredi = +100.000 XP (100 kredi = +1 XP)')
on conflict (event_type) do update
  set xp_amount = excluded.xp_amount,
      daily_user_cap = excluded.daily_user_cap,
      label = excluded.label;

create table if not exists public.family_xp_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null references public.family_xp_rules(event_type),
  dedupe_key text not null,
  coins_spent bigint not null default 0 check (coins_spent >= 0),
  xp_awarded bigint not null default 0 check (xp_awarded >= 0),
  event_date date not null default (timezone('utc', now()))::date,
  created_at timestamptz not null default now(),
  unique (community_id, dedupe_key)
);

alter table public.family_xp_events
  add column if not exists coins_spent bigint not null default 0 check (coins_spent >= 0);

alter table public.family_xp_events drop constraint if exists family_xp_events_xp_awarded_check;
alter table public.family_xp_events
  alter column xp_awarded type bigint using xp_awarded::bigint;
alter table public.family_xp_events add constraint family_xp_events_xp_awarded_check
  check (xp_awarded >= 0);

create index if not exists family_xp_events_daily_cap_idx
  on public.family_xp_events(community_id, actor_id, event_type, event_date);

alter table public.family_xp_events enable row level security;
drop policy if exists "Family members read xp events" on public.family_xp_events;
create policy "Family members read xp events"
  on public.family_xp_events for select to authenticated
  using (
    exists (
      select 1 from public.community_members cm
      where cm.community_id = family_xp_events.community_id
        and cm.user_id = (select auth.uid())
    )
  );

create table if not exists public.family_reward_grants (
  community_id uuid not null references public.communities(id) on delete cascade,
  level integer not null references public.family_level_configs(level),
  user_id uuid not null references public.profiles(id) on delete cascade,
  frame_item_id text references public.profile_item_catalog(id),
  badge_code text,
  granted_at timestamptz not null default now(),
  primary key (community_id, level, user_id)
);

alter table public.family_reward_grants enable row level security;
drop policy if exists "Users read own family reward grants" on public.family_reward_grants;
create policy "Users read own family reward grants"
  on public.family_reward_grants for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.family_level_configs, public.family_xp_rules, public.family_xp_events, public.family_reward_grants to authenticated;

-- ── 5. Aile Sohbeti (Mesaj + Hediye Kartı, yalnızca üyeler arası RLS korumalı) ───
create table if not exists public.family_messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  kind text not null default 'text' check (kind in ('text', 'gift')),
  metadata jsonb not null default '{}'::jsonb,
  client_message_id uuid,
  created_at timestamptz not null default now()
);

alter table public.family_messages
  add column if not exists kind text not null default 'text' check (kind in ('text', 'gift')),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists family_messages_sender_client_id_idx
  on public.family_messages(sender_id, client_message_id)
  where client_message_id is not null;

create index if not exists family_messages_community_created_idx
  on public.family_messages(community_id, created_at desc);

alter table public.family_messages enable row level security;

drop policy if exists "Family members read family messages" on public.family_messages;
create policy "Family members read family messages"
  on public.family_messages for select to authenticated
  using (
    exists (
      select 1 from public.community_members cm
      where cm.community_id = family_messages.community_id
        and cm.user_id = (select auth.uid())
    )
  );

grant select on public.family_messages to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.family_messages;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

-- ── 6. İç Yardımcılar: Hediye XP Motoru (100 Coin = 1 XP) ve Ödül Eşitleme ──────
create or replace function public.sync_family_rewards_for_user(p_community_id uuid, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_level integer;
  v_cfg record;
  v_granted integer := 0;
begin
  if not exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = p_user_id
  ) then
    return 0;
  end if;

  select c.level into v_level from public.communities c where c.id = p_community_id;
  if v_level is null then return 0; end if;

  for v_cfg in
    select level, badge_code, frame_item_id
    from public.family_level_configs
    where level <= v_level and (badge_code is not null or frame_item_id is not null)
    order by level
  loop
    insert into public.family_reward_grants (community_id, level, user_id, frame_item_id, badge_code)
    values (p_community_id, v_cfg.level, p_user_id, v_cfg.frame_item_id, v_cfg.badge_code)
    on conflict (community_id, level, user_id) do nothing;

    if found then
      v_granted := v_granted + 1;
    end if;

    if v_cfg.frame_item_id is not null then
      insert into public.user_profile_items (user_id, item_id)
      values (p_user_id, v_cfg.frame_item_id)
      on conflict (user_id, item_id) do nothing;
    end if;
  end loop;

  return v_granted;
end;
$$;

create or replace function public.award_family_gift_xp_internal(
  p_community_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_coins_spent bigint,
  p_dedupe_key text
)
returns table (awarded_xp bigint, new_xp bigint, new_level integer, new_gift_coins bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean_coins bigint := greatest(0, coalesce(p_coins_spent, 0));
  v_family public.communities;
  v_old_coins bigint;
  v_next_coins bigint;
  v_delta_xp bigint;
  v_next_xp bigint;
  v_next_level integer;
  v_inserted_id uuid;
begin
  select * into v_family from public.communities c where c.id = p_community_id for update;
  if not found or v_clean_coins <= 0 then
    awarded_xp := 0;
    new_xp := coalesce(v_family.xp, 0);
    new_level := coalesce(v_family.level, 1);
    new_gift_coins := coalesce(v_family.gift_coins_total, 0);
    return next;
    return;
  end if;

  if exists (
    select 1 from public.family_xp_events fxe
    where fxe.community_id = p_community_id and fxe.dedupe_key = p_dedupe_key
  ) then
    awarded_xp := 0;
    new_xp := v_family.xp;
    new_level := v_family.level;
    new_gift_coins := v_family.gift_coins_total;
    return next;
    return;
  end if;

  v_old_coins := coalesce(v_family.gift_coins_total, 0);
  v_next_coins := v_old_coins + v_clean_coins;
  -- 10.000.000 coin = 100.000 XP => her 100 coin = 1 XP (küçük hediyelerde küsürat kaybolmaz).
  v_delta_xp := (v_next_coins / 100) - (v_old_coins / 100);
  v_next_xp := coalesce(v_family.xp, 0) + v_delta_xp;
  v_next_level := public.calculate_family_level(v_next_xp);

  insert into public.family_xp_events (
    community_id,
    actor_id,
    event_type,
    dedupe_key,
    coins_spent,
    xp_awarded,
    event_date
  )
  values (
    p_community_id,
    p_actor_id,
    p_event_type,
    p_dedupe_key,
    v_clean_coins,
    v_delta_xp,
    (timezone('utc', now()))::date
  )
  on conflict (community_id, dedupe_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    awarded_xp := 0;
    new_xp := v_family.xp;
    new_level := v_family.level;
    new_gift_coins := v_family.gift_coins_total;
    return next;
    return;
  end if;

  update public.communities c
  set gift_coins_total = v_next_coins,
      xp = v_next_xp,
      level = v_next_level,
      updated_at = now()
  where c.id = p_community_id;

  perform public.sync_family_rewards_for_user(p_community_id, p_actor_id);

  awarded_xp := v_delta_xp;
  new_xp := v_next_xp;
  new_level := v_next_level;
  new_gift_coins := v_next_coins;
  return next;
end;
$$;

-- ── 7. Atomik Aile RPC'leri (Kurma: 10M Coin, Katılma, Ayrılma, Sohbet, Hediye) ──
create or replace function public.create_family(
  p_name text,
  p_description text default '',
  p_avatar_url text default null,
  p_request_id uuid default null
)
returns table (
  family_id uuid,
  family_code text,
  balance integer,
  promo_balance integer,
  paid_balance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_family_cost constant integer := 10000000;
  v_uid uuid := auth.uid();
  v_clean_name text := trim(coalesce(p_name, ''));
  v_clean_desc text := trim(coalesce(p_description, ''));
  v_clean_avatar text := nullif(trim(coalesce(p_avatar_url, '')), '');
  v_prior public.wallet_transactions;
  v_existing_family public.communities;
  v_total integer;
  v_promo integer;
  v_paid integer;
  v_promo_spent integer;
  v_paid_spent integer;
  v_created public.communities;
  v_code_attempt integer;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception 'Request ID required';
  end if;

  perform 1 from public.profiles where id = v_uid for update;

  select * into v_prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = v_uid;

  if found then
    select * into v_existing_family
    from public.communities
    where id = (v_prior.metadata->>'family_id')::uuid;

    select w.balance, w.promo_balance, w.paid_balance
      into balance, promo_balance, paid_balance
    from public.wallets w
    where w.user_id = v_uid;

    family_id := v_existing_family.id;
    family_code := v_existing_family.family_code;
    return next;
    return;
  end if;

  if exists (select 1 from public.community_members cm where cm.user_id = v_uid) then
    raise exception 'Already in a family';
  end if;

  if char_length(v_clean_name) < 3 or char_length(v_clean_name) > 40 then
    raise exception 'Family name must be between 3 and 40 characters';
  end if;
  if char_length(v_clean_desc) > 240 then
    raise exception 'Family description must be at most 240 characters';
  end if;
  if v_clean_avatar is not null and (
    char_length(v_clean_avatar) > 600
    or v_clean_avatar !~ '^https?://'
  ) then
    raise exception 'Invalid avatar URL';
  end if;

  if exists (select 1 from public.communities c where lower(c.name) = lower(v_clean_name)) then
    raise exception 'Family name already taken';
  end if;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  select w.balance, w.promo_balance, w.paid_balance
    into v_total, v_promo, v_paid
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if coalesce(v_total, 0) < c_family_cost then
    raise exception 'Insufficient balance';
  end if;

  v_promo_spent := least(coalesce(v_promo, 0), c_family_cost);
  v_paid_spent := c_family_cost - v_promo_spent;

  update public.wallets w
  set balance = w.balance - c_family_cost,
      promo_balance = w.promo_balance - v_promo_spent,
      paid_balance = w.paid_balance - v_paid_spent,
      updated_at = now()
  where w.user_id = v_uid
  returning w.balance, w.promo_balance, w.paid_balance
    into balance, promo_balance, paid_balance;

  for v_code_attempt in 1..8 loop
    begin
      insert into public.communities (owner_id, name, description, avatar_url, icon, theme_colors, xp, gift_coins_total, level, family_code)
      values (
        v_uid,
        v_clean_name,
        v_clean_desc,
        v_clean_avatar,
        'people',
        '["#2F80ED", "#1D4E89"]'::jsonb,
        0,
        0,
        1,
        public.generate_unique_8digit_code('communities')
      )
      returning * into v_created;
      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'communities_family_code_key' or v_code_attempt = 8 then
          raise;
        end if;
    end;
  end loop;

  insert into public.community_members (community_id, user_id, role)
  values (v_created.id, v_uid, 'owner')
  on conflict (community_id, user_id) do update set role = 'owner';

  insert into public.wallet_transactions (user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -c_family_cost,
    'family_create',
    v_clean_name || ' ailesi kuruldu',
    jsonb_build_object(
      'family_id', v_created.id,
      'family_code', v_created.family_code,
      'promo_spent', v_promo_spent,
      'paid_spent', v_paid_spent
    ),
    p_request_id
  );

  perform public.sync_family_rewards_for_user(v_created.id, v_uid);

  family_id := v_created.id;
  family_code := v_created.family_code;
  return next;
end;
$$;

drop function if exists public.join_family(uuid);
create function public.join_family(p_community_id uuid)
returns table (community_id uuid, role text, xp bigint, level integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_family public.communities;
  v_existing_community uuid;
  v_existing_role text;
  v_member_count integer;
  v_limit integer;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  perform 1 from public.profiles where id = v_uid for update;

  select cm.community_id, cm.role
    into v_existing_community, v_existing_role
  from public.community_members cm
  where cm.user_id = v_uid;

  if v_existing_community is not null then
    if v_existing_community = p_community_id then
      select * into v_family from public.communities c where c.id = p_community_id;
      community_id := v_family.id;
      role := v_existing_role;
      xp := v_family.xp;
      level := v_family.level;
      return next;
      return;
    end if;
    raise exception 'Already in a family';
  end if;

  select * into v_family from public.communities c where c.id = p_community_id for update;
  if not found then
    raise exception 'Family not found';
  end if;

  select coalesce(flc.member_limit, 300) into v_limit
  from public.family_level_configs flc
  where flc.level = least(v_family.level, 10);

  select count(*) into v_member_count
  from public.community_members cm
  where cm.community_id = p_community_id;

  if v_member_count >= coalesce(v_limit, 300) then
    raise exception 'Family is full';
  end if;

  insert into public.community_members (community_id, user_id, role)
  values (p_community_id, v_uid, 'member');

  perform public.sync_family_rewards_for_user(p_community_id, v_uid);

  community_id := v_family.id;
  role := 'member';
  xp := v_family.xp;
  level := v_family.level;
  return next;
end;
$$;

create or replace function public.leave_family(p_community_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_membership record;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select cm.community_id, cm.role
    into v_membership
  from public.community_members cm
  where cm.user_id = v_uid
    and (p_community_id is null or cm.community_id = p_community_id);

  if not found then
    return false;
  end if;

  if v_membership.role = 'owner' then
    raise exception 'Family owner cannot leave';
  end if;

  delete from public.community_members
  where community_id = v_membership.community_id and user_id = v_uid;

  return true;
end;
$$;

create or replace function public.update_family_profile(
  p_community_id uuid,
  p_name text default null,
  p_description text default null,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
)
returns public.communities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_family public.communities;
  v_next_name text;
  v_next_desc text;
  v_next_avatar text;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_family from public.communities where id = p_community_id for update;
  if not found then
    raise exception 'Family not found';
  end if;
  if v_family.owner_id <> v_uid then
    raise exception 'Only family owner can update';
  end if;

  v_next_name := coalesce(nullif(trim(coalesce(p_name, '')), ''), v_family.name);
  v_next_desc := case when p_description is null then v_family.description else trim(p_description) end;
  v_next_avatar := case
    when p_clear_avatar then null
    when p_avatar_url is not null then nullif(trim(p_avatar_url), '')
    else v_family.avatar_url
  end;

  if char_length(v_next_name) < 3 or char_length(v_next_name) > 40 then
    raise exception 'Family name must be between 3 and 40 characters';
  end if;
  if char_length(v_next_desc) > 240 then
    raise exception 'Family description must be at most 240 characters';
  end if;
  if v_next_avatar is not null and (char_length(v_next_avatar) > 600 or v_next_avatar !~ '^https?://') then
    raise exception 'Invalid avatar URL';
  end if;

  if lower(v_next_name) <> lower(v_family.name)
     and exists (select 1 from public.communities c where lower(c.name) = lower(v_next_name) and c.id <> p_community_id) then
    raise exception 'Family name already taken';
  end if;

  update public.communities
  set name = v_next_name,
      description = v_next_desc,
      avatar_url = v_next_avatar,
      updated_at = now()
  where id = p_community_id
  returning * into v_family;

  return v_family;
end;
$$;

drop function if exists public.send_family_message(uuid, text, uuid);
create function public.send_family_message(
  p_community_id uuid,
  p_body text,
  p_client_message_id uuid default null
)
returns table (
  id uuid,
  community_id uuid,
  sender_id uuid,
  body text,
  kind text,
  metadata jsonb,
  created_at timestamptz,
  awarded_xp bigint,
  family_xp bigint,
  family_level integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_clean text := trim(coalesce(p_body, ''));
  v_msg public.family_messages;
  v_recent_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = v_uid
  ) then
    raise exception 'Family membership required';
  end if;

  if char_length(v_clean) < 1 or char_length(v_clean) > 1000 then
    raise exception 'Message must be between 1 and 1000 characters';
  end if;

  if p_client_message_id is not null then
    select * into v_msg
    from public.family_messages fm
    where fm.sender_id = v_uid and fm.client_message_id = p_client_message_id;

    if found then
      select c.xp, c.level into family_xp, family_level from public.communities c where c.id = p_community_id;
      id := v_msg.id;
      community_id := v_msg.community_id;
      sender_id := v_msg.sender_id;
      body := v_msg.body;
      kind := v_msg.kind;
      metadata := v_msg.metadata;
      created_at := v_msg.created_at;
      awarded_xp := 0;
      return next;
      return;
    end if;
  end if;

  select count(*) into v_recent_count
  from public.family_messages fm
  where fm.sender_id = v_uid
    and fm.kind = 'text'
    and fm.created_at > now() - interval '8 seconds';

  if v_recent_count >= 5 then
    raise exception 'Too many messages';
  end if;

  insert into public.family_messages (community_id, sender_id, body, kind, metadata, client_message_id)
  values (p_community_id, v_uid, v_clean, 'text', '{}'::jsonb, p_client_message_id)
  returning * into v_msg;

  select c.xp, c.level into family_xp, family_level from public.communities c where c.id = p_community_id;

  id := v_msg.id;
  community_id := v_msg.community_id;
  sender_id := v_msg.sender_id;
  body := v_msg.body;
  kind := v_msg.kind;
  metadata := v_msg.metadata;
  created_at := v_msg.created_at;
  awarded_xp := 0;
  return next;
end;
$$;

-- Aile içi hediye gönderimi: üyeler birbirine veya kendine hediye gönderebilir;
-- harcanan coin sunucuda atomik düşer ve 10.000.000 coin = 100.000 XP oranıyla aile seviyesini artırır.
drop function if exists public.send_family_gift(uuid, text, uuid, integer, uuid);
create function public.send_family_gift(
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
  v_prior public.wallet_transactions;
  v_prior_msg public.family_messages;
  v_gift public.gift_catalog;
  v_family public.communities;
  v_cost_bigint bigint;
  v_cost_int integer;
  v_wallet_total integer;
  v_wallet_promo integer;
  v_promo_spent integer;
  v_paid_spent integer;
  v_sender_name text;
  v_recipient_name text;
  v_recipient_avatar text;
  v_body text;
  v_meta jsonb;
  v_msg public.family_messages;
  v_xp record;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception 'Request ID required';
  end if;
  if v_qty < 1 or v_qty > 1000 then
    raise exception 'Invalid gift quantity';
  end if;

  perform 1 from public.profiles where id = v_uid for update;

  select * into v_prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = v_uid;

  if found then
    select * into v_prior_msg
    from public.family_messages fm
    where fm.id = (v_prior.metadata->>'message_id')::uuid;

    select * into v_family from public.communities c where c.id = p_community_id;
    select w.balance, w.promo_balance, w.paid_balance
      into balance, promo_balance, paid_balance
    from public.wallets w where w.user_id = v_uid;

    message_id := v_prior_msg.id;
    message_body := coalesce(v_prior_msg.body, '');
    message_metadata := coalesce(v_prior_msg.metadata, '{}'::jsonb);
    created_at := coalesce(v_prior_msg.created_at, v_prior.created_at);
    gift_name := coalesce(v_prior.metadata->>'gift_name', 'Hediye');
    total_cost := abs(v_prior.amount)::bigint;
    awarded_xp := coalesce((v_prior.metadata->>'awarded_xp')::bigint, 0);
    family_xp := coalesce(v_family.xp, 0);
    family_level := coalesce(v_family.level, 1);
    gift_coins_total := coalesce(v_family.gift_coins_total, 0);
    return next;
    return;
  end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = v_uid
  ) then
    raise exception 'Family membership required';
  end if;

  if p_recipient_id is null or not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = p_recipient_id
  ) then
    raise exception 'Recipient must be in the same family';
  end if;

  if p_recipient_id <> v_uid and public.users_blocked(v_uid, p_recipient_id) then
    raise exception 'Recipient unavailable';
  end if;

  select * into v_gift from public.gift_catalog where id = p_gift_id and active;
  if not found then
    raise exception 'Gift is unavailable';
  end if;

  select * into v_family from public.communities c where c.id = p_community_id;
  if not found then
    raise exception 'Family not found';
  end if;

  if coalesce(v_gift.min_family_level, 0) > 0 and coalesce(v_family.level, 1) < v_gift.min_family_level then
    raise exception 'Family level required';
  end if;

  v_cost_bigint := v_gift.cost::bigint * v_qty::bigint;
  if v_cost_bigint <= 0 or v_cost_bigint > 2000000000 then
    raise exception 'Invalid gift quantity';
  end if;
  v_cost_int := v_cost_bigint::integer;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  select w.balance, w.promo_balance
    into v_wallet_total, v_wallet_promo
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if coalesce(v_wallet_total, 0) < v_cost_int then
    raise exception 'Insufficient balance';
  end if;

  v_promo_spent := least(coalesce(v_wallet_promo, 0), v_cost_int);
  v_paid_spent := v_cost_int - v_promo_spent;

  update public.wallets w
  set balance = w.balance - v_cost_int,
      promo_balance = w.promo_balance - v_promo_spent,
      paid_balance = w.paid_balance - v_paid_spent,
      updated_at = now()
  where w.user_id = v_uid
  returning w.balance, w.promo_balance, w.paid_balance
    into balance, promo_balance, paid_balance;

  select * into v_xp
  from public.award_family_gift_xp_internal(
    p_community_id,
    v_uid,
    'family_gift_sent',
    v_cost_bigint,
    'family_gift:' || p_request_id::text
  );

  if p_recipient_id <> v_uid then
    perform public.sync_family_rewards_for_user(p_community_id, p_recipient_id);
  end if;

  select p.display_name into v_sender_name from public.profiles p where p.id = v_uid;
  select p.display_name, p.avatar_url into v_recipient_name, v_recipient_avatar from public.profiles p where p.id = p_recipient_id;

  if p_recipient_id = v_uid then
    v_body := coalesce(v_sender_name, 'Üye') || ' kendine ' ||
      (case when v_qty > 1 then v_qty::text || 'x ' else '' end) || v_gift.name || ' hediyesi gönderdi.';
  else
    v_body := coalesce(v_sender_name, 'Üye') || ' -> ' || coalesce(v_recipient_name, 'Üye') || ': ' ||
      (case when v_qty > 1 then v_qty::text || 'x ' else '' end) || v_gift.name || ' hediyesi gönderdi.';
  end if;

  v_meta := jsonb_build_object(
    'gift_id', v_gift.id,
    'gift_name', v_gift.name,
    'gift_icon', v_gift.icon,
    'gift_color', v_gift.color,
    'quantity', v_qty,
    'unit_cost', v_gift.cost,
    'total_cost', v_cost_bigint,
    'recipient_id', p_recipient_id,
    'recipient_name', coalesce(v_recipient_name, 'Üye'),
    'recipient_avatar_url', v_recipient_avatar,
    'self_gift', (p_recipient_id = v_uid),
    'awarded_xp', coalesce(v_xp.awarded_xp, 0)
  );

  insert into public.family_messages (community_id, sender_id, body, kind, metadata, client_message_id)
  values (p_community_id, v_uid, v_body, 'gift', v_meta, p_request_id)
  returning * into v_msg;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -v_cost_int,
    'gift',
    (case when v_qty > 1 then v_qty::text || 'x ' else '' end) || v_gift.name || ' (Aile hediyesi)',
    jsonb_build_object(
      'gift_id', v_gift.id,
      'gift_name', v_gift.name,
      'quantity', v_qty,
      'family_id', p_community_id,
      'recipient_id', p_recipient_id,
      'self_gift', (p_recipient_id = v_uid),
      'promo_spent', v_promo_spent,
      'paid_spent', v_paid_spent,
      'message_id', v_msg.id,
      'awarded_xp', coalesce(v_xp.awarded_xp, 0)
    ),
    p_request_id
  );

  message_id := v_msg.id;
  message_body := v_msg.body;
  message_metadata := v_msg.metadata;
  created_at := v_msg.created_at;
  gift_name := v_gift.name;
  total_cost := v_cost_bigint;
  awarded_xp := coalesce(v_xp.awarded_xp, 0);
  family_xp := coalesce(v_xp.new_xp, 0);
  family_level := coalesce(v_xp.new_level, 1);
  gift_coins_total := coalesce(v_xp.new_gift_coins, 0);
  return next;
end;
$$;

drop function if exists public.claim_family_checkin(uuid);
create function public.claim_family_checkin(p_community_id uuid)
returns table (claimed boolean, awarded_xp bigint, family_xp bigint, family_level integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  select false, 0::bigint, c.xp, c.level
    into claimed, awarded_xp, family_xp, family_level
  from public.communities c
  where c.id = p_community_id;
  return next;
end;
$$;

create or replace function public.claim_family_level_rewards(p_community_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  return public.sync_family_rewards_for_user(p_community_id, auth.uid());
end;
$$;

-- ── 8. Mevcut Kozmetik Satın Alma ve Oda Hediye Fonksiyonlarını Aile Sistemiyle Bağla ─
create or replace function public.purchase_profile_item(p_item_id text, p_request_id uuid)
returns table(balance integer, promo_balance integer, paid_balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  item public.profile_item_catalog;
  promo_spent integer;
  paid_spent integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  if exists(select 1 from public.user_profile_items where user_id = auth.uid() and item_id = p_item_id) then
    select w.balance, w.promo_balance, w.paid_balance into balance, promo_balance, paid_balance
    from public.wallets w where w.user_id = auth.uid();
    return next;
    return;
  end if;
  select * into item from public.profile_item_catalog where id = p_item_id and active and purchasable;
  if not found then raise exception 'Item unavailable'; end if;
  select w.promo_balance, w.paid_balance into promo_spent, paid_spent
  from public.wallets w where w.user_id = auth.uid() for update;
  if not found then raise exception 'Wallet unavailable'; end if;
  if promo_spent + paid_spent < item.cost then raise exception 'Insufficient balance'; end if;
  promo_spent := least(promo_spent, item.cost);
  paid_spent := item.cost - promo_spent;
  update public.wallets
  set balance = balance - item.cost,
      promo_balance = promo_balance - promo_spent,
      paid_balance = paid_balance - paid_spent,
      updated_at = now()
  where user_id = auth.uid()
  returning wallets.balance, wallets.promo_balance, wallets.paid_balance
    into balance, promo_balance, paid_balance;
  insert into public.user_profile_items(user_id, item_id) values (auth.uid(), item.id);
  insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
  values (
    auth.uid(),
    -item.cost,
    'cosmetic_purchase',
    item.name,
    jsonb_build_object('item_id', item.id, 'promo_spent', promo_spent, 'paid_spent', paid_spent),
    p_request_id
  );
  return next;
end;
$$;

create or replace function public.send_room_gift(p_room_id uuid, p_gift_id text, p_recipient_id uuid, p_request_id uuid)
returns table(balance integer, message_id uuid, message_body text, gift_name text, gift_cost integer, promo_balance integer, paid_balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  select * into prior from public.wallet_transactions where idempotency_key = p_request_id and user_id = auth.uid();
  if found then
    return query select w.balance, (prior.metadata->>'message_id')::uuid,
      coalesce((select m.body from public.room_messages m where m.id = (prior.metadata->>'message_id')::uuid), ''),
      coalesce(prior.metadata->>'gift_name', 'Hediye'), abs(prior.amount), w.promo_balance, w.paid_balance
      from public.wallets w where w.user_id = auth.uid();
    return;
  end if;
  select * into g from public.gift_catalog where id = p_gift_id and active;
  if not found then raise exception 'Gift is unavailable'; end if;
  if p_recipient_id is null or p_recipient_id = auth.uid() then raise exception 'Invalid recipient'; end if;

  select cm.community_id, c.level
    into v_sender_family_id, v_sender_family_level
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  where cm.user_id = auth.uid();

  if coalesce(g.min_family_level, 0) > 0 and coalesce(v_sender_family_level, 0) < g.min_family_level then
    raise exception 'Family level required';
  end if;

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

  insert into public.wallets(user_id) values (auth.uid()) on conflict(user_id) do nothing;
  select w.balance, w.promo_balance into total, promo_spent from public.wallets w where w.user_id = auth.uid() for update;
  if total < g.cost then raise exception 'Insufficient balance'; end if;
  promo_spent := least(promo_spent, g.cost);
  paid_spent := g.cost - promo_spent;
  update public.wallets
  set balance = balance - g.cost,
      promo_balance = promo_balance - promo_spent,
      paid_balance = paid_balance - paid_spent,
      updated_at = now()
  where user_id = auth.uid();

  select display_name into sender_name from public.profiles where id = auth.uid();
  select display_name into recipient_name from public.profiles where id = p_recipient_id;
  insert into public.room_messages(room_id, sender_id, body, kind)
  values (p_room_id, auth.uid(), sender_name || ' -> ' || recipient_name || ': ' || g.name || ' hediyesi gönderdi!', 'gift')
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

  return query select w.balance, new_message.id, new_message.body, g.name, g.cost, w.promo_balance, w.paid_balance
    from public.wallets w where w.user_id = auth.uid();
end;
$$;

-- ── 9. Fonksiyon İzin Korumaları ─────────────────────────────────────────────────
revoke all on function public.generate_unique_8digit_code(text) from public, anon, authenticated;
revoke all on function public.sync_family_rewards_for_user(uuid, uuid) from public, anon, authenticated;
drop function if exists public.award_family_xp_internal(uuid, uuid, text, text);
revoke all on function public.award_family_gift_xp_internal(uuid, uuid, text, bigint, text) from public, anon, authenticated;

revoke all on function public.create_family(text, text, text, uuid) from public, anon;
revoke all on function public.join_family(uuid) from public, anon;
revoke all on function public.leave_family(uuid) from public, anon;
revoke all on function public.update_family_profile(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.send_family_message(uuid, text, uuid) from public, anon;
revoke all on function public.send_family_gift(uuid, text, uuid, integer, uuid) from public, anon;
revoke all on function public.claim_family_checkin(uuid) from public, anon;
revoke all on function public.claim_family_level_rewards(uuid) from public, anon;

grant execute on function public.create_family(text, text, text, uuid) to authenticated;
grant execute on function public.join_family(uuid) to authenticated;
grant execute on function public.leave_family(uuid) to authenticated;
grant execute on function public.update_family_profile(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.send_family_message(uuid, text, uuid) to authenticated;
grant execute on function public.send_family_gift(uuid, text, uuid, integer, uuid) to authenticated;
grant execute on function public.claim_family_checkin(uuid) to authenticated;
grant execute on function public.claim_family_level_rewards(uuid) to authenticated;

commit;
