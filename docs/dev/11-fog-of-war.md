# 11 — Fog of War & Visibility

Pure logic in `src/lib/fogOfWar.ts`; the graded veil + unseen fill live in the
map draw layer. Migrations: 071 (fog columns/settings), 072 (rename
`night_vision` → `darkvision`).

## Sight

- Effective sight radius of a unit =
  `max(scenario sight_radius, unit.darkvision)` (`unitSightRadius`). Scenario
  `sight_radius` defaults 2 (`DEFAULT_SIGHT_RADIUS`). `darkvision` is authored
  on races → templates → spawned units (the map stack keeps it at all three
  levels so nothing is lost; races are the authored source).
- The unit's **own hex is always visible** (it stands there); the radius counts
  hexes beyond it.

## Graded reveal (not binary)

`computeFog(units, group, alliances, baseSight)` returns `{ reveal, dim }`:

- **`reveal`** = every hex within sight of any living, non-hidden unit of the
  viewer's alliance group.
- **`dim`** = revealed hexes near the sight edge, each with an alpha:
  the outermost revealed ring dims **0.6**, the next **0.4**, the next **0.2**
  (`FOG_RING_ALPHAS`) — the edge is soft, up to 3 rings deep. Hexes deeper in
  (and the unit's own hex) are crisp (absent from `dim`).
- Where several units see the same hex, the **clearest coverage wins** (lowest
  alpha) — a unit hugging a hex clears a farther unit's dim edge.
- **Hidden units exert no reveal at all** (a concealed unit doesn't light the
  map for its side). Deleted units neither.
- Unseen hexes get the opaque veil for players (`1.0`) or translucent for the
  DM / replay (`0.8`) so the GM can see through the boundary. Veil RGB is a
  warm `{30,16,4}` — distinct from the grey terrain-cost shading.

## Viewer & alliance

- Reveal follows the **viewer's alliance group** (`ScenarioMap` picks the group
  from the viewer's team/alliances; a GM playing as a player gets real fog via
  `effectiveIsGM`).
- In replay the reveal follows the **acting alliance per step**
  (`useReplay.replayCurrentTurnAlliance`).

## Behavior gates

- Hover tooltip and context menu are gated by visibility (can't inspect what
  you can't see). Drag overlays still compute from visible information.
- **Attack gate**: a unit (DM-controlled included) is blocked from attacking a
  hex its own side cannot see (`canAttackInFog` → `canAttackTarget` prop on
  `useCombatActions.handleAttackRequest` and `useReactionActions`; red error).
  Healing stays line-of-sight-free.
- GM paints sight (brushes) vs click reveals in the fog UI; the DM sees
  translucent unseen so they can adjudicate.

## Settings & toggles

Scenario Settings (GM): **Fog of war** on/off + **Sight radius** 1–9. The
per-scenario fog toggle and the sight radius ride `scenarios` + settings like
the other Scenario Settings toggles (see `06`).
