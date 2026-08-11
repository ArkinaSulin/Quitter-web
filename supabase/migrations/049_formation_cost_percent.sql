-- 049: formation change cost is now a % of effective movement, not flat MP.
-- Previously the cost was N MP per org-level step (2), which let fast units hop
-- through formations cheaply while a Phalanx paid ~2 actions for a single change.
-- Now a change costs a flat fraction of the unit's current effective movement
-- (the full MP pool one action converts to). 0.5 = 50% by default; because the
-- fraction is <= 1 the cost never exceeds one action and never drops below 1 MP.
INSERT INTO settings (key, value, description) VALUES
  ('formation_change_cost_per_step', '0.5'::jsonb, 'Fraction of a unit''s current effective movement (one action''s MP pool) charged per formation change')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;
