-- 136: Ship Editor v2 fields + ship image bucket.
--
-- Adds the authored weapon-capacity budget, atmospheric speed, damage threshold
-- and the ship preview image. Catalog rows gain an optional image URL and a
-- per-component AC (armor keeps its existing AC column).
--
-- Weapon capacity counts toward ship mass; placed weapons must fit inside it.

ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS weapon_capacity integer NOT NULL DEFAULT 0;
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS atmospheric_speed integer NOT NULL DEFAULT 0;
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS damage_threshold integer NOT NULL DEFAULT 15;

ALTER TABLE ship_components ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
ALTER TABLE ship_components ADD COLUMN IF NOT EXISTS ac integer NOT NULL DEFAULT 10;

ALTER TABLE ship_accessories ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
ALTER TABLE ship_accessories ADD COLUMN IF NOT EXISTS ac integer NOT NULL DEFAULT 10;

ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS ac integer NOT NULL DEFAULT 10;

ALTER TABLE ship_armors ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';

-- The hull card needs a catalog row for its image / AC (mass is derived).
INSERT INTO ship_components (id, mass, crew, cost, hittable, ac, image_url)
VALUES ('hull', 0, 0, 0, false, 10, '')
ON CONFLICT (id) DO NOTHING;

-- Preserve old templates: allocate capacity equal to the weapons already placed.
UPDATE ship_templates st
SET weapon_capacity = COALESCE((
  SELECT SUM(
    CASE
      WHEN sw.mount = 'large' THEN 2
      WHEN sw.mount = 'small' THEN 1
      ELSE 0
    END * tw.count
  )
  FROM ship_template_weapons tw
  JOIN ship_weapons sw ON sw.id = tw.weapon_id
  WHERE tw.template_id = st.id
), 0)
WHERE weapon_capacity = 0;

-- --- Ship image bucket -------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('ship_images', 'ship_images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ship_images_read" ON storage.objects;
CREATE POLICY "ship_images_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'ship_images');

DROP POLICY IF EXISTS "ship_images_insert" ON storage.objects;
CREATE POLICY "ship_images_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ship_images');

DROP POLICY IF EXISTS "ship_images_update" ON storage.objects;
CREATE POLICY "ship_images_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'ship_images');

DROP POLICY IF EXISTS "ship_images_delete" ON storage.objects;
CREATE POLICY "ship_images_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'ship_images');
