-- Sora: Oda Parti & Bağlılık Paketi
-- 1) Şanslı Paket (Kırmızı Zarf) atomik havuz + talep + otomatik iade
-- 2) Oda İçi Canlı Hediye Liderlik Kupası
-- 3) Günlük Görevler + 7 Günlük Giriş Serisi

-- ── 1) wallet_transactions tip kısıtını mevcut satırları koruyarak genişlet ────
do $$
declare
  c record;
  v_types text;
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

  select string_agg(distinct quote_literal(t), ', ' order by quote_literal(t))
    into v_types
    from (
      select type as t from public.wallet_transactions
      union all
      select unnest(array[
        'daily_reward',
        'gift',
        'bank_transfer',
        'promo_grant',
        'cosmetic_purchase',
        'family_create',
        'level_reward',
        'gift_cashback',
        'lucky_packet_send',
        'lucky_packet_claim',
        'lucky_packet_refund',
        'daily_mission',
        'streak_bonus'
      ]) as t
    ) all_types;

  execute format(
    'alter table public.wallet_transactions add constraint wallet_transactions_type_check check (type in (%s))',
    v_types
  );
end $$;

-- ── 2) Şanslı Paket (Lucky Packet) tabloları ──────────────────────────────────
create table if not exists public.room_lucky_packets (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  creator_name text not null default 'Sora kullanıcısı',
  creator_avatar_url text,
  creator_color text,
  message text not null default 'Şanslı Paket!' check (char_length(message) <= 80),
  total_amount integer not null check (total_amount >= 500 and total_amount <= 50000000),
  remaining_amount integer not null check (remaining_amount >= 0),
  total_slots integer not null check (total_slots between 2 and 20),
  remaining_slots integer not null check (remaining_slots >= 0),
  status text not null default 'active' check (status in ('active', 'finished', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists room_lucky_packets_room_active_idx
  on public.room_lucky_packets(room_id, status, expires_at desc);

create table if not exists public.room_lucky_packet_claims (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.room_lucky_packets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  claimer_name text not null default 'Sora kullanıcısı',
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (packet_id, user_id)
);

create index if not exists room_lucky_packet_claims_packet_idx
  on public.room_lucky_packet_claims(packet_id, created_at desc);

alter table public.room_lucky_packets enable row level security;
alter table public.room_lucky_packet_claims enable row level security;

drop policy if exists "Authenticated read lucky packets" on public.room_lucky_packets;
create policy "Authenticated read lucky packets"
  on public.room_lucky_packets for select to authenticated using (true);

drop policy if exists "Authenticated read lucky packet claims" on public.room_lucky_packet_claims;
create policy "Authenticated read lucky packet claims"
  on public.room_lucky_packet_claims for select to authenticated using (true);

-- Süresi dolmuş paketin kalan kredisini oluşturana atomik iade eden dahili yardımcı
create or replace function public.refund_lucky_packet_internal(p_packet_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  pkt public.room_lucky_packets;
  v_refund integer := 0;
begin
  select * into pkt
    from public.room_lucky_packets
   where id = p_packet_id
   for update;

  if not found or pkt.status <> 'active' then
    return 0;
  end if;

  v_refund := greatest(0, pkt.remaining_amount);

  update public.room_lucky_packets
     set status = 'expired',
         remaining_amount = 0
   where id = pkt.id;

  if v_refund > 0 then
    update public.wallets
       set balance = balance + v_refund,
           promo_balance = promo_balance + v_refund,
           updated_at = now()
     where user_id = pkt.creator_id;

    insert into public.wallet_transactions(user_id, amount, type, description, metadata)
    values (
      pkt.creator_id,
      v_refund,
      'lucky_packet_refund',
      'Şanslı paket kalan tutar iadesi',
      jsonb_build_object('packet_id', pkt.id, 'room_id', pkt.room_id)
    );
  end if;

  return v_refund;
end;
$$;

revoke all on function public.refund_lucky_packet_internal(uuid) from public, anon, authenticated;

-- Şanslı Paket oluşturma RPC
create or replace function public.create_lucky_packet(
  p_room_id uuid,
  p_total_amount integer,
  p_slots integer,
  p_message text default 'Şanslı Paket!',
  p_duration_seconds integer default 60,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_amt integer := coalesce(p_total_amount, 0);
  v_slots integer := coalesce(p_slots, 5);
  v_dur integer := greatest(30, least(180, coalesce(p_duration_seconds, 60)));
  v_msg text := left(coalesce(nullif(btrim(p_message), ''), 'Şanslı Paket!'), 80);
  v_balance integer;
  v_promo integer;
  v_paid integer;
  v_promo_spent integer;
  v_paid_spent integer;
  v_name text;
  v_avatar text;
  v_color text;
  v_pkt public.room_lucky_packets;
  v_prior_pkt_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_amt < 500 or v_amt > 50000000 then raise exception 'Tutar 500 ile 50.000.000 arasında olmalıdır'; end if;
  if v_slots < 2 or v_slots > 20 then raise exception 'Kişi sayısı 2 ile 20 arasında olmalıdır'; end if;
  if v_amt < v_slots then raise exception 'Tutar kişi sayısından az olamaz'; end if;

  if p_request_id is not null then
    select (wt.metadata->>'packet_id')::uuid
      into v_prior_pkt_id
      from public.wallet_transactions wt
     where wt.user_id = v_uid
       and wt.idempotency_key = p_request_id
     limit 1;
    if v_prior_pkt_id is not null then
      select * into v_pkt from public.room_lucky_packets where id = v_prior_pkt_id;
      select w.balance, w.promo_balance, w.paid_balance
        into v_balance, v_promo, v_paid
        from public.wallets w where w.user_id = v_uid;
      return jsonb_build_object(
        'packet', to_jsonb(v_pkt),
        'balance', v_balance,
        'promo_balance', v_promo,
        'paid_balance', v_paid
      );
    end if;
  end if;

  if not exists(
    select 1 from public.rooms r
     where r.id = p_room_id and r.state = 'live'
  ) then
    raise exception 'Oda aktif değil';
  end if;

  select w.balance, w.promo_balance, w.paid_balance
    into v_balance, v_promo, v_paid
    from public.wallets w
   where w.user_id = v_uid
   for update;

  if not found or v_balance < v_amt then
    raise exception 'Yetersiz kredi bakiyesi';
  end if;

  v_promo_spent := least(v_promo, v_amt);
  v_paid_spent := v_amt - v_promo_spent;

  update public.wallets w
     set balance = w.balance - v_amt,
         promo_balance = w.promo_balance - v_promo_spent,
         paid_balance = w.paid_balance - v_paid_spent,
         updated_at = now()
   where w.user_id = v_uid
   returning w.balance, w.promo_balance, w.paid_balance
   into v_balance, v_promo, v_paid;

  select p.display_name, p.avatar_url, p.avatar_color
    into v_name, v_avatar, v_color
    from public.profiles p
   where p.id = v_uid;

  insert into public.room_lucky_packets(
    room_id, creator_id, creator_name, creator_avatar_url, creator_color,
    message, total_amount, remaining_amount, total_slots, remaining_slots,
    status, expires_at
  )
  values (
    p_room_id, v_uid, coalesce(v_name, 'Sora kullanıcısı'), v_avatar, v_color,
    v_msg, v_amt, v_amt, v_slots, v_slots,
    'active', now() + make_interval(secs => v_dur)
  )
  returning * into v_pkt;

  insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -v_amt,
    'lucky_packet_send',
    'Şanslı paket (' || v_slots || ' kişilik)',
    jsonb_build_object(
      'packet_id', v_pkt.id,
      'room_id', p_room_id,
      'slots', v_slots,
      'promo_spent', v_promo_spent,
      'paid_spent', v_paid_spent
    ),
    p_request_id
  );

  perform set_config('sora.internal_room_message', 'on', true);
  insert into public.room_messages(room_id, sender_id, sender_name, body, kind, metadata)
  values (
    p_room_id,
    v_uid,
    coalesce(v_name, 'Sora kullanıcısı'),
    coalesce(v_name, 'Sora kullanıcısı') || ' odaya ' || v_amt || ' kredilik Şanslı Paket bıraktı! (' || v_slots || ' kişi)',
    'system',
    jsonb_build_object('lucky_packet_id', v_pkt.id, 'total_amount', v_amt, 'slots', v_slots)
  );
  perform set_config('sora.internal_room_message', 'off', true);

  return jsonb_build_object(
    'packet', to_jsonb(v_pkt),
    'balance', v_balance,
    'promo_balance', v_promo,
    'paid_balance', v_paid
  );
end;
$$;

revoke all on function public.create_lucky_packet(uuid, integer, integer, text, integer, uuid) from public, anon;
grant execute on function public.create_lucky_packet(uuid, integer, integer, text, integer, uuid) to authenticated;

-- Şanslı Paket kapma RPC
create or replace function public.claim_lucky_packet(p_packet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  pkt public.room_lucky_packets;
  existing_claim public.room_lucky_packet_claims;
  v_share integer;
  v_max_share integer;
  v_avg numeric;
  v_claimer_name text;
  v_balance integer;
  v_promo integer;
  v_paid integer;
  v_claims jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into pkt
    from public.room_lucky_packets
   where id = p_packet_id
   for update;

  if not found then
    raise exception 'Paket bulunamadı';
  end if;

  select * into existing_claim
    from public.room_lucky_packet_claims
   where packet_id = p_packet_id and user_id = v_uid;

  if found then
    select w.balance, w.promo_balance, w.paid_balance
      into v_balance, v_promo, v_paid
      from public.wallets w where w.user_id = v_uid;
    select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', c.claimer_name, 'amount', c.amount) order by c.created_at desc), '[]'::jsonb)
      into v_claims
      from public.room_lucky_packet_claims c
     where c.packet_id = p_packet_id;
    return jsonb_build_object(
      'already_claimed', true,
      'claimed_amount', existing_claim.amount,
      'remaining_slots', pkt.remaining_slots,
      'remaining_amount', pkt.remaining_amount,
      'status', pkt.status,
      'balance', v_balance,
      'promo_balance', v_promo,
      'paid_balance', v_paid,
      'claims', v_claims
    );
  end if;

  if pkt.status = 'active' and pkt.expires_at <= now() then
    perform public.refund_lucky_packet_internal(pkt.id);
    select * into pkt from public.room_lucky_packets where id = p_packet_id;
  end if;

  if pkt.status <> 'active' or pkt.remaining_slots <= 0 or pkt.remaining_amount <= 0 then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', c.claimer_name, 'amount', c.amount) order by c.created_at desc), '[]'::jsonb)
      into v_claims
      from public.room_lucky_packet_claims c
     where c.packet_id = p_packet_id;
    return jsonb_build_object(
      'expired', pkt.status = 'expired',
      'finished', pkt.status = 'finished',
      'claimed_amount', 0,
      'remaining_slots', pkt.remaining_slots,
      'remaining_amount', pkt.remaining_amount,
      'status', pkt.status,
      'claims', v_claims
    );
  end if;

  if pkt.remaining_slots = 1 then
    v_share := pkt.remaining_amount;
  else
    v_max_share := pkt.remaining_amount - (pkt.remaining_slots - 1);
    v_avg := pkt.remaining_amount::numeric / pkt.remaining_slots::numeric;
    v_share := greatest(1, least(v_max_share, floor((0.35 + random() * 1.35) * v_avg)::integer));
  end if;

  select coalesce(p.display_name, 'Sora kullanıcısı')
    into v_claimer_name
    from public.profiles p where p.id = v_uid;

  insert into public.room_lucky_packet_claims(packet_id, user_id, claimer_name, amount)
  values (pkt.id, v_uid, v_claimer_name, v_share);

  update public.room_lucky_packets
     set remaining_amount = remaining_amount - v_share,
         remaining_slots = remaining_slots - 1,
         status = case when remaining_slots - 1 <= 0 then 'finished' else 'active' end
   where id = pkt.id
   returning * into pkt;

  update public.wallets w
     set balance = w.balance + v_share,
         promo_balance = w.promo_balance + v_share,
         updated_at = now()
   where w.user_id = v_uid
   returning w.balance, w.promo_balance, w.paid_balance
   into v_balance, v_promo, v_paid;

  insert into public.wallet_transactions(user_id, amount, type, description, metadata)
  values (
    v_uid,
    v_share,
    'lucky_packet_claim',
    'Şanslı paket kazancı',
    jsonb_build_object('packet_id', pkt.id, 'room_id', pkt.room_id)
  );

  select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', c.claimer_name, 'amount', c.amount) order by c.created_at desc), '[]'::jsonb)
    into v_claims
    from public.room_lucky_packet_claims c
   where c.packet_id = p_packet_id;

  return jsonb_build_object(
    'already_claimed', false,
    'claimed_amount', v_share,
    'remaining_slots', pkt.remaining_slots,
    'remaining_amount', pkt.remaining_amount,
    'status', pkt.status,
    'balance', v_balance,
    'promo_balance', v_promo,
    'paid_balance', v_paid,
    'claims', v_claims
  );
end;
$$;

revoke all on function public.claim_lucky_packet(uuid) from public, anon;
grant execute on function public.claim_lucky_packet(uuid) to authenticated;

-- Odadaki aktif şanslı paketleri getir (süresi dolmuşları iade eder)
create or replace function public.list_active_lucky_packets(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_expired_id uuid;
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  for v_expired_id in
    select id from public.room_lucky_packets
     where room_id = p_room_id and status = 'active' and expires_at <= now()
  loop
    perform public.refund_lucky_packet_internal(v_expired_id);
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'room_id', p.room_id,
        'creator_id', p.creator_id,
        'creator_name', p.creator_name,
        'creator_avatar_url', p.creator_avatar_url,
        'creator_color', p.creator_color,
        'message', p.message,
        'total_amount', p.total_amount,
        'remaining_amount', p.remaining_amount,
        'total_slots', p.total_slots,
        'remaining_slots', p.remaining_slots,
        'status', p.status,
        'expires_at', p.expires_at,
        'my_claim', (select c.amount from public.room_lucky_packet_claims c where c.packet_id = p.id and c.user_id = v_uid limit 1)
      )
      order by p.created_at desc
    ),
    '[]'::jsonb
  )
    into v_rows
    from public.room_lucky_packets p
   where p.room_id = p_room_id
     and p.status = 'active'
     and p.expires_at > now();

  return v_rows;
end;
$$;

revoke all on function public.list_active_lucky_packets(uuid) from public, anon;
grant execute on function public.list_active_lucky_packets(uuid) to authenticated;

-- ── 3) Oda İçi Canlı Hediye Liderlik Kupası RPC ───────────────────────────────
create or replace function public.get_room_gift_leaderboard(
  p_room_id uuid,
  p_limit integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_lim integer := greatest(1, least(30, coalesce(p_limit, 15)));
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select coalesce(sum(greatest(0::bigint, coalesce((m.metadata->>'gift_cost')::bigint, 0))), 0)
    into v_total
    from public.room_messages m
   where m.room_id = p_room_id
     and m.kind = 'gift';

  with agg as (
    select
      m.sender_id as user_id,
      sum(greatest(0::bigint, coalesce((m.metadata->>'gift_cost')::bigint, 0))) as room_spent,
      count(*)::integer as gift_count
    from public.room_messages m
    where m.room_id = p_room_id
      and m.kind = 'gift'
    group by m.sender_id
    having sum(greatest(0::bigint, coalesce((m.metadata->>'gift_cost')::bigint, 0))) > 0
    order by room_spent desc
    limit v_lim
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank', rn,
        'user_id', user_id,
        'display_name', display_name,
        'avatar_url', avatar_url,
        'avatar_color', avatar_color,
        'user_level', user_level,
        'gift_spent_total', gift_spent_total,
        'room_spent', room_spent,
        'gift_count', gift_count
      )
      order by rn
    ),
    '[]'::jsonb
  )
    into v_rows
    from (
      select
        row_number() over (order by a.room_spent desc) as rn,
        a.user_id,
        coalesce(p.display_name, 'Sora kullanıcısı') as display_name,
        p.avatar_url,
        p.avatar_color,
        coalesce(p.user_level, 1) as user_level,
        coalesce(p.gift_spent_total, 0) as gift_spent_total,
        a.room_spent,
        a.gift_count
      from agg a
      left join public.profiles p on p.id = a.user_id
    ) ranked;

  return jsonb_build_object(
    'room_total', v_total,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.get_room_gift_leaderboard(uuid, integer) from public, anon;
grant execute on function public.get_room_gift_leaderboard(uuid, integer) to authenticated;

-- ── 4) Günlük Görevler & 7 Günlük Giriş Serisi ────────────────────────────────
create table if not exists public.user_daily_missions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mission_date date not null,
  mission_key text not null check (mission_key in ('join_room', 'send_chat', 'send_reaction', 'send_gift')),
  progress integer not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, mission_date, mission_key)
);

create table if not exists public.user_login_streaks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  streak_day integer not null default 0 check (streak_day between 0 and 7),
  last_claim_date date,
  updated_at timestamptz not null default now()
);

alter table public.user_daily_missions enable row level security;
alter table public.user_login_streaks enable row level security;

drop policy if exists "Users read own daily missions" on public.user_daily_missions;
create policy "Users read own daily missions"
  on public.user_daily_missions for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users read own login streak" on public.user_login_streaks;
create policy "Users read own login streak"
  on public.user_login_streaks for select to authenticated using (auth.uid() = user_id);

create or replace function public.sora_today_tr()
returns date
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select (now() at time zone 'Europe/Istanbul')::date;
$$;

create or replace function public.mission_spec(p_key text)
returns table(target integer, reward integer, title text, description text, icon text)
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select specs.target, specs.reward, specs.title, specs.description, specs.icon
    from (
    values
      ('join_room',     1, 2500, 'Sesli Odaya Katıl',    'Bugün herhangi bir sesli odaya gir',         'mic'),
      ('send_chat',     3, 3000, 'Sohbete Katıl',        'Oda sohbetine 3 mesaj yaz',                  'chatbubble-ellipses'),
      ('send_reaction', 3, 2000, 'Enerji Ver',           'Odada 3 hızlı emoji tepkisi gönder',         'happy'),
      ('send_gift',     1, 5000, 'Cömertlik Göster',     'Odada veya ailede 1 hediye gönder',          'gift')
  ) as specs(k, target, reward, title, description, icon)
  where specs.k = p_key;
$$;

create or replace function public.get_daily_missions_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.sora_today_tr();
  v_streak public.user_login_streaks;
  v_streak_day integer := 0;
  v_claimed_today boolean := false;
  v_next_day integer := 1;
  v_missions jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_streak
    from public.user_login_streaks
   where user_id = v_uid;

  if found then
    if v_streak.last_claim_date = v_today then
      v_streak_day := v_streak.streak_day;
      v_claimed_today := true;
      v_next_day := case when v_streak.streak_day >= 7 then 1 else v_streak.streak_day + 1 end;
    elsif v_streak.last_claim_date = (v_today - 1) then
      v_streak_day := case when v_streak.streak_day >= 7 then 0 else v_streak.streak_day end;
      v_claimed_today := false;
      v_next_day := v_streak_day + 1;
    else
      v_streak_day := 0;
      v_claimed_today := false;
      v_next_day := 1;
    end if;
  end if;

  with defs(ord, k) as (
    values (1, 'join_room'), (2, 'send_chat'), (3, 'send_reaction'), (4, 'send_gift')
  )
  select jsonb_agg(
    jsonb_build_object(
      'key', d.k,
      'title', s.title,
      'description', s.description,
      'icon', s.icon,
      'target', s.target,
      'reward', s.reward,
      'progress', least(s.target, coalesce(m.progress, 0)),
      'claimed', m.claimed_at is not null
    )
    order by d.ord
  )
    into v_missions
    from defs d
    cross join lateral public.mission_spec(d.k) s
    left join public.user_daily_missions m
      on m.user_id = v_uid and m.mission_date = v_today and m.mission_key = d.k;

  return jsonb_build_object(
    'today', v_today,
    'streak_day', v_streak_day,
    'streak_claimed_today', v_claimed_today,
    'next_streak_day', v_next_day,
    'streak_rewards', jsonb_build_array(1500, 2500, 4000, 6000, 8500, 12000, 25000),
    'missions', coalesce(v_missions, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_daily_missions_status() from public, anon;
grant execute on function public.get_daily_missions_status() to authenticated;

create or replace function public.bump_daily_mission(
  p_mission_key text,
  p_delta integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.sora_today_tr();
  v_target integer;
  v_reward integer;
  v_prog integer;
  v_claimed boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select target, reward into v_target, v_reward from public.mission_spec(p_mission_key);
  if not found then raise exception 'Geçersiz görev'; end if;

  insert into public.user_daily_missions(user_id, mission_date, mission_key, progress, updated_at)
  values (v_uid, v_today, p_mission_key, least(v_target, greatest(1, coalesce(p_delta, 1))), now())
  on conflict (user_id, mission_date, mission_key) do update
    set progress = least(v_target, public.user_daily_missions.progress + greatest(1, coalesce(p_delta, 1))),
        updated_at = now()
  returning progress, (claimed_at is not null)
  into v_prog, v_claimed;

  return jsonb_build_object(
    'key', p_mission_key,
    'progress', v_prog,
    'target', v_target,
    'reward', v_reward,
    'completed', v_prog >= v_target,
    'claimed', v_claimed
  );
end;
$$;

revoke all on function public.bump_daily_mission(text, integer) from public, anon;
grant execute on function public.bump_daily_mission(text, integer) to authenticated;

create or replace function public.claim_daily_mission(p_mission_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.sora_today_tr();
  v_target integer;
  v_reward integer;
  v_title text;
  v_row public.user_daily_missions;
  v_balance integer;
  v_promo integer;
  v_paid integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select target, reward, title into v_target, v_reward, v_title from public.mission_spec(p_mission_key);
  if not found then raise exception 'Geçersiz görev'; end if;

  select * into v_row
    from public.user_daily_missions
   where user_id = v_uid and mission_date = v_today and mission_key = p_mission_key
   for update;

  if not found or v_row.progress < v_target then
    raise exception 'Görev henüz tamamlanmadı';
  end if;

  if v_row.claimed_at is not null then
    select w.balance, w.promo_balance, w.paid_balance
      into v_balance, v_promo, v_paid
      from public.wallets w where w.user_id = v_uid;
    return jsonb_build_object(
      'already_claimed', true,
      'reward', 0,
      'balance', v_balance,
      'promo_balance', v_promo,
      'paid_balance', v_paid
    );
  end if;

  update public.user_daily_missions
     set claimed_at = now(), updated_at = now()
   where user_id = v_uid and mission_date = v_today and mission_key = p_mission_key;

  update public.wallets w
     set balance = w.balance + v_reward,
         promo_balance = w.promo_balance + v_reward,
         updated_at = now()
   where w.user_id = v_uid
   returning w.balance, w.promo_balance, w.paid_balance
   into v_balance, v_promo, v_paid;

  insert into public.wallet_transactions(user_id, amount, type, description, metadata)
  values (
    v_uid,
    v_reward,
    'daily_mission',
    'Günlük görev: ' || v_title,
    jsonb_build_object('mission_key', p_mission_key, 'mission_date', v_today)
  );

  return jsonb_build_object(
    'already_claimed', false,
    'reward', v_reward,
    'balance', v_balance,
    'promo_balance', v_promo,
    'paid_balance', v_paid
  );
end;
$$;

revoke all on function public.claim_daily_mission(text) from public, anon;
grant execute on function public.claim_daily_mission(text) to authenticated;

create or replace function public.claim_streak_bonus()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.sora_today_tr();
  v_streak public.user_login_streaks;
  v_next_day integer := 1;
  v_rewards integer[] := array[1500, 2500, 4000, 6000, 8500, 12000, 25000];
  v_reward integer;
  v_balance integer;
  v_promo integer;
  v_paid integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  insert into public.user_login_streaks(user_id, streak_day, last_claim_date)
  values (v_uid, 0, null)
  on conflict (user_id) do nothing;

  select * into v_streak
    from public.user_login_streaks
   where user_id = v_uid
   for update;

  if v_streak.last_claim_date = v_today then
    select w.balance, w.promo_balance, w.paid_balance
      into v_balance, v_promo, v_paid
      from public.wallets w where w.user_id = v_uid;
    return jsonb_build_object(
      'already_claimed', true,
      'streak_day', v_streak.streak_day,
      'reward', 0,
      'balance', v_balance,
      'promo_balance', v_promo,
      'paid_balance', v_paid
    );
  end if;

  if v_streak.last_claim_date = (v_today - 1) and v_streak.streak_day < 7 then
    v_next_day := v_streak.streak_day + 1;
  else
    v_next_day := 1;
  end if;

  v_reward := v_rewards[v_next_day];

  update public.user_login_streaks
     set streak_day = v_next_day,
         last_claim_date = v_today,
         updated_at = now()
   where user_id = v_uid;

  update public.wallets w
     set balance = w.balance + v_reward,
         promo_balance = w.promo_balance + v_reward,
         updated_at = now()
   where w.user_id = v_uid
   returning w.balance, w.promo_balance, w.paid_balance
   into v_balance, v_promo, v_paid;

  insert into public.wallet_transactions(user_id, amount, type, description, metadata)
  values (
    v_uid,
    v_reward,
    'streak_bonus',
    v_next_day || '. gün giriş serisi ödülü',
    jsonb_build_object('streak_day', v_next_day, 'date', v_today)
  );

  return jsonb_build_object(
    'already_claimed', false,
    'streak_day', v_next_day,
    'reward', v_reward,
    'balance', v_balance,
    'promo_balance', v_promo,
    'paid_balance', v_paid
  );
end;
$$;

revoke all on function public.claim_streak_bonus() from public, anon;
grant execute on function public.claim_streak_bonus() to authenticated;
