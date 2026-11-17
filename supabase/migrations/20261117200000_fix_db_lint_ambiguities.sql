-- Fix PL/pgSQL variable/column name collisions reported by `supabase db lint`.
-- These functions return OUT columns named user_id/balance, so every column
-- reference must be qualified to avoid ambiguous resolution at runtime.

create or replace function public.admin_review_bank_transfer_request(
  p_request_id uuid,
  p_approved boolean,
  p_credited_credits integer default null,
  p_admin_note text default ''
)
returns table (request_id uuid, user_id uuid, status text, balance integer, credited_credits integer)
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  current_request public.bank_transfer_requests;
  actor_role text;
  next_balance integer;
  note text := left(trim(coalesce(p_admin_note, '')), 500);
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select admin_user.role
    into actor_role
    from public.app_admins as admin_user
   where admin_user.user_id = auth.uid();
  if actor_role not in ('admin', 'owner') then raise exception 'Admin or owner permission required'; end if;

  select request_row.*
    into current_request
    from public.bank_transfer_requests as request_row
   where request_row.id = p_request_id
   for update;
  if current_request.id is null then raise exception 'Transfer request not found'; end if;
  if current_request.status <> 'awaiting_transfer' then raise exception 'Transfer request was already reviewed'; end if;

  if p_approved then
    if p_credited_credits is null or p_credited_credits < 1 or p_credited_credits > 1000000 then
      raise exception 'Invalid credit amount';
    end if;
    insert into public.wallets (user_id) values (current_request.user_id) on conflict (user_id) do nothing;
    update public.wallets as wallet
       set balance = wallet.balance + p_credited_credits,
           updated_at = now()
     where wallet.user_id = current_request.user_id
     returning wallet.balance into next_balance;
    update public.bank_transfer_requests
       set status = 'approved', credited_credits = p_credited_credits, admin_note = note,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = current_request.id;
    insert into public.wallet_transactions (user_id, amount, type, description, metadata)
    values (
      current_request.user_id,
      p_credited_credits,
      'bank_transfer',
      'IBAN transferi onaylandi',
      jsonb_build_object('request_id', current_request.id, 'reference_code', current_request.reference_code, 'amount_try', current_request.amount_try)
    );
    return query
      select current_request.id, current_request.user_id, 'approved'::text, next_balance, p_credited_credits;
    return;
  end if;

  update public.bank_transfer_requests
     set status = 'rejected', admin_note = note, reviewed_by = auth.uid(), reviewed_at = now()
   where id = current_request.id;
  return query select current_request.id, current_request.user_id, 'rejected'::text, null::integer, null::integer;
end;
$$;

create or replace function public.purchase_profile_item(p_item_id text, p_request_id uuid)
returns table(balance integer, promo_balance integer, paid_balance integer)
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  item public.profile_item_catalog;
  promo_spent integer;
  paid_spent integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  if exists(select 1 from public.user_profile_items where user_id = auth.uid() and item_id = p_item_id) then
    select wallet.balance, wallet.promo_balance, wallet.paid_balance
      into balance, promo_balance, paid_balance
      from public.wallets as wallet
     where wallet.user_id = auth.uid();
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
  select wallet.promo_balance, wallet.paid_balance
    into promo_spent, paid_spent
    from public.wallets as wallet
   where wallet.user_id = auth.uid()
   for update;
  if not found then raise exception 'Wallet unavailable'; end if;
  if promo_spent + paid_spent < item.cost then raise exception 'Insufficient balance'; end if;
  promo_spent := least(promo_spent, item.cost);
  paid_spent := item.cost - promo_spent;
  update public.wallets as wallet
     set balance = wallet.balance - item.cost,
         promo_balance = wallet.promo_balance - promo_spent,
         paid_balance = wallet.paid_balance - paid_spent,
         updated_at = now()
   where wallet.user_id = auth.uid()
   returning wallet.balance, wallet.promo_balance, wallet.paid_balance
        into balance, promo_balance, paid_balance;
  insert into public.user_profile_items(user_id, item_id) values (auth.uid(), item.id);
  insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
  values (
    auth.uid(),
    -item.cost,
    'cosmetic_purchase',
    item.name,
    jsonb_build_object('item_id', item.id, 'promo_spent', promo_spent, 'paid_spent', paid_spent),
    p_request_id
  );
  return next;
end;
$$;

