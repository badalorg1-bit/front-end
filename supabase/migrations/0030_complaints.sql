-- ===========================================================================
-- BADAL 0030 — customer-support complaints (SRS §10.2 · §10.3 · gap A3)
--
-- A complainant opens a complaint from inside the app, picks one of the
-- ELEVEN literal types of §10.3, writes the details, optionally links the
-- booking/listing it is about, attaches up to six images/PDFs, and gets
-- back a reference (CMP-XXXXXXXX). Status tracking:
--   open → in_review → resolved | rejected
-- The last two are TERMINAL and REQUIRE a written reason (§10.4: «يجب أن
-- تسجل المنصة القرارات وأسبابها»). Every status change notifies the
-- reporter through notify_user() and is written to admin_audit_log.
--
-- Access model (0028 pattern): both tables have RLS with ZERO policies and
-- revoked grants — the security-definer RPCs below are the only door.
-- Complaint attachments live in a PRIVATE bucket: only the reporter can
-- upload into {complaint_id}/{uid}/, only reporter + moderators can read,
-- and there is no UPDATE/DELETE policy (evidence is immutable).
-- The storage policies check ownership through the security-definer helper
-- is_complaint_reporter() — a policy expression runs as the CALLING role,
-- so a direct `select from complaints` inside it would raise permission
-- denied (grants revoked + zero RLS policies) and every upload would 500.
--
-- Design notes / deliberate choices:
--   * complaint_type stores the ARABIC §10.3 literal (same convention as
--     listings.rental_unit), so what the user picked is what is stored.
--   * Resolving/rejecting without a reason raises 'resolution_required';
--     a complaint can never be closed silently on a one-sided claim.
--   * open_complaint validates booking linkage: you may only attach a
--     request you are a participant of ('not a participant' otherwise).
--   * A reporter may hold at most 20 unresolved complaints at a time
--     ('open_complaint_limit') so support cannot be flooded.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Table: complaints. Fully blocked for clients (see 2).
-- ---------------------------------------------------------------------------
create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique
    check (reference ~ '^CMP-[0-9A-F]{8}$'),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  complaint_type text not null
    check (complaint_type in (
      'مشكلة في الحجز',
      'مشكلة في الدفع',
      'عدم تسليم المنتج',
      'اختلاف المنتج عن الوصف',
      'تلف المنتج',
      'تأخير الإرجاع',
      'خلاف حول التأمين',
      'مشكلة في التوصيل',
      'مشكلة في الحساب',
      'الإبلاغ عن إعلان مخالف',
      'الاشتباه في احتيال'
    )),
  details text not null check (char_length(details) between 10 and 5000),
  request_id uuid references public.listing_requests (id) on delete set null,
  listing_id uuid references public.listings (id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'in_review', 'resolved', 'rejected')),
  resolution text check (resolution is null or char_length(resolution) between 10 and 2000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  attachments text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists complaints_reporter_idx
  on public.complaints (reporter_id, created_at desc);
create index if not exists complaints_status_idx
  on public.complaints (status, created_at desc);
create index if not exists complaints_request_idx
  on public.complaints (request_id);

-- RLS with NO policies (every client query returns nothing) + revoke the
-- default Supabase table grants: the security-definer RPCs below are the
-- only door in or out.
alter table public.complaints enable row level security;
revoke all on public.complaints from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) complaint-attachments bucket + policies (0028/0026 pattern). PRIVATE:
--    the app renders these through signed URLs, not public links.
--    Path layout: {complaint_id}/{uid}/{uuid}.{ext}
--    (storage.foldername() strips the FILE name: a 3-part path yields
--    length = 2 — the check below is 2, not 3.)
--    Images AND pdf (SRS §10.2 «إرفاق الصور أو المستندات»).
--    No UPDATE/DELETE policy on purpose: uploaded evidence is immutable.
--
--    Helper first: policies evaluate as the calling role, and complaints
--    grants nothing to authenticated — is_complaint_reporter() reads it as
--    its owner (definer) and answers only "is this MY complaint?". The
--    text parameter avoids a uuid cast error inside the policy on a
--    crafted path (returns false instead of raising).
-- ---------------------------------------------------------------------------
create or replace function public.is_complaint_reporter(p_complaint text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_id uuid;
begin
  begin
    v_id := p_complaint::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from public.complaints c
    where c.id = v_id
      and c.reporter_id = auth.uid()
  );
end;
$$;

revoke execute on function public.is_complaint_reporter(text) from public, anon;
grant execute on function public.is_complaint_reporter(text) to authenticated;

insert into storage.buckets (id, name, public)
values ('complaint-attachments', 'complaint-attachments', false)
on conflict (id) do nothing;

drop policy if exists "complaint_attachments_insert" on storage.objects;
create policy "complaint_attachments_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'complaint-attachments'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_complaint_reporter((storage.foldername(name))[1])
    and not public.is_user_banned(auth.uid())
    and metadata->>'mimetype' in (
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'
    )
  );

drop policy if exists "complaint_attachments_select" on storage.objects;
create policy "complaint_attachments_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'complaint-attachments'
    and (
      public.has_min_role('moderator')
      or public.is_complaint_reporter((storage.foldername(name))[1])
    )
  );

-- ---------------------------------------------------------------------------
-- 3) open_complaint — the §10.2 intake: type + details + optional links,
--    returns the reference the user will quote in follow-ups.
-- ---------------------------------------------------------------------------
create or replace function public.open_complaint(
  p_type text,
  p_details text,
  p_request_id uuid default null,
  p_listing_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text;
  v_id uuid;
  v_open integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if public.is_user_banned(v_uid) then
    raise exception 'account banned';
  end if;
  if p_type is null or p_type not in (
    'مشكلة في الحجز', 'مشكلة في الدفع', 'عدم تسليم المنتج',
    'اختلاف المنتج عن الوصف', 'تلف المنتج', 'تأخير الإرجاع',
    'خلاف حول التأمين', 'مشكلة في التوصيل', 'مشكلة في الحساب',
    'الإبلاغ عن إعلان مخالف', 'الاشتباه في احتيال'
  ) then
    raise exception 'complaint_type_invalid';
  end if;
  if p_details is null or char_length(btrim(p_details)) < 10 then
    raise exception 'complaint_details_required';
  end if;
  if char_length(btrim(p_details)) > 5000 then
    raise exception 'complaint_details_too_long';
  end if;

  -- A linked booking must be one the reporter actually takes part in.
  if p_request_id is not null then
    perform 1 from public.listing_requests r
     where r.id = p_request_id
       and v_uid in (r.requester_id, r.owner_id);
    if not found then
      if exists (select 1 from public.listing_requests r where r.id = p_request_id) then
        raise exception 'not a participant';
      end if;
      raise exception 'request not found';
    end if;
  end if;
  if p_listing_id is not null
     and not exists (select 1 from public.listings l where l.id = p_listing_id) then
    raise exception 'listing not found';
  end if;

  -- Support-flood guard: 20 unresolved complaints per reporter.
  select count(*) into v_open
    from public.complaints c
   where c.reporter_id = v_uid
     and c.status in ('open', 'in_review');
  if v_open >= 20 then
    raise exception 'open_complaint_limit';
  end if;

  v_ref := 'CMP-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  while exists (select 1 from public.complaints c where c.reference = v_ref) loop
    v_ref := 'CMP-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  end loop;

  insert into public.complaints
    (reference, reporter_id, complaint_type, details, request_id, listing_id)
  values
    (v_ref, v_uid, p_type, btrim(p_details), p_request_id, p_listing_id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref);
end;
$$;

revoke execute on function public.open_complaint(text, text, uuid, uuid) from public, anon;
grant execute on function public.open_complaint(text, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) add_complaint_attachment — register one uploaded file (path already
--    stored in the private bucket by the client). Reporter only, max 6,
--    path must live under the complaint's own folder (0028 literals reused
--    so toArabicError maps them without new strings).
-- ---------------------------------------------------------------------------
create or replace function public.add_complaint_attachment(
  p_complaint_id uuid,
  p_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reporter uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select c.reporter_id into v_reporter
    from public.complaints c where c.id = p_complaint_id;
  if not found then
    raise exception 'complaint not found';
  end if;
  if v_reporter <> v_uid then
    raise exception 'not the reporter';
  end if;
  if p_path is null
     or position(p_complaint_id::text || '/' in p_path) <> 1
     or p_path !~ '\.(jpg|jpeg|png|webp|gif|pdf)$' then
    raise exception 'invalid photo path';
  end if;

  select coalesce(array_length(c.attachments, 1), 0) into v_count
    from public.complaints c where c.id = p_complaint_id;
  if v_count >= 6 then
    raise exception 'too many photos';
  end if;

  update public.complaints c
     set attachments = array_append(c.attachments, p_path),
         updated_at = now()
   where c.id = p_complaint_id
     and not (p_path = any (c.attachments));

  return jsonb_build_object('ok', true, 'count', v_count + 1);
end;
$$;

revoke execute on function public.add_complaint_attachment(uuid, text) from public, anon;
grant execute on function public.add_complaint_attachment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) list_my_complaints — the §10.2 status tracker (reporter's own only).
-- ---------------------------------------------------------------------------
create or replace function public.list_my_complaints()
returns table (
  id uuid,
  reference text,
  complaint_type text,
  details text,
  status text,
  resolution text,
  request_id uuid,
  listing_id uuid,
  attachments text[],
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  return query
  select c.id, c.reference, c.complaint_type, c.details, c.status, c.resolution,
         c.request_id, c.listing_id, c.attachments,
         c.created_at, c.updated_at, c.resolved_at
    from public.complaints c
   where c.reporter_id = v_uid
   order by c.created_at desc
   limit 100;
end;
$$;

revoke execute on function public.list_my_complaints() from public, anon;
grant execute on function public.list_my_complaints() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) admin_list_complaints — moderator+ queue (§10.4 review surface).
--    Raises instead of returning empty so a wrong role is never mistaken
--    for "no complaints".
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_complaints(p_status text default null)
returns table (
  id uuid,
  reference text,
  complaint_type text,
  details text,
  status text,
  resolution text,
  request_id uuid,
  listing_id uuid,
  attachments text[],
  reporter_id uuid,
  reporter_name text,
  resolver_name text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null or not public.has_min_role('moderator') then
    raise exception 'permission denied';
  end if;
  if p_status is not null
     and p_status not in ('open', 'in_review', 'resolved', 'rejected') then
    raise exception 'invalid_status_filter';
  end if;  return query
  select c.id, c.reference, c.complaint_type, c.details, c.status, c.resolution,
         c.request_id, c.listing_id, c.attachments,
         c.reporter_id, p.display_name, rp.display_name,
         c.created_at, c.updated_at, c.resolved_at
    from public.complaints c
    join public.profiles p on p.id = c.reporter_id
    left join public.profiles rp on rp.id = c.resolved_by
   where (p_status is null or c.status = p_status)
   order by c.created_at desc
   limit 200;
end;
$$;

revoke execute on function public.admin_list_complaints(text) from public, anon;
grant execute on function public.admin_list_complaints(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) update_complaint_status — moderator+ transition + reason + notify +
--    audit (§10.4). open → in_review → resolved | rejected; the terminal
--    states require p_note (10..2000 chars) — 'resolution_required'.
-- ---------------------------------------------------------------------------
create or replace function public.update_complaint_status(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.complaints%rowtype;
  v_note text := case when p_note is null then null else btrim(p_note) end;
begin
  if v_uid is null or not public.has_min_role('moderator') then
    raise exception 'permission denied';
  end if;
  if p_status is null or p_status not in ('open', 'in_review', 'resolved', 'rejected') then
    raise exception 'complaint_status_invalid';
  end if;

  select * into v_row from public.complaints c where c.id = p_id for update;
  if not found then
    raise exception 'complaint not found';
  end if;

  -- Legal transitions only; resolved/rejected are terminal.
  if v_row.status in ('resolved', 'rejected')
     or not (
       (v_row.status = 'open' and p_status in ('in_review', 'resolved', 'rejected'))
       or (v_row.status = 'in_review' and p_status in ('resolved', 'rejected'))
     ) then
    raise exception 'invalid_status_transition';
  end if;

  if p_status in ('resolved', 'rejected') then
    if v_note is null or char_length(v_note) < 10 then
      raise exception 'resolution_required';
    end if;
    if char_length(v_note) > 2000 then
      raise exception 'resolution_too_long';
    end if;
  end if;

  update public.complaints c
     set status = p_status,
         resolution = case when p_status in ('resolved', 'rejected') then v_note else c.resolution end,
         resolved_by = case when p_status in ('resolved', 'rejected') then v_uid else c.resolved_by end,
         resolved_at = case when p_status in ('resolved', 'rejected') then now() else c.resolved_at end,
         updated_at = now()
   where c.id = p_id;

  -- Tell the reporter (§10.2 «تلقي إشعارات عند تحديث الحالة»).
  perform public.notify_user(
    v_row.reporter_id,
    'تحديث على شكواك ' || v_row.reference,
    case p_status
      when 'in_review' then 'فريق الدعم يراجع شكواك الآن.'
      when 'resolved' then 'تم حل شكواك. القرار: ' || coalesce(v_note, '')
      else 'تم إغلاق شكواك دون قبولها. القرار: ' || coalesce(v_note, '')
    end,
    'moderation',
    null
  );

  -- Every decision is logged with its reason (§10.4).
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (
    v_uid,
    'complaint_status_' || p_status,
    'complaint',
    p_id,
    jsonb_build_object('reference', v_row.reference, 'note', v_note)
  );

  return jsonb_build_object('ok', true, 'status', p_status, 'reference', v_row.reference);
end;
$$;

revoke execute on function public.update_complaint_status(uuid, text, text) from public, anon;
grant execute on function public.update_complaint_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only, run after approval):
--   1. has_table_privilege('authenticated','public.complaints','select')
--      = false (RLS + revoke); same for anon/service_role.
--   2. The complaint_type check constraint carries ALL ELEVEN §10.3 literals.
--   3. has_function_privilege('anon', open_complaint/…) = false;
--      authenticated = true for all five RPCs.
--   4. update_complaint_status prosrc contains resolution_required,
--      admin_audit_log and notify_user; admin_list_complaints contains
--      has_min_role; is_complaint_reporter is SECURITY DEFINER, granted to
--      authenticated only (storage policies depend on it).
--   5. storage: bucket complaint-attachments exists (private) with exactly
--      the insert+select policies; INSERT .html -> 403; INSERT .jpg as the
--      reporter -> 200; SELECT as a stranger -> 0 rows.
--   6. No data rows created by the apply itself (complaints = pre count).
-- ---------------------------------------------------------------------------
