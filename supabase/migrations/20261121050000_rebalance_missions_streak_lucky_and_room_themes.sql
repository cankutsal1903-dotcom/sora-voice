-- Sora Voice: 2M Günlük Ödül Ekonomisiyle Uyumlu Görev/Seri/Şanslı Paket + Bigint Güvenliği + Oda Temaları

-- 1. Odalar için hazır premium tema sütunu
alter table public.rooms
  add column if not exists theme_id text not null default 'midnight';

-- 2. Oda ayarları RPC güncellemesi (tema desteği + geriye uyumlu varsayılan parametre)
drop function if exists public.update_room_details(uuid, text, text, text);

create or replace function public.update_room_details(
  p_room_id uuid,
  p_title text default null,
  p_description text default null,
  p_announcement text default null,
  p_theme_id text default null
)
returns public.rooms
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  updated_room public.rooms;
  clean_title text := nullif(btrim(coalesce(p_title, '')), '');
  clean_description text := case when p_description is null then null else btrim(p_description) end;
  clean_announcement text := case when p_announcement is null then null else btrim(p_announcement) end;
  clean_theme text := nullif(btrim(coalesce(p_theme_id, '')), '');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room owner can change settings'; end if;
  if clean_title is not null and char_length(clean_title) > 36 then raise exception 'Title too long'; end if;
  if clean_description is not null and char_length(clean_description) > 180 then raise exception 'Description too long'; end if;
  if clean_announcement is not null and char_length(clean_announcement) > 200 then raise exception 'Announcement too long'; end if;
  if clean_theme is not null and clean_theme not in ('midnight', 'royal_gold', 'nebula', 'ruby', 'emerald', 'aurora') then
    raise exception 'Invalid room theme';
  end if;
  if public.contains_blocked_term(coalesce(clean_title, '') || ' ' || coalesce(clean_description, '') || ' ' || coalesce(clean_announcement, '')) then
    raise exception 'Room text contains blocked language';
  end if;

  perform set_config('sora.room_privileged', 'on', true);
  update public.rooms
     set title = coalesce(clean_title, title),
         description = coalesce(clean_description, description),
         announcement = case
           when clean_announcement is null then announcement
           when clean_announcement = '' then 'Hoşgeldin'
           else clean_announcement end,
         theme_id = coalesce(clean_theme, theme_id),
         updated_at = now()
   where id = p_room_id
   returning * into updated_room;
  perform set_config('sora.room_privileged', 'off', true);
  return updated_room;
end;
$$;

revoke all on function public.update_room_details(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_room_details(uuid, text, text, text, text) to authenticated;

-- 3. Günlük Görev ödüllerini 2Mn günlük ödül ekonomisine uyarla (toplam 1,5Mn)
create or replace function public.mission_spec(p_key text)
returns table(target integer, reward integer, title text, description text, icon text)
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select specs.target, specs.reward, specs.title, specs.description, specs.icon
    from (
    values
      ('join_room',     1, 250000, 'Sesli Odaya Katıl',    'Bugün herhangi bir sesli odaya gir',         'mic'),
      ('send_chat',     3, 350000, 'Sohbete Katıl',        'Oda sohbetine 3 mesaj yaz',                  'chatbubble-ellipses'),
      ('send_reaction', 3, 200000, 'Enerji Ver',           'Odada 3 hızlı emoji tepkisi gönder',         'happy'),
      ('send_gift',     1, 700000, 'Cömertlik Göster',     'Odada veya ailede 1 hediye gönder',          'gift')
  ) as specs(k, target, reward, title, description, icon)
  where specs.k = p_key;
$$;

-- 4. 7 Günlük Giriş Serisi ödüllerini 250B → 5Mn (toplam 10Mn) yap
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
    'streak_rewards', jsonb_build_array(250000, 400000, 600000, 850000, 1200000, 1700000, 5000000),
    'missions', coalesce(v_missions, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_daily_missions_status() from public, anon;
grant execute on function public.get_daily_missions_status() to authenticated;

-- 5. Bigint cüzdan bakiyesi güvenli claim_daily_mission
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
  v_balance bigint;
  v_promo bigint;
  v_paid bigint;
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

-- 6. Bigint cüzdan bakiyesi güvenli & yeni ödüllü claim_streak_bonus
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
  v_rewards integer[] := array[250000, 400000, 600000, 850000, 1200000, 1700000, 5000000];
  v_reward integer;
  v_balance bigint;
  v_promo bigint;
  v_paid bigint;
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

-- 7. Bigint güvenli Şanslı Paket oluşturma ve kapma RPC'leri
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
  v_balance bigint;
  v_promo bigint;
  v_paid bigint;
  v_promo_spent bigint;
  v_paid_spent bigint;
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

  v_promo_spent := least(v_promo, v_amt::bigint);
  v_paid_spent := v_amt::bigint - v_promo_spent;

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
  v_balance bigint;
  v_promo bigint;
  v_paid bigint;
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
