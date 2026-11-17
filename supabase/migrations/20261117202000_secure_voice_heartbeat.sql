-- A heartbeat must only affect the caller's own active session.  Previously a
-- signed-in user could submit an arbitrary failed_provider without a session
-- and inflate the global failover/cooldown counters.
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

  -- Lock and load the caller's session first.  No session means this request
  -- cannot record provider failures or change usage counters.
  select * into v_sess
    from public.voice_active_sessions as active_session
   where active_session.room_id = p_room_id
     and active_session.user_id = v_uid
   for update;

  if not found then
    return jsonb_build_object('ok', true, 'recorded_seconds', 0, 'ended', p_ended);
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
  if v_delta > 0 then
    insert into public.voice_provider_usage_monthly (provider_id, usage_month, used_seconds, updated_at)
    values (v_sess.provider_id, v_month, v_delta, now())
    on conflict (provider_id, usage_month) do update
    set used_seconds = public.voice_provider_usage_monthly.used_seconds + excluded.used_seconds,
        updated_at = now();
  end if;

  if p_ended then
    delete from public.voice_active_sessions
     where room_id = p_room_id
       and user_id = v_uid;

    select count(*) into v_remaining
      from public.voice_active_sessions as remaining_session
     where remaining_session.room_id = p_room_id
       and remaining_session.last_heartbeat_at >= now() - interval '2 minutes';

    if v_remaining = 0 then
      perform set_config('sora.room_privileged', 'on', true);
      update public.rooms
         set voice_provider = null,
             voice_provider_pinned_at = null
       where id = p_room_id;
    end if;
  else
    update public.voice_active_sessions
       set last_heartbeat_at = now()
     where room_id = p_room_id
       and user_id = v_uid;
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

