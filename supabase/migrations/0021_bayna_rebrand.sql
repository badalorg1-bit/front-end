-- Bayna rebrand (BRAND.md): user-visible strings only.
-- Internal identifiers (RPC names, column names, storage paths) stay unchanged.

-- ---------------------------------------------------------------------------
-- 1) platform_settings — display defaults
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  alter column badal_wallet_name set default 'بينا';

alter table public.platform_settings
  alter column badal_instagram set default '@bayna.egypt';

update public.platform_settings
set badal_wallet_name = 'بينا'
where id = 1
  and (badal_wallet_name is null or badal_wallet_name in ('بادال', 'بدّال'));

-- ---------------------------------------------------------------------------
-- 2) Existing wallet ledger notes (history shown in wallet UI)
-- ---------------------------------------------------------------------------
update public.wallet_transactions
set note = replace(note, 'بادال', 'بينا')
where note like '%بادال%';

-- ---------------------------------------------------------------------------
-- 3) Recreate escrow RPCs that emit wallet notes (grants preserved by
--    CREATE OR REPLACE; re-stated below to match project style)
-- ---------------------------------------------------------------------------
create or replace function public.wallet_escrow_pay(p_request_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.listing_requests%rowtype;
  v_fee numeric;
  v_fee_amount numeric;
  v_net numeric;
  v_hold_id uuid;
begin
  select * into v_request from public.listing_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found';
  end if;
  if v_request.status <> 'accepted' then
    raise exception 'escrow pay only allowed on accepted requests';
  end if;
  if v_request.request_type not in ('rent', 'purchase') then
    raise exception 'escrow not applicable for swap';
  end if;
  if auth.uid() <> v_request.requester_id then
    raise exception 'only the requester can pay into escrow';
  end if;
  if exists (select 1 from public.escrow_holds where request_id = p_request_id) then
    raise exception 'escrow already exists for this request';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> floor(p_amount) then
    raise exception 'amount must be a positive integer';
  end if;

  v_fee := coalesce(public.get_escrow_fee_percent(), 5);
  v_fee_amount := floor(p_amount * v_fee / 100.0);
  v_net := p_amount - v_fee_amount;

  update public.wallet_balances
  set balance = balance - p_amount, updated_at = now()
  where user_id = v_request.requester_id;

  if not found then
    raise exception 'insufficient balance or no wallet';
  end if;

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_request.requester_id, -p_amount, 'escrow_hold', p_request_id, 'حجز المبلغ لدى بينا');

  insert into public.escrow_holds (
    request_id, payer_id, payee_id, amount, fee_percent, fee_amount, net_amount, status, held_at
  ) values (
    p_request_id, v_request.requester_id, v_request.owner_id, p_amount, v_fee, v_fee_amount, v_net,
    'held', now()
  ) returning id into v_hold_id;

  return jsonb_build_object(
    'hold_id', v_hold_id,
    'amount', p_amount,
    'fee_percent', v_fee,
    'fee_amount', v_fee_amount,
    'net_amount', v_net,
    'status', 'held'
  );
end;
$$;

revoke execute on function public.wallet_escrow_pay(uuid, numeric) from public, anon;
grant execute on function public.wallet_escrow_pay(uuid, numeric) to authenticated;

create or replace function public.wallet_escrow_release(p_request_id uuid)
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
    raise exception 'only the seller can release escrow';
  end if;

  insert into public.wallet_balances (user_id, balance, updated_at)
  values (v_hold.payee_id, v_hold.net_amount, now())
  on conflict (user_id)
  do update set balance = public.wallet_balances.balance + excluded.balance,
                updated_at = now();

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payee_id, v_hold.net_amount, 'escrow_release', p_request_id,
          format('تحويل بعد خصم عمولة بينا %s%%', v_hold.fee_percent));

  insert into public.wallet_transactions (user_id, amount, kind, request_id, note)
  values (v_hold.payee_id, -v_hold.fee_amount, 'fee', p_request_id,
          format('عمولة الخدمة %s%%', v_hold.fee_percent));

  update public.escrow_holds
  set status = 'released', released_at = now()
  where id = v_hold.id;

  update public.listing_requests
  set payer_confirmed_at = coalesce(payer_confirmed_at, now()),
      payee_confirmed_at = coalesce(payee_confirmed_at, now()),
      paid_at = coalesce(paid_at, now()),
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'status', 'released',
    'amount', v_hold.amount,
    'fee_amount', v_hold.fee_amount,
    'net_amount', v_hold.net_amount,
    'released_at', now()
  );
end;
$$;

revoke execute on function public.wallet_escrow_release(uuid) from public, anon;
grant execute on function public.wallet_escrow_release(uuid) to authenticated;
