-- BADAL — fix pricing_plans RLS insufficient-privilege and excessive grants
-- Additive migration; does not edit previously applied migrations.

-- 1. Replace broad profiles-subquery policy with role-aware policies.
drop policy if exists "pricing_plans_select_active" on public.pricing_plans;

-- Public visitors (and anon clients) may read only active plans.
create policy "pricing_plans_select_active_anon"
  on public.pricing_plans for select
  to anon
  using (is_active = true);

-- Authenticated administrators may read all plans (including inactive).
create policy "pricing_plans_select_admin"
  on public.pricing_plans for select
  to authenticated
  using (public.has_min_role('admin'));

-- 2. Keep RLS enabled.
alter table public.pricing_plans enable row level security;

-- 3. Remove write-related privileges that are not required by any client code path.
-- Admin writes go through SECURITY DEFINER RPCs (admin_update_plan), not direct table DML.
revoke insert, update, delete, truncate, trigger, references
  on public.pricing_plans from anon, authenticated;

-- Preserve read access for public/admin flows.
grant select on public.pricing_plans to anon, authenticated;
