-- ============================================================================
-- Sora Voice: Aile Hediye Gönderim Hatası Düzeltmesi + Odada Adetli Hediye
-- 1) send_family_gift içinde award_family_gift_xp_internal tablo çıktısının
--    bigint değişkene doğrudan atanmasından kaynaklanan 22P02 hatasını düzeltir.
-- 2) send_room_gift fonksiyonuna p_quantity (1..99) desteği ekler.
-- 3) admin_manage_family fonksiyonunda seviye hesaplama ve ödül eşitlemeyi düzeltir.
-- ============================================================================

drop function if exists public.send_room_gift(uuid, text, uuid, uuid);

create or replace function public.send_room_gift(
  p_room_id uuid,
  p_gift_id text,
  p_recipient_id uuid,
  p_request_id uuid,
  p_quantity integer default 1
)
returns table (
  balance integer,
  message_id uuid,
  message_body text,
  gift_name text,
  gift_cost integer,
  promo_balance integer,
  paid_balance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g public.gift_catalog;
  v_qty integer := coalesce(p_quantity, 1);
  v_total_cost bigint;
  total integer;
  promo_spent integer;
  paid_spent integer;
  sender_name text;
  recipient_name text;
  new_message public.room_messages;
  prior public.wallet_transactions;
  v_sender_family_id uuid;
  v_sender_family_level integer;
  v_user_xp_gain bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  if v_qty < 1 or v_qty > 999 then raise exception 'Invalid gift quantity'; end if;

  select * into prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = auth.uid();

  if found then
    return query
    select
      w.balance,
      (prior.metadata->>'message_id')::uuid,
      coalesce((select m.body from public.room_messages m where m.id = (prior.metadata->>'message_id')::uuid), ''),
      coalesce(prior.metadata->>'gift_name', 'Hediye'),
      abs(prior.amount),
      w.promo_balance,
      w.paid_balance
    from public.wallets w
    where w.user_id = auth.uid();
    return;
  end if;

  select * into g from public.gift_catalog where id = p_gift_id and active;
  if not found then raise exception 'Gift is unavailable'; end if;
  if p_recipient_id is null then raise exception 'Invalid recipient'; end if;

  v_total_cost := (g.cost::bigint) * (v_qty::bigint);
  if v_total_cost <= 0 or v_total_cost > 2000000000 then
    raise exception 'Invalid gift total';
  end if;

  select cm.community_id, c.level
    into v_sender_family_id, v_sender_family_level
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  where cm.user_id = auth.uid();

  if coalesce(g.min_family_level, 0) > 0 and coalesce(v_sender_family_level, 0) < g.min_family_level then
    raise exception 'Family level required';
  end if;

  if p_recipient_id = auth.uid() then
    if not exists(
      select 1 from public.rooms r
      join public.room_members s on s.room_id = r.id
      where r.id = p_room_id and r.state = 'live'
        and s.user_id = auth.uid() and s.removed_at is null
    ) then
      raise exception 'Room membership required';
    end if;
  else
    if not exists(
      select 1 from public.rooms r
      join public.room_members s on s.room_id = r.id
      join public.room_members t on t.room_id = r.id
      where r.id = p_room_id and r.state = 'live'
        and s.user_id = auth.uid() and s.removed_at is null
        and t.user_id = p_recipient_id and t.removed_at is null
        and not public.users_blocked(auth.uid(), p_recipient_id)
    ) then
      raise exception 'Room membership required';
    end if;
  end if;

  insert into public.wallets(user_id) values (auth.uid()) on conflict(user_id) do nothing;
  select w.balance, w.promo_balance into total, promo_spent
  from public.wallets w
  where w.user_id = auth.uid()
  for update;

  if total < v_total_cost then raise exception 'Insufficient balance'; end if;
  promo_spent := least(promo_spent, v_total_cost::integer);
  paid_spent := (v_total_cost::integer) - promo_spent;

  update public.wallets w
  set balance = w.balance - (v_total_cost::integer),
      promo_balance = w.promo_balance - promo_spent,
      paid_balance = w.paid_balance - paid_spent,
      updated_at = now()
  where w.user_id = auth.uid();

  select display_name into sender_name from public.profiles where id = auth.uid();
  select display_name into recipient_name from public.profiles where id = p_recipient_id;

  insert into public.room_messages(room_id, sender_id, body, kind, metadata)
  values (
    p_room_id,
    auth.uid(),
    case
      when p_recipient_id = auth.uid() then
        coalesce(sender_name, 'Kullanıcı') || ' kendine ' ||
        case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
        g.name || ' hediyesi gönderdi!'
      else
        coalesce(sender_name, 'Kullanıcı') || ' -> ' || coalesce(recipient_name, 'Kullanıcı') || ': ' ||
        case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
        g.name || ' hediyesi gönderdi!'
    end,
    'gift',
    jsonb_build_object(
      'gift_id', g.id,
      'gift_name', g.name,
      'gift_icon', g.icon,
      'gift_color', g.color,
      'unit_cost', g.cost,
      'quantity', v_qty,
      'gift_cost', v_total_cost::integer,
      'recipient_id', p_recipient_id,
      'recipient_name', recipient_name
    )
  )
  returning * into new_message;

  insert into public.wallet_transactions(user_id, amount, type, description, metadata, idempotency_key)
  values (
    auth.uid(),
    -(v_total_cost::integer),
    'gift',
    case when v_qty > 1 then v_qty::text || 'x ' else '' end || g.name || ' hediyesi',
    jsonb_build_object(
      'gift_id', g.id,
      'room_id', p_room_id,
      'recipient_id', p_recipient_id,
      'quantity', v_qty,
      'unit_cost', g.cost,
      'promo_spent', promo_spent,
      'paid_spent', paid_spent,
      'message_id', new_message.id,
      'gift_name', g.name
    ),
    p_request_id
  );

  if v_sender_family_id is not null then
    perform public.award_family_gift_xp_internal(
      v_sender_family_id,
      auth.uid(),
      'room_gift_sent',
      v_total_cost,
      'room_gift:' || p_request_id::text
    );
  end if;

  v_user_xp_gain := greatest(1::bigint, (v_total_cost / 1000::bigint));
  perform public.award_user_xp_internal(auth.uid(), v_user_xp_gain, 'room_gift:' || p_request_id::text);

  return query
  select w.balance, new_message.id, new_message.body, g.name, (v_total_cost::integer), w.promo_balance, w.paid_balance
  from public.wallets w
  where w.user_id = auth.uid();
end;
$$;

revoke all on function public.send_room_gift(uuid, text, uuid, uuid, integer) from public, anon;
grant execute on function public.send_room_gift(uuid, text, uuid, uuid, integer) to authenticated;

create or replace function public.send_family_gift(
  p_community_id uuid,
  p_gift_id text,
  p_recipient_id uuid,
  p_quantity integer default 1,
  p_request_id uuid default null
)
returns table (
  message_id uuid,
  message_body text,
  message_metadata jsonb,
  created_at timestamptz,
  balance integer,
  promo_balance integer,
  paid_balance integer,
  gift_name text,
  total_cost bigint,
  awarded_xp bigint,
  family_xp bigint,
  family_level integer,
  gift_coins_total bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_qty integer := coalesce(p_quantity, 1);
  v_gift public.gift_catalog;
  v_family public.communities;
  v_prior public.wallet_transactions;
  v_total_cost bigint;
  v_wallet_balance integer;
  v_wallet_promo integer;
  v_promo_spent integer;
  v_paid_spent integer;
  v_sender_name text;
  v_recipient_name text;
  v_recipient_avatar text;
  v_body text;
  v_meta jsonb;
  v_msg public.family_messages;
  v_xp bigint := 0;
  v_user_xp_gain bigint := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_community_id is null then
    raise exception 'Family not found';
  end if;
  if p_request_id is null then
    raise exception 'Request ID required';
  end if;
  if v_qty < 1 or v_qty > 999 then
    raise exception 'Invalid gift quantity';
  end if;

  select * into v_prior
  from public.wallet_transactions
  where idempotency_key = p_request_id and user_id = v_uid;

  if found then
    select * into v_msg
    from public.family_messages
    where id = (v_prior.metadata->>'family_message_id')::uuid;

    select * into v_family
    from public.communities
    where id = p_community_id;

    return query
    select
      v_msg.id,
      coalesce(v_msg.body, ''),
      coalesce(v_msg.metadata, '{}'::jsonb),
      coalesce(v_msg.created_at, v_prior.created_at),
      w.balance,
      w.promo_balance,
      w.paid_balance,
      coalesce(v_prior.metadata->>'gift_name', 'Hediye'),
      abs(v_prior.amount)::bigint,
      coalesce((v_prior.metadata->>'awarded_xp')::bigint, 0::bigint),
      coalesce(v_family.xp, 0::bigint),
      coalesce(v_family.level, 1),
      coalesce(v_family.gift_coins_total, 0::bigint)
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  select * into v_family
  from public.communities
  where id = p_community_id
  for update;

  if not found then
    raise exception 'Family not found';
  end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = v_uid
  ) then
    raise exception 'Family membership required';
  end if;

  if p_recipient_id is null then
    p_recipient_id := v_uid;
  end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = p_recipient_id
  ) then
    raise exception 'Recipient must be in the same family';
  end if;

  if p_recipient_id <> v_uid and public.users_blocked(v_uid, p_recipient_id) then
    raise exception 'Recipient unavailable';
  end if;

  if exists (
    select 1 from public.user_sanctions
    where user_id = v_uid
      and active
      and action in ('chat_mute', 'suspend', 'ban')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Messaging is restricted';
  end if;

  select * into v_gift
  from public.gift_catalog
  where id = p_gift_id and active;

  if not found then
    raise exception 'Gift is unavailable';
  end if;

  if coalesce(v_gift.min_family_level, 0) > coalesce(v_family.level, 1) then
    raise exception 'Family level required';
  end if;

  v_total_cost := (v_gift.cost::bigint) * (v_qty::bigint);
  if v_total_cost <= 0 or v_total_cost > 2000000000 then
    raise exception 'Invalid gift total';
  end if;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;

  select w.balance, w.promo_balance
    into v_wallet_balance, v_wallet_promo
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if v_wallet_balance < v_total_cost then
    raise exception 'Insufficient balance';
  end if;

  v_promo_spent := least(v_wallet_promo, v_total_cost::integer);
  v_paid_spent := (v_total_cost::integer) - v_promo_spent;

  update public.wallets w
  set balance = w.balance - (v_total_cost::integer),
      promo_balance = w.promo_balance - v_promo_spent,
      paid_balance = w.paid_balance - v_paid_spent,
      updated_at = now()
  where w.user_id = v_uid;

  select coalesce(a.awarded_xp, 0::bigint)
    into v_xp
  from public.award_family_gift_xp_internal(
    p_community_id,
    v_uid,
    'family_gift_sent',
    v_total_cost,
    'family_gift:' || p_request_id::text
  ) a;

  select display_name into v_sender_name from public.profiles where id = v_uid;
  select display_name, avatar_url
    into v_recipient_name, v_recipient_avatar
  from public.profiles
  where id = p_recipient_id;

  if p_recipient_id = v_uid then
    v_body := coalesce(v_sender_name, 'Üye') || ' kendine ' ||
      case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
      v_gift.name || ' hediyesi gönderdi.';
  else
    v_body := coalesce(v_sender_name, 'Üye') || ' -> ' || coalesce(v_recipient_name, 'Üye') || ' kişisine ' ||
      case when v_qty > 1 then v_qty::text || 'x ' else '' end ||
      v_gift.name || ' hediyesi gönderdi.';
  end if;

  v_meta := jsonb_build_object(
    'gift_id', v_gift.id,
    'gift_name', v_gift.name,
    'gift_icon', v_gift.icon,
    'gift_color', v_gift.color,
    'unit_cost', v_gift.cost,
    'quantity', v_qty,
    'total_cost', v_total_cost,
    'recipient_id', p_recipient_id,
    'recipient_name', coalesce(v_recipient_name, 'Üye'),
    'recipient_avatar_url', v_recipient_avatar,
    'self_gift', (p_recipient_id = v_uid),
    'awarded_xp', v_xp
  );

  insert into public.family_messages (community_id, sender_id, body, kind, metadata, client_message_id)
  values (p_community_id, v_uid, v_body, 'gift', v_meta, p_request_id)
  returning * into v_msg;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_uid,
    -(v_total_cost::integer),
    'gift',
    'Aile hediyesi: ' || case when v_qty > 1 then v_qty::text || 'x ' else '' end || v_gift.name,
    v_meta || jsonb_build_object(
      'community_id', p_community_id,
      'family_message_id', v_msg.id,
      'promo_spent', v_promo_spent,
      'paid_spent', v_paid_spent
    ),
    p_request_id
  );

  v_user_xp_gain := greatest(1::bigint, (v_total_cost / 1000::bigint));
  perform public.award_user_xp_internal(v_uid, v_user_xp_gain, 'family_gift:' || p_request_id::text);

  select * into v_family from public.communities where id = p_community_id;

  return query
  select
    v_msg.id,
    v_msg.body,
    v_msg.metadata,
    v_msg.created_at,
    w.balance,
    w.promo_balance,
    w.paid_balance,
    v_gift.name,
    v_total_cost,
    v_xp,
    v_family.xp,
    v_family.level,
    v_family.gift_coins_total
  from public.wallets w
  where w.user_id = v_uid;
end;
$$;

revoke all on function public.send_family_gift(uuid, text, uuid, integer, uuid) from public, anon;
grant execute on function public.send_family_gift(uuid, text, uuid, integer, uuid) to authenticated;

create or replace function public.admin_manage_family(
  p_family_id uuid,
  p_action text,
  p_xp_delta bigint default 0
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_act text := lower(trim(coalesce(p_action, '')));
  v_new_xp bigint;
  v_new_level integer;
  v_member record;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();
  if v_actor_role not in ('admin', 'owner') then
    raise exception 'Admin or owner permission required';
  end if;

  if v_act = 'add_xp' then
    update public.communities c
    set xp = greatest(0::bigint, coalesce(c.xp, 0::bigint) + coalesce(p_xp_delta, 0::bigint)),
        updated_at = now()
    where c.id = p_family_id
    returning c.xp into v_new_xp;

    if v_new_xp is null then
      raise exception 'Family not found';
    end if;

    v_new_level := public.calculate_family_level(v_new_xp);
    update public.communities c
    set level = v_new_level
    where c.id = p_family_id;

    for v_member in
      select cm.user_id from public.community_members cm where cm.community_id = p_family_id
    loop
      perform public.sync_family_rewards_for_user(p_family_id, v_member.user_id);
    end loop;

    return 'xp_updated';
  elsif v_act = 'delete' then
    delete from public.communities where id = p_family_id;
    return 'deleted';
  else
    raise exception 'Invalid family action';
  end if;
end;
$$;

revoke all on function public.admin_manage_family(uuid, text, bigint) from public, anon;
grant execute on function public.admin_manage_family(uuid, text, bigint) to authenticated;

notify pgrst, 'reload schema';
