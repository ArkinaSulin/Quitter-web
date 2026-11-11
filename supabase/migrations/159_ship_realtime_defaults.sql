-- 159: Ship realtime publication, atmosphere default, declaration round.
--
-- - `ship_spelljammer` was missing from the realtime publication, so placed
--   ships never appeared on other clients until a reload.
-- - New games default to Atmosphere mode; existing rows are left untouched.
-- - `declared_round` remembers which round a ship's speed was declared for, so
--   the step-1 pilot popup is not shown again in the same round.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ship_spelljammer'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ship_spelljammer;
    END IF;
  END IF;
END $$;

ALTER TABLE scenarios ALTER COLUMN ship_mode SET DEFAULT 'atmosphere';

ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS declared_round integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION ship_field_to_column(fld text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE fld
    WHEN 'templateId' THEN 'template_id'
    WHEN 'name' THEN 'name'
    WHEN 'team' THEN 'team'
    WHEN 'hex' THEN 'hex'
    WHEN 'facing' THEN 'facing'
    WHEN 'speedStat' THEN 'speed_stat'
    WHEN 'shipHp' THEN 'ship_hp'
    WHEN 'shipHpMax' THEN 'ship_hp_max'
    WHEN 'loadedCargo' THEN 'loaded_cargo'
    WHEN 'crewAssigned' THEN 'crew_assigned'
    WHEN 'boxState' THEN 'box_state'
    WHEN 'attachedToShip' THEN 'attached_to_ship'
    WHEN 'snapshot' THEN 'snapshot'
    WHEN 'elevation' THEN 'elevation'
    WHEN 'lastSpeed' THEN 'last_speed'
    WHEN 'declaredSpeed' THEN 'declared_speed'
    WHEN 'declaredRound' THEN 'declared_round'
    WHEN 'speedSpent' THEN 'speed_spent'
    WHEN 'turnsSinceFacing' THEN 'turns_since_facing'
    WHEN 'stepBudget' THEN 'step_budget'
    WHEN 'stations' THEN 'stations'
    WHEN 'crewState' THEN 'crew_state'
    WHEN 'reload' THEN 'reload'
    WHEN 'weaponState' THEN 'weapon_state'
    WHEN 'imageUrl' THEN 'image_url'
    WHEN 'keelLength' THEN 'keel_length'
    WHEN 'imageOffsetY' THEN 'image_offset_y'
    WHEN 'isDeleted' THEN 'is_deleted'
  END;
$$;
