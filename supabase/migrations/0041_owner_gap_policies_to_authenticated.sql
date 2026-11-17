-- 0041 — owner-gap policies: stop them from breaking anon reads
--
-- Background: 0009 created eight SaaS SELECT policies for the PUBLIC role whose
-- quals read profiles.role:
--   auth.uid() in (select id from public.profiles where role in
--                   ('admin','super_admin','owner'))
-- 0034 re-created the same eight verbatim (adding 'owner' — §10, lines 870-908).
-- anon holds SELECT on profiles only for
--   (id, display_name, avatar_url, city, created_at, updated_at)
-- — NOT role — so ANY anon query on these eight tables failed with:
--   permission denied for table profiles
-- raised while planning/applying the PUBLIC policy qual, even when a dedicated
-- anon policy (pricing_plans) also applied and even when WHERE is_active=true
-- filtered every row. Proofs (all inside rolled-back transactions):
--   * as anon, count(*) on each of the eight tables -> permission denied
--   * dropping pricing_plans_select_active in the tx -> anon reads 4 rows
--   * granting anon profiles-select in the tx        -> anon reads 4 rows
-- User-visible: the public routes /pricing (probe FAIL "anon pricing_plans
-- BROKEN") and /promo (listPromoServices runs with no auth gate) returned that
-- error to logged-out visitors. The other six tables have no anon path in the
-- app (latent, fail-closed — error instead of leak).
--
-- Fix (approved with the security pass — scope: all eight):
-- re-declare the SAME eight policies — identical names, identical quals copied
-- verbatim from 0034:870-908 — restricted `to authenticated`, the only client
-- role able to evaluate the profiles reference (it holds the role column grant).
-- Effects:
--   * anon: these quals are never injected into its plans.
--       - /pricing keeps working through pricing_plans_select_active_anon
--         (0025) -> active plans (4 today).
--       - the other seven have no anon path -> clean empty result instead of
--         an error. No new anon visibility: NO promo_services anon policy is
--         added (decided: /promo shows an empty list to logged-out visitors).
--   * authenticated / admin / owner: byte-identical behaviour — PUBLIC already
--     covered authenticated, and authenticated can read profiles.role.
--   * service_role (rolbypassrls=true) and postgres: unaffected.
--   * scripts/bayna-apply-0034.mjs post-flight stays green: the eight names
--     exist and their quals still contain the literal 'owner'.
-- No row logic changes, no data written. Verified by
-- scripts/bayna-apply-0041.mjs --check / --verify and
-- scripts/bayna-security-probe.mjs (anon reads on all eight tables).

drop policy if exists "pricing_plans_select_active" on public.pricing_plans;
create policy "pricing_plans_select_active"
  on public.pricing_plans for select
  to authenticated
  using (is_active or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "subscription_orders_select_own" on public.subscription_orders;
create policy "subscription_orders_select_own"
  on public.subscription_orders for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "promo_services_select_active" on public.promo_services;
create policy "promo_services_select_active"
  on public.promo_services for select
  to authenticated
  using (is_active or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "listing_promos_select_own" on public.listing_promos;
create policy "listing_promos_select_own"
  on public.listing_promos for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "promo_credits_ledger_select_own" on public.promo_credits_ledger;
create policy "promo_credits_ledger_select_own"
  on public.promo_credits_ledger for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "banner_campaigns_select_own" on public.banner_campaigns;
create policy "banner_campaigns_select_own"
  on public.banner_campaigns for select
  to authenticated
  using (auth.uid() = created_by or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "listing_quota_log_select_own" on public.listing_quota_log;
create policy "listing_quota_log_select_own"
  on public.listing_quota_log for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));
