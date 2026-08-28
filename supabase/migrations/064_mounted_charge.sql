-- 064: GM per-scenario toggle for the mounted charge action.
-- Default ON (charges enabled). When off, no new Charge! may be initiated.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS mounted_charge_enabled BOOLEAN NOT NULL DEFAULT true;
