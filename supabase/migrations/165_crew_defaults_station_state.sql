-- 165: New generic-crew defaults + station action state.
--
-- CrewSkill is implicit for generic crew (no column); heroes never get it.
-- The crew roster is intentionally cleared so the DM can re-add crew with the
-- new stat line.

DELETE FROM ship_crews;

ALTER TABLE ship_crews ALTER COLUMN str SET DEFAULT 12;
ALTER TABLE ship_crews ALTER COLUMN dex SET DEFAULT 14;
ALTER TABLE ship_crews ALTER COLUMN con SET DEFAULT 14;
ALTER TABLE ship_crews ALTER COLUMN "int" SET DEFAULT 10;
ALTER TABLE ship_crews ALTER COLUMN wis SET DEFAULT 12;
ALTER TABLE ship_crews ALTER COLUMN cha SET DEFAULT 8;

ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS mc_reduction integer NOT NULL DEFAULT 0;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS sail_max_step integer NOT NULL DEFAULT 0;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS sail_trim_step integer NOT NULL DEFAULT 0;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS ram_used_turn integer NOT NULL DEFAULT 0;

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
    WHEN 'crewTeam' THEN 'crew_team'
    WHEN 'reload' THEN 'reload'
    WHEN 'weaponState' THEN 'weapon_state'
    WHEN 'imageUrl' THEN 'image_url'
    WHEN 'keelLength' THEN 'keel_length'
    WHEN 'imageOffsetY' THEN 'image_offset_y'
    WHEN 'isDeleted' THEN 'is_deleted'
    WHEN 'mcReduction' THEN 'mc_reduction'
    WHEN 'sailMaxStep' THEN 'sail_max_step'
    WHEN 'sailTrimStep' THEN 'sail_trim_step'
    WHEN 'ramUsedTurn' THEN 'ram_used_turn'
  END;
$$;
