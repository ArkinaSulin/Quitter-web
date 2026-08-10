-- 046: Server-authoritative undo.
-- undo_commands(p_scenario_id, p_target_ids) soft-deletes the LIVE TOP chain —
-- and only if the caller may (owner of the chain, or GM of the scenario).
-- This is what prevents a player from undoing their own move after another
-- player has moved: the DB recomputes the true top from the log, and rejects any
-- request whose ids don't match it exactly, regardless of stale client stacks.

CREATE OR REPLACE FUNCTION undo_commands(p_scenario_id uuid, p_target_ids uuid[])
RETURNS SETOF command_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  top_ids uuid[] := '{}'::uuid[];
  cur_id uuid;
  cur_chained boolean;
  is_gm boolean;
BEGIN
  -- The live top chain: walk back from the last non-deleted row while chained.
  cur_id := (
    SELECT id FROM command_log
    WHERE scenario_id = p_scenario_id AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  );

  WHILE cur_id IS NOT NULL LOOP
    SELECT chained INTO cur_chained FROM command_log WHERE id = cur_id;
    top_ids := top_ids || cur_id;
    IF NOT COALESCE(cur_chained, false) THEN
      EXIT;
    END IF;
    cur_id := (
      SELECT id FROM command_log c
      WHERE c.scenario_id = p_scenario_id AND c.deleted_at IS NULL
        AND (c.created_at, c.id) < (
          SELECT (created_at, id) FROM command_log WHERE id = top_ids[array_length(top_ids, 1)]
        )
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 1
    );
  END LOOP;

  -- Reject unless the requested ids are exactly the top chain.
  IF array_length(top_ids, 1) IS DISTINCT FROM array_length(p_target_ids, 1) THEN
    RETURN;
  END IF;
  IF NOT (top_ids @> p_target_ids AND p_target_ids @> top_ids) THEN
    RETURN;
  END IF;

  -- Permission: GM of the scenario, or owner of the chain.
  SELECT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) INTO is_gm;

  IF NOT is_gm AND NOT EXISTS (
    SELECT 1 FROM command_log WHERE id = ANY(top_ids) AND player_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  -- Soft-delete only rows still live (idempotent under concurrency).
  UPDATE command_log SET deleted_at = now()
  WHERE id = ANY(top_ids) AND deleted_at IS NULL;

  RETURN QUERY SELECT * FROM command_log
    WHERE id = ANY(top_ids)
    ORDER BY created_at, id;
END;
$$;

REVOKE ALL ON FUNCTION undo_commands(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION undo_commands(uuid, uuid[]) TO authenticated;
