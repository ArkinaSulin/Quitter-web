-- 163: Mandatory Deck card, hull/deck split, legacy snapshot rewrite.
--
-- The deck is 20% of the allocated hull (minimum 1 ton) and is hittable. Hull
-- is what remains; when it reaches 0 the hull card is omitted. Existing
-- templates and frozen ship snapshots are rewritten to include the Deck card
-- and the split stats.

INSERT INTO ship_components (id, name, mass, crew, cost, hittable, effect, built_in, can_combine, dt, ac)
VALUES (gen_random_uuid(), 'Deck', 0, 0, 0, true, NULL, true, true, 15, 10)
ON CONFLICT (name) DO UPDATE
SET mass = 0, crew = 0, built_in = true, hittable = true, can_combine = true, dt = 15, ac = 10;

DO $$
DECLARE
  deck_id uuid;
  deck_key text;
  rec record;
  s jsonb;
  hull numeric;
  deck numeric;
  new_hull numeric;
BEGIN
  SELECT id INTO deck_id FROM ship_components WHERE name = 'Deck' LIMIT 1;
  deck_key := 'component:' || deck_id::text;

  UPDATE ship_templates t
  SET deck_layout = jsonb_set(
    COALESCE(t.deck_layout, '{}'::jsonb),
    '{body}',
    COALESCE(t.deck_layout->'body', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('cardKey', deck_key)),
    true
  )
  WHERE t.deck_layout IS NOT NULL
    AND NOT (COALESCE(t.deck_layout->'body', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('cardKey', deck_key)));

  FOR rec IN SELECT id, snapshot FROM ship_spelljammer WHERE snapshot ? 'build'
  LOOP
    s := rec.snapshot;

    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(s->'build'->'components', '[]'::jsonb)) c
      WHERE c->>'name' = 'Deck'
    ) THEN
      s := jsonb_set(
        s,
        '{build,components}',
        COALESCE(s->'build'->'components', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'id', deck_id::text, 'name', 'Deck', 'mass', 0, 'crew', 0, 'cost', 0,
            'hittable', true, 'effect', NULL, 'builtIn', true, 'canCombine', true,
            'dt', 15, 'ac', 10, 'imageUrl', ''
          )
        ),
        true
      );
    END IF;

    IF s->'build' ? 'deckLayout'
       AND NOT (COALESCE(s->'build'->'deckLayout'->'body', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('cardKey', deck_key))) THEN
      s := jsonb_set(
        s,
        '{build,deckLayout,body}',
        COALESCE(s->'build'->'deckLayout'->'body', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('cardKey', deck_key)),
        true
      );
    END IF;

    IF s->'template' ? 'deckLayout'
       AND NOT (COALESCE(s->'template'->'deckLayout'->'body', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('cardKey', deck_key))) THEN
      s := jsonb_set(
        s,
        '{template,deckLayout,body}',
        COALESCE(s->'template'->'deckLayout'->'body', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('cardKey', deck_key)),
        true
      );
    END IF;

    hull := COALESCE((s->'stats'->'massBreakdown'->>'hull')::numeric, 0);
    IF hull > 0 AND NOT (COALESCE(s->'stats'->'massBreakdown', '{}'::jsonb) ? 'deck') THEN
      deck := GREATEST(1, ROUND(hull * 0.2));
      new_hull := GREATEST(0, hull - deck);
      s := jsonb_set(s, '{stats,massBreakdown,hull}', to_jsonb(new_hull::int), true);
      s := jsonb_set(s, '{stats,massBreakdown,deck}', to_jsonb(deck::int), true);
      s := jsonb_set(s, '{stats,hullMass}', to_jsonb(new_hull::int), true);
      s := jsonb_set(s, '{stats,deckMass}', to_jsonb(deck::int), true);
      s := jsonb_set(
        s,
        '{stats,boxGroups}',
        (
          SELECT COALESCE(jsonb_agg(
            CASE WHEN g->>'id' = 'hull'
              THEN jsonb_set(g, '{boxes}', to_jsonb(new_hull::int))
              ELSE g
            END
          ) FILTER (WHERE g->>'id' <> 'hull' OR new_hull > 0), '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('id', 'deck', 'label', 'Deck', 'boxes', deck::int, 'safe', false))
          FROM jsonb_array_elements(COALESCE(s->'stats'->'boxGroups', '[]'::jsonb)) g
        ),
        true
      );
    END IF;

    UPDATE ship_spelljammer SET snapshot = s WHERE id = rec.id;
  END LOOP;
END $$;
