-- Fix cascading deletes: command_log must cascade when a scenario is deleted
ALTER TABLE command_log DROP CONSTRAINT command_log_scenario_id_fkey,
  ADD FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE;
