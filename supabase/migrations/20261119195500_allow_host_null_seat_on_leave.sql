-- Allow room_members.seat_index to be NULL for the host when they leave the room,
-- while still ensuring that whenever a host holds a seat it is seat 0.
create or replace function public.sync_room_member_seat_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.removed_at is not null then
    new.seat_index := null;
  elsif new.role = 'host' and new.seat_index is not null then
    new.seat_index := 0;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_room_member_seat_integrity() from public, anon, authenticated;
