begin;

alter table public.wallets alter column balance set default 0;

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_one uuid not null references public.profiles(id) on delete cascade,
  participant_two uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint direct_conversations_distinct_participants check (participant_one <> participant_two),
  constraint direct_conversations_canonical_order check (participant_one::text < participant_two::text),
  constraint direct_conversations_unique_pair unique (participant_one, participant_two)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "Participants read direct conversations" on public.direct_conversations;
create policy "Participants read direct conversations"
on public.direct_conversations for select to authenticated
using (
  (select auth.uid()) in (participant_one, participant_two)
  and not public.users_blocked(participant_one, participant_two)
);

drop policy if exists "Participants read direct messages" on public.direct_messages;
create policy "Participants read direct messages"
on public.direct_messages for select to authenticated
using (
  exists (
    select 1
    from public.direct_conversations conversation
    where conversation.id = conversation_id
      and (select auth.uid()) in (conversation.participant_one, conversation.participant_two)
      and not public.users_blocked(conversation.participant_one, conversation.participant_two)
  )
);

drop policy if exists "Participants send direct messages" on public.direct_messages;
create policy "Participants send direct messages"
on public.direct_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1
    from public.direct_conversations conversation
    where conversation.id = conversation_id
      and (select auth.uid()) in (conversation.participant_one, conversation.participant_two)
      and not public.users_blocked(conversation.participant_one, conversation.participant_two)
  )
);

create or replace function public.start_direct_conversation(p_handle text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
  first_user_id uuid;
  second_user_id uuid;
  conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select profile.id
  into target_user_id
  from public.profiles profile
  where lower(profile.handle) = lower(trim(leading '@' from trim(p_handle)))
  limit 1;

  if target_user_id is null then
    raise exception 'User not found';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'You cannot message yourself';
  end if;
  if public.users_blocked(auth.uid(), target_user_id) then
    raise exception 'Conversation is unavailable';
  end if;

  first_user_id := least(auth.uid()::text, target_user_id::text)::uuid;
  second_user_id := greatest(auth.uid()::text, target_user_id::text)::uuid;

  insert into public.direct_conversations (participant_one, participant_two)
  values (first_user_id, second_user_id)
  on conflict (participant_one, participant_two)
  do update set updated_at = public.direct_conversations.updated_at
  returning id into conversation_id;

  return conversation_id;
end;
$$;

create or replace function public.list_direct_conversations()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  other_display_name text,
  other_handle text,
  other_avatar_color text,
  last_message text,
  last_message_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    conversation.id,
    other_profile.id,
    other_profile.display_name,
    other_profile.handle,
    other_profile.avatar_color,
    latest.body,
    coalesce(latest.created_at, conversation.created_at)
  from public.direct_conversations conversation
  join public.profiles other_profile
    on other_profile.id = case
      when conversation.participant_one = auth.uid() then conversation.participant_two
      else conversation.participant_one
    end
  left join lateral (
    select message.body, message.created_at
    from public.direct_messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc
    limit 1
  ) latest on true
  where auth.uid() is not null
    and auth.uid() in (conversation.participant_one, conversation.participant_two)
    and not public.users_blocked(conversation.participant_one, conversation.participant_two)
  order by coalesce(latest.created_at, conversation.created_at) desc;
$$;

create or replace function public.prepare_direct_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or new.sender_id <> auth.uid() then
    raise exception 'Authentication required';
  end if;

  new.body := trim(new.body);
  if public.contains_blocked_term(new.body) then
    raise exception 'Message contains blocked language';
  end if;
  if exists (
    select 1
    from public.direct_messages message
    where message.sender_id = new.sender_id
      and message.conversation_id = new.conversation_id
      and public.normalize_moderation_text(message.body) = public.normalize_moderation_text(new.body)
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

drop trigger if exists prepare_direct_message_before_insert on public.direct_messages;
create trigger prepare_direct_message_before_insert
before insert on public.direct_messages
for each row execute function public.prepare_direct_message();

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 40),
  description text not null default '' check (char_length(description) <= 240),
  icon text not null default 'people',
  theme_colors jsonb not null default '["#5140BD", "#252458"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists communities_name_lower_key on public.communities (lower(name));

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

alter table public.communities enable row level security;
alter table public.community_members enable row level security;

drop policy if exists "Authenticated users read communities" on public.communities;
create policy "Authenticated users read communities"
on public.communities for select to authenticated
using (true);

drop policy if exists "Users create communities" on public.communities;
create policy "Users create communities"
on public.communities for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "Owners update communities" on public.communities;
create policy "Owners update communities"
on public.communities for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "Owners delete communities" on public.communities;
create policy "Owners delete communities"
on public.communities for delete to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "Authenticated users read community members" on public.community_members;
create policy "Authenticated users read community members"
on public.community_members for select to authenticated
using (true);

drop policy if exists "Users join communities" on public.community_members;
create policy "Users join communities"
on public.community_members for insert to authenticated
with check (user_id = (select auth.uid()) and role = 'member');

drop policy if exists "Users leave communities" on public.community_members;
create policy "Users leave communities"
on public.community_members for delete to authenticated
using (user_id = (select auth.uid()) and role <> 'owner');

create or replace function public.add_community_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.community_members (community_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (community_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists add_community_owner_after_insert on public.communities;
create trigger add_community_owner_after_insert
after insert on public.communities
for each row execute function public.add_community_owner();

alter table public.room_members
add column if not exists hand_raised_at timestamptz;

create or replace function public.set_room_hand_raise(p_room_id uuid, p_raised boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raised_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1
    from public.room_members member
    where member.room_id = p_room_id
      and member.user_id = auth.uid()
      and member.removed_at is null
  ) then
    raise exception 'Room membership required';
  end if;
  if p_raised and exists (
    select 1 from public.rooms room
    where room.id = p_room_id and room.room_locked
  ) and not public.is_room_staff(p_room_id) then
    raise exception 'Room is locked';
  end if;

  update public.room_members
  set hand_raised_at = case when p_raised then now() else null end,
      updated_at = now()
  where room_id = p_room_id and user_id = auth.uid()
  returning hand_raised_at into raised_at;

  return raised_at;
end;
$$;

create or replace function public.clear_hand_raise_after_role_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.removed_at is not null or new.role in ('host', 'moderator', 'speaker') then
    new.hand_raised_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_hand_raise_after_role_change on public.room_members;
create trigger clear_hand_raise_after_role_change
before update of role, removed_at on public.room_members
for each row execute function public.clear_hand_raise_after_role_change();

create table if not exists public.gift_catalog (
  id text primary key,
  name text not null check (char_length(name) between 1 and 40),
  icon text not null,
  color text not null,
  cost integer not null check (cost > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.gift_catalog enable row level security;
drop policy if exists "Authenticated users read gift catalog" on public.gift_catalog;
create policy "Authenticated users read gift catalog"
on public.gift_catalog for select to authenticated
using (active);

insert into public.gift_catalog (id, name, icon, color, cost)
values
  ('clap', 'Alkış', 'sparkles', '#8D79FF', 15),
  ('heart', 'Kalp', 'heart', '#FF719D', 40),
  ('crown', 'Taç', 'crown', '#E9B94D', 120),
  ('rocket', 'Roket', 'rocket', '#54BBD3', 300)
on conflict (id) do update
set name = excluded.name,
    icon = excluded.icon,
    color = excluded.color,
    cost = excluded.cost,
    active = true;

create or replace function public.send_room_gift(p_room_id uuid, p_gift_id text)
returns table (
  balance integer,
  message_id uuid,
  message_body text,
  gift_name text,
  gift_cost integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_gift public.gift_catalog;
  current_balance integer;
  sender_name text;
  created_message public.room_messages;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into selected_gift
  from public.gift_catalog
  where id = p_gift_id and active;
  if not found then
    raise exception 'Gift is unavailable';
  end if;

  if not exists (
    select 1
    from public.rooms room
    join public.room_members member on member.room_id = room.id
    where room.id = p_room_id
      and room.state = 'live'
      and member.user_id = auth.uid()
      and member.removed_at is null
      and not public.users_blocked(auth.uid(), room.host_id)
  ) then
    raise exception 'Room membership required';
  end if;

  insert into public.wallets (user_id) values (auth.uid())
  on conflict (user_id) do nothing;

  select wallet.balance into current_balance
  from public.wallets wallet
  where wallet.user_id = auth.uid()
  for update;

  if current_balance < selected_gift.cost then
    raise exception 'Insufficient balance';
  end if;

  update public.wallets
  set balance = public.wallets.balance - selected_gift.cost,
      updated_at = now()
  where user_id = auth.uid()
  returning public.wallets.balance into current_balance;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata)
  values (
    auth.uid(),
    -selected_gift.cost,
    'gift',
    selected_gift.name || ' hediyesi',
    jsonb_build_object('gift_id', selected_gift.id, 'room_id', p_room_id)
  );

  select profile.display_name into sender_name
  from public.profiles profile
  where profile.id = auth.uid();

  insert into public.room_messages (room_id, sender_id, body, kind)
  values (p_room_id, auth.uid(), sender_name || ', ' || selected_gift.name || ' hediyesi gönderdi!', 'gift')
  returning * into created_message;

  return query select current_balance, created_message.id, created_message.body, selected_gift.name, selected_gift.cost;
end;
$$;

create index if not exists direct_conversations_participant_one_idx on public.direct_conversations(participant_one);
create index if not exists direct_conversations_participant_two_idx on public.direct_conversations(participant_two);
create index if not exists direct_messages_conversation_created_idx on public.direct_messages(conversation_id, created_at desc);
create index if not exists direct_messages_sender_id_idx on public.direct_messages(sender_id);
create index if not exists communities_owner_id_idx on public.communities(owner_id);
create index if not exists community_members_user_id_idx on public.community_members(user_id);
create index if not exists rooms_host_id_idx on public.rooms(host_id);
create index if not exists room_members_user_id_idx on public.room_members(user_id);
create index if not exists room_messages_sender_id_idx on public.room_messages(sender_id);
create index if not exists follows_following_id_idx on public.follows(following_id);
create index if not exists user_blocks_blocked_id_idx on public.user_blocks(blocked_id);
create index if not exists safety_reports_target_user_id_idx on public.safety_reports(target_user_id);
create index if not exists safety_reports_room_id_idx on public.safety_reports(room_id);
create index if not exists safety_reports_message_id_idx on public.safety_reports(message_id);
create index if not exists safety_reports_reviewed_by_idx on public.safety_reports(reviewed_by);
create index if not exists user_sanctions_user_id_idx on public.user_sanctions(user_id);
create index if not exists user_sanctions_created_by_idx on public.user_sanctions(created_by);
create index if not exists wallet_transactions_user_id_idx on public.wallet_transactions(user_id);
create index if not exists bank_transfer_requests_user_id_idx on public.bank_transfer_requests(user_id);
create index if not exists bank_transfer_requests_reviewed_by_idx on public.bank_transfer_requests(reviewed_by);
create index if not exists device_push_tokens_user_id_idx on public.device_push_tokens(user_id);

alter function public.normalize_moderation_text(text) set search_path = public, pg_temp;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_conversations'
  ) then
    alter publication supabase_realtime add table public.direct_conversations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'communities'
  ) then
    alter publication supabase_realtime add table public.communities;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_members'
  ) then
    alter publication supabase_realtime add table public.community_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_members'
  ) then
    alter publication supabase_realtime add table public.room_members;
  end if;
end;
$$;

revoke execute on all functions in schema public from public, anon;

grant execute on function public.is_handle_available(text) to anon, authenticated;
grant execute on function public.admin_list_bank_transfer_requests(text) to authenticated;
grant execute on function public.admin_resolve_report(uuid,text,text,text,integer) to authenticated;
grant execute on function public.admin_review_bank_transfer_request(uuid,boolean,integer,text) to authenticated;
grant execute on function public.admin_security_overview() to authenticated;
grant execute on function public.can_access_room_messages(uuid,uuid) to authenticated;
grant execute on function public.can_send_room_message(uuid,uuid) to authenticated;
grant execute on function public.claim_daily_reward(integer) to authenticated;
grant execute on function public.contains_blocked_term(text) to authenticated;
grant execute on function public.create_bank_transfer_request(integer,numeric) to authenticated;
grant execute on function public.create_safety_report(text,text,uuid,uuid,uuid) to authenticated;
grant execute on function public.is_app_admin(uuid) to authenticated;
grant execute on function public.is_room_staff(uuid,uuid) to authenticated;
grant execute on function public.join_room(uuid) to authenticated;
grant execute on function public.list_direct_conversations() to authenticated;
grant execute on function public.manage_room_member(uuid,uuid,text) to authenticated;
grant execute on function public.normalize_moderation_text(text) to authenticated;
grant execute on function public.register_push_token(text,text) to authenticated;
grant execute on function public.send_room_gift(uuid,text) to authenticated;
grant execute on function public.set_room_hand_raise(uuid,boolean) to authenticated;
grant execute on function public.set_user_block(uuid,boolean) to authenticated;
grant execute on function public.spend_wallet_credit(integer,text,jsonb) to authenticated;
grant execute on function public.start_direct_conversation(text) to authenticated;
grant execute on function public.update_room_settings(uuid,boolean,boolean) to authenticated;
grant execute on function public.users_blocked(uuid,uuid) to authenticated;
grant execute on function public.wallet_get_or_create() to authenticated;

commit;
