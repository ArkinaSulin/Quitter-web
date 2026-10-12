-- 124: drop the vestigial `undo_stack_size` game setting.
--
-- Undo/redo is now server-side (the command log / `scenario_command_log` is the
-- single source of truth, see `docs/dev/04-command-log-undo-redo.md`); the old
-- client-side undo stack was removed, so this tunable is dead. Deleting the row
-- drops it from the admin Settings editor (no code reads it).
DELETE FROM admin_game_settings WHERE key = 'undo_stack_size';
