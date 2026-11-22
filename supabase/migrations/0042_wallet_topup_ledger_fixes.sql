-- 0042_wallet_topup_ledger_fixes.sql
-- Closes security-pass.md findings: #7 (rate limit), #8 (ledger on approval), #9 (escrow ledger match)
-- Applied via bayna-apply-migrations.mjs (reads ui-prototype/.env.server, uses pooler)

-- =====================================================================
-- #7: Rate limit on create_wallet_topup
-- Add a 1-request-per-minute window per user using pg_advisory_xact_lock
-- and a recent-topups check (covers pending + recently resolved).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_wallet_topup(
  p_amount_egp numeric,
  p_payment_method text DEFAULT 'wallet_qr'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_value numeric := public.get_point_value_egp();
  v_lock_key bigint;
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

  -- Rate limit: 1 topup request per minute per user (includes pending/resolved)
  if exists (
    select 1 from public.wallet_topups
    where user_id = v_uid
      and created_at > now() - interval '1 minute'
  ) then
    raise exception 'rate_limited';
  end if;

  -- Advisory lock to serialize concurrent calls for the same user
  v_lock_key := ('x' || substr(md5(v_uid::text), 1, 15))::bit(60)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- Re-check under lock (idempotent guard)
  if exists (select 1 from public.wallet_topups
             where user_id = v_uid and status = 'pending') then
    raise exception 'pending_topup_exists';
  end if;

  insert into public.wallet_topups (user_id, amount_egp, payment_method)
  values (v_uid, p_amount_egp, p_payment_method)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'topup_id', v_id,
    'status', 'pending',
    'points', (round(p_amount_egp / v_value))::integer,
    'point_value_egp', v_value
  );
end;
$function$;

-- =====================================================================
-- #8: Ensure admin_review_wallet_topup writes wallet_transactions (ledger)
-- The current production version already does this, but we make it explicit
-- and ensure the transaction kind is distinct for auditability.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_review_wallet_topup(
  p_topup_id uuid,
  p_status text,
  p_notes text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_topup record;
  v_value numeric := public.get_point_value_egp();
  v_points integer;
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
    v_points := (round(v_topup.amount_egp / v_value))::integer;

    update public.wallet_topups set points_granted = v_points where id = p_topup_id;

    insert into public.wallet_balances (user_id, balance, updated_at)
    values (v_topup.user_id, v_points, now())
    on conflict (user_id)
    do update set balance = public.wallet_balances.balance + excluded.balance,
                  updated_at = now();

    -- Ledger entry: explicit kind 'topup' for clear audit trail
    insert into public.wallet_transactions (user_id, amount, kind, note)
    values (v_topup.user_id, v_points, 'topup',
            format('شحن محفظة عبر %s: %s ج.م = %s نقطة (1 نقطة = %s ج.م)',
                   v_topup.payment_method, v_topup.amount_egp, v_points, v_value));
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (v_uid, 'review_wallet_topup', 'wallet_topup', p_topup_id,
          jsonb_build_object(
            'status', p_status,
            'amount_egp', v_topup.amount_egp,
            'points', coalesce(v_points, 0),
            'point_value_egp', v_value,
            'user_id', v_topup.user_id,
            'payment_method', v_topup.payment_method
          ));

  return jsonb_build_object('ok', true, 'status', p_status,
                            'points', coalesce(v_points, 0));
end;
$function$;

-- =====================================================================
-- #9: Ensure wallet_escrow_release ledger matches balance change exactly
-- Current production version already inserts two rows (escrow_release + fee)
-- summing to net_amount. We make the first row use net_amount directly
-- and keep the fee row for transparency, so any single-row query of
-- 'escrow_release' shows the actual credited amount.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.wallet_escrow_release(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_hold public.escrow_holds%rowtype;
  v_value numeric := public.get_point_value_egp();
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

  -- A2 gate (0028): no release until the return code is verified.
  if not exists (
    select 1 from public.booking_handover_codes c
    where c.request_id = p_request_id
      and c.purpose = 'return'
      and c.used_at is not null
  ) then
    if has_min_role('moderator') then
      insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
      values (auth.uid(), 'escrow_release_return_code_bypass', 'listing_requests', p_request_id,
              jsonb_build_object('hold_id', v_hold.id, 'amount', v_hold.amount));
    else
      raise exception 'return_code_required';
    end if;
  end if;

  -- Credit the net amount to seller's balance
  insert into public.wallet_balances (user_id, balance, updated_at)
  values (v_hold.payee_id, v_hold.net_amount, now())
  on conflict (user_id)
  do update set balance = public.wallet_balances.balance + excluded.balance,
                updated_at = now();

  -- Ledger: one row for the NET amount actually credited (matches balance delta)
  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payee_id, v_hold.net_amount, 'escrow_release', p_request_id,
          format('إفراج حجز (صافي بعد العمولة): %s نقطة — المبلغ الأصلي %s نقطة، عمولة %s%% (%s نقطة)',
                 v_hold.net_amount, v_hold.amount, v_hold.fee_percent, v_hold.fee_amount));

  -- Separate fee row for transparency (does not affect balance)
  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payee_id, 0, 'fee', p_request_id,
          format('عمولة الخدمة %s%% (%s نقطة) — مسجلة للشفافية فقط، لا تؤثر على الرصيد',
                 v_hold.fee_percent, v_hold.fee_amount));

  update public.escrow_holds
  set status = 'released', released_at = now()
  where id = v_hold.id;

  update public.listing_requests
  set payer_confirmed_at = coalesce(payer_confirmed_at, now()),
      payee_confirmed_at = coalesce(payee_confirmed_at, now()),
      paid_at = coalesce(paid_at, now()),
      updated_at = now()
  where id = p_request_id;

  -- M2: the rented unit is back in stock (exactly one restore per hold).
  update public.listings l
     set quantity = l.quantity + 1, updated_at = now()
    from public.listing_requests r
   where r.id = p_request_id and l.id = r.listing_id;

  return jsonb_build_object(
    'status', 'released',
    'amount', v_hold.amount,
    'amount_egp', round(v_hold.amount * v_value),
    'fee_amount', v_hold.fee_amount,
    'net_amount', v_hold.net_amount,
    'net_amount_egp', round(v_hold.net_amount * v_value),
    'released_at', now()
  );
end;
$function$;

-- =====================================================================
-- Revoke execute from public on the three functions (defense-in-depth)
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.create_wallet_topup(numeric, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_review_wallet_topup(uuid, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.wallet_escrow_release(uuid) FROM public;