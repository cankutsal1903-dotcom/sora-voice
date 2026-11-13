create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 36),
  bio text not null default '' check (char_length(bio) <= 180),
  avatar_color text not null default '#E6A577',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Public profiles are readable" on public.profiles;
create policy "Public profiles are readable"
  on public.profiles for select
  using (true);

drop policy if exists "Users update only their own profile" on public.profiles;
create policy "Users update only their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, handle, display_name)
  values (
    new.id,
    lower(coalesce(nullif(new.raw_user_meta_data ->> 'handle', ''), 'user_' || substr(replace(new.id::text, '-', ''), 1, 12))),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Sora kullanıcısı')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_profile_updated on public.profiles;
create trigger on_profile_updated
  before update on public.profiles
  for each row execute procedure public.set_profile_updated_at();

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 36),
  description text not null default '' check (char_length(description) <= 180),
  category text not null default 'Sohbet' check (category in ('Sohbet', 'Muzik', 'Oyun', 'Gece')),
  theme_colors jsonb not null default '["#5140BD", "#252458"]'::jsonb,
  accent_color text not null default '#D698FF',
  listener_count integer not null default 0 check (listener_count >= 0),
  state text not null default 'live' check (state in ('live', 'scheduled', 'ended', 'inactive')),
  starts_at timestamptz,
  schedule_label text not null default '' check (char_length(schedule_label) <= 48),
  room_locked boolean not null default false,
  chat_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

alter table public.rooms add column if not exists schedule_label text not null default '' check (char_length(schedule_label) <= 48);

create index if not exists rooms_state_created_at_idx on public.rooms(state, created_at desc);
create index if not exists rooms_state_starts_at_idx on public.rooms(state, starts_at asc);
create index if not exists rooms_host_id_idx on public.rooms(host_id);
create unique index if not exists rooms_one_live_room_per_host_idx on public.rooms(host_id) where state = 'live';
create index if not exists rooms_live_activity_idx on public.rooms(last_active_at desc) where state = 'live';

alter table public.rooms enable row level security;
drop policy if exists "Rooms are readable" on public.rooms;
create policy "Rooms are readable" on public.rooms for select using (true);
drop policy if exists "Users create their rooms" on public.rooms;
create policy "Users create their rooms" on public.rooms for insert with check (auth.uid() = host_id);
drop policy if exists "Hosts update their rooms" on public.rooms;
create policy "Hosts update their rooms" on public.rooms for update using (auth.uid() = host_id) with check (auth.uid() = host_id);
drop policy if exists "Hosts delete their rooms" on public.rooms;
create policy "Hosts delete their rooms" on public.rooms for delete using (auth.uid() = host_id);

drop trigger if exists on_room_updated on public.rooms;
create trigger on_room_updated before update on public.rooms
  for each row execute procedure public.set_profile_updated_at();

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'listener' check (role in ('host', 'moderator', 'speaker', 'listener')),
  is_muted boolean not null default false,
  removed_at timestamptz,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_room_role_idx on public.room_members(room_id, role);
alter table public.room_members enable row level security;
drop policy if exists "Authenticated users read room members" on public.room_members;
create policy "Authenticated users read room members" on public.room_members for select using (auth.uid() is not null);

create or replace function public.create_room_host_member()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.room_members (room_id, user_id, role)
  values (new.id, new.host_id, 'host')
  on conflict (room_id, user_id) do update set role = 'host', removed_at = null, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_room_created_host_member on public.rooms;
create trigger on_room_created_host_member after insert on public.rooms
  for each row execute procedure public.create_room_host_member();

insert into public.room_members (room_id, user_id, role)
select id, host_id, 'host' from public.rooms
on conflict (room_id, user_id) do update
set role = 'host', removed_at = null, updated_at = now();

create or replace function public.is_room_staff(p_room_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = p_user_id and role in ('host', 'moderator') and removed_at is null
  );
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

create or replace function public.manage_room_member(p_room_id uuid, p_target_user_id uuid, p_action text)
returns table (role text, is_muted boolean, removed boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into actor_role from public.room_members where room_id = p_room_id and user_id = auth.uid() and removed_at is null;
  select role into target_role from public.room_members where room_id = p_room_id and user_id = p_target_user_id;
  if actor_role not in ('host', 'moderator') then raise exception 'Moderator permission required'; end if;
  if target_role is null then raise exception 'Member not found'; end if;
  if p_target_user_id = auth.uid() or target_role = 'host' then raise exception 'This member cannot be changed'; end if;
  if actor_role = 'moderator' and target_role = 'moderator' then raise exception 'Moderators cannot change each other'; end if;
  if p_action in ('make_moderator', 'remove_moderator') and actor_role <> 'host' then raise exception 'Only the host can manage moderators'; end if;

  if p_action = 'make_moderator' then
    update public.room_members set role = 'moderator', is_muted = false, removed_at = null, updated_at = now() where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'remove_moderator' then
    update public.room_members set role = 'speaker', updated_at = now() where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'promote_speaker' then
    update public.room_members set role = 'speaker', is_muted = false, removed_at = null, updated_at = now() where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'demote_listener' then
    update public.room_members set role = 'listener', is_muted = true, updated_at = now() where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'mute' then
    update public.room_members set is_muted = true, updated_at = now() where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'unmute' then
    update public.room_members set is_muted = false, updated_at = now() where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'remove' then
    update public.room_members set role = 'listener', is_muted = true, removed_at = now(), updated_at = now() where room_id = p_room_id and user_id = p_target_user_id;
  else
    raise exception 'Unsupported moderation action';
  end if;

  return query select m.role, m.is_muted, m.removed_at is not null from public.room_members m where m.room_id = p_room_id and m.user_id = p_target_user_id;
end;
$$;

revoke execute on function public.is_room_staff(uuid, uuid) from public;
revoke execute on function public.join_room(uuid) from public;
revoke execute on function public.manage_room_member(uuid, uuid, text) from public;
grant execute on function public.join_room(uuid) to authenticated;
grant execute on function public.manage_room_member(uuid, uuid, text) to authenticated;

drop policy if exists "Hosts update their rooms" on public.rooms;
drop policy if exists "Staff update their rooms" on public.rooms;
create policy "Hosts update their rooms" on public.rooms for update
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

create or replace function public.update_room_settings(
  p_room_id uuid,
  p_room_locked boolean default null,
  p_chat_locked boolean default null
)
returns public.rooms
language plpgsql
security definer set search_path = public
as $$
declare
  updated_room public.rooms;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_staff(p_room_id) then raise exception 'Moderator permission required'; end if;

  update public.rooms
  set room_locked = coalesce(p_room_locked, room_locked),
      chat_locked = coalesce(p_chat_locked, chat_locked),
      updated_at = now()
  where id = p_room_id
  returning * into updated_room;

  if not found then raise exception 'Room not found'; end if;
  return updated_room;
end;
$$;

revoke execute on function public.update_room_settings(uuid, boolean, boolean) from public;
grant execute on function public.update_room_settings(uuid, boolean, boolean) to authenticated;

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null default '' check (char_length(sender_name) <= 36),
  body text not null check (char_length(trim(body)) between 1 and 160),
  kind text not null default 'message' check (kind in ('message', 'system', 'gift')),
  created_at timestamptz not null default now()
);

alter table public.room_messages add column if not exists sender_name text not null default '' check (char_length(sender_name) <= 36);

update public.room_messages message
set sender_name = profile.display_name
from public.profiles profile
where message.sender_id = profile.id and message.sender_name = '';

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
    where room.id = p_room_id and (room.host_id = p_user_id or member.user_id is not null)
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
      and (not room.chat_locked or member.role in ('host', 'moderator'))
  );
$$;

create or replace function public.prepare_room_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  select display_name into new.sender_name from public.profiles where id = new.sender_id;
  if new.sender_name is null then raise exception 'Sender profile not found'; end if;
  if not public.can_send_room_message(new.room_id, new.sender_id) then raise exception 'Room chat is unavailable'; end if;
  if (
    select count(*) from public.room_messages
    where sender_id = new.sender_id and created_at > now() - interval '5 seconds'
  ) >= 5 then
    raise exception 'Too many messages';
  end if;
  return new;
end;
$$;

drop trigger if exists before_room_message_insert on public.room_messages;
create trigger before_room_message_insert before insert on public.room_messages
  for each row execute procedure public.prepare_room_message();

create index if not exists room_messages_room_created_at_idx on public.room_messages(room_id, created_at asc);
create index if not exists room_messages_sender_created_at_idx on public.room_messages(sender_id, created_at desc);
alter table public.room_messages enable row level security;
drop policy if exists "Room messages are readable" on public.room_messages;
create policy "Room messages are readable" on public.room_messages for select
  using (public.can_access_room_messages(room_id));
drop policy if exists "Users send room messages" on public.room_messages;
create policy "Users send room messages" on public.room_messages for insert
  with check (auth.uid() = sender_id and public.can_send_room_message(room_id));
drop policy if exists "Users delete their messages" on public.room_messages;
create policy "Users delete their messages" on public.room_messages for delete using (auth.uid() = sender_id);

revoke execute on function public.can_access_room_messages(uuid, uuid) from public;
revoke execute on function public.can_send_room_message(uuid, uuid) from public;
grant execute on function public.can_access_room_messages(uuid, uuid) to authenticated;
grant execute on function public.can_send_room_message(uuid, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_messages'
    ) then
    alter publication supabase_realtime add table public.room_messages;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
    ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end;
$$;

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_id_idx on public.follows(following_id);
alter table public.follows enable row level security;
drop policy if exists "Users read their follows" on public.follows;
create policy "Users read their follows" on public.follows for select using (auth.uid() = follower_id or auth.uid() = following_id);
drop policy if exists "Users manage their follows" on public.follows;
create policy "Users manage their follows" on public.follows for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 1250 check (balance >= 0),
  last_daily_reward_at date,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  type text not null check (type in ('daily_reward', 'gift')),
  description text not null check (char_length(description) between 1 and 120),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_created_at_idx on public.wallet_transactions(user_id, created_at desc);
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
drop policy if exists "Users read their wallet" on public.wallets;
create policy "Users read their wallet" on public.wallets for select using (auth.uid() = user_id);
drop policy if exists "Users read their wallet transactions" on public.wallet_transactions;
create policy "Users read their wallet transactions" on public.wallet_transactions for select using (auth.uid() = user_id);

create or replace function public.create_wallet_for_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.wallets (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_wallet on public.profiles;
create trigger on_profile_created_wallet after insert on public.profiles
  for each row execute procedure public.create_wallet_for_profile();

create or replace function public.wallet_get_or_create()
returns table (balance integer, last_daily_reward_at date)
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.wallets (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  return query select w.balance, w.last_daily_reward_at from public.wallets w where w.user_id = auth.uid();
end;
$$;

create or replace function public.claim_daily_reward(p_amount integer default 75)
returns table (balance integer, claimed boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  next_balance integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_amount <> 75 then raise exception 'Invalid reward amount'; end if;
  insert into public.wallets (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update public.wallets
  set balance = balance + p_amount, last_daily_reward_at = current_date, updated_at = now()
  where user_id = auth.uid() and (last_daily_reward_at is null or last_daily_reward_at < current_date)
  returning wallets.balance into next_balance;
  if next_balance is null then
    select w.balance into next_balance from public.wallets w where w.user_id = auth.uid();
    return query select next_balance, false;
    return;
  end if;
  insert into public.wallet_transactions (user_id, amount, type, description)
  values (auth.uid(), p_amount, 'daily_reward', 'Gunluk giris odulu');
  return query select next_balance, true;
end;
$$;

create or replace function public.spend_wallet_credit(p_amount integer, p_description text, p_metadata jsonb default '{}'::jsonb)
returns table (balance integer)
language plpgsql
security definer set search_path = public
as $$
declare
  next_balance integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_amount <= 0 or p_amount > 10000 then raise exception 'Invalid amount'; end if;
  insert into public.wallets (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update public.wallets set balance = balance - p_amount, updated_at = now()
  where user_id = auth.uid() and balance >= p_amount returning wallets.balance into next_balance;
  if next_balance is null then raise exception 'Insufficient balance'; end if;
  insert into public.wallet_transactions (user_id, amount, type, description, metadata)
  values (auth.uid(), -p_amount, 'gift', left(p_description, 120), coalesce(p_metadata, '{}'::jsonb));
  return query select next_balance;
end;
$$;

revoke execute on function public.wallet_get_or_create() from public;
revoke execute on function public.claim_daily_reward(integer) from public;
revoke execute on function public.spend_wallet_credit(integer, text, jsonb) from public;
grant execute on function public.wallet_get_or_create() to authenticated;
grant execute on function public.claim_daily_reward(integer) to authenticated;
grant execute on function public.spend_wallet_credit(integer, text, jsonb) to authenticated;
