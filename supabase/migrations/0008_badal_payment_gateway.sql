-- BADAL — external payment gateway (QR / Instagram) on top of escrow
-- The buyer pays BADAL directly via QR scan or Instagram transfer.
-- BADAL holds the amount, takes its service % on release, credits seller.

-- ---------------------------------------------------------------------------
-- 1) platform_settings — add BADAL payment channel columns
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists badal_wallet_name text default 'بادال',
  add column if not exists badal_qr_path text,
  add column if not exists badal_instagram text default '@badal.egypt';

-- ---------------------------------------------------------------------------
-- 2) escrow_holds — record which channel the buyer used
-- ---------------------------------------------------------------------------
alter table public.escrow_holds
  add column if not exists payment_method text
    check (payment_method in ('wallet_qr', 'instagram'));

-- ---------------------------------------------------------------------------
-- 3) Public read of BADAL payment settings (buyer sees QR / Instagram)
-- ---------------------------------------------------------------------------
create or replace function public.get_badal_payment_settings()
returns table (
  wallet_name text,
  qr_path text,
  instagram text,
  fee_percent numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select badal_wallet_name, badal_qr_path, badal_instagram, escrow_fee_percent
  from public.platform_settings where id = 1;
$$;

revoke execute on function public.get_badal_payment_settings() from public, anon;
grant execute on function public.get_badal_payment_settings() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4) RPC: buyer confirms external payment → hold in escrow (no wallet debit)
-- ---------------------------------------------------------------------------
create or replace function public.escrow_pay_external(
  p_request_id uuid,
  p_amount numeric,
  p_method text default 'wallet_qr'
)
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
  if p_method not in ('wallet_qr', 'instagram') then
    raise exception 'invalid payment method';
  end if;

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

  insert into public.escrow_holds (
    request_id, payer_id, payee_id, amount, fee_percent, fee_amount, net_amount,
    status, held_at, payment_method
  ) values (
    p_request_id, v_request.requester_id, v_request.owner_id, p_amount, v_fee, v_fee_amount, v_net,
    'held', now(), p_method
  ) returning id into v_hold_id;

  return jsonb_build_object(
    'hold_id', v_hold_id,
    'amount', p_amount,
    'fee_percent', v_fee,
    'fee_amount', v_fee_amount,
    'net_amount', v_net,
    'status', 'held',
    'payment_method', p_method
  );
end;
$$;

revoke execute on function public.escrow_pay_external(uuid, numeric, text) from public, anon;
grant execute on function public.escrow_pay_external(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Admin: set BADAL payment channels (wallet name / QR path / Instagram)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_badal_payment(
  p_wallet_name text default null,
  p_qr_path text default null,
  p_instagram text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_min_role('admin') then
    raise exception 'admin only';
  end if;
  update public.platform_settings
  set badal_wallet_name = coalesce(p_wallet_name, badal_wallet_name),
      badal_qr_path     = coalesce(p_qr_path, badal_qr_path),
      badal_instagram   = coalesce(p_instagram, badal_instagram),
      updated_at = now()
  where id = 1;
  insert into public.admin_audit_log (actor_id, action, target_type, meta)
  values (auth.uid(), 'set_badal_payment', 'platform_settings',
          jsonb_build_object(
            'wallet_name', p_wallet_name,
            'qr_path', p_qr_path,
            'instagram', p_instagram
          ));
end;
$$;

revoke execute on function public.admin_set_badal_payment(text, text, text) from public, anon;
grant execute on function public.admin_set_badal_payment(text, text, text) to authenticated;
