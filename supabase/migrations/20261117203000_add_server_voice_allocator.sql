-- Provider configuration is trusted input and must come from the Edge
-- Function, not from a mobile client's direct RPC call.  This wrapper is the
-- only server-side entry point and temporarily supplies the authenticated
-- user's subject to the existing allocator.
create or replace function public.allocate_voice_session_server(
  p_room_id uuid,
  p_user_id uuid,
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
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server access required';
  end if;
  if p_user_id is null then
    raise exception 'User ID required';
  end if;

  -- auth.uid() reads this transaction-local claim in the nested allocator.
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  return query
    select *
      from public.allocate_voice_session(
        p_room_id,
        p_configured_providers,
        coalesce(p_exclude_providers, '{}'::text[])
      );
end;
$$;

revoke all on function public.allocate_voice_session_server(uuid, uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.allocate_voice_session_server(uuid, uuid, text[], text[]) to service_role;

