-- 146: Per-component card combination flag.
--
-- Weapons always render one card per unit. Components can aggregate their
-- count into one card unless can_combine is false. Helm and Command bridge are
-- naturally one physical card per unit.

ALTER TABLE ship_components
  ADD COLUMN IF NOT EXISTS can_combine boolean NOT NULL DEFAULT true;

UPDATE ship_components
SET can_combine = false
WHERE lower(name) IN ('helm', 'command bridge');
