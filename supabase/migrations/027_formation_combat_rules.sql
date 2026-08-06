-- 027: Formation combat-rule matrix (data-driven, replaces hard-coded branches).
-- Arcs use 'front' | 'flank' | 'rear'. Ranged attacks against open/scattered/routed
-- formations deal 50% fewer attacks (be_attacked_range_modifier). Melee attacks
-- against scattered (1.5x) and routed (2x) formations get bonus attacks
-- (be_attacked_melee_modifier) — historically, pursuit after routing is where most
-- kills happen.
--
-- Columns:
--   melee_target_arcs        arcs a unit in this formation may melee into
--   ranged_target_arcs       arcs a unit in this formation may ranged-attack into
--   threat_arcs              arcs that count as normal threat on this unit
--   double_threat_arcs       arcs that count as double threat on this unit
--   retaliate_arcs           jsonb {front,flank,rear} -> 'full' | 'rows' | 'none'
--   retaliate_vs_ranged      may this formation retaliate against a ranged attack?
--   can_charge               may a unit in this formation charge?
--   stop_enemy_movement_arcs arcs in which this formation blocks enemy movement
--   charge_through_arcs      (reserved) arcs through which a charging unit may pass
--   be_attacked_melee_modifier   attack-count multiplier vs melee against this unit
--   be_attacked_range_modifier   attack-count multiplier vs ranged against this unit

ALTER TABLE formations
  ADD COLUMN IF NOT EXISTS melee_target_arcs          TEXT[] NOT NULL DEFAULT '{front}',
  ADD COLUMN IF NOT EXISTS ranged_target_arcs         TEXT[] NOT NULL DEFAULT '{front,flank,rear}',
  ADD COLUMN IF NOT EXISTS threat_arcs                TEXT[] NOT NULL DEFAULT '{front,flank}',
  ADD COLUMN IF NOT EXISTS double_threat_arcs         TEXT[] NOT NULL DEFAULT '{rear}',
  ADD COLUMN IF NOT EXISTS retaliate_arcs             JSONB NOT NULL DEFAULT '{"front":"full","flank":"rows","rear":"none"}',
  ADD COLUMN IF NOT EXISTS retaliate_vs_ranged        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_charge                 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stop_enemy_movement_arcs   TEXT[] NOT NULL DEFAULT '{front}',
  ADD COLUMN IF NOT EXISTS charge_through_arcs        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS be_attacked_melee_modifier REAL NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS be_attacked_range_modifier REAL NOT NULL DEFAULT 1.0;

-- Routed units cannot attack at all.
UPDATE formations SET attack_capacity_multiplier = 0 WHERE name = 'Routed';

-- Seed per the rule matrix. 'Sides' => 'flank', 'Front and sides' => {front,flank}.
-- Arc sets use '{...}' array literal syntax.
UPDATE formations SET
  melee_target_arcs = '{front,flank,rear}',
  ranged_target_arcs = '{front,flank,rear}',
  threat_arcs = '{front,flank,rear}',
  double_threat_arcs = '{}',
  retaliate_arcs = '{"front":"full","flank":"full","rear":"full"}',
  retaliate_vs_ranged = false,
  can_charge = false,
  stop_enemy_movement_arcs = '{}',
  charge_through_arcs = '{front,flank,rear}',
  be_attacked_melee_modifier = 1.0,
  be_attacked_range_modifier = 1.0
WHERE name = 'Hero';

UPDATE formations SET
  melee_target_arcs = '{front}',
  ranged_target_arcs = '{front,flank,rear}',
  threat_arcs = '{front,flank}',
  double_threat_arcs = '{rear}',
  retaliate_arcs = '{"front":"full","flank":"rows","rear":"none"}',
  retaliate_vs_ranged = false,
  can_charge = false,
  stop_enemy_movement_arcs = '{front}',
  charge_through_arcs = '{flank}',
  be_attacked_melee_modifier = 1.0,
  be_attacked_range_modifier = 1.0
WHERE name = 'Phalanx';

UPDATE formations SET
  melee_target_arcs = '{front}',
  ranged_target_arcs = '{front,flank,rear}',
  threat_arcs = '{front,flank}',
  double_threat_arcs = '{rear}',
  retaliate_arcs = '{"front":"full","flank":"rows","rear":"none"}',
  retaliate_vs_ranged = false,
  can_charge = false,
  stop_enemy_movement_arcs = '{front}',
  charge_through_arcs = '{flank}',
  be_attacked_melee_modifier = 1.0,
  be_attacked_range_modifier = 1.0
WHERE name = 'Shield Wall';

UPDATE formations SET
  melee_target_arcs = '{front}',
  ranged_target_arcs = '{front,flank,rear}',
  threat_arcs = '{front,flank}',
  double_threat_arcs = '{rear}',
  retaliate_arcs = '{"front":"full","flank":"rows","rear":"none"}',
  retaliate_vs_ranged = false,
  can_charge = true,
  stop_enemy_movement_arcs = '{front}',
  charge_through_arcs = '{flank}',
  be_attacked_melee_modifier = 1.0,
  be_attacked_range_modifier = 1.0
WHERE name = 'Close Order';

UPDATE formations SET
  melee_target_arcs = '{front}',
  ranged_target_arcs = '{front,flank,rear}',
  threat_arcs = '{front,flank}',
  double_threat_arcs = '{rear}',
  retaliate_arcs = '{"front":"full","flank":"rows","rear":"none"}',
  retaliate_vs_ranged = false,
  can_charge = true,
  stop_enemy_movement_arcs = '{front}',
  charge_through_arcs = '{front,flank,rear}',
  be_attacked_melee_modifier = 1.0,
  be_attacked_range_modifier = 0.5
WHERE name = 'Open Order';

UPDATE formations SET
  melee_target_arcs = '{front,flank,rear}',
  ranged_target_arcs = '{front,flank,rear}',
  threat_arcs = '{front,flank,rear}',
  double_threat_arcs = '{}',
  retaliate_arcs = '{"front":"rows","flank":"rows","rear":"rows"}',
  retaliate_vs_ranged = false,
  can_charge = false,
  stop_enemy_movement_arcs = '{}',
  charge_through_arcs = '{front,flank,rear}',
  be_attacked_melee_modifier = 1.5,
  be_attacked_range_modifier = 0.5
WHERE name = 'Scattered';

UPDATE formations SET
  melee_target_arcs = '{}',
  ranged_target_arcs = '{}',
  threat_arcs = '{}',
  double_threat_arcs = '{front,flank,rear}',
  retaliate_arcs = '{"front":"none","flank":"none","rear":"none"}',
  retaliate_vs_ranged = false,
  can_charge = false,
  stop_enemy_movement_arcs = '{}',
  charge_through_arcs = '{front,flank,rear}',
  be_attacked_melee_modifier = 2.0,
  be_attacked_range_modifier = 0.5
WHERE name = 'Routed';
