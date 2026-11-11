-- BADAL 0033 - delivery: manual courier orders + owner delivery settings (SRS §9 · A6)
--
-- Why this exists:
--   Gap A6: «لا توصيل ولا تسليم/إرجاع مُدار» (§9 · §7.1 steps 13-16 · §17.12).
--   §9.1 requires delivery methods (pickup / agreed location / contracted
--   company); §9.2 requires: delivery-address entry, per-listing delivery
--   toggle, delivery fee display, order data recording, the courier's order
--   number, status updates, proof of delivery, delay/failure logging and a
--   linked complaint; §9.3 allows STARTING with manual admin entry until a
--   real courier API exists (approved assumption: v1 = manual entry).
--   Handover CODES (§7.4) already exist from 0028 for in-person exchange —
--   this migration covers the COURIER path and the §7.1 steps 13-16 trail.
--
-- What it does:
--   1. listings: delivery_available + delivery_fee (owner sets at publish,
--      §9.2 «تحديد إمكانية توصيل المنتج» / «عرض رسوم التوصيل»).
--   2. listing_requests: delivery_requested + delivery_address (§9.2
--      «إدخال عنوان التسليم») + a BEFORE trigger enforcing: rent-only,
--      address present, and the listing must actually offer delivery —
--      the check is SERVER-side (§4.9 principle).
--   3. delivery_orders: ONE row per booking (request_id UNIQUE) holding
--      provider (multi-provider-ready text, §9.3), courier_order_no (§9.2
--      «حفظ رقم الطلب لدى شركة التوصيل»), fee snapshot, address snapshot,
--      status (assigned|shipped|delayed|delivered|failed), delay/failure
--      note, proof of delivery (delivered_to + delivered_at), audit trail.
--      RLS enabled + ALL grants revoked: security-definer RPCs only
--      (0028 pattern — no client can touch the table directly).
--   4. RPCs (all authenticated; admin ones moderator+):
--      * admin_create_delivery_order(request, provider, order no, fee, address)
--        — requires an ACCEPTED booking, one order per booking; notifies
--        BOTH parties (§7.1 step 13 «تُرسل تعليمات التسليم») + audit.
--      * admin_update_delivery_order(request, status, note, delivered_to)
--        — strict transitions; delayed/failed REQUIRE a note (≥10 chars);
--          delivered REQUIRES delivered_to + stamps delivered_at (§9.2
--          «إثبات التسليم» / «تسجيل حالات التأخير أو فشل»); terminal states
--          are immutable; audit + both parties notified.
--      * get_delivery_order(request) — the two participants (or a
--        moderator) read their order's live status.
--      * admin_list_delivery_orders() — orders + eligible accepted bookings
--        (for the manual-entry form) + linked delivery complaints (§9.2
--        «فتح شكوى مرتبطة للتوصيل» — complaints already carry type
--        'مشكلة في التوصيل' from 0030).
--
-- 0033 writes NO data rows — a re-run is idempotent (add column if not
-- exists / create table if not exists / drop trigger if exists).
--
-- Verification (scripts/bayna-apply-0033.mjs):
--   1. 0032 applied (check_listing_availability exists) — ordering gate.
--   2. Columns exist; trigger installed; delivery_orders exists with RLS
--      on and every grant revoked.
--   3. All four RPCs exist, granted to authenticated, denied to anon/public.
--   4. prosrc carries the §9.2 gates (address, provider, order no, note,
--      delivered_to, transitions, accepted-booking gate, one-order rule).
--   5. Zero data rows written.

-- ---------------------------------------------------------------------------
-- 1) listings: can this listing be delivered, and at what fee? (§9.2)
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists delivery_available boolean not null default false,
  add column if not exists delivery_fee numeric not null default 0;

alter table public.listings drop constraint if exists listings_delivery_fee_non_negative;
alter table public.listings
  add constraint listings_delivery_fee_non_negative check (delivery_fee >= 0);

-- ---------------------------------------------------------------------------
-- 2) listing_requests: the tenant's delivery choice (§9.2)
-- ---------------------------------------------------------------------------
alter table public.listing_requests
  add column if not exists delivery_requested boolean not null default false,
  add column if not exists delivery_address text;

alter table public.listing_requests drop constraint if exists listing_requests_delivery_address_len;
alter table public.listing_requests
  add constraint listing_requests_delivery_address_len
  check (delivery_address is null or (char_length(delivery_address) between 5 and 300));

-- Server-side enforcement of the §9.2 rules on every insert/update:
-- delivery is rent-only, needs an address, and the listing must offer it.
create or replace function public.enforce_delivery_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings%rowtype;
begin
  if coalesce(new.delivery_requested, false) then
    if new.request_type <> 'rent' then
      raise exception 'delivery_rent_only';
    end if;
    if new.delivery_address is null
       or char_length(btrim(new.delivery_address)) < 5
       or char_length(btrim(new.delivery_address)) > 300 then
      raise exception 'delivery_address_required';
    end if;
    select * into v_listing from public.listings where id = new.listing_id;
    if not found or not v_listing.delivery_available then
      raise exception 'delivery_not_available';
    end if;
    new.delivery_address := btrim(new.delivery_address);
  end if;
  return new;
end;
$$;

drop trigger if exists listing_requests_enforce_delivery on public.listing_requests;
create trigger listing_requests_enforce_delivery
  before insert or update on public.listing_requests
  for each row execute function public.enforce_delivery_fields();

-- ---------------------------------------------------------------------------
-- 3) delivery_orders: one courier order per booking (§9.2 / §9.3)
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.listing_requests (id) on delete cascade,
  provider text not null check (char_length(provider) between 2 and 120),
  courier_order_no text check (courier_order_no is null or char_length(courier_order_no) <= 80),
  delivery_fee numeric not null default 0 check (delivery_fee >= 0),
  address text not null check (char_length(address) between 5 and 300),
  status text not null default 'assigned'
    check (status in ('assigned', 'shipped', 'delayed', 'delivered', 'failed')),
  status_note text check (status_note is null or char_length(status_note) <= 500),
  delivered_to text check (delivered_to is null or char_length(delivered_to) <= 120),
  delivered_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- §9.2 «إثبات التسليم»: a delivered order always carries WHO + WHEN.
  constraint delivery_orders_delivered_proof
    check (status <> 'delivered' or (delivered_at is not null and delivered_to is not null)),
  -- §9.2 «تسجيل حالات التأخير أو فشل التوصيل»: both states carry a reason.
  constraint delivery_orders_delay_or_fail_note
    check (status not in ('delayed', 'failed') or status_note is not null)
);

create index if not exists delivery_orders_status_idx
  on public.delivery_orders (status, updated_at desc);

drop trigger if exists delivery_orders_updated_at on public.delivery_orders;
create trigger delivery_orders_updated_at
  before update on public.delivery_orders
  for each row execute function public.set_updated_at();

-- RPC-only table (0028 pattern): RLS on, NO policies, every grant revoked.
alter table public.delivery_orders enable row level security;
revoke all on public.delivery_orders from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) admin_create_delivery_order — manual courier entry (§9.3 v1 path)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_delivery_order(
  p_request_id uuid,
  p_provider text,
  p_courier_order_no text default null,
  p_delivery_fee numeric default null,
  p_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.listing_requests%rowtype;
  v_listing public.listings%rowtype;
  v_provider text := btrim(coalesce(p_provider, ''));
  v_order_no text := nullif(btrim(coalesce(p_courier_order_no, '')), '');
  v_address text;
  v_fee numeric;
  v_title text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_min_role('moderator') then
    raise exception 'permission denied';
  end if;

  -- §9.2 «تسجيل بيانات الطلب» — provider is the minimum record.
  if char_length(v_provider) < 2 then
    raise exception 'provider_required';
  end if;
  if char_length(v_provider) > 120 then
    raise exception 'provider_too_long';
  end if;
  if v_order_no is not null and char_length(v_order_no) > 80 then
    raise exception 'courier_order_no_too_long';
  end if;

  select * into v_request from public.listing_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found';
  end if;
  -- A courier order makes sense only for a live, confirmed booking (§7.1 step 13).
  if v_request.status <> 'accepted' then
    raise exception 'delivery_requires_accepted_booking';
  end if;

  -- One order per booking (table UNIQUE enforces it; friendlier gate first).
  if exists (select 1 from public.delivery_orders where request_id = p_request_id) then
    raise exception 'delivery_order_exists';
  end if;

  select * into v_listing from public.listings where id = v_request.listing_id;
  v_title := coalesce(v_listing.title, 'الإعلان');

  -- Address: explicit arg, else the tenant's §9.2 address, else refuse.
  v_address := nullif(btrim(coalesce(p_address, '')), '');
  if v_address is null then
    v_address := v_request.delivery_address;
  end if;
  if v_address is null or char_length(v_address) < 5 or char_length(v_address) > 300 then
    raise exception 'delivery_address_required';
  end if;

  -- Fee: explicit arg, else the listing's advertised fee (§9.2 display).
  v_fee := coalesce(p_delivery_fee, v_listing.delivery_fee, 0);
  if v_fee < 0 then
    raise exception 'delivery_fee_invalid';
  end if;

  insert into public.delivery_orders
    (request_id, provider, courier_order_no, delivery_fee, address, created_by)
  values (p_request_id, v_provider, v_order_no, v_fee, v_address, v_uid);

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (
    v_uid, 'create_delivery_order', 'listing_requests', p_request_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'listing_title', v_title,
      'provider', v_provider,
      'courier_order_no', coalesce(v_order_no, ''),
      'delivery_fee', v_fee
    )
  );

  -- §7.1 step 13 — BOTH parties learn the delivery instructions.
  perform public.notify_user(
    v_request.requester_id,
    'تعليمات التسليم',
    'سُجِّل توصيل "' || v_title || '" عبر ' || v_provider ||
      case when v_order_no is not null then ' — رقم الطلب: ' || v_order_no else '' end ||
      '. العنوان: ' || v_address,
    'request',
    v_request.listing_id
  );
  perform public.notify_user(
    v_request.owner_id,
    'تعليمات التسليم',
    'سُجِّل توصيل "' || v_title || '" عبر ' || v_provider ||
      case when v_order_no is not null then ' — رقم الطلب: ' || v_order_no else '' end ||
      '. العنوان: ' || v_address,
    'request',
    v_request.listing_id
  );

  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', 'assigned');
end;
$$;

revoke execute on function public.admin_create_delivery_order(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.admin_create_delivery_order(uuid, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) admin_update_delivery_order — status trail + proof + delay/failure (§9.2)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_delivery_order(
  p_request_id uuid,
  p_status text,
  p_status_note text default null,
  p_delivered_to text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.delivery_orders%rowtype;
  v_request public.listing_requests%rowtype;
  v_title text;
  v_note text := nullif(btrim(coalesce(p_status_note, '')), '');
  v_to text := nullif(btrim(coalesce(p_delivered_to, '')), '');
  v_label text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_min_role('moderator') then
    raise exception 'permission denied';
  end if;
  if p_status not in ('assigned', 'shipped', 'delayed', 'delivered', 'failed') then
    raise exception 'invalid_delivery_status';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'delivery_note_too_long';
  end if;

  select * into v_order from public.delivery_orders where request_id = p_request_id for update;
  if not found then
    raise exception 'delivery_order_not_found';
  end if;

  -- Terminal states are immutable — a proof of delivery or a final failure
  -- is a record, not a draft.
  if v_order.status in ('delivered', 'failed') then
    raise exception 'delivery_order_closed';
  end if;
  -- Strict transitions: no no-ops, only forward movement through the trail.
  if p_status = v_order.status
     or not (
       (v_order.status = 'assigned'   and p_status in ('shipped', 'delayed', 'delivered', 'failed'))
    or (v_order.status = 'shipped'    and p_status in ('delayed', 'delivered', 'failed'))
    or (v_order.status = 'delayed'    and p_status in ('shipped', 'delivered', 'failed'))
     ) then
    raise exception 'invalid_delivery_transition';
  end if;

  -- §9.2 «تسجيل حالات التأخير أو فشل التوصيل»: a reason is mandatory.
  if p_status in ('delayed', 'failed') then
    if v_note is null or char_length(v_note) < 10 then
      raise exception 'delivery_note_required';
    end if;
  end if;
  -- §9.2 «إثبات التسليم»: WHO received it is mandatory.
  if p_status = 'delivered' then
    if v_to is null or char_length(v_to) < 2 or char_length(v_to) > 120 then
      raise exception 'delivered_to_required';
    end if;
  end if;

  select title into v_title from public.listings where id =
    (select listing_id from public.listing_requests where id = p_request_id);
  v_title := coalesce(v_title, 'الإعلان');

  update public.delivery_orders
     set status = p_status,
         status_note = case when p_status in ('delayed', 'failed') then v_note
                            else coalesce(v_order.status_note, v_note) end,
         delivered_to = case when p_status = 'delivered' then v_to
                             else v_order.delivered_to end,
         delivered_at = case when p_status = 'delivered' then now()
                             else v_order.delivered_at end
   where request_id = p_request_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (
    v_uid, 'update_delivery_order', 'listing_requests', p_request_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'from', v_order.status,
      'to', p_status,
      'note', coalesce(v_note, '')
    )
  );

  v_label := case p_status
    when 'assigned'  then 'سُجِّل طلب التوصيل'
    when 'shipped'   then 'خرجت الشحنة للتوصيل'
    when 'delayed'   then 'تأخر التوصيل'
    when 'delivered' then 'تم التسليم'
    when 'failed'    then 'فشل التوصيل'
  end;

  perform public.notify_user(
    (select requester_id from public.listing_requests where id = p_request_id),
    'تحديث التوصيل',
    v_label || ' — "' || v_title || '"' ||
      case when v_note is not null then '. ' || v_note else '' end,
    'request',
    (select listing_id from public.listing_requests where id = p_request_id)
  );
  perform public.notify_user(
    (select owner_id from public.listing_requests where id = p_request_id),
    'تحديث التوصيل',
    v_label || ' — "' || v_title || '"' ||
      case when v_note is not null then '. ' || v_note else '' end,
    'request',
    (select listing_id from public.listing_requests where id = p_request_id)
  );

  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', p_status);
end;
$$;

revoke execute on function public.admin_update_delivery_order(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_delivery_order(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) get_delivery_order — participants read their live status (§9.2)
-- ---------------------------------------------------------------------------
create or replace function public.get_delivery_order(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.listing_requests%rowtype;
  v_order public.delivery_orders%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select * into v_request from public.listing_requests where id = p_request_id;
  if not found then
    raise exception 'request not found';
  end if;
  if v_uid <> v_request.requester_id
     and v_uid <> v_request.owner_id
     and not public.has_min_role('moderator') then
    raise exception 'not a participant';
  end if;

  select * into v_order from public.delivery_orders where request_id = p_request_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'request_id', v_order.request_id,
    'provider', v_order.provider,
    'courier_order_no', v_order.courier_order_no,
    'delivery_fee', v_order.delivery_fee,
    'address', v_order.address,
    'status', v_order.status,
    'status_note', v_order.status_note,
    'delivered_to', v_order.delivered_to,
    'delivered_at', v_order.delivered_at,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at
  );
end;
$$;

revoke execute on function public.get_delivery_order(uuid) from public, anon;
grant execute on function public.get_delivery_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) admin_list_delivery_orders — the §9.2 tracking board (moderator+)
--    orders + eligible accepted bookings + linked delivery complaints.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_delivery_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_orders jsonb := '[]'::jsonb;
  v_eligible jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_min_role('moderator') then
    raise exception 'permission denied';
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'request_id', o.request_id,
             'provider', o.provider,
             'courier_order_no', o.courier_order_no,
             'delivery_fee', o.delivery_fee,
             'address', o.address,
             'status', o.status,
             'status_note', o.status_note,
             'delivered_to', o.delivered_to,
             'delivered_at', o.delivered_at,
             'created_at', o.created_at,
             'updated_at', o.updated_at,
             'listing_title', l.title,
             'listing_city', l.city,
             'requester_name', rp.display_name,
             'owner_name', op.display_name,
             'rent_start', q.rent_start,
             'rent_end', q.rent_end,
             -- §9.2 «فتح شكوى مرتبطة بالتوصيل» (0030 already types them).
             'complaints', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'reference', c.reference,
                        'complaint_type', c.complaint_type,
                        'status', c.status
                      ))
                 from public.complaints c
                where c.request_id = o.request_id
                  and c.complaint_type = 'مشكلة في التوصيل'
             ), '[]'::jsonb)
           ) order by o.updated_at desc
         ), '[]'::jsonb)
    into v_orders
    from public.delivery_orders o
    join public.listing_requests q on q.id = o.request_id
    join public.listings l on l.id = q.listing_id
    join public.profiles rp on rp.id = q.requester_id
    join public.profiles op on op.id = q.owner_id;

  -- Manual-entry candidates: confirmed bookings with no order yet (§9.3).
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'request_id', q.id,
             'listing_title', l.title,
             'listing_city', l.city,
             'requester_name', rp.display_name,
             'owner_name', op.display_name,
             'rent_start', q.rent_start,
             'rent_end', q.rent_end,
             'delivery_requested', q.delivery_requested,
             'delivery_address', q.delivery_address,
             'listing_delivery_fee', l.delivery_fee
           ) order by q.created_at
         ), '[]'::jsonb)
    into v_eligible
    from public.listing_requests q
    join public.listings l on l.id = q.listing_id
    join public.profiles rp on rp.id = q.requester_id
    join public.profiles op on op.id = q.owner_id
   where q.status = 'accepted'
     and not exists (select 1 from public.delivery_orders o where o.request_id = q.id);

  return jsonb_build_object('orders', v_orders, 'eligible', v_eligible);
end;
$$;

revoke execute on function public.admin_list_delivery_orders() from public, anon;
grant execute on function public.admin_list_delivery_orders() to authenticated;
