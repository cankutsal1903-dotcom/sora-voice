-- 1. Fix NULL v_basis / v_reward regression in claim_self_gift_blast when no
--    prior blast row exists (70% 0x roll previously left v_basis = NULL,
--    causing 250,000,000 cap fallback + NOT NULL violation on multiplier_basis),
--    and guard wallet integer balance against overflow.
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

  -- SELECT ... INTO sets target variables to NULL when NOT FOUND; reset explicitly.
  v_reward := 0;
  v_basis := 0;

  -- 0-6999: 0x, 7000-9499: 0.05x, 9500-9899: 0.20x,
  -- 9900-9998: 1x, 9999: 5x. The rare high reward is capped at 250M.
  v_rnd := extensions.gen_random_bytes(2);
  v_roll := ((get_byte(v_rnd, 0) * 256) + get_byte(v_rnd, 1)) % 10000;
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

revoke all on function public.claim_self_gift_blast(uuid) from public, anon;
grant execute on function public.claim_self_gift_blast(uuid) to authenticated;

-- 2. Make purchase_profile_item lock the wallet row before checking ownership
--    so concurrent taps return idempotently instead of colliding.
create or replace function public.purchase_profile_item(p_item_id text, p_request_id uuid)
returns table(balance integer, promo_balance integer, paid_balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  item public.profile_item_catalog;
  promo_spent integer;
  paid_spent integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;

  select wallet.promo_balance, wallet.paid_balance, wallet.balance
    into promo_spent, paid_spent, balance
    from public.wallets as wallet
   where wallet.user_id = v_uid
   for update;
  if not found then raise exception 'Wallet unavailable'; end if;

  if exists(select 1 from public.user_profile_items as upi where upi.user_id = v_uid and upi.item_id = p_item_id) then
    promo_balance := promo_spent;
    paid_balance := paid_spent;
    return next;
    return;
  end if;

  select catalog_item.*
    into item
    from public.profile_item_catalog as catalog_item
   where catalog_item.id = p_item_id
     and catalog_item.active
     and catalog_item.purchasable;
  if not found then raise exception 'Item unavailable'; end if;

  if promo_spent + paid_spent < item.cost then raise exception 'Insufficient balance'; end if;
  promo_spent := least(promo_spent, item.cost);
  paid_spent := item.cost - promo_spent;

  update public.wallets as wallet
     set balance = wallet.balance - item.cost,
         promo_balance = wallet.promo_balance - promo_spent,
         paid_balance = wallet.paid_balance - paid_spent,
         updated_at = now()
   where wallet.user_id = v_uid
   returning wallet.balance, wallet.promo_balance, wallet.paid_balance
        into balance, promo_balance, paid_balance;

  insert into public.user_profile_items(user_id, item_id)
  values (v_uid, item.id)
  on conflict (user_id, item_id) do nothing;

  insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -item.cost,
    'cosmetic_purchase',
    item.name,
    jsonb_build_object('item_id', item.id, 'promo_spent', promo_spent, 'paid_spent', paid_spent),
    p_request_id
  );
  return next;
end;
$$;

-- 3. Allow unequipping frames/themes via activate_profile_item('none_frame' | 'none_theme').
create or replace function public.activate_profile_item(p_item_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  item public.profile_item_catalog;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  if p_item_id = 'none_frame' then
    update public.profiles set active_frame_id = null where id = v_uid;
    return;
  elsif p_item_id = 'none_theme' then
    update public.profiles set active_profile_theme_id = null where id = v_uid;
    return;
  end if;

  select c.*
    into item
    from public.profile_item_catalog c
    join public.user_profile_items u on u.item_id = c.id
   where u.user_id = v_uid
     and c.id = p_item_id
     and c.active;
  if not found then raise exception 'Item not owned'; end if;

  if item.item_type = 'frame' then
    update public.profiles set active_frame_id = item.id where id = v_uid;
  else
    update public.profiles set active_profile_theme_id = item.id where id = v_uid;
  end if;
end;
$$;

-- 4. Guard privileged progression & cosmetic columns on public.profiles against
--    direct client REST tampering while keeping SECURITY DEFINER RPCs untouched.
create or replace function public.user_owns_profile_item(
  p_user_id uuid,
  p_item_id text,
  p_item_type text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.user_profile_items u
      join public.profile_item_catalog c on c.id = u.item_id
     where u.user_id = p_user_id
       and u.item_id = p_item_id
       and c.item_type = p_item_type
       and c.active
  );
$$;

revoke all on function public.user_owns_profile_item(uuid, text, text) from public;
grant execute on function public.user_owns_profile_item(uuid, text, text) to authenticated, anon;

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.user_xp := old.user_xp;
    new.user_level := old.user_level;

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

drop trigger if exists guard_profile_privileged_columns_trg on public.profiles;
create trigger guard_profile_privileged_columns_trg
  before update on public.profiles
  for each row
  execute function public.guard_profile_privileged_columns();
