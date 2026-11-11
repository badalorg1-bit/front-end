-- BADAL 0032 - availability: owner windows + server-side pre-check (SRS §4.9 · A4)
--
-- Why this exists:
--   Gap A4: «لا تقويم توافر ولا فحص توافر مسبق» (§4.9 · §16 · §17.7).
--   The only server guard today is the GiST exclusion constraint, which
--   fires ONLY when a request becomes accepted — there is no pre-check a
--   client can call before booking (§4.9 «على النظام التحقق من توافر
--   المنتج في المدة المطلوبة»), and §4.8 item 9 requires an availability
--   calendar on the product page. §6.1/§6.5 require owners to manage
--   «مواعيد التوافر».
--
-- What it does:
--   1. listing_availability — owner-managed AVAILABLE windows per listing
--      (§6.1 «مواعيد التوافر»). Zero rows = available all year (existing
--      listings stay bookable). RLS: owner-only CRUD via the listings
--      join; NO anon access — the public reads the calendar through the
--      RPC below, which never exposes the private note.
--   2. Widens listing_requests_no_rental_overlap to status in
--      ('accepted','disputed') — a disputed booking still HOLDS the
--      product (money is in escrow), so it must block new bookings too
--      (§17.7 «منع حجز منتج في فترة غير متاحة»).
--   3. check_listing_availability(listing_id, start, end) — one definer
--      RPC: calendar payload (windows + booked periods, dates only) and
--      the §4.9 pre-check: past/invalid range, conflict with an existing
--      accepted/disputed rent, and full coverage by the owner's windows
--      (day-granular union check). Granted to anon + authenticated —
--      it is read-only and returns no PII, no codes, no notes.
--      Availability stays CENTRAL on the server (§4.9 last paragraph).
--
-- 0032 writes NO data rows — a re-run is idempotent (create or replace /
-- drop policy if exists / drop constraint if exists).
--
-- Verification (scripts/bayna-apply-0032.mjs):
--   1. 0031 applied (admin_resolve_dispute exists) — ordering gate.
--   2. listing_availability exists, RLS on, owner-only policies present,
--      anon denied.
--   3. GiST predicate contains 'disputed'.
--   4. RPC exists, granted to anon+authenticated, denied to public; prosrc
--      carries conflict + outside_availability + generate_series coverage
--      check + windows/booked payload.
--   5. Zero data rows written.

-- ---------------------------------------------------------------------------
-- 1) listing_availability: the owner's available windows.
-- ---------------------------------------------------------------------------
create table if not exists public.listing_availability (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  constraint listing_availability_window check (ends_on >= starts_on)
);

create index if not exists listing_availability_listing_idx
  on public.listing_availability (listing_id, starts_on);

alter table public.listing_availability enable row level security;

-- Clients never touch the table directly for reads outside ownership;
-- the public calendar goes through check_listing_availability.
revoke all on public.listing_availability from anon;

drop policy if exists "listing_availability_owner_select" on public.listing_availability;
create policy "listing_availability_owner_select"
  on public.listing_availability for select
  to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.id = listing_availability.listing_id
         and l.owner_id = auth.uid()
    )
  );

drop policy if exists "listing_availability_owner_insert" on public.listing_availability;
create policy "listing_availability_owner_insert"
  on public.listing_availability for insert
  to authenticated
  with check (
    exists (
      select 1 from public.listings l
       where l.id = listing_availability.listing_id
         and l.owner_id = auth.uid()
    )
  );

drop policy if exists "listing_availability_owner_update" on public.listing_availability;
create policy "listing_availability_owner_update"
  on public.listing_availability for update
  to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.id = listing_availability.listing_id
         and l.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.listings l
       where l.id = listing_availability.listing_id
         and l.owner_id = auth.uid()
    )
  );

drop policy if exists "listing_availability_owner_delete" on public.listing_availability;
create policy "listing_availability_owner_delete"
  on public.listing_availability for delete
  to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.id = listing_availability.listing_id
         and l.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2) a disputed booking still holds the product: widen the overlap check.
--    (0001 predicate was status = 'accepted' only — §17.7.)
-- ---------------------------------------------------------------------------
alter table public.listing_requests
  drop constraint if exists listing_requests_no_rental_overlap;
alter table public.listing_requests
  add constraint listing_requests_no_rental_overlap
  exclude using gist (
    listing_id with =,
    daterange(rent_start, rent_end + 1, '[)') with &&
  )
  where (status in ('accepted', 'disputed') and request_type = 'rent');

-- ---------------------------------------------------------------------------
-- 3) check_listing_availability(): calendar payload + the §4.9 pre-check.
-- ---------------------------------------------------------------------------
create or replace function public.check_listing_availability(
  p_listing_id uuid,
  p_start date default null,
  p_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_listing public.listings%rowtype;
  v_windows jsonb;
  v_booked jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_available boolean := true;
  v_reason text := null;
  v_uncovered boolean;
begin
  if p_listing_id is null then
    raise exception 'availability_not_found';
  end if;
  select * into v_listing from public.listings where id = p_listing_id;
  if not found then
    raise exception 'availability_not_found';
  end if;

  -- Calendar payload (§4.8 item 9): dates only — the owner's note is
  -- never exposed here, and no party ids travel either.
  select coalesce(jsonb_agg(jsonb_build_object(
           'starts_on', a.starts_on, 'ends_on', a.ends_on
         ) order by a.starts_on), '[]'::jsonb)
    into v_windows
    from public.listing_availability a
   where a.listing_id = p_listing_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'starts_on', q.rent_start, 'ends_on', q.rent_end
         ) order by q.rent_start), '[]'::jsonb)
    into v_booked
    from public.listing_requests q
   where q.listing_id = p_listing_id
     and q.request_type = 'rent'
     and q.status in ('accepted', 'disputed')
     and q.rent_end >= current_date;

  -- Calendar-only call (listing page, no dates picked yet).
  if p_start is null and p_end is null then
    return jsonb_build_object(
      'available', true, 'reason', null,
      'conflicts', '[]'::jsonb,
      'windows', v_windows, 'booked', v_booked
    );
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'availability_invalid_range';
  end if;

  if p_end < current_date then
    v_available := false;
    v_reason := 'past_dates';
  else
    -- §4.9 «عدم وجود حجز متعارض» — accepted AND disputed hold the slot.
    select coalesce(jsonb_agg(jsonb_build_object(
             'starts_on', q.rent_start, 'ends_on', q.rent_end
           ) order by q.rent_start), '[]'::jsonb)
      into v_conflicts
      from public.listing_requests q
     where q.listing_id = p_listing_id
       and q.request_type = 'rent'
       and q.status in ('accepted', 'disputed')
       and q.rent_start <= p_end
       and q.rent_end >= p_start;

    if jsonb_array_length(v_conflicts) > 0 then
      v_available := false;
      v_reason := 'conflict';
    elsif exists (
      select 1 from public.listing_availability a
       where a.listing_id = p_listing_id
    ) then
      -- Owner declared windows: EVERY requested day must be covered by
      -- the union of them (day granularity matches rent_start/rent_end).
      select exists (
        select 1
          from generate_series(p_start, p_end, interval '1 day') d
         where not exists (
           select 1 from public.listing_availability a
            where a.listing_id = p_listing_id
              and a.starts_on <= d::date
              and a.ends_on >= d::date
         )
      ) into v_uncovered;
      if v_uncovered then
        v_available := false;
        v_reason := 'outside_availability';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'available', v_available, 'reason', v_reason,
    'conflicts', v_conflicts,
    'windows', v_windows, 'booked', v_booked
  );
end;
$$;

revoke execute on function public.check_listing_availability(uuid, date, date) from public;
grant execute on function public.check_listing_availability(uuid, date, date) to anon, authenticated;
