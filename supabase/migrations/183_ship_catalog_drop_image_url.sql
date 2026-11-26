-- 183_ship_catalog_drop_image_url_and_notes.sql
-- Component/weapon catalog images were never rendered; ship images live on
-- ship_templates.image_url and ship_images. Free-form component/weapon notes
-- were also removed.
ALTER TABLE ship_components DROP COLUMN IF EXISTS image_url;
ALTER TABLE ship_components DROP COLUMN IF EXISTS effect;
ALTER TABLE ship_weapons DROP COLUMN IF EXISTS image_url;
ALTER TABLE ship_weapons DROP COLUMN IF EXISTS special;
