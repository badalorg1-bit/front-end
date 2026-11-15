-- BADAL 0038 — audit the moderator override on escrow refunds
--
-- Why (SRS §11.5 + gap C5): wallet_escrow_release writes an admin_audit_log
-- row when a moderator bypasses the return-code gate (0028 §6), but its
-- sibling wallet_escrow_refund (0027 §3e) lets a moderator return held
-- points to the payer with NO audit row — money out with no trail. The
-- release/refund symmetry the platform relies on was one-sided.
--
-- Fix: re-create the function verbatim from 0027 and add ONE insert,
-- mirroring the release-bypass pattern. It fires only when the caller is
-- NOT the payee (i.e. a moderator override); the owner's own refund is
-- already covered by the wallet_transactions ledger row written below.
-- Signature, gates and return shape are unchanged.

create or replace function public.wallet_escrow_refund(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.escrow_holds%rowtype;
begin
  select * into v_hold from public.escrow_holds where request_id = p_request_id for update;
  if not found then
    raise exception 'escrow hold not found';
  end if;
  if v_hold.status <> 'held' then
    raise exception 'escrow is not held';
  end if;
  if auth.uid() <> v_hold.payee_id and not has_min_role('moderator') then
    raise exception 'only the seller or an admin can refund escrow';
  end if;

  -- C5/0038: a moderator moving money that is not theirs must leave a trail,
  -- exactly like the release bypass in 0028 §6.
  if auth.uid() <> v_hold.payee_id then
    insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
    values (auth.uid(), 'escrow_refund_moderator_override', 'escrow_holds', v_hold.id,
      jsonb_build_object(
        'request_id', p_request_id,
        'amount', v_hold.amount,
        'payment_method', v_hold.payment_method
      ));
  end if;

  insert into public.wallet_balances (user_id, balance, updated_at)
  values (v_hold.payer_id, v_hold.amount, now())
  on conflict (user_id)
  do update set balance = public.wallet_balances.balance + excluded.balance,
                updated_at = now();

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payer_id, v_hold.amount, 'escrow_refund', p_request_id, 'إعادة المبلغ المحجوز');

  update public.escrow_holds
  set status = 'refunded', refunded_at = now()
  where id = v_hold.id;

  -- M2: money went back, so the unit goes back to stock.
  update public.listings l
     set quantity = quantity + 1, updated_at = now()
    from public.listing_requests r
   where r.id = p_request_id and l.id = r.listing_id;

  return jsonb_build_object('status', 'refunded', 'amount', v_hold.amount);
end;
$$;

revoke execute on function public.wallet_escrow_refund(uuid) from public, anon;
grant execute on function public.wallet_escrow_refund(uuid) to authenticated;
