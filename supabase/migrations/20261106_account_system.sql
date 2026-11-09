begin;

create unique index if not exists profiles_handle_lower_unique_idx
  on public.profiles (lower(handle));

create or replace function public.is_handle_available(p_handle text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_handle text := lower(trim(coalesce(p_handle, '')));
begin
  if normalized_handle !~ '^[a-z0-9_]{3,24}$' then
    return false;
  end if;

  return not exists (
    select 1
    from public.profiles
    where lower(handle) = normalized_handle
  );
end;
$$;

revoke all on function public.is_handle_available(text) from public;
grant execute on function public.is_handle_available(text) to anon, authenticated;

commit;
