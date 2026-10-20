-- BADAL — SaaS monetization: plans, subscriptions, promo, banners, payment orders
-- Depends on: 0001, 0003 (profiles.role), 0007 (platform_settings)

-- ─────────────────────────────────────────────
-- 1. pricing_plans — editable from admin
-- ─────────────────────────────────────────────
create table if not exists public.pricing_plans (
  id            text primary key,              -- 'free', 'starter', 'growth', 'business'
  name          text not null,
  description   text default '',
  price_egp     numeric(10,2) not null default 0,
  currency      text not null default 'EGP',
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly','yearly')),
  listing_quota int not null default 0,        -- new listings per cycle (0 = unlimited for free? no — free uses free tier)
  promo_credits int not null default 0,        -- promo credits per cycle
  has_store_page boolean not null default false,
  has_stats    boolean not null default false,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- seed defaults
insert into public.pricing_plans (id, name, description, price_egp, listing_quota, promo_credits, has_store_page, has_stats, sort_order) values
  ('free',     'مجاني',        '3 إعلانات مجانًا كل 30 يوم', 0, 0, 0, false, false, 0),
  ('starter',  'Seller Starter',  '50 إعلان + 3 رصيد ترويج شهريًا', 199, 50, 3, true, true, 1),
  ('growth',   'Seller Growth',   '150 إعلان + 10 أرصدة ترويج', 499, 150, 10, true, true, 2),
  ('business', 'Seller Business', '500 إعلان + 25 رصيد ترويج', 1299, 500, 25, true, true, 3)
on conflict (id) do nothing;

alter table public.pricing_plans enable row level security;
drop policy if exists "pricing_plans_select_active" on public.pricing_plans;
create policy "pricing_plans_select_active"
  on public.pricing_plans for select
  using (is_active or auth.uid() in (select id from public.profiles where role in ('admin','super_admin')));

-- ─────────────────────────────────────────────
-- 2. platform_settings — free-tier knobs
-- ─────────────────────────────────────────────
alter table public.platform_settings
  add column if not exists free_listings_per_cycle int not null default 3,
  add column if not exists free_cycle_days int not null default 30,
  add column if not exists per_listing_price_egp numeric(10,2) not null default 5,
  add column if not exists per_listing_days int not null default 30;

-- ─────────────────────────────────────────────
-- 3. subscriptions
-- ─────────────────────────────────────────────
create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  plan_id       text not null references public.pricing_plans (id),
  status        text not null default 'pending'
                  check (status in ('pending','active','expired','cancelled','failed')),
  started_at    timestamptz,
  expires_at    timestamptz,
  listing_used  int not null default 0,
  promo_credits_used int not null default 0,
  promo_credits_remaining int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin')));
-- no insert/update/delete from client — only via RPC

-- ─────────────────────────────────────────────
-- 4. subscription_orders (purchase requests)
-- ─────────────────────────────────────────────
create table if not exists public.subscription_orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  plan_id       text not null references public.pricing_plans (id),
  amount_egp    numeric(10,2) not null,
  status        text not null default 'pending'
                  check (status in ('pending','paid','failed','refunded')),
  payment_method text default 'trial' check (payment_method in ('trial','wallet_qr','instagram','card')),
  external_ref  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists subscription_orders_user_idx on public.subscription_orders (user_id);

alter table public.subscription_orders enable row level security;
drop policy if exists "subscription_orders_select_own" on public.subscription_orders;
create policy "subscription_orders_select_own"
  on public.subscription_orders for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin')));
-- no client insert — via RPC only

-- ─────────────────────────────────────────────
-- 5. promo_services (catalog)
-- ─────────────────────────────────────────────
create table if not exists public.promo_services (
  id            text primary key,              -- 'featured', 'top_category', 'bump'
  name          text not null,
  description   text default '',
  price_egp     numeric(10,2) not null,
  duration_days int not null default 7,
  promo_type    text not null check (promo_type in ('featured','top_category','bump')),
  promo_credits_cost int not null default 0,   -- credits if paying with plan credits
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.promo_services (id, name, description, price_egp, duration_days, promo_type, promo_credits_cost) values
  ('featured',      'Featured Ad — تمييز الإعلان',   'يظهر الإعلان مميزًا في نتائج البحث لمدة 7 أيام', 15, 7, 'featured', 1),
  ('top_category',  'Top of Category — أعلى الفئة',  'يظهر الإعلان في مقدمة فئته لمدة 7 أيام',       25, 7, 'top_category', 1),
  ('bump',          'Bump / Relist — إعادة رفع',     'يرفع الإعلان إلى أعلى نتائج فئته مرة واحدة',   5, 1, 'bump', 0)
on conflict (id) do nothing;

alter table public.promo_services enable row level security;
drop policy if exists "promo_services_select_active" on public.promo_services;
create policy "promo_services_select_active"
  on public.promo_services for select
  using (is_active or auth.uid() in (select id from public.profiles where role in ('admin','super_admin')));

-- ─────────────────────────────────────────────
-- 6. listing_promos (active promo orders)
-- ─────────────────────────────────────────────
create table if not exists public.listing_promos (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  service_id    text not null references public.promo_services (id),
  status        text not null default 'pending'
                  check (status in ('pending','active','expired','cancelled','failed')),
  payment_method text default 'trial' check (payment_method in ('trial','credits','wallet_qr','instagram')),
  started_at    timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists listing_promos_listing_idx on public.listing_promos (listing_id);
create index if not exists listing_promos_user_idx on public.listing_promos (user_id);

alter table public.listing_promos enable row level security;
drop policy if exists "listing_promos_select_own" on public.listing_promos;
create policy "listing_promos_select_own"
  on public.listing_promos for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin')));
-- no client insert/update — via RPC

-- ─────────────────────────────────────────────
-- 7. promo_credits_ledger (immutable)
-- ─────────────────────────────────────────────
create table if not exists public.promo_credits_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id),
  delta         int not null,                   -- +grant / -spend
  reason        text not null,
  actor_id      uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index if not exists promo_credits_ledger_user_idx on public.promo_credits_ledger (user_id);

alter table public.promo_credits_ledger enable row level security;
drop policy if exists "promo_credits_ledger_select_own" on public.promo_credits_ledger;
create policy "promo_credits_ledger_select_own"
  on public.promo_credits_ledger for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin')));
-- no client insert/update — via RPC only

-- ─────────────────────────────────────────────
-- 8. banner_campaigns
-- ─────────────────────────────────────────────
create table if not exists public.banner_campaigns (
  id            uuid primary key default gen_random_uuid(),
  advertiser_name text not null,
  contact_info  text not null,
  destination_url text default '',
  banner_slot   text not null default 'home_top' check (banner_slot in ('home_top','search_sidebar','category_header')),
  creative_path text,
  start_date    date,
  end_date      date,
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','active','expired')),
  price_egp     numeric(10,2) default 0,
  notes         text default '',
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.banner_campaigns enable row level security;
drop policy if exists "banner_campaigns_select_own" on public.banner_campaigns;
create policy "banner_campaigns_select_own"
  on banner_campaigns for select
  using (auth.uid() = created_by or auth.uid() in (select id from public.profiles where role in ('admin','super_admin')));
drop policy if exists "banner_campaigns_insert_own" on public.banner_campaigns;
create policy "banner_campaigns_insert_own"
  on banner_campaigns for insert
  with check (auth.uid() = created_by);

-- ─────────────────────────────────────────────
-- 9. listing_quota_log — track per-user free-cycle usage
-- ─────────────────────────────────────────────
create table if not exists public.listing_quota_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  listing_id    uuid references public.listings (id) on delete set null,
  cycle_start   date not null,
  cycle_end     date not null,
  created_at    timestamptz not null default now()
);
create index if not exists listing_quota_log_user_cycle_idx
  on public.listing_quota_log (user_id, cycle_start);

alter table public.listing_quota_log enable row level security;
drop policy if exists "listing_quota_log_select_own" on public.listing_quota_log;
create policy "listing_quota_log_select_own"
  on public.listing_quota_log for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin')));

-- ─────────────────────────────────────────────
-- 10. RPCs
-- ─────────────────────────────────────────────

-- check + consume listing quota atomically (called on publish)
create or replace function public.consume_listing_quota(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_sub_id uuid;
  v_plan_quota int;
  v_used int;
  v_free_used int;
  v_free_limit int;
  v_free_days int;
  v_cycle_start date;
  v_cycle_end date;
  v_settings record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role in ('admin','super_admin') then
    return jsonb_build_object('ok', true, 'source', 'admin');
  end if;

  -- check active subscription first
  select s.id, p.listing_quota, s.listing_used
    into v_sub_id, v_plan_quota, v_used
  from public.subscriptions s
  join public.pricing_plans p on p.id = s.plan_id
  where s.user_id = v_uid
    and s.status = 'active'
    and (s.expires_at is null or s.expires_at > now())
  order by s.expires_at desc nulls last
  limit 1;

  if v_sub_id is not null and v_plan_quota > 0 and v_used < v_plan_quota then
    update public.subscriptions
      set listing_used = listing_used + 1, updated_at = now()
      where id = v_sub_id;
    return jsonb_build_object('ok', true, 'source', 'subscription', 'remaining', v_plan_quota - v_used - 1);
  end if;

  -- free tier
  select * into v_settings from public.platform_settings where id = 1;
  v_free_limit := coalesce(v_settings.free_listings_per_cycle, 3);
  v_free_days  := coalesce(v_settings.free_cycle_days, 30);
  v_cycle_start := current_date - (v_free_days || ' days')::interval;
  v_cycle_end   := current_date;

  select count(*) into v_free_used
  from public.listing_quota_log
  where user_id = v_uid
    and cycle_start >= v_cycle_start
    and cycle_end <= v_cycle_end;

  if v_free_used >= v_free_limit then
    raise exception 'quota_exceeded';
  end if;

  insert into public.listing_quota_log (user_id, listing_id, cycle_start, cycle_end)
  values (v_uid, p_listing_id, v_cycle_start, v_cycle_end);

  return jsonb_build_object('ok', true, 'source', 'free', 'remaining', v_free_limit - v_free_used - 1);
end;
$$;

revoke all on function public.consume_listing_quota(uuid) from public;
grant execute on function public.consume_listing_quota(uuid) to authenticated;

-- get merchant account summary
create or replace function public.get_merchant_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sub record;
  v_plan record;
  v_free_used int;
  v_free_limit int;
  v_free_days int;
  v_cycle_start date;
  v_promo_credits int;
  v_settings record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select s.*, p.name as plan_name, p.description as plan_desc, p.price_egp,
         p.listing_quota, p.promo_credits, p.has_store_page, p.has_stats
    into v_sub
  from public.subscriptions s
  join public.pricing_plans p on p.id = s.plan_id
  where s.user_id = v_uid
    and s.status = 'active'
    and (s.expires_at is null or s.expires_at > now())
  order by s.expires_at desc nulls last
  limit 1;

  select * into v_settings from public.platform_settings where id = 1;
  v_free_limit := coalesce(v_settings.free_listings_per_cycle, 3);
  v_free_days  := coalesce(v_settings.free_cycle_days, 30);
  v_cycle_start := current_date - (v_free_days || ' days')::interval;

  select count(*) into v_free_used
  from public.listing_quota_log
  where user_id = v_uid
    and cycle_start >= v_cycle_start
    and cycle_end <= current_date;

  v_promo_credits := coalesce(v_sub.promo_credits_remaining, 0);

  return jsonb_build_object(
    'has_subscription', v_sub.id is not null,
    'plan_id', v_sub.plan_id,
    'plan_name', v_sub.plan_name,
    'plan_desc', v_sub.plan_desc,
    'price_egp', v_sub.price_egp,
    'listing_quota', v_sub.listing_quota,
    'listing_used', coalesce(v_sub.listing_used, 0),
    'promo_credits_remaining', v_promo_credits,
    'promo_credits_total', coalesce(v_sub.promo_credits, 0),
    'has_store_page', coalesce(v_sub.has_store_page, false),
    'has_stats', coalesce(v_sub.has_stats, false),
    'started_at', v_sub.started_at,
    'expires_at', v_sub.expires_at,
    'status', v_sub.status,
    'free_used', v_free_used,
    'free_limit', v_free_limit,
    'free_cycle_days', v_free_days,
    'per_listing_price', coalesce(v_settings.per_listing_price_egp, 5)
  );
end;
$$;

revoke all on function public.get_merchant_account() from public;
grant execute on function public.get_merchant_account() to authenticated;

-- purchase plan (trial / paid) — activates immediately when method='trial'
create or replace function public.purchase_plan(p_plan_id text, p_payment_method text default 'trial')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan record;
  v_order_id uuid;
  v_sub_id uuid;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_plan from public.pricing_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'plan_not_found';
  end if;

  if v_plan.price_egp <= 0 then
    raise exception 'free_plan_no_purchase';
  end if;

  insert into public.subscription_orders (user_id, plan_id, amount_egp, status, payment_method)
  values (v_uid, p_plan_id, v_plan.price_egp, 'pending', p_payment_method)
  returning id into v_order_id;

  if p_payment_method = 'trial' then
    -- trial/demo: activate immediately
    update public.subscription_orders set status = 'paid', updated_at = now() where id = v_order_id;

    -- expire old subs
    update public.subscriptions set status = 'expired', updated_at = now()
    where user_id = v_uid and status = 'active';

    v_expires := now() + interval '30 days';
    insert into public.subscriptions (user_id, plan_id, status, started_at, expires_at,
      promo_credits_remaining)
    values (v_uid, p_plan_id, 'active', now(), v_expires, v_plan.promo_credits)
    returning id into v_sub_id;

    -- ledger grant
    insert into public.promo_credits_ledger (user_id, subscription_id, delta, reason)
    values (v_uid, v_sub_id, v_plan.promo_credits, 'plan_grant:' || p_plan_id);

    return jsonb_build_object('ok', true, 'order_id', v_order_id, 'subscription_id', v_sub_id,
      'status', 'active', 'expires_at', v_expires);
  else
    -- real payment pending — do NOT activate
    return jsonb_build_object('ok', true, 'order_id', v_order_id, 'status', 'pending',
      'message', 'بانتظار تأكيد الدفع');
  end if;
end;
$$;

revoke all on function public.purchase_plan(text, text) from public;
grant execute on function public.purchase_plan(text, text) to authenticated;

-- purchase promo (trial/credits)
create or replace function public.purchase_promo(p_listing_id uuid, p_service_id text, p_payment_method text default 'trial')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_svc record;
  v_sub_id uuid;
  v_credits_left int;
  v_promo_id uuid;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_svc from public.promo_services where id = p_service_id and is_active = true;
  if not found then
    raise exception 'service_not_found';
  end if;

  -- verify listing ownership
  if not exists (select 1 from public.listings where id = p_listing_id and owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  if p_payment_method = 'credits' then
    select s.id, s.promo_credits_remaining into v_sub_id, v_credits_left
    from public.subscriptions s
    where s.user_id = v_uid and s.status = 'active'
      and (s.expires_at is null or s.expires_at > now())
    order by s.expires_at desc nulls last limit 1;

    if v_sub_id is null or coalesce(v_credits_left,0) < v_svc.promo_credits_cost then
      raise exception 'insufficient_credits';
    end if;

    update public.subscriptions
      set promo_credits_remaining = promo_credits_remaining - v_svc.promo_credits_cost,
          updated_at = now()
      where id = v_sub_id;

    insert into public.promo_credits_ledger (user_id, subscription_id, delta, reason)
    values (v_uid, v_sub_id, -v_svc.promo_credits_cost, 'promo_spend:' || p_service_id || ':' || p_listing_id);

    v_expires := now() + (v_svc.duration_days || ' days')::interval;
    insert into public.listing_promos (listing_id, user_id, service_id, status, payment_method, started_at, expires_at)
    values (p_listing_id, v_uid, p_service_id, 'active', 'credits', now(), v_expires)
    returning id into v_promo_id;

    return jsonb_build_object('ok', true, 'promo_id', v_promo_id, 'status', 'active',
      'credits_remaining', v_credits_left - v_svc.promo_credits_cost, 'expires_at', v_expires);
  elsif p_payment_method = 'trial' then
    v_expires := now() + (v_svc.duration_days || ' days')::interval;
    insert into public.listing_promos (listing_id, user_id, service_id, status, payment_method, started_at, expires_at)
    values (p_listing_id, v_uid, p_service_id, 'active', 'trial', now(), v_expires)
    returning id into v_promo_id;
    return jsonb_build_object('ok', true, 'promo_id', v_promo_id, 'status', 'active', 'expires_at', v_expires);
  else
    -- pending external payment
    insert into public.listing_promos (listing_id, user_id, service_id, status, payment_method)
    values (p_listing_id, v_uid, p_service_id, 'pending', p_payment_method)
    returning id into v_promo_id;
    return jsonb_build_object('ok', true, 'promo_id', v_promo_id, 'status', 'pending',
      'message', 'بانتظار تأكيد الدفع');
  end if;
end;
$$;

revoke all on function public.purchase_promo(uuid, text, text) from public;
grant execute on function public.purchase_promo(uuid, text, text) to authenticated;

-- admin: update plan
create or replace function public.admin_update_plan(
  p_id text, p_name text, p_description text, p_price_egp numeric,
  p_listing_quota int, p_promo_credits int, p_is_active boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','super_admin') then raise exception 'forbidden'; end if;

  update public.pricing_plans
    set name = p_name, description = p_description, price_egp = p_price_egp,
        listing_quota = p_listing_quota, promo_credits = p_promo_credits,
        is_active = p_is_active, updated_at = now()
    where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_update_plan(text,text,text,numeric,int,int,boolean) from public;
grant execute on function public.admin_update_plan(text,text,text,numeric,int,int,boolean) to authenticated;

-- admin: update promo service
create or replace function public.admin_update_promo_service(
  p_id text, p_name text, p_description text, p_price_egp numeric,
  p_duration_days int, p_promo_credits_cost int, p_is_active boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','super_admin') then raise exception 'forbidden'; end if;

  update public.promo_services
    set name = p_name, description = p_description, price_egp = p_price_egp,
        duration_days = p_duration_days, promo_credits_cost = p_promo_credits_cost,
        is_active = p_is_active, updated_at = now()
    where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_update_promo_service(text,text,text,numeric,int,int,boolean) from public;
grant execute on function public.admin_update_promo_service(text,text,text,numeric,int,int,boolean) to authenticated;

-- admin: update free-tier settings
create or replace function public.admin_update_saas_settings(
  p_free_per_cycle int, p_free_days int, p_per_listing_price numeric, p_per_listing_days int
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','super_admin') then raise exception 'forbidden'; end if;

  update public.platform_settings
    set free_listings_per_cycle = p_free_per_cycle,
        free_cycle_days = p_free_days,
        per_listing_price_egp = p_per_listing_price,
        per_listing_days = p_per_listing_days,
        updated_at = now()
    where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_update_saas_settings(int,int,numeric,int) from public;
grant execute on function public.admin_update_saas_settings(int,int,numeric,int) to authenticated;

-- admin: review banner
create or replace function public.admin_review_banner(p_id uuid, p_status text, p_price numeric, p_notes text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','super_admin') then raise exception 'forbidden'; end if;
  if p_status not in ('approved','rejected','active','expired') then raise exception 'bad_status'; end if;

  update public.banner_campaigns
    set status = p_status, price_egp = coalesce(p_price, price_egp), notes = p_notes, updated_at = now()
    where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_review_banner(uuid,text,numeric,text) from public;
grant execute on function public.admin_review_banner(uuid,text,numeric,text) to authenticated;

-- get active promos for a listing (public view)
create or replace function public.get_listing_promos(p_listing_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'service_id', lp.service_id,
    'promo_type', ps.promo_type,
    'expires_at', lp.expires_at
  )), '[]'::jsonb)
  into v_result
  from public.listing_promos lp
  join public.promo_services ps on ps.id = lp.service_id
  where lp.listing_id = p_listing_id
    and lp.status = 'active'
    and lp.expires_at > now();
  return v_result;
end;
$$;

revoke all on function public.get_listing_promos(uuid) from public;
grant execute on function public.get_listing_promos(uuid) to anon, authenticated;

-- get merchant store page (public)
create or replace function public.get_merchant_store(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_prof record;
begin
  select display_name, city, avatar_url into v_prof
  from public.profiles where id = p_user_id;
  if not found then raise exception 'not_found'; end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'display_name', v_prof.display_name,
    'city', v_prof.city,
    'avatar_url', v_prof.avatar_url,
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'title', l.title, 'listing_type', l.listing_type,
        'category', l.category, 'city', l.city, 'rental_price', l.rental_price,
        'sale_price', l.sale_price, 'created_at', l.created_at
      ))
      from public.listings l
      where l.owner_id = p_user_id and l.status = 'published'
      order by l.created_at desc
      limit 50
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_merchant_store(uuid) from public;
grant execute on function public.get_merchant_store(uuid) to anon, authenticated;

-- updated_at triggers
drop trigger if exists pricing_plans_updated_at on public.pricing_plans;
create trigger pricing_plans_updated_at before update on public.pricing_plans
  for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists subscription_orders_updated_at on public.subscription_orders;
create trigger subscription_orders_updated_at before update on public.subscription_orders
  for each row execute function public.set_updated_at();

drop trigger if exists promo_services_updated_at on public.promo_services;
create trigger promo_services_updated_at before update on public.promo_services
  for each row execute function public.set_updated_at();

drop trigger if exists listing_promos_updated_at on public.listing_promos;
create trigger listing_promos_updated_at before update on public.listing_promos
  for each row execute function public.set_updated_at();

drop trigger if exists banner_campaigns_updated_at on public.banner_campaigns;
create trigger banner_campaigns_updated_at before update on public.banner_campaigns
  for each row execute function public.set_updated_at();
