-- A room is visible only while its host is actively present.  The room record
-- is kept inactive so its owner can reopen the same room later.

alter table public.rooms
  add column if not exists last_active_at timestamptz not null default now();

alter table public.rooms
  drop constraint if exists rooms_state_check;

alter table public.rooms
  add constraint rooms_state_check
  check (state in ('live', 'scheduled', 'ended', 'inactive'));

-- Existing test rooms may have been created repeatedly by one account. Keep
-- only the newest live one; older copies become private inactive rooms.
with ranked_live_rooms as (
  select id,
    row_number() over (
      partition by host_id
      order by last_active_at desc, updated_at desc, created_at desc
    ) as position
  from public.rooms
  where state = 'live'
)
update public.rooms
set state = 'inactive', listener_count = 0, updated_at = now()
where id in (
  select id from ranked_live_rooms where position > 1
);

create unique index if not exists rooms_one_live_room_per_host_idx
  on public.rooms (host_id)
  where state = 'live';

create index if not exists rooms_live_activity_idx
  on public.rooms (last_active_at desc)
  where state = 'live';
