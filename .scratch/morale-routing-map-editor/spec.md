Status: ready-for-agent

# Morale, Routing, Map Editor & Token Visual Polish

## Problem Statement

The game lacks a functional morale system — situational factors (wounds, isolation, enemy threats) are computed for display but never affect unit state. Units cannot break and rout when morale collapses. Heroes are not distinguished from regular units in the morale system. Formation changes have no restrictions, allowing a unit to jump from Scattered to Phalanx in a single action. The Map Editor for aligning background images was missing entirely. Token visuals (team colors, shapes, unit names, custom images, hearts) need polish for better contrast and readability.

## Solution

- **Map Editor**: A full-screen view with the hex grid canvas and a left control panel for selecting/aligning a background image (offset X/Y sliders, scale slider). Settings persist per-scenario via `map_data`.
- **Morale System**: Every unit has an effective morale calculated as `baseMorale + currentMoraleModifier + situationalModifier`. The situational modifier combines wounds, isolation, and enemy threats by facing. When effective morale ≤ 0, the unit routs (`isRouting = true`, `currentFormation = 'Routed'`). Routing is recorded as a command-log event linked to the action that caused it (movement, damage).
- **Heroes**: Heroes are immune to morale effects entirely — no MOR line or morale factors in their tooltip, never rout, always fight in Open Order.
- **Formation Restrictions**: A unit can change formation at most +1 organization level per action (e.g., Open Order → Close Order OK, Open Order → Phalanx blocked). Downward changes are unrestricted. Unavailable options are greyed out in the context menu.
- **Formations Table**: Add a `morale_modifier` integer column to the `formations` lookup table so each formation contributes to a unit's effective morale.
- **Token Visual Polish**: Team background at 75% opacity, team shape alpha varies per team (violet full, yellow/orange 0.7, others 0.35), violet/orange dot color black, unit names always white, hollow hearts use `[1,1]` dash pattern, UnitSelector prefers `customImageUrl` over `raceIconUrl`.

## User Stories

1. As a GM, I want to open a Map Editor from the Lobby for any scenario I own, so that I can align a background image with the hex grid before the game starts.
2. As a GM, I want to select a background image from a dropdown of pre-uploaded maps, so that I can set a terrain reference for the battlefield.
3. As a GM, I want offset X/Y and scale sliders to position the background image, so that it aligns with the hex grid.
4. As a GM, I want a Save button that persists the background settings to the scenario, so that all players see the aligned map when they join.
5. As a GM, I want the hex grid to render over the background image in the Map Editor, so that I can see the alignment in real time.
6. As a player, I want to see a background image on the scenario map when the GM has configured one, so that I have a visual reference for terrain.
7. As a player, I want to see the morale state of a unit reflected on its token (hollow hearts when morale is reduced), so that I can assess battlefield conditions at a glance.
8. As a player, I want the unit tooltip to show the correct morale total factoring in wounds, isolation, and enemy threats, so that I understand why morale is high or low.
9. As a player, I want enemy threats in the morale factors section displayed as negative values, so that it's clear they are deductions.
10. As the system, when a unit's effective morale reaches 0 or below, I want to set `isRouting = true` and `currentFormation = 'Routed'`, so that the unit breaks and routs.
11. As a player, I want a routed unit to display a surrender flag and its formation dots to appear scattered (Routed layout), so that I can visually identify routing units.
12. As a player, I want the routing event recorded in the command log linked to the action that caused it, so that the sequence of events is traceable and undoable.
13. As a player, I want heroes to have no morale display in their tooltip, so that the interface doesn't imply morale applies to them.
14. As a player, I want heroes to never rout, so that they remain reliable commanders on the battlefield.
15. As a player, I want heroes to always fight in Open Order regardless of formation changes or routing effects, so that they are mechanically distinct from troops.
16. As a player, I want the context menu to show only formations I can actually switch to, so that I'm not confused by unavailable options.
17. As a player, I want to be able to decrease my formation's organization level by any amount in one action (e.g., Close Order → Routed), so that I can voluntarily break formation if needed.
18. As a player, I want to increase my formation's organization level by at most 1 per action (e.g., Scattered → Open Order), so that formation discipline is progressive.
19. As a player, I want unavailable formation options greyed out in the context menu with a tooltip or cursor indicator, so that I understand why I can't select them.
20. As a developer, I want a `morale_modifier` column on the `formations` table, so that each formation contributes to a unit's effective morale calculation.
21. As a player, I want unit names on tokens to be white with a dark shadow, so that they are readable against any team background.
22. As a player, I want the team background on tokens to be visible but not overpower the map beneath (75% opacity), so that I can still see terrain through the token.
23. As a color-blind player, I want the team shape on tokens to be clearly visible for violet, yellow, and orange teams, so that I can distinguish them at a glance.
24. As a player, I want violet and orange team dots to be black, so that they contrast well with their backgrounds.
25. As a player, when I browse the Unit Selector, I want to see a unit's custom image if they have one, falling back to the race icon, so that custom visuals are surfaced.
26. As a player, I want hollow hearts on tokens to have a clean `[1,1]` dash pattern, so that the shape isn't deformed by oversized dashes.

## Implementation Decisions

### Map Editor

- **MapEditorView**: A full-viewport overlay (`fixed inset-0 z-50`) opened from the Lobby's "Map Editor" button. Contains the hex grid canvas and a left-side control panel.
- **Layout**: Matches ScenarioMap's pattern — canvas fills viewport, panel floats via `absolute top-0 left-0 z-10`. The "Back" button is prominent in the panel header so the user can always return to the Lobby.
- **Image source**: `GET /api/map-images` lists files from `/public/images/maps/` as `{ name, url }[]`. The dropdown calls this endpoint on mount.
- **Persistence**: `updateScenarioMapData(scenarioId, { backgroundImageUrl, bgOffsetX, bgOffsetY, bgScale })` stores settings in `scenario.map_data` (a JSONB column). Loading happens via `fetchScenarioMapData` on mount. Separate from the "Save Background" button (manual save, not auto-save).
- **Canvas sizing**: The `useHexGrid` draw function sizes to `canvas.getBoundingClientRect()` (not the parent element), so the canvas correctly fills the flex-allocated space alongside the panel.
- **Background image rendering**: In `useHexGrid`, the image is drawn in world-space coordinates: `(offsetX * zoom, offsetY * zoom)` for center position, `(naturalSize * scale * zoom)` for dimensions. Both position and size multiply by `zoom`, so the image stays locked to the grid at any magnification.
- **Scale range**: 0.1 to 10 (step 0.1), so small maps can be blown up for fine alignment.

### Morale System

- **Effective morale formula**:
  ```
  effectiveMorale = unit.baseMorale + unit.currentMoraleModifier + computeSituationalModifier(unit, allUnits, alliances)
  ```
  Where `computeSituationalModifier` returns:
  ```
  wounds + (isolated ? -1 : 0) - (enemyThreats.frontSide + enemyThreats.rear)
  ```
- **Wounds**: `-Math.floor(pctLost * 10)` where `pctLost = 1 - currentUnitHp / maxUnitHp`. At 10% HP loss = -1, at 50% = -5, at 100% = -10.
- **Isolation**: `true` if no same-alliance unit occupies any of the 6 adjacent hexes. Penalty: -1.
- **Enemy threats**: For each enemy unit in an adjacent hex, classify direction (front/side or rear) based on the unit's facing. Threat value from enemy's level: 1-4→1, 5-10→2, 11-15→3, 16-19→4, 20→5. Rear attacks add +1 to the threat value. Front/side and rear values are summed separately for display.
- **Factor display in tooltip**: Each factor shown in the "Morale factors" section with color coding (red for negative, green for zero). The MOR line shows `effectiveTotal = baseMorale + effectiveModifier`.
- **`currentMoraleModifier`** is preserved as the manual/GM-adjustment field (DB-persisted). The computed situational modifier is added on top at display/routing time only — it is never persisted.
- **The computed modifier is a pure function** derived entirely from unit state, units list, and alliances. It lives in a shared utility module consumed by both `UnitTooltip` and the render pipeline.

### Routing Trigger

- **When**: After any action that could change morale-relevant state (movement changes enemy adjacency, damage changes HP). Initially bound to the `MOVE` action via `handleUnitMove`.
- **Check**: If `effectiveMorale ≤ 0` and unit is not already routing and unit is not a hero.
- **Effect**: Generate additional sub-steps in the same command entry: `{ field: 'isRouting', from: false, to: true }` and `{ field: 'currentFormation', from: X, to: 'Routed' }`.
- **Command log**: The action description incorporates the routing event (e.g., "Griffin moved to (3,-2,0) and routed!"). The routing sub-step is recorded under the same command entry, making the entire action (move + routing) undoable as one unit.
- **No separate ROUT action type is needed** — routing is a side-effect of `MOVE` (and eventually `DAMAGE`).

### Heroes

- **Morale exclusion**: In `UnitTooltip`, the MOR line, Threat line, and Morale factors section are wrapped in the `showTroops` condition. Since heroes already use `showTroops = false`, these sections are naturally hidden for heroes.
- **Routing immunity**: The routing check explicitly skips `unit.isHero`. Heroes never have their morale evaluated for routing, regardless of their calculated effective morale.
- **Formation lock**: The context menu already blocks formation changes for heroes and attached units. As defense-in-depth, the `changeFormation` action in the game engine also skips heroes.

### Formation Restrictions

- **Organization levels** (existing map, remains unchanged):
  - Routed: 0, Scattered: 0, Open Order: 1, Close Order: 2, Phalanx: 3, Shield Wall: 3
- **Selection rules in context menu**:
  - If target org level < current org level: **always selectable** (going down, any amount)
  - If target org level = current org level: **current selection**, disabled (already selected)
  - If target org level = current org level + 1: **selectable** (going up by 1)
  - If target org level > current org level + 1: **disabled** (greyed out)
- **Priority ordering**: Formation options in the context menu are rendered in the same order as before, but each option's enabled/disabled state is computed from the rules above.
- **Disabled styling**: Greyed-out text (`text-gray-600 cursor-not-allowed`), no hover effect.

### Formations Table Schema

- **Column**: `morale_modifier integer NOT NULL DEFAULT 0`
- **Defaults by formation** (applied via migration `UPDATE`):
  - Routed: -2
  - Scattered: +1
  - Open Order: 0
  - Close Order: +1
  - Phalanx: +2
  - Shield Wall: +2
- **Join strategy**: Join on `formations.name = units.current_formation` (string equality). The `name` column is the natural key already used throughout the codebase. No FK migration needed.
- **TypeScript update**: Add `moraleModifier: number` to the `Formation` interface. Map snake_case DB column to camelCase in the `UnitEditor` load path where formations are fetched from Supabase.
- The `moraleModifier` is fed into the effective morale formula as part of `currentMoraleModifier` or as an additional term alongside the computed situational factors. This allows the formation itself to contribute positively (Scattered +1) or negatively (Routed -2) to morale.

### Token Visual Polish

- **Unit names**: Always `#FFFFFF` with `rgba(0,0,0,0.8)` shadow at 6px blur. Previously used `getDotColor(team)` which returned black on light backgrounds — white with shadow is universally readable.
- **Team background**: `teamColor + 'BF'` (75% opacity). Previously 25% (`'40'`), then 50% (`'80'`), finally settled at 75%. The higher opacity helps team identification without fully obscuring the map.
- **Team shape alpha**: A helper function `getTeamShapeAlpha(team)` returns:
  - 1.0 for violet (full opacity — user with color blindness needs this)
  - 0.7 for yellow and orange
  - 0.35 for blue, black, green
- **Team shape color**: `'#999999'` (gray) at the per-team alpha above. Gray was chosen over black/white because black/white at full opacity visually competes with troop dots.
- **Dot color**: Violet and orange explicitly return `'#000000'` (via an early return in `getDotColor` before the luminance check). All other teams follow the existing luminance rule. Yellow already returned black due to its high luminance.
- **Custom image in UnitSelector**: The race icon slot now prefers `template.customImageUrl` over `template.raceIconUrl`: `src={template.customImageUrl || template.raceIconUrl}`.
- **Hollow hearts**: Dash pattern changed from `[2, 3]` to `[1, 1]` so the short dashes track the bezier curve cleanly at small sizes without deforming the heart shape.

### Screen Sizing

- The `useHexGrid` draw function reads `canvas.getBoundingClientRect()` instead of `canvas.parentElement?.getBoundingClientRect()`. This ensures the canvas sizes to its own flex-allocated space (which correctly reflects the remaining area after panels) rather than the full parent container. This fix was prompted by the Map Editor where the canvas and panel share a flex row.

## Testing Decisions

A good test for this system tests external behavior of pure functions: given known input state, assert the correct output. Avoid testing canvas rendering, DOM layout, or async Supabase calls.

### Modules to test

1. **`unitMorale.ts`** (new, no existing tests)
   - `computeEffectiveMoraleModifier` — pure function
     - Full HP unit with no adjacent enemies → modifier is 0 (or -0, shallow test)
     - Unit at 50% HP → wounds = -5
     - Unit with 3 enemies in front (level 1 each) → enemies = -3
     - Unit with 1 enemy in rear (level 2, +1 rear bonus) → rear = -3
     - Unit at 30% HP, isolated, 2 enemies in front (level 1) → modifier = -7 + (-1) + (-2) = -10
     - Attached hero or attached-to-unit: treats as normal unit (no special handling at this level)
   - `getRoutingSubStep` — pure function returning SubStep or null
     - Unit with effective morale > 0 → returns null
     - Unit with effective morale ≤ 0, not hero, not already routing → returns SubStep with isRouting=true, formation='Routed'
     - Hero unit with effective morale ≤ 0 → returns null (heroes never rout)
     - Unit where isRouting already true → returns null
     - Unit with effective morale exactly 0 → returns SubStep (boundary test)

2. **Formation restriction helper** (to be extracted from `ContextMenu.tsx`)
   - Pure function `canSelectFormation(current: string, target: string): boolean`
     - Open Order → Scattered: true (going down)
     - Open Order → Close Order: true (+1)
     - Open Order → Phalanx: false (+2)
     - Open Order → Shield Wall: false (+2)
     - Close Order → Routed: true (going down)
     - Routed → Scattered: true (same level, 0→0)
     - Routed → Open Order: true (+1 from level 0 to 1)
     - Routed → Close Order: false (+2 from level 0 to 2)

3. **`Formation` mapper** in `UnitEditor.tsx`
   - DB row with `{ morale_modifier: 2 }` → mapped to `{ moraleModifier: 2 }`

### Prior art

- `tokenUtils.test.ts`: Tests pure functions `getFormationConfig` and `generateDotPositions` with various formation, size, and mount combinations. 26 tests covering config selection, size clamping, and dot layout.
- `templateMappers.test.ts`: Tests pure DB-to-TypeScript mapping functions.

### Not tested (manual QA)

- Canvas rendering (background image alignment, team shapes, heart positions)
- Routing trigger integration in `handleUnitMove` (involves async `execute` with DB writes)
- Map Editor panel layout and slider interactions
- Context menu rendering and disabled styling
- Tooltip positioning and visibility

## Out of Scope

- Combat resolution system (ATTACK/DAMAGE actions). The routing trigger hooks into `MOVE` only; when `DAMAGE` is added later, the same routing check should be invoked there.
- Auto-save in the Map Editor (manual "Save Background" button is the intended interaction model).
- Multi-image backgrounds (layering, opacity per layer). The editor supports one image at a time.
- Drag-and-drop alignment in the Map Editor (offset sliders are the alignment mechanism; mouse interaction is pan/zoom only).
- Unit-level formation restriction enforcement on the server side (all checks are client-side in the context menu).
- Formation morale_modifier integration into the game engine's action cost system (to be wired in a future pass after the column exists).

## Further Notes

- The `computeEffectiveMoraleModifier` function in `unitMorale.ts` is already implemented and in use by both `UnitTooltip` and the `customDraw` pipeline (for heart rendering). The remaining pieces are the routing trigger, hero tooltip cleanup, formation context menu restrictions, and the formations morale_modifier column.
- The `PanelsContainer`/`PanelSection` framework in `LeftPanel` was built as part of this work but is a general-purpose panel system — documented here for completeness but does not need separate tickets.
- The map background scale range was extended to 10× based on user feedback (initially capped at 3×).
