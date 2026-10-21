-- BADAL 0018 — user wallet top-up (pay platform QR → upload screenshot → admin approves)
-- Depends on: 0007 (wallet_balances), 0008 (platform_settings badal_*), 0017.

-- ---------------------------------------------------------------------------
-- 1) wallet_topups table
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_egp numeric(10,2) not null check (amount_egp > 0 and amount_egp <= 100000),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  screenshot_path text,
  payment_method text not null default 'wallet_qr'
    check (payment_method in ('wallet_qr','instagram')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wallet_topups_user_idx on public.wallet_topups (user_id, created_at desc);
create index if not exists wallet_topups_status_idx on public.wallet_topups (status);

alter table public.wallet_topups enable row level security;

drop policy if exists "wallet_topups_select_own" on public.wallet_topups;
create policy "wallet_topups_select_own"
  on public.wallet_topups for select
  to authenticated
  using (auth.uid() = user_id or has_min_role('admin'));
-- no client insert/update/delete — RPCs only

-- ---------------------------------------------------------------------------
-- 2) RPC: user creates a top-up request
-- ---------------------------------------------------------------------------
create or replace function public.create_wallet_topup(
  p_amount_egp numeric,
  p_payment_method text default 'wallet_qr'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if public.is_user_banned(v_uid) then
    raise exception 'account is banned';
  end if;
  if p_amount_egp is null or p_amount_egp <= 0 or p_amount_egp > 100000 then
    raise exception 'invalid_amount';
  end if;
  if p_payment_method not in ('wallet_qr', 'instagram') then
    raise exception 'invalid_method';
  end if;

  insert into public.wallet_topups (user_id, amount_egp, payment_method)
  values (v_uid, p_amount_egp, p_payment_method)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'topup_id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.create_wallet_topup(numeric, text) from public;
grant execute on function public.create_wallet_topup(numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) RPC: user attaches payment screenshot
-- ---------------------------------------------------------------------------
create or replace function public.attach_wallet_topup_screenshot(
  p_topup_id uuid,
  p_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_path is null or char_length(p_path) > 500 then
    raise exception 'invalid_path';
  end if;
  -- path must be under caller's own folder
  if p_path not like v_uid::text || '/%' then
    raise exception 'invalid_path';
  end if;

  update public.wallet_topups
  set screenshot_path = p_path, updated_at = now()
  where id = p_topup_id and user_id = v_uid and status = 'pending';

  if not found then
    raise exception 'topup_not_found_or_not_pending';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.attach_wallet_topup_screenshot(uuid, text) from public;
grant execute on function public.attach_wallet_topup_screenshot(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC: admin lists pending top-ups
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_wallet_topups(
  p_status text default 'pending'
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if not has_min_role('admin') then
    raise exception 'admin only';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'user_id', t.user_id,
    'display_name', p.display_name,
    'amount_egp', t.amount_egp,
    'status', t.status,
    'screenshot_path', t.screenshot_path,
    'payment_method', t.payment_method,
    'created_at', t.created_at,
    'review_notes', t.review_notes
  ) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from public.wallet_topups t
  join public.profiles p on p.id = t.user_id
  where t.status = p_status;

  return v_result;
end;
$$;

revoke all on function public.admin_list_wallet_topups(text) from public;
grant execute on function public.admin_list_wallet_topups(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC: admin approves / rejects a top-up (credits wallet on approve)
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_wallet_topup(
  p_topup_id uuid,
  p_status text, -- 'approved' or 'rejected'
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_topup record;
begin
  if not has_min_role('admin') then
    raise exception 'admin only';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid_status';
  end if;

  select * into v_topup from public.wallet_topups where id = p_topup_id for update;
  if not found then
    raise exception 'topup_not_found';
  end if;
  if v_topup.status <> 'pending' then
    raise exception 'topup_already_reviewed';
  end if;

  update public.wallet_topups
  set status = p_status, reviewed_by = v_uid, reviewed_at = now(),
      review_notes = p_notes, updated_at = now()
  where id = p_topup_id;

  if p_status = 'approved' then
    insert into public.wallet_balances (user_id, balance)
    values (v_topup.user_id, v_topup.amount_egp)
    on conflict (user_id)
    do update set balance = wallet_balances.balance + v_topup.amount_egp,
                  updated_at = now();
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (v_uid, 'review_wallet_topup', 'wallet_topup', p_topup_id,
          jsonb_build_object('status', p_status, 'amount', v_topup.amount_egp, 'user_id', v_topup.user_id));

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.admin_review_wallet_topup(uuid, text, text) from public;
grant execute on function public.admin_review_wallet_topup(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) user's own top-up history
-- ---------------------------------------------------------------------------
create or replace function public.list_my_wallet_topups()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'amount_egp', t.amount_egp,
    'status', t.status,
    'payment_method', t.payment_method,
    'review_notes', t.review_notes,
    'created_at', t.created_at,
    'reviewed_at', t.reviewed_at
  ) order by t.created_at desc), '[]'::jsonb)
  from public.wallet_topups t
  where t.user_id = auth.uid();
$$;

revoke all on function public.list_my_wallet_topups() from public;
grant execute on function public.list_my_wallet_topups() to authenticated;

-- ---------------------------------------------------------------------------
-- 7) updated_at trigger
-- ---------------------------------------------------------------------------
drop trigger if exists wallet_topups_updated_at on public.wallet_topups;
create trigger wallet_topups_updated_at before update on public.wallet_topups
  for each row execute function public.set_updated_at();
