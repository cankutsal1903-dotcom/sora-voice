create table if not exists public.app_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'moderator' check (role in ('moderator', 'admin', 'owner')),
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

create or replace function public.is_app_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1 from public.app_admins where user_id = p_user_id
  );
$$;

drop policy if exists "Admins read admin roles" on public.app_admins;
create policy "Admins read admin roles" on public.app_admins for select
  using (auth.uid() = user_id or public.is_app_admin());

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_id_idx on public.user_blocks(blocked_id);
alter table public.user_blocks enable row level security;
drop policy if exists "Users read their blocks" on public.user_blocks;
create policy "Users read their blocks" on public.user_blocks for select using (auth.uid() = blocker_id);
drop policy if exists "Users create their blocks" on public.user_blocks;
drop policy if exists "Users remove their blocks" on public.user_blocks;

create or replace function public.users_blocked(p_first_user_id uuid, p_second_user_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select p_first_user_id is not null and p_second_user_id is not null and exists (
    select 1
    from public.user_blocks
    where (blocker_id = p_first_user_id and blocked_id = p_second_user_id)
       or (blocker_id = p_second_user_id and blocked_id = p_first_user_id)
  );
$$;

create or replace function public.set_user_block(p_blocked_user_id uuid, p_blocked boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_blocked_user_id is null or p_blocked_user_id = auth.uid() then
    raise exception 'Invalid blocked user';
  end if;
  if not exists (select 1 from public.profiles where id = p_blocked_user_id) then
    raise exception 'User not found';
  end if;

  if p_blocked then
    insert into public.user_blocks (blocker_id, blocked_id)
    values (auth.uid(), p_blocked_user_id)
    on conflict do nothing;
    delete from public.follows
    where (follower_id = auth.uid() and following_id = p_blocked_user_id)
       or (follower_id = p_blocked_user_id and following_id = auth.uid());
  else
    delete from public.user_blocks
    where blocker_id = auth.uid() and blocked_id = p_blocked_user_id;
  end if;
  return p_blocked;
end;
$$;

create table if not exists public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  message_id uuid references public.room_messages(id) on delete set null,
  category text not null check (category in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'impersonation', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  resolution text not null default '' check (char_length(resolution) <= 500),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (target_user_id is not null or room_id is not null or message_id is not null)
);

create index if not exists safety_reports_status_created_at_idx on public.safety_reports(status, created_at desc);
create index if not exists safety_reports_reporter_id_idx on public.safety_reports(reporter_id, created_at desc);
alter table public.safety_reports enable row level security;
drop policy if exists "Users read own reports" on public.safety_reports;
create policy "Users read own reports" on public.safety_reports for select
  using (auth.uid() = reporter_id or public.is_app_admin());
drop policy if exists "Users create reports" on public.safety_reports;
drop policy if exists "Admins update reports" on public.safety_reports;

create table if not exists public.user_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('warning', 'chat_mute', 'suspend', 'ban')),
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists user_sanctions_active_idx on public.user_sanctions(user_id, active, expires_at);
alter table public.user_sanctions enable row level security;
drop policy if exists "Users and admins read sanctions" on public.user_sanctions;
create policy "Users and admins read sanctions" on public.user_sanctions for select
  using (auth.uid() = user_id or public.is_app_admin());
drop policy if exists "Admins manage sanctions" on public.user_sanctions;

create table if not exists public.moderation_terms (
  id bigint generated by default as identity primary key,
  term text not null unique check (char_length(trim(term)) between 2 and 48),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.moderation_terms enable row level security;
drop policy if exists "Admins manage moderation terms" on public.moderation_terms;
create policy "Admins manage moderation terms" on public.moderation_terms for all
  using (public.is_app_admin()) with check (public.is_app_admin());

insert into public.moderation_terms (term) values
  ('aptal'), ('salak'), ('gerizekali'), ('gerizekalı'),
  ('siktir'), ('orospu'), ('pic'), ('piç'), ('amk'), ('yarrak'), ('ibne')
on conflict (term) do nothing;

create or replace function public.normalize_moderation_text(p_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    lower(translate(coalesce(p_text, ''), 'çğıöşüÇĞİÖŞÜ', 'cgiosuCGIOSU')),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

create or replace function public.contains_blocked_term(p_text text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.moderation_terms
    where enabled
      and position(
        ' ' || public.normalize_moderation_text(term) || ' '
        in ' ' || public.normalize_moderation_text(p_text) || ' '
      ) > 0
  );
$$;

create or replace function public.create_safety_report(
  p_category text,
  p_details text default '',
  p_target_user_id uuid default null,
  p_room_id uuid default null,
  p_message_id uuid default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  report_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_category not in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'impersonation', 'other') then
    raise exception 'Invalid report category';
  end if;
  if p_target_user_id is null and p_room_id is null and p_message_id is null then
    raise exception 'A report target is required';
  end if;
  if p_target_user_id = auth.uid() then raise exception 'You cannot report yourself'; end if;
  if char_length(trim(coalesce(p_details, ''))) > 500 then raise exception 'Report details are too long'; end if;
  if (
    select count(*) from public.safety_reports
    where reporter_id = auth.uid() and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Report limit exceeded';
  end if;
  if exists (
    select 1 from public.safety_reports
    where reporter_id = auth.uid()
      and category = p_category
      and target_user_id is not distinct from p_target_user_id
      and room_id is not distinct from p_room_id
      and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'This report was already submitted';
  end if;

  insert into public.safety_reports (reporter_id, target_user_id, room_id, message_id, category, details)
  values (auth.uid(), p_target_user_id, p_room_id, p_message_id, p_category, trim(coalesce(p_details, '')))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.admin_security_overview()
returns table(open_reports bigint, reviewing_reports bigint, active_sanctions bigint, blocked_terms bigint)
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  return query select
    (select count(*) from public.safety_reports where status = 'open'),
    (select count(*) from public.safety_reports where status = 'reviewing'),
    (select count(*) from public.user_sanctions where active and (expires_at is null or expires_at > now())),
    (select count(*) from public.moderation_terms where enabled);
end;
$$;

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status text,
  p_resolution text default '',
  p_sanction_action text default null,
  p_sanction_hours integer default null
)
returns public.safety_reports
language plpgsql
security definer set search_path = public
as $$
declare
  current_report public.safety_reports;
  actor_role text;
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select role into actor_role from public.app_admins where user_id = auth.uid();
  if p_status not in ('reviewing', 'actioned', 'dismissed') then raise exception 'Invalid report status'; end if;
  if char_length(trim(coalesce(p_resolution, ''))) > 500 then raise exception 'Resolution is too long'; end if;

  select * into current_report from public.safety_reports where id = p_report_id for update;
  if current_report.id is null then raise exception 'Report not found'; end if;

  if p_sanction_action is not null then
    if current_report.target_user_id is null then raise exception 'Report has no target user'; end if;
    if p_sanction_action not in ('warning', 'chat_mute', 'suspend', 'ban') then raise exception 'Invalid sanction action'; end if;
    if p_status <> 'actioned' then raise exception 'Sanctions require an actioned report'; end if;
    if p_sanction_action in ('chat_mute', 'suspend') and (p_sanction_hours is null or p_sanction_hours < 1 or p_sanction_hours > 8760) then
      raise exception 'A valid sanction duration is required';
    end if;
    if p_sanction_action = 'ban' and actor_role <> 'owner' then
      raise exception 'Owner permission required';
    end if;
    if actor_role = 'moderator' and (p_sanction_action not in ('warning', 'chat_mute') or p_sanction_hours > 24) then
      raise exception 'Moderator sanction limit exceeded';
    end if;
    insert into public.user_sanctions (user_id, action, reason, expires_at, created_by)
    values (
      current_report.target_user_id,
      p_sanction_action,
      coalesce(nullif(trim(p_resolution), ''), 'Safety report action'),
      case when p_sanction_hours is null then null else now() + make_interval(hours => greatest(1, p_sanction_hours)) end,
      auth.uid()
    );
    if p_sanction_action in ('suspend', 'ban') then
      update public.rooms
      set state = 'ended', updated_at = now()
      where host_id = current_report.target_user_id and state = 'live';
    end if;
  end if;

  update public.safety_reports
  set status = p_status,
      resolution = trim(coalesce(p_resolution, '')),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_report_id
  returning * into current_report;
  return current_report;
end;
$$;

create or replace function public.join_room(p_room_id uuid)
returns table (role text, is_muted boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  current_room public.rooms;
  member public.room_members;
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
  select * into member from public.room_members where room_id = p_room_id and user_id = auth.uid();
  if found and member.removed_at is not null then raise exception 'You were removed from this room'; end if;
  if not found then
    if current_room.room_locked then raise exception 'Room is locked'; end if;
    insert into public.room_members (room_id, user_id) values (p_room_id, auth.uid());
  else
    update public.room_members set updated_at = now() where room_id = p_room_id and user_id = auth.uid();
  end if;
  return query select m.role, m.is_muted from public.room_members m where m.room_id = p_room_id and m.user_id = auth.uid();
end;
$$;

create or replace function public.can_access_room_messages(p_room_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1
    from public.rooms room
    left join public.room_members member
      on member.room_id = room.id and member.user_id = p_user_id and member.removed_at is null
    where room.id = p_room_id
      and (room.host_id = p_user_id or member.user_id is not null)
      and not public.users_blocked(p_user_id, room.host_id)
  );
$$;

create or replace function public.can_send_room_message(p_room_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.rooms room
    join public.room_members member
      on member.room_id = room.id and member.user_id = p_user_id and member.removed_at is null
    where room.id = p_room_id
      and room.state = 'live'
      and not public.users_blocked(p_user_id, room.host_id)
      and (not room.chat_locked or member.role in ('host', 'moderator'))
  );
$$;

create or replace function public.prepare_room_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.body := trim(new.body);
  select display_name into new.sender_name from public.profiles where id = new.sender_id;
  if new.sender_name is null then raise exception 'Sender profile not found'; end if;
  if not public.can_send_room_message(new.room_id, new.sender_id) then raise exception 'Room chat is unavailable'; end if;
  if exists (
    select 1 from public.user_sanctions
    where user_id = new.sender_id
      and active
      and action in ('chat_mute', 'suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Messaging is restricted';
  end if;
  if public.contains_blocked_term(new.body) then raise exception 'Message contains blocked language'; end if;
  if exists (
    select 1 from public.room_messages
    where sender_id = new.sender_id
      and room_id = new.room_id
      and public.normalize_moderation_text(body) = public.normalize_moderation_text(new.body)
      and created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Duplicate message';
  end if;
  if (
    select count(*) from public.room_messages
    where sender_id = new.sender_id and created_at > now() - interval '10 seconds'
  ) >= 5 then
    raise exception 'Too many messages';
  end if;
  if (
    select count(*) from public.room_messages
    where sender_id = new.sender_id and created_at > now() - interval '5 minutes'
  ) >= 20 then
    raise exception 'Message limit exceeded';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_blocked_follow()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.users_blocked(new.follower_id, new.following_id) then
    raise exception 'Follow is unavailable';
  end if;
  return new;
end;
$$;

drop trigger if exists before_follow_insert on public.follows;
create trigger before_follow_insert before insert on public.follows
  for each row execute procedure public.prevent_blocked_follow();

drop policy if exists "Room messages are readable" on public.room_messages;
create policy "Room messages are readable" on public.room_messages for select
  using (
    public.can_access_room_messages(room_id)
    and not public.users_blocked(auth.uid(), sender_id)
  );

drop policy if exists "Rooms are readable" on public.rooms;
create policy "Rooms are readable" on public.rooms for select
  using (not public.users_blocked(auth.uid(), host_id));
drop policy if exists "Users create their rooms" on public.rooms;
create policy "Users create their rooms" on public.rooms for insert
  with check (
    auth.uid() = host_id
    and not exists (
      select 1 from public.user_sanctions
      where user_id = auth.uid() and active and action in ('suspend', 'ban')
        and (expires_at is null or expires_at > now())
    )
  );

revoke execute on function public.is_app_admin(uuid) from public;
revoke execute on function public.users_blocked(uuid, uuid) from public;
revoke execute on function public.set_user_block(uuid, boolean) from public;
revoke execute on function public.create_safety_report(text, text, uuid, uuid, uuid) from public;
revoke execute on function public.admin_security_overview() from public;
revoke execute on function public.admin_resolve_report(uuid, text, text, text, integer) from public;
grant execute on function public.is_app_admin(uuid) to authenticated;
grant execute on function public.users_blocked(uuid, uuid) to authenticated;
grant execute on function public.set_user_block(uuid, boolean) to authenticated;
grant execute on function public.create_safety_report(text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.admin_security_overview() to authenticated;
grant execute on function public.admin_resolve_report(uuid, text, text, text, integer) to authenticated;
grant execute on function public.join_room(uuid) to authenticated;
grant execute on function public.can_access_room_messages(uuid, uuid) to authenticated;
grant execute on function public.can_send_room_message(uuid, uuid) to authenticated;
