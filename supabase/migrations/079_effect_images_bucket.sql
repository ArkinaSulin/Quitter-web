-- 079: effect_images storage bucket for effect artwork.
-- Public read (effects render for everyone); authenticated upload/delete.
-- Follows the same pattern as map_images / unit_images.
insert into storage.buckets (id, name, public)
values ('effect_images', 'effect_images', true)
on conflict (id) do nothing;

create policy "effect_images_read" on storage.objects
  for select using (bucket_id = 'effect_images');

create policy "effect_images_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'effect_images');

create policy "effect_images_update" on storage.objects
  for update to authenticated using (bucket_id = 'effect_images');

create policy "effect_images_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'effect_images');
