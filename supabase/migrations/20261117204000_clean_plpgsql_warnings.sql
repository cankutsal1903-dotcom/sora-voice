-- PL/pgSQL lint temizliği: davranış değiştirmeden kullanılmayan/shadow edilen
-- değişkenleri kaldırır. Özellikle istemciye açık genel harcama RPC'si bilinçli
-- olarak reddedilmeye devam eder.

create or replace function public.spend_wallet_credit(
  p_amount integer,
  p_description text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- İmzayı geriye dönük uyumlu tutarken lint'in parametreleri kullanılmıyor
  -- uyarısını sustur; bu RPC hiçbir koşulda bakiye harcamaz.
  perform p_amount;
  perform p_description;
  perform p_metadata;
  balance := null;
  raise exception 'Use a server-validated purchase or gift operation';
end;
$$;

create or replace function public.generate_unique_8digit_code(p_target text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate text;
  v_exists boolean;
begin
  for v_attempt in 1..64 loop
    v_candidate := (floor(random() * 90000000)::bigint + 10000000)::text;
    if p_target = 'profiles' then
      select exists(select 1 from public.profiles where public_id = v_candidate) into v_exists;
    elsif p_target = 'communities' then
      select exists(select 1 from public.communities where family_code = v_candidate) into v_exists;
    else
      raise exception 'Unsupported code target';
    end if;
    if not v_exists then
      return v_candidate;
    end if;
  end loop;
  raise exception 'Could not allocate unique 8-digit code';
end;
$$;

create or replace function public.award_user_xp_internal(
  p_user_id uuid,
  p_xp_delta bigint,
  p_event_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_xp bigint;
  v_new_level integer;
  v_reward integer;
  v_safe_credit integer;
  v_total_credited bigint := 0;
  v_inserted_level integer;
  v_cur_balance integer;
begin
  if p_user_id is null then
    return 0;
  end if;

  if coalesce(p_xp_delta, 0) > 0 then
    if p_event_key is not null then
      insert into public.user_xp_events (user_id, event_key, xp_delta)
      values (p_user_id, p_event_key, p_xp_delta)
      on conflict (user_id, event_key) do nothing;

      if not found then
        return 0;
      end if;
    end if;

    update public.profiles p
    set user_xp = p.user_xp + p_xp_delta,
        updated_at = now()
    where p.id = p_user_id
    returning p.user_xp into v_xp;
  else
    select p.user_xp into v_xp
    from public.profiles p
    where p.id = p_user_id
    for update;
  end if;

  if v_xp is null then
    return 0;
  end if;

  v_new_level := public.calculate_user_level_from_xp(v_xp);

  update public.profiles p
  set user_level = greatest(p.user_level, v_new_level)
  where p.id = p_user_id
  returning p.user_level into v_new_level;

  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  for v_lvl in 2..v_new_level by 2 loop
    v_reward := public.even_level_coin_reward(v_lvl);
    if v_reward > 0 then
      v_inserted_level := null;
      insert into public.user_level_reward_claims (user_id, level, coins_awarded, badge_tier)
      values (p_user_id, v_lvl, v_reward, public.user_badge_tier_for_level(v_lvl))
      on conflict (user_id, level) do nothing
      returning level into v_inserted_level;

      if v_inserted_level is not null then
        select w.balance into v_cur_balance
        from public.wallets w
        where w.user_id = p_user_id
        for update;

        v_safe_credit := greatest(0, least(v_reward, 2140000000 - coalesce(v_cur_balance, 0)));

        if v_safe_credit > 0 then
          update public.wallets w
          set promo_balance = w.promo_balance + v_safe_credit,
              balance = w.balance + v_safe_credit,
              updated_at = now()
          where w.user_id = p_user_id;

          insert into public.wallet_transactions (user_id, amount, type, description, metadata)
          values (
            p_user_id,
            v_safe_credit,
            'level_reward',
            'Seviye ' || v_lvl || ' ödülü',
            jsonb_build_object(
              'level', v_lvl,
              'badge_tier', public.user_badge_tier_for_level(v_lvl),
              'cashout', false,
              'transferable', false
            )
          );

          v_total_credited := v_total_credited + v_safe_credit;
        end if;
      end if;
    end if;
  end loop;

  return v_total_credited;
end;
$$;

create or replace function public.claim_daily_reward(p_amount integer default 2000000)
returns table (balance integer, claimed boolean)
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
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  -- p_amount geriye dönük API uyumluluğu için tutulur; ödül tutarı sunucuda sabittir.
  perform p_amount;

  insert into public.wallets (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select w.balance
    into v_cur_balance
  from public.wallets w
  where w.user_id = v_uid
  for update;

  v_credit := greatest(0, least(c_daily_reward, 2140000000 - coalesce(v_cur_balance, 0)));

  update public.wallets w
  set promo_balance = w.promo_balance + v_credit,
      balance = w.balance + v_credit,
      last_daily_reward_at = current_date,
      updated_at = now()
  where w.user_id = v_uid
    and w.last_daily_reward_at is distinct from current_date
  returning w.balance into v_next_balance;

  if v_next_balance is null then
    select w.balance into v_next_balance
    from public.wallets w
    where w.user_id = v_uid;
    return query select v_next_balance, false;
    return;
  end if;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata)
  values (
    v_uid,
    v_credit,
    'daily_reward',
    'Günlük giriş ödülü',
    jsonb_build_object('cashout', false, 'transferable', false, 'reward_amount', c_daily_reward)
  );

  perform public.award_user_xp_internal(v_uid, 250, 'daily_reward:' || current_date::text);

  select w.balance into v_next_balance
  from public.wallets w
  where w.user_id = v_uid;

  return query select v_next_balance, true;
end;
$$;

create or replace function public.create_family(
  p_name text,
  p_description text default '',
  p_avatar_url text default null,
  p_request_id uuid default null
)
returns table (
  family_id uuid,
  family_code text,
  balance integer,
  promo_balance integer,
  paid_balance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_family_cost constant integer := 10000000;
  v_uid uuid := auth.uid();
  v_clean_name text := trim(coalesce(p_name, ''));
  v_clean_desc text := trim(coalesce(p_description, ''));
  v_clean_avatar text := nullif(trim(coalesce(p_avatar_url, '')), '');
  v_prior public.wallet_transactions;
  v_existing_family public.communities;
  v_total integer;
  v_promo integer;
  v_promo_spent integer;
  v_paid_spent integer;
  v_created public.communities;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception 'Request ID required';
  end if;

  perform 1 from public.profiles where id = v_uid for update;

  select * into v_prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = v_uid;

  if found then
    select * into v_existing_family
    from public.communities
    where id = (v_prior.metadata->>'family_id')::uuid;

    select w.balance, w.promo_balance, w.paid_balance
      into balance, promo_balance, paid_balance
    from public.wallets w
    where w.user_id = v_uid;

    family_id := v_existing_family.id;
    family_code := v_existing_family.family_code;
    return next;
    return;
  end if;

  if exists (select 1 from public.community_members cm where cm.user_id = v_uid) then
    raise exception 'Already in a family';
  end if;
  if char_length(v_clean_name) < 3 or char_length(v_clean_name) > 40 then
    raise exception 'Family name must be between 3 and 40 characters';
  end if;
  if char_length(v_clean_desc) > 240 then
    raise exception 'Family description must be at most 240 characters';
  end if;
  if v_clean_avatar is not null and (char_length(v_clean_avatar) > 600 or v_clean_avatar !~ '^https?://') then
    raise exception 'Invalid avatar URL';
  end if;
  if exists (select 1 from public.communities c where lower(c.name) = lower(v_clean_name)) then
    raise exception 'Family name already taken';
  end if;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  select w.balance, w.promo_balance
    into v_total, v_promo
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if coalesce(v_total, 0) < c_family_cost then
    raise exception 'Insufficient balance';
  end if;

  v_promo_spent := least(coalesce(v_promo, 0), c_family_cost);
  v_paid_spent := c_family_cost - v_promo_spent;

  update public.wallets w
  set balance = w.balance - c_family_cost,
      promo_balance = w.promo_balance - v_promo_spent,
      paid_balance = w.paid_balance - v_paid_spent,
      updated_at = now()
  where w.user_id = v_uid
  returning w.balance, w.promo_balance, w.paid_balance
    into balance, promo_balance, paid_balance;

  for v_code_attempt in 1..8 loop
    begin
      insert into public.communities (owner_id, name, description, avatar_url, icon, theme_colors, xp, gift_coins_total, level, family_code)
      values (
        v_uid,
        v_clean_name,
        v_clean_desc,
        v_clean_avatar,
        'people',
        '["#2F80ED", "#1D4E89"]'::jsonb,
        0,
        0,
        1,
        public.generate_unique_8digit_code('communities')
      )
      returning * into v_created;
      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'communities_family_code_key' or v_code_attempt = 8 then
          raise;
        end if;
    end;
  end loop;

  insert into public.community_members (community_id, user_id, role)
  values (v_created.id, v_uid, 'owner')
  on conflict (community_id, user_id) do update set role = 'owner';

  insert into public.wallet_transactions (user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -c_family_cost,
    'family_create',
    v_clean_name || ' ailesi kuruldu',
    jsonb_build_object(
      'family_id', v_created.id,
      'family_code', v_created.family_code,
      'promo_spent', v_promo_spent,
      'paid_spent', v_paid_spent
    ),
    p_request_id
  );

  perform public.sync_family_rewards_for_user(v_created.id, v_uid);

  family_id := v_created.id;
  family_code := v_created.family_code;
  return next;
end;
$$;
