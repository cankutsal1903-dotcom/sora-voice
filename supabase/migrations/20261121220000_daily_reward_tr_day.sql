-- Gunluk odul gunu Turkiye saatine gore (gorevler ile ayni: sora_today_tr).
-- Onceden UTC current_date kullaniliyordu; odul TR saatiyle 03:00'te yenileniyordu.
-- Govde 20261118005500 ile ayni, yalnizca gun hesabi degisti. Mevcut yetkiler (grant) korunur.

create or replace function public.claim_daily_reward(p_amount integer default 2000000)
returns table(balance integer, claimed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_daily_reward constant integer := 2000000;
  v_uid uuid := auth.uid();
  v_cur_balance integer;
  v_credit integer;
  v_next_balance integer;
  v_today date := public.sora_today_tr();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  perform p_amount;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  select w.balance into v_cur_balance
  from public.wallets w
  where w.user_id = v_uid
  for update;

  v_credit := greatest(0, least(c_daily_reward, 2140000000 - coalesce(v_cur_balance, 0)));

  update public.wallets w
  set promo_balance = w.promo_balance + v_credit,
      balance = w.balance + v_credit,
      last_daily_reward_at = v_today,
      updated_at = now()
  where w.user_id = v_uid
    and w.last_daily_reward_at is distinct from v_today
  returning w.balance into v_next_balance;

  if v_next_balance is null then
    select w.balance into v_next_balance from public.wallets w where w.user_id = v_uid;
    return query select v_next_balance, false;
    return;
  end if;

  if v_credit > 0 then
    insert into public.wallet_transactions (user_id, amount, type, description, metadata)
    values (
      v_uid,
      v_credit,
      'daily_reward',
      'Günlük giriş ödülü',
      jsonb_build_object('cashout', false, 'transferable', false, 'reward_amount', c_daily_reward)
    );
  end if;

  perform public.award_user_xp_internal(v_uid, 250, 'daily_reward:' || v_today::text);

  select w.balance into v_next_balance from public.wallets w where w.user_id = v_uid;
  return query select v_next_balance, true;
end;
$$;
