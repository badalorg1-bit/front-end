-- BADAL 0012 - security hardening (PII, ban enforcement, upload MIME)
-- Local only until deploy approval.

-- ---------------------------------------------------------------------------
-- 1) PII: revoke authenticated select on payment columns of profiles
-- ---------------------------------------------------------------------------
revoke select on public.profiles from authenticated;
grant select (id, display_name, city, avatar_url, created_at, updated_at, role, is_banned)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2) RPC: own payment profile (security definer, replaces direct column select)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_payment_profile()
returns table (
  wallet_name text,
  payment_qr_path text,
  instagram_handle text,
  whatsapp_phone text,
  payment_note text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.wallet_name, p.payment_qr_path, p.instagram_handle, p.whatsapp_phone, p.payment_note
  from public.profiles p
  where p.id = auth.uid();
$$;

grant execute on function public.get_my_payment_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Ban helper + enforce on listing / request creation
-- ---------------------------------------------------------------------------
create or replace function public.is_user_banned(p_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_banned from public.profiles where id = p_id), false);
$$;

grant execute on function public.is_user_banned(uuid) to public;

drop policy if exists "listings_insert_owner" on public.listings;
create policy "listings_insert_owner"
  on public.listings for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and not public.is_user_banned(auth.uid())
  );

drop policy if exists "listing_requests_insert_requester" on public.listing_requests;
create policy "listing_requests_insert_requester"
  on public.listing_requests for insert
  to authenticated
  with check (
    requester_id = auth.uid()
    and not public.is_user_banned(auth.uid())
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.status = 'published'
        and l.owner_id <> auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Storage: server-side MIME whitelist on image upload policies
-- ---------------------------------------------------------------------------
drop policy if exists "listing_images_upload" on storage.objects;
create policy "listing_images_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

drop policy if exists "avatars_upload" on storage.objects;
create policy "avatars_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

drop policy if exists "payment_qr_upload" on storage.objects;
create policy "payment_qr_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = auth.uid()::text
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

-- Also lock down update policies (replace object can swap content type)
drop policy if exists "listing_images_update" on storage.objects;
create policy "listing_images_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
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
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

drop policy if exists "payment_qr_update" on storage.objects;
create policy "payment_qr_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = auth.uid()::text
    and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );
