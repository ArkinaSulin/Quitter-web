-- 141: Normalize ship catalog display names.
--
-- ship_components.name and ship_weapons.name become:
--   * underscores replaced with spaces
--   * lower-case words
--   * first character capitalized
-- e.g. command_bridge -> Command bridge, ballista_light -> Ballista light.
--
-- The unique name constraints stay. If two rows normalize to the same name,
-- abort with a clear error instead of silently colliding.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT upper(left(trim(replace(lower(name), '_', ' ')), 1))
             || substr(trim(replace(lower(name), '_', ' ')), 2) AS normalized
      FROM ship_components
    ) x
    GROUP BY normalized
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ship_components has duplicate names after normalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT upper(left(trim(replace(lower(name), '_', ' ')), 1))
             || substr(trim(replace(lower(name), '_', ' ')), 2) AS normalized
      FROM ship_weapons
    ) x
    GROUP BY normalized
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ship_weapons has duplicate names after normalization';
  END IF;
END $$;

UPDATE ship_components
SET name = upper(left(trim(replace(lower(name), '_', ' ')), 1))
           || substr(trim(replace(lower(name), '_', ' ')), 2);

UPDATE ship_weapons
SET name = upper(left(trim(replace(lower(name), '_', ' ')), 1))
           || substr(trim(replace(lower(name), '_', ' ')), 2);
