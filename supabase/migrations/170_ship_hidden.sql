-- 170: DM-hidden ships.
--
-- Hidden ships are invisible/non-interactive for players but still visible (dim)
-- to the DM. Use a dedicated column so hiding is independent of deletion.

ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

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
    WHEN 'cardState' THEN 'card_state'
    WHEN 'weaponState' THEN 'card_state'
    WHEN 'imageUrl' THEN 'image_url'
    WHEN 'keelLength' THEN 'keel_length'
    WHEN 'imageOffsetY' THEN 'image_offset_y'
    WHEN 'hidden' THEN 'hidden'
    WHEN 'isDeleted' THEN 'is_deleted'
    WHEN 'mcReduction' THEN 'mc_reduction'
    WHEN 'sailMaxStep' THEN 'sail_max_step'
    WHEN 'sailTrimStep' THEN 'sail_trim_step'
    WHEN 'ramUsedTurn' THEN 'ram_used_turn'
  END;
$$;
