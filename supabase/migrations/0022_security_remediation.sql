-- 0022_security_remediation.sql
-- Fixes Critical (C1/C2), High (H2), and Medium findings from the security audit.
-- Apply after 0021. Safe to re-run (idempotent drops/creates).

-- ---------------------------------------------------------------------------
-- C1: escrow_pay_external must not mint a releasable hold from nothing.
-- Buyer "external" payments now land in pending_confirmation; only an admin
-- (moderator+) can promote them to held, after which wallet_escrow_release
-- works as before. This closes the colluding-account money-mint path.
-- ---------------------------------------------------------------------------
alter table public.escrow_holds
  drop constraint if exists escrow_holds_status_check;
alter table public.escrow_holds
  add constraint escrow_holds_status_check
  check (status in ('pending_confirmation', 'held', 'released', 'refunded'));

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
  v_listing public.listings%rowtype;
  v_fee numeric;
  v_fee_amount numeric;
  v_net numeric;
  v_hold_id uuid;
  v_expected numeric;
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

  -- M6: amount must match the listing's advertised price (server-side).
  select * into v_listing from public.listings where id = v_request.listing_id;
  if not found then
    raise exception 'listing not found';
  end if;
  if v_request.request_type = 'purchase' then
    if v_listing.sale_price is null or p_amount <> v_listing.sale_price then
      raise exception 'amount does not match the sale price';
    end if;
  elsif v_request.request_type = 'rent' then
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
  end if;

  v_fee := coalesce(public.get_escrow_fee_percent(), 5);
  v_fee_amount := floor(p_amount * v_fee / 100.0);
  v_net := p_amount - v_fee_amount;

  insert into public.escrow_holds (
    request_id, payer_id, payee_id, amount, fee_percent, fee_amount, net_amount,
    status, held_at, payment_method
  ) values (
    p_request_id, v_request.requester_id, v_request.owner_id, p_amount, v_fee, v_fee_amount, v_net,
    'pending_confirmation', now(), p_method
  ) returning id into v_hold_id;

  return jsonb_build_object(
    'hold_id', v_hold_id,
    'amount', p_amount,
    'fee_percent', v_fee,
    'fee_amount', v_fee_amount,
    'net_amount', v_net,
    'status', 'pending_confirmation',
    'payment_method', p_method
  );
end;
$$;

revoke execute on function public.escrow_pay_external(uuid, numeric, text) from public, anon;
grant execute on function public.escrow_pay_external(uuid, numeric, text) to authenticated;

-- Admin confirms the external payment was actually received → held.
create or replace function public.admin_confirm_external_payment(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.escrow_holds%rowtype;
begin
  if not has_min_role('moderator') then
    raise exception 'moderator only';
  end if;
  select * into v_hold from public.escrow_holds where request_id = p_request_id for update;
  if not found then
    raise exception 'escrow hold not found';
  end if;
  if v_hold.status <> 'pending_confirmation' then
    raise exception 'escrow is not pending confirmation';
  end if;
  update public.escrow_holds set status = 'held', held_at = now() where id = v_hold.id;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'confirm_external_payment', 'escrow_holds', v_hold.id,
          jsonb_build_object('request_id', p_request_id, 'amount', v_hold.amount));
  return jsonb_build_object('status', 'held', 'amount', v_hold.amount);
end;
$$;

revoke execute on function public.admin_confirm_external_payment(uuid) from public, anon;
grant execute on function public.admin_confirm_external_payment(uuid) to authenticated;

-- Admin rejects a pending external payment. No wallet credit: nothing was debited.
create or replace function public.admin_reject_external_payment(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.escrow_holds%rowtype;
begin
  if not has_min_role('moderator') then
    raise exception 'moderator only';
  end if;
  select * into v_hold from public.escrow_holds where request_id = p_request_id for update;
  if not found then
    raise exception 'escrow hold not found';
  end if;
  if v_hold.status <> 'pending_confirmation' then
    raise exception 'escrow is not pending confirmation';
  end if;
  update public.escrow_holds set status = 'refunded', refunded_at = now() where id = v_hold.id;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'reject_external_payment', 'escrow_holds', v_hold.id,
          jsonb_build_object('request_id', p_request_id, 'amount', v_hold.amount));
  return jsonb_build_object('status', 'refunded', 'amount', v_hold.amount);
end;
$$;

revoke execute on function public.admin_reject_external_payment(uuid) from public, anon;
grant execute on function public.admin_reject_external_payment(uuid) to authenticated;

-- wallet_escrow_refund must not credit the buyer for pending_confirmation holds
-- (no wallet debit happened). Only 'held' can be refunded to the wallet.
-- pending_confirmation is only cleared by admin_reject_external_payment.

-- ---------------------------------------------------------------------------
-- C2: column-level lockdown on listing_requests.
-- Clients may only update status/updated_at via RLS UPDATE; payment
-- confirmation columns (payer_confirmed_at, payee_confirmed_at, paid_at, …)
-- are reserved for SECURITY DEFINER RPCs.
revoke update on public.listing_requests from authenticated, anon;
grant update (status, updated_at) on public.listing_requests to authenticated;

-- ---------------------------------------------------------------------------
-- H2: notify_user must not be callable by clients (triggers/definers only).
-- ---------------------------------------------------------------------------
revoke execute on function public.notify_user(uuid, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- M1 (rate limits): light per-IP throttle on high-abuse signup paths is
-- handled client-side + by Supabase Auth rate limits. No SQL change here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- M4 (subshot upload policy): tighten payment-qr insert to own folder only.
-- (0017 already revokes the open policy; keep the strict one.)
-- ---------------------------------------------------------------------------
drop policy if exists "payment_qr_subshot_insert" on storage.objects;
create policy "payment_qr_subshot_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[1] = 'badal-platform'
    )
  );

-- ---------------------------------------------------------------------------
-- M5: raise payment-qr bucket size limit to 5 MB (matches validateImageFile).
-- ---------------------------------------------------------------------------
update storage.buckets
  set file_size_limit = 5242880
  where id = 'payment-qr';

-- ---------------------------------------------------------------------------
-- L8: moderators can open disputes on any request (party policies remain).
-- ---------------------------------------------------------------------------
create policy "listing_requests_update_moderator"
  on public.listing_requests for update
  to authenticated
  using (has_min_role('moderator'))
  with check (has_min_role('moderator'));
