-- Oda sahibi odadan çıkıp tekrar girdiğinde room_members kaydının 'listener' olarak
-- açılması nedeniyle LiveKit canPublish=false dönmesi ve mikrofonun açılmaması hatasını düzeltir.

update public.room_members m
set role = 'host',
    is_muted = false,
    removed_at = null,
    banned_until = null,
    updated_at = now()
from public.rooms r
where r.id = m.room_id
  and r.host_id = m.user_id
  and (m.role <> 'host' or m.is_muted = true or m.removed_at is not null);

create or replace function public.join_room(p_room_id uuid, p_password text default null)
returns table(role text, is_muted boolean)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  current_room public.rooms;
  member public.room_members;
  secret_hash text;
  needs_password boolean := false;
  is_room_host boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into current_room from public.rooms where id = p_room_id and state = 'live';
  if not found then raise exception 'Room is unavailable'; end if;
  if public.users_blocked(auth.uid(), current_room.host_id) then raise exception 'Room is unavailable'; end if;
  if exists (
    select 1 from public.user_sanctions
    where user_id = auth.uid() and active and action in ('suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then raise exception 'Room access is restricted'; end if;

  is_room_host := (current_room.host_id = auth.uid());

  select * into member from public.room_members m where m.room_id = p_room_id and m.user_id = auth.uid();
  if found and member.removed_at is not null and not is_room_host then
    if member.banned_until is not null and member.banned_until <= now() then
      update public.room_members m
      set removed_at = null, banned_until = null, role = 'listener', is_muted = false, updated_at = now()
      where m.room_id = p_room_id and m.user_id = auth.uid()
      returning * into member;
    elsif member.banned_until is not null then
      raise exception 'Room ban active until %', to_char(member.banned_until at time zone 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI');
    else
      raise exception 'You were removed from this room';
    end if;
  end if;

  if current_room.password_protected and not is_room_host then
    needs_password := not (
      member.user_id is not null
      and (member.role = 'moderator'
        or (member.password_verified_at is not null
          and member.password_verified_at >= coalesce(current_room.password_changed_at, '-infinity'::timestamptz)))
    );
  end if;

  if needs_password then
    if p_password is null or p_password = '' then raise exception 'Room password required'; end if;
    if (
      select count(*) from public.room_password_failures f
      where f.room_id = p_room_id and f.user_id = auth.uid() and f.failed_at > now() - interval '15 minutes'
    ) >= 5 then
      raise exception 'Too many password attempts';
    end if;
    select s.password_hash into secret_hash from public.room_secrets s where s.room_id = p_room_id;
    if secret_hash is null or extensions.crypt(p_password, secret_hash) <> secret_hash then
      insert into public.room_password_failures (room_id, user_id) values (p_room_id, auth.uid());
      return;
    end if;
    delete from public.room_password_failures
    where room_id = p_room_id and user_id = auth.uid();
  end if;

  if member.user_id is null then
    insert into public.room_members (room_id, user_id, role, is_muted, password_verified_at)
    values (
      p_room_id,
      auth.uid(),
      case when is_room_host then 'host' else 'listener' end,
      false,
      case when needs_password then now() else null end
    );
  else
    update public.room_members m
    set role = case when is_room_host then 'host' else m.role end,
        is_muted = case when is_room_host then false else m.is_muted end,
        removed_at = case when is_room_host then null else m.removed_at end,
        banned_until = case when is_room_host then null else m.banned_until end,
        updated_at = now(),
        password_verified_at = case when needs_password then now() else m.password_verified_at end
    where m.room_id = p_room_id and m.user_id = auth.uid();
  end if;

  return query select m.role, m.is_muted from public.room_members m where m.room_id = p_room_id and m.user_id = auth.uid();
end;
$function$;
