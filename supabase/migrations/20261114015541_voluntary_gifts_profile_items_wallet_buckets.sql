begin;

-- Existing balances are preserved as purchased/admin credited funds. New
-- accounts receive a separate, non-transferable promotional balance once.
alter table public.wallets add column if not exists promo_balance integer not null default 0 check (promo_balance >= 0);
alter table public.wallets add column if not exists paid_balance integer not null default 0 check (paid_balance >= 0);
update public.wallets set paid_balance = balance where paid_balance = 0 and promo_balance = 0 and balance > 0;
alter table public.wallets drop constraint if exists wallets_balance_buckets_check;
alter table public.wallets add constraint wallets_balance_buckets_check
  check (balance = promo_balance + paid_balance) not valid;
alter table public.wallets validate constraint wallets_balance_buckets_check;
create or replace function public.sync_wallet_balance_buckets()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.balance is distinct from old.balance
     and new.promo_balance is not distinct from old.promo_balance
     and new.paid_balance is not distinct from old.paid_balance then
    new.paid_balance := new.balance - new.promo_balance;
  end if;
  return new;
end;
$$;
drop trigger if exists sync_wallet_balance_buckets_before_update on public.wallets;
create trigger sync_wallet_balance_buckets_before_update before update on public.wallets
  for each row execute function public.sync_wallet_balance_buckets();
alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check
  check (type in ('daily_reward', 'gift', 'bank_transfer', 'promo_grant', 'cosmetic_purchase'));
alter table public.wallet_transactions add column if not exists idempotency_key uuid;
create unique index if not exists wallet_transactions_idempotency_key_idx
  on public.wallet_transactions(idempotency_key) where idempotency_key is not null;
create unique index if not exists wallet_transactions_one_promo_grant_idx
  on public.wallet_transactions(user_id) where type = 'promo_grant';
-- Estimate the remaining legacy promotional amount from recorded rewards and
-- historical gift spending; preserve the total balance exactly.
with earned as (
  select user_id,
    greatest(0, coalesce(sum(amount) filter (where type in ('daily_reward','promo_grant')),0)
      + coalesce(sum(amount) filter (where type='gift' and amount < 0),0)) as remaining_promo
  from public.wallet_transactions group by user_id
)
update public.wallets w set promo_balance=least(w.balance,e.remaining_promo),
  paid_balance=w.balance-least(w.balance,e.remaining_promo)
from earned e where e.user_id=w.user_id;

alter table public.profiles add column if not exists active_frame_id text;
alter table public.profiles add column if not exists active_profile_theme_id text;

create table if not exists public.profile_item_catalog (
  id text primary key,
  name text not null check (char_length(name) between 1 and 40),
  item_type text not null check (item_type in ('frame', 'theme')),
  appearance jsonb not null default '{}'::jsonb,
  cost integer not null check (cost > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profile_item_catalog enable row level security;
drop policy if exists "Authenticated users read profile item catalog" on public.profile_item_catalog;
create policy "Authenticated users read profile item catalog" on public.profile_item_catalog
  for select to authenticated using (active);

create table if not exists public.user_profile_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.profile_item_catalog(id),
  purchased_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.user_profile_items enable row level security;
drop policy if exists "Users read their profile items" on public.user_profile_items;
create policy "Users read their profile items" on public.user_profile_items
  for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.profile_item_catalog, public.user_profile_items to authenticated;

insert into public.profile_item_catalog (id,name,item_type,appearance,cost) values
 ('frame_sky','Gökyüzü çerçevesi','frame','{"color":"#58BCEB","width":3}'::jsonb,180),
 ('frame_amber','Kehribar çerçeve','frame','{"color":"#E5B94F","width":3}'::jsonb,260),
 ('frame_lilac','Leylak çerçevesi','frame','{"color":"#A78BFA","width":3}'::jsonb,340),
 ('theme_ocean','Okyanus profili','theme','{"background":"#E7F6FC","accent":"#258FB8"}'::jsonb,220),
 ('theme_midnight','Gece profili','theme','{"background":"#E8EAF5","accent":"#5B63B8"}'::jsonb,300),
 ('theme_sunrise','Gün doğumu profili','theme','{"background":"#FFF1E6","accent":"#D98257"}'::jsonb,380)
on conflict (id) do nothing;

-- Do not allow clients to change monetary balance through the generic spend RPC.
create or replace function public.spend_wallet_credit(p_amount integer, p_description text, p_metadata jsonb default '{}'::jsonb)
returns table (balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'Use a server-validated purchase or gift operation';
end;
$$;

create or replace function public.create_wallet_for_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.wallets(user_id,balance,promo_balance,paid_balance)
  values(new.id,50,50,0) on conflict(user_id) do nothing;
  insert into public.wallet_transactions(user_id,amount,type,description,metadata)
  values(new.id,50,'promo_grant','Hoş geldin promosyonu','{"cashout":false,"transferable":false}'::jsonb)
  on conflict do nothing;
  return new;
end;
$$;

drop function if exists public.wallet_get_or_create();
create function public.wallet_get_or_create()
returns table (balance integer, last_daily_reward_at date, promo_balance integer, paid_balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.wallets(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  return query select w.balance,w.last_daily_reward_at,w.promo_balance,w.paid_balance
    from public.wallets w where w.user_id=auth.uid();
end;
$$;

create or replace function public.claim_daily_reward(p_amount integer default 75)
returns table (balance integer, claimed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare next_balance integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_amount <> 75 then raise exception 'Invalid reward amount'; end if;
  insert into public.wallets(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  update public.wallets set promo_balance=promo_balance+p_amount,
    balance=balance+p_amount,last_daily_reward_at=current_date,updated_at=now()
   where user_id=auth.uid() and last_daily_reward_at is distinct from current_date
   returning wallets.balance into next_balance;
  if next_balance is null then
    select w.balance into next_balance from public.wallets w where w.user_id=auth.uid();
    return query select next_balance,false; return;
  end if;
  insert into public.wallet_transactions(user_id,amount,type,description,metadata)
    values(auth.uid(),p_amount,'daily_reward','Günlük ödül','{"cashout":false,"transferable":false}'::jsonb);
  return query select next_balance,true;
end;
$$;

create or replace function public.send_room_gift(p_room_id uuid,p_gift_id text,p_recipient_id uuid,p_request_id uuid)
returns table(balance integer,message_id uuid,message_body text,gift_name text,gift_cost integer,promo_balance integer,paid_balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.gift_catalog; total integer; promo_spent integer; paid_spent integer;
  sender_name text; recipient_name text; new_message public.room_messages; prior public.wallet_transactions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  select * into prior from public.wallet_transactions where idempotency_key=p_request_id and user_id=auth.uid();
  if found then
    return query select w.balance,(prior.metadata->>'message_id')::uuid,
      coalesce((select m.body from public.room_messages m where m.id=(prior.metadata->>'message_id')::uuid),''),
      coalesce(prior.metadata->>'gift_name','Hediye'),abs(prior.amount),w.promo_balance,w.paid_balance
      from public.wallets w where w.user_id=auth.uid(); return;
  end if;
  select * into g from public.gift_catalog where id=p_gift_id and active;
  if not found then raise exception 'Gift is unavailable'; end if;
  if p_recipient_id is null or p_recipient_id=auth.uid() then raise exception 'Invalid recipient'; end if;
  if not exists(select 1 from public.rooms r join public.room_members s on s.room_id=r.id
      join public.room_members t on t.room_id=r.id where r.id=p_room_id and r.state='live'
      and s.user_id=auth.uid() and s.removed_at is null and t.user_id=p_recipient_id and t.removed_at is null
      and not public.users_blocked(auth.uid(),p_recipient_id)) then raise exception 'Room membership required'; end if;
  insert into public.wallets(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  select balance,promo_balance into total,promo_spent from public.wallets where user_id=auth.uid() for update;
  if total<g.cost then raise exception 'Insufficient balance'; end if;
  promo_spent:=least(promo_spent,g.cost); paid_spent:=g.cost-promo_spent;
  update public.wallets set balance=balance-g.cost,promo_balance=promo_balance-promo_spent,
    paid_balance=paid_balance-paid_spent,updated_at=now() where user_id=auth.uid();
  select display_name into sender_name from public.profiles where id=auth.uid();
  select display_name into recipient_name from public.profiles where id=p_recipient_id;
  insert into public.room_messages(room_id,sender_id,body,kind)
    values(p_room_id,auth.uid(),sender_name||' → '||recipient_name||': '||g.name||' hediyesi gönderdi!','gift') returning * into new_message;
  insert into public.wallet_transactions(user_id,amount,type,description,metadata,idempotency_key)
    values(auth.uid(),-g.cost,'gift',g.name||' hediyesi',jsonb_build_object('gift_id',g.id,'room_id',p_room_id,
      'recipient_id',p_recipient_id,'promo_spent',promo_spent,'paid_spent',paid_spent,'message_id',new_message.id,'gift_name',g.name),p_request_id);
  return query select w.balance,new_message.id,new_message.body,g.name,g.cost,w.promo_balance,w.paid_balance
    from public.wallets w where w.user_id=auth.uid();
end;
$$;

create or replace function public.purchase_profile_item(p_item_id text,p_request_id uuid)
returns table(balance integer,promo_balance integer,paid_balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare item public.profile_item_catalog; promo_spent integer; paid_spent integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  if exists(select 1 from public.user_profile_items where user_id=auth.uid() and item_id=p_item_id) then
    select w.balance,w.promo_balance,w.paid_balance into balance,promo_balance,paid_balance from public.wallets w where w.user_id=auth.uid(); return next; return;
  end if;
  select * into item from public.profile_item_catalog where id=p_item_id and active;
  if not found then raise exception 'Item unavailable'; end if;
  select w.promo_balance,w.paid_balance into promo_spent,paid_spent from public.wallets w where w.user_id=auth.uid() for update;
  if not found then raise exception 'Wallet unavailable'; end if;
  if promo_spent+paid_spent<item.cost then raise exception 'Insufficient balance'; end if;
  promo_spent:=least(promo_spent,item.cost); paid_spent:=item.cost-promo_spent;
  update public.wallets set balance=balance-item.cost,promo_balance=promo_balance-promo_spent,
    paid_balance=paid_balance-paid_spent,updated_at=now() where user_id=auth.uid()
    returning wallets.balance,wallets.promo_balance,wallets.paid_balance into balance,promo_balance,paid_balance;
  insert into public.user_profile_items(user_id,item_id) values(auth.uid(),item.id);
  insert into public.wallet_transactions(user_id,amount,type,description,metadata,idempotency_key)
    values(auth.uid(),-item.cost,'cosmetic_purchase',item.name,jsonb_build_object('item_id',item.id,
      'promo_spent',promo_spent,'paid_spent',paid_spent),p_request_id);
  return next;
end;
$$;

create or replace function public.activate_profile_item(p_item_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare item public.profile_item_catalog;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select c.* into item from public.profile_item_catalog c join public.user_profile_items u on u.item_id=c.id
    where u.user_id=auth.uid() and c.id=p_item_id and c.active;
  if not found then raise exception 'Item not owned'; end if;
  if item.item_type='frame' then update public.profiles set active_frame_id=item.id where id=auth.uid();
  else update public.profiles set active_profile_theme_id=item.id where id=auth.uid(); end if;
end;
$$;

revoke all on function public.send_room_gift(uuid,text) from public,authenticated;
revoke all on function public.send_room_gift(uuid,text,uuid,uuid) from public;
revoke all on function public.purchase_profile_item(text,uuid) from public;
revoke all on function public.activate_profile_item(text) from public;
revoke all on function public.wallet_get_or_create() from public;
revoke all on function public.claim_daily_reward(integer) from public;
grant execute on function public.send_room_gift(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.purchase_profile_item(text,uuid) to authenticated;
grant execute on function public.activate_profile_item(text) to authenticated;
grant execute on function public.wallet_get_or_create() to authenticated;
grant execute on function public.claim_daily_reward(integer) to authenticated;
revoke all on function public.spend_wallet_credit(integer,text,jsonb) from public,authenticated;

commit;
