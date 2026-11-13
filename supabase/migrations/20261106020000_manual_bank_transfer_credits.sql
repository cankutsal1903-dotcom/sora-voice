-- Manual bank-transfer credit flow.
-- A user can create a request, but only an admin/owner can approve it and add credits.

create table if not exists public.bank_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  reference_code text unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_credits integer not null check (requested_credits between 1 and 1000000),
  amount_try numeric(12, 2) not null check (amount_try > 0 and amount_try <= 1000000),
  status text not null default 'awaiting_transfer' check (status in ('awaiting_transfer', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  credited_credits integer check (credited_credits is null or credited_credits between 1 and 1000000),
  admin_note text not null default '' check (char_length(admin_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (credited_credits is not null))
);

create index if not exists bank_transfer_requests_user_created_idx
  on public.bank_transfer_requests(user_id, created_at desc);
create index if not exists bank_transfer_requests_status_created_idx
  on public.bank_transfer_requests(status, created_at asc);

create or replace function public.prepare_bank_transfer_request()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.reference_code is null or btrim(new.reference_code) = '' then
    new.reference_code := 'SORA-' || upper(substr(replace(new.id::text, '-', ''), 1, 10));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists before_bank_transfer_request_write on public.bank_transfer_requests;
create trigger before_bank_transfer_request_write
  before insert or update on public.bank_transfer_requests
  for each row execute procedure public.prepare_bank_transfer_request();

alter table public.bank_transfer_requests enable row level security;

drop policy if exists "Users read their bank transfer requests" on public.bank_transfer_requests;
create policy "Users read their bank transfer requests" on public.bank_transfer_requests for select
  using (auth.uid() = user_id);

drop policy if exists "Admins read bank transfer requests" on public.bank_transfer_requests;
create policy "Admins read bank transfer requests" on public.bank_transfer_requests for select
  using (public.is_app_admin());

alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check
  check (type in ('daily_reward', 'gift', 'bank_transfer'));

create or replace function public.create_bank_transfer_request(
  p_requested_credits integer,
  p_amount_try numeric
)
returns public.bank_transfer_requests
language plpgsql
security definer set search_path = public
as $$
declare
  created_request public.bank_transfer_requests;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_requested_credits is null or p_requested_credits < 1 or p_requested_credits > 1000000 then
    raise exception 'Invalid requested credits';
  end if;
  if p_amount_try is null or p_amount_try <= 0 or p_amount_try > 1000000 then
    raise exception 'Invalid transfer amount';
  end if;
  if (
    select count(*) from public.bank_transfer_requests
    where user_id = auth.uid() and status = 'awaiting_transfer' and created_at > now() - interval '24 hours'
  ) >= 3 then
    raise exception 'Too many pending transfer requests';
  end if;

  insert into public.bank_transfer_requests (user_id, requested_credits, amount_try)
  values (auth.uid(), p_requested_credits, round(p_amount_try, 2))
  returning * into created_request;
  return created_request;
end;
$$;

create or replace function public.admin_list_bank_transfer_requests(p_status text default null)
returns table (
  id uuid,
  reference_code text,
  user_id uuid,
  requested_credits integer,
  amount_try numeric,
  status text,
  credited_credits integer,
  admin_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  requester_name text,
  requester_handle text
)
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  return query
  select request.id, request.reference_code, request.user_id, request.requested_credits, request.amount_try,
    request.status, request.credited_credits, request.admin_note, request.created_at, request.reviewed_at,
    profile.display_name, profile.handle
  from public.bank_transfer_requests request
  join public.profiles profile on profile.id = request.user_id
  where p_status is null or request.status = p_status
  order by case when request.status = 'awaiting_transfer' then 0 else 1 end, request.created_at asc
  limit 100;
end;
$$;

create or replace function public.admin_review_bank_transfer_request(
  p_request_id uuid,
  p_approved boolean,
  p_credited_credits integer default null,
  p_admin_note text default ''
)
returns table (request_id uuid, user_id uuid, status text, balance integer, credited_credits integer)
language plpgsql
security definer set search_path = public
as $$
declare
  current_request public.bank_transfer_requests;
  actor_role text;
  next_balance integer;
  note text := left(trim(coalesce(p_admin_note, '')), 500);
begin
  if not public.is_app_admin() then raise exception 'Admin access required'; end if;
  select role into actor_role from public.app_admins where user_id = auth.uid();
  if actor_role not in ('admin', 'owner') then raise exception 'Admin or owner permission required'; end if;

  select * into current_request from public.bank_transfer_requests where id = p_request_id for update;
  if current_request.id is null then raise exception 'Transfer request not found'; end if;
  if current_request.status <> 'awaiting_transfer' then raise exception 'Transfer request was already reviewed'; end if;

  if p_approved then
    if p_credited_credits is null or p_credited_credits < 1 or p_credited_credits > 1000000 then
      raise exception 'Invalid credit amount';
    end if;
    insert into public.wallets (user_id) values (current_request.user_id) on conflict (user_id) do nothing;
    update public.wallets
    set balance = balance + p_credited_credits, updated_at = now()
    where user_id = current_request.user_id
    returning wallets.balance into next_balance;
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
    return query select current_request.id, current_request.user_id, 'approved'::text, next_balance, p_credited_credits;
    return;
  end if;

  update public.bank_transfer_requests
  set status = 'rejected', admin_note = note, reviewed_by = auth.uid(), reviewed_at = now()
  where id = current_request.id;
  return query select current_request.id, current_request.user_id, 'rejected'::text, null::integer, null::integer;
end;
$$;

revoke execute on function public.create_bank_transfer_request(integer, numeric) from public;
revoke execute on function public.admin_list_bank_transfer_requests(text) from public;
revoke execute on function public.admin_review_bank_transfer_request(uuid, boolean, integer, text) from public;
grant execute on function public.create_bank_transfer_request(integer, numeric) to authenticated;
grant execute on function public.admin_list_bank_transfer_requests(text) to authenticated;
grant execute on function public.admin_review_bank_transfer_request(uuid, boolean, integer, text) to authenticated;
