-- Self-gift cashback blast. One claim per gift request, server-authoritative.
alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check
  check (
    type in (
      'daily_reward',
      'gift',
      'bank_transfer',
      'promo_grant',
      'cosmetic_purchase',
      'family_create',
      'level_reward',
      'gift_cashback'
    )
  );

create table if not exists public.self_gift_blasts (
  request_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  gift_cost bigint not null check (gift_cost > 0),
  reward_amount bigint not null default 0 check (reward_amount >= 0),
  multiplier_basis integer not null default 0 check (multiplier_basis >= 0),
  created_at timestamptz not null default now()
);

alter table public.self_gift_blasts enable row level security;
revoke all on public.self_gift_blasts from public, anon, authenticated;

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
  v_balance bigint;
  v_rnd bytea;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;

  select * into v_tx
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = v_uid and type = 'gift';
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
  where b.request_id = p_request_id and b.user_id = v_uid;
  if found then
    return query select v_reward, v_basis, v_balance;
    return;
  end if;

  v_basis := 0;
  v_reward := 0;

  -- 0-6999: 0x, 7000-9499: 0.05x, 9500-9899: 0.20x,
  -- 9900-9998: 1x, 9999: 5x. The rare high reward is capped.
  v_rnd := extensions.gen_random_bytes(2);
  v_roll := ((get_byte(v_rnd, 0) * 256) + get_byte(v_rnd, 1)) % 10000;
  if v_roll >= 9999 then v_basis := 500;
  elsif v_roll >= 9900 then v_basis := 100;
  elsif v_roll >= 9500 then v_basis := 20;
  elsif v_roll >= 7000 then v_basis := 5;
  end if;
  v_reward := least((v_cost * v_basis) / 100, 250000000::bigint);

  insert into public.self_gift_blasts(request_id, user_id, gift_cost, reward_amount, multiplier_basis)
  values (p_request_id, v_uid, v_cost, v_reward, v_basis);

  update public.wallets w
  set balance = w.balance + v_reward::integer,
      promo_balance = w.promo_balance + v_reward::integer,
      updated_at = now()
  where w.user_id = v_uid
  returning w.balance::bigint into v_balance;

  if v_reward > 0 then
    insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
    values (
      v_uid,
      v_reward::integer,
      'gift_cashback',
      'Kendine hediye patlaması',
      jsonb_build_object('request_id', p_request_id, 'gift_cost', v_cost, 'multiplier_basis', v_basis),
      gen_random_uuid()
    );
  end if;

  return query select v_reward, v_basis, v_balance;
end;
$$;

revoke all on function public.claim_self_gift_blast(uuid) from public, anon;
grant execute on function public.claim_self_gift_blast(uuid) to authenticated;

notify pgrst, 'reload schema';
