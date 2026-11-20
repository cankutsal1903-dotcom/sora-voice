-- Sora: Cömertlik (hediye) seviyesi, etkinlikler ve çerçeve erişim kuralları.
-- Tamamen eklemeli (additive) bir migration; mevcut istemciler etkilenmez.

-- 1) Hediye harcama toplamı (cömertlik seviyesi için) ---------------------------
alter table public.profiles
  add column if not exists gift_spent_total bigint not null default 0;

update public.profiles p
   set gift_spent_total = coalesce(t.spent, 0)
  from (
    select user_id, sum(-amount)::bigint as spent
      from public.wallet_transactions
     where type = 'gift' and amount < 0
     group by user_id
  ) t
 where t.user_id = p.id;

create or replace function public.bump_profile_gift_spent()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.type = 'gift' and new.amount < 0 then
    update public.profiles
       set gift_spent_total = gift_spent_total + (-new.amount)::bigint
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_profile_gift_spent_trg on public.wallet_transactions;
create trigger bump_profile_gift_spent_trg
after insert on public.wallet_transactions
for each row execute function public.bump_profile_gift_spent();

revoke all on function public.bump_profile_gift_spent() from public, anon, authenticated;

create or replace function public.wealth_level_for(p_spent bigint)
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when p_spent >= 20000000000 then 15
    when p_spent >= 10000000000 then 14
    when p_spent >=  6000000000 then 13
    when p_spent >=  3500000000 then 12
    when p_spent >=  2000000000 then 11
    when p_spent >=  1200000000 then 10
    when p_spent >=   800000000 then 9
    when p_spent >=   500000000 then 8
    when p_spent >=   300000000 then 7
    when p_spent >=   150000000 then 6
    when p_spent >=    80000000 then 5
    when p_spent >=    40000000 then 4
    when p_spent >=    15000000 then 3
    when p_spent >=     5000000 then 2
    when p_spent >=     1000000 then 1
    else 0
  end;
$$;

-- İstemci gift_spent_total değerini değiştiremesin.
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    new.user_xp := old.user_xp;
    new.user_level := old.user_level;
    new.gift_spent_total := old.gift_spent_total;
    new.created_at := old.created_at;

    new.display_name := btrim(coalesce(new.display_name, ''));
    if char_length(new.display_name) < 1 or char_length(new.display_name) > 36 then
      raise exception 'Invalid display name';
    end if;

    if (new.display_name is distinct from old.display_name or new.bio is distinct from old.bio)
       and public.contains_blocked_term(new.display_name || ' ' || coalesce(new.bio, '')) then
      raise exception 'Profile contains blocked language';
    end if;

    if new.avatar_url is distinct from old.avatar_url
       and new.avatar_url is not null
       and (char_length(new.avatar_url) > 600 or new.avatar_url !~ '^https://') then
      raise exception 'Invalid avatar URL';
    end if;

    if new.active_frame_id is distinct from old.active_frame_id
       and new.active_frame_id is not null
       and not public.user_owns_profile_item(new.id, new.active_frame_id, 'frame') then
      raise exception 'Item not owned';
    end if;

    if new.active_profile_theme_id is distinct from old.active_profile_theme_id
       and new.active_profile_theme_id is not null
       and not public.user_owns_profile_item(new.id, new.active_profile_theme_id, 'theme') then
      raise exception 'Item not owned';
    end if;
  end if;
  return new;
end;
$function$;

-- 2) Çerçevelere kolay erişilmesin: seviye + cömertlik şartı ve yüksek fiyat ----
alter table public.profile_item_catalog
  add column if not exists min_user_level integer not null default 0,
  add column if not exists min_wealth_level integer not null default 0;

update public.profile_item_catalog set cost =   25000000, min_user_level = 10, min_wealth_level = 0 where id = 'frame_sky';
update public.profile_item_catalog set cost =  120000000, min_user_level = 25, min_wealth_level = 4 where id = 'frame_amber';
update public.profile_item_catalog set cost =  350000000, min_user_level = 40, min_wealth_level = 6 where id = 'frame_lilac';
update public.profile_item_catalog set cost = 1500000000, min_user_level = 60, min_wealth_level = 9 where id = 'frame_flame';

create or replace function public.purchase_profile_item(p_item_id text, p_request_id uuid)
returns table(balance integer, promo_balance integer, paid_balance integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  item public.profile_item_catalog;
  promo_spent integer;
  paid_spent integer;
  v_level integer;
  v_spent bigint;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;

  select wallet.promo_balance, wallet.paid_balance, wallet.balance
    into promo_spent, paid_spent, balance
    from public.wallets as wallet
   where wallet.user_id = v_uid
   for update;
  if not found then raise exception 'Wallet unavailable'; end if;

  if exists(select 1 from public.user_profile_items as upi where upi.user_id = v_uid and upi.item_id = p_item_id) then
    promo_balance := promo_spent;
    paid_balance := paid_spent;
    return next;
    return;
  end if;

  select catalog_item.*
    into item
    from public.profile_item_catalog as catalog_item
   where catalog_item.id = p_item_id
     and catalog_item.active
     and catalog_item.purchasable;
  if not found then raise exception 'Item unavailable'; end if;

  select coalesce(p.user_level, 1), coalesce(p.gift_spent_total, 0)
    into v_level, v_spent
    from public.profiles p
   where p.id = v_uid;

  if coalesce(v_level, 1) < item.min_user_level then
    raise exception 'Item level locked';
  end if;
  if public.wealth_level_for(coalesce(v_spent, 0)) < item.min_wealth_level then
    raise exception 'Item wealth locked';
  end if;

  if promo_spent + paid_spent < item.cost then raise exception 'Insufficient balance'; end if;
  promo_spent := least(promo_spent, item.cost);
  paid_spent := item.cost - promo_spent;

  update public.wallets as wallet
     set balance = wallet.balance - item.cost,
         promo_balance = wallet.promo_balance - promo_spent,
         paid_balance = wallet.paid_balance - paid_spent,
         updated_at = now()
   where wallet.user_id = v_uid
   returning wallet.balance, wallet.promo_balance, wallet.paid_balance
        into balance, promo_balance, paid_balance;

  insert into public.user_profile_items(user_id, item_id)
  values (v_uid, item.id)
  on conflict (user_id, item_id) do nothing;

  insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -item.cost,
    'cosmetic_purchase',
    item.name,
    jsonb_build_object('item_id', item.id, 'promo_spent', promo_spent, 'paid_spent', paid_spent),
    p_request_id
  );
  return next;
end;
$function$;

-- 3) Etkinlikler ---------------------------------------------------------------
create table if not exists public.app_events (
  id text primary key,
  title text not null,
  subtitle text,
  description text,
  kind text not null default 'gift_race' check (kind in ('gift_race', 'room_party', 'family_war', 'love')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  accent text,
  colors jsonb not null default '[]'::jsonb,
  icon text,
  gift_id text,
  rewards jsonb not null default '[]'::jsonb,
  rules jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.app_events enable row level security;
drop policy if exists "Events are readable" on public.app_events;
create policy "Events are readable" on public.app_events
  for select to authenticated using (active);
grant select on public.app_events to authenticated;

insert into public.app_events (id, title, subtitle, description, kind, starts_at, ends_at, accent, colors, icon, gift_id, rewards, rules, sort_order)
values
  ('weekly_gift_race', 'Haftalık Hediye Yarışı', 'En cömert 10 kişi ödül kazanır',
   'Bu hafta hediyelere en çok kredi harcayanlar sıralamada yükselir.', 'gift_race',
   date_trunc('week', now()), date_trunc('week', now()) + interval '7 days',
   '#F6C86E', '["#1C5FB8","#0F2A55","#F6C86E"]', 'trophy', 'elmas_aslan',
   '[{"rank":"1.","label":"Efsane Alev Çerçevesi 7 gün","credits":100000000},{"rank":"2.","label":"Kehribar Çerçeve 7 gün","credits":50000000},{"rank":"3.","label":"Kredi ödülü","credits":25000000},{"rank":"4-10.","label":"Kredi ödülü","credits":5000000}]',
   '["Odalarda ve ailede gönderdiğin tüm hediyeler sayılır.","Sıralama her hediye ile anlık güncellenir.","Ödüller etkinlik bitiminde dağıtılır."]', 10),
  ('royal_stage_night', 'Kraliyet Sahnesi Gecesi', 'Kraliyet Sahnesi gönder, sahneyi sen yönet',
   'Kraliyet Sahnesi hediyesi gönderenler özel sıralamada yer alır.', 'room_party',
   date_trunc('week', now()), date_trunc('week', now()) + interval '7 days',
   '#C084FC', '["#3B1D6E","#1C5FB8","#F6C86E"]', 'sparkles', 'kraliyet_sahnesi',
   '[{"rank":"1.","label":"Aile Asil rozeti vitrini","credits":60000000},{"rank":"2-3.","label":"Kredi ödülü","credits":20000000}]',
   '["Sadece Kraliyet Sahnesi hediyeleri sayılır.","Kendine gönderilen hediyeler de geçerlidir."]', 20),
  ('love_week', 'Aşk Haftası', 'En çok kalp gönderen kazanır',
   'Minik Kalp gönder, sevgini odaya yay.', 'love',
   date_trunc('week', now()), date_trunc('week', now()) + interval '7 days',
   '#FF5C8A', '["#FF5C8A","#B5179E","#1C5FB8"]', 'heart', 'minik_kalp',
   '[{"rank":"1.","label":"Kredi ödülü","credits":30000000},{"rank":"2-5.","label":"Kredi ödülü","credits":5000000}]',
   '["Sadece Minik Kalp hediyeleri sayılır."]', 30)
on conflict (id) do nothing;

create or replace function public.get_event_leaderboard(p_event_id text, p_limit integer default 20)
returns table(rank integer, user_id uuid, display_name text, avatar_url text, avatar_color text, score bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with ev as (
    select * from public.app_events where id = p_event_id and active
  ),
  scores as (
    select wt.user_id, sum(-wt.amount)::bigint as score
      from public.wallet_transactions wt, ev
     where wt.type = 'gift'
       and wt.amount < 0
       and wt.created_at >= ev.starts_at
       and wt.created_at < ev.ends_at
       and (ev.gift_id is null or ev.kind = 'gift_race' or wt.metadata->>'gift_id' = ev.gift_id)
     group by wt.user_id
  )
  select (row_number() over (order by s.score desc))::integer as rank,
         s.user_id, p.display_name, p.avatar_url, p.avatar_color, s.score
    from scores s
    join public.profiles p on p.id = s.user_id
   order by s.score desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.get_event_leaderboard(text, integer) from public, anon;
grant execute on function public.get_event_leaderboard(text, integer) to authenticated;
