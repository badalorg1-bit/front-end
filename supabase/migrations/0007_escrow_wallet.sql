-- BADAL — simulated escrow wallet (competition demo)
-- Platform holds funds briefly, takes a % service fee on release, then
-- credits the remainder to the seller. No real payment gateway.

-- ---------------------------------------------------------------------------
-- 1) platform_settings — escrow fee % (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  id int primary key default 1 check (id = 1),
  escrow_fee_percent numeric not null default 5
    check (escrow_fee_percent >= 0 and escrow_fee_percent <= 50),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id, escrow_fee_percent)
values (1, 5)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

drop policy if exists "platform_settings_select" on public.platform_settings;
create policy "platform_settings_select"
  on public.platform_settings for select
  to authenticated, anon
  using (true);

-- ---------------------------------------------------------------------------
-- 2) wallet_balances
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_balances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance numeric not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.wallet_balances enable row level security;

drop policy if exists "wallet_balances_select_own" on public.wallet_balances;
create policy "wallet_balances_select_own"
  on public.wallet_balances for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "wallet_balances_select_admin" on public.wallet_balances;
create policy "wallet_balances_select_admin"
  on public.wallet_balances for select
  to authenticated
  using (has_min_role('moderator'));

-- ---------------------------------------------------------------------------
-- 3) wallet_transactions (ledger; amount sign = credit/debit)
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric not null,
  kind text not null check (
    kind in ('deposit', 'escrow_hold', 'escrow_release', 'escrow_refund', 'fee', 'admin_adjust')
  ),
  request_id uuid references public.listing_requests (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_tx_user_idx
  on public.wallet_transactions (user_id, created_at desc);

alter table public.wallet_transactions enable row level security;

drop policy if exists "wallet_tx_select_own" on public.wallet_transactions;
create policy "wallet_tx_select_own"
  on public.wallet_transactions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "wallet_tx_select_admin" on public.wallet_transactions;
create policy "wallet_tx_select_admin"
  on public.wallet_transactions for select
  to authenticated
  using (has_min_role('moderator'));

-- ---------------------------------------------------------------------------
-- 4) escrow_holds — one row per accepted rent/purchase request
-- ---------------------------------------------------------------------------
create table if not exists public.escrow_holds (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.listing_requests (id) on delete cascade,
  payer_id uuid not null references auth.users (id),
  payee_id uuid not null references auth.users (id),
  amount numeric not null check (amount > 0),
  fee_percent numeric not null check (fee_percent >= 0),
  fee_amount numeric not null check (fee_amount >= 0),
  net_amount numeric not null check (net_amount >= 0),
  status text not null default 'held' check (status in ('held', 'released', 'refunded')),
  held_at timestamptz not null default now(),
  released_at timestamptz,
  refunded_at timestamptz
);

create index if not exists escrow_payer_idx on public.escrow_holds (payer_id);
create index if not exists escrow_payee_idx on public.escrow_holds (payee_id);

alter table public.escrow_holds enable row level security;

drop policy if exists "escrow_select_party" on public.escrow_holds;
create policy "escrow_select_party"
  on public.escrow_holds for select
  to authenticated
  using (payer_id = auth.uid() or payee_id = auth.uid() or has_min_role('moderator'));

-- ---------------------------------------------------------------------------
-- 5) Helpers
-- ---------------------------------------------------------------------------
create or replace function public.get_escrow_fee_percent()
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select escrow_fee_percent from public.platform_settings where id = 1;
$$;

revoke execute on function public.get_escrow_fee_percent() from public, anon;
grant execute on function public.get_escrow_fee_percent() to authenticated, anon;

create or replace function public.get_wallet_balance(p_user_id uuid default null)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select balance from public.wallet_balances
     where user_id = coalesce(p_user_id, auth.uid())),
    0
  );
$$;

revoke execute on function public.get_wallet_balance(uuid) from public, anon;
grant execute on function public.get_wallet_balance(uuid) to authenticated;

create or replace function public.get_escrow_for_request(p_request_id uuid)
returns table (
  id uuid,
  status text,
  amount numeric,
  fee_percent numeric,
  fee_amount numeric,
  net_amount numeric,
  held_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, e.status, e.amount, e.fee_percent, e.fee_amount, e.net_amount,
         e.held_at, e.released_at, e.refunded_at
  from public.escrow_holds e
  where e.request_id = p_request_id
    and (
      e.payer_id = auth.uid()
      or e.payee_id = auth.uid()
      or has_min_role('moderator')
    );
$$;

revoke execute on function public.get_escrow_for_request(uuid) from public, anon;
grant execute on function public.get_escrow_for_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) RPC: buyer holds amount in escrow from their BADAL wallet
-- ---------------------------------------------------------------------------
create or replace function public.wallet_escrow_pay(p_request_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.listing_requests%rowtype;
  v_fee numeric;
  v_fee_amount numeric;
  v_net numeric;
  v_hold_id uuid;
begin
  select * into v_request from public.listing_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found';
  end if;
  if v_request.status <> 'accepted' then
    raise exception 'escrow pay only allowed on accepted requests';
  end if;
  if v_request.request_type not in ('rent', 'purchase') then
    raise exception 'escrow not applicable for swap';
  end if;
  if auth.uid() <> v_request.requester_id then
    raise exception 'only the requester can pay into escrow';
  end if;
  if exists (select 1 from public.escrow_holds where request_id = p_request_id) then
    raise exception 'escrow already exists for this request';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> floor(p_amount) then
    raise exception 'amount must be a positive integer';
  end if;

  v_fee := coalesce(public.get_escrow_fee_percent(), 5);
  v_fee_amount := floor(p_amount * v_fee / 100.0);
  v_net := p_amount - v_fee_amount;

  update public.wallet_balances
  set balance = balance - p_amount, updated_at = now()
  where user_id = v_request.requester_id;

  if not found then
    raise exception 'insufficient balance or no wallet';
  end if;

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_request.requester_id, -p_amount, 'escrow_hold', p_request_id, 'حجز المبلغ لدى بادال');

  insert into public.escrow_holds (
    request_id, payer_id, payee_id, amount, fee_percent, fee_amount, net_amount, status, held_at
  ) values (
    p_request_id, v_request.requester_id, v_request.owner_id, p_amount, v_fee, v_fee_amount, v_net,
    'held', now()
  ) returning id into v_hold_id;

  return jsonb_build_object(
    'hold_id', v_hold_id,
    'amount', p_amount,
    'fee_percent', v_fee,
    'fee_amount', v_fee_amount,
    'net_amount', v_net,
    'status', 'held'
  );
end;
$$;

revoke execute on function public.wallet_escrow_pay(uuid, numeric) from public, anon;
grant execute on function public.wallet_escrow_pay(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) RPC: owner confirms delivery → release escrow, take fee, credit seller
-- ---------------------------------------------------------------------------
create or replace function public.wallet_escrow_release(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.escrow_holds%rowtype;
begin
  select * into v_hold from public.escrow_holds where request_id = p_request_id for update;
  if not found then
    raise exception 'escrow hold not found';
  end if;
  if v_hold.status <> 'held' then
    raise exception 'escrow is not held';
  end if;
  if auth.uid() <> v_hold.payee_id and not has_min_role('moderator') then
    raise exception 'only the seller can release escrow';
  end if;

  insert into public.wallet_balances (user_id, balance, updated_at)
  values (v_hold.payee_id, v_hold.net_amount, now())
  on conflict (user_id)
  do update set balance = public.wallet_balances.balance + excluded.balance,
                updated_at = now();

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payee_id, v_hold.net_amount, 'escrow_release', p_request_id,
          format('تحويل بعد خصم عمولة بادال %s%%', v_hold.fee_percent));

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payee_id, -v_hold.fee_amount, 'fee', p_request_id,
          format('عمولة الخدمة %s%%', v_hold.fee_percent));

  update public.escrow_holds
  set status = 'released', released_at = now()
  where id = v_hold.id;

  update public.listing_requests
  set payer_confirmed_at = coalesce(payer_confirmed_at, now()),
      payee_confirmed_at = coalesce(payee_confirmed_at, now()),
      paid_at = coalesce(paid_at, now()),
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'status', 'released',
    'amount', v_hold.amount,
    'fee_amount', v_hold.fee_amount,
    'net_amount', v_hold.net_amount,
    'released_at', now()
  );
end;
$$;

revoke execute on function public.wallet_escrow_release(uuid) from public, anon;
grant execute on function public.wallet_escrow_release(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) RPC: owner (or admin) refunds held funds to the buyer
-- ---------------------------------------------------------------------------
create or replace function public.wallet_escrow_refund(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.escrow_holds%rowtype;
begin
  select * into v_hold from public.escrow_holds where request_id = p_request_id for update;
  if not found then
    raise exception 'escrow hold not found';
  end if;
  if v_hold.status <> 'held' then
    raise exception 'escrow is not held';
  end if;
  if auth.uid() <> v_hold.payee_id and not has_min_role('moderator') then
    raise exception 'only the seller or an admin can refund escrow';
  end if;

  insert into public.wallet_balances (user_id, balance, updated_at)
  values (v_hold.payer_id, v_hold.amount, now())
  on conflict (user_id)
  do update set balance = public.wallet_balances.balance + excluded.balance,
                updated_at = now();

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payer_id, v_hold.amount, 'escrow_refund', p_request_id, 'إعادة المبلغ المحجوز');

  update public.escrow_holds
  set status = 'refunded', refunded_at = now()
  where id = v_hold.id;

  return jsonb_build_object('status', 'refunded', 'amount', v_hold.amount);
end;
$$;

revoke execute on function public.wallet_escrow_refund(uuid) from public, anon;
grant execute on function public.wallet_escrow_refund(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Admin: set fee % + fund demo wallet + audit
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_escrow_fee(p_percent numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_min_role('admin') then
    raise exception 'admin only';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 50 then
    raise exception 'percent must be between 0 and 50';
  end if;
  update public.platform_settings
  set escrow_fee_percent = p_percent, updated_at = now()
  where id = 1;
  insert into public.admin_audit_log (actor_id, action, target_type, meta)
  values (auth.uid(), 'set_escrow_fee', 'platform_settings',
          jsonb_build_object('escrow_fee_percent', p_percent));
end;
$$;

revoke execute on function public.admin_set_escrow_fee(numeric) from public, anon;
grant execute on function public.admin_set_escrow_fee(numeric) to authenticated;

create or replace function public.admin_fund_wallet(p_user_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_min_role('admin') then
    raise exception 'admin only';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> floor(p_amount) then
    raise exception 'amount must be a positive integer';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user not found';
  end if;

  insert into public.wallet_balances (user_id, balance, updated_at)
  values (p_user_id, p_amount, now())
  on conflict (user_id)
  do update set balance = public.wallet_balances.balance + excluded.balance,
                updated_at = now();

  insert into public.wallet_transactions (user_id, amount, kind, note)
  values (p_user_id, p_amount, 'deposit', 'إيداع تجريبي من الإدارة');

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'fund_wallet', 'user', p_user_id,
          jsonb_build_object('amount', p_amount));
end;
$$;

revoke execute on function public.admin_fund_wallet(uuid, numeric) from public, anon;
grant execute on function public.admin_fund_wallet(uuid, numeric) to authenticated;
