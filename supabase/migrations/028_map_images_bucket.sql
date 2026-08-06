-- 028: map_images storage bucket for battlefield background images.
-- Public read (the map renders them for everyone); authenticated upload/delete
-- (the GM edits the map). Follows the same pattern as unit_images / scenario_screenshots.
insert into storage.buckets (id, name, public)
values ('map_images', 'map_images', true)
on conflict (id) do nothing;

create policy "map_images_read" on storage.objects
  for select using (bucket_id = 'map_images');

create policy "map_images_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'map_images');

create policy "map_images_update" on storage.objects
  for update to authenticated using (bucket_id = 'map_images');

create policy "map_images_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'map_images');
