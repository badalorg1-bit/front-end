-- BADAL 0017 — pre-launch security hardening
-- Closes: role self-escalation via INSERT, trial free-activation, RPC role checks,
--         wallet IDOR, banner public insert, messages over-grant, storage holes.
-- Depends on: 0001–0016.

-- ===========================================================================
-- 1) profiles: lock INSERT + column-level UPDATE (no role / is_banned writes)
-- ===========================================================================
revoke insert on public.profiles from authenticated, anon;
-- profiles are created only via handle_new_user() trigger (security definer)

revoke update on public.profiles from authenticated;
grant update (display_name, city, avatar_url, updated_at,
              wallet_name, instagram_handle, whatsapp_phone, payment_note, payment_qr_path)
  on public.profiles to authenticated;
-- role and is_banned are NOT in the column grant → direct writes can't touch them

-- payment_qr_path must live under the caller's own folder when present
alter table public.profiles drop constraint if exists profiles_payment_qr_path_format;
alter table public.profiles
  add constraint profiles_payment_qr_path_format
  check (payment_qr_path is null
         or payment_qr_path ~ '^[0-9a-fA-F-]{36}/');

-- ===========================================================================
-- 2) protect_profile_privileges — also reject non-admin privilege writes
-- ===========================================================================
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role or new.is_banned is distinct from old.is_banned then
    if not has_min_role('admin') then
      new.role := old.role;
      new.is_banned := old.is_banned;
    end if;
  end if;

  if old.role = 'super_admin' and new.role is distinct from old.role then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'super_admin'
        and p.id <> old.id
        and p.is_banned = false
    ) then
      raise exception 'لا يمكن تخفيض صلاحية آخر مسؤول نظام';
    end if;
  end if;

  return new;
end;
$$;
-- trigger already exists; CREATE OR REPLACE keeps it attached

-- ===========================================================================
-- 3) kill trial auto-activation — paid plans/promos need QR + admin approval
-- ===========================================================================
create or replace function public.purchase_plan(p_plan_id text, p_payment_method text default 'wallet_qr')
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
  if public.is_user_banned(v_uid) then
    raise exception 'account is banned';
  end if;

  select * into v_plan from public.pricing_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if v_plan.price_egp <= 0 then
    raise exception 'free_plan_no_purchase';
  end if;
  if p_payment_method not in ('wallet_qr', 'instagram') then
    raise exception 'invalid_payment_method';
  end if;

  -- always create a pending order; admin activates after QR payment proof
  insert into public.subscription_orders (user_id, plan_id, amount_egp, status, payment_method)
  values (v_uid, p_plan_id, v_plan.price_egp, 'pending', p_payment_method)
  returning id into v_order_id;

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'status', 'pending',
    'message', 'بانتظار مراجعة الدفع من الإدارة');
end;
$$;
-- grant unchanged

create or replace function public.purchase_promo(p_listing_id uuid, p_service_id text, p_payment_method text default 'credits')
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
  if public.is_user_banned(v_uid) then
    raise exception 'account is banned';
  end if;

  select * into v_svc from public.promo_services where id = p_service_id and is_active = true;
  if not found then
    raise exception 'service_not_found';
  end if;

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
  else
    -- wallet_qr / instagram: pending until admin reviews
    insert into public.listing_promos (listing_id, user_id, service_id, status, payment_method)
    values (p_listing_id, v_uid, p_service_id, 'pending', p_payment_method)
    returning id into v_promo_id;
    return jsonb_build_object('ok', true, 'promo_id', v_promo_id, 'status', 'pending',
      'message', 'بانتظار مراجعة الدفع من الإدارة');
  end if;
end;
$$;

-- ===========================================================================
-- 4) admin RPCs: has_min_role instead of raw role-in checks
-- ===========================================================================
create or replace function public.admin_update_plan(
  p_id text, p_name text, p_description text, p_price_egp numeric,
  p_listing_quota int, p_promo_credits int, p_is_active boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not has_min_role('admin') then raise exception 'forbidden'; end if;

  update public.pricing_plans
    set name = p_name, description = p_description, price_egp = p_price_egp,
        listing_quota = p_listing_quota, promo_credits = p_promo_credits,
        is_active = p_is_active, updated_at = now()
    where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_update_promo_service(
  p_id text, p_name text, p_description text, p_price_egp numeric,
  p_duration_days int, p_promo_credits_cost int, p_is_active boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not has_min_role('admin') then raise exception 'forbidden'; end if;

  update public.promo_services
    set name = p_name, description = p_description, price_egp = p_price_egp,
        duration_days = p_duration_days, promo_credits_cost = p_promo_credits_cost,
        is_active = p_is_active, updated_at = now()
    where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_update_saas_settings(
  p_free_per_cycle int, p_free_days int, p_per_listing_price numeric, p_per_listing_days int
) returns jsonb
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

-- ===========================================================================
-- 5) get_wallet_balance — own balance only (admin via separate RPC later)
-- ===========================================================================
create or replace function public.get_wallet_balance(p_user_id uuid default null)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select balance from public.wallet_balances
     where user_id = auth.uid()),
    0
  );
$$;
-- p_user_id parameter kept for signature compatibility but ignored

-- ===========================================================================
-- 6) banner insert: authenticated only
-- ===========================================================================
drop policy if exists "banner_campaigns_insert_own" on public.banner_campaigns;
create policy "banner_campaigns_insert_own"
  on public.banner_campaigns for insert
  to authenticated
  with check (auth.uid() = created_by and not public.is_user_banned(auth.uid()));

-- ===========================================================================
-- 7) messages: column-level UPDATE (only read_at), conversations locked
-- ===========================================================================
drop policy if exists "messages_update_read" on public.messages;
create policy "messages_update_read"
  on public.messages for update
  to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  )
  with check (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

-- conversations: no client UPDATE (last_message_at touched only by SECURITY DEFINER RPCs)
revoke update on public.conversations from authenticated;

-- ===========================================================================
-- 8) attach_order_screenshot — path must be own-folder or subscription-screenshots/{order}
-- ===========================================================================
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
  if p_path is null or char_length(p_path) > 500 then
    raise exception 'invalid_path';
  end if;
  if not (
    p_path like v_uid::text || '/%'
    or p_path like 'subscription-screenshots/' || p_order_id::text || '/%'
  ) then
    raise exception 'invalid_path';
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

-- ===========================================================================
-- 9) storage: admin-only badal-platform folder + subscription-screenshots folder
-- ===========================================================================
-- admin can write platform QR under badal-platform/ in payment-qr bucket
drop policy if exists "payment_qr_platform_admin_insert" on storage.objects;
create policy "payment_qr_platform_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = 'badal-platform'
    and public.has_min_role('admin')
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  );

drop policy if exists "payment_qr_platform_admin_update" on storage.objects;
create policy "payment_qr_platform_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = 'badal-platform'
    and public.has_min_role('admin')
  )
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = 'badal-platform'
    and public.has_min_role('admin')
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  );

drop policy if exists "payment_qr_platform_admin_delete" on storage.objects;
create policy "payment_qr_platform_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = 'badal-platform'
    and public.has_min_role('admin')
  );

-- authenticated users can upload subscription screenshots under subscription-screenshots/
drop policy if exists "payment_qr_subshot_insert" on storage.objects;
create policy "payment_qr_subshot_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = 'subscription-screenshots'
    and not public.is_user_banned(auth.uid())
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  );

-- ===========================================================================
-- 10) tighten grants: is_user_banned / platform_settings / payment RPCs
-- ===========================================================================
revoke execute on function public.is_user_banned(uuid) from public;
grant execute on function public.is_user_banned(uuid) to authenticated;

-- platform_settings: no direct client select; RPCs only
revoke select on public.platform_settings from authenticated, anon;

-- escrow / payment settings readable by logged-in buyers only
revoke execute on function public.get_badal_payment_settings() from anon;
revoke execute on function public.get_escrow_fee_percent() from anon;

-- has_min_role: not needed by anon
revoke execute on function public.has_min_role(text) from anon;

-- ===========================================================================
-- 11) listing quota: idempotent consume + server-side trigger safety net
-- ===========================================================================
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

  -- idempotent: if this listing already consumed quota, return ok without re-counting
  if exists (select 1 from public.listing_quota_log where listing_id = p_listing_id) then
    return jsonb_build_object('ok', true, 'source', 'already_consumed');
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
    insert into public.listing_quota_log (user_id, listing_id, cycle_start, cycle_end)
    values (v_uid, p_listing_id, current_date, current_date + interval '30 days');
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

create or replace function public.enforce_listing_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published'
     and (old is null or old.status <> 'published') then
    perform public.consume_listing_quota(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_listing_quota on public.listings;
create trigger enforce_listing_quota
  before insert or update on public.listings
  for each row execute function public.enforce_listing_quota();

-- ===========================================================================
-- 12) audit log for payment-settings changes (already done in 0008 RPC)
-- ===========================================================================
-- done
