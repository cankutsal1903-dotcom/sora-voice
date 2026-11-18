-- Comprehensive production hardening across schema constraints, triggers, RPCs,
-- RLS policies, storage policies, and foreign-key / hot-query indexes.

-- 1. Unblock hard account deletion for admins/moderators & clean up test soft-delete
alter table public.user_sanctions
  alter column created_by drop not null;

alter table public.user_sanctions
  drop constraint if exists user_sanctions_created_by_fkey;

alter table public.user_sanctions
  add constraint user_sanctions_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

delete from auth.users
where id = '00000000-0000-4000-8000-00000000e2e1'
  and deleted_at is not null;

create or replace function public.prepare_account_deletion_server(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room_ids uuid[] := '{}'::uuid[];
  v_comm record;
  v_successor uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server access required';
  end if;
  if p_user_id is null then
    raise exception 'User ID required';
  end if;

  -- Collect hosted room IDs so the Edge Function can clean up room-backgrounds & room-music objects.
  select coalesce(array_agg(r.id), '{}'::uuid[])
    into v_room_ids
  from public.rooms r
  where r.host_id = p_user_id;

  -- Transfer ownership of multi-member families instead of cascading & wiping out other members' family.
  for v_comm in
    select c.id
    from public.communities c
    where c.owner_id = p_user_id
    for update
  loop
    select cm.user_id
      into v_successor
    from public.community_members cm
    where cm.community_id = v_comm.id
      and cm.user_id <> p_user_id
    order by (cm.role = 'moderator') desc, cm.joined_at asc
    limit 1;

    if v_successor is not null then
      update public.communities
      set owner_id = v_successor,
          updated_at = now()
      where id = v_comm.id;

      update public.community_members
      set role = 'owner'
      where community_id = v_comm.id
        and user_id = v_successor;
    end if;
  end loop;

  delete from public.voice_active_sessions where user_id = p_user_id;

  return jsonb_build_object('room_ids', to_jsonb(v_room_ids));
end;
$$;

revoke all on function public.prepare_account_deletion_server(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion_server(uuid) to service_role;

-- 2. Wallet transaction type check: add 'admin_adjustment' so admin_adjust_user_coins
--    does not collide with wallet_transactions_one_promo_grant_idx.
do $$
declare
  c record;
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
end $$;

alter table public.wallet_transactions
  add constraint wallet_transactions_type_check
  check (type in (
    'daily_reward',
    'gift',
    'gift_cashback',
    'bank_transfer',
    'promo_grant',
    'cosmetic_purchase',
    'family_create',
    'level_reward',
    'admin_adjustment'
  ));

-- 3. Privacy & helper function guards
revoke all on function public.resolve_admin_login_email(text) from public, anon, authenticated;
revoke all on function public.assert_user_not_banned(uuid) from public, anon, authenticated;

create or replace function public.is_app_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and (
      current_user not in ('authenticated', 'anon')
      or p_user_id = (select auth.uid())
      or exists (select 1 from public.app_admins where user_id = (select auth.uid()))
    )
    and exists (
      select 1 from public.app_admins where user_id = p_user_id
    );
$$;

create or replace function public.users_blocked(p_first_user_id uuid, p_second_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_first_user_id is not null
    and p_second_user_id is not null
    and (
      current_user not in ('authenticated', 'anon')
      or (select auth.uid()) in (p_first_user_id, p_second_user_id)
    )
    and exists (
      select 1
      from public.user_blocks
      where (blocker_id = p_first_user_id and blocked_id = p_second_user_id)
         or (blocker_id = p_second_user_id and blocked_id = p_first_user_id)
    );
$$;

-- 4. Auth signup trigger & profile column validation
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt integer;
  v_constraint text;
  v_raw_handle text;
  v_handle text;
  v_display_name text;
begin
  v_raw_handle := regexp_replace(lower(trim(coalesce(new.raw_user_meta_data ->> 'handle', ''))), '[^a-z0-9_]', '', 'g');
  if char_length(v_raw_handle) < 3 or char_length(v_raw_handle) > 24 then
    v_handle := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  else
    v_handle := v_raw_handle;
  end if;

  v_display_name := left(
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'Sora kullanıcısı'
    ),
    36
  );

  for v_attempt in 1..8 loop
    begin
      insert into public.profiles (id, handle, display_name, public_id)
      values (
        new.id,
        case when v_attempt = 1 then v_handle else 'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) end,
        v_display_name,
        public.generate_unique_8digit_code('profiles')
      )
      on conflict (id) do nothing;
      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_attempt = 8 then
          raise;
        end if;
    end;
  end loop;
  return new;
end;
$$;

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.user_xp := old.user_xp;
    new.user_level := old.user_level;
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
$$;

-- 5. Room privileged column guard (INSERT + UPDATE) & room_messages security/profanity fix
create or replace function public.guard_room_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('sora.room_privileged', true), '') = 'on'
     or current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.background_path := null;
    new.password_protected := false;
    new.password_changed_at := null;
    new.music_state := '{}'::jsonb;
    new.seat_count := coalesce(new.seat_count, 9);
    new.couple_seat := coalesce(new.couple_seat, false);
    new.voice_provider := null;
    new.voice_provider_pinned_at := null;
    new.listener_count := case when new.state = 'live' then 1 else 0 end;

    if public.contains_blocked_term(coalesce(new.title, '') || ' ' || coalesce(new.description, '') || ' ' || coalesce(new.schedule_label, '')) then
      raise exception 'Room text contains blocked language';
    end if;
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

  if new.listener_count is distinct from old.listener_count then
    if new.state = 'inactive' then
      new.listener_count := 0;
    elsif old.state <> 'live' and new.state = 'live' then
      new.listener_count := least(greatest(coalesce(new.listener_count, 1), 0), 1);
    else
      new.listener_count := old.listener_count;
    end if;
  end if;

  if (new.title is distinct from old.title or new.description is distinct from old.description or new.schedule_label is distinct from old.schedule_label)
     and public.contains_blocked_term(coalesce(new.title, '') || ' ' || coalesce(new.description, '') || ' ' || coalesce(new.schedule_label, '')) then
    raise exception 'Room text contains blocked language';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_room_privileged_columns on public.rooms;
create trigger guard_room_privileged_columns
  before insert or update on public.rooms
  for each row execute function public.guard_room_privileged_columns();

create or replace function public.prepare_room_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm text;
begin
  new.body := trim(coalesce(new.body, ''));
  select p.display_name, p.avatar_url, p.avatar_color
    into new.sender_name, new.sender_avatar_url, new.sender_avatar_color
  from public.profiles p
  where p.id = new.sender_id;

  if new.sender_name is null then
    raise exception 'Sender profile not found';
  end if;

  -- Direct client inserts can never spoof 'gift' or 'system' rows or inject metadata.
  if coalesce(current_setting('sora.internal_room_message', true), '') <> 'on' then
    new.kind := 'message';
    new.metadata := '{}'::jsonb;
  else
    new.kind := coalesce(new.kind, 'message');
  end if;

  if new.kind <> 'message' then
    if exists (
      select 1 from public.user_sanctions
      where user_id = new.sender_id
        and active
        and action in ('suspend', 'ban')
        and (expires_at is null or expires_at > now())
    ) then
      raise exception 'Messaging is restricted';
    end if;
    return new;
  end if;

  if not public.can_send_room_message(new.room_id, new.sender_id) then
    raise exception 'Room chat is unavailable';
  end if;

  if exists (
    select 1 from public.user_sanctions
    where user_id = new.sender_id
      and active
      and action in ('chat_mute', 'suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Messaging is restricted';
  end if;

  if public.contains_blocked_term(new.body) then
    raise exception 'Message contains blocked language';
  end if;

  v_norm := coalesce(nullif(public.normalize_moderation_text(new.body), ''), new.body);
  if exists (
    select 1 from public.room_messages rm
    where rm.sender_id = new.sender_id
      and rm.room_id = new.room_id
      and rm.kind = 'message'
      and coalesce(nullif(public.normalize_moderation_text(rm.body), ''), rm.body) = v_norm
      and rm.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Duplicate message';
  end if;

  if (
    select count(*) from public.room_messages rm
    where rm.sender_id = new.sender_id
      and rm.kind = 'message'
      and rm.created_at > now() - interval '10 seconds'
  ) >= 8 then
    raise exception 'Too many messages';
  end if;

  if (
    select count(*) from public.room_messages rm
    where rm.sender_id = new.sender_id
      and rm.kind = 'message'
      and rm.created_at > now() - interval '5 minutes'
  ) >= 35 then
    raise exception 'Message limit exceeded';
  end if;

  return new;
end;
$$;

drop policy if exists "Users send room messages" on public.room_messages;
create policy "Users send room messages"
  on public.room_messages for insert
  to authenticated
  with check (
    (select auth.uid()) = sender_id
    and kind = 'message'
    and public.can_send_room_message(room_id)
  );

drop policy if exists "Users delete their messages" on public.room_messages;
create policy "Users delete their messages"
  on public.room_messages for delete
  to authenticated
  using ((select auth.uid()) = sender_id and kind = 'message');

-- 6. Room join, seats, moderation, and voice provider failover fixes
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
        and vas.last_heartbeat_at >= now() - interval '2 minutes'
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
    insert into public.room_members (room_id, user_id, role, is_muted, password_verified_at)
    values (
      p_room_id,
      v_uid,
      case when is_room_host then 'host' else 'listener' end,
      false,
      case when needs_password or has_active_voice then now() else null end
    );
  else
    update public.room_members m
    set role = case when is_room_host then 'host' when ban_expired then 'listener' else m.role end,
        is_muted = case when is_room_host or ban_expired then false else m.is_muted end,
        removed_at = case when is_room_host or ban_expired then null else m.removed_at end,
        banned_until = case when is_room_host or ban_expired then null else m.banned_until end,
        updated_at = now(),
        password_verified_at = case when needs_password or has_active_voice then now() else m.password_verified_at end
    where m.room_id = p_room_id and m.user_id = v_uid;
  end if;

  return query select m.role, m.is_muted from public.room_members m where m.room_id = p_room_id and m.user_id = v_uid;
end;
$$;

create or replace function public.authorize_room_seat(p_room_id uuid, p_action text, p_target_user_id uuid default null)
returns table(actor_role text, target_user_id uuid, target_role text, target_muted boolean, host_id uuid, seat_count smallint, couple_seat boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_room public.rooms;
  actor public.room_members;
  target public.room_members;
  target_id uuid := coalesce(p_target_user_id, auth.uid());
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into current_room from public.rooms where id = p_room_id and state = 'live';
  if not found then raise exception 'Room is unavailable'; end if;
  select * into actor from public.room_members m where m.room_id = p_room_id and m.user_id = auth.uid() and m.removed_at is null;
  if not found then raise exception 'Room membership required'; end if;
  select * into target from public.room_members m where m.room_id = p_room_id and m.user_id = target_id and m.removed_at is null;
  if not found then raise exception 'Member not found'; end if;

  if p_action in ('assign', 'kick', 'reject') then
    if actor.role not in ('host', 'moderator') then raise exception 'Moderator permission required'; end if;
    if target_id = current_room.host_id then raise exception 'This member cannot be changed'; end if;
    if actor.role = 'moderator' and target.role = 'moderator' and target_id <> auth.uid() then
      raise exception 'Moderators cannot change each other';
    end if;
  elsif p_action = 'take' then
    if target_id <> auth.uid() then raise exception 'Invalid seat action'; end if;
    if actor.role not in ('host', 'moderator') then raise exception 'Seat approval required'; end if;
  elsif p_action = 'leave' then
    if target_id <> auth.uid() then raise exception 'Invalid seat action'; end if;
  else
    raise exception 'Unsupported seat action';
  end if;

  if p_action in ('assign', 'take') and target.mic_banned_until is not null and target.mic_banned_until > now() then
    raise exception 'Mic banned until %', to_char(target.mic_banned_until at time zone 'Europe/Istanbul', 'HH24:MI');
  end if;

  if p_action = 'kick' then
    update public.room_members m
    set mic_banned_until = now() + interval '10 minutes',
        hand_raised_at = null,
        seat_index = null,
        role = case when m.role = 'speaker' then 'listener' else m.role end,
        updated_at = now()
    where m.room_id = p_room_id and m.user_id = target_id
    returning * into target;
  elsif p_action in ('assign', 'take') then
    update public.room_members m
    set hand_raised_at = null,
        role = case when m.role = 'listener' then 'speaker' else m.role end,
        is_muted = false,
        updated_at = now()
    where m.room_id = p_room_id and m.user_id = target_id
    returning * into target;
  elsif p_action = 'leave' then
    update public.room_members m
    set hand_raised_at = null,
        seat_index = case when target_id = current_room.host_id then 0::smallint else null end,
        role = case when m.role = 'speaker' then 'listener' else m.role end,
        updated_at = now()
    where m.room_id = p_room_id and m.user_id = target_id
    returning * into target;
  elsif p_action = 'reject' then
    update public.room_members m
    set hand_raised_at = null, updated_at = now()
    where m.room_id = p_room_id and m.user_id = target_id
    returning * into target;
  end if;

  return query select actor.role, target_id, target.role, target.is_muted,
    current_room.host_id, current_room.seat_count, current_room.couple_seat;
end;
$$;

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

  -- Evict stale inactive holders of the same seat_index so seats never duplicate on reconnect.
  update public.room_members
  set seat_index = null,
      role = case when role = 'speaker' then 'listener' else role end,
      updated_at = now()
  where room_id = p_room_id
    and user_id <> p_target_user_id
    and seat_index = v_seat;

  update public.room_members
  set seat_index = v_seat,
      updated_at = now()
  where room_id = p_room_id and user_id = p_target_user_id;

  return v_seat;
end;
$$;

create or replace function public.manage_room_member(p_room_id uuid, p_target_user_id uuid, p_action text)
returns table(role text, is_muted boolean, removed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select m.role into actor_role from public.room_members m
  where m.room_id = p_room_id and m.user_id = auth.uid() and m.removed_at is null;
  if actor_role is null or actor_role not in ('host', 'moderator') then
    raise exception 'Moderator permission required';
  end if;
  select m.role into target_role from public.room_members m
  where m.room_id = p_room_id and m.user_id = p_target_user_id;
  if target_role is null then raise exception 'Member not found'; end if;
  if p_target_user_id = auth.uid() or target_role = 'host'
    or public.is_room_host(p_room_id, p_target_user_id) then
    raise exception 'This member cannot be changed';
  end if;
  if actor_role = 'moderator' and target_role = 'moderator' then
    raise exception 'Moderators cannot change each other';
  end if;
  if p_action in ('make_moderator', 'remove_moderator') and actor_role <> 'host' then
    raise exception 'Only the host can manage moderators';
  end if;

  if p_action = 'make_moderator' then
    update public.room_members set role = 'moderator', is_muted = false,
      removed_at = null, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'remove_moderator' then
    update public.room_members
    set role = case when seat_index is not null then 'speaker' else 'listener' end,
        updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'promote_speaker' then
    update public.room_members set role = 'speaker', is_muted = false,
      removed_at = null, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'demote_listener' then
    update public.room_members set role = 'listener', seat_index = null, is_muted = true, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'mute' then
    update public.room_members set is_muted = true, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'unmute' then
    update public.room_members set is_muted = false, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'remove' then
    update public.room_members set role = 'listener', seat_index = null, is_muted = true,
      removed_at = now(), password_verified_at = null, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
    delete from public.voice_active_sessions
    where room_id = p_room_id and user_id = p_target_user_id;
  else
    raise exception 'Unsupported moderation action';
  end if;

  return query select m.role, m.is_muted, m.removed_at is not null
  from public.room_members m
  where m.room_id = p_room_id and m.user_id = p_target_user_id;
end;
$$;

create or replace function public.ban_room_member(p_room_id uuid, p_target_user_id uuid, p_minutes integer default null)
returns table(role text, is_muted boolean, removed boolean, banned_until timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 525600) then raise exception 'Invalid ban duration'; end if;
  select m.role into actor_role from public.room_members m where m.room_id = p_room_id and m.user_id = auth.uid() and m.removed_at is null;
  select m.role into target_role from public.room_members m where m.room_id = p_room_id and m.user_id = p_target_user_id;
  if actor_role is null or actor_role not in ('host', 'moderator') then raise exception 'Moderator permission required'; end if;
  if actor_role = 'moderator' and p_minutes is null then raise exception 'Only the host can ban permanently'; end if;
  if target_role is null then raise exception 'Member not found'; end if;
  if p_target_user_id = auth.uid() or target_role = 'host' or public.is_room_host(p_room_id, p_target_user_id) then
    raise exception 'This member cannot be changed';
  end if;
  if actor_role = 'moderator' and target_role = 'moderator' then raise exception 'Moderators cannot change each other'; end if;

  update public.room_members m
  set role = 'listener', seat_index = null, is_muted = true, removed_at = now(), hand_raised_at = null,
      password_verified_at = null,
      banned_until = case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end,
      updated_at = now()
  where m.room_id = p_room_id and m.user_id = p_target_user_id;

  delete from public.voice_active_sessions
  where room_id = p_room_id and user_id = p_target_user_id;

  return query select m.role, m.is_muted, m.removed_at is not null, m.banned_until
  from public.room_members m where m.room_id = p_room_id and m.user_id = p_target_user_id;
end;
$$;

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

  perform public.sweep_stale_voice_sessions();
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

  -- Keep everyone in an active room on the same voice provider: non-host exclude lists
  -- cannot split an already-populated room or overwrite rooms.voice_provider.
  if v_room.voice_provider is not null
     and v_room.voice_provider = any(p_configured_providers) then
    select count(*) into v_active_in_room
    from public.voice_active_sessions s
    where s.room_id = p_room_id
      and s.user_id <> v_uid
      and s.provider_id = v_room.voice_provider
      and s.last_heartbeat_at >= now() - interval '2 minutes';

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

  -- Do NOT reset error_streak at token issuance (only reset on a healthy post-connect heartbeat).
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
      perform set_config('sora.room_privileged', 'off', true);
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

-- 7. Gifts, family level-up reward sync, family messages, DMs, daily/level rewards, self-gift blast
create or replace function public.award_family_gift_xp_internal(
  p_community_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_coins_spent bigint,
  p_dedupe_key text
)
returns table(awarded_xp bigint, new_xp bigint, new_level integer, new_gift_coins bigint)
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
  v_member_rec record;
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
  v_delta_xp := (v_next_coins / 100) - (v_old_coins / 100);
  v_next_xp := coalesce(v_family.xp, 0) + v_delta_xp;
  v_next_level := public.calculate_family_level(v_next_xp);

  insert into public.family_xp_events (
    community_id, actor_id, event_type, dedupe_key, coins_spent, xp_awarded, event_date
  )
  values (
    p_community_id, p_actor_id, p_event_type, p_dedupe_key, v_clean_coins, v_delta_xp, (timezone('utc', now()))::date
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

  if v_next_level > coalesce(v_family.level, 1) then
    for v_member_rec in
      select cm.user_id from public.community_members cm where cm.community_id = p_community_id
    loop
      perform public.sync_family_rewards_for_user(p_community_id, v_member_rec.user_id);
    end loop;
  else
    perform public.sync_family_rewards_for_user(p_community_id, p_actor_id);
  end if;

  awarded_xp := v_delta_xp;
  new_xp := v_next_xp;
  new_level := v_next_level;
  new_gift_coins := v_next_coins;
  return next;
end;
$$;

create or replace function public.send_room_gift(
  p_room_id uuid,
  p_gift_id text,
  p_recipient_id uuid,
  p_request_id uuid,
  p_quantity integer default 1
)
returns table(balance integer, message_id uuid, message_body text, gift_name text, gift_cost integer, promo_balance integer, paid_balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  g public.gift_catalog;
  v_qty integer := coalesce(p_quantity, 1);
  v_total_cost bigint;
  total integer;
  promo_spent integer;
  paid_spent integer;
  sender_name text;
  recipient_name text;
  new_message public.room_messages;
  prior public.wallet_transactions;
  v_sender_family_id uuid;
  v_sender_family_level integer;
  v_user_xp_gain bigint;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  if v_qty < 1 or v_qty > 999 then raise exception 'Invalid gift quantity'; end if;

  perform public.assert_user_not_banned(v_uid);

  insert into public.wallets(user_id) values (v_uid) on conflict(user_id) do nothing;
  select w.balance, w.promo_balance into total, promo_spent
  from public.wallets w
  where w.user_id = v_uid
  for update;

  select * into prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = v_uid;

  if found then
    return query
    select
      w.balance,
      (prior.metadata->>'message_id')::uuid,
      coalesce((select m.body from public.room_messages m where m.id = (prior.metadata->>'message_id')::uuid), ''),
      coalesce(prior.metadata->>'gift_name', 'Hediye'),
      abs(prior.amount),
      w.promo_balance,
      w.paid_balance
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  select * into g from public.gift_catalog where id = p_gift_id and active;
  if not found then raise exception 'Gift is unavailable'; end if;
  if p_recipient_id is null then raise exception 'Invalid recipient'; end if;

  v_total_cost := (g.cost::bigint) * (v_qty::bigint);
  if v_total_cost <= 0 or v_total_cost > 2000000000 then
    raise exception 'Invalid gift total';
  end if;

  select cm.community_id, c.level
    into v_sender_family_id, v_sender_family_level
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  where cm.user_id = v_uid;

  if coalesce(g.min_family_level, 0) > 0 and coalesce(v_sender_family_level, 0) < g.min_family_level then
    raise exception 'Family level required';
  end if;

  if p_recipient_id = v_uid then
    if not exists(
      select 1 from public.rooms r
      join public.room_members s on s.room_id = r.id
      where r.id = p_room_id and r.state = 'live'
        and s.user_id = v_uid and s.removed_at is null
    ) then
      raise exception 'Room membership required';
    end if;
  else
    if not exists(
      select 1 from public.rooms r
      join public.room_members s on s.room_id = r.id
      join public.room_members t on t.room_id = r.id
      where r.id = p_room_id and r.state = 'live'
        and s.user_id = v_uid and s.removed_at is null
        and t.user_id = p_recipient_id and t.removed_at is null
        and not public.users_blocked(v_uid, p_recipient_id)
    ) then
      raise exception 'Room membership required';
    end if;
  end if;

  if total < v_total_cost then raise exception 'Insufficient balance'; end if;
  promo_spent := least(promo_spent, v_total_cost::integer);
  paid_spent := (v_total_cost::integer) - promo_spent;

  update public.wallets w
  set balance = w.balance - (v_total_cost::integer),
      promo_balance = w.promo_balance - promo_spent,
      paid_balance = w.paid_balance - paid_spent,
      updated_at = now()
  where w.user_id = v_uid;

  select display_name into sender_name from public.profiles where id = v_uid;
  select display_name into recipient_name from public.profiles where id = p_recipient_id;

  perform set_config('sora.internal_room_message', 'on', true);
  insert into public.room_messages(room_id, sender_id, body, kind, metadata)
  values (
    p_room_id,
    v_uid,
    case
      when p_recipient_id = v_uid then
        coalesce(sender_name, 'Kullanıcı') || ' kendine ' ||
        case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
        g.name || ' hediyesi gönderdi!'
      else
        coalesce(sender_name, 'Kullanıcı') || ' -> ' || coalesce(recipient_name, 'Kullanıcı') || ': ' ||
        case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
        g.name || ' hediyesi gönderdi!'
    end,
    'gift',
    jsonb_build_object(
      'gift_id', g.id,
      'gift_name', g.name,
      'gift_icon', g.icon,
      'gift_color', g.color,
      'unit_cost', g.cost,
      'quantity', v_qty,
      'gift_cost', v_total_cost::integer,
      'recipient_id', p_recipient_id,
      'recipient_name', recipient_name
    )
  )
  returning * into new_message;
  perform set_config('sora.internal_room_message', 'off', true);

  insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -(v_total_cost::integer),
    'gift',
    case when v_qty > 1 then v_qty::text || 'x ' else '' end || g.name || ' hediyesi',
    jsonb_build_object(
      'gift_id', g.id,
      'room_id', p_room_id,
      'recipient_id', p_recipient_id,
      'quantity', v_qty,
      'unit_cost', g.cost,
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
      v_uid,
      'room_gift_sent',
      v_total_cost,
      'room_gift:' || p_request_id::text
    );
  end if;

  v_user_xp_gain := greatest(1::bigint, (v_total_cost / 1000::bigint));
  perform public.award_user_xp_internal(v_uid, v_user_xp_gain, 'room_gift:' || p_request_id::text);

  return query
  select w.balance, new_message.id, new_message.body, g.name, (v_total_cost::integer), w.promo_balance, w.paid_balance
  from public.wallets w
  where w.user_id = v_uid;
end;
$$;

create or replace function public.send_family_gift(
  p_community_id uuid,
  p_gift_id text,
  p_recipient_id uuid,
  p_quantity integer default 1,
  p_request_id uuid default null
)
returns table(
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
  v_gift public.gift_catalog;
  v_family public.communities;
  v_prior public.wallet_transactions;
  v_total_cost bigint;
  v_wallet_balance integer;
  v_wallet_promo integer;
  v_promo_spent integer;
  v_paid_spent integer;
  v_sender_name text;
  v_recipient_name text;
  v_recipient_avatar text;
  v_body text;
  v_meta jsonb;
  v_msg public.family_messages;
  v_xp bigint := 0;
  v_user_xp_gain bigint := 0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_community_id is null then raise exception 'Family not found'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  if v_qty < 1 or v_qty > 999 then raise exception 'Invalid gift quantity'; end if;

  perform public.assert_user_not_banned(v_uid);

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;
  select w.balance, w.promo_balance
    into v_wallet_balance, v_wallet_promo
  from public.wallets w
  where w.user_id = v_uid
  for update;

  select * into v_prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = v_uid;

  if found then
    select * into v_msg
    from public.family_messages
    where id = (v_prior.metadata->>'family_message_id')::uuid;

    select * into v_family
    from public.communities
    where id = p_community_id;

    return query
    select
      v_msg.id,
      coalesce(v_msg.body, ''),
      coalesce(v_msg.metadata, '{}'::jsonb),
      coalesce(v_msg.created_at, v_prior.created_at),
      w.balance,
      w.promo_balance,
      w.paid_balance,
      coalesce(v_prior.metadata->>'gift_name', 'Hediye'),
      abs(v_prior.amount)::bigint,
      coalesce((v_prior.metadata->>'awarded_xp')::bigint, 0::bigint),
      coalesce(v_family.xp, 0::bigint),
      coalesce(v_family.level, 1),
      coalesce(v_family.gift_coins_total, 0::bigint)
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  select * into v_family
  from public.communities
  where id = p_community_id;

  if not found then
    raise exception 'Family not found';
  end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = v_uid
  ) then
    raise exception 'Family membership required';
  end if;

  if p_recipient_id is null then
    p_recipient_id := v_uid;
  end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = p_recipient_id
  ) then
    raise exception 'Recipient must be in the same family';
  end if;

  if p_recipient_id <> v_uid and public.users_blocked(v_uid, p_recipient_id) then
    raise exception 'Recipient unavailable';
  end if;

  select * into v_gift
  from public.gift_catalog
  where id = p_gift_id and active;

  if not found then
    raise exception 'Gift is unavailable';
  end if;

  if coalesce(v_gift.min_family_level, 0) > coalesce(v_family.level, 1) then
    raise exception 'Family level required';
  end if;

  v_total_cost := (v_gift.cost::bigint) * (v_qty::bigint);
  if v_total_cost <= 0 or v_total_cost > 2000000000 then
    raise exception 'Invalid gift total';
  end if;

  if v_wallet_balance < v_total_cost then
    raise exception 'Insufficient balance';
  end if;

  v_promo_spent := least(v_wallet_promo, v_total_cost::integer);
  v_paid_spent := (v_total_cost::integer) - v_promo_spent;

  update public.wallets w
  set balance = w.balance - (v_total_cost::integer),
      promo_balance = w.promo_balance - v_promo_spent,
      paid_balance = w.paid_balance - v_paid_spent,
      updated_at = now()
  where w.user_id = v_uid;

  select coalesce(a.awarded_xp, 0::bigint)
    into v_xp
  from public.award_family_gift_xp_internal(
    p_community_id,
    v_uid,
    'family_gift_sent',
    v_total_cost,
    'family_gift:' || p_request_id::text
  ) a;

  select display_name into v_sender_name from public.profiles where id = v_uid;
  select display_name, avatar_url
    into v_recipient_name, v_recipient_avatar
  from public.profiles
  where id = p_recipient_id;

  if p_recipient_id = v_uid then
    v_body := coalesce(v_sender_name, 'Üye') || ' kendine ' ||
      case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
      v_gift.name || ' hediyesi gönderdi.';
  else
    v_body := coalesce(v_sender_name, 'Üye') || ' -> ' || coalesce(v_recipient_name, 'Üye') || ' kişisine ' ||
      case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
      v_gift.name || ' hediyesi gönderdi.';
  end if;

  v_meta := jsonb_build_object(
    'gift_id', v_gift.id,
    'gift_name', v_gift.name,
    'gift_icon', v_gift.icon,
    'gift_color', v_gift.color,
    'unit_cost', v_gift.cost,
    'quantity', v_qty,
    'total_cost', v_total_cost,
    'recipient_id', p_recipient_id,
    'recipient_name', coalesce(v_recipient_name, 'Üye'),
    'recipient_avatar_url', v_recipient_avatar,
    'self_gift', (p_recipient_id = v_uid),
    'awarded_xp', v_xp
  );

  insert into public.family_messages (community_id, sender_id, body, kind, metadata, client_message_id)
  values (p_community_id, v_uid, v_body, 'gift', v_meta, p_request_id)
  returning * into v_msg;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -(v_total_cost::integer),
    'gift',
    'Aile hediyesi: ' || case when v_qty > 1 then v_qty::text || 'x ' else '' end || v_gift.name,
    v_meta || jsonb_build_object(
      'community_id', p_community_id,
      'family_message_id', v_msg.id,
      'promo_spent', v_promo_spent,
      'paid_spent', v_paid_spent
    ),
    p_request_id
  );

  v_user_xp_gain := greatest(1::bigint, (v_total_cost / 1000::bigint));
  perform public.award_user_xp_internal(v_uid, v_user_xp_gain, 'family_gift:' || p_request_id::text);

  select * into v_family from public.communities where id = p_community_id;

  return query
  select
    v_msg.id,
    v_msg.body,
    v_msg.metadata,
    v_msg.created_at,
    w.balance,
    w.promo_balance,
    w.paid_balance,
    v_gift.name,
    v_total_cost,
    v_xp,
    v_family.xp,
    v_family.level,
    v_family.gift_coins_total
  from public.wallets w
  where w.user_id = v_uid;
end;
$$;

create or replace function public.send_family_message(
  p_community_id uuid,
  p_body text,
  p_client_message_id uuid default null
)
returns table(
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
  if v_uid is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = v_uid
  ) then
    raise exception 'Family membership required';
  end if;

  if exists (
    select 1 from public.user_sanctions
    where user_id = v_uid
      and active
      and action in ('chat_mute', 'suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Messaging is restricted';
  end if;

  if char_length(v_clean) < 1 or char_length(v_clean) > 1000 then
    raise exception 'Message must be between 1 and 1000 characters';
  end if;

  if public.contains_blocked_term(v_clean) then
    raise exception 'Message contains blocked language';
  end if;

  perform 1 from public.profiles p where p.id = v_uid for update;

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

create or replace function public.create_family(
  p_name text,
  p_description text default '',
  p_avatar_url text default null,
  p_request_id uuid default null
)
returns table(family_id uuid, family_code text, balance integer, promo_balance integer, paid_balance integer)
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
  v_promo_spent integer;
  v_paid_spent integer;
  v_created public.communities;
  v_constraint text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;

  perform public.assert_user_not_banned(v_uid);
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
  if public.contains_blocked_term(v_clean_name || ' ' || v_clean_desc) then
    raise exception 'Family text contains blocked language';
  end if;
  if v_clean_avatar is not null and (char_length(v_clean_avatar) > 600 or v_clean_avatar !~ '^https://') then
    raise exception 'Invalid avatar URL';
  end if;
  if exists (select 1 from public.communities c where lower(c.name) = lower(v_clean_name)) then
    raise exception 'Family name already taken';
  end if;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  select w.balance, w.promo_balance
    into v_total, v_promo
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
        v_uid, v_clean_name, v_clean_desc, v_clean_avatar, 'people', '["#2F80ED", "#1D4E89"]'::jsonb, 0, 0, 1,
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
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_family from public.communities where id = p_community_id for update;
  if not found then raise exception 'Family not found'; end if;
  if v_family.owner_id <> v_uid then raise exception 'Only family owner can update'; end if;

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
  if public.contains_blocked_term(v_next_name || ' ' || v_next_desc) then
    raise exception 'Family text contains blocked language';
  end if;
  if v_next_avatar is not null and (char_length(v_next_avatar) > 600 or v_next_avatar !~ '^https://') then
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

create or replace function public.join_family(p_community_id uuid)
returns table(community_id uuid, role text, xp bigint, level integer)
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
  if v_uid is null then raise exception 'Authentication required'; end if;

  perform public.assert_user_not_banned(v_uid);
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
  if not found then raise exception 'Family not found'; end if;

  if public.users_blocked(v_uid, v_family.owner_id) then
    raise exception 'Family is unavailable';
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

create or replace function public.start_direct_conversation(p_handle text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  target_user_id uuid;
  first_user_id uuid;
  second_user_id uuid;
  conversation_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  if exists (
    select 1 from public.user_sanctions
    where user_id = v_uid
      and active
      and action in ('chat_mute', 'suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Messaging is restricted';
  end if;

  select profile.id
  into target_user_id
  from public.profiles profile
  where lower(profile.handle) = lower(trim(leading '@' from trim(p_handle)))
  limit 1;

  if target_user_id is null then raise exception 'User not found'; end if;
  if target_user_id = v_uid then raise exception 'You cannot message yourself'; end if;
  if public.users_blocked(v_uid, target_user_id) then raise exception 'Conversation is unavailable'; end if;

  first_user_id := least(v_uid::text, target_user_id::text)::uuid;
  second_user_id := greatest(v_uid::text, target_user_id::text)::uuid;

  insert into public.direct_conversations (participant_one, participant_two)
  values (first_user_id, second_user_id)
  on conflict (participant_one, participant_two)
  do update set updated_at = public.direct_conversations.updated_at
  returning id into conversation_id;

  return conversation_id;
end;
$$;

create or replace function public.prepare_direct_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm text;
begin
  if auth.uid() is null or new.sender_id <> auth.uid() then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from public.user_sanctions
    where user_id = new.sender_id
      and active
      and action in ('chat_mute', 'suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Messaging is restricted';
  end if;

  new.body := trim(coalesce(new.body, ''));
  if public.contains_blocked_term(new.body) then
    raise exception 'Message contains blocked language';
  end if;

  v_norm := coalesce(nullif(public.normalize_moderation_text(new.body), ''), new.body);
  if exists (
    select 1
    from public.direct_messages message
    where message.sender_id = new.sender_id
      and message.conversation_id = new.conversation_id
      and coalesce(nullif(public.normalize_moderation_text(message.body), ''), message.body) = v_norm
      and message.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Duplicate message';
  end if;
  if (
    select count(*)
    from public.direct_messages message
    where message.sender_id = new.sender_id
      and message.created_at > now() - interval '10 seconds'
  ) >= 5 then
    raise exception 'Too many messages';
  end if;

  update public.direct_conversations
  set updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

create or replace function public.claim_daily_reward(p_amount integer default 2000000)
returns table(balance integer, claimed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_daily_reward constant integer := 2000000;
  v_uid uuid := auth.uid();
  v_cur_balance integer;
  v_credit integer;
  v_next_balance integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  perform p_amount;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  select w.balance into v_cur_balance
  from public.wallets w
  where w.user_id = v_uid
  for update;

  v_credit := greatest(0, least(c_daily_reward, 2140000000 - coalesce(v_cur_balance, 0)));

  update public.wallets w
  set promo_balance = w.promo_balance + v_credit,
      balance = w.balance + v_credit,
      last_daily_reward_at = current_date,
      updated_at = now()
  where w.user_id = v_uid
    and w.last_daily_reward_at is distinct from current_date
  returning w.balance into v_next_balance;

  if v_next_balance is null then
    select w.balance into v_next_balance from public.wallets w where w.user_id = v_uid;
    return query select v_next_balance, false;
    return;
  end if;

  if v_credit > 0 then
    insert into public.wallet_transactions (user_id, amount, type, description, metadata)
    values (
      v_uid,
      v_credit,
      'daily_reward',
      'Günlük giriş ödülü',
      jsonb_build_object('cashout', false, 'transferable', false, 'reward_amount', c_daily_reward)
    );
  end if;

  perform public.award_user_xp_internal(v_uid, 250, 'daily_reward:' || current_date::text);

  select w.balance into v_next_balance from public.wallets w where w.user_id = v_uid;
  return query select v_next_balance, true;
end;
$$;

create or replace function public.award_user_xp_internal(
  p_user_id uuid,
  p_xp_delta bigint,
  p_event_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_xp bigint;
  v_new_level integer;
  v_reward integer;
  v_safe_credit integer;
  v_total_credited bigint := 0;
  v_inserted_level integer;
  v_cur_balance integer;
begin
  if p_user_id is null then return 0; end if;

  if coalesce(p_xp_delta, 0) > 0 then
    if p_event_key is not null then
      insert into public.user_xp_events (user_id, event_key, xp_delta)
      values (p_user_id, p_event_key, p_xp_delta)
      on conflict (user_id, event_key) do nothing;

      if not found then return 0; end if;
    end if;

    update public.profiles p
    set user_xp = p.user_xp + p_xp_delta,
        updated_at = now()
    where p.id = p_user_id
    returning p.user_xp into v_xp;
  else
    select p.user_xp into v_xp
    from public.profiles p
    where p.id = p_user_id
    for update;
  end if;

  if v_xp is null then return 0; end if;

  v_new_level := public.calculate_user_level_from_xp(v_xp);

  update public.profiles p
  set user_level = greatest(p.user_level, v_new_level)
  where p.id = p_user_id
  returning p.user_level into v_new_level;

  insert into public.wallets (user_id) values (p_user_id) on conflict (user_id) do nothing;

  for v_lvl in 2..v_new_level by 2 loop
    v_reward := public.even_level_coin_reward(v_lvl);
    if v_reward > 0 then
      select w.balance into v_cur_balance
      from public.wallets w
      where w.user_id = p_user_id
      for update;

      v_safe_credit := greatest(0, least(v_reward, 2140000000 - coalesce(v_cur_balance, 0)));
      if v_safe_credit > 0 then
        v_inserted_level := null;
        insert into public.user_level_reward_claims (user_id, level, coins_awarded, badge_tier)
        values (p_user_id, v_lvl, v_safe_credit, public.user_badge_tier_for_level(v_lvl))
        on conflict (user_id, level) do nothing
        returning level into v_inserted_level;

        if v_inserted_level is not null then
          update public.wallets w
          set promo_balance = w.promo_balance + v_safe_credit,
              balance = w.balance + v_safe_credit,
              updated_at = now()
          where w.user_id = p_user_id;

          insert into public.wallet_transactions (user_id, amount, type, description, metadata)
          values (
            p_user_id,
            v_safe_credit,
            'level_reward',
            'Seviye ' || v_lvl || ' ödülü',
            jsonb_build_object(
              'level', v_lvl,
              'badge_tier', public.user_badge_tier_for_level(v_lvl),
              'cashout', false,
              'transferable', false
            )
          );

          v_total_credited := v_total_credited + v_safe_credit;
        end if;
      end if;
    end if;
  end loop;

  return v_total_credited;
end;
$$;

create or replace function public.claim_self_gift_blast(p_request_id uuid)
returns table(reward_amount bigint, multiplier_basis integer, balance bigint)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_tx public.wallet_transactions;
  v_cost bigint;
  v_raw bigint;
  v_roll integer;
  v_basis integer := 0;
  v_reward bigint := 0;
  v_credit integer := 0;
  v_cur_balance integer := 0;
  v_balance bigint;
  v_rnd bytea;
  v_inserted_request_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;

  select * into v_tx
    from public.wallet_transactions as wallet_tx
   where wallet_tx.idempotency_key = p_request_id
     and wallet_tx.user_id = v_uid
     and wallet_tx.type = 'gift';
  if not found then raise exception 'Gift transaction not found'; end if;

  v_cost := abs(v_tx.amount::bigint);
  if coalesce((v_tx.metadata->>'recipient_id')::uuid, null) is distinct from v_uid then
    return query select 0::bigint, 0, (select w.balance::bigint from public.wallets w where w.user_id = v_uid);
    return;
  end if;

  select b.reward_amount, b.multiplier_basis, w.balance::bigint
    into v_reward, v_basis, v_balance
    from public.self_gift_blasts b
    join public.wallets w on w.user_id = b.user_id
   where b.request_id = p_request_id
     and b.user_id = v_uid;
  if found then
    return query select v_reward, v_basis, v_balance;
    return;
  end if;

  v_reward := 0;
  v_basis := 0;

  -- Unbiased uniform roll in 0..9999 via rejection sampling on 16-bit CSPRNG (< 60000).
  loop
    v_rnd := extensions.gen_random_bytes(2);
    v_raw := (get_byte(v_rnd, 0) * 256) + get_byte(v_rnd, 1);
    exit when v_raw < 60000;
  end loop;
  v_roll := (v_raw % 10000)::integer;

  if v_roll >= 9999 then v_basis := 500;
  elsif v_roll >= 9900 then v_basis := 100;
  elsif v_roll >= 9500 then v_basis := 20;
  elsif v_roll >= 7000 then v_basis := 5;
  end if;
  v_reward := least((v_cost * v_basis) / 100, 250000000::bigint);

  select wallet.balance
    into v_cur_balance
    from public.wallets as wallet
   where wallet.user_id = v_uid
   for update;

  v_credit := greatest(0::bigint, least(v_reward, 2140000000::bigint - coalesce(v_cur_balance, 0)::bigint))::integer;

  insert into public.self_gift_blasts(request_id, user_id, gift_cost, reward_amount, multiplier_basis)
  values (p_request_id, v_uid, v_cost, v_credit::bigint, v_basis)
  on conflict (request_id) do nothing
  returning request_id into v_inserted_request_id;

  if v_inserted_request_id is null then
    select b.reward_amount, b.multiplier_basis, w.balance::bigint
      into v_reward, v_basis, v_balance
      from public.self_gift_blasts b
      join public.wallets w on w.user_id = b.user_id
     where b.request_id = p_request_id
       and b.user_id = v_uid;
    return query select v_reward, v_basis, v_balance;
    return;
  end if;

  if v_credit > 0 then
    update public.wallets as wallet
       set balance = wallet.balance + v_credit,
           promo_balance = wallet.promo_balance + v_credit,
           updated_at = now()
     where wallet.user_id = v_uid
     returning wallet.balance::bigint into v_balance;

    insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
    values (
      v_uid,
      v_credit,
      'gift_cashback',
      'Kendine hediye patlaması',
      jsonb_build_object('request_id', p_request_id, 'gift_cost', v_cost, 'multiplier_basis', v_basis),
      gen_random_uuid()
    );
  else
    v_balance := coalesce(v_cur_balance, 0)::bigint;
  end if;

  return query select v_credit::bigint, v_basis, v_balance;
end;
$$;

-- 8. Safety report dedupe & Admin Panel RPC fixes
create or replace function public.create_safety_report(
  p_category text,
  p_details text default '',
  p_target_user_id uuid default null,
  p_room_id uuid default null,
  p_message_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  report_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_category not in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'impersonation', 'other') then
    raise exception 'Invalid report category';
  end if;
  if p_target_user_id is null and p_room_id is null and p_message_id is null then
    raise exception 'A report target is required';
  end if;
  if p_target_user_id = v_uid then raise exception 'You cannot report yourself'; end if;
  if char_length(trim(coalesce(p_details, ''))) > 500 then raise exception 'Report details are too long'; end if;
  if (
    select count(*) from public.safety_reports
    where reporter_id = v_uid and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Report limit exceeded';
  end if;
  if exists (
    select 1 from public.safety_reports
    where reporter_id = v_uid
      and category = p_category
      and target_user_id is not distinct from p_target_user_id
      and room_id is not distinct from p_room_id
      and message_id is not distinct from p_message_id
      and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'This report was already submitted';
  end if;

  insert into public.safety_reports (reporter_id, target_user_id, room_id, message_id, category, details)
  values (v_uid, p_target_user_id, p_room_id, p_message_id, p_category, trim(coalesce(p_details, '')))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.admin_adjust_user_coins(
  p_identifier text,
  p_delta bigint,
  p_bucket text default 'promo',
  p_note text default '',
  p_idempotency_key uuid default null
)
returns table(target_user_id uuid, public_id text, display_name text, handle text, applied_delta integer, balance integer, promo_balance integer, paid_balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_target_id uuid;
  v_bucket text := lower(trim(coalesce(p_bucket, 'promo')));
  v_clean_note text := left(trim(coalesce(p_note, '')), 100);
  v_wallet public.wallets;
  v_new_promo bigint;
  v_new_paid bigint;
  v_new_total bigint;
  v_applied integer;
  v_desc text;
  v_existing_tx record;
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();
  if v_actor_role not in ('admin', 'owner') then
    raise exception 'Admin or owner permission required';
  end if;
  if p_delta is null or p_delta = 0 then raise exception 'Invalid credit amount'; end if;
  if abs(p_delta) > 2140000000 then
    raise exception 'Tek seferde en fazla 2.140.000.000 coin eklenebilir veya düşülebilir';
  end if;
  if v_bucket not in ('promo', 'paid') then raise exception 'Invalid wallet bucket'; end if;

  v_target_id := public.admin_resolve_user_id(p_identifier);
  if v_target_id is null then raise exception 'User not found'; end if;

  insert into public.wallets (user_id) values (v_target_id) on conflict (user_id) do nothing;

  select * into v_wallet
  from public.wallets w
  where w.user_id = v_target_id
  for update;

  if p_idempotency_key is not null then
    select wt.amount into v_existing_tx
    from public.wallet_transactions wt
    where wt.user_id = v_target_id
      and wt.idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return query
      select p.id, coalesce(p.public_id, ''), p.display_name, p.handle,
        v_existing_tx.amount, v_wallet.balance, v_wallet.promo_balance, v_wallet.paid_balance
      from public.profiles p
      where p.id = v_target_id;
      return;
    end if;
  end if;

  if p_delta > 0 then
    if (v_wallet.balance::bigint + p_delta) > 2140000000 then
      raise exception 'Cüzdan üst sınırı (2.140.000.000 coin) aşılıyor; mevcut bakiye: %', v_wallet.balance;
    end if;
    if v_bucket = 'paid' then
      v_new_paid := v_wallet.paid_balance::bigint + p_delta;
      v_new_promo := v_wallet.promo_balance::bigint;
    else
      v_new_promo := v_wallet.promo_balance::bigint + p_delta;
      v_new_paid := v_wallet.paid_balance::bigint;
    end if;
  else
    declare
      v_remove bigint := least(v_wallet.balance::bigint, abs(p_delta));
      v_from_first bigint;
      v_from_second bigint;
    begin
      if v_remove <= 0 then raise exception 'Kullanıcının bakiyesi zaten 0 coin'; end if;
      if v_bucket = 'paid' then
        v_from_first := least(v_wallet.paid_balance::bigint, v_remove);
        v_from_second := v_remove - v_from_first;
        v_new_paid := v_wallet.paid_balance::bigint - v_from_first;
        v_new_promo := greatest(0, v_wallet.promo_balance::bigint - v_from_second);
      else
        v_from_first := least(v_wallet.promo_balance::bigint, v_remove);
        v_from_second := v_remove - v_from_first;
        v_new_promo := v_wallet.promo_balance::bigint - v_from_first;
        v_new_paid := greatest(0, v_wallet.paid_balance::bigint - v_from_second);
      end if;
    end;
  end if;

  v_new_total := v_new_promo + v_new_paid;
  v_applied := (v_new_total - v_wallet.balance::bigint)::integer;
  if v_applied = 0 then raise exception 'Bakiye değişmedi'; end if;

  update public.wallets w
  set promo_balance = v_new_promo::integer,
      paid_balance = v_new_paid::integer,
      balance = v_new_total::integer,
      updated_at = now()
  where w.user_id = v_target_id
  returning * into v_wallet;

  v_desc := case
    when v_clean_note <> '' then left(
      (case when v_applied > 0 then 'Yönetici coin ekleme: ' else 'Yönetici coin düşümü: ' end) || v_clean_note,
      120
    )
    when v_applied > 0 then 'Yönetici tarafından coin tanımlandı'
    else 'Yönetici tarafından coin düşüldü'
  end;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_target_id,
    v_applied,
    'admin_adjustment',
    v_desc,
    jsonb_build_object('admin_id', auth.uid(), 'bucket', v_bucket, 'admin_adjustment', true),
    p_idempotency_key
  );

  return query
  select p.id, coalesce(p.public_id, ''), p.display_name, p.handle,
    v_applied, v_wallet.balance, v_wallet.promo_balance, v_wallet.paid_balance
  from public.profiles p
  where p.id = v_target_id;
end;
$$;

create or replace function public.admin_apply_user_sanction(
  p_identifier text,
  p_action text,
  p_duration_minutes integer default null,
  p_reason text default ''
)
returns table(sanction_id uuid, target_user_id uuid, public_id text, display_name text, handle text, action text, reason text, expires_at timestamptz, is_permanent boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_target_id uuid;
  v_target_role text;
  v_action text := lower(trim(coalesce(p_action, 'ban')));
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_expires timestamptz := null;
  v_inserted public.user_sanctions;
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();

  if v_action not in ('ban', 'suspend', 'chat_mute', 'warning') then
    raise exception 'Invalid sanction action';
  end if;
  if v_actor_role = 'moderator' and v_action in ('ban', 'suspend') then
    raise exception 'Admin or owner permission required';
  end if;

  v_target_id := public.admin_resolve_user_id(p_identifier);
  if v_target_id is null then raise exception 'User not found'; end if;
  if v_target_id = auth.uid() then raise exception 'Kendi hesabınıza ban uygulayamazsınız'; end if;

  select a.role into v_target_role from public.app_admins a where a.user_id = v_target_id;
  if v_target_role = 'owner' then raise exception 'Kurucu (owner) hesabına yaptırım uygulanamaz'; end if;

  if char_length(v_reason) < 3 then
    v_reason := case v_action
      when 'ban' then 'Yönetici kararıyla oyundan yasaklandı'
      when 'suspend' then 'Yönetici kararıyla geçici olarak uzaklaştırıldı'
      when 'chat_mute' then 'Yönetici kararıyla sohbeti kısıtlandı'
      else 'Yönetici uyarısı'
    end;
  end if;

  if p_duration_minutes is not null and p_duration_minutes > 0 then
    v_expires := now() + make_interval(mins => least(p_duration_minutes, 5256000));
  end if;

  if v_action in ('ban', 'suspend') then
    update public.user_sanctions s set active = false
    where s.user_id = v_target_id and s.active = true and s.action in ('ban', 'suspend');
  elsif v_action = 'chat_mute' then
    update public.user_sanctions s set active = false
    where s.user_id = v_target_id and s.active = true and s.action = 'chat_mute';
  end if;

  insert into public.user_sanctions (user_id, action, reason, expires_at, active, created_by)
  values (v_target_id, v_action, v_reason, v_expires, true, auth.uid())
  returning * into v_inserted;

  if v_action in ('ban', 'suspend') then
    perform set_config('sora.room_privileged', 'on', true);
    update public.rooms r
    set state = 'inactive',
        listener_count = 0,
        voice_provider = null,
        voice_provider_pinned_at = null,
        updated_at = now()
    where r.host_id = v_target_id
      and r.state in ('live', 'scheduled');
    perform set_config('sora.room_privileged', 'off', true);

    update public.room_members rm
    set seat_index = null,
        hand_raised_at = null,
        is_muted = true,
        removed_at = coalesce(rm.removed_at, now()),
        updated_at = now()
    where rm.user_id = v_target_id
      and rm.role <> 'host';

    delete from public.voice_active_sessions where user_id = v_target_id;
  end if;

  return query
  select v_inserted.id, p.id, coalesce(p.public_id, ''), p.display_name, p.handle,
    v_inserted.action, v_inserted.reason, v_inserted.expires_at, (v_inserted.expires_at is null)
  from public.profiles p
  where p.id = v_target_id;
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
security definer
set search_path = public, pg_temp
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
      coalesce(nullif(trim(p_resolution), ''), 'Güvenlik raporu yaptırımı'),
      case when p_sanction_hours is null then null else now() + make_interval(hours => greatest(1, p_sanction_hours)) end,
      auth.uid()
    );
    if p_sanction_action in ('suspend', 'ban') then
      perform set_config('sora.room_privileged', 'on', true);
      update public.rooms
      set state = 'inactive',
          listener_count = 0,
          voice_provider = null,
          voice_provider_pinned_at = null,
          updated_at = now()
      where host_id = current_report.target_user_id and state in ('live', 'scheduled');
      perform set_config('sora.room_privileged', 'off', true);

      update public.room_members rm
      set seat_index = null,
          hand_raised_at = null,
          is_muted = true,
          removed_at = coalesce(rm.removed_at, now()),
          updated_at = now()
      where rm.user_id = current_report.target_user_id
        and rm.role <> 'host';

      delete from public.voice_active_sessions where user_id = current_report.target_user_id;
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

create or replace function public.admin_revoke_user_sanctions(
  p_identifier text default null,
  p_sanction_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_target_id uuid;
  v_count integer := 0;
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();

  if p_sanction_id is not null then
    if v_actor_role = 'moderator' and exists (
      select 1 from public.user_sanctions s where s.id = p_sanction_id and s.action in ('ban', 'suspend')
    ) then
      raise exception 'Admin or owner permission required';
    end if;

    update public.user_sanctions s
    set active = false
    where s.id = p_sanction_id
      and s.active = true;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  v_target_id := public.admin_resolve_user_id(p_identifier);
  if v_target_id is null then raise exception 'User not found'; end if;

  if v_actor_role = 'moderator' and exists (
    select 1 from public.user_sanctions s
    where s.user_id = v_target_id and s.active = true and s.action in ('ban', 'suspend')
  ) then
    raise exception 'Admin or owner permission required';
  end if;

  update public.user_sanctions s
  set active = false
  where s.user_id = v_target_id
    and s.active = true;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

create or replace function public.admin_manage_room(p_room_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_act text := lower(trim(coalesce(p_action, '')));
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();

  if v_act = 'close' then
    perform set_config('sora.room_privileged', 'on', true);
    update public.rooms
    set state = 'inactive',
        listener_count = 0,
        voice_provider = null,
        voice_provider_pinned_at = null,
        updated_at = now()
    where id = p_room_id;
    perform set_config('sora.room_privileged', 'off', true);

    update public.room_members
    set seat_index = case when role = 'host' then 0::smallint else null end,
        hand_raised_at = null,
        password_verified_at = null,
        updated_at = now()
    where room_id = p_room_id;

    delete from public.voice_active_sessions where room_id = p_room_id;
    return 'closed';
  elsif v_act = 'toggle_chat' then
    update public.rooms set chat_locked = not chat_locked, updated_at = now() where id = p_room_id;
    return 'toggled_chat';
  elsif v_act = 'toggle_lock' then
    update public.rooms set room_locked = not room_locked, updated_at = now() where id = p_room_id;
    return 'toggled_lock';
  elsif v_act = 'delete' then
    if v_actor_role not in ('admin', 'owner') then
      raise exception 'Admin or owner permission required';
    end if;
    delete from public.rooms where id = p_room_id;
    return 'deleted';
  else
    raise exception 'Invalid room action';
  end if;
end;
$$;

create or replace function public.admin_manage_moderation_term(
  p_action text,
  p_term text default '',
  p_term_id bigint default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_act text := lower(trim(coalesce(p_action, '')));
  v_clean text := lower(trim(coalesce(p_term, '')));
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();

  if v_act = 'add' then
    if char_length(v_clean) < 2 or char_length(v_clean) > 64 then
      raise exception 'Kelime 2 ile 64 karakter arasında olmalı';
    end if;
    insert into public.moderation_terms (term, enabled)
    values (v_clean, true)
    on conflict (term) do update set enabled = true;
    return 'added';
  elsif v_act = 'toggle' then
    update public.moderation_terms set enabled = not enabled where id = p_term_id;
    return 'toggled';
  elsif v_act = 'delete' then
    if v_actor_role not in ('admin', 'owner') then
      raise exception 'Admin or owner permission required';
    end if;
    delete from public.moderation_terms where id = p_term_id;
    return 'deleted';
  else
    raise exception 'Invalid term action';
  end if;
end;
$$;

-- 9. Push notification follower lookup RPC (eliminates 414 URI Too Long & excludes blocked users)
create or replace function public.get_unblocked_follower_push_tokens_server(p_host_id uuid)
returns table(token text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct dpt.token
  from public.follows f
  join public.device_push_tokens dpt on dpt.user_id = f.follower_id
  where coalesce(auth.role(), '') = 'service_role'
    and f.following_id = p_host_id
    and not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = p_host_id and ub.blocked_id = f.follower_id)
         or (ub.blocker_id = f.follower_id and ub.blocked_id = p_host_id)
    );
$$;

revoke all on function public.get_unblocked_follower_push_tokens_server(uuid) from public, anon, authenticated;
grant execute on function public.get_unblocked_follower_push_tokens_server(uuid) to service_role;

-- 10. Consolidate duplicate permissive RLS policies, block bypass on follows, and auth_rls_initplan
drop trigger if exists before_follow_insert on public.follows;
create trigger before_follow_insert
  before insert or update on public.follows
  for each row execute function public.prevent_blocked_follow();

drop policy if exists "Users manage their follows" on public.follows;
drop policy if exists "Users read their follows" on public.follows;
drop policy if exists "Users insert their follows" on public.follows;
drop policy if exists "Users delete their follows" on public.follows;

create policy "Users read their follows"
  on public.follows for select
  to authenticated
  using (((select auth.uid()) = follower_id) or ((select auth.uid()) = following_id));

create policy "Users insert their follows"
  on public.follows for insert
  to authenticated
  with check ((select auth.uid()) = follower_id);

create policy "Users delete their follows"
  on public.follows for delete
  to authenticated
  using ((select auth.uid()) = follower_id);

drop policy if exists "Users and admins read sanctions" on public.user_sanctions;
drop policy if exists "user_sanctions_select_own" on public.user_sanctions;
create policy "user_sanctions_select_own"
  on public.user_sanctions for select
  to authenticated
  using ((user_id = (select auth.uid())) or public.is_app_admin((select auth.uid())));

drop policy if exists "Admins read bank transfer requests" on public.bank_transfer_requests;
drop policy if exists "Users read their bank transfer requests" on public.bank_transfer_requests;
create policy "Users and admins read bank transfer requests"
  on public.bank_transfer_requests for select
  to authenticated
  using (((select auth.uid()) = user_id) or public.is_app_admin((select auth.uid())));

drop policy if exists "Family members read family messages" on public.family_messages;
create policy "Family members read family messages"
  on public.family_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.community_members cm
      where cm.community_id = family_messages.community_id
        and cm.user_id = (select auth.uid())
    )
    and not public.users_blocked((select auth.uid()), sender_id)
  );

drop policy if exists "Users update only their own profile" on public.profiles;
create policy "Users update only their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users read their wallet" on public.wallets;
create policy "Users read their wallet"
  on public.wallets for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users read their wallet transactions" on public.wallet_transactions;
create policy "Users read their wallet transactions"
  on public.wallet_transactions for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users read their blocks" on public.user_blocks;
create policy "Users read their blocks"
  on public.user_blocks for select
  to authenticated
  using ((select auth.uid()) = blocker_id);

drop policy if exists "Users read own reports" on public.safety_reports;
create policy "Users read own reports"
  on public.safety_reports for select
  to authenticated
  using (((select auth.uid()) = reporter_id) or public.is_app_admin((select auth.uid())));

drop policy if exists "Kullanici kendi tokenlarini okur" on public.device_push_tokens;
create policy "Kullanici kendi tokenlarini okur"
  on public.device_push_tokens for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Kullanici kendi tokenini siler" on public.device_push_tokens;
create policy "Kullanici kendi tokenini siler"
  on public.device_push_tokens for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Authenticated users read room members" on public.room_members;
create policy "Authenticated users read room members"
  on public.room_members for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Room messages are readable" on public.room_messages;
create policy "Room messages are readable"
  on public.room_messages for select
  to authenticated
  using (public.can_access_room_messages(room_id) and not public.users_blocked((select auth.uid()), sender_id));

drop policy if exists "Rooms are readable" on public.rooms;
create policy "Rooms are readable"
  on public.rooms for select
  using (not public.users_blocked((select auth.uid()), host_id));

drop policy if exists "Hosts update their rooms" on public.rooms;
create policy "Hosts update their rooms"
  on public.rooms for update
  to authenticated
  using ((select auth.uid()) = host_id)
  with check ((select auth.uid()) = host_id);

drop policy if exists "Hosts delete their rooms" on public.rooms;
create policy "Hosts delete their rooms"
  on public.rooms for delete
  to authenticated
  using ((select auth.uid()) = host_id);

drop policy if exists "Users create their rooms" on public.rooms;
create policy "Users create their rooms"
  on public.rooms for insert
  to authenticated
  with check (
    (select auth.uid()) = host_id
    and not exists (
      select 1 from public.user_sanctions
      where user_sanctions.user_id = (select auth.uid())
        and user_sanctions.active
        and user_sanctions.action in ('suspend', 'ban')
        and (user_sanctions.expires_at is null or user_sanctions.expires_at > now())
    )
  );

drop policy if exists "user_xp_events_select_own" on public.user_xp_events;
create policy "user_xp_events_select_own"
  on public.user_xp_events for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "user_level_reward_claims_select_own" on public.user_level_reward_claims;
create policy "user_level_reward_claims_select_own"
  on public.user_level_reward_claims for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Admins read admin roles" on public.app_admins;
create policy "Admins read admin roles"
  on public.app_admins for select
  to authenticated
  using (((select auth.uid()) = user_id) or public.is_app_admin((select auth.uid())));

drop policy if exists "Authenticated users read app settings" on public.app_settings;
create policy "Authenticated users read app settings"
  on public.app_settings for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Owners and admins read background requests" on public.room_background_requests;
create policy "Owners and admins read background requests"
  on public.room_background_requests for select
  to authenticated
  using ((requested_by = (select auth.uid())) or public.is_app_admin((select auth.uid())));

-- Storage UPDATE/DELETE policies for room-backgrounds
drop policy if exists "Room owners update backgrounds" on storage.objects;
create policy "Room owners update backgrounds"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'room-backgrounds' and (public.is_room_host(public.storage_room_id(name)) or public.is_app_admin((select auth.uid()))));

drop policy if exists "Room owners delete backgrounds" on storage.objects;
create policy "Room owners delete backgrounds"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'room-backgrounds' and (public.is_room_host(public.storage_room_id(name)) or public.is_app_admin((select auth.uid()))));

-- 11. Foreign-key & hot-query indexes + drop redundant duplicate prefix indexes
create index if not exists family_messages_sender_created_idx
  on public.family_messages (sender_id, created_at desc);

create index if not exists family_reward_grants_user_id_idx
  on public.family_reward_grants (user_id);

create index if not exists room_background_requests_requested_by_idx
  on public.room_background_requests (requested_by);

create index if not exists room_background_requests_reviewed_by_idx
  on public.room_background_requests (reviewed_by);

create index if not exists family_xp_events_actor_id_idx
  on public.family_xp_events (actor_id);

create index if not exists family_xp_events_event_type_idx
  on public.family_xp_events (event_type);

create index if not exists self_gift_blasts_user_id_idx
  on public.self_gift_blasts (user_id);

create index if not exists room_password_failures_user_id_idx
  on public.room_password_failures (user_id);

create index if not exists user_profile_items_item_id_idx
  on public.user_profile_items (item_id);

create index if not exists app_settings_updated_by_idx
  on public.app_settings (updated_by);

create index if not exists family_level_configs_frame_item_id_idx
  on public.family_level_configs (frame_item_id);

create index if not exists family_level_configs_gift_unlock_id_idx
  on public.family_level_configs (gift_unlock_id);

create index if not exists family_reward_grants_level_idx
  on public.family_reward_grants (level);

create index if not exists family_reward_grants_frame_item_id_idx
  on public.family_reward_grants (frame_item_id);

create index if not exists voice_active_sessions_last_heartbeat_idx
  on public.voice_active_sessions (last_heartbeat_at);

create index if not exists voice_active_sessions_provider_heartbeat_idx
  on public.voice_active_sessions (provider_id, last_heartbeat_at);

drop index if exists public.room_messages_sender_id_idx;
drop index if exists public.user_sanctions_user_id_idx;
drop index if exists public.wallet_transactions_user_id_idx;
drop index if exists public.bank_transfer_requests_user_id_idx;
