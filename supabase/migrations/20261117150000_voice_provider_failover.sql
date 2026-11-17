-- ============================================================================
-- Sora Voice: Sıralı Çoklu Ses Sağlayıcı Kota Devri (Sequential Voice Failover)
-- Sıra: LiveKit -> Agora -> Cloudflare Realtime -> LiveKit Yedek (Self-Hosted)
-- - Global aylık dakika sayacı ve %95 eşiğinde otomatik sonraki servise geçiş
-- - Açık/aktif odaların bölünmemesi için oda bazlı sağlayıcı sabitleme (pinning)
-- - Tüm sağlayıcılarda ortak sahne koltuğu (seat_index) ve Realtime senkronu
-- ============================================================================

alter table public.room_members
  add column if not exists seat_index smallint
  check (seat_index is null or (seat_index >= 0 and seat_index <= 13));

alter table public.rooms
  add column if not exists voice_provider text
  check (voice_provider is null or voice_provider in ('livekit', 'agora', 'cloudflare', 'livekit_backup')),
  add column if not exists voice_provider_pinned_at timestamptz;

update public.room_members m
set seat_index = 0
from public.rooms r
where r.id = m.room_id
  and r.host_id = m.user_id
  and m.removed_at is null
  and m.seat_index is distinct from 0;

create or replace function public.sync_room_member_seat_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.removed_at is not null then
    new.seat_index := null;
  elsif new.role = 'host' then
    new.seat_index := 0;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_room_member_seat_integrity() from public, anon, authenticated;

drop trigger if exists sync_room_member_seat_integrity on public.room_members;
create trigger sync_room_member_seat_integrity
before insert or update on public.room_members
for each row execute function public.sync_room_member_seat_integrity();

do $$
begin
  alter publication supabase_realtime add table public.room_members;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

create or replace function public.guard_room_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('sora.room_privileged', true), '') = 'on' then
    return new;
  end if;
  if new.background_path is distinct from old.background_path
    or new.password_protected is distinct from old.password_protected
    or new.password_changed_at is distinct from old.password_changed_at
    or new.music_state is distinct from old.music_state
    or new.seat_count is distinct from old.seat_count
    or new.couple_seat is distinct from old.couple_seat
    or new.announcement is distinct from old.announcement
    or new.voice_provider is distinct from old.voice_provider
    or new.voice_provider_pinned_at is distinct from old.voice_provider_pinned_at then
    raise exception 'Use room settings functions for this change';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_room_privileged_columns() from public, anon, authenticated;

-- ── 1. Sağlayıcı Kuyruğu ve Aylık Kota Tabloları ─────────────────────────────
create table if not exists public.voice_provider_configs (
  provider_id text primary key check (provider_id in ('livekit', 'agora', 'cloudflare', 'livekit_backup')),
  display_name text not null,
  priority_order integer not null,
  monthly_limit_minutes integer not null check (monthly_limit_minutes > 0),
  switch_threshold_ratio numeric(4, 3) not null default 0.950 check (switch_threshold_ratio > 0 and switch_threshold_ratio <= 1),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.voice_provider_configs (
  provider_id, display_name, priority_order, monthly_limit_minutes, switch_threshold_ratio, enabled
)
values
  ('livekit', 'LiveKit Cloud', 10, 5000, 0.950, true),
  ('agora', 'Agora RTC', 20, 10000, 0.950, true),
  ('cloudflare', 'Cloudflare Realtime', 30, 250000, 0.950, true),
  ('livekit_backup', 'LiveKit Yedek Sunucu', 40, 500000, 0.980, true)
on conflict (provider_id) do update
set display_name = excluded.display_name,
    priority_order = excluded.priority_order;

alter table public.voice_provider_configs enable row level security;

create table if not exists public.voice_provider_usage_monthly (
  provider_id text not null references public.voice_provider_configs(provider_id) on delete cascade,
  usage_month text not null check (usage_month ~ '^[0-9]{4}-[0-9]{2}$'),
  used_seconds bigint not null default 0 check (used_seconds >= 0),
  session_count bigint not null default 0 check (session_count >= 0),
  failover_count integer not null default 0 check (failover_count >= 0),
  error_streak integer not null default 0 check (error_streak >= 0),
  cooldown_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (provider_id, usage_month)
);

alter table public.voice_provider_usage_monthly enable row level security;

create table if not exists public.voice_active_sessions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider_id text not null references public.voice_provider_configs(provider_id),
  agora_uid integer not null check (agora_uid > 0),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists voice_active_sessions_room_hb_idx
  on public.voice_active_sessions(room_id, last_heartbeat_at desc);

create index if not exists voice_active_sessions_user_idx
  on public.voice_active_sessions(user_id);

alter table public.voice_active_sessions enable row level security;

drop policy if exists "Room members view active voice sessions" on public.voice_active_sessions;
create policy "Room members view active voice sessions"
  on public.voice_active_sessions for select to authenticated
  using (
    exists (
      select 1 from public.room_members m
      where m.room_id = voice_active_sessions.room_id
        and m.user_id = (select auth.uid())
        and m.removed_at is null
    )
  );

grant select on public.voice_active_sessions to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.voice_active_sessions;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

-- Deterministik 31-bit pozitif Agora UID üretici (1 .. 2147483646)
create or replace function public.compute_agora_uid(p_user_id uuid)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select greatest(1, abs(hashtextextended(p_user_id::text, 7919)) % 2147483645 + 1)::integer;
$$;

revoke all on function public.compute_agora_uid(uuid) from public, anon;
grant execute on function public.compute_agora_uid(uuid) to authenticated;

-- Askıda kalmış eski ses oturumlarını temizleyip son dilimi sayaca yazar
create or replace function public.sweep_stale_voice_sessions()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month text := to_char(timezone('utc', now()), 'YYYY-MM');
  v_row record;
begin
  for v_row in
    delete from public.voice_active_sessions s
    where s.last_heartbeat_at < now() - interval '3 minutes'
    returning s.provider_id, s.room_id,
      greatest(0, least(60, extract(epoch from (now() - s.last_heartbeat_at))::integer)) as tail_sec
  loop
    if v_row.tail_sec > 0 then
      insert into public.voice_provider_usage_monthly (provider_id, usage_month, used_seconds, updated_at)
      values (v_row.provider_id, v_month, v_row.tail_sec, now())
      on conflict (provider_id, usage_month) do update
      set used_seconds = public.voice_provider_usage_monthly.used_seconds + excluded.used_seconds,
          updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function public.sweep_stale_voice_sessions() from public, anon, authenticated;

-- ── 2. Atomik Sağlayıcı Seçimi ve Oturum Başlatma ────────────────────────────
create or replace function public.allocate_voice_session(
  p_room_id uuid,
  p_configured_providers text[],
  p_exclude_providers text[] default '{}'::text[]
)
returns table (
  provider_id text,
  agora_uid integer,
  role text,
  is_muted boolean,
  seat_index smallint,
  is_host boolean,
  used_minutes integer,
  monthly_limit_minutes integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_member public.room_members;
  v_month text := to_char(timezone('utc', now()), 'YYYY-MM');
  v_chosen text := null;
  v_active_in_room integer := 0;
  v_agora_uid integer;
  v_used_sec bigint := 0;
  v_limit_min integer := 5000;
  v_prev_session public.voice_active_sessions;
  v_prev_delta integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(array_length(p_configured_providers, 1), 0) = 0 then
    raise exception 'No voice provider configured';
  end if;

  perform public.sweep_stale_voice_sessions();
  perform set_config('sora.room_privileged', 'on', true);

  select * into v_room
  from public.rooms r
  where r.id = p_room_id and r.state = 'live'
  for update;

  if not found then
    raise exception 'Room is unavailable';
  end if;

  select * into v_member
  from public.room_members m
  where m.room_id = p_room_id and m.user_id = v_uid and m.removed_at is null;

  if not found then
    raise exception 'Room membership required';
  end if;

  -- Aynı odada aktif ses oturumu varsa ve sağlayıcı hariç tutulmamışsa odayı bölmemek için koru
  if v_room.voice_provider is not null
     and v_room.voice_provider = any(p_configured_providers)
     and not (v_room.voice_provider = any(coalesce(p_exclude_providers, '{}'::text[]))) then
    select count(*) into v_active_in_room
    from public.voice_active_sessions s
    where s.room_id = p_room_id
      and s.user_id <> v_uid
      and s.provider_id = v_room.voice_provider
      and s.last_heartbeat_at >= now() - interval '2 minutes';

    if v_active_in_room > 0 then
      v_chosen := v_room.voice_provider;
    end if;
  end if;

  -- Yoksa global sıradan (LiveKit -> Agora -> Cloudflare -> Yedek) kotası uygun ilk sağlayıcıyı seç
  if v_chosen is null then
    select c.provider_id
      into v_chosen
    from public.voice_provider_configs c
    left join public.voice_provider_usage_monthly u
      on u.provider_id = c.provider_id and u.usage_month = v_month
    where c.enabled = true
      and c.provider_id = any(p_configured_providers)
      and not (c.provider_id = any(coalesce(p_exclude_providers, '{}'::text[])))
    order by
      (u.cooldown_until is null or u.cooldown_until <= now()) desc,
      (coalesce(u.used_seconds, 0) < floor(c.monthly_limit_minutes::numeric * 60 * c.switch_threshold_ratio)::bigint) desc,
      (coalesce(u.used_seconds, 0) < (c.monthly_limit_minutes::bigint * 60)) desc,
      c.priority_order asc
    limit 1;

    -- Tüm adaylar exclude edildiyse en azından yapılandırılmış ilk sağlayıcıya düş
    if v_chosen is null then
      select c.provider_id
        into v_chosen
      from public.voice_provider_configs c
      where c.enabled = true
        and c.provider_id = any(p_configured_providers)
      order by c.priority_order asc
      limit 1;
    end if;

    if v_chosen is null then
      raise exception 'No voice provider available';
    end if;

    if v_room.voice_provider is distinct from v_chosen then
      update public.rooms
      set voice_provider = v_chosen,
          voice_provider_pinned_at = now()
      where id = p_room_id;
    end if;
  end if;

  -- Önceki oturum varsa kalan saniyeyi sayaca ekle
  select * into v_prev_session
  from public.voice_active_sessions s
  where s.room_id = p_room_id and s.user_id = v_uid;

  if found then
    v_prev_delta := greatest(0, least(95, extract(epoch from (now() - v_prev_session.last_heartbeat_at))::integer));
    if v_prev_delta > 0 then
      insert into public.voice_provider_usage_monthly (provider_id, usage_month, used_seconds, updated_at)
      values (v_prev_session.provider_id, v_month, v_prev_delta, now())
      on conflict (provider_id, usage_month) do update
      set used_seconds = public.voice_provider_usage_monthly.used_seconds + excluded.used_seconds,
          updated_at = now();
    end if;
  end if;

  v_agora_uid := public.compute_agora_uid(v_uid);
  while exists (
    select 1 from public.voice_active_sessions s
    where s.room_id = p_room_id and s.user_id <> v_uid and s.agora_uid = v_agora_uid
  ) loop
    v_agora_uid := (v_agora_uid % 2147483640) + 1;
  end loop;

  insert into public.voice_active_sessions (room_id, user_id, provider_id, agora_uid, started_at, last_heartbeat_at)
  values (p_room_id, v_uid, v_chosen, v_agora_uid, now(), now())
  on conflict (room_id, user_id) do update
  set provider_id = excluded.provider_id,
      agora_uid = excluded.agora_uid,
      last_heartbeat_at = now();

  insert into public.voice_provider_usage_monthly (provider_id, usage_month, used_seconds, session_count, error_streak, updated_at)
  values (v_chosen, v_month, 0, 1, 0, now())
  on conflict (provider_id, usage_month) do update
  set session_count = public.voice_provider_usage_monthly.session_count + 1,
      error_streak = 0,
      updated_at = now();

  select coalesce(u.used_seconds, 0), c.monthly_limit_minutes
    into v_used_sec, v_limit_min
  from public.voice_provider_configs c
  left join public.voice_provider_usage_monthly u
    on u.provider_id = c.provider_id and u.usage_month = v_month
  where c.provider_id = v_chosen;

  return query
  select
    v_chosen,
    v_agora_uid,
    case when v_room.host_id = v_uid then 'host'::text else v_member.role end,
    case when v_room.host_id = v_uid then false else v_member.is_muted end,
    case when v_room.host_id = v_uid then 0::smallint else v_member.seat_index end,
    (v_room.host_id = v_uid),
    floor(v_used_sec / 60.0)::integer,
    v_limit_min;
end;
$$;

revoke all on function public.allocate_voice_session(uuid, text[], text[]) from public, anon;
grant execute on function public.allocate_voice_session(uuid, text[], text[]) to authenticated;

-- ── 3. Canlı Dakika Sayacı Kalp Atışı & Hata Bildirimi ──────────────────────
create or replace function public.heartbeat_voice_session(
  p_room_id uuid,
  p_ended boolean default false,
  p_failed_provider text default null,
  p_error_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_month text := to_char(timezone('utc', now()), 'YYYY-MM');
  v_sess public.voice_active_sessions;
  v_delta integer := 0;
  v_remaining integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  perform set_config('sora.room_privileged', 'on', true);

  if p_failed_provider is not null and p_failed_provider in ('livekit', 'agora', 'cloudflare', 'livekit_backup') then
    insert into public.voice_provider_usage_monthly (
      provider_id, usage_month, failover_count, error_streak, last_error, updated_at
    )
    values (
      p_failed_provider, v_month, 1, 1, left(coalesce(p_error_text, 'connection_failed'), 240), now()
    )
    on conflict (provider_id, usage_month) do update
    set failover_count = public.voice_provider_usage_monthly.failover_count + 1,
        error_streak = public.voice_provider_usage_monthly.error_streak + 1,
        cooldown_until = case
          when public.voice_provider_usage_monthly.error_streak + 1 >= 3 then now() + interval '90 seconds'
          else public.voice_provider_usage_monthly.cooldown_until
        end,
        last_error = left(coalesce(p_error_text, 'connection_failed'), 240),
        updated_at = now();
  end if;

  select * into v_sess
  from public.voice_active_sessions s
  where s.room_id = p_room_id and s.user_id = v_uid
  for update;

  if found then
    v_delta := greatest(0, least(95, extract(epoch from (now() - v_sess.last_heartbeat_at))::integer));
    if v_delta > 0 then
      insert into public.voice_provider_usage_monthly (provider_id, usage_month, used_seconds, updated_at)
      values (v_sess.provider_id, v_month, v_delta, now())
      on conflict (provider_id, usage_month) do update
      set used_seconds = public.voice_provider_usage_monthly.used_seconds + excluded.used_seconds,
          updated_at = now();
    end if;

    if p_ended then
      delete from public.voice_active_sessions
      where room_id = p_room_id and user_id = v_uid;

      select count(*) into v_remaining
      from public.voice_active_sessions
      where room_id = p_room_id
        and last_heartbeat_at >= now() - interval '2 minutes';

      if v_remaining = 0 then
        update public.rooms
        set voice_provider = null,
            voice_provider_pinned_at = null
        where id = p_room_id;
      end if;
    else
      update public.voice_active_sessions
      set last_heartbeat_at = now()
      where room_id = p_room_id and user_id = v_uid;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'recorded_seconds', v_delta,
    'ended', p_ended
  );
end;
$$;

revoke all on function public.heartbeat_voice_session(uuid, boolean, text, text) from public, anon;
grant execute on function public.heartbeat_voice_session(uuid, boolean, text, text) to authenticated;

-- Odadan tamamen çıkıldığında koltuk ve aktif ses oturumunu da temizle
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.room_members
  set seat_index = case when role = 'host' then 0::smallint else null end,
      hand_raised_at = null,
      password_verified_at = null,
      updated_at = now()
  where room_id = p_room_id and user_id = auth.uid();

  perform public.heartbeat_voice_session(p_room_id, true, null, null);
end;
$$;

revoke all on function public.leave_room(uuid) from public, anon;
grant execute on function public.leave_room(uuid) to authenticated;

-- ── 4. Sağlayıcıdan Bağımsız Sahne Koltuğu Yazma / Temizleme ────────────────
create or replace function public.commit_room_seat(
  p_room_id uuid,
  p_target_user_id uuid,
  p_seat_index integer,
  p_valid_seats integer[] default null
)
returns smallint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_actor_role text;
  v_room public.rooms;
  v_seat smallint;
  v_candidate integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_room from public.rooms where id = p_room_id and state = 'live' for update;
  if not found then raise exception 'Room is unavailable'; end if;

  select m.role into v_actor_role
  from public.room_members m
  where m.room_id = p_room_id and m.user_id = v_uid and m.removed_at is null;

  if v_actor_role is null then raise exception 'Room membership required'; end if;
  if v_uid <> p_target_user_id and v_actor_role not in ('host', 'moderator') then
    raise exception 'Moderator permission required';
  end if;

  if p_seat_index is null and p_valid_seats is null then
    update public.room_members
    set seat_index = case when p_target_user_id = v_room.host_id then 0::smallint else null end,
        updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
    return case when p_target_user_id = v_room.host_id then 0::smallint else null end;
  end if;

  if p_target_user_id = v_room.host_id then
    update public.room_members
    set seat_index = 0, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
    return 0::smallint;
  end if;

  if p_seat_index is not null then
    if p_valid_seats is not null and not (p_seat_index = any(p_valid_seats)) then
      raise exception 'Invalid seat';
    end if;
    if exists (
      select 1
      from public.room_members m
      join public.voice_active_sessions s on s.room_id = m.room_id and s.user_id = m.user_id
      where m.room_id = p_room_id
        and m.user_id <> p_target_user_id
        and m.removed_at is null
        and m.seat_index = p_seat_index
        and s.last_heartbeat_at >= now() - interval '2 minutes'
    ) then
      raise exception 'Seat is taken';
    end if;
    v_seat := p_seat_index::smallint;
  else
    foreach v_candidate in array coalesce(p_valid_seats, '{}'::integer[]) loop
      if not exists (
        select 1
        from public.room_members m
        join public.voice_active_sessions s on s.room_id = m.room_id and s.user_id = m.user_id
        where m.room_id = p_room_id
          and m.user_id <> p_target_user_id
          and m.removed_at is null
          and m.seat_index = v_candidate
          and s.last_heartbeat_at >= now() - interval '2 minutes'
      ) then
        v_seat := v_candidate::smallint;
        exit;
      end if;
    end loop;
    if v_seat is null then
      raise exception 'No free seat';
    end if;
  end if;

  update public.room_members
  set seat_index = v_seat,
      updated_at = now()
  where room_id = p_room_id and user_id = p_target_user_id;

  return v_seat;
end;
$$;

revoke all on function public.commit_room_seat(uuid, uuid, integer, integer[]) from public, anon;
grant execute on function public.commit_room_seat(uuid, uuid, integer, integer[]) to authenticated;

create or replace function public.prune_invalid_room_seats(
  p_room_id uuid,
  p_valid_seats integer[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select m.role into v_role
  from public.room_members m
  where m.room_id = p_room_id and m.user_id = v_uid and m.removed_at is null;
  if v_role not in ('host', 'moderator') then
    raise exception 'Moderator permission required';
  end if;

  update public.room_members m
  set seat_index = null,
      updated_at = now()
  where m.room_id = p_room_id
    and m.seat_index is not null
    and m.seat_index > 0
    and not (m.seat_index = any(coalesce(p_valid_seats, '{}'::integer[])));
end;
$$;

revoke all on function public.prune_invalid_room_seats(uuid, integer[]) from public, anon;
grant execute on function public.prune_invalid_room_seats(uuid, integer[]) to authenticated;

-- ── 5. Yönetici Kota Durumu Görünümü ─────────────────────────────────────────
create or replace function public.admin_get_voice_provider_status()
returns table (
  provider_id text,
  display_name text,
  priority_order integer,
  enabled boolean,
  used_minutes integer,
  monthly_limit_minutes integer,
  switch_threshold_minutes integer,
  active_sessions bigint,
  failover_count integer,
  cooldown_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_month text := to_char(timezone('utc', now()), 'YYYY-MM');
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    c.provider_id,
    c.display_name,
    c.priority_order,
    c.enabled,
    floor(coalesce(u.used_seconds, 0) / 60.0)::integer as used_minutes,
    c.monthly_limit_minutes,
    floor(c.monthly_limit_minutes::numeric * c.switch_threshold_ratio)::integer as switch_threshold_minutes,
    (
      select count(*)
      from public.voice_active_sessions s
      where s.provider_id = c.provider_id
        and s.last_heartbeat_at >= now() - interval '2 minutes'
    ) as active_sessions,
    coalesce(u.failover_count, 0) as failover_count,
    u.cooldown_until
  from public.voice_provider_configs c
  left join public.voice_provider_usage_monthly u
    on u.provider_id = c.provider_id and u.usage_month = v_month
  order by c.priority_order asc;
end;
$$;

revoke all on function public.admin_get_voice_provider_status() from public, anon;
grant execute on function public.admin_get_voice_provider_status() to authenticated;

notify pgrst, 'reload schema';
