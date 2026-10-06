Status: planned

# Hero Mount (hero riding a hero) + Elevation/Flying

## Problem Statement

QuiTTER already lets a hero ATTACH to a non-hero unit (`attachedToUnitId` +
`attachedPosition: 'front' | 'back'`), rendering the hero half-size at a vertex
offset, and routing a 30% split of incoming attacks to it. There is no way for a
hero to RIDE another hero (e.g. a hero riding a dragon), and no elevation/flying
layer. Two heroes cannot share a hex, cannot be selected/attacked independently,
and there is no vertical dimension (flying units, climb/descend, air-to-air vs
air-to-ground targeting).

## Solution

Two phases. Phase 1 adds hero-on-hero "riding" as a third `attachedPosition`
value. Phase 2 adds the elevation/flying layer.

### Data model

- `Unit.attachedPosition` widened to `'front' | 'back' | 'rider'`. This is the
  hero's ROLE relative to its host (front = Leader, back = Protected,
  rider = mounted) — NOT an attack direction.
- Rider → mount link reuses `attachedToUnitId`.
- A valid mount is any same-team HERO whose `sizeCategory` is strictly greater
  than the rider's (size-based; no `isMount` flag).
- New instance fields (Phase 2): `elevation` (10-ft steps, `0` = ground) and
  `flySpeed` (aerial movement pool, symmetric to `movementPoints`). `canFly` is
  DERIVED (`flySpeed > 0`) — no separate flag.
- Per-pair attack-split override lives on the rider instance (`mountSplit` number
  | null; null → global setting `mount_main_attack_split`, default `0.7`).

### Phase 1 — hero riding a mount

1. **Attach** — relax the hero-on-hero gates (`!target.isHero` in
   `useCombatActions.ts`, `!u.isHero` in `ContextMenu.tsx`) to allow attaching
   when the target is a larger same-team hero; add a "Ride" option to the inline
   attach modal + context submenu. Attach writes `attachedToUnitId = mount.id`,
   `attachedPosition = 'rider'`.
2. **Select** — reuse `activeHeroId` + ContextMenu "Switch to Hero/Unit"; the
   rider is grabbable like an attached hero.
3. **Render** — for `'rider'`, draw the rider CENTERED on the mount, scaled by
   the rider/mount `sizeCategory` ratio; the mount renders full-size. (Distinct
   from the current half-size front/back vertex offset.)
4. **Combat (defender)** — attacker gets a modal to pick the MAIN target
   (dragon vs rider). The ATTACK COUNT splits
   `main = round(total × pct)`, `other = total − main` (normal rounding, total
   preserved). `pct` = global setting (`mount_main_attack_split`, default 0.7),
   overridable per pair (`mountSplit` on the rider). The rider does NOT retaliate
   when its mount is attacked, but MAY archer-react (ranged + reaction enabled).
5. **Combat (attacker)** — rider and mount act INDEPENDENTLY (no joint volley);
   each spends its own actions and attacks separately.
6. **Economy** — the mount's MP is the movement budget; the rider's MP depletes
   proportionally (tracked, never limiting) and is reconciled on
   dismount/mount-death. Actions are independent; an action the mount converts to
   extra MP is free to the rider.

### Phase 2 — elevation / flying

1. **Vertical attack reach** — each 10 ft of elevation = 1 hex, added to the
   horizontal distance for range (`range = hexDistance + |Δelevation|/10`). Melee
   requires the vertical gap ≤ 1 hex (≤ 10 ft). So a ground melee unit cannot hit
   a unit 20 ft up.
2. **Air layer** — a single air layer (for simplicity). A flyer passes over
   terrain/walls/ground units (ignoring their cost/block/occupancy); no two air
   units share a hex regardless of elevation; ground units never block flyers.
3. **Climb/descend (universal)** — up = 10 ft per hex (1 MP per 10 ft);
   down = unlimited/free.
4. **MP ↔ FP sync** — using one pool passively depletes the other, so a mid-move
   ground→air "hop" stays consistent. Shares one "linked pool" helper with the
   mount→rider MP drain (item 6 above).
5. **Render** — token offset NE 45°, distance scales with `elevation`; shadow dot
   on the ground hex; elevation badge (10-ft) top-left. The HIT BOX is the offset
   token itself (clicks/hovers on it resolve back to the underlying ground hex).
6. **LoS** — a flyer ignores the "shoot over structure" disadvantage penalty.
7. **Threat/ZoC/pursue** — ground kill-zones never affect air units, and air
   units are never pursued; a hero's adjacency is now **same-elevation** (the old
   "air unit within 10 ft imposes threat" applies only to its own column ±10 ft),
   and a rider uses its mount's footprint so threat is **rider+mount combined**.
8. **Rout** — a routed flyer keeps its facing and flies up as far as possible.
9. **Mount death / dismount airborne** — rider resets to `elevation 0` (unless it
   can also fly); a DM modal decides "fly" vs "drop" (D6 per 10 ft); fall damage
   is credited to the unit that killed the mount (for stats).
10. **Interaction filters (universal for ground and air)** — DRAG = ground
    targets; SHIFT = inspect (hide all units, structures remain) for structure
    attack; SPACE = air-only (hide ground, show elevated units).

## Key files (expected)

- `src/types/gameProtocol.ts` — `attachedPosition` widen + `elevation`/`flySpeed`/
  `mountSplit` fields.
- `src/lib/heroAttachment.ts` — rider helpers.
- `src/hooks/useGameEngine.ts` — attach/swap/move commands (rider + economy).
- `src/hooks/useSupabaseSync.ts` — new columns + spawn defaults.
- `src/components/ScenarioMap/useCombatActions.ts` — attach gates, targeting modal,
  split, vertical reach.
- `src/components/ScenarioMap/ContextMenu.tsx` — Ride option + Switch to Hero/Unit.
- `src/components/ScenarioMap/ScenarioMap.tsx` — attach modal, targeting modal,
  drag/Shift/Space filters.
- `src/components/ScenarioMap/useMoveActions.ts` / `useGameEngine.ts` — climb/descend,
  MP↔FP sync, rider MP drain.
- `src/components/ScenarioMap/mapGeometry.ts` + `useCanvasDraw.ts` + `drawToken.ts` —
  rider/elevation rendering, shadow, badge, offset hit box.
- `src/lib/unitMorale.ts` / `zocDisengage.ts` / `pursuit.ts` — elevation gating.
- `src/lib/unitCombat.ts` — attack-count split generalization.
- `supabase/migrations/` — new columns.

## Phasing

1. Spec (this file).
2. Phase 1 (reviewable commits): types → attach → select → render → combat split
   (global setting + per-pair override + modal) → movement/economy.
3. Phase 2: fields/migration → air layer movement → climb/descend + MP↔FP sync →
   vertical reach → threat/rout/disembark → render offset + badge + shadow + LoS →
   universal drag/Shift/Space filters.
