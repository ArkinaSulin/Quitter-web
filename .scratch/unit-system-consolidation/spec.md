# Unit System Consolidation

Status: `ready-for-agent`

## Problem Statement

The unit system had accumulated inconsistencies between TypeScript interfaces, the Supabase schema, and rendering logic. Field names mismatched between code and database (`troopCount` vs `currentTroopCount`, `currentMorale` vs `currentMoraleModifier`), causing insert failures at runtime. The drag-and-drop from the unit selector panel to the scenario map used a broken hybrid of native HTML5 `draggable` and custom mouse events that often failed. Lookup table types used camelCase that didn't match the snake_case Supabase columns, producing TypeScript errors. The mounted Scattered formation's circle layout was cramped with 3 uneven rings and a tiny inner radius. The Small size category (needed for future Small creatures like kobold riders) was missing. There were no tests to prevent regressions.

## Solution

1. **Drag refactored to pure mouse events** — replaced `draggable`/`onDragStart` with `onMouseDown`/`mousemove`/`mouseup` on `window`, matching the existing token move pattern.
2. **Field name alignment** — `troopCount` → `currentTroopCount`, `currentMorale` → `currentMoraleModifier`, `armorId` removed from `Unit` interface and all mappers. DB columns renamed via `ALTER TABLE`.
3. **Type cleanup** — Lookup table types (`Armor`, `Race`, `UnitType`, `Mount`) switched to snake_case. `Weapon.reach` → `Weapon.is_reach`; `Weapon.notes` removed.
4. **Morale hearts** — Boosted morale (effective > base) shown as gold hearts. `drawHeart` accepts optional `fillColor`. `drawBottomInfo` changed to `(baseMorale?, moraleModifier?)`.
5. **Mounted Scattered circle layout** — 2 or 3 proportional rings depending on troop count (≤20: outer 12/inner 8; >20: outer 21/mid 13/inner 6, cap 40). Radii proportional to ring count for equal arc spacing.
6. **Small (75) size category** — Added to `SIZE_VALUES`, `SIZE_LABELS`, slider, datalist, and token rendering.
7. **Troop count soft caps** — Applied in `addUnitFromTemplate` and UnitEditor inputs. Caps determined by size category and mounted status.
8. **Shared cap function** — `getMaxTroopCount` extracted to a shared module used by both the hook and the UI.
9. **Testing** — Vitest installed, 45 tests across 3 pure-function modules.
10. **Dashed hollow rendering** — Dead infantry dots, dead mounted triangles, and hollow/reduced morale hearts use `lineWidth: 1` with `setLineDash([2, 3])` instead of solid strokes, making them visually distinct from filled elements at a distance.

## User Stories

1. As a GM, I want to drag units from the selector panel onto the map, so that I can place units without the drag breaking or requiring a workaround.
2. As a GM, I want the unit instance's field names to match the database, so that inserts succeed without column-not-found errors.
3. As a developer, I want lookup table types to use snake_case, so that TypeScript doesn't complain about mismatched property names when reading from Supabase.
4. As a GM, I want a unit's effective morale to be visually distinguishable when boosted above base (gold hearts), so I can see at a glance that a unit has high morale support.
5. As a GM, I want troop count 0 to show zero dots on the token, so that a depleted unit looks empty rather than showing dots from a falsey default.
6. As a GM, I want mounted Scattered units to appear in 2-3 well-spaced concentric circles, so the token looks balanced and readable.
7. As a developer, I want a Small (75) size category, so that Small creatures (kobolds, goblins) can be properly represented with the same frontage as Medium.
8. As a GM, I want troop count capped by size and mounted status, so that a Huge unit can't have more troops than its token can legibly display.
9. As a developer, I want unit tests for pure functions (weapon parser, template mappers, token utils), so that regressions are caught before reaching the browser.
10. As a GM, I want the UnitEditor's troop count input to respect the size/mounted cap, so I'm guided to valid values without guesswork.
11. As a GM, I want Shield Wall shields drawn with wider/flatter ellipses, so they visually match the formation's look.
12. As a developer, I want `useTokenRenderer.ts` renamed to `.tsx`, so that JSX in the file doesn't cause a TypeScript syntax error.
13. As a GM, I want the troop count to auto-adjust to the maximum allowed when changing size or mount, so I don't have to manually recalculate valid troop ranges.
14. As a GM, I want the mounted Scattered circle rings to fill from the outside first, so that casualties and missing troops leave the inner rings empty while the outer formation stays intact.
15. As a GM, I want dead and reduced-morale tokens to use dashed lines instead of solid strokes, so that I can distinguish depleted units from full-strength ones at a glance.

## Implementation Decisions

- **Drag mechanism**: Pure `mousedown`/`mousemove`/`mouseup` on `window` for panel-to-canvas drag. The hex grid's existing token move uses the same pattern, so both paths share the same coordinate-fix logic.
- **Morale as modifier**: `currentMoraleModifier` is additive to `baseMorale`. Effective morale = `baseMorale + modifier`. Initialised to `0`. The UnitEditor morale test slider uses range `[-baseMorale, 10-baseMorale]`.
- **Hearts**: `drawHeart(ctx, x, y, size, fillColor?)`. Gold when effective > base. No `filled: boolean` param.
- **Circle layout**: Proportional radii for equal arc distance on every ring. Fill from outer ring first (indices 0-N fill outer before inner). For ≤20 troops: outer 12 at radius R, inner 8 at radius R × 8/12. For >20 troops: outer 21 at R, mid 13 at R × 13/21, inner 6 at R × 6/21. Cap 40 total. Only used for mounted Scattered formation.
- **Size values**: 75 (Small), 100 (Medium), 200 (Large), 300 (Huge), 400 (Gargantuan). No DB changes needed — `size_category` is already INTEGER.
- **Soft caps**: `getMaxTroopCount(sizeCategory, isMounted)` returns the maximum troop count. Infantry: 75/100→80, 200→20, 300→6, 400→1. Mounted: 75/100→40, 200→20, 300→6, 400→1. Applied at map-insert time and in the UnitEditor. Existing units and templates are not retroactively changed.
- **`armor_id` not copied** from template to `Unit` — armor's AC bonus is baked into `baselineAc` at template save time. The `units` table has no `armor_id` column.
- **Dot radius**: `Math.min(width, height) * 0.025 * (visualScale / 100) * (sizeCategory / 100)` — tuned by the user for visual clarity.
- **`Weapon.notes` removed** — column deleted from Supabase, all code references removed. Weapon CSV format now has 7 fields (name, attackBonus, targetType, damageDice, range, magicRadius, is_reach).
- **Shared function module**: `getMaxTroopCount` lives in `src/lib/unitCaps.ts` and is imported by both `useSupabaseSync.ts` (map placement) and `UnitEditor.tsx` (UI clamping and auto-set).
- **UnitEditor auto-set**: When size or mount changes, troop count auto-adjusts to the cap via `useEffect`. Initial blank form also starts at the cap for the race's size.
- **Dashed hollow rendering**: Dead infantry dots, dead mounted triangles, and reduced-morale hearts all use `ctx.setLineDash([2, 3])` with `lineWidth: 1` and reset to `[]` after stroking. This replaces `lineWidth: 1.5` with solid strokes, making hollow/depleted elements visually distinct without changing the overall shape geometry.

## Testing Decisions

- **Good test**: Pure function, known input → known output. No mocks, no DOM, no side effects. Roundtrip tests (stringify ∘ parse = identity) to catch field drift.
- **Framework**: Vitest (installed, script `npm test`).
- **Tested modules** (45 tests across 3 files):
  - `weaponParser` (12 tests) — CSV parse, multi-weapon, empty input, `is_reach` flag, `targetType`, missing field defaults, stringify, format display, roundtrip
  - `templateMappers` (7 tests) — snake_case/camelCase conversion, field defaults, joined relations, save-row format, HP calculation (`troopHp × troopCount`), weekly cost calculation (`4 × level²`), roundtrip
  - `tokenUtils` (26 tests) — formation configs per size/mounted, dot colors per team, seeded random determinism, dot position counts and dead/alive flags, circle ring distributions (2-ring ≤20 mode, 3-ring >20 mode, 40 cap, partial fills), empty unit, Tight formation bounds
- **Prior art**: No existing tests — these are the first tests in the repo.
- **Not tested**: Canvas rendering (`drawToken.ts`), React components, drag-and-drop integration — would require browser automation.

## Out of Scope

- Integration tests for drag-and-drop (would require Playwright)
- Canvas rendering tests (visual regression or canvas mocking)
- React component tests (UnitEditor, ScenarioMap, etc.)
- Web Worker integration tests
- Per-race differentiation of troop caps (Small/Medium grouped together)
- Troop count cap enforcement in the save handler (only at map-insert and UI)

## Further Notes

- The `dotRadius` multiplier was tuned from `0.02` to `0.025` by the user for better visual appearance across all size categories.
- Soft caps are a gameplay guidance, not a hard limit — if a future need arises for more troops, the cap values can be adjusted in one place (`src/lib/unitCaps.ts`).
- The `setup-matt-pocock-skills` setup was run as part of this session — `docs/agents/` and `AGENTS.md` were created if not present.
