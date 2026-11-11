-- 0026_batch1_security_fixes.sql
-- Batch 1 (approved for writing, NOT approved for applying).
-- Closes: F1 (listing_requests INSERT status/money columns), #2 (dead
-- wallet_escrow_pay trusts a client-supplied amount), F2/F12 (payment-qr
-- upload policies: missing MIME whitelist + lost subscription-screenshots
-- branch + unauthenticated write to badal-platform/), F3 (bucket-wide SELECT
-- lets anyone enumerate payment-qr), the direct_payment_history view running
-- with owner privileges (bypasses RLS), and pricing_plans being unreadable
-- for normal signed-in users.
--
-- Additive: never edits a previously applied migration. Idempotent drops.
-- LOCAL ONLY - do not run against production without explicit approval.

begin;

-- ===========================================================================
-- 1) F1 - lock listing_requests INSERT to client-owned columns.
--    0022 already revoked table-level UPDATE and re-granted only
--    (status, updated_at); INSERT was left wide open, so a client could
--    insert status='accepted', paid_at=now(), payer/payee_confirmed_at or a
--    chosen id/owner_id. RLS WITH CHECK cannot restrict columns, so this is
--    done with column-level grants + a BEFORE INSERT normaliser.
-- ===========================================================================
revoke insert on public.listing_requests from authenticated, anon;

-- Exactly the columns createRequest() sends (src/lib/api.ts:287-297).
grant insert (
  listing_id, requester_id, owner_id, request_type, status,
  message, rent_start, rent_end, offered_listing_id
) on public.listing_requests to authenticated;

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
  return new;
end;
$$;

-- Fires before listing_requests_sync_owner ('lock...' < 'sync...' alphabetically);
-- the two touch disjoint columns, so order is irrelevant either way.
drop trigger if exists listing_requests_lock_insert on public.listing_requests;
create trigger listing_requests_lock_insert
  before insert on public.listing_requests
  for each row execute function public.lock_request_insert();

-- ===========================================================================
-- 2) #2 - retire wallet_escrow_pay.
--    It debits whatever amount the CALLER sends (p_amount), while its sibling
--    escrow_pay_external verifies the amount against the listing. Nothing in
--    src/ calls it (only escrowPayExternal does), so it is dead but live.
-- ===========================================================================
revoke execute on function public.wallet_escrow_pay(uuid, numeric) from public, anon, authenticated;
drop function if exists public.wallet_escrow_pay(uuid, numeric);

-- ===========================================================================
-- 3) F12 + F2 - rebuild the payment-qr INSERT policy.
--    0022's rewrite dropped 0017's subscription-screenshots branch (so every
--    subscription screenshot upload 403'd) and dropped the MIME whitelist
--    (so .html/.svg/.json were accepted), and it let ANY signed-in user write
--    to badal-platform/ because policies are OR-ed.
--    Own-folder writes keep living in payment_qr_upload (0012, MIME-checked);
--    platform writes keep living in payment_qr_platform_admin_* (0017, admin
--    + MIME-checked). This policy now covers ONLY subscription screenshots,
--    and only for the order the caller actually owns.
-- ===========================================================================
drop policy if exists "payment_qr_subshot_insert" on storage.objects;
create policy "payment_qr_subshot_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = 'subscription-screenshots'
    -- folder[2] is the order id (src/lib/saas.ts:171)
    and exists (
      select 1 from public.subscription_orders o
      where o.user_id = auth.uid()
        and o.id::text = (storage.foldername(name))[2]
    )
    and not public.is_user_banned(auth.uid())
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

-- ===========================================================================
-- 4) F3 - scope SELECT on payment-qr.
--    payment_qr_public_read (0004) allowed SELECT on every object in the
--    bucket, so .list() enumerated badal-platform/ and every user's QR and
--    top-up screenshots. Object URLs are unaffected: for a public bucket
--    Supabase's Retrieve/Serve path does not consult RLS, which is exactly
--    how the app renders QR images (getPublicUrl / object/public/<path>).
--    `to authenticated` (not `to public`) so anon never evaluates
--    has_min_role(), whose EXECUTE was revoked from anon in 0017.
-- ===========================================================================
drop policy if exists "payment_qr_public_read" on storage.objects;
create policy "payment_qr_public_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-qr'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_min_role('admin')
    )
  );

-- ===========================================================================
-- 5) direct_payment_history view (0025_retire) runs as its owner, so it read
--    listing_requests WITHOUT RLS and exposed every paid request's buyer and
--    seller ids. security_invoker pushes the caller's policies back in.
-- ===========================================================================
create or replace view public.direct_payment_history
with (security_invoker = true)
as
SELECT
    lr.id AS request_id,
    lr.requester_id AS payer_id,
    lr.owner_id AS seller_id,
    lr.payer_confirmed_at,
    lr.payee_confirmed_at,
    lr.paid_at,
    lr.updated_at
FROM listing_requests lr
WHERE lr.paid_at IS NOT NULL
   OR lr.payer_confirmed_at IS NOT NULL
   OR lr.payee_confirmed_at IS NOT NULL;

revoke all on public.direct_payment_history from anon;
grant select on public.direct_payment_history to authenticated;

-- ===========================================================================
-- 6) pricing_plans: 0025 left authenticated NON-admin users with no SELECT
--    policy at all, so every signed-in visitor saw an empty plans list
--    (listPricingPlans, src/lib/saas.ts:86). Grant them the active plans,
--    same as anon.
-- ===========================================================================
drop policy if exists "pricing_plans_select_active_auth" on public.pricing_plans;
create policy "pricing_plans_select_active_auth"
  on public.pricing_plans for select
  to authenticated
  using (is_active = true);

commit;

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only, run after approval):
--   1. INSERT attempt on listing_requests with status='accepted' must land as
--      'pending' with paid_at null.
--   2. INSERT naming paid_at / id must fail with permission denied for column.
--   3. drop-in: escrow_pay_external + wallet_escrow_release still work.
--   4. select * from payment_qr objects of another user via
--      /storage/v1/object/list/payment-qr  -> 401/403 or empty, not a listing.
--   5. Upload .html under <uid>/  -> 403; .jpg under <uid>/  -> 200.
--   6. Upload subscription-screenshots/<own-order>/x.jpg -> 200;
--      .../<someone-else's-order>/x.jpg -> 403.
--   7. Public object URLs (QR images, admin receipt links) still render.
--   8. Signed-in non-admin can read active pricing plans.
-- ---------------------------------------------------------------------------
