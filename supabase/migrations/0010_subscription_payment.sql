-- ============================================================
-- Migration 0010: Subscription payment flow (QR + screenshot + admin approval)
-- ============================================================

-- 1. Add screenshot + review fields to subscription_orders
alter table public.subscription_orders
  add column if not exists screenshot_path text,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text default '';

-- 2. New RPC: create_subscription_order (creates pending order only — no activation)
create or replace function public.create_subscription_order(p_plan_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan record;
  v_order_id uuid;
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
  values (v_uid, p_plan_id, v_plan.price_egp, 'pending', 'wallet_qr')
  returning id into v_order_id;

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'status', 'pending');
end;
$$;

revoke all on function public.create_subscription_order(text) from public;
grant execute on function public.create_subscription_order(text) to authenticated;

-- 3. New RPC: attach_order_screenshot (user attaches screenshot to their own pending order)
create or replace function public.attach_order_screenshot(p_order_id uuid, p_path text)
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

  update public.subscription_orders
  set screenshot_path = p_path, updated_at = now()
  where id = p_order_id and user_id = v_uid and status = 'pending';

  if not found then
    raise exception 'order_not_found_or_not_pending';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.attach_order_screenshot(uuid, text) from public;
grant execute on function public.attach_order_screenshot(uuid, text) to authenticated;

-- 4. New RPC: admin_review_subscription_order (approve → activate / reject)
create or replace function public.admin_review_subscription_order(
  p_order_id uuid,
  p_status text, -- 'paid' (approve) or 'failed' (reject)
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_order record;
  v_plan record;
  v_sub_id uuid;
  v_expires timestamptz;
begin
  -- check admin role
  select role into v_admin from public.profiles where id = v_uid;
  if v_admin not in ('admin', 'super_admin') then
    raise exception 'not_admin';
  end if;

  if p_status not in ('paid', 'failed') then
    raise exception 'invalid_status';
  end if;

  select * into v_order from public.subscription_orders where id = p_order_id;
  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order.status != 'pending' then
    raise exception 'order_already_reviewed';
  end if;

  -- update order
  update public.subscription_orders
  set status = p_status, reviewed_by = v_uid, reviewed_at = now(),
      review_notes = p_notes, updated_at = now()
  where id = p_order_id;

  if p_status = 'paid' then
    -- expire old active subs for this user
    update public.subscriptions set status = 'expired', updated_at = now()
    where user_id = v_order.user_id and status = 'active';

    -- get plan
    select * into v_plan from public.pricing_plans where id = v_order.plan_id;

    v_expires := now() + interval '30 days';
    insert into public.subscriptions (user_id, plan_id, status, started_at, expires_at,
      promo_credits_remaining)
    values (v_order.user_id, v_order.plan_id, 'active', now(), v_expires, v_plan.promo_credits)
    returning id into v_sub_id;

    -- ledger grant
    insert into public.promo_credits_ledger (user_id, subscription_id, delta, reason)
    values (v_order.user_id, v_sub_id, v_plan.promo_credits, 'plan_grant:' || v_order.plan_id);

    return jsonb_build_object('ok', true, 'status', 'paid', 'subscription_id', v_sub_id,
      'expires_at', v_expires);
  else
    return jsonb_build_object('ok', true, 'status', 'failed', 'message', 'تم رفض الطلب');
  end if;
end;
$$;

revoke all on function public.admin_review_subscription_order(uuid, text, text) from public;
grant execute on function public.admin_review_subscription_order(uuid, text, text) to authenticated;

-- 5. Modify get_merchant_account to include pending orders count
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
  v_active_count int;
  v_quota_used int;
  v_pending_orders int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- get active subscription
  select * into v_sub from public.subscriptions
  where user_id = v_uid and status = 'active' and expires_at > now()
  order by started_at desc limit 1;

  if not found then
    -- free tier
    select * into v_plan from public.pricing_plans where id = 'free';
    v_active_count := 0;
    v_quota_used := 0;
    v_pending_orders := 0;
    select count(*) into v_pending_orders from public.subscription_orders
    where user_id = v_uid and status = 'pending';

    return jsonb_build_object(
      'plan_id', 'free',
      'plan_name', v_plan.name,
      'plan_description', v_plan.description,
      'price_egp', v_plan.price_egp,
      'listing_quota', v_plan.listing_quota,
      'promo_credits', 0,
      'promo_credits_remaining', 0,
      'has_store_page', false,
      'has_stats', false,
      'status', 'free',
      'started_at', null,
      'expires_at', null,
      'days_left', null,
      'listings_used', v_active_count,
      'listings_remaining', v_plan.listing_quota,
      'pending_orders', v_pending_orders
    );
  end if;

  -- get plan
  select * into v_plan from public.pricing_plans where id = v_sub.plan_id;

  -- count active listings in current cycle
  select count(*) into v_active_count from public.listings
  where owner_id = v_uid and status = 'published'
    and created_at >= v_sub.started_at;

  v_quota_used := v_active_count;
  v_pending_orders := 0;
  select count(*) into v_pending_orders from public.subscription_orders
  where user_id = v_uid and status = 'pending';

  return jsonb_build_object(
    'plan_id', v_sub.plan_id,
    'plan_name', v_plan.name,
    'plan_description', v_plan.description,
    'price_egp', v_plan.price_egp,
    'listing_quota', v_plan.listing_quota,
    'promo_credits', v_plan.promo_credits,
    'promo_credits_remaining', v_sub.promo_credits_remaining,
    'has_store_page', v_plan.has_store_page,
    'has_stats', v_plan.has_stats,
    'status', v_sub.status,
    'started_at', v_sub.started_at,
    'expires_at', v_sub.expires_at,
    'days_left', (v_sub.expires_at - now())::int,
    'listings_used', v_quota_used,
    'listings_remaining', greatest(v_plan.listing_quota - v_active_count, 0),
    'pending_orders', v_pending_orders
  );
end;
$$;

revoke all on function public.get_merchant_account() from public;
grant execute on function public.get_merchant_account() to authenticated;
