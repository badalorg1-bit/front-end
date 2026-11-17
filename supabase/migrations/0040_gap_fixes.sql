-- BADAL 0040 — remaining gap fixes from tasks/security-pass.md + one P0
--
-- FIX-0 (P0, found while writing this batch): publishing a listing was
--   IMPOSSIBLE for any non-exempt user. The BEFORE INSERT trigger
--   enforce_listing_quota() -> consume_listing_quota(NEW.id) inserts into
--   listing_quota_log before the listings row exists, and
--   listing_quota_log_listing_id_fkey was NOT deferrable, so the FK check
--   fired immediately and the INSERT died with "violates foreign key
--   constraint listing_quota_log_listing_id_fkey". Proved live in a
--   ROLLED-BACK transaction with a role='user' owner (prod, today).
--   Fix: make the FK deferrable initially deferred — checked at COMMIT, when
--   the parent row exists. Nothing else about the constraint changes.
--
-- #5a purchase_promo: function-level whitelist on p_payment_method
--     ('trial','credits','wallet_qr','instagram'; anything else =
--     invalid_method). 'trial' stays: it is the UI's demo-payment button and
--     0017 already forces it to PENDING (admin activates) — removing it would
--     be a product decision, not a security fix.
-- #5b purchase_promo: the credits read now takes FOR UPDATE OF s, closing
--     the TOCTOU where 10 parallel orders against a 3-credit plan ended with
--     promo_credits_remaining = -7 and 10 active banners.
-- #6  consume_listing_quota: per-user advisory lock (count->insert race) +
--     idempotency scoped to user_id + not_owner for a foreign listing id.
-- #7  create_wallet_topup: one PENDING top-up per user (anti-flood).
-- F5  banner_campaigns insert policy: status must be 'pending', so a client
--     cannot self-activate a banner without admin review.
--
-- All function bodies below are copied verbatim from their source files
-- (0017:101, 0034:702, 0029:77) with only the marked edits; signatures are
-- unchanged, so the existing grants (incl. 0039's revokes) stay in force.

-- ── FIX-0: defer the quota-log FK (P0) ───────────────────────────────────
alter table public.listing_quota_log
  alter constraint listing_quota_log_listing_id_fkey deferrable initially deferred;

-- ── F5: banner insert policy ─────────────────────────────────────────────
drop policy if exists "banner_campaigns_insert_own" on public.banner_campaigns;
create policy "banner_campaigns_insert_own"
  on public.banner_campaigns for insert
  to authenticated
  -- F5: a client-crafted row can no longer skip admin review by writing
  -- status = 'active' directly (the table default is 'pending', and there
  -- is no owner UPDATE policy, so this is the only write path).
  with check (auth.uid() = created_by
              and not public.is_user_banned(auth.uid())
              and status = 'pending');

-- ── #5a + #5b: purchase_promo ────────────────────────────────────────────
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

  -- #5a: function-level whitelist. The table CHECK on
  -- listing_promos.payment_method is the second net; this turns any
  -- unknown method into a clean invalid_method instead of letting the
  -- insert path decide. 'trial' is the product's demo-payment method:
  -- it creates a PENDING order (admin activates), never an active one.
  if p_payment_method not in ('trial','credits','wallet_qr','instagram') then
    raise exception 'invalid_method';
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
    order by s.expires_at desc nulls last limit 1 for update of s;  -- #5b: TOCTOU lock

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

-- ── #6: consume_listing_quota ────────────────────────────────────────────
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

  -- #6: serialize every quota decision for THIS user (count -> insert race).
  perform pg_advisory_xact_lock(hashtextextended('listing_quota:' || v_uid::text, 0));

  -- idempotent, but only for the caller's own listing: a foreign listing id
  -- must never read as "already consumed" (#6a short-circuit).
  if exists (select 1 from public.listing_quota_log
             where listing_id = p_listing_id and user_id = v_uid) then
    return jsonb_build_object('ok', true, 'source', 'already_consumed');
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role in ('admin','super_admin','owner') then
    return jsonb_build_object('ok', true, 'source', 'admin');
  end if;

  -- #6: ownership. The row is not visible yet when the BEFORE INSERT trigger
  -- calls us (NEW.id) — "no row" = trigger path, accepted (the RLS insert
  -- policy already pins owner_id = auth.uid() there). A visible foreign
  -- listing, or a log row written by another user, is not_owner.
  if exists (select 1 from public.listings
             where id = p_listing_id and owner_id is distinct from v_uid) then
    raise exception 'not_owner';
  end if;
  if exists (select 1 from public.listing_quota_log where listing_id = p_listing_id) then
    raise exception 'not_owner';
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

-- ── #7: create_wallet_topup ──────────────────────────────────────────────
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

  -- #7: one pending top-up per user (anti-flood; the admin review resolves
  -- it, after which a new one may be filed).
  if exists (select 1 from public.wallet_topups
             where user_id = v_uid and status = 'pending') then
    raise exception 'pending_topup_exists';
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
