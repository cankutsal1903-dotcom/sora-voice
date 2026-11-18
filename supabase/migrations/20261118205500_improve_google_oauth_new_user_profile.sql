-- Enhance handle_new_user() for public Google OAuth & Email signups:
-- 1. Extract display_name from display_name / full_name / name / email prefix, guarding blocked terms.
-- 2. Derive a clean readable @handle from email prefix when OAuth does not supply handle, with safe collision retry.
-- 3. Import HTTPS Google profile avatar (avatar_url / picture) when valid (<= 600 chars, https://).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt integer;
  v_raw_handle text;
  v_email_handle text;
  v_handle text;
  v_display_name text;
  v_avatar_url text;
begin
  v_raw_handle := regexp_replace(lower(trim(coalesce(new.raw_user_meta_data ->> 'handle', ''))), '[^a-z0-9_]', '', 'g');
  v_email_handle := left(regexp_replace(lower(trim(split_part(coalesce(new.email, ''), '@', 1))), '[^a-z0-9_]', '', 'g'), 24);

  if char_length(v_raw_handle) between 3 and 24 and not public.contains_blocked_term(v_raw_handle) then
    v_handle := v_raw_handle;
  elsif char_length(v_email_handle) between 3 and 24 and not public.contains_blocked_term(v_email_handle) then
    v_handle := v_email_handle;
  else
    v_handle := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;

  v_display_name := left(
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
      nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'Sora kullanıcısı'
    ),
    36
  );

  if public.contains_blocked_term(v_display_name) then
    v_display_name := 'Sora kullanıcısı';
  end if;

  v_avatar_url := coalesce(
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'picture', '')), '')
  );
  if v_avatar_url is not null and (char_length(v_avatar_url) > 600 or v_avatar_url !~ '^https://') then
    v_avatar_url := null;
  end if;

  for v_attempt in 1..8 loop
    begin
      insert into public.profiles (id, handle, display_name, avatar_url, public_id)
      values (
        new.id,
        case when v_attempt = 1 then v_handle else 'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) end,
        v_display_name,
        v_avatar_url,
        public.generate_unique_8digit_code('profiles')
      )
      on conflict (id) do nothing;
      exit;
    exception
      when unique_violation then
        if v_attempt = 8 then
          raise;
        end if;
    end;
  end loop;
  return new;
end;
$$;
