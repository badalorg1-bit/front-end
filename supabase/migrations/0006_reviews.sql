-- BADAL — reviews (trust layer) + avatars bucket
-- Reviews: one per accepted request per reviewer direction. No self-review.
-- Public read. Insert only by request participants after acceptance.
-- Delete: author or super_admin. No editing.

-- ---------------------------------------------------------------------------
-- 1) reviews table
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.listing_requests (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  constraint reviews_no_self check (reviewer_id <> reviewee_id),
  constraint reviews_unique_per_direction unique (request_id, reviewer_id)
);

create index if not exists reviews_reviewee_idx
  on public.reviews (reviewee_id, created_at desc);

create index if not exists reviews_reviewer_idx
  on public.reviews (reviewer_id, created_at desc);

create index if not exists reviews_request_idx
  on public.reviews (request_id);

alter table public.reviews enable row level security;

-- ---------------------------------------------------------------------------
-- 2) RLS: reviews
-- ---------------------------------------------------------------------------
drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read"
  on public.reviews for select
  to public
  using (true);

drop policy if exists "reviews_insert_participant" on public.reviews;
create policy "reviews_insert_participant"
  on public.reviews for insert
  to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1
      from public.listing_requests r
      where r.id = request_id
        and r.status = 'accepted'
        and (
          (r.requester_id = auth.uid() and reviewee_id = r.owner_id)
          or (r.owner_id = auth.uid() and reviewee_id = r.requester_id)
        )
    )
  );

drop policy if exists "reviews_delete_author_or_admin" on public.reviews;
create policy "reviews_delete_author_or_admin"
  on public.reviews for delete
  to authenticated
  using (
    reviewer_id = auth.uid()
    or has_min_role('super_admin')
  );

-- ---------------------------------------------------------------------------
-- 3) RPC: public profile + rating aggregate for any user id
-- ---------------------------------------------------------------------------
create or replace function public.get_user_public_profile(p_user_id uuid)
returns table (
  id uuid,
  display_name text,
  city text,
  avatar_url text,
  created_at timestamptz,
  rating_avg numeric,
  rating_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.display_name,
    p.city,
    p.avatar_url,
    p.created_at,
    coalesce(avg(r.rating), 0)::numeric as rating_avg,
    count(r.id)::bigint as rating_count
  from public.profiles p
  left join public.reviews r on r.reviewee_id = p.id
  where p.id = p_user_id
    and p.is_banned = false
  group by p.id, p.display_name, p.city, p.avatar_url, p.created_at;
$$;

grant execute on function public.get_user_public_profile(uuid) to public;
grant execute on function public.get_user_public_profile(uuid) to anon;
grant execute on function public.get_user_public_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC: reviews for a user (public)
-- ---------------------------------------------------------------------------
create or replace function public.get_reviews_for_user(p_user_id uuid)
returns table (
  id uuid,
  request_id uuid,
  reviewer_id uuid,
  reviewee_id uuid,
  rating int,
  comment text,
  created_at timestamptz,
  reviewer_name text,
  reviewer_avatar text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.request_id,
    r.reviewer_id,
    r.reviewee_id,
    r.rating,
    r.comment,
    r.created_at,
    p.display_name as reviewer_name,
    p.avatar_url as reviewer_avatar
  from public.reviews r
  join public.profiles p on p.id = r.reviewer_id
  where r.reviewee_id = p_user_id
  order by r.created_at desc
  limit 50;
$$;

grant execute on function public.get_reviews_for_user(uuid) to public;
grant execute on function public.get_reviews_for_user(uuid) to anon;
grant execute on function public.get_reviews_for_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) avatars storage bucket (public read; write only under own folder)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_upload" on storage.objects;
create policy "avatars_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete" on storage.objects;
create policy "avatars_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');
