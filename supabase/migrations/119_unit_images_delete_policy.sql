-- 119: allow deleting user images from the unit_images bucket.
-- The bucket's read/insert/update policies exist (created out of band), but the
-- image picker now offers deleting an uploaded image from the library, so ensure
-- an authenticated delete policy is present. Idempotent.

insert into storage.buckets (id, name, public)
values ('unit_images', 'unit_images', true)
on conflict (id) do nothing;

drop policy if exists "unit_images_delete" on storage.objects;
create policy "unit_images_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'unit_images');
