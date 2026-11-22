-- 0043_admin_rpc_hardening.sql
-- Closes security-pass.md findings: #10 (FOR UPDATE), #11 (admin double-check)
-- #12 needs NO SQL: verified live that 0039 already revoked public+anon from
-- get_my_payment_profile and all 28 admin_* RPCs (pub=false, anon=false,
-- auth=true). Remaining PUBLIC-executable functions are by design:
-- trigger helpers (firing role needs them, 0039 comment), policy guards
-- (has_min_role / has_permission / is_user_banned evaluated by querying role),
-- and public data RPCs (get_reviews_for_user, get_user_public_profile, ...).

-- =====================================================================
-- #10: Add FOR UPDATE to admin_review_subscription_order
-- Body copied verbatim from live definition; only the SELECT gains
-- `for update` so a double-click blocks then sees status <> 'pending'
-- and raises 'order_already_reviewed' instead of minting twice.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_review_subscription_order(p_order_id uuid, p_status text, p_notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select * into v_order from public.subscription_orders where id = p_order_id for update;
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
$function$;

-- =====================================================================
-- #11: admin_confirm_external_payment — gate moderator -> admin
-- Body copied verbatim from live definition; only the gate changes.
-- WHY: a single compromised moderator could flip an unpaid claim
-- (pending_confirmation) to 'held' and then release it (wallet_escrow_release
-- also lets moderators through, bypassing the return-code gate with an audit
-- row) — minting seller balance from nothing. Requiring admin = the approved
-- second approval. Signature stays (p_request_id uuid) so admin-api.ts:892
-- keeps working unchanged.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_confirm_external_payment(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hold public.escrow_holds%rowtype;
  v_request public.listing_requests%rowtype;
  v_bytes bytea;
  v_return_until timestamptz;
begin
  if not has_min_role('admin') then
    raise exception 'admin only';
  end if;
  select * into v_hold from public.escrow_holds where request_id = p_request_id for update;
  if not found then
    raise exception 'escrow hold not found';
  end if;
  if v_hold.status <> 'pending_confirmation' then
    raise exception 'escrow is not pending confirmation';
  end if;
  update public.escrow_holds set status = 'held', held_at = now() where id = v_hold.id;

  -- A2: mint both handover codes at the held moment (idempotent).
  select * into v_request from public.listing_requests where id = p_request_id;
  if found then
    v_return_until := case when v_request.rent_end is not null
                           then (v_request.rent_end + 7)::timestamp + interval '1 day' - interval '1 second'
                           else now() + interval '7 days'
                      end;

    v_bytes := extensions.gen_random_bytes(3);
    insert into public.booking_handover_codes (request_id, purpose, code, valid_until)
    values (p_request_id, 'delivery',
            lpad(((get_byte(v_bytes, 0) * 65536 + get_byte(v_bytes, 1) * 256 + get_byte(v_bytes, 2)) % 1000000)::text, 6, '0'),
            now() + interval '72 hours')
    on conflict (request_id, purpose) do nothing;

    v_bytes := extensions.gen_random_bytes(3);
    insert into public.booking_handover_codes (request_id, purpose, code, valid_until)
    values (p_request_id, 'return',
            lpad(((get_byte(v_bytes, 0) * 65536 + get_byte(v_bytes, 1) * 256 + get_byte(v_bytes, 2)) % 1000000)::text, 6, '0'),
            v_return_until)
    on conflict (request_id, purpose) do nothing;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'confirm_external_payment', 'escrow_holds', v_hold.id,
          jsonb_build_object('request_id', p_request_id, 'amount', v_hold.amount));
  return jsonb_build_object('status', 'held', 'amount', v_hold.amount);
end;
$function$;
