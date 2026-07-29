Status: ready-for-agent

# Distinct Square Hero Tokens

## Problem Statement

Hero tokens currently share the same rectangular shape as unit tokens, making them visually indistinguishable from regular units at a glance. This creates confusion on the battlefield — players cannot quickly tell which tokens are heroes (single-entity leaders without direction/facing) versus units (formation-based squads with facing). Additionally, there is no mechanic for a hero to lead a unit by attaching to it, which is a core fantasy wargaming concept.

## Solution

Hero tokens will be rendered as distinct rounded-angle squares instead of the rectangular shape used by units. The square shape visually communicates that heroes do not have facing or direction. The token layout mirrors this by centering the hero icon and team shape within the square, rather than at one side (which would imply a front/back). A new attach/detach mechanic lets Small, Medium, and Large heroes lead a same-team unit: the hero token shrinks by 50% and positions at the front vertex of the parent unit's hex, with no name displayed. The tooltip shows attached hero stats first, then the parent unit's stats.

## User Stories

1. As a GM, I want hero tokens to look different from unit tokens, so that I can quickly identify which entities on the map are heroes.
2. As a player, I want the hero token's square shape to communicate that it has no facing/direction, so that I don't waste time trying to rotate it.
3. As a player, I want the hero square size to scale with the hero's size category (Small/Medium/Large/Huge/Gargantuan), so that physically larger heroes have proportionally larger tokens.
4. As a GM, I want the hero token to show the team shape inside the square, so that I can identify which team the hero belongs to.
5. As a player, I want the hero token to display the hero's portrait/image, so that I can identify which specific hero it is.
6. As a player, I want the hero token to display an HP bar at the bottom, so that I can see the hero's remaining health at a glance.
7. As a player, I want the hero's name displayed below the token (not inside it), so that the square's visual clarity is preserved.
8. As a GM, I want to attach a Small, Medium, or Large hero to a same-team unit via the context menu, so that the hero leads that unit.
9. As a GM, I want to attach a hero to a unit by dragging the hero onto the unit (with a confirmation dialog), so that attachment feels natural.
10. As a player, I want an attached hero's token to shrink by 50% and move to the front vertex of the parent unit's hex, so that it's visually clear whose unit the hero is leading.
11. As a player, I want an attached hero's name hidden from the token, so that the token stays compact and doesn't clutter the front of the unit.
12. As a player, I want to see only one hero attached per unit, so that the front doesn't become crowded.
13. As a player, I want heroes to only attach to same-team units, so that team identity is preserved.
14. As a GM, I want to detach a hero from a unit via the context menu, so that the hero can operate independently again.
15. As a player, I want a detached hero to reappear on a free hex adjacent to the parent unit, so that it remains nearby.
16. As a player, I want the tooltip on a unit with an attached hero to show the hero's stats first, then the unit's stats, so that I can quickly assess both.
17. As a GM, I want the screenshot capture to include attached heroes at their correct front positions, so that saved map images are accurate.
18. As a player, I want all attach/detach actions to be recorded in the command log with undo support, so that mistakes can be rolled back.

## Implementation Decisions

### Hero Square Sizing

The hero square side is a fraction of the standard unit token height (`TOKEN_HEIGHT` = 120px on the ScenarioMap at zoom 1):

| Size Category | Ratio of Token Height | Example (token height 120px) |
|---|---|---|
| Small (75) | 0.375 | 45px |
| Medium (100) | 0.5 | 60px |
| Large (200) | 4/6 ≈ 0.667 | 80px |
| Huge (300) | 5/6 ≈ 0.833 | 100px |
| Gargantuan (400) | 1.0 | 120px |

Unknown size categories default to 0.5 (Medium).

### Hero Square Token Layout

```
┌─────────────────────────┐
│     ▲─────■■■■■■■■      │  ← upper 3/4 of square
│    /_\     ■■■■■■■■      │     team shape (left 35% area, 35% opacity)
│   /___\    ■■■■■■■■      │     hero icon (right 35% area, square clip, opaque, drawn over team shape)
│                         │
├─────────────────────────┤  ← bottom 1/4
│ ████████████████████    │     white bar (full width) + red overlay by HP%
│ ████████████████████    │     black stroke border
└─────────────────────────┘
         Unit Name          ← below square (uses drawName with full token dimensions)
```

- **Background**: Rounded-angle square with team color fill (25% opacity) and stroke (2px)
- **Alliance border**: 4px stroke in alliance color, surrounds the square
- **Upper 3/4 display area**: Team shape centered at the left 35% of the square width, hero icon centered at the right 35% of the square width. The hero icon is drawn last (opaque) so it sits visually on top of the team shape where they overlap.
- **HP bar**: At the bottom 25% of the square. White background bar spanning 90% of the square width. Red fill proportional to HP% from the left side. Black stroke border. No text labels.
- **Name**: Rendered below the square using `drawName()` with full token dimensions — same font size and max width as unit names.

### Attached Hero Behavior

**Eligibility**: A hero can attach to a unit if:
- `unit.isHero === true`
- `unit.sizeCategory <= 200` (Small, Medium, or Large)
- Target is not a hero
- Target does not already have a hero attached
- Target is not deleted
- Target is on the same team

**Visual changes when attached**:
- Square size is halved (`displaySize = heroSize / 2`)
- Name is not rendered
- Position is at the parent unit's front vertex, 75% of `HEX_SIZE` (100px) from the hex center in the direction the unit faces

**Front vertex calculation**:
- Front vertex index: `(facing + 5) % 6`
- Vertex angle: `(60 * vertexIndex - 30)` degrees in canvas coordinates
- Position: `hexCenter + HEX_SIZE * 0.75 * (cos(angle), sin(angle))`

**Attach methods**:
1. **Context menu**: Right-click hero → "Attach to Unit..." → expandable submenu lists eligible targets (same team, non-hero, no existing hero)
2. **Drag-and-drop**: Drag hero onto target unit → `confirm()` dialog → on confirm, attach

**Detach method**:
- Right-click attached hero or right-click the parent unit → "Detach [Hero Name]" context menu option
- Hero is placed at the first free hex adjacent to the parent unit (iterates the 6 hex directions)

### Data Model

```typescript
// On the Unit interface
attachedToUnitId: string | null;
```

- `attached_to_unit_id TEXT NULL` column on the `units` database table
- B-tree index on the column for efficient lookups
- New unit instances created from templates always start with `null`

### Command System

Two new action types added to the game engine:

```typescript
type ActionType = ... | 'ATTACH_HERO' | 'DETACH_HERO';
```

- `ATTACH_HERO`: sets `attachedToUnitId` from `null` → target unit ID
- `DETACH_HERO`: sets `attachedToUnitId` from current value → `null` (optionally also updates hex)

Both are recorded in the command log with full undo/redo support.

### Rendering Options

```typescript
interface DrawTokenOptions {
  // ... existing fields ...
  isAttached?: boolean;  // when true, hero square is halved and name is hidden
}
```

### Tooltip

When a unit has an attached hero, the tooltip renders hero stats (HP, AC, Morale, Aggressiveness, Mount) in a yellow-highlighted section above the main unit stats, separated by a divider line.

## Testing Decisions

A good test for this feature validates external behavior — the visible rendering output and the attach/detach state transitions — without inspecting internal implementation details.

### Existing seam: `tokenUtils.test.ts`

Located at `src/components/TokenRenderer/tokenUtils.test.ts`, this suite tests the pure utility functions (formation configs, dot positions, color calculations). The hero square sizing function `getHeroSquareSize` and the `HERO_SQUARE_RATIOS` lookup belong at this seam since they are pure functions with no canvas dependency.

**Tests to add at this seam:**
- `getHeroSquareSize` returns correct sizes for all five size categories
- `getHeroSquareSize` defaults to 0.5 for unknown size categories
- `HERO_SQUARE_RATIOS` contains exactly the five expected keys

### New seam: `drawToken` rendering

The `drawToken` function is async and canvas-dependent, making traditional unit tests impractical for the visual output. The highest viable seam for behavioral validation is:

- **`DrawTokenOptions.isAttached` propagation**: A unit test in `tokenUtils.test.ts` could verify that the `drawToken` entry point correctly passes `isAttached` through to the drawing logic. However, since `drawToken` directly manipulates a canvas, the most practical approach is manual QA via the Unit Editor preview and ScenarioMap.

### State transition tests

The attach/detach state machine (eligible guards, team checks, size restrictions) lives in `ScenarioMap.tsx` callbacks. These are tightly coupled to React/state, so the highest seam is:

- **Integration test** verifying that `attachHero` and `detachHero` engine commands produce the correct `UnitChange` arrays. This can be done at the `useGameEngine` hook level.

### Prior art

The existing tests at `tokenUtils.test.ts` (26 tests) validate pure utility functions with straightforward input/output assertions. New hero square tests should follow the same pattern.

## Out of Scope

- Hero stat bonuses/maluses when attached to a unit (the hero is purely visual — no combat modifiers)
- Animations for attach/detach transitions
- Drag-and-drop panel for managing attachments outside the map
- Multiple heroes attached to a single unit
- Attaching heroes of size Huge or Gargantuan (they are too large to lead a unit)
- Hero attachment for units on different teams
- Keyboard shortcuts for attach/detach
- Custom HP bar text or numbers on the hero token

## Further Notes

- The `drawName` function currently accepts an `isHero` boolean parameter but does not use it in its body. The parameter is preserved for API compatibility but has no behavioral effect.
- The screenshot capture routine (`captureAndUploadScreenshot`) duplicates the attached-hero positioning logic found in `customDraw`. Both produce identical behavior — this was done to keep the screenshot path self-contained and avoid shared mutable state between the two rendering loops.
- The `ContextMenu.tsx` hides rotation and formation options for attached heroes (since they still have `attachedToUnitId` set and `!unit.isHero` evaluates to the attached-hero check).
