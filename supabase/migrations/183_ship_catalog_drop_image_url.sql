-- 183_ship_catalog_drop_image_url.sql
-- Component/weapon catalog images were never rendered; ship images live on
-- ship_templates.image_url and ship_images.
ALTER TABLE ship_components DROP COLUMN IF EXISTS image_url;
ALTER TABLE ship_weapons DROP COLUMN IF EXISTS image_url;
