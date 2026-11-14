-- Oda sahibi kontrolleri: oda ayarları, duyuru, şifreli oda kilidi,
-- mikrofon sayısı / çift koltuğu, yönetici yetkileri (mikrofondan indirme,
-- süreli ban), incelemeli arka plan ve oda müziği.

create extension if not exists pgcrypto with schema extensions;

-- ── Oda alanları ──────────────────────────────────────────────────────────
alter table public.rooms
  add column if not exists announcement text not null default 'Hoşgeldin',
  add column if not exists password_protected boolean not null default false,
  add column if not exists password_changed_at timestamptz,
  add column if not exists seat_count smallint not null default 9,
  add column if not exists couple_seat boolean not null default false,
  add column if not exists background_path text,
  add column if not exists music_state jsonb;

alter table public.rooms drop constraint if exists rooms_announcement_length_check;
alter table public.rooms add constraint rooms_announcement_length_check
  check (char_length(announcement) <= 200);
alter table public.rooms drop constraint if exists rooms_seat_count_check;
alter table public.rooms add constraint rooms_seat_count_check
  check (seat_count in (9, 13));

-- Şifre özeti istemcilerin okuyabildiği rooms tablosunda tutulmaz.
create table if not exists public.room_secrets (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.room_secrets enable row level security;
revoke all on public.room_secrets from anon, authenticated;

create table if not exists public.room_password_failures (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  failed_at timestamptz not null default now()
);
create index if not exists room_password_failures_lookup_idx
  on public.room_password_failures(room_id, user_id, failed_at desc);
alter table public.room_password_failures enable row level security;
revoke all on public.room_password_failures from anon, authenticated;

-- ── Üye alanları ──────────────────────────────────────────────────────────
alter table public.room_members
  add column if not exists mic_banned_until timestamptz,
  add column if not exists banned_until timestamptz,
  add column if not exists password_verified_at timestamptz;

-- ── Uygulama ayarları (masaüstü inceleme aracı açar / kapatır) ───────────
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.app_settings enable row level security;
grant select on public.app_settings to authenticated;
drop policy if exists "Authenticated users read app settings" on public.app_settings;
create policy "Authenticated users read app settings" on public.app_settings
  for select using (auth.uid() is not null);
insert into public.app_settings (key, value)
values ('room_background_uploads_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create or replace function public.app_setting_enabled(p_key text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select value = 'true'::jsonb from public.app_settings where key = p_key), false);
$$;

-- ── Ayrıcalıklı oda alanlarını doğrudan güncellemeyi engelle ──────────────
-- "Hosts update their rooms" politikası tüm sütunlara izin verdiği için
-- arka plan, şifre, müzik ve koltuk alanları yalnızca aşağıdaki güvenli
-- fonksiyonlar üzerinden değiştirilebilir.
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
    or new.announcement is distinct from old.announcement then
    raise exception 'Use room settings functions for this change';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_room_privileged_columns on public.rooms;
create trigger guard_room_privileged_columns
before update on public.rooms
for each row execute function public.guard_room_privileged_columns();

create or replace function public.is_room_host(p_room_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.rooms where id = p_room_id and host_id = p_user_id);
$$;

-- ── Odaya giriş: süreli ban + şifre ───────────────────────────────────────
drop function if exists public.join_room(uuid);

create or replace function public.join_room(p_room_id uuid, p_password text default null)
returns table (role text, is_muted boolean)
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  current_room public.rooms;
  member public.room_members;
  secret_hash text;
  needs_password boolean := false;
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

  select * into member from public.room_members m where m.room_id = p_room_id and m.user_id = auth.uid();
  if found and member.removed_at is not null then
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

  if current_room.password_protected and current_room.host_id <> auth.uid() then
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
      -- Bir exception bu INSERT'i de geri alır ve deneme limiti çalışmaz. Boş
      -- sonuç döndürerek hatayı istemcinin kapalı biçimde ele almasını sağla.
      return;
    end if;
    delete from public.room_password_failures
    where room_id = p_room_id and user_id = auth.uid();
  end if;

  if member.user_id is null then
    insert into public.room_members (room_id, user_id, password_verified_at)
    values (p_room_id, auth.uid(), case when needs_password then now() else null end);
  else
    update public.room_members m
    set updated_at = now(),
        password_verified_at = case when needs_password then now() else m.password_verified_at end
    where m.room_id = p_room_id and m.user_id = auth.uid();
  end if;
  return query select m.role, m.is_muted from public.room_members m where m.room_id = p_room_id and m.user_id = auth.uid();
end;
$$;

revoke execute on function public.join_room(uuid, text) from public;
grant execute on function public.join_room(uuid, text) to authenticated;

-- Odadan çıkınca el kaldırma ve şifre doğrulaması temizlenir; yeniden
-- girerken şifre tekrar sorulur.
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.room_members
  set hand_raised_at = null, password_verified_at = null, updated_at = now()
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;
revoke execute on function public.leave_room(uuid) from public;
grant execute on function public.leave_room(uuid) to authenticated;

-- Mikrofondan indirilen kullanıcı 10 dakika sıraya giremez.
create or replace function public.set_room_hand_raise(p_room_id uuid, p_raised boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raised_at timestamptz;
  v_mic_banned_until timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select member.mic_banned_until into v_mic_banned_until
  from public.room_members member
  where member.room_id = p_room_id and member.user_id = auth.uid() and member.removed_at is null;
  if not found then raise exception 'Room membership required'; end if;
  if p_raised and v_mic_banned_until is not null and v_mic_banned_until > now() then
    raise exception 'Mic banned until %', to_char(v_mic_banned_until at time zone 'Europe/Istanbul', 'HH24:MI');
  end if;
  if p_raised and exists (
    select 1 from public.rooms room where room.id = p_room_id and room.room_locked
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

-- ── Koltuk işlemleri (token sunucusu LiveKit tarafını uygular) ────────────
-- p_action: take | leave | assign | kick | reject
create or replace function public.authorize_room_seat(
  p_room_id uuid,
  p_action text,
  p_target_user_id uuid default null
)
returns table (
  actor_role text,
  target_user_id uuid,
  target_role text,
  target_muted boolean,
  host_id uuid,
  seat_count smallint,
  couple_seat boolean
)
language plpgsql
security definer set search_path = public
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
        role = case when m.role = 'speaker' then 'listener' else m.role end,
        updated_at = now()
    where m.room_id = p_room_id and m.user_id = target_id
    returning * into target;
  elsif p_action in ('assign', 'take', 'reject', 'leave') then
    update public.room_members m
    set hand_raised_at = null, updated_at = now()
    where m.room_id = p_room_id and m.user_id = target_id
    returning * into target;
  end if;

  return query select actor.role, target_id, target.role, target.is_muted,
    current_room.host_id, current_room.seat_count, current_room.couple_seat;
end;
$$;
revoke execute on function public.authorize_room_seat(uuid, text, uuid) from public;
grant execute on function public.authorize_room_seat(uuid, text, uuid) to authenticated;

-- ── Süreli ban ────────────────────────────────────────────────────────────
-- p_minutes null => kalıcı
create or replace function public.ban_room_member(p_room_id uuid, p_target_user_id uuid, p_minutes integer default null)
returns table (role text, is_muted boolean, removed boolean, banned_until timestamptz)
language plpgsql
security definer set search_path = public
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
  if target_role is null then raise exception 'Member not found'; end if;
  if p_target_user_id = auth.uid() or target_role = 'host' or public.is_room_host(p_room_id, p_target_user_id) then
    raise exception 'This member cannot be changed';
  end if;
  if actor_role = 'moderator' and target_role = 'moderator' then raise exception 'Moderators cannot change each other'; end if;

  update public.room_members m
  set role = 'listener', is_muted = true, removed_at = now(), hand_raised_at = null,
      password_verified_at = null,
      banned_until = case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end,
      updated_at = now()
  where m.room_id = p_room_id and m.user_id = p_target_user_id;

  return query select m.role, m.is_muted, m.removed_at is not null, m.banned_until
  from public.room_members m where m.room_id = p_room_id and m.user_id = p_target_user_id;
end;
$$;
revoke execute on function public.ban_room_member(uuid, uuid, integer) from public;
grant execute on function public.ban_room_member(uuid, uuid, integer) to authenticated;

-- Eski yönetim fonksiyonunda NULL actor_role, SQL'in üç değerli mantığı
-- nedeniyle yetki kontrolünü atlayabiliyordu. Kapalı yetki kontrolü eski
-- yönetim çağrılarını da güvenli tutar.
create or replace function public.manage_room_member(
  p_room_id uuid,
  p_target_user_id uuid,
  p_action text
)
returns table (role text, is_muted boolean, removed boolean)
language plpgsql
security definer set search_path = public
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
    update public.room_members set role = 'listener', updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'promote_speaker' then
    update public.room_members set role = 'speaker', is_muted = false,
      removed_at = null, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'demote_listener' then
    update public.room_members set role = 'listener', is_muted = true, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'mute' then
    update public.room_members set is_muted = true, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'unmute' then
    update public.room_members set is_muted = false, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  elsif p_action = 'remove' then
    update public.room_members set role = 'listener', is_muted = true,
      removed_at = now(), password_verified_at = null, updated_at = now()
    where room_id = p_room_id and user_id = p_target_user_id;
  else
    raise exception 'Unsupported moderation action';
  end if;

  return query select m.role, m.is_muted, m.removed_at is not null
  from public.room_members m
  where m.room_id = p_room_id and m.user_id = p_target_user_id;
end;
$$;
revoke execute on function public.manage_room_member(uuid, uuid, text) from public, anon;
grant execute on function public.manage_room_member(uuid, uuid, text) to authenticated;

-- ── Oda ayarları (yalnızca oda sahibi) ────────────────────────────────────
create or replace function public.update_room_details(
  p_room_id uuid,
  p_title text default null,
  p_description text default null,
  p_announcement text default null
)
returns public.rooms
language plpgsql
security definer set search_path = public
as $$
declare
  updated_room public.rooms;
  clean_title text := nullif(btrim(coalesce(p_title, '')), '');
  clean_description text := case when p_description is null then null else btrim(p_description) end;
  clean_announcement text := case when p_announcement is null then null else btrim(p_announcement) end;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room owner can change settings'; end if;
  if clean_title is not null and char_length(clean_title) > 36 then raise exception 'Title too long'; end if;
  if clean_description is not null and char_length(clean_description) > 180 then raise exception 'Description too long'; end if;
  if clean_announcement is not null and char_length(clean_announcement) > 200 then raise exception 'Announcement too long'; end if;
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
      updated_at = now()
  where id = p_room_id
  returning * into updated_room;
  perform set_config('sora.room_privileged', 'off', true);
  return updated_room;
end;
$$;
revoke execute on function public.update_room_details(uuid, text, text, text) from public;
grant execute on function public.update_room_details(uuid, text, text, text) to authenticated;

create or replace function public.set_room_password(p_room_id uuid, p_password text default null)
returns public.rooms
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  updated_room public.rooms;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room owner can lock the room'; end if;
  perform set_config('sora.room_privileged', 'on', true);
  if p_password is null or p_password = '' then
    delete from public.room_secrets where room_id = p_room_id;
    update public.rooms set password_protected = false, password_changed_at = now(), updated_at = now()
    where id = p_room_id returning * into updated_room;
  else
    if p_password !~ '^[0-9]{4}$' then raise exception 'Password must be 4 digits'; end if;
    insert into public.room_secrets (room_id, password_hash, updated_at)
    values (p_room_id, extensions.crypt(p_password, extensions.gen_salt('bf')), now())
    on conflict (room_id) do update set password_hash = excluded.password_hash, updated_at = now();
    update public.rooms set password_protected = true, password_changed_at = now(), updated_at = now()
    where id = p_room_id returning * into updated_room;
  end if;
  perform set_config('sora.room_privileged', 'off', true);
  return updated_room;
end;
$$;
revoke execute on function public.set_room_password(uuid, text) from public;
grant execute on function public.set_room_password(uuid, text) to authenticated;

create or replace function public.update_room_layout(p_room_id uuid, p_seat_count integer, p_couple_seat boolean)
returns public.rooms
language plpgsql
security definer set search_path = public
as $$
declare
  updated_room public.rooms;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room owner can change seats'; end if;
  if p_seat_count not in (9, 13) then raise exception 'Invalid seat count'; end if;
  perform set_config('sora.room_privileged', 'on', true);
  update public.rooms
  set seat_count = p_seat_count, couple_seat = coalesce(p_couple_seat, false), updated_at = now()
  where id = p_room_id returning * into updated_room;
  perform set_config('sora.room_privileged', 'off', true);
  return updated_room;
end;
$$;
revoke execute on function public.update_room_layout(uuid, integer, boolean) from public;
grant execute on function public.update_room_layout(uuid, integer, boolean) to authenticated;

-- ── Oda müziği ────────────────────────────────────────────────────────────
-- p_state: { path, title, playing, position_ms, started_at, volume } veya null
create or replace function public.set_room_music(p_room_id uuid, p_state jsonb default null)
returns public.rooms
language plpgsql
security definer set search_path = public
as $$
declare
  updated_room public.rooms;
  clean_state jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_staff(p_room_id) and not public.is_room_host(p_room_id) then
    raise exception 'Moderator permission required';
  end if;
  if p_state is not null then
    if coalesce(p_state->>'path', '') !~ ('^' || p_room_id::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'Invalid music file';
    end if;
    clean_state := jsonb_build_object(
      'path', p_state->>'path',
      'title', left(coalesce(p_state->>'title', 'Müzik'), 80),
      'playing', coalesce((p_state->>'playing')::boolean, false),
      'position_ms', greatest(0, coalesce((p_state->>'position_ms')::bigint, 0)),
      'started_at', now(),
      'volume', least(1, greatest(0, coalesce((p_state->>'volume')::numeric, 0.7))),
      'updated_by', auth.uid()
    );
  end if;
  perform set_config('sora.room_privileged', 'on', true);
  update public.rooms set music_state = clean_state, updated_at = now()
  where id = p_room_id returning * into updated_room;
  perform set_config('sora.room_privileged', 'off', true);
  return updated_room;
end;
$$;
revoke execute on function public.set_room_music(uuid, jsonb) from public;
grant execute on function public.set_room_music(uuid, jsonb) to authenticated;

-- ── İncelemeli oda arka planı ─────────────────────────────────────────────
create table if not exists public.room_background_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  review_note text not null default '' check (char_length(review_note) <= 200),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists room_background_requests_status_idx
  on public.room_background_requests(status, created_at);
create index if not exists room_background_requests_room_idx
  on public.room_background_requests(room_id, created_at desc);
alter table public.room_background_requests enable row level security;
grant select on public.room_background_requests to authenticated;
drop policy if exists "Owners and admins read background requests" on public.room_background_requests;
create policy "Owners and admins read background requests" on public.room_background_requests
  for select using (requested_by = auth.uid() or public.is_app_admin());

create or replace function public.submit_room_background(p_room_id uuid, p_image_path text)
returns public.room_background_requests
language plpgsql
security definer set search_path = public
as $$
declare
  created_request public.room_background_requests;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room owner can change the background'; end if;
  if not public.app_setting_enabled('room_background_uploads_enabled') then
    raise exception 'Background changes are disabled';
  end if;
  if coalesce(p_image_path, '') !~ ('^' || p_room_id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'Invalid image path';
  end if;
  update public.room_background_requests
  set status = 'cancelled', reviewed_at = now()
  where room_id = p_room_id and status = 'pending';
  insert into public.room_background_requests (room_id, requested_by, image_path)
  values (p_room_id, auth.uid(), p_image_path)
  returning * into created_request;
  return created_request;
end;
$$;
revoke execute on function public.submit_room_background(uuid, text) from public;
grant execute on function public.submit_room_background(uuid, text) to authenticated;

create or replace function public.clear_room_background(p_room_id uuid)
returns public.rooms
language plpgsql
security definer set search_path = public
as $$
declare
  updated_room public.rooms;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) and not public.is_app_admin() then raise exception 'Only the room owner can change the background'; end if;
  perform set_config('sora.room_privileged', 'on', true);
  update public.rooms set background_path = null, updated_at = now() where id = p_room_id returning * into updated_room;
  perform set_config('sora.room_privileged', 'off', true);
  return updated_room;
end;
$$;
revoke execute on function public.clear_room_background(uuid) from public;
grant execute on function public.clear_room_background(uuid) to authenticated;

create or replace function public.admin_list_room_background_requests(p_status text default 'pending')
returns table (
  id uuid,
  room_id uuid,
  room_title text,
  requested_by uuid,
  requester_name text,
  image_path text,
  status text,
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  return query
  select r.id, r.room_id, room.title, r.requested_by, coalesce(p.display_name, 'Sora kullanıcısı'),
    r.image_path, r.status, r.review_note, r.created_at, r.reviewed_at
  from public.room_background_requests r
  join public.rooms room on room.id = r.room_id
  left join public.profiles p on p.id = r.requested_by
  where p_status is null or r.status = p_status
  order by r.created_at asc
  limit 200;
end;
$$;
revoke execute on function public.admin_list_room_background_requests(text) from public;
grant execute on function public.admin_list_room_background_requests(text) to authenticated;

create or replace function public.admin_review_room_background(p_request_id uuid, p_approve boolean, p_note text default '')
returns public.room_background_requests
language plpgsql
security definer set search_path = public
as $$
declare
  current_request public.room_background_requests;
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select * into current_request from public.room_background_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if current_request.status <> 'pending' then raise exception 'Request already reviewed'; end if;

  update public.room_background_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      review_note = left(coalesce(p_note, ''), 200),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_request_id
  returning * into current_request;

  if p_approve then
    perform set_config('sora.room_privileged', 'on', true);
    update public.rooms set background_path = current_request.image_path, updated_at = now()
    where id = current_request.room_id;
    perform set_config('sora.room_privileged', 'off', true);
  end if;
  return current_request;
end;
$$;
revoke execute on function public.admin_review_room_background(uuid, boolean, text) from public;
grant execute on function public.admin_review_room_background(uuid, boolean, text) to authenticated;

create or replace function public.admin_set_app_setting(p_key text, p_value jsonb)
returns public.app_settings
language plpgsql
security definer set search_path = public
as $$
declare
  saved public.app_settings;
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  if p_key not in ('room_background_uploads_enabled') then raise exception 'Unknown setting'; end if;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid()
  returning * into saved;
  return saved;
end;
$$;
revoke execute on function public.admin_set_app_setting(text, jsonb) from public;
grant execute on function public.admin_set_app_setting(text, jsonb) to authenticated;

-- ── Depolama alanları ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('room-backgrounds', 'room-backgrounds', false, 6291456, array['image/jpeg', 'image/png', 'image/webp']),
  ('room-music', 'room-music', false, 26214400, array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_room_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  first_segment text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if first_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return first_segment::uuid;
  end if;
  return null;
end;
$$;

revoke execute on function public.guard_room_privileged_columns() from public, anon, authenticated;
revoke execute on function public.is_room_host(uuid, uuid) from public, anon;
grant execute on function public.is_room_host(uuid, uuid) to authenticated;
revoke execute on function public.app_setting_enabled(text) from public, anon;
grant execute on function public.app_setting_enabled(text) to authenticated;
revoke execute on function public.storage_room_id(text) from public, anon;
grant execute on function public.storage_room_id(text) to authenticated;

drop policy if exists "Room owners upload backgrounds" on storage.objects;
create policy "Room owners upload backgrounds" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'room-backgrounds'
    and public.is_room_host(public.storage_room_id(name))
    and public.app_setting_enabled('room_background_uploads_enabled')
  );

drop policy if exists "Room backgrounds are readable when approved" on storage.objects;
create policy "Room backgrounds are readable when approved" on storage.objects for select to authenticated
  using (
    bucket_id = 'room-backgrounds'
    and (
      owner = auth.uid()
      or public.is_app_admin()
      or exists (select 1 from public.rooms room where room.background_path = storage.objects.name)
    )
  );

drop policy if exists "Room staff upload music" on storage.objects;
create policy "Room staff upload music" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'room-music'
    and (public.is_room_staff(public.storage_room_id(name)) or public.is_room_host(public.storage_room_id(name)))
  );

drop policy if exists "Room members read music" on storage.objects;
create policy "Room members read music" on storage.objects for select to authenticated
  using (
    bucket_id = 'room-music'
    and public.can_access_room_messages(public.storage_room_id(name))
  );

drop policy if exists "Room staff delete music" on storage.objects;
create policy "Room staff delete music" on storage.objects for delete to authenticated
  using (
    bucket_id = 'room-music'
    and (public.is_room_staff(public.storage_room_id(name)) or public.is_room_host(public.storage_room_id(name)))
  );

-- Oda müziği / ayar değişiklikleri istemcilere realtime ile ulaşsın.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
exception when undefined_object then null;
end;
$$;
