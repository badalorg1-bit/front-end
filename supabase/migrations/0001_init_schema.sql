-- BADAL MVP — core schema
-- Money is stored as integer Egyptian pounds (ج.م). No floats.
-- listing_requests.request_type: rent | purchase | swap
-- listing_requests.status: pending | accepted | rejected | cancelled

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  city text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles for insert
  with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- listings
-- ---------------------------------------------------------------------------
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  listing_type text not null check (listing_type in ('rent', 'sale', 'swap')),
  category text not null,
  city text not null check (char_length(city) between 1 and 80),
  district text,
  condition text not null default 'جيد' check (condition in ('جديد', 'ممتاز', 'جيد')),
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  rental_price integer check (rental_price is null or rental_price >= 0),
  rental_unit text check (rental_unit is null or rental_unit in ('ساعة', 'يوم', 'شهر')),
  sale_price integer check (sale_price is null or sale_price >= 0),
  swap_preferences text,
  deposit integer not null default 0 check (deposit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- type-specific required fields
  constraint listings_rent_fields check (
    listing_type <> 'rent'
    or (rental_price is not null and rental_unit is not null)
  ),
  constraint listings_sale_fields check (
    listing_type <> 'sale' or sale_price is not null
  ),
  constraint listings_swap_fields check (
    listing_type <> 'swap'
    or (swap_preferences is not null and char_length(trim(swap_preferences)) > 0)
  )
);

create index if not exists listings_public_idx
  on public.listings (status, listing_type, city)
  where status = 'published';

create index if not exists listings_owner_idx on public.listings (owner_id);

alter table public.listings enable row level security;

drop policy if exists "listings_select_visible" on public.listings;
create policy "listings_select_visible"
  on public.listings for select
  using (
    status = 'published'
    or owner_id = auth.uid()
  );

drop policy if exists "listings_insert_owner" on public.listings;
create policy "listings_insert_owner"
  on public.listings for insert
  with check (owner_id = auth.uid());

drop policy if exists "listings_update_owner" on public.listings;
create policy "listings_update_owner"
  on public.listings for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "listings_delete_owner" on public.listings;
create policy "listings_delete_owner"
  on public.listings for delete
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- listing_images
-- ---------------------------------------------------------------------------
create table if not exists public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  storage_path text not null unique,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists listing_images_listing_idx
  on public.listing_images (listing_id, sort_order);

alter table public.listing_images enable row level security;

drop policy if exists "listing_images_select_visible" on public.listing_images;
create policy "listing_images_select_visible"
  on public.listing_images for select
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (l.status = 'published' or l.owner_id = auth.uid())
    )
  );

drop policy if exists "listing_images_insert_owner" on public.listing_images;
create policy "listing_images_insert_owner"
  on public.listing_images for insert
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.owner_id = auth.uid()
    )
  );

drop policy if exists "listing_images_update_owner" on public.listing_images;
create policy "listing_images_update_owner"
  on public.listing_images for update
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.owner_id = auth.uid()
    )
  );

drop policy if exists "listing_images_delete_owner" on public.listing_images;
create policy "listing_images_delete_owner"
  on public.listing_images for delete
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- listing_requests (rent | purchase | swap)
-- ---------------------------------------------------------------------------
create table if not exists public.listing_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  request_type text not null check (request_type in ('rent', 'purchase', 'swap')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  message text check (message is null or char_length(message) <= 2000),
  rent_start date,
  rent_end date,
  offered_listing_id uuid references public.listings (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_requests_no_self check (requester_id <> owner_id),
  constraint listing_requests_rent_dates check (
    request_type <> 'rent'
    or (rent_start is not null and rent_end is not null and rent_end >= rent_start)
  ),
  constraint listing_requests_swap_offer check (
    request_type <> 'swap' or offered_listing_id is not null
  ),
  -- single-unit accepted rentals cannot overlap (half-open [start, end+1))
  constraint listing_requests_no_rental_overlap
    exclude using gist (
      listing_id with =,
      daterange(rent_start, rent_end + 1, '[)') with &&
    )
    where (status = 'accepted' and request_type = 'rent')
);

create index if not exists listing_requests_owner_idx
  on public.listing_requests (owner_id, status, created_at desc);
create index if not exists listing_requests_requester_idx
  on public.listing_requests (requester_id, status, created_at desc);
create index if not exists listing_requests_listing_idx
  on public.listing_requests (listing_id, status);

alter table public.listing_requests enable row level security;

-- keep owner_id in sync with listing
create or replace function public.sync_request_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select owner_id into new.owner_id from public.listings where id = new.listing_id;
  if new.owner_id is null then
    raise exception 'listing not found';
  end if;
  if new.requester_id = new.owner_id then
    raise exception 'cannot request own listing';
  end if;
  return new;
end;
$$;

drop trigger if exists listing_requests_sync_owner on public.listing_requests;
create trigger listing_requests_sync_owner
  before insert on public.listing_requests
  for each row execute function public.sync_request_owner();

-- enforce status transition rules
create or replace function public.enforce_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status = 'pending' and new.status in ('accepted', 'rejected') then
    if auth.uid() is distinct from old.owner_id then
      raise exception 'only the listing owner can accept or reject';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'cancelled' then
    if auth.uid() is distinct from old.requester_id then
      raise exception 'only the requester can cancel';
    end if;
    return new;
  end if;

  raise exception 'invalid status transition from % to %', old.status, new.status;
end;
$$;

drop trigger if exists listing_requests_transition on public.listing_requests;
create trigger listing_requests_transition
  before update on public.listing_requests
  for each row execute function public.enforce_request_transition();

drop policy if exists "listing_requests_select_party" on public.listing_requests;
create policy "listing_requests_select_party"
  on public.listing_requests for select
  using (
    requester_id = auth.uid()
    or owner_id = auth.uid()
  );

drop policy if exists "listing_requests_insert_requester" on public.listing_requests;
create policy "listing_requests_insert_requester"
  on public.listing_requests for insert
  with check (
    requester_id = auth.uid()
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.status = 'published'
        and l.owner_id <> auth.uid()
    )
  );

drop policy if exists "listing_requests_update_party" on public.listing_requests;
create policy "listing_requests_update_party"
  on public.listing_requests for update
  using (
    requester_id = auth.uid()
    or owner_id = auth.uid()
  )
  with check (
    requester_id = auth.uid()
    or owner_id = auth.uid()
  );

-- no client delete; cancel goes through status = cancelled
drop policy if exists "listing_requests_delete_none" on public.listing_requests;

-- ---------------------------------------------------------------------------
-- updated_at trigger shared helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists listings_updated_at on public.listings;
create trigger listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

drop trigger if exists listing_requests_updated_at on public.listing_requests;
create trigger listing_requests_updated_at
  before update on public.listing_requests
  for each row execute function public.set_updated_at();
