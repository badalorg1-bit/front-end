-- BADAL — admin system: roles, ban, blocked content, notifications, audit
-- Roles: user | moderator | admin | super_admin
-- listing status gains: blocked

-- ---------------------------------------------------------------------------
-- profiles: role + ban
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'user';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'moderator', 'admin', 'super_admin'));

alter table public.profiles
  add column if not exists is_banned boolean not null default false;

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_created_idx on public.profiles (created_at);

-- ---------------------------------------------------------------------------
-- listings: blocked status
-- ---------------------------------------------------------------------------
alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings
  add constraint listings_status_check
  check (status in ('draft', 'published', 'archived', 'blocked'));

create index if not exists listings_status_idx on public.listings (status, created_at);
create index if not exists listings_created_idx on public.listings (created_at);

-- ---------------------------------------------------------------------------
-- notifications (in-app)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  kind text not null default 'system'
    check (kind in ('system', 'moderation', 'request', 'broadcast')),
  listing_id uuid references public.listings (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- ---------------------------------------------------------------------------
-- admin_audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_created_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- role helpers
-- ---------------------------------------------------------------------------
create or replace function public.app_role_rank(r text)
returns integer
language sql
immutable
as $$
  select case r
    when 'user' then 0
    when 'moderator' then 1
    when 'admin' then 2
    when 'super_admin' then 3
    else -1
  end;
$$;

create or replace function public.has_min_role(min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_banned = false
      and app_role_rank(p.role) >= app_role_rank(min_role)
  );
$$;

grant execute on function public.has_min_role(text) to authenticated;
grant execute on function public.has_min_role(text) to anon;

-- ---------------------------------------------------------------------------
-- protect privilege fields from self-escalation
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id = auth.uid() then
    if not has_min_role('admin') then
      new.role := old.role;
      new.is_banned := old.is_banned;
    end if;
  end if;

  if old.role = 'super_admin' and new.role is distinct from old.role then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'super_admin'
        and p.id <> old.id
        and p.is_banned = false
    ) then
      raise exception 'لا يمكن تخفيض صلاحية آخر مسؤول نظام';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- ---------------------------------------------------------------------------
-- RLS: profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid() and is_banned = false)
  with check (id = auth.uid() and is_banned = false);

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (has_min_role('admin'))
  with check (has_min_role('admin'));

-- ---------------------------------------------------------------------------
-- RLS: listings (moderator+ can see and moderate all)
-- ---------------------------------------------------------------------------
drop policy if exists "listings_select_admin" on public.listings;
create policy "listings_select_admin"
  on public.listings for select
  using (has_min_role('moderator'));

-- No listings_update_admin: moderators change status only via admin_set_listing_status
-- RPC (SECURITY DEFINER). Direct UPDATE stays owner-only.

drop policy if exists "listings_delete_admin" on public.listings;
create policy "listings_delete_admin"
  on public.listings for delete
  using (has_min_role('admin'));

-- ---------------------------------------------------------------------------
-- RLS: listing_images (admin can manage)
-- ---------------------------------------------------------------------------
drop policy if exists "listing_images_select_admin" on public.listing_images;
create policy "listing_images_select_admin"
  on public.listing_images for select
  using (has_min_role('moderator'));

drop policy if exists "listing_images_delete_admin" on public.listing_images;
create policy "listing_images_delete_admin"
  on public.listing_images for delete
  using (has_min_role('admin'));

-- ---------------------------------------------------------------------------
-- RLS: listing_requests (moderator+ can inspect)
-- ---------------------------------------------------------------------------
drop policy if exists "listing_requests_select_admin" on public.listing_requests;
create policy "listing_requests_select_admin"
  on public.listing_requests for select
  using (has_min_role('moderator'));

-- ---------------------------------------------------------------------------
-- RLS: notifications
-- ---------------------------------------------------------------------------
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (user_id = auth.uid() or has_min_role('moderator'));

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications_insert_admin" on public.notifications;
create policy "notifications_insert_admin"
  on public.notifications for insert
  with check (has_min_role('moderator'));

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
  on public.notifications for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: admin_audit_log
-- ---------------------------------------------------------------------------
drop policy if exists "admin_audit_select" on public.admin_audit_log;
create policy "admin_audit_select"
  on public.admin_audit_log for select
  using (has_min_role('admin'));

drop policy if exists "admin_audit_insert" on public.admin_audit_log;
create policy "admin_audit_insert"
  on public.admin_audit_log for insert
  with check (has_min_role('moderator'));

-- ---------------------------------------------------------------------------
-- admin RPCs
-- ---------------------------------------------------------------------------
create or replace function public.admin_broadcast_notification(
  p_title text,
  p_body text default '',
  p_kind text default 'broadcast'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not has_min_role('moderator') then
    raise exception 'ليست لديك صلاحية إرسال إشعارات';
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 1 or char_length(p_title) > 120 then
    raise exception 'عنوان الإشعار غير صالح';
  end if;
  if char_length(coalesce(p_body, '')) > 2000 then
    raise exception 'نص الإشعار طويل جدًا';
  end if;
  if p_kind not in ('system', 'moderation', 'broadcast') then
    raise exception 'نوع إشعار غير مدعوم';
  end if;

  insert into public.notifications (user_id, title, body, kind)
  select id, trim(p_title), coalesce(p_body, ''), p_kind
  from public.profiles
  where is_banned = false;

  get diagnostics n = row_count;

  insert into public.admin_audit_log (actor_id, action, target_type, meta)
  values (
    auth.uid(),
    'broadcast_notification',
    'system',
    jsonb_build_object('count', n, 'title', trim(p_title))
  );

  return n;
end;
$$;

create or replace function public.admin_notify_user(
  p_user_id uuid,
  p_title text,
  p_body text default '',
  p_kind text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nid uuid;
begin
  if not has_min_role('moderator') then
    raise exception 'ليست لديك صلاحية إرسال إشعارات';
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 1 or char_length(p_title) > 120 then
    raise exception 'عنوان الإشعار غير صالح';
  end if;
  if char_length(coalesce(p_body, '')) > 2000 then
    raise exception 'نص الإشعار طويل جدًا';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'المستخدم غير موجود';
  end if;

  insert into public.notifications (user_id, title, body, kind)
  values (p_user_id, trim(p_title), coalesce(p_body, ''), p_kind)
  returning id into nid;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'notify_user', 'profile', p_user_id, jsonb_build_object('title', trim(p_title)));

  return nid;
end;
$$;

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
  if p_role not in ('user', 'moderator', 'admin', 'super_admin') then
    raise exception 'دور غير صالح';
  end if;

  select app_role_rank(role) into actor_rank from public.profiles where id = auth.uid();
  select app_role_rank(role) into target_rank from public.profiles where id = p_user_id;
  new_rank := app_role_rank(p_role);

  if target_rank is null then
    raise exception 'المستخدم غير موجود';
  end if;
  if actor_rank < 2 then
    raise exception 'ليست لديك صلاحية';
  end if;
  if target_rank >= actor_rank and auth.uid() <> p_user_id then
    raise exception 'لا يمكنك تعديل دور يساوي صلاحيتك أو يفوقها';
  end if;
  if new_rank > actor_rank then
    raise exception 'لا يمكنك منح صلاحية أعلى من صلاحيتك';
  end if;
  if p_role = 'super_admin' and actor_rank < 3 then
    raise exception 'منح مسؤول نظام يتطلب صلاحية مسؤول نظام';
  end if;

  update public.profiles set role = p_role, updated_at = now() where id = p_user_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'set_user_role', 'profile', p_user_id, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_set_user_ban(
  p_user_id uuid,
  p_banned boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_rank int;
  target_rank int;
begin
  if not has_min_role('admin') then
    raise exception 'ليست لديك صلاحية حظر المستخدمين';
  end if;

  select app_role_rank(role) into actor_rank from public.profiles where id = auth.uid();
  select app_role_rank(role) into target_rank from public.profiles where id = p_user_id;

  if target_rank is null then
    raise exception 'المستخدم غير موجود';
  end if;
  if auth.uid() = p_user_id then
    raise exception 'لا يمكنك حظر نفسك';
  end if;
  if target_rank >= actor_rank then
    raise exception 'لا يمكنك حظر مستخدم بصلاحية مساوية أو أعلى';
  end if;

  update public.profiles set is_banned = p_banned, updated_at = now() where id = p_user_id;

  if p_banned then
    update public.listings set status = 'archived', updated_at = now()
    where owner_id = p_user_id and status in ('published', 'blocked');
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'set_user_ban', 'profile', p_user_id, jsonb_build_object('banned', p_banned));
end;
$$;

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
  if not has_min_role('moderator') then
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

grant execute on function public.admin_broadcast_notification(text, text, text) to authenticated;
grant execute on function public.admin_notify_user(uuid, text, text, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;
grant execute on function public.admin_set_user_ban(uuid, boolean) to authenticated;
grant execute on function public.admin_set_listing_status(uuid, text) to authenticated;
