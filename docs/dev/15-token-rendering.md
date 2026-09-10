# 15 — Token Rendering

Canvas rendering shared between the Scenario Map and editor previews.
Core: `src/components/TokenRenderer/drawToken.ts` (pure draw function),
`tokenUtils.ts` (layout math + colors), `TokenRenderer.tsx`/`TokenPreview.tsx`
(editor wrappers). The map draws tokens through `useCanvasDraw.customDraw`.

## Geometry & palette

- Map tokens: `width = hexWidth × 1.6` (≈160), `height = width × 0.75`
  (4:3). Editor previews use independent w/h (also 4:3).
- **Team colors** (colorblind-safe): Blue `#0072B2`, Yellow `#F0E442`, Violet
  `#CC79A7`, Black `#333333`, Orange `#D55E00`, Green `#009E73`. Background =
  team color at 75% alpha (`…BF`); border full opacity.
- **Team shapes** overlay (grey `#999`, alpha per team): circle/triangle/star/
  square/diamond/cross. Heroes shift the shape left 30% so it peeks behind the
  portrait.
- **Alliance ring**: 4px stroke around the token in the alliance color
  (friendly blue / enemy orange / neutral grey).

## The three token types

1. **Army unit (foot)**: upper ⅔ shows troop **dots** (hollow = dead) laid out
   by formation (Open Order rows; Close/Phalanx/Shield Wall packed rows with
   pikes/shields drawn behind the front rank; Scattered random; Routed random
   + a **white flag**). Dot size scales with `sizeCategory × visualScale`.
2. **Mounted unit**: dots become **triangles** (3:5), mount must be ≥1 size
   larger than the rider; tight/loose layouts + Scattered circles.
3. **Hero**: portrait (custom → race icon), HP bar (`currentUnitHp/max` on the
   left 75%) + HP numbers, name at the bottom. No dots/hearts/formation.

## Lower third (units)

Left 25% race/portrait icon · right 25% unit-type/weapon icon · middle 50% =
up to **10 morale hearts** in 2 rows of 5: filled red up to `baseMorale`,
filled **gold** for boosted morale above base, hollow (dashed `[1,1]`) for
remaining capacity. `totalHearts = min(10, max(baseMorale, effectiveMorale))`.
Name runs flush along the bottom in white with a dark shadow.

## Battlefield state markers

- **Action badge** (`drawActionBadge`): a small square (unit: top-right above
  the info band; hero: above the HP bar, bottom-right) showing remaining
  actions — white ≥2, gold 1, red 0. Skips attached heroes and units without
  the field.
- **Facing rotation**: the whole token rotates `facing × π/3` about its
  center. The rotation scope is `ctx.save()` → translate/rotate → draw →
  `restore()`, guaranteed synchronous: every `await`/image load happens before
  `save()`, and drawing uses sync cache lookups with fallback rects (no
  `.then()` inside the scope). `customDraw` awaits each `drawToken()` before
  the next unit so scopes never leak.
- **Attached heroes** draw half-size at the host's front/back hex vertex
  (`mapGeometry.getAttachedHeroPos`), with a highlight box on the currently
  active hero.
- **Effect pips** render under tokens (buffs/debuffs present, `10`); corpse
  (HP ≤ 0, non-hero) = grayscaled; downed **hero** (HP ≤ 0) grayscales but
  stays interactable.
- **Fallen piles** (decorative, drawn under tokens): per-hex dots derived from
  the command log (`corpseTracker.buildFallen`). Each dot matches the dead unit —
  team colour, **mounted = triangle / foot = circle**, radius from
  `sizeCategory`×`visualScale`. Scatter is deterministic and stable as the pile
  grows (annulus 0.20–0.44 of `HEX_SIZE`, no cap).
- Routed is drawn from `currentFormation === 'Routed'` (white flag).

## Async image handling

`loadImage` (module-level cache) is exported for screenshot preloading;
`ScenarioMap` preloads every unique URL before the capture draw loop so the
first screenshot is complete. Bottom-info icons fall back to rectangles while
warming the cache.
