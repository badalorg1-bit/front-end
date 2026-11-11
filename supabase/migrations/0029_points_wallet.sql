-- ===========================================================================
-- BADAL 0029 — points: the platform's single currency (owner decision).
-- Depends on: 0007 (wallet), 0018 (top-ups), 0027 (rent-only escrow),
--             0028 (handover codes — applied immediately before this file).
--
-- The three confirmed rules:
--   1) The wallet IS the points wallet. Booking, escrow, the service fee and
--      refunds are all denominated in POINTS. The EGP figure is a display
--      convenience only (1 point = 0.50 EGP by default => 100 points = 50 EGP).
--   2) Top-ups keep the same QR / Instagram transfer + admin review path; the
--      approved amount is converted to points at the platform rate and
--      credited to the wallet.
--   3) Points never leave the platform in v1 — no cash withdrawal.
--   4) listings.rental_price and listings.deposit are denominated in POINTS
--      (the owner types the price in points; the UI shows the EGP
--      equivalent). Existing rows keep their numbers and are simply re-read
--      as points.
--
-- Why there is NO numeric backfill: every stored money figure (wallet
--   balances, wallet ledger, escrow holds, listing prices) is re-read in the
--   same unit, so relative purchasing power is unchanged — a balance that
--   could book N days before can still book exactly N days after. A x2
--   conversion of balances alone would mint 2x value against unchanged
--   listing prices. Production state at apply time (see the apply script
--   pre-flight): 0 top-ups, 0 escrow holds, 2 admin-funded test balances.
--
-- What changes here:
--   1) platform_settings.point_value_egp + get_point_value_egp()
--   2) top-up approval credits POINTS (points_granted recorded + a ledger row,
--      which 0018 never wrote)
--   3) escrow_pay_external: deducts the payer's points IMMEDIATELY and mints
--      the hold as 'held' together with the 0028 handover codes. The
--      pending_confirmation leg retires for rentals (0 rows today);
--      admin_confirm_external_payment survives untouched as the legacy path
--      for any pre-existing pending hold.
--   4) wallet_escrow_release: keeps the 0028 return-code gate verbatim and
--      makes the ledger self-consistent (gross row + fee row = net credit).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) point_value_egp — how many EGP one point is worth (display + top-up rate)
-- ---------------------------------------------------------------------------
insert into public.platform_settings (id) values (1)
on conflict (id) do nothing;

alter table public.platform_settings
  add column if not exists point_value_egp numeric(10,4) not null default 0.5
    check (point_value_egp > 0 and point_value_egp <= 10000);

create or replace function public.get_point_value_egp()
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select nullif(s.point_value_egp, 0) from public.platform_settings s where s.id = 1),
    0.5
  );
$$;

revoke execute on function public.get_point_value_egp() from public, anon;
grant execute on function public.get_point_value_egp() to authenticated;

-- ---------------------------------------------------------------------------
-- 2a) wallet_topups: record how many points the approved EGP bought
-- ---------------------------------------------------------------------------
alter table public.wallet_topups
  add column if not exists points_granted integer
    check (points_granted is null or points_granted > 0);

-- ---------------------------------------------------------------------------
-- 2b) create_wallet_topup — same input (EGP paid to the platform), but the
--     answer the user cares about (points) is returned up front.
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
  v_value numeric := public.get_point_value_egp();
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

  return jsonb_build_object(
    'ok', true,
    'topup_id', v_id,
    'status', 'pending',
    'points', (round(p_amount_egp / v_value))::integer,
    'point_value_egp', v_value
  );
end;
$$;

revoke all on function public.create_wallet_topup(numeric, text) from public;
grant execute on function public.create_wallet_topup(numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2c) admin_review_wallet_topup — approval now CREDITS POINTS at the platform
--     rate (this was the only place an EGP amount entered the wallet).
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

    insert into public.wallet_transactions (user_id, amount, kind, note)
    values (v_topup.user_id, v_points, 'deposit',
            format('شحن محفظة: %s ج.م = %s نقطة (1 نقطة = %s ج.م)',
                   v_topup.amount_egp, v_points, v_value));
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (v_uid, 'review_wallet_topup', 'wallet_topup', p_topup_id,
          jsonb_build_object(
            'status', p_status,
            'amount_egp', v_topup.amount_egp,
            'points', coalesce(v_points, 0),
            'point_value_egp', v_value,
            'user_id', v_topup.user_id
          ));

  return jsonb_build_object('ok', true, 'status', p_status,
                            'points', coalesce(v_points, 0));
end;
$$;

revoke all on function public.admin_review_wallet_topup(uuid, text, text) from public;
grant execute on function public.admin_review_wallet_topup(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2d) top-up listings — show the points figure (granted once approved, the
--     estimate while pending) so nobody has to do the EGP math themselves.
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
    'points_granted', t.points_granted,
    'points', coalesce(t.points_granted, (round(t.amount_egp / public.get_point_value_egp()))::integer),
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
    'points_granted', t.points_granted,
    'points', coalesce(t.points_granted, (round(t.amount_egp / public.get_point_value_egp()))::integer),
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
-- 3a) escrow_holds.payment_method: the booking is paid from the points wallet
--     (the QR/Instagram channel now only exists one level earlier, at top-up).
-- ---------------------------------------------------------------------------
alter table public.escrow_holds drop constraint if exists escrow_holds_payment_method_check;
alter table public.escrow_holds
  add constraint escrow_holds_payment_method_check
  check (payment_method is null or payment_method in ('wallet_qr', 'instagram', 'points'));

-- ---------------------------------------------------------------------------
-- 3b) escrow_pay_external (0027) -> pay with points, 'held' immediately.
--
--     Old flow: user claims an external transfer -> pending_confirmation ->
--     admin confirms (0028 mints codes). New flow: the points are the
--     platform's own money, so there is nothing to verify — deduct, hold and
--     mint the handover codes in one transaction.
--     Signature loses p_method (it was 'how the claim was paid'; the only
--     answer now is 'points', which is written to the hold instead).
-- ---------------------------------------------------------------------------
create or replace function public.escrow_pay_external(
  p_request_id uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.listing_requests%rowtype;
  v_listing public.listings%rowtype;
  v_fee numeric;
  v_fee_amount numeric;
  v_net numeric;
  v_hold_id uuid;
  v_expected numeric;
  v_value numeric := public.get_point_value_egp();
  v_bytes bytea;
  v_return_until timestamptz;
begin
  select * into v_request from public.listing_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found';
  end if;
  if v_request.status <> 'accepted' then
    raise exception 'escrow pay only allowed on accepted requests';
  end if;
  if v_request.request_type <> 'rent' then
    raise exception 'escrow not applicable for this request type';
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

  -- amount must match the listing's advertised rent price (in points).
  select * into v_listing from public.listings where id = v_request.listing_id;
  if not found then
    raise exception 'listing not found';
  end if;
  if v_listing.rental_price is null or v_listing.rental_unit is null then
    raise exception 'listing has no rental price';
  end if;
  if v_listing.rental_unit = 'ساعة' then
    v_expected := v_listing.rental_price;
  elsif v_listing.rental_unit = 'شهر' then
    if v_request.rent_start is null or v_request.rent_end is null then
      raise exception 'rent period missing';
    end if;
    v_expected := greatest(1, round((v_request.rent_end::date - v_request.rent_start::date + 1) / 30.0)) * v_listing.rental_price;
  else
    if v_request.rent_start is null or v_request.rent_end is null then
      raise exception 'rent period missing';
    end if;
    v_expected := (v_request.rent_end::date - v_request.rent_start::date + 1) * v_listing.rental_price;
  end if;
  if p_amount <> v_expected then
    raise exception 'amount does not match the rental price';
  end if;

  -- Points debit first: a balance that cannot cover the booking stops here.
  -- Conditional update = atomic balance check + debit in one statement; a
  -- later raise (stock exhausted, missing row) rolls this back anyway.
  update public.wallet_balances
     set balance = balance - p_amount, updated_at = now()
   where user_id = v_request.requester_id
     and balance >= p_amount;
  if not found then
    raise exception 'insufficient_points';
  end if;

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_request.requester_id, -p_amount, 'escrow_hold', p_request_id,
          format('حجز: خصم %s نقطة (%s ج.م)', p_amount, round(p_amount * v_value)));

  v_fee := coalesce(public.get_escrow_fee_percent(), 5);
  v_fee_amount := floor(p_amount * v_fee / 100.0);
  v_net := p_amount - v_fee_amount;

  -- M2/M3: atomic stock decrement -- first payment wins, the next one on the
  -- same listing sees quantity = 0 and raises listing_quantity_exhausted.
  update public.listings
     set quantity = quantity - 1, updated_at = now()
   where id = v_request.listing_id
     and quantity > 0;
  if not found then
    raise exception 'listing_quantity_exhausted';
  end if;

  insert into public.escrow_holds (
    request_id, payer_id, payee_id, amount, fee_percent, fee_amount, net_amount,
    status, held_at, payment_method
  ) values (
    p_request_id, v_request.requester_id, v_request.owner_id, p_amount, v_fee, v_fee_amount, v_net,
    'held', now(), 'points'
  ) returning id into v_hold_id;

  -- A2: mint both handover codes at the held moment (same rules as 0028).
  v_return_until := case when v_request.rent_end is not null
                         then (v_request.rent_end + 7)::timestamp + interval '1 day' - interval '1 second'
                         else now() + interval '7 days'
                    end;

  v_bytes := extensions.gen_random_bytes(3);
  insert into public.booking_handover_codes (request_id, purpose, code, valid_until)
  values (p_request_id, 'delivery',
          lpad(((get_byte(v_bytes, 0) * 65536 + get_byte(v_bytes, 1) * 256 + get_byte(v_bytes, 2)) % 1000000)::text, 6, '0'),
          now() + interval '72 hours')
  on conflict (request_id, purpose) do nothing;

  v_bytes := extensions.gen_random_bytes(3);
  insert into public.booking_handover_codes (request_id, purpose, code, valid_until)
  values (p_request_id, 'return',
          lpad(((get_byte(v_bytes, 0) * 65536 + get_byte(v_bytes, 1) * 256 + get_byte(v_bytes, 2)) % 1000000)::text, 6, '0'),
          v_return_until)
  on conflict (request_id, purpose) do nothing;

  return jsonb_build_object(
    'hold_id', v_hold_id,
    'amount', p_amount,
    'amount_egp', round(p_amount * v_value),
    'fee_percent', v_fee,
    'fee_amount', v_fee_amount,
    'net_amount', v_net,
    'status', 'held',
    'payment_method', 'points',
    'delivery_valid_until', now() + interval '72 hours',
    'return_valid_until', v_return_until
  );
end;
$$;

revoke execute on function public.escrow_pay_external(uuid, numeric) from public, anon;
grant execute on function public.escrow_pay_external(uuid, numeric) to authenticated;

-- The pre-points 3-argument overload must go: leaving it would give
-- PostgREST two candidates for the same RPC name.
drop function if exists public.escrow_pay_external(uuid, numeric, text);

-- ---------------------------------------------------------------------------
-- 4) wallet_escrow_release (0028) — points credit + a self-consistent ledger.
--     The return-code gate is copied verbatim from 0028 §6 (this file runs
--     after it); only the money lines change: the balance receives net_amount,
--     so the ledger must read gross row + fee row = net_amount.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_escrow_release(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- A2 gate (0028): no release until the return code is verified. Every hold
  -- is a rent hold and every held hold has codes, so a missing return-code
  -- row means "never verified" — same refusal.
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

  insert into public.wallet_balances (user_id, balance, updated_at)
  values (v_hold.payee_id, v_hold.net_amount, now())
  on conflict (user_id)
  do update set balance = public.wallet_balances.balance + excluded.balance,
                updated_at = now();

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payee_id, v_hold.amount, 'escrow_release', p_request_id,
          format('تحصيل مبلغ الحجز %s نقطة — العمولة تُخصم في الحركة التالية', v_hold.amount));

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payee_id, -v_hold.fee_amount, 'fee', p_request_id,
          format('عمولة الخدمة %s%% (%s نقطة)', v_hold.fee_percent, v_hold.fee_amount));

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
$$;

revoke execute on function public.wallet_escrow_release(uuid) from public, anon;
grant execute on function public.wallet_escrow_release(uuid) to authenticated;

-- PostgREST serves the RPC surface from a cached schema snapshot: after the
-- signature change (escrow_pay_external) and the two new functions (0028),
-- ask it to reload so the frontend never hits a stale 3-argument candidate.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only, run by scripts/bayna-apply-0029.mjs):
--   1. platform_settings.point_value_egp = 0.5 and get_point_value_egp() = 0.5.
--   2. escrow_pay_external exists as (uuid, numeric) ONLY — the text overload
--      is gone; authenticated can execute it, anon cannot.
--   3. escrow_pay_external body mentions insufficient_points, 'held' and
--      booking_handover_codes; it no longer mentions pending_confirmation.
--   4. admin_review_wallet_topup body credits points_granted + a 'deposit'
--      ledger row; wallet_topups.points_granted column exists.
--   5. wallet_escrow_release still carries return_code_required (0028 gate
--      survived the replace) and now writes the gross ledger row.
--   6. escrow_holds_payment_method_check allows 'points'.
--   7. No numeric backfill ran: wallet_balances / wallet_transactions sums are
--      byte-identical to the pre-flight snapshot.
-- ---------------------------------------------------------------------------
