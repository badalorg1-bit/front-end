-- ===========================================================================
-- BADAL 0028 — booking handover codes (SRS §7.4) + booking summary gate (A5
-- is UI-only; this file is the A2 backend).
--
-- After the escrow hold goes 'held', the system generates TWO 6-digit codes
-- per request:
--   * delivery — the OWNER reads it and dictates it to the tenant in person;
--                the TENANT types it in to prove the item changed hands.
--   * return   — the TENANT reads it and dictates it to the owner in person;
--                the OWNER types it in to prove the item came back.
-- Each party can only READ its own code (the other party's code is the
-- secret they must receive physically), so nobody can verify a handover they
-- did not attend. A moderator sees status only — never a code.
--
-- wallet_escrow_release (0027) gains one gate: the return code must be
-- verified before the payee can take the money out. A moderator may bypass
-- it, but every bypass is written to admin_audit_log.
--
-- Design notes / deliberate choices:
--   * Codes are stored PLAINTEXT inside a table that is locked down twice
--     (RLS with zero policies + revoke all): a hash would make the code
--     write-only, but the designated reader must SEE it later (the system
--     generates it, the human dictation happens minutes later).
--   * A wrong code returns jsonb {ok:false} instead of raising, because a
--     raise would roll back the attempt increment it just wrote.
--   * No conditional sequence between delivery and return (v1): each code is
--     independent evidence; refund stays ungated; the moderator is the
--     escape hatch for expired/lost codes (no regeneration in v1).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Table: one row per (request, purpose). Fully blocked for clients.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_handover_codes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.listing_requests (id) on delete cascade,
  purpose text not null check (purpose in ('delivery', 'return')),
  code text not null check (code ~ '^[0-9]{6}$'),
  valid_until timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 10),
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  condition_note text check (condition_note is null or char_length(condition_note) <= 1000),
  photos text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint booking_handover_codes_unique unique (request_id, purpose)
);

-- RLS with NO policies (every client query returns nothing) + revoke the
-- default Supabase table grants: the security-definer RPCs below are the
-- only door in or out.
alter table public.booking_handover_codes enable row level security;
revoke all on public.booking_handover_codes from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Backfill: any hold that is already 'held' (production: 0 rows today)
--    gets its codes. Idempotent — never overwrites an existing row.
-- ---------------------------------------------------------------------------
insert into public.booking_handover_codes (request_id, purpose, code, valid_until)
select x.request_id,
       x.purpose,
       x.code,
       x.valid_until
from (
  select h.request_id,
         v.purpose,
         lpad(((get_byte(gb.b, 0) * 65536 + get_byte(gb.b, 1) * 256 + get_byte(gb.b, 2)) % 1000000)::text, 6, '0') as code,
         case v.purpose
           when 'delivery' then now() + interval '72 hours'
           else case when r.rent_end is not null
                     then (r.rent_end + 7)::timestamp + interval '1 day' - interval '1 second'
                     else now() + interval '7 days'
                end
         end as valid_until
  from public.escrow_holds h
  join public.listing_requests r on r.id = h.request_id
  cross join (values ('delivery'), ('return')) as v(purpose)
  cross join lateral extensions.gen_random_bytes(3) as gb(b)
  where h.status = 'held'
) x
where not exists (
  select 1 from public.booking_handover_codes c
  where c.request_id = x.request_id and c.purpose = x.purpose
);

-- ---------------------------------------------------------------------------
-- 3) get_handover_codes — each party reads only what it may see:
--      owner   -> the delivery code (they dictate it),
--      tenant  -> the return code   (they dictate it),
--      moderator -> codes are always NULL (status/evidence only).
--    Everyone authorized also sees the recorded condition evidence.
-- ---------------------------------------------------------------------------
create or replace function public.get_handover_codes(p_request_id uuid)
returns table (
  purpose text,
  code text,
  valid_until timestamptz,
  attempts integer,
  max_attempts integer,
  used_at timestamptz,
  used_by uuid,
  condition_note text,
  photos text[],
  is_expired boolean,
  is_locked boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.listing_requests%rowtype;
  v_is_mod boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select * into v_request from public.listing_requests where id = p_request_id;
  if not found then
    raise exception 'request not found';
  end if;
  v_is_mod := public.has_min_role('moderator');
  if not v_is_mod and v_uid not in (v_request.requester_id, v_request.owner_id) then
    raise exception 'not a participant';
  end if;

  return query
  select
    c.purpose,
    case
      when v_is_mod then null::text
      when c.purpose = 'delivery' and v_uid = v_request.owner_id then c.code
      when c.purpose = 'return' and v_uid = v_request.requester_id then c.code
      else null
    end as code,
    c.valid_until,
    c.attempts,
    10 as max_attempts,
    c.used_at,
    c.used_by,
    c.condition_note,
    c.photos,
    (c.valid_until < now()) as is_expired,
    (c.attempts >= 10) as is_locked
  from public.booking_handover_codes c
  where c.request_id = p_request_id
  order by c.purpose;
end;
$$;

revoke execute on function public.get_handover_codes(uuid) from public, anon;
grant execute on function public.get_handover_codes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) verify_handover_code — the server-side check (SRS §7.4):
--      * the verifier is the party that does NOT read the code
--        (delivery -> tenant, return -> owner),
--      * the hold must be 'held', the code unused and unexpired,
--      * max 10 attempts (wrong code increments + returns {ok:false}; a raise
--        here would roll the increment back),
--      * Arabic-Indic / Extended Arabic-Indic digits are normalized,
--      * a condition note is mandatory, photo paths must live under
--        {request_id}/{purpose}/{caller-uid}/ (no nested dirs, no "..").
-- ---------------------------------------------------------------------------
create or replace function public.verify_handover_code(
  p_request_id uuid,
  p_purpose text,
  p_code text,
  p_note text,
  p_photos text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.listing_requests%rowtype;
  v_row public.booking_handover_codes%rowtype;
  v_norm text;
  v_attempts integer;
  v_prefix text;
  v_photo text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_purpose not in ('delivery', 'return') then
    raise exception 'invalid purpose';
  end if;

  select * into v_request from public.listing_requests where id = p_request_id;
  if not found then
    raise exception 'request not found';
  end if;
  if p_purpose = 'delivery' and v_uid <> v_request.requester_id then
    raise exception 'only the tenant can verify delivery';
  end if;
  if p_purpose = 'return' and v_uid <> v_request.owner_id then
    raise exception 'only the owner can verify return';
  end if;

  if not exists (
    select 1 from public.escrow_holds h
    where h.request_id = p_request_id and h.status = 'held'
  ) then
    raise exception 'escrow is not held';
  end if;

  select * into v_row
    from public.booking_handover_codes
   where request_id = p_request_id and purpose = p_purpose
   for update;
  if not found then
    raise exception 'handover code not found';
  end if;
  if v_row.used_at is not null then
    raise exception 'handover_code_already_used';
  end if;
  if v_row.valid_until < now() then
    raise exception 'handover_code_expired';
  end if;
  if v_row.attempts >= 10 then
    raise exception 'handover_code_locked';
  end if;

  -- Normalize Arabic-Indic (0660-0669) and Extended Arabic-Indic (06F0-06F9)
  -- digits to ASCII, then drop any whitespace the user typed.
  v_norm := translate(coalesce(p_code, ''),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789');
  v_norm := regexp_replace(v_norm, '\s+', '', 'g');

  if v_norm <> v_row.code then
    update public.booking_handover_codes
       set attempts = attempts + 1
     where id = v_row.id
    returning attempts into v_attempts;
    -- Returned, NOT raised: raising would roll this increment back.
    return jsonb_build_object(
      'ok', false,
      'error', 'code_mismatch',
      'attempts_remaining', greatest(0, 10 - v_attempts)
    );
  end if;

  -- Condition record is mandatory from day one (A2 decision 2): a note AND
  -- at least one photo. The SRS allows photos "when needed"; the owner made
  -- them mandatory, and a UI-only requirement is not a requirement.
  if p_note is null or length(trim(p_note)) < 1 then
    raise exception 'condition note required';
  end if;
  if char_length(p_note) > 1000 then
    raise exception 'condition note too long';
  end if;

  if p_photos is null then
    p_photos := '{}'::text[];
  end if;
  if coalesce(array_length(p_photos, 1), 0) < 1 then
    raise exception 'condition photo required';
  end if;
  if coalesce(array_length(p_photos, 1), 0) > 6 then
    raise exception 'too many photos';
  end if;
  v_prefix := p_request_id::text || '/' || p_purpose || '/' || v_uid::text || '/';
  foreach v_photo in array p_photos loop
    if v_photo is null
       or left(v_photo, length(v_prefix)) <> v_prefix
       or position('/' in substr(v_photo, length(v_prefix) + 1)) > 0
       or position('..' in v_photo) > 0
       or length(v_photo) <= length(v_prefix) then
      raise exception 'invalid photo path';
    end if;
  end loop;

  update public.booking_handover_codes
     set used_at = now(),
         used_by = v_uid,
         condition_note = trim(p_note),
         photos = p_photos
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'purpose', p_purpose, 'used_at', now());
end;
$$;

revoke execute on function public.verify_handover_code(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.verify_handover_code(uuid, text, text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) admin_confirm_external_payment (0022) — the one live path to 'held'
--    (wallet_escrow_pay was dropped in 0026). It now also mints both codes.
-- ---------------------------------------------------------------------------
create or replace function public.admin_confirm_external_payment(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.escrow_holds%rowtype;
  v_request public.listing_requests%rowtype;
  v_bytes bytea;
  v_return_until timestamptz;
begin
  if not has_min_role('moderator') then
    raise exception 'moderator only';
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
$$;

revoke execute on function public.admin_confirm_external_payment(uuid) from public, anon;
grant execute on function public.admin_confirm_external_payment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) wallet_escrow_release (0027) — the return-code gate. The payee (owner)
--    releases only after the return code was verified (they typed it after
--    receiving the item back). A moderator bypass is allowed but audited.
--    Refund stays ungated (full held amount back to the payer).
-- ---------------------------------------------------------------------------
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

  -- A2 gate: no release until the return code is verified. Every hold is a
  -- rent hold (0027) and every held hold has codes (this file + admin_confirm),
  -- so a missing return-code row means "never verified" — same refusal.
  if not exists (
    select 1 from public.booking_handover_codes c
    where c.request_id = p_request_id
      and c.purpose = 'return'
      and c.used_at is not null
  ) then
    if has_min_role('moderator') then
      insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
      values (auth.uid(), 'escrow_release_return_code_bypass', 'listing_requests', p_request_id,
              jsonb_build_object('hold_id', v_hold.id, 'amount', v_hold.amount));
    else
      raise exception 'return_code_required';
    end if;
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

  -- M2: the rented unit is back in stock (exactly one restore per hold).
  update public.listings l
     set quantity = l.quantity + 1, updated_at = now()
    from public.listing_requests r
   where r.id = p_request_id and l.id = r.listing_id;

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

-- ---------------------------------------------------------------------------
-- 7) handover-photos bucket + policies (0026 pattern). PRIVATE bucket: the
--    app renders these through signed URLs, not public links.
--    Path layout: {request_id}/{purpose}/{uid}/{uuid}.{ext}
--    No UPDATE/DELETE policy on purpose: uploaded evidence is immutable.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('handover-photos', 'handover-photos', false)
on conflict (id) do nothing;

drop policy if exists "handover_photos_insert" on storage.objects;
create policy "handover_photos_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'handover-photos'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[2] in ('delivery', 'return')
    and (storage.foldername(name))[3] = auth.uid()::text
    and exists (
      select 1 from public.listing_requests r
      where r.id::text = (storage.foldername(name))[1]
        and auth.uid() in (r.requester_id, r.owner_id)
    )
    and not public.is_user_banned(auth.uid())
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

drop policy if exists "handover_photos_select" on storage.objects;
create policy "handover_photos_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'handover-photos'
    and (
      public.has_min_role('moderator')
      or exists (
        select 1 from public.listing_requests r
        where r.id::text = (storage.foldername(name))[1]
          and auth.uid() in (r.requester_id, r.owner_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only, run after approval):
--   1. has_table_privilege('authenticated','public.booking_handover_codes',
--      'select') = false (RLS + revoke).
--   2. has_function_privilege('anon', get_handover_codes/verify_handover_code)
--      = false; authenticated = true.
--   3. get_handover_codes as owner returns delivery code with return code
--      NULL, and vice versa for the tenant.
--   4. verify with a wrong code increments attempts and returns {ok:false}
--      (not an exception).
--   5. wallet_escrow_release by the payee with no verified return code ->
--      'return_code_required'.
--   6. storage: INSERT .html under {req}/{purpose}/{uid}/ -> 403;
--      INSERT .jpg -> 200; SELECT as a stranger -> 0 rows.
-- ---------------------------------------------------------------------------
