-- BADAL MVP — listing-images storage bucket + policies
-- Public read for published listing images; write only by authenticated owner
-- under {auth.uid()}/{listing_id}/...

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

-- authenticated users may upload into their own folder
drop policy if exists "listing_images_upload" on storage.objects;
create policy "listing_images_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- owner may replace/delete objects under their folder
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
  );

drop policy if exists "listing_images_delete" on storage.objects;
create policy "listing_images_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- public read (bucket is public; RLS on listing_images table still gates DB rows)
drop policy if exists "listing_images_public_read" on storage.objects;
create policy "listing_images_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'listing-images');
