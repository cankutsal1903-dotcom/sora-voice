-- Wire automatic room-live push notification webhook via pg_net + Supabase Vault
-- Secrets live exclusively in Vault and Edge Function secrets (never in SQL/git).

create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_room_live_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.state is distinct from 'live' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.state = 'live' then
    return new;
  end if;

  begin
    select decrypted_secret
      into v_url
      from vault.decrypted_secrets
     where name = 'notify_room_live_webhook_url'
     order by created_at desc
     limit 1;

    select decrypted_secret
      into v_secret
      from vault.decrypted_secrets
     where name = 'notify_room_live_webhook_secret'
     order by created_at desc
     limit 1;

    if v_url is not null and length(trim(v_url)) > 0
       and v_secret is not null and length(trim(v_secret)) > 0 then
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object(
          'type', tg_op,
          'table', tg_table_name,
          'schema', tg_table_schema,
          'record', to_jsonb(new),
          'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-webhook-secret', v_secret
        ),
        timeout_milliseconds := 4000
      );
    end if;
  exception
    when others then
      -- Never block room creation or presence updates if webhook dispatch fails.
      null;
  end;

  return new;
end;
$$;

revoke all on function public.dispatch_room_live_webhook() from public, anon, authenticated;

drop trigger if exists on_room_live_notify_followers on public.rooms;
create trigger on_room_live_notify_followers
  after insert or update of state on public.rooms
  for each row
  execute function public.dispatch_room_live_webhook();
