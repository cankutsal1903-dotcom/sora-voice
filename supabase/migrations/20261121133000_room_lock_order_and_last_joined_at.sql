-- Fix lock-order deadlocks and mid-join timestamp collision:
-- 1) Add room_members.last_joined_at (set only in join_room, cleared in leave_room)
--    so leave_room / seat / moderation updates to updated_at never block empty-room closure.
-- 2) Enforce single global lock order (rooms -> voice_active_sessions) in heartbeat_voice_session
--    and run sweep_stale_voice_sessions(p_exclude_room_id) with FOR UPDATE SKIP LOCKED BEFORE
--    acquiring any rooms lock in allocate_voice_session.

alter table public.room_members
  add column if not exists last_joined_at timestamptz;

create or replace function public.join_room(p_room_id uuid, p_password text default null)
returns table(role text, is_muted boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  current_room public.rooms;
  member public.room_members;
  secret_hash text;
  needs_password boolean := false;
  is_room_host boolean := false;
  ban_expired boolean := false;
  has_active_voice boolean := false;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into current_room from public.rooms where id = p_room_id and state = 'live';
  if not found then raise exception 'Room is unavailable'; end if;
  if public.users_blocked(v_uid, current_room.host_id) then raise exception 'Room is unavailable'; end if;
  if exists (
    select 1 from public.user_sanctions
    where user_id = v_uid and active and action in ('suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then raise exception 'Room access is restricted'; end if;

  is_room_host := (current_room.host_id = v_uid);

  select * into member from public.room_members m where m.room_id = p_room_id and m.user_id = v_uid;
  if found and member.removed_at is not null and not is_room_host then
    if member.banned_until is not null and member.banned_until <= now() then
      ban_expired := true;
    elsif member.banned_until is not null then
      raise exception 'Room ban active until %', to_char(member.banned_until at time zone 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI');
    else
      raise exception 'You were removed from this room';
    end if;
  end if;

  if current_room.room_locked
     and not is_room_host
     and coalesce(member.role, '') <> 'moderator'
     and (member.user_id is null or member.removed_at is not null) then
    raise exception 'Room is locked';
  end if;

  if member.user_id is not null and member.removed_at is null then
    select exists (
      select 1 from public.voice_active_sessions vas
      where vas.room_id = p_room_id
        and vas.user_id = v_uid
        and vas.last_heartbeat_at >= now() - interval '3 minutes'
    ) into has_active_voice;
  end if;

  if current_room.password_protected and not is_room_host then
    needs_password := not (
      member.user_id is not null
      and not ban_expired
      and (
        member.role = 'moderator'
        or has_active_voice
        or (member.password_verified_at is not null
          and member.password_verified_at >= coalesce(current_room.password_changed_at, '-infinity'::timestamptz))
      )
    );
  end if;

  if needs_password then
    if p_password is null or p_password = '' then raise exception 'Room password required'; end if;
    if (
      select count(*) from public.room_password_failures f
      where f.room_id = p_room_id and f.user_id = v_uid and f.failed_at > now() - interval '15 minutes'
    ) >= 5 then
      raise exception 'Too many password attempts';
    end if;
    select s.password_hash into secret_hash from public.room_secrets s where s.room_id = p_room_id;
    if secret_hash is null or extensions.crypt(p_password, secret_hash) <> secret_hash then
      insert into public.room_password_failures (room_id, user_id) values (p_room_id, v_uid);
      return;
    end if;
    delete from public.room_password_failures
    where room_id = p_room_id and user_id = v_uid;
  end if;

  if member.user_id is null then
    insert into public.room_members (
      room_id, user_id, role, is_muted, seat_index, password_verified_at, last_joined_at, updated_at
    )
    values (
      p_room_id,
      v_uid,
      case when is_room_host then 'host' else 'listener' end,
      false,
      case when is_room_host then 0::smallint else null end,
      case when needs_password or has_active_voice then now() else null end,
      now(),
      now()
    );
  else
    update public.room_members m
    set role = case when is_room_host then 'host' when ban_expired then 'listener' else m.role end,
        is_muted = case when is_room_host or ban_expired then false else m.is_muted end,
        seat_index = case when is_room_host then 0::smallint else m.seat_index end,
        removed_at = case when is_room_host or ban_expired then null else m.removed_at end,
        banned_until = case when is_room_host or ban_expired then null else m.banned_until end,
        last_joined_at = now(),
        updated_at = now(),
        password_verified_at = case when needs_password or has_active_voice then now() else m.password_verified_at end
    where m.room_id = p_room_id and m.user_id = v_uid;
  end if;

  perform set_config('sora.room_privileged', 'on', true);
  update public.rooms
     set last_active_at = now()
   where id = p_room_id
     and state = 'live';
  perform set_config('sora.room_privileged', 'off', true);

  return query select m.role, m.is_muted from public.room_members m where m.room_id = p_room_id and m.user_id = v_uid;
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.room_members
     set seat_index = null,
         hand_raised_at = null,
         password_verified_at = null,
         last_joined_at = null,
         updated_at = now()
   where room_id = p_room_id
     and user_id = auth.uid();

  perform public.heartbeat_voice_session(p_room_id, true, null, null);
end;
$$;

revoke all on function public.leave_room(uuid) from public, anon;
grant execute on function public.leave_room(uuid) to authenticated;

drop function if exists public.sweep_stale_voice_sessions();

create or replace function public.sweep_stale_voice_sessions(
  p_exclude_room_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month text := to_char(timezone('utc', now()), 'YYYY-MM');
  v_row record;
  v_remaining integer := 0;
begin
  for v_row in
    with stale as (
      select s.room_id, s.user_id
        from public.voice_active_sessions s
       where s.last_heartbeat_at < now() - interval '3 minutes'
         and (p_exclude_room_id is null or s.room_id <> p_exclude_room_id)
       order by s.room_id, s.user_id
       for update skip locked
    ),
    deleted as (
      delete from public.voice_active_sessions target
       using stale
       where target.room_id = stale.room_id
         and target.user_id = stale.user_id
      returning target.provider_id, target.room_id,
        greatest(0, least(60, extract(epoch from (now() - target.last_heartbeat_at))::integer)) as tail_sec
    )
    select provider_id, room_id, tail_sec
      from deleted
     order by room_id
  loop
    if v_row.tail_sec > 0 then
      insert into public.voice_provider_usage_monthly (provider_id, usage_month, used_seconds, updated_at)
      values (v_row.provider_id, v_month, v_row.tail_sec, now())
      on conflict (provider_id, usage_month) do update
      set used_seconds = public.voice_provider_usage_monthly.used_seconds + excluded.used_seconds,
          updated_at = now();
    end if;

    v_remaining := public.count_active_room_sessions(v_row.room_id, null);
    if v_remaining = 0 then
      perform set_config('sora.room_privileged', 'on', true);
      update public.rooms
         set state = 'inactive',
             listener_count = 0,
             voice_provider = null,
             voice_provider_pinned_at = null,
             last_active_at = now()
       where id = v_row.room_id
         and state = 'live'
         and last_active_at < now() - interval '2 minutes'
         and not exists (
           select 1
             from public.room_members rm
            where rm.room_id = v_row.room_id
              and rm.removed_at is null
              and rm.last_joined_at >= now() - interval '25 seconds'
         );
      perform set_config('sora.room_privileged', 'off', true);
    end if;
  end loop;
end;
$$;

revoke all on function public.sweep_stale_voice_sessions(uuid) from public, anon, authenticated;

create or replace function public.allocate_voice_session(
  p_room_id uuid,
  p_configured_providers text[],
  p_exclude_providers text[] default '{}'::text[]
)
returns table(
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
  v_active_now integer := 1;
  v_agora_uid integer;
  v_used_sec bigint := 0;
  v_limit_min integer := 5000;
  v_prev_session public.voice_active_sessions;
  v_prev_delta integer := 0;
  v_is_host boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if coalesce(array_length(p_configured_providers, 1), 0) = 0 then
    raise exception 'No voice provider configured';
  end if;

  -- Sweep other rooms BEFORE acquiring any lock on p_room_id (prevents cross-room deadlocks
  -- and guarantees sweep never deactivates p_room_id out from under the caller).
  perform public.sweep_stale_voice_sessions(p_room_id);
  perform set_config('sora.room_privileged', 'on', true);

  select * into v_room
  from public.rooms r
  where r.id = p_room_id and r.state = 'live'
  for update;

  if not found then
    perform set_config('sora.room_privileged', 'off', true);
    raise exception 'Room is unavailable';
  end if;

  v_is_host := (v_room.host_id = v_uid);

  select * into v_member
  from public.room_members m
  where m.room_id = p_room_id and m.user_id = v_uid and m.removed_at is null;

  if not found then
    perform set_config('sora.room_privileged', 'off', true);
    raise exception 'Room membership required';
  end if;

  if v_room.voice_provider is not null
     and v_room.voice_provider = any(p_configured_providers) then
    select count(*) into v_active_in_room
    from public.voice_active_sessions s
    where s.room_id = p_room_id
      and s.user_id <> v_uid
      and s.provider_id = v_room.voice_provider
      and s.last_heartbeat_at >= now() - interval '3 minutes';

    if v_active_in_room > 0 and (not v_is_host or not (v_room.voice_provider = any(coalesce(p_exclude_providers, '{}'::text[])))) then
      v_chosen := v_room.voice_provider;
    end if;
  end if;

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
      perform set_config('sora.room_privileged', 'off', true);
      raise exception 'No voice provider available';
    end if;

    if v_room.voice_provider is distinct from v_chosen and (v_active_in_room = 0 or v_is_host) then
      update public.rooms
      set voice_provider = v_chosen,
          voice_provider_pinned_at = now()
      where id = p_room_id;
    end if;
  end if;

  select * into v_prev_session
  from public.voice_active_sessions s
  where s.room_id = p_room_id and s.user_id = v_uid
  for update;

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

  v_active_now := public.count_active_room_sessions(p_room_id, null);
  update public.rooms
     set listener_count = greatest(1, v_active_now),
         last_active_at = now()
   where id = p_room_id
     and state = 'live';

  insert into public.voice_provider_usage_monthly (provider_id, usage_month, used_seconds, session_count, updated_at)
  values (v_chosen, v_month, 0, 1, now())
  on conflict (provider_id, usage_month) do update
  set session_count = public.voice_provider_usage_monthly.session_count + 1,
      updated_at = now();

  select coalesce(u.used_seconds, 0), c.monthly_limit_minutes
    into v_used_sec, v_limit_min
  from public.voice_provider_configs c
  left join public.voice_provider_usage_monthly u
    on u.provider_id = c.provider_id and u.usage_month = v_month
  where c.provider_id = v_chosen;

  perform set_config('sora.room_privileged', 'off', true);

  return query
  select
    v_chosen,
    v_agora_uid,
    case when v_is_host then 'host'::text else v_member.role end,
    case when v_is_host then false else v_member.is_muted end,
    case when v_is_host then 0::smallint else v_member.seat_index end,
    v_is_host,
    floor(v_used_sec / 60.0)::integer,
    v_limit_min;
end;
$$;

revoke all on function public.allocate_voice_session(uuid, text[], text[]) from public, anon, authenticated;

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

  -- Lock rooms BEFORE voice_active_sessions to match allocate_voice_session lock order.
  perform 1
    from public.rooms r
   where r.id = p_room_id
   for update;

  select * into v_sess
    from public.voice_active_sessions as active_session
   where active_session.room_id = p_room_id
     and active_session.user_id = v_uid
   for update;

  if not found then
    if p_ended then
      v_remaining := public.count_active_room_sessions(p_room_id, null);
      perform set_config('sora.room_privileged', 'on', true);
      if v_remaining = 0 then
        update public.rooms
           set state = 'inactive',
               listener_count = 0,
               voice_provider = null,
               voice_provider_pinned_at = null,
               last_active_at = now()
         where id = p_room_id
           and state = 'live'
           and last_active_at < now() - interval '45 seconds'
           and not exists (
             select 1
               from public.room_members rm
              where rm.room_id = p_room_id
                and rm.user_id <> v_uid
                and rm.removed_at is null
                and rm.last_joined_at >= now() - interval '25 seconds'
           );
      else
        update public.rooms
           set listener_count = v_remaining,
               last_active_at = now()
         where id = p_room_id
           and state = 'live';
      end if;
      perform set_config('sora.room_privileged', 'off', true);
    end if;
    return jsonb_build_object('ok', true, 'recorded_seconds', 0, 'ended', p_ended, 'remaining', v_remaining);
  end if;

  if p_failed_provider is not null
     and p_failed_provider = v_sess.provider_id
     and p_failed_provider in ('livekit', 'agora', 'cloudflare', 'livekit_backup') then
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
          when public.voice_provider_usage_monthly.error_streak + 1 >= 3
            then now() + interval '90 seconds'
          else public.voice_provider_usage_monthly.cooldown_until
        end,
        last_error = left(coalesce(p_error_text, 'connection_failed'), 240),
        updated_at = now();
  end if;

  v_delta := greatest(0, least(95, extract(epoch from (now() - v_sess.last_heartbeat_at))::integer));
  if v_delta > 0 or (p_failed_provider is null and not p_ended) then
    insert into public.voice_provider_usage_monthly (provider_id, usage_month, used_seconds, error_streak, updated_at)
    values (v_sess.provider_id, v_month, v_delta, 0, now())
    on conflict (provider_id, usage_month) do update
    set used_seconds = public.voice_provider_usage_monthly.used_seconds + excluded.used_seconds,
        error_streak = case when p_failed_provider is null and not p_ended then 0 else public.voice_provider_usage_monthly.error_streak end,
        updated_at = now();
  end if;

  if p_ended then
    delete from public.voice_active_sessions
     where room_id = p_room_id
       and user_id = v_uid;

    v_remaining := public.count_active_room_sessions(p_room_id, null);

    perform set_config('sora.room_privileged', 'on', true);
    if v_remaining = 0 then
      update public.rooms
         set state = 'inactive',
             listener_count = 0,
             voice_provider = null,
             voice_provider_pinned_at = null,
             last_active_at = now()
       where id = p_room_id
         and state = 'live'
         and not exists (
           select 1
             from public.room_members rm
            where rm.room_id = p_room_id
              and rm.user_id <> v_uid
              and rm.removed_at is null
              and rm.last_joined_at >= now() - interval '20 seconds'
         );
    else
      update public.rooms
         set listener_count = v_remaining,
             last_active_at = now()
       where id = p_room_id
         and state = 'live';
    end if;
    perform set_config('sora.room_privileged', 'off', true);
  else
    update public.voice_active_sessions
       set last_heartbeat_at = now()
     where room_id = p_room_id
       and user_id = v_uid;

    v_remaining := public.count_active_room_sessions(p_room_id, null);
    perform set_config('sora.room_privileged', 'on', true);
    update public.rooms
       set listener_count = greatest(1, v_remaining),
           last_active_at = now()
     where id = p_room_id
       and state = 'live';
    perform set_config('sora.room_privileged', 'off', true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'recorded_seconds', v_delta,
    'ended', p_ended,
    'remaining', v_remaining
  );
end;
$$;

revoke all on function public.heartbeat_voice_session(uuid, boolean, text, text) from public, anon;
grant execute on function public.heartbeat_voice_session(uuid, boolean, text, text) to authenticated;

create or replace function public.deactivate_stale_hosted_rooms(
  p_active_room_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_closed integer := 0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  perform set_config('sora.room_privileged', 'on', true);
  update public.rooms r
     set state = 'inactive',
         listener_count = 0,
         voice_provider = null,
         voice_provider_pinned_at = null,
         last_active_at = now()
   where r.host_id = v_uid
     and r.state = 'live'
     and (p_active_room_id is null or r.id <> p_active_room_id)
     and r.last_active_at < now() - interval '15 seconds'
     and not exists (
       select 1
         from public.voice_active_sessions vas
        where vas.room_id = r.id
          and vas.last_heartbeat_at >= now() - interval '3 minutes'
     )
     and not exists (
       select 1
         from public.room_members rm
        where rm.room_id = r.id
          and rm.user_id <> v_uid
          and rm.removed_at is null
          and rm.last_joined_at >= now() - interval '25 seconds'
     );
  get diagnostics v_closed = row_count;
  perform set_config('sora.room_privileged', 'off', true);

  return v_closed;
end;
$$;

revoke all on function public.deactivate_stale_hosted_rooms(uuid) from public, anon;
grant execute on function public.deactivate_stale_hosted_rooms(uuid) to authenticated;
