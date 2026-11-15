-- BADAL 0036 — audit the five admin actions that wrote no admin_audit_log row
--
-- Why (SRS §11.6 / gap C5): 0017_security.sql created these five RPCs without
-- an audit insert, so platform-settings, plan, promo-service, banner and
-- subscription-order changes were unreachable from the audit tab.
--   * admin_update_plan
--   * admin_update_promo_service
--   * admin_update_saas_settings
--   * admin_review_banner
--   * admin_review_subscription_order
--
-- Approach: re-create each function verbatim from 0017 and add exactly one
-- `insert into public.admin_audit_log` per action, following the pattern of
-- 0003/0007/0008/0018/0022/0024/0035. Signatures, gates and return shapes are
-- unchanged so the deployed frontend keeps working.
--
-- Note: pricing_plans.id and promo_services.id are TEXT primary keys, so
-- target_id (uuid) stays null for them and the id travels inside meta.

create or replace function public.admin_update_plan(
  p_id text, p_name text, p_description text, p_price_egp numeric,
  p_listing_quota int, p_promo_credits int, p_is_active boolean
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not has_min_role('admin') then raise exception 'forbidden'; end if;

  update public.pricing_plans
    set name = p_name, description = p_description, price_egp = p_price_egp,
        listing_quota = p_listing_quota, promo_credits = p_promo_credits,
        is_active = p_is_active, updated_at = now()
    where id = p_id;

  insert into public.admin_audit_log (actor_id, action, target_type, meta)
  values (auth.uid(), 'admin_update_plan', 'pricing_plans',
    jsonb_build_object(
      'plan_id', p_id, 'name', p_name, 'price_egp', p_price_egp,
      'listing_quota', p_listing_quota, 'promo_credits', p_promo_credits,
      'is_active', p_is_active
    ));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_update_promo_service(
  p_id text, p_name text, p_description text, p_price_egp numeric,
  p_duration_days int, p_promo_credits_cost int, p_is_active boolean
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not has_min_role('admin') then raise exception 'forbidden'; end if;

  update public.promo_services
    set name = p_name, description = p_description, price_egp = p_price_egp,
        duration_days = p_duration_days, promo_credits_cost = p_promo_credits_cost,
        is_active = p_is_active, updated_at = now()
    where id = p_id;

  insert into public.admin_audit_log (actor_id, action, target_type, meta)
  values (auth.uid(), 'admin_update_promo_service', 'promo_services',
    jsonb_build_object(
      'service_id', p_id, 'name', p_name, 'price_egp', p_price_egp,
      'duration_days', p_duration_days,
      'promo_credits_cost', p_promo_credits_cost, 'is_active', p_is_active
    ));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_update_saas_settings(
  p_free_per_cycle int, p_free_days int, p_per_listing_price numeric, p_per_listing_days int
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not has_min_role('admin') then raise exception 'forbidden'; end if;

  update public.platform_settings
    set free_listings_per_cycle = p_free_per_cycle,
        free_cycle_days = p_free_days,
        per_listing_price_egp = p_per_listing_price,
        per_listing_days = p_per_listing_days,
        updated_at = now()
    where id = 1;

  insert into public.admin_audit_log (actor_id, action, target_type, meta)
  values (auth.uid(), 'admin_update_saas_settings', 'platform_settings',
    jsonb_build_object(
      'free_listings_per_cycle', p_free_per_cycle,
      'free_cycle_days', p_free_days,
      'per_listing_price_egp', p_per_listing_price,
      'per_listing_days', p_per_listing_days
    ));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_review_banner(p_id uuid, p_status text, p_price numeric, p_notes text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not has_min_role('admin') then raise exception 'forbidden'; end if;
  if p_status not in ('approved','rejected','active','expired') then raise exception 'bad_status'; end if;

  update public.banner_campaigns
    set status = p_status, price_egp = coalesce(p_price, price_egp), notes = p_notes, updated_at = now()
    where id = p_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'admin_review_banner', 'banner_campaigns', p_id,
    jsonb_build_object('status', p_status, 'price_egp', coalesce(p_price, price_egp), 'notes', p_notes));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_review_subscription_order(
  p_order_id uuid,
  p_status text,
  p_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
  v_plan record;
  v_sub_id uuid;
  v_expires timestamptz;
begin
  if not has_min_role('admin') then
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

  update public.subscription_orders
  set status = p_status, reviewed_by = v_uid, reviewed_at = now(),
      review_notes = p_notes, updated_at = now()
  where id = p_order_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'admin_review_subscription_order', 'subscription_orders', p_order_id,
    jsonb_build_object('status', p_status, 'user_id', v_order.user_id, 'notes', p_notes));

  if p_status = 'paid' then
    update public.subscriptions set status = 'expired', updated_at = now()
    where user_id = v_order.user_id and status = 'active';

    select * into v_plan from public.pricing_plans where id = v_order.plan_id;

    v_expires := now() + interval '30 days';
    insert into public.subscriptions (user_id, plan_id, status, started_at, expires_at,
      promo_credits_remaining)
    values (v_order.user_id, v_order.plan_id, 'active', now(), v_expires, v_plan.promo_credits)
    returning id into v_sub_id;

    insert into public.promo_credits_ledger (user_id, subscription_id, delta, reason)
    values (v_order.user_id, v_sub_id, v_plan.promo_credits, 'plan_grant:' || v_order.plan_id);

    return jsonb_build_object('ok', true, 'status', 'paid', 'subscription_id', v_sub_id,
      'expires_at', v_expires);
  else
    return jsonb_build_object('ok', true, 'status', 'failed', 'message', 'تم رفض الطلب');
  end if;
end;
$$;
