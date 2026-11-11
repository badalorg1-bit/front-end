-- BADAL 0034 — role-based permissions matrix (A9 · §5.2 · §11.6 · §17.16 #16)
--
-- Why: the SRS §5.2 requires EIGHT account types and §11.6 requires a
-- permission system where "لا يحصل كل الموظفين على صلاحيات المدير الكامل".
-- Before 0034 the DB had FOUR roles (0003:16) and NO matrix — a moderator
-- and an admin were all-or-nothing. 0034 delivers:
--
--   1. profiles_role_check gains all eight §5.2 account roles:
--      user | merchant | support | operations | moderator | admin |
--      super_admin | owner.
--   2. app_role_rank re-ranked: user=0 merchant=0 support=1 operations=1
--      moderator=2 admin=3 super_admin=4 owner=5. The RELATIVE order of the
--      original four (user < moderator < admin < super_admin) is preserved,
--      so every has_min_role() gate written in 0001-0033 keeps its meaning
--      and gains owner automatically (rank 5 >= any threshold).
--   3. role_permissions(role, permission): the §11.6 matrix — RLS on, ALL
--      grants revoked, ZERO policies (RPC-only, 0028/0033 pattern).
--      12 permissions, 49 seeded rows (see below).
--   4. has_permission(p) — SECURITY DEFINER lookup, rejects is_banned,
--      granted to authenticated AND anon (policies run as the querying
--      role; has_min_role was revoked from anon in 0017 §10).
--   5. Two RPCs: admin_list_role_permissions() (gate has_min_role('admin'))
--      and admin_set_role_permission() (gate has_permission('permissions.manage')
--      + six refusal codes + audit row).
--   6. Seven functions re-declared with permission gates (signatures
--      unchanged → CREATE OR REPLACE keeps their grants):
--        admin_set_user_role        — 8-role whitelist + owner bootstrap
--        protect_profile_privileges — self-escalation refused LOUDLY,
--                                     equal/higher edits silent, last
--                                     super_admin/owner protected
--                                     (base text = 0019, incl. QR path)
--        admin_list_complaints      — complaints.view
--        update_complaint_status    — complaints.manage
--        admin_set_listing_status   — listings.review
--        consume_listing_quota      — owner joins the admin bar
--        on_wallet_topup_inserted   — owner notified too
--   7. Six RLS policies re-created under the SAME names with permission
--      gates: listings_select_admin, listing_images_select_admin,
--      listing_requests_select_admin, ai_warnings_select_admin,
--      ai_warnings_update_admin → listings.review / requests.view;
--      admin_audit_select → audit.view; complaint_attachments_select
--      GAINS has_permission('complaints.view') (add, not replace —
--      decision recorded in the A9 design).
--   8. The literal owner gap from 0009: eight SaaS SELECT policies hard-
--      coded role in ('admin','super_admin') → 'owner' added.
--      NOT touched: the literal admin_* functions in 0009/0010 — 0017 §4
--      re-declared them with has_min_role('admin'), which owner already
--      passes by rank (dead code, no re-declaration needed).
--
-- Rank-gated surfaces that intentionally STAY has_min_role (the seeds
-- mirror them): disputes/delivery/broadcast = has_min_role('moderator');
-- SaaS/wallet admin = has_min_role('admin').
--
-- Seeds (49 rows, on conflict do nothing):
--   user 0 · merchant 0 · support 3 · operations 3 · moderator 8 ·
--   admin 11 (all but permissions.manage) · super_admin 12 · owner 12.
--
-- Depends on: 0003, 0009, 0011, 0017, 0019, 0020, 0030, 0033 (apply in
-- order; bayna-apply-0034.mjs gates on 0030+0033 being present).

-- ---------------------------------------------------------------------------
-- 1) profiles: all eight §5.2 account types
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'merchant', 'support', 'operations',
                  'moderator', 'admin', 'super_admin', 'owner'));

-- ---------------------------------------------------------------------------
-- 2) app_role_rank — relative order of the old four preserved, so every
--    has_min_role() gate in 0001-0033 keeps its meaning; owner (5) passes
--    any threshold. Unknown/garbage stays -1.
-- ---------------------------------------------------------------------------
create or replace function public.app_role_rank(r text)
returns integer
language sql
immutable
as $$
  select case r
    when 'user' then 0
    when 'merchant' then 0
    when 'support' then 1
    when 'operations' then 1
    when 'moderator' then 2
    when 'admin' then 3
    when 'super_admin' then 4
    when 'owner' then 5
    else -1
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3) role_permissions — the §11.6 matrix (RPC-only: RLS on, no policies,
--    every grant revoked; 0028/0033 pattern).
-- ---------------------------------------------------------------------------
create table if not exists public.role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);

alter table public.role_permissions
  drop constraint if exists role_permissions_role_check;
alter table public.role_permissions
  add constraint role_permissions_role_check
  check (role in ('user', 'merchant', 'support', 'operations',
                  'moderator', 'admin', 'super_admin', 'owner'));

alter table public.role_permissions
  drop constraint if exists role_permissions_permission_check;
alter table public.role_permissions
  add constraint role_permissions_permission_check
  check (permission in ('reports.view', 'listings.review', 'requests.view',
                        'complaints.view', 'complaints.manage',
                        'disputes.manage', 'delivery.manage',
                        'notifications.broadcast', 'users.manage',
                        'settings.manage', 'audit.view',
                        'permissions.manage'));

alter table public.role_permissions enable row level security;
revoke all on public.role_permissions from public, anon, authenticated, service_role;
-- deliberately ZERO policies: only the SECURITY DEFINER RPCs touch it.

-- ---------------------------------------------------------------------------
-- 4) Seeds — 49 rows (§11.6 examples mapped onto the 12 permissions).
--    support  = «متابعة الشكاوى والطلبات»
--    operations = «مراجعة الإعلانات» + «التقارير التشغيلية»
--    moderator  = the pre-0034 moderator surface MINUS audit.view
--                 (admin_audit_select was admin+ before 0034 — stays admin+)
--    admin      = moderator's 8 + users.manage + settings.manage + audit.view
--    super_admin / owner = all 12
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  -- support (3)
  ('support', 'requests.view'),
  ('support', 'complaints.view'),
  ('support', 'complaints.manage'),
  -- operations (3)
  ('operations', 'reports.view'),
  ('operations', 'listings.review'),
  ('operations', 'requests.view'),
  -- moderator (8)
  ('moderator', 'reports.view'),
  ('moderator', 'listings.review'),
  ('moderator', 'requests.view'),
  ('moderator', 'complaints.view'),
  ('moderator', 'complaints.manage'),
  ('moderator', 'disputes.manage'),
  ('moderator', 'delivery.manage'),
  ('moderator', 'notifications.broadcast'),
  -- admin (11) — everything except permissions.manage
  ('admin', 'reports.view'),
  ('admin', 'listings.review'),
  ('admin', 'requests.view'),
  ('admin', 'complaints.view'),
  ('admin', 'complaints.manage'),
  ('admin', 'disputes.manage'),
  ('admin', 'delivery.manage'),
  ('admin', 'notifications.broadcast'),
  ('admin', 'users.manage'),
  ('admin', 'settings.manage'),
  ('admin', 'audit.view'),
  -- super_admin (12)
  ('super_admin', 'reports.view'),
  ('super_admin', 'listings.review'),
  ('super_admin', 'requests.view'),
  ('super_admin', 'complaints.view'),
  ('super_admin', 'complaints.manage'),
  ('super_admin', 'disputes.manage'),
  ('super_admin', 'delivery.manage'),
  ('super_admin', 'notifications.broadcast'),
  ('super_admin', 'users.manage'),
  ('super_admin', 'settings.manage'),
  ('super_admin', 'audit.view'),
  ('super_admin', 'permissions.manage'),
  -- owner (12)
  ('owner', 'reports.view'),
  ('owner', 'listings.review'),
  ('owner', 'requests.view'),
  ('owner', 'complaints.view'),
  ('owner', 'complaints.manage'),
  ('owner', 'disputes.manage'),
  ('owner', 'delivery.manage'),
  ('owner', 'notifications.broadcast'),
  ('owner', 'users.manage'),
  ('owner', 'settings.manage'),
  ('owner', 'audit.view'),
  ('owner', 'permissions.manage')
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 5) has_permission — the §11.6 gate. security definer so RLS policies can
--    evaluate it; refuses banned accounts (same contract as has_min_role).
--    Granted to anon too: policy expressions run as the querying role, and
--    0017 §10 revoked has_min_role from anon — new policies must not break
--    anon table reads.
-- ---------------------------------------------------------------------------
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role = p.role
    where p.id = auth.uid()
      and p.is_banned = false
      and rp.permission = p_permission
  );
$$;

revoke execute on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_permission(text) to anon;

-- ---------------------------------------------------------------------------
-- 6) admin_list_role_permissions — the full 8x12 matrix (96 rows) for the
--    admin UI. Gate: admin+ (read-only surface); writes go through the RPC
--    below.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_role_permissions()
returns table (
  role text,
  permission text,
  granted boolean,
  role_rank int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_min_role('admin') then
    raise exception 'permission denied';
  end if;
  return query
  select r.role,
         p.permission,
         exists (
           select 1 from public.role_permissions rp
           where rp.role = r.role and rp.permission = p.permission
         ),
         public.app_role_rank(r.role)
    from (
      select unnest(array[
        'user', 'merchant', 'support', 'operations',
        'moderator', 'admin', 'super_admin', 'owner'
      ]::text[]) as role
    ) r
    cross join (
      select unnest(array[
        'reports.view', 'listings.review', 'requests.view', 'complaints.view',
        'complaints.manage', 'disputes.manage', 'delivery.manage',
        'notifications.broadcast', 'users.manage', 'settings.manage',
        'audit.view', 'permissions.manage'
      ]::text[]) as permission
    ) p
   order by public.app_role_rank(r.role) desc, p.permission;
end;
$$;

revoke execute on function public.admin_list_role_permissions() from public, anon, authenticated;
grant execute on function public.admin_list_role_permissions() to authenticated;

-- ---------------------------------------------------------------------------
-- 7) admin_set_role_permission — grant/revoke one cell of the matrix.
--    Refusal codes (mapped to Arabic in src/lib/supabase.ts):
--      role_invalid / permission_unknown / permission_grant_invalid (p_grant
--      null) / permission_self_edit (your own role) / permission_rank
--      (target rank >= yours) / permission_grant_exceeds (granting a
--      permission you do not hold).
--    Every change lands in admin_audit_log (§11.6 «سجل تدقيق»).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_role_permission(
  p_role text,
  p_permission text,
  p_grant boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_role text;
  v_actor_rank int;
  v_target_rank int;
begin
  if v_uid is null or not public.has_permission('permissions.manage') then
    raise exception 'permission denied';
  end if;
  if p_role is null or p_role not in (
    'user', 'merchant', 'support', 'operations',
    'moderator', 'admin', 'super_admin', 'owner'
  ) then
    raise exception 'role_invalid';
  end if;
  if p_permission is null or p_permission not in (
    'reports.view', 'listings.review', 'requests.view', 'complaints.view',
    'complaints.manage', 'disputes.manage', 'delivery.manage',
    'notifications.broadcast', 'users.manage', 'settings.manage',
    'audit.view', 'permissions.manage'
  ) then
    raise exception 'permission_unknown';
  end if;
  if p_grant is null then
    raise exception 'permission_grant_invalid';
  end if;

  select p.role into v_actor_role from public.profiles p where p.id = v_uid;
  v_actor_rank := app_role_rank(v_actor_role);
  v_target_rank := app_role_rank(p_role);

  if p_role = v_actor_role then
    raise exception 'permission_self_edit';
  end if;
  if v_target_rank >= v_actor_rank then
    raise exception 'permission_rank';
  end if;
  if p_grant and not exists (
    select 1 from public.role_permissions rp
    where rp.role = v_actor_role and rp.permission = p_permission
  ) then
    raise exception 'permission_grant_exceeds';
  end if;

  if p_grant then
    insert into public.role_permissions (role, permission)
    values (p_role, p_permission)
    on conflict (role, permission) do nothing;
  else
    delete from public.role_permissions rp
    where rp.role = p_role and rp.permission = p_permission;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (
    v_uid,
    'set_role_permission',
    'role_permission',
    null,
    jsonb_build_object('role', p_role, 'permission', p_permission, 'granted', p_grant)
  );

  return jsonb_build_object(
    'ok', true, 'role', p_role, 'permission', p_permission, 'granted', p_grant
  );
end;
$$;

revoke execute on function public.admin_set_role_permission(text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_role_permission(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Re-declared functions (same signatures → grants preserved).
-- ---------------------------------------------------------------------------

-- 8a) admin_set_user_role — base text 0003:330, changes: 8-role whitelist,
--     entry rank 2→3, super_admin grant rank 3→4, and the owner bootstrap
--     (a super_admin+ may create the FIRST owner for someone else — never
--     for self, never when an active owner exists).
create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_rank int;
  target_rank int;
  new_rank int;
begin
  if not has_min_role('admin') then
    raise exception 'ليست لديك صلاحية تعديل الأدوار';
  end if;
  if p_role not in ('user', 'merchant', 'support', 'operations', 'moderator', 'admin', 'super_admin', 'owner') then
    raise exception 'دور غير صالح';
  end if;

  select app_role_rank(role) into actor_rank from public.profiles where id = auth.uid();
  select app_role_rank(role) into target_rank from public.profiles where id = p_user_id;
  new_rank := app_role_rank(p_role);

  if target_rank is null then
    raise exception 'المستخدم غير موجود';
  end if;
  if actor_rank < 3 then
    raise exception 'ليست لديك صلاحية';
  end if;
  if target_rank >= actor_rank and auth.uid() <> p_user_id then
    raise exception 'لا يمكنك تعديل دور يساوي صلاحيتك أو يفوقها';
  end if;
  if new_rank > actor_rank then
    -- owner bootstrap (0034): rank 4+ may mint the first owner — for
    -- someone else only, and only while no active owner exists.
    if not (
      p_role = 'owner'
      and actor_rank >= 4
      and auth.uid() <> p_user_id
      and not exists (
        select 1 from public.profiles p
        where p.role = 'owner' and p.is_banned = false
      )
    ) then
      raise exception 'لا يمكنك منح صلاحية أعلى من صلاحيتك';
    end if;
  end if;
  if p_role = 'super_admin' and actor_rank < 4 then
    raise exception 'منح مسؤول نظام يتطلب صلاحية مسؤول نظام';
  end if;

  update public.profiles set role = p_role, updated_at = now() where id = p_user_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'set_user_role', 'profile', p_user_id, jsonb_build_object('role', p_role));
end;
$$;

-- 8b) protect_profile_privileges — base text 0019 (incl. the payment QR
--     path rule), extended for the eight-role world:
--       * below admin (or banned/anonymous actor): SILENT revert (0034:
--         support/operations/moderator never change privileges directly);
--       * self-escalation: refused LOUDLY («لا يمكنك منح صلاحية أعلى من
--         صلاحيتك») so the user sees why;
--       * editing an equal/higher role, or raising someone above you:
--         SILENT retreat — except the owner bootstrap of 8a;
--       * last-standing protection for super_admin AND owner, only on real
--         demotions (super_admin → owner no longer trips it).
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_rank int;
  v_actor_banned boolean;
  v_old_rank int;
  v_new_rank int;
begin
  -- payment_qr_path must live under this profile's own folder when changed.
  -- new.id (not auth.uid()) so admin/service writes targeting a user still
  -- have to point at THAT user's folder; unchanged values are never re-checked.
  if new.payment_qr_path is distinct from old.payment_qr_path
     and new.payment_qr_path is not null
     and new.payment_qr_path not like new.id::text || '/%' then
    raise exception 'payment_qr_path must be under your own folder';
  end if;

  if new.role is distinct from old.role or new.is_banned is distinct from old.is_banned then
    select app_role_rank(p.role), p.is_banned
      into v_actor_rank, v_actor_banned
      from public.profiles p
     where p.id = v_actor;

    -- below admin (or banned/anonymous actor): silently keep old values
    if v_actor_rank is null or v_actor_rank < 3 or coalesce(v_actor_banned, false) then
      new.role := old.role;
      new.is_banned := old.is_banned;
      return new;
    end if;

    v_old_rank := app_role_rank(old.role);
    v_new_rank := app_role_rank(new.role);

    if new.role is distinct from old.role then
      -- self-escalation fails loudly (this is the one refusal a user must
      -- actually SEE — a silent revert here would look like a broken form)
      if v_actor = new.id and v_new_rank > v_actor_rank then
        raise exception 'لا يمكنك منح صلاحية أعلى من صلاحيتك';
      end if;

      -- touching an equal/higher role, or raising someone above you:
      -- silent retreat. Exception: the owner bootstrap of admin_set_user_role.
      if v_actor is distinct from new.id then
        if v_old_rank >= v_actor_rank then
          new.role := old.role;
        elsif v_new_rank > v_actor_rank
              and not (
                new.role = 'owner'
                and v_actor_rank >= 4
                and not exists (
                  select 1 from public.profiles p
                  where p.role = 'owner' and p.is_banned = false
                )
              ) then
          new.role := old.role;
        end if;
      end if;

      -- last-standing protection — only for real demotions
      if new.role is distinct from old.role
         and v_new_rank < v_old_rank then
        if old.role = 'super_admin'
           and not exists (
             select 1 from public.profiles p
             where p.role = 'super_admin' and p.id <> old.id and p.is_banned = false
           ) then
          raise exception 'لا يمكن تخفيض صلاحية آخر مسؤول نظام';
        end if;
        if old.role = 'owner'
           and not exists (
             select 1 from public.profiles p
             where p.role = 'owner' and p.id <> old.id and p.is_banned = false
           ) then
          raise exception 'لا يمكن تخفيض صلاحية آخر مالك';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;
-- trigger already exists (created in 0003); CREATE OR REPLACE keeps it attached

-- 8c) admin_list_complaints — base text 0030:345, gate moderator → complaints.view
--     (support may read the queue; raising instead of returning empty keeps
--     a wrong role from looking like "no complaints").
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
  if auth.uid() is null or not public.has_permission('complaints.view') then
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

-- 8d) update_complaint_status — base text 0030:397, gate moderator →
--     complaints.manage (support handles the §10.4 transition itself).
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
  if v_uid is null or not public.has_permission('complaints.manage') then
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

-- 8e) admin_set_listing_status — base text 0003:420, gate moderator →
--     listings.review (§11.6 «موظف مراجعة الإعلانات» = operations).
create or replace function public.admin_set_listing_status(
  p_listing_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('listings.review') then
    raise exception 'ليست لديك صلاحية إدارة الإعلانات';
  end if;
  if p_status not in ('draft', 'published', 'archived', 'blocked') then
    raise exception 'حالة غير صالحة';
  end if;
  if not exists (select 1 from public.listings where id = p_listing_id) then
    raise exception 'الإعلان غير موجود';
  end if;

  update public.listings
  set status = p_status, updated_at = now()
  where id = p_listing_id;

  if p_status = 'blocked' then
    insert into public.notifications (user_id, title, body, kind, listing_id)
    select owner_id,
           'تم إيقاف إعلانك',
           'أوقف فريق الإشراف إعلانك "' || title || '" لمخالفة قواعد المنصة.',
           'moderation',
           id
    from public.listings
    where id = p_listing_id;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'set_listing_status', 'listing', p_listing_id, jsonb_build_object('status', p_status));
end;
$$;

-- 8f) consume_listing_quota — base text 0017:465; owner joins the admin bar
--     (it was the literal ('admin','super_admin') — the owner-gap class).
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

  -- idempotent: if this listing already consumed quota, return ok without re-counting
  if exists (select 1 from public.listing_quota_log where listing_id = p_listing_id) then
    return jsonb_build_object('ok', true, 'source', 'already_consumed');
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role in ('admin','super_admin','owner') then
    return jsonb_build_object('ok', true, 'source', 'admin');
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

-- 8g) on_wallet_topup_inserted — base text 0020:7; owner notified too (it
--     notified the literal ('admin', 'super_admin') set).
create or replace function public.on_wallet_topup_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  a record;
begin
  select display_name into v_name from public.profiles where id = new.user_id;
  for a in
    select id from public.profiles
    where role in ('admin', 'super_admin', 'owner') and is_banned = false
  loop
    perform public.notify_user(
      a.id,
      'طلب شحن محفظة جديد',
      coalesce(v_name, 'مستخدم') || ' أرسل طلب شحن بقيمة ' ||
        round(new.amount_egp)::bigint || ' ج.م. — بانتظار مراجعتك.',
      'system',
      null
    );
  end loop;
  return new;
end;
$$;
-- trigger already exists (0020); CREATE OR REPLACE keeps it attached

-- ---------------------------------------------------------------------------
-- 9) RLS policy replacements — SAME names, permission gates.
-- ---------------------------------------------------------------------------

-- listings: reviewer surface (operations+ per §11.6)
drop policy if exists "listings_select_admin" on public.listings;
create policy "listings_select_admin"
  on public.listings for select
  using (public.has_permission('listings.review'));

drop policy if exists "listing_images_select_admin" on public.listing_images;
create policy "listing_images_select_admin"
  on public.listing_images for select
  using (public.has_permission('listings.review'));

drop policy if exists "listing_requests_select_admin" on public.listing_requests;
create policy "listing_requests_select_admin"
  on public.listing_requests for select
  using (public.has_permission('requests.view'));

-- ai warnings: the ads-review surface (listings.review)
drop policy if exists "ai_warnings_select_admin" on public.ai_warnings;
create policy "ai_warnings_select_admin"
  on public.ai_warnings for select
  using (public.has_permission('listings.review'));

drop policy if exists "ai_warnings_update_admin" on public.ai_warnings;
create policy "ai_warnings_update_admin"
  on public.ai_warnings for update
  using (public.has_permission('listings.review'))
  with check (public.has_permission('listings.review'));

-- audit log: admin+ before 0034 (admin_audit_select used has_min_role('admin')),
-- now the explicit audit.view permission (admin seed keeps it).
drop policy if exists "admin_audit_select" on public.admin_audit_log;
create policy "admin_audit_select"
  on public.admin_audit_log for select
  using (public.has_permission('audit.view'));

-- complaint attachments: ADD complaints.view alongside the existing
-- moderator/reporter paths (recorded A9 decision: add, not replace).
drop policy if exists "complaint_attachments_select" on storage.objects;
create policy "complaint_attachments_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'complaint-attachments'
    and (
      public.has_min_role('moderator')
      or public.has_permission('complaints.view')
      or public.is_complaint_reporter((storage.foldername(name))[1])
    )
  );

-- ---------------------------------------------------------------------------
-- 10) The literal owner gap from 0009 — eight SaaS SELECT policies hard-coded
--     role in ('admin','super_admin'). 'owner' is added so the project owner
--     (rank 5) sees plans/subscriptions/promos/banners/quota exactly like an
--     admin. Row shapes and all other logic are unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists "pricing_plans_select_active" on public.pricing_plans;
create policy "pricing_plans_select_active"
  on public.pricing_plans for select
  using (is_active or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "subscription_orders_select_own" on public.subscription_orders;
create policy "subscription_orders_select_own"
  on public.subscription_orders for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "promo_services_select_active" on public.promo_services;
create policy "promo_services_select_active"
  on public.promo_services for select
  using (is_active or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "listing_promos_select_own" on public.listing_promos;
create policy "listing_promos_select_own"
  on public.listing_promos for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "promo_credits_ledger_select_own" on public.promo_credits_ledger;
create policy "promo_credits_ledger_select_own"
  on public.promo_credits_ledger for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "banner_campaigns_select_own" on public.banner_campaigns;
create policy "banner_campaigns_select_own"
  on public.banner_campaigns for select
  using (auth.uid() = created_by or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

drop policy if exists "listing_quota_log_select_own" on public.listing_quota_log;
create policy "listing_quota_log_select_own"
  on public.listing_quota_log for select
  using (auth.uid() = user_id or auth.uid() in (select id from public.profiles where role in ('admin','super_admin','owner')));

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only; bayna-apply-0034.mjs runs it):
--   1. profiles_role_check carries all EIGHT §5.2 roles; app_role_rank maps
--      them to 0,0,1,1,2,3,4,5.
--   2. role_permissions: RLS on, ZERO policies, zero client-role grants,
--      49 seeded rows (3/3/8/11/12/12 + user/merchant empty).
--   3. has_permission: granted to authenticated AND anon, denied to public;
--      prosrc refuses is_banned.
--   4. admin_list_role_permissions returns 96 rows (gate has_min_role);
--      admin_set_role_permission carries all six refusal codes + audit.
--   5. prosrc literal match pre→post for the five verbatim re-declarations;
--      marker checks for admin_set_user_role / protect_profile_privileges.
--   6. pg_policies: the six replaced policies use has_permission; the eight
--      0009 policies contain 'owner'; complaint_attachments_select gained
--      has_permission('complaints.view').
--   7. Data snapshot: profiles/listings/requests/notifications/audit rows
--      unchanged — 0034 writes ONLY the 49 role_permissions seeds.
-- ---------------------------------------------------------------------------
