-- 048: area-effect weapon shape + "magic dimension" rename.
-- magic_radius is now magic_dimension (feet; meaning depends on shape).
-- shape selects the area footprint used by the magic targeting window:
--   circle = dimension is the radius; cube = side; cone = 60° wedge length.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'weapons' AND column_name = 'magic_radius'
  ) THEN
    ALTER TABLE weapons RENAME COLUMN magic_radius TO magic_dimension;
  END IF;
END $$;

ALTER TABLE weapons ADD COLUMN IF NOT EXISTS magic_dimension INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'circle';
