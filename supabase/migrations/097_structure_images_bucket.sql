-- 097: structure_images storage bucket for map-structure artwork.
-- Public read (structures render for everyone); authenticated upload/delete.
-- Follows the same pattern as effect_images / map_images.
insert into storage.buckets (id, name, public)
values ('structure_images', 'structure_images', true)
on conflict (id) do nothing;

drop policy if exists "structure_images_read" on storage.objects;
create policy "structure_images_read" on storage.objects
  for select using (bucket_id = 'structure_images');

drop policy if exists "structure_images_insert" on storage.objects;
create policy "structure_images_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'structure_images');

drop policy if exists "structure_images_update" on storage.objects;
create policy "structure_images_update" on storage.objects
  for update to authenticated using (bucket_id = 'structure_images');

drop policy if exists "structure_images_delete" on storage.objects;
create policy "structure_images_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'structure_images');
