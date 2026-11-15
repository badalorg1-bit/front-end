-- BADAL 0037 — admin financial KPIs (SRS §11.1 / §19)
--
-- Why: the admin overview showed only activity counts; revenue, fees and
-- refunds were invisible. One RPC computes every figure in SQL (no JS scan
-- of escrow_holds) over a caller-supplied date window:
--   * escrow volume by hold status (held / released / refunded)
--   * platform fee earned (released only) + still-pending fee
--   * net paid out to owners (released only)
--   * unique payers / payees, cancelled bookings in the window
--   * point-in-time active subscriptions + paid subscription revenue in window
--
-- Unit note: escrow money is POINTS (0029). subscription_orders is the one
-- table still denominated in EGP, so it is reported separately as *_egp.
-- Window semantics: held_at >= from AND < to; orders use reviewed_at
-- (the date the payment was actually approved), requests use created_at.
-- Both bounds default to unbounded when null.
--
-- Access: moderator+ (same gate as the escrow read policy escrow_select_party
-- and the disputes tab, which already displays amounts).

create or replace function public.admin_get_financial_stats(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to   timestamptz := coalesce(p_to, 'infinity'::timestamptz);
begin
  if not has_min_role('moderator') then
    raise exception 'forbidden';
  end if;

  return (
    select jsonb_build_object(
      'from', p_from,
      'to', p_to,

      -- released money (the only money that actually moved to owners)
      'gross_released',  coalesce(sum(h.amount)      filter (where h.status = 'released'), 0),
      'released_count',  count(*)                    filter (where h.status = 'released'),
      'net_paid_out',    coalesce(sum(h.net_amount)  filter (where h.status = 'released'), 0),

      -- platform revenue
      'fee_earned',      coalesce(sum(h.fee_amount)  filter (where h.status = 'released'), 0),
      'fee_pending',     coalesce(sum(h.fee_amount)  filter (where h.status = 'held'), 0),

      -- money currently locked in escrow + refunds
      'gross_held',      coalesce(sum(h.amount)      filter (where h.status = 'held'), 0),
      'held_count',      count(*)                    filter (where h.status = 'held'),
      'gross_refunded',  coalesce(sum(h.amount)      filter (where h.status = 'refunded'), 0),
      'refunded_count',  count(*)                    filter (where h.status = 'refunded'),

      -- participants inside the window
      'payers_count',    count(distinct h.payer_id),
      'payees_count',    count(distinct h.payee_id),

      -- cancelled bookings + the SaaS side (orders keep their own EGP unit)
      'cancelled_requests', (
        select count(*)
        from public.listing_requests r
        where r.status = 'cancelled'
          and r.created_at >= v_from and r.created_at < v_to
      ),
      'active_subscriptions', (
        select count(*)
        from public.subscriptions s
        where s.status = 'active'
      ),
      'paid_orders', (
        select count(*)
        from public.subscription_orders o
        where o.status = 'paid'
          and o.reviewed_at >= v_from and o.reviewed_at < v_to
      ),
      'subscription_revenue_egp', coalesce((
        select sum(o.amount_egp)
        from public.subscription_orders o
        where o.status = 'paid'
          and o.reviewed_at >= v_from and o.reviewed_at < v_to
      ), 0)
    )
    from public.escrow_holds h
    where h.held_at >= v_from and h.held_at < v_to
  );
end;
$$;

revoke execute on function public.admin_get_financial_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_get_financial_stats(timestamptz, timestamptz) to authenticated;
