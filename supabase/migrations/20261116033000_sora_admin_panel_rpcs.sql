-- Sora Admin Panel: Oyun geneli süreli/süresiz ban yaptırımı, 8 haneli ID ile sınırsız esneklikte
-- coin ekleme/düşürme, kullanıcı arama, oda/aile yönetimi ve moderasyon RPC'leri.

-- 1. Kullanıcıların kendi aktif yaptırım kaydını okuyabilmesi (uygulama içi anlık ban ekranı için)
drop policy if exists "user_sanctions_select_own" on public.user_sanctions;
create policy "user_sanctions_select_own"
on public.user_sanctions for select
to authenticated
using (user_id = auth.uid() or public.is_app_admin(auth.uid()));

-- 2. Ban ve susturma kontrolleri için sunucu tarafı yardımcı fonksiyonlar ve tetikleyiciler
create or replace function public.assert_user_not_banned(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sanction record;
begin
  if p_user_id is null then
    return;
  end if;

  select s.action, s.reason, s.expires_at
    into v_sanction
  from public.user_sanctions s
  where s.user_id = p_user_id
    and s.active = true
    and s.action in ('ban', 'suspend')
    and (s.expires_at is null or s.expires_at > now())
  order by (s.expires_at is null) desc, s.expires_at desc nulls first, s.created_at desc
  limit 1;

  if found then
    if v_sanction.expires_at is null then
      raise exception 'Account banned permanently: %', coalesce(v_sanction.reason, 'Kural ihlali');
    else
      raise exception 'Account suspended until %: %', to_char(v_sanction.expires_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI'), coalesce(v_sanction.reason, 'Kural ihlali');
    end if;
  end if;
end;
$$;

create or replace function public.enforce_not_banned_room_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'rooms' then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.state = 'live' and old.state is distinct from 'live') then
      perform public.assert_user_not_banned(new.host_id);
    end if;
  elsif tg_table_name = 'room_members' then
    perform public.assert_user_not_banned(new.user_id);
  elsif tg_table_name = 'communities' then
    perform public.assert_user_not_banned(new.owner_id);
  elsif tg_table_name = 'community_members' then
    perform public.assert_user_not_banned(new.user_id);
  elsif tg_table_name = 'family_messages' then
    perform public.assert_user_not_banned(new.sender_id);
    if exists (
      select 1 from public.user_sanctions s
      where s.user_id = new.sender_id
        and s.active = true
        and s.action = 'chat_mute'
        and (s.expires_at is null or s.expires_at > now())
    ) then
      raise exception 'Messaging is restricted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_not_banned_rooms on public.rooms;
create trigger trg_enforce_not_banned_rooms
before insert or update on public.rooms
for each row execute function public.enforce_not_banned_room_trigger();

drop trigger if exists trg_enforce_not_banned_room_members on public.room_members;
create trigger trg_enforce_not_banned_room_members
before insert on public.room_members
for each row execute function public.enforce_not_banned_room_trigger();

drop trigger if exists trg_enforce_not_banned_communities on public.communities;
create trigger trg_enforce_not_banned_communities
before insert on public.communities
for each row execute function public.enforce_not_banned_room_trigger();

drop trigger if exists trg_enforce_not_banned_community_members on public.community_members;
create trigger trg_enforce_not_banned_community_members
before insert on public.community_members
for each row execute function public.enforce_not_banned_room_trigger();

drop trigger if exists trg_enforce_not_banned_family_messages on public.family_messages;
create trigger trg_enforce_not_banned_family_messages
before insert on public.family_messages
for each row execute function public.enforce_not_banned_room_trigger();

-- Kullanıcının kendi aktif ban/askıya alma durumunu sorgulaması
create or replace function public.get_my_active_sanction()
returns table (
  sanction_id uuid,
  action text,
  reason text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.action, s.reason, s.expires_at, s.created_at
  from public.user_sanctions s
  where s.user_id = auth.uid()
    and s.active = true
    and s.action in ('ban', 'suspend')
    and (s.expires_at is null or s.expires_at > now())
  order by (s.expires_at is null) desc, s.expires_at desc nulls first, s.created_at desc
  limit 1;
$$;

grant execute on function public.get_my_active_sanction() to authenticated;

-- 3. Kimlik çözücü: 8 haneli public_id, @handle veya UUID kabul eder
create or replace function public.admin_resolve_user_id(p_identifier text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text := trim(coalesce(p_identifier, ''));
  v_handle text;
  v_uid uuid;
begin
  if v_clean = '' then
    return null;
  end if;

  -- Önce tam 8 haneli özel ID eşleşmesi
  if v_clean ~ '^[0-9]{8}$' then
    select p.id into v_uid
    from public.profiles p
    where p.public_id = v_clean
    limit 1;
    if v_uid is not null then
      return v_uid;
    end if;
  end if;

  -- UUID eşleşmesi
  if v_clean ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select p.id into v_uid
    from public.profiles p
    where p.id = v_clean::uuid
    limit 1;
    if v_uid is not null then
      return v_uid;
    end if;
  end if;

  -- @handle eşleşmesi
  v_handle := lower(regexp_replace(v_clean, '^@+', ''));
  select p.id into v_uid
  from public.profiles p
  where lower(p.handle) = v_handle
  limit 1;

  return v_uid;
end;
$$;

-- 4. Admin Panel Genel Bakış Özeti
create or replace function public.admin_dashboard_summary()
returns table (
  total_users bigint,
  total_coins bigint,
  live_rooms bigint,
  total_families bigint,
  active_bans bigint,
  active_mutes bigint,
  open_reports bigint,
  pending_transfers bigint,
  pending_backgrounds bigint,
  my_role text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;
  select a.role into v_role from public.app_admins a where a.user_id = auth.uid();

  return query
  select
    (select count(*) from public.profiles),
    coalesce((select sum(w.balance::bigint) from public.wallets w), 0::bigint),
    (select count(*) from public.rooms r where r.state = 'live'),
    (select count(*) from public.communities),
    (select count(*) from public.user_sanctions s where s.active and s.action in ('ban', 'suspend') and (s.expires_at is null or s.expires_at > now())),
    (select count(*) from public.user_sanctions s where s.active and s.action = 'chat_mute' and (s.expires_at is null or s.expires_at > now())),
    (select count(*) from public.safety_reports sr where sr.status in ('open', 'reviewing')),
    (select count(*) from public.bank_transfer_requests bt where bt.status = 'awaiting_transfer'),
    (select count(*) from public.room_background_requests rb where rb.status = 'pending'),
    coalesce(v_role, 'admin');
end;
$$;

-- 5. Kullanıcı Arama ve Detay Listeleme (8 haneli ID, @handle, ad veya boş sorgu)
create or replace function public.admin_search_users(
  p_query text default '',
  p_limit integer default 60
)
returns table (
  user_id uuid,
  public_id text,
  handle text,
  display_name text,
  bio text,
  avatar_url text,
  user_level integer,
  user_xp bigint,
  balance integer,
  promo_balance integer,
  paid_balance integer,
  family_name text,
  family_code text,
  admin_role text,
  active_sanction_id uuid,
  active_sanction_action text,
  active_sanction_reason text,
  active_sanction_expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_clean_handle text := lower(regexp_replace(v_q, '^@+', ''));
  v_lim integer := greatest(1, least(coalesce(p_limit, 60), 200));
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    p.id as user_id,
    coalesce(p.public_id, '') as public_id,
    p.handle,
    p.display_name,
    coalesce(p.bio, '') as bio,
    p.avatar_url,
    coalesce(p.user_level, 1) as user_level,
    coalesce(p.user_xp, 0::bigint) as user_xp,
    coalesce(w.balance, 0) as balance,
    coalesce(w.promo_balance, 0) as promo_balance,
    coalesce(w.paid_balance, 0) as paid_balance,
    c.name as family_name,
    c.family_code as family_code,
    aa.role as admin_role,
    us.id as active_sanction_id,
    us.action as active_sanction_action,
    us.reason as active_sanction_reason,
    us.expires_at as active_sanction_expires_at,
    p.created_at
  from public.profiles p
  left join public.wallets w on w.user_id = p.id
  left join lateral (
    select cm.community_id
    from public.community_members cm
    where cm.user_id = p.id
    limit 1
  ) cm_one on true
  left join public.communities c on c.id = cm_one.community_id
  left join public.app_admins aa on aa.user_id = p.id
  left join lateral (
    select s.id, s.action, s.reason, s.expires_at
    from public.user_sanctions s
    where s.user_id = p.id
      and s.active = true
      and (s.expires_at is null or s.expires_at > now())
    order by
      case s.action when 'ban' then 1 when 'suspend' then 2 when 'chat_mute' then 3 else 4 end,
      (s.expires_at is null) desc,
      s.expires_at desc nulls first,
      s.created_at desc
    limit 1
  ) us on true
  where
    v_q = ''
    or p.public_id = v_q
    or p.public_id ilike ('%' || v_q || '%')
    or lower(p.handle) ilike ('%' || v_clean_handle || '%')
    or p.display_name ilike ('%' || v_q || '%')
    or p.id::text = lower(v_q)
  order by
    case
      when v_q <> '' and p.public_id = v_q then 0
      when v_q <> '' and lower(p.handle) = v_clean_handle then 1
      when v_q <> '' and p.id::text = lower(v_q) then 2
      else 3
    end,
    p.created_at desc
  limit v_lim;
end;
$$;

-- 6. 8 Haneli ID / @handle / UUID ile Coin Ekleme veya Düşürme
create or replace function public.admin_adjust_user_coins(
  p_identifier text,
  p_delta bigint,
  p_bucket text default 'promo',
  p_note text default '',
  p_idempotency_key uuid default null
)
returns table (
  target_user_id uuid,
  public_id text,
  display_name text,
  handle text,
  applied_delta integer,
  balance integer,
  promo_balance integer,
  paid_balance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_target_id uuid;
  v_bucket text := lower(trim(coalesce(p_bucket, 'promo')));
  v_clean_note text := left(trim(coalesce(p_note, '')), 100);
  v_wallet public.wallets;
  v_new_promo bigint;
  v_new_paid bigint;
  v_new_total bigint;
  v_applied integer;
  v_desc text;
  v_existing_tx record;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();
  if v_actor_role not in ('admin', 'owner') then
    raise exception 'Admin or owner permission required';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Invalid credit amount';
  end if;

  if abs(p_delta) > 2140000000 then
    raise exception 'Tek seferde en fazla 2.140.000.000 coin eklenebilir veya düşülebilir';
  end if;

  if v_bucket not in ('promo', 'paid') then
    raise exception 'Invalid wallet bucket';
  end if;

  v_target_id := public.admin_resolve_user_id(p_identifier);
  if v_target_id is null then
    raise exception 'User not found';
  end if;

  insert into public.wallets (user_id)
  values (v_target_id)
  on conflict (user_id) do nothing;

  select * into v_wallet
  from public.wallets w
  where w.user_id = v_target_id
  for update;

  if p_idempotency_key is not null then
    select wt.amount into v_existing_tx
    from public.wallet_transactions wt
    where wt.user_id = v_target_id
      and wt.idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return query
      select
        p.id,
        coalesce(p.public_id, ''),
        p.display_name,
        p.handle,
        v_existing_tx.amount,
        v_wallet.balance,
        v_wallet.promo_balance,
        v_wallet.paid_balance
      from public.profiles p
      where p.id = v_target_id;
      return;
    end if;
  end if;

  if p_delta > 0 then
    if (v_wallet.balance::bigint + p_delta) > 2140000000 then
      raise exception 'Cüzdan üst sınırı (2.140.000.000 coin) aşılıyor; mevcut bakiye: %', v_wallet.balance;
    end if;
    if v_bucket = 'paid' then
      v_new_paid := v_wallet.paid_balance::bigint + p_delta;
      v_new_promo := v_wallet.promo_balance::bigint;
    else
      v_new_promo := v_wallet.promo_balance::bigint + p_delta;
      v_new_paid := v_wallet.paid_balance::bigint;
    end if;
  else
    -- Coin düşürme: önce seçilen kovadan, yetmezse diğer kovadan düş (0 altına inmez)
    declare
      v_remove bigint := least(v_wallet.balance::bigint, abs(p_delta));
      v_from_first bigint;
      v_from_second bigint;
    begin
      if v_remove <= 0 then
        raise exception 'Kullanıcının bakiyesi zaten 0 coin';
      end if;
      if v_bucket = 'paid' then
        v_from_first := least(v_wallet.paid_balance::bigint, v_remove);
        v_from_second := v_remove - v_from_first;
        v_new_paid := v_wallet.paid_balance::bigint - v_from_first;
        v_new_promo := greatest(0, v_wallet.promo_balance::bigint - v_from_second);
      else
        v_from_first := least(v_wallet.promo_balance::bigint, v_remove);
        v_from_second := v_remove - v_from_first;
        v_new_promo := v_wallet.promo_balance::bigint - v_from_first;
        v_new_paid := greatest(0, v_wallet.paid_balance::bigint - v_from_second);
      end if;
    end;
  end if;

  v_new_total := v_new_promo + v_new_paid;
  v_applied := (v_new_total - v_wallet.balance::bigint)::integer;

  if v_applied = 0 then
    raise exception 'Bakiye değişmedi';
  end if;

  update public.wallets w
  set promo_balance = v_new_promo::integer,
      paid_balance = v_new_paid::integer,
      balance = v_new_total::integer,
      updated_at = now()
  where w.user_id = v_target_id
  returning * into v_wallet;

  v_desc := case
    when v_clean_note <> '' then left(
      (case when v_applied > 0 then 'Yönetici coin ekleme: ' else 'Yönetici coin düşümü: ' end) || v_clean_note,
      120
    )
    when v_applied > 0 then 'Yönetici tarafından coin tanımlandı'
    else 'Yönetici tarafından coin düşüldü'
  end;

  insert into public.wallet_transactions (user_id, amount, type, description, metadata, idempotency_key)
  values (
    v_target_id,
    v_applied,
    'promo_grant',
    v_desc,
    jsonb_build_object(
      'admin_id', auth.uid(),
      'bucket', v_bucket,
      'admin_adjustment', true
    ),
    p_idempotency_key
  );

  return query
  select
    p.id,
    coalesce(p.public_id, ''),
    p.display_name,
    p.handle,
    v_applied,
    v_wallet.balance,
    v_wallet.promo_balance,
    v_wallet.paid_balance
  from public.profiles p
  where p.id = v_target_id;
end;
$$;

-- 7. Oyundan Süreli veya Süresiz Banlama / Susturma / Uyarı Uygulama
create or replace function public.admin_apply_user_sanction(
  p_identifier text,
  p_action text,
  p_duration_minutes integer default null,
  p_reason text default ''
)
returns table (
  sanction_id uuid,
  target_user_id uuid,
  public_id text,
  display_name text,
  handle text,
  action text,
  reason text,
  expires_at timestamptz,
  is_permanent boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_target_id uuid;
  v_target_role text;
  v_action text := lower(trim(coalesce(p_action, 'ban')));
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_expires timestamptz := null;
  v_inserted public.user_sanctions;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();

  if v_action not in ('ban', 'suspend', 'chat_mute', 'warning') then
    raise exception 'Invalid sanction action';
  end if;

  if v_actor_role = 'moderator' and v_action in ('ban', 'suspend') then
    raise exception 'Admin or owner permission required';
  end if;

  v_target_id := public.admin_resolve_user_id(p_identifier);
  if v_target_id is null then
    raise exception 'User not found';
  end if;

  if v_target_id = auth.uid() then
    raise exception 'Kendi hesabınıza ban uygulayamazsınız';
  end if;

  select a.role into v_target_role from public.app_admins a where a.user_id = v_target_id;
  if v_target_role = 'owner' then
    raise exception 'Kurucu (owner) hesabına yaptırım uygulanamaz';
  end if;

  if char_length(v_reason) < 3 then
    v_reason := case v_action
      when 'ban' then 'Yönetici kararıyla oyundan yasaklandı'
      when 'suspend' then 'Yönetici kararıyla geçici olarak uzaklaştırıldı'
      when 'chat_mute' then 'Yönetici kararıyla sohbeti kısıtlandı'
      else 'Yönetici uyarısı'
    end;
  end if;

  if p_duration_minutes is not null and p_duration_minutes > 0 then
    v_expires := now() + make_interval(mins => least(p_duration_minutes, 5256000));
  else
    v_expires := null;
  end if;

  -- Önceki aynı tip aktif yaptırımları kapat ki tek net kayıt aktif kalsın
  if v_action in ('ban', 'suspend') then
    update public.user_sanctions s
    set active = false
    where s.user_id = v_target_id
      and s.active = true
      and s.action in ('ban', 'suspend');
  elsif v_action = 'chat_mute' then
    update public.user_sanctions s
    set active = false
    where s.user_id = v_target_id
      and s.active = true
      and s.action = 'chat_mute';
  end if;

  insert into public.user_sanctions (user_id, action, reason, expires_at, active, created_by)
  values (v_target_id, v_action, v_reason, v_expires, true, auth.uid())
  returning * into v_inserted;

  -- Ban veya askıya alma durumunda kullanıcının açık odalarını hemen kapat ve odalardan çıkar
  if v_action in ('ban', 'suspend') then
    update public.rooms r
    set state = 'inactive',
        listener_count = 0,
        updated_at = now()
    where r.host_id = v_target_id
      and r.state in ('live', 'scheduled');

    delete from public.room_members rm
    where rm.user_id = v_target_id;
  end if;

  return query
  select
    v_inserted.id,
    p.id,
    coalesce(p.public_id, ''),
    p.display_name,
    p.handle,
    v_inserted.action,
    v_inserted.reason,
    v_inserted.expires_at,
    (v_inserted.expires_at is null)
  from public.profiles p
  where p.id = v_target_id;
end;
$$;

-- 8. Ban / Ceza Kaldırma (Unban)
create or replace function public.admin_revoke_user_sanctions(
  p_identifier text default null,
  p_sanction_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_id uuid;
  v_count integer := 0;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  if p_sanction_id is not null then
    update public.user_sanctions s
    set active = false
    where s.id = p_sanction_id
      and s.active = true;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  v_target_id := public.admin_resolve_user_id(p_identifier);
  if v_target_id is null then
    raise exception 'User not found';
  end if;

  update public.user_sanctions s
  set active = false
  where s.user_id = v_target_id
    and s.active = true;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

-- 9. Aktif / Geçmiş Ban ve Ceza Listesi
create or replace function public.admin_list_sanctions(
  p_only_active boolean default true,
  p_limit integer default 100
)
returns table (
  sanction_id uuid,
  user_id uuid,
  public_id text,
  display_name text,
  handle text,
  action text,
  reason text,
  expires_at timestamptz,
  active boolean,
  admin_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    s.id as sanction_id,
    s.user_id,
    coalesce(p.public_id, '') as public_id,
    coalesce(p.display_name, 'Silinmiş kullanıcı') as display_name,
    coalesce(p.handle, 'silindi') as handle,
    s.action,
    s.reason,
    s.expires_at,
    (s.active and (s.expires_at is null or s.expires_at > now())) as active,
    coalesce(ap.display_name, 'Yönetici') as admin_name,
    s.created_at
  from public.user_sanctions s
  left join public.profiles p on p.id = s.user_id
  left join public.profiles ap on ap.id = s.created_by
  where
    not coalesce(p_only_active, true)
    or (s.active = true and (s.expires_at is null or s.expires_at > now()))
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
end;
$$;

-- 10. Kullanıcının Son Coin Hareketleri
create or replace function public.admin_list_user_transactions(
  p_identifier text,
  p_limit integer default 40
)
returns table (
  tx_id uuid,
  amount integer,
  tx_type text,
  description text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  v_uid := public.admin_resolve_user_id(p_identifier);
  if v_uid is null then
    raise exception 'User not found';
  end if;

  return query
  select
    wt.id as tx_id,
    wt.amount,
    wt.type as tx_type,
    wt.description,
    wt.created_at
  from public.wallet_transactions wt
  where wt.user_id = v_uid
  order by wt.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$$;

-- 11. Kullanıcı Seviyesini Doğrudan Ayarlama
create or replace function public.admin_set_user_level(
  p_identifier text,
  p_level integer
)
returns table (
  target_user_id uuid,
  public_id text,
  display_name text,
  user_level integer,
  user_xp bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_uid uuid;
  v_lvl integer := greatest(1, least(coalesce(p_level, 1), 120));
  v_xp bigint;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  select a.role into v_actor_role from public.app_admins a where a.user_id = auth.uid();
  if v_actor_role not in ('admin', 'owner') then
    raise exception 'Admin or owner permission required';
  end if;

  v_uid := public.admin_resolve_user_id(p_identifier);
  if v_uid is null then
    raise exception 'User not found';
  end if;

  v_xp := case when v_lvl <= 1 then 0::bigint else (250::bigint * (v_lvl - 1)::bigint * v_lvl::bigint) end;

  update public.profiles p
  set user_level = v_lvl,
      user_xp = v_xp,
      updated_at = now()
  where p.id = v_uid;

  return query
  select p.id, coalesce(p.public_id, ''), p.display_name, p.user_level, p.user_xp
  from public.profiles p
  where p.id = v_uid;
end;
$$;

-- 12. Odaları Listeleme ve Yönetme (Kapatma / Kilit / Silme)
create or replace function public.admin_list_rooms(
  p_state text default 'all'
)
returns table (
  room_id uuid,
  title text,
  category text,
  state text,
  listener_count integer,
  room_locked boolean,
  chat_locked boolean,
  host_id uuid,
  host_public_id text,
  host_name text,
  host_handle text,
  last_active_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    r.id as room_id,
    r.title,
    r.category,
    r.state,
    r.listener_count,
    r.room_locked,
    r.chat_locked,
    r.host_id,
    coalesce(p.public_id, '') as host_public_id,
    coalesce(p.display_name, 'Bilinmeyen') as host_name,
    coalesce(p.handle, '') as host_handle,
    r.last_active_at,
    r.created_at
  from public.rooms r
  left join public.profiles p on p.id = r.host_id
  where
    coalesce(p_state, 'all') = 'all'
    or r.state = p_state
  order by
    (r.state = 'live') desc,
    r.last_active_at desc nulls last
  limit 150;
end;
$$;

create or replace function public.admin_manage_room(
  p_room_id uuid,
  p_action text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_act text := lower(trim(coalesce(p_action, '')));
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  if v_act = 'close' then
    update public.rooms
    set state = 'inactive', listener_count = 0, updated_at = now()
    where id = p_room_id;
    delete from public.room_members where room_id = p_room_id;
    return 'closed';
  elsif v_act = 'toggle_chat' then
    update public.rooms
    set chat_locked = not chat_locked, updated_at = now()
    where id = p_room_id;
    return 'toggled_chat';
  elsif v_act = 'toggle_lock' then
    update public.rooms
    set room_locked = not room_locked, updated_at = now()
    where id = p_room_id;
    return 'toggled_lock';
  elsif v_act = 'delete' then
    delete from public.rooms where id = p_room_id;
    return 'deleted';
  else
    raise exception 'Invalid room action';
  end if;
end;
$$;

-- 13. Aileleri Listeleme ve Yönetme (XP Ekleme / Silme)
create or replace function public.admin_list_families()
returns table (
  family_id uuid,
  family_code text,
  name text,
  description text,
  level integer,
  xp bigint,
  gift_coins_total bigint,
  member_count bigint,
  owner_id uuid,
  owner_public_id text,
  owner_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    c.id as family_id,
    coalesce(c.family_code, '') as family_code,
    c.name,
    coalesce(c.description, '') as description,
    coalesce(c.level, 1) as level,
    coalesce(c.xp, 0::bigint) as xp,
    coalesce(c.gift_coins_total, 0::bigint) as gift_coins_total,
    (select count(*) from public.community_members cm where cm.community_id = c.id) as member_count,
    c.owner_id,
    coalesce(p.public_id, '') as owner_public_id,
    coalesce(p.display_name, 'Bilinmeyen') as owner_name,
    c.created_at
  from public.communities c
  left join public.profiles p on p.id = c.owner_id
  order by c.level desc, c.xp desc, c.created_at desc
  limit 150;
end;
$$;

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

    v_new_level := public.calculate_family_level_from_xp(v_new_xp);
    update public.communities c
    set level = v_new_level
    where c.id = p_family_id;

    perform public.grant_family_level_rewards_for_community(p_family_id, v_new_level);
    return 'xp_updated';
  elsif v_act = 'delete' then
    delete from public.communities where id = p_family_id;
    return 'deleted';
  else
    raise exception 'Invalid family action';
  end if;
end;
$$;

-- 14. Güvenlik Raporlarını Zengin Bilgilerle Listeleme
create or replace function public.admin_list_safety_reports(
  p_status text default 'open'
)
returns table (
  report_id uuid,
  category text,
  details text,
  status text,
  resolution text,
  reporter_public_id text,
  reporter_name text,
  target_user_id uuid,
  target_public_id text,
  target_name text,
  target_handle text,
  room_title text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    sr.id as report_id,
    sr.category,
    sr.details,
    sr.status,
    sr.resolution,
    coalesce(rp.public_id, '') as reporter_public_id,
    coalesce(rp.display_name, 'Kullanıcı') as reporter_name,
    sr.target_user_id,
    coalesce(tp.public_id, '') as target_public_id,
    coalesce(tp.display_name, 'Belirtilmedi') as target_name,
    coalesce(tp.handle, '') as target_handle,
    coalesce(rm.title, '') as room_title,
    sr.created_at
  from public.safety_reports sr
  left join public.profiles rp on rp.id = sr.reporter_id
  left join public.profiles tp on tp.id = sr.target_user_id
  left join public.rooms rm on rm.id = sr.room_id
  where
    coalesce(p_status, 'all') = 'all'
    or (p_status = 'open' and sr.status in ('open', 'reviewing'))
    or sr.status = p_status
  order by sr.created_at desc
  limit 120;
end;
$$;

-- 15. Engelli Sohbet Kelimeleri Yönetimi
create or replace function public.admin_list_moderation_terms()
returns table (
  term_id bigint,
  term text,
  enabled boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select mt.id, mt.term, mt.enabled, mt.created_at
  from public.moderation_terms mt
  order by mt.created_at desc;
end;
$$;

create or replace function public.admin_manage_moderation_term(
  p_action text,
  p_term text default '',
  p_term_id bigint default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_act text := lower(trim(coalesce(p_action, '')));
  v_clean text := lower(trim(coalesce(p_term, '')));
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required';
  end if;

  if v_act = 'add' then
    if char_length(v_clean) < 2 or char_length(v_clean) > 64 then
      raise exception 'Kelime 2 ile 64 karakter arasında olmalı';
    end if;
    insert into public.moderation_terms (term, enabled)
    values (v_clean, true)
    on conflict (term) do update set enabled = true;
    return 'added';
  elsif v_act = 'toggle' then
    update public.moderation_terms
    set enabled = not enabled
    where id = p_term_id;
    return 'toggled';
  elsif v_act = 'delete' then
    delete from public.moderation_terms where id = p_term_id;
    return 'deleted';
  else
    raise exception 'Invalid term action';
  end if;
end;
$$;

revoke all on function public.admin_resolve_user_id(text) from public, anon, authenticated;
grant execute on function public.admin_dashboard_summary() to authenticated;
grant execute on function public.admin_search_users(text, integer) to authenticated;
grant execute on function public.admin_adjust_user_coins(text, bigint, text, text, uuid) to authenticated;
grant execute on function public.admin_apply_user_sanction(text, text, integer, text) to authenticated;
grant execute on function public.admin_revoke_user_sanctions(text, uuid) to authenticated;
grant execute on function public.admin_list_sanctions(boolean, integer) to authenticated;
grant execute on function public.admin_list_user_transactions(text, integer) to authenticated;
grant execute on function public.admin_set_user_level(text, integer) to authenticated;
grant execute on function public.admin_list_rooms(text) to authenticated;
grant execute on function public.admin_manage_room(uuid, text) to authenticated;
grant execute on function public.admin_list_families() to authenticated;
grant execute on function public.admin_manage_family(uuid, text, bigint) to authenticated;
grant execute on function public.admin_list_safety_reports(text) to authenticated;
grant execute on function public.admin_list_moderation_terms() to authenticated;
grant execute on function public.admin_manage_moderation_term(text, text, bigint) to authenticated;
