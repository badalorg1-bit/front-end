-- 0027_rent_swap_only.sql
-- Market scope change (owner decision, 2026-11-02): Bayna is RENT + SWAP only.
--
-- Four owner requirements land in one transaction:
--   M1/M5  permanent removal of sale + purchase (owner: "حذف نهائي"),
--          then triggers that refuse any future sale listing / purchase request
--          (listings has table-level UPDATE for authenticated, so a trigger is
--          the only server-side guard; request_type cannot be changed by
--          clients -- 0022 column grants -- so an INSERT trigger suffices).
--   M2     listings.quantity stock: the seller sets it at publish time,
--          decremented atomically when a payment is claimed, restored on every
--          settlement path (release / refund / admin reject) -- exactly one
--          restore per hold, so the counter never drifts.
--   M3     first-wins concurrency: the decrement is
--          `UPDATE ... WHERE quantity > 0`, so of two simultaneous payments the
--          first commits and the second gets listing_quantity_exhausted
--          ("نفد"). Request creation and owner acceptance refuse an exhausted
--          listing early with the same error.
--   M4     chat gate: get_or_create_conversation AND send_message require an
--          accepted (or completed/disputed) request between the two users;
--          can_open_chat() is granted to the client so the UI can hide the
--          "مراسلة المالك" button until then.
--
-- Additive: never edits a previously applied migration (existing functions are
-- re-stated with CREATE OR REPLACE, which preserves grants and trigger
-- bindings). Idempotent drops.
-- LOCAL ONLY - do not run against production without explicit approval.

begin;

-- ===========================================================================
-- 1) Permanent deletion of sale/purchase data (owner-approved).
--    Order matters:
--      a. conversations about sale listings go first (their messages cascade
--         via messages_conversation_id_fkey); otherwise the listings delete
--         would SET NULL and orphan a chat with no context.
--      b. notifications tied to sale listings (FK is SET NULL -- delete while
--         the listing id is still there so no stale "طلب شراء" notice survives).
--      c. listings delete cascades: listing_images, listing_promos,
--         listing_requests (-> escrow_holds, reviews).
--      d. belt & suspenders for purchase requests that somehow reference a
--         non-sale listing (verified: 0 in production, kept for safety).
--    wallet_transactions.request_id is SET NULL, but purchase requests have
--    zero wallet rows (verified), so no ledger history is disturbed.
--    listing_quota_log keeps its row with listing_id NULL (quota accounting
--    stays intact).
-- ===========================================================================
delete from public.conversations
where listing_id in (select id from public.listings where listing_type = 'sale');

delete from public.notifications
where listing_id in (select id from public.listings where listing_type = 'sale');

delete from public.listings where listing_type = 'sale';

delete from public.listing_requests where request_type = 'purchase';

-- ===========================================================================
-- 2) Refuse any future sale listing / purchase request.
-- ===========================================================================
create or replace function public.lock_listing_market()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.listing_type = 'sale' then
    raise exception 'sale_listings_retired';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_lock_market on public.listings;
create trigger listings_lock_market
  before insert or update on public.listings
  for each row execute function public.lock_listing_market();

create or replace function public.lock_request_market()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_type = 'purchase' then
    raise exception 'purchase_requests_retired';
  end if;
  return new;
end;
$$;

drop trigger if exists listing_requests_lock_market on public.listing_requests;
create trigger listing_requests_lock_market
  before insert on public.listing_requests
  for each row execute function public.lock_request_market();

-- ===========================================================================
-- 3) M2: stock counter.
-- ===========================================================================
alter table public.listings
  add column if not exists quantity integer not null default 1
  constraint listings_quantity_check check (quantity >= 0);

-- ---------------------------------------------------------------------------
-- 3a) lock_request_insert (0026) + early stock refusal: once the last unit is
--     paid for, new rent requests are refused immediately ("نفد").
-- ---------------------------------------------------------------------------
create or replace function public.lock_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- a request always starts life as 'pending'; transitions are the
  -- owner's/requester's to make later via enforce_request_transition().
  new.status := 'pending';
  -- payment state is owned by escrow RPCs only, never by an insert.
  new.payer_confirmed_at := null;
  new.payee_confirmed_at := null;
  new.paid_at := null;
  -- §7.3: event timestamps must be the server's, not the client's.
  new.created_at := now();
  new.updated_at := now();
  -- M2/M3: no new rent request once the last unit has been paid for.
  if new.request_type = 'rent'
     and not exists (select 1 from public.listings
                     where id = new.listing_id and quantity > 0) then
    raise exception 'listing_quantity_exhausted';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3b) enforce_request_transition (0015) + accept gate: never accept a rent
--     request on an exhausted listing. The payment race stays authoritative
--     (this SELECT does not lock; it is the early, friendly refusal).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status = 'pending' and new.status in ('accepted', 'rejected') then
    if auth.uid() is distinct from old.owner_id then
      raise exception 'only the listing owner can accept or reject';
    end if;
    if new.status = 'accepted' and new.request_type = 'rent'
       and not exists (select 1 from public.listings
                       where id = new.listing_id and quantity > 0) then
      raise exception 'listing_quantity_exhausted';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'cancelled' then
    if auth.uid() is distinct from old.requester_id then
      raise exception 'only the requester can cancel';
    end if;
    return new;
  end if;

  if old.status = 'accepted' and new.status = 'completed' then
    if auth.uid() not in (old.requester_id, old.owner_id) then
      raise exception 'only participants can mark completed';
    end if;
    return new;
  end if;

  if old.status = 'accepted' and new.status = 'disputed' then
    if auth.uid() not in (old.requester_id, old.owner_id) then
      raise exception 'only participants can open a dispute';
    end if;
    return new;
  end if;

  if old.status = 'disputed' and new.status = 'completed' then
    if auth.uid() not in (old.requester_id, old.owner_id) then
      raise exception 'only participants can resolve a dispute';
    end if;
    return new;
  end if;

  raise exception 'invalid status transition from % to %', old.status, new.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3c) escrow_pay_external (0022) -> rent-only, and the atomic decrement that
--     implements first-wins: the row lock taken here serialises concurrent
--     payments on the same listing; the second one re-evaluates
--     `quantity > 0` after the first commits and raises.
--     The purchase amount branch is gone (no purchase requests can exist).
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

  -- amount must match the listing's advertised rent price (server-side).
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

-- ---------------------------------------------------------------------------
-- 3d) wallet_escrow_release (0021) + restore the unit: the rent is settled and
--     the item is back with the owner.
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
          format('تحويل بعد خصم عمولة بينا %s%%', v_hold.fee_percent));

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

  -- M2: the rented unit is back in stock (exactly one restore per hold).
  update public.listings l
     set quantity = l.quantity + 1, updated_at = now()
    from public.listing_requests r
   where r.id = p_request_id and l.id = r.listing_id;

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
-- 3e) wallet_escrow_refund (0007) + restore the unit (deal cancelled).
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

  -- M2: money went back, so the unit goes back to stock.
  update public.listings l
     set quantity = l.quantity + 1, updated_at = now()
    from public.listing_requests r
   where r.id = p_request_id and l.id = r.listing_id;

  return jsonb_build_object('status', 'refunded', 'amount', v_hold.amount);
end;
$$;

revoke execute on function public.wallet_escrow_refund(uuid) from public, anon;
grant execute on function public.wallet_escrow_refund(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3f) admin_reject_external_payment (0022) + restore the unit: the claimed
--     payment was never verified, so the reserved stock is released. (The
--     decrement happened at claim time in escrow_pay_external above.)
-- ---------------------------------------------------------------------------
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

  -- M2: the payment claim was rejected, so the reserved unit returns.
  update public.listings l
     set quantity = l.quantity + 1, updated_at = now()
    from public.listing_requests r
   where r.id = p_request_id and l.id = r.listing_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'reject_external_payment', 'escrow_holds', v_hold.id,
          jsonb_build_object('request_id', p_request_id, 'amount', v_hold.amount));
  return jsonb_build_object('status', 'refunded', 'amount', v_hold.amount);
end;
$$;

revoke execute on function public.admin_reject_external_payment(uuid) from public, anon;
grant execute on function public.admin_reject_external_payment(uuid) to authenticated;

-- ===========================================================================
-- 4) M4: chat gate -- an accepted request between the two users is required
--    to open a conversation AND to write into one. Granted to authenticated
--    so the UI can hide/show the "مراسلة المالك" button honestly.
-- ===========================================================================
create or replace function public.can_open_chat(p_other uuid, p_listing_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.listing_requests r
    where r.status in ('accepted', 'completed', 'disputed')
      and (p_listing_id is null or r.listing_id = p_listing_id)
      and (
        (r.requester_id = auth.uid() and r.owner_id = p_other)
        or (r.requester_id = p_other and r.owner_id = auth.uid())
      )
  );
$$;

revoke execute on function public.can_open_chat(uuid, uuid) from public, anon;
grant execute on function public.can_open_chat(uuid, uuid) to authenticated;

-- 4a) get_or_create_conversation (0014) + gate: no new conversation without an
--     accepted request (also blocks re-opening pre-gate conversations, which
--     is the fraud channel this requirement closes).
create or replace function public.get_or_create_conversation(
  p_other uuid,
  p_listing_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'invalid conversation partner';
  end if;
  if public.is_user_banned(v_me) then
    raise exception 'account is banned';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'user not found';
  end if;

  -- M4: the deal must be on-platform first (owner accepted a request).
  if not public.can_open_chat(p_other, p_listing_id) then
    raise exception 'chat_requires_accepted_request';
  end if;

  if v_me < p_other then
    v_a := v_me;
    v_b := p_other;
  else
    v_a := p_other;
    v_b := v_me;
  end if;

  select id into v_id
  from public.conversations
  where user_a = v_a and user_b = v_b
    and listing_id is not distinct from p_listing_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (user_a, user_b, listing_id)
  values (v_a, v_b, p_listing_id)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.get_or_create_conversation(uuid, uuid) to authenticated;

-- 4b) send_message (0014) + gate: pre-existing conversations without an
--     accepted request become read-only instead of staying a back channel.
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_msg_id uuid;
  v_other uuid;
  v_listing uuid;
  v_title text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if public.is_user_banned(v_me) then
    raise exception 'account is banned';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'empty message';
  end if;

  select case when user_a = v_me then user_b else user_a end, listing_id
  into v_other, v_listing
  from public.conversations
  where id = p_conversation_id
    and (user_a = v_me or user_b = v_me);

  if v_other is null then
    raise exception 'conversation not found';
  end if;

  -- M4: same gate as opening -- accepted request required to keep writing.
  if not public.can_open_chat(v_other, v_listing) then
    raise exception 'chat_requires_accepted_request';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_me, left(trim(p_body), 2000))
  returning id into v_msg_id;

  update public.conversations
  set last_message_at = now()
  where id = p_conversation_id;

  select display_name into v_title from public.profiles where id = v_me;
  perform public.notify_user(
    v_other,
    'رسالة جديدة',
    coalesce(v_title, 'مستخدم') || ' أرسل لك رسالة.',
    'system',
    null
  );

  return v_msg_id;
end;
$$;

grant execute on function public.send_message(uuid, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only, run after approval):
--   1. select count(*) from listings where listing_type='sale'   -> 0
--   2. select count(*) from listing_requests
--      where request_type='purchase'                             -> 0
--   3. insert a sale listing / purchase request (as a test user) ->
--      sale_listings_retired / purchase_requests_retired
--   4. listings.quantity exists, default 1, >= 0
--   5. two concurrent escrow_pay_external on one listing (qty=1):
--      first succeeds, second -> listing_quantity_exhausted
--   6. wallet_escrow_release / refund / admin_reject each return the unit
--      (quantity back to its pre-payment value, never +1 beyond it)
--   7. get_or_create_conversation without an accepted request ->
--      chat_requires_accepted_request; with one -> uuid
--   8. send_message on a pre-gate conversation without an accepted request
--      -> chat_requires_accepted_request
--   9. can_open_chat(me, owner, listing) flips false -> true on acceptance
-- ---------------------------------------------------------------------------
