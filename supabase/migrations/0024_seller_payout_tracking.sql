-- 0024_seller_payout_tracking.sql
-- Batch 2: record manually verified external seller payouts (additive only).

alter table public.escrow_holds
  add column if not exists payout_status text not null default 'not_started'
    check (payout_status in ('not_started','pending','completed','failed')),
  add column if not exists payout_reference text,
  add column if not exists payout_evidence text,
  add column if not exists payout_recorded_by uuid references public.profiles(id),
  add column if not exists payout_recorded_at timestamptz;

create or replace function public.admin_record_seller_payout(
  p_request_id uuid,
  p_transfer_reference text,
  p_evidence text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.escrow_holds%rowtype;
begin
  if not has_min_role('moderator') then
    raise exception 'moderator only';
  end if;
  if p_transfer_reference is null or length(trim(p_transfer_reference)) = 0 then
    raise exception 'transfer reference required';
  end if;

  select * into v_hold from public.escrow_holds where request_id = p_request_id for update;
  if not found then
    raise exception 'escrow hold not found';
  end if;
  if v_hold.status not in ('held', 'released') then
    raise exception 'collection not verified';
  end if;
  if v_hold.payout_status = 'completed' then
    raise exception 'payout already recorded';
  end if;

  update public.escrow_holds
    set payout_status = 'completed',
        payout_reference = trim(p_transfer_reference),
        payout_evidence = p_evidence,
        payout_recorded_by = auth.uid(),
        payout_recorded_at = now()
    where id = v_hold.id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'record_seller_payout', 'escrow_holds', v_hold.id,
          jsonb_build_object('request_id', p_request_id, 'amount', v_hold.net_amount,
                             'reference', trim(p_transfer_reference)));

  return jsonb_build_object('status', 'completed', 'amount', v_hold.net_amount,
                            'reference', trim(p_transfer_reference));
end;
$$;

revoke execute on function public.admin_record_seller_payout(uuid, text, text) from public, anon;
grant execute on function public.admin_record_seller_payout(uuid, text, text) to authenticated;