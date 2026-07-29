Status: ready-for-agent

# Alliance System Integration

## Problem Statement

The alliance system was initially wired up as a separate concern from the game engine. Three gaps remained after the initial implementation:

1. **No undo support**: Alliance changes (assigning teams to Friendly/Enemy/Neutral) bypassed the command log entirely. A GM could change a team's alliance, but Undo (Ctrl+Z) had no effect — the change was permanent unless manually reversed. This violated the principle that every GM action should be reversible.

2. **Clunky UI**: The alliance panel used click-to-cycle — clicking a team button cycled through Friendly → Enemy → Neutral — which required multiple clicks to reach the desired group and offered no visual feedback for the destination. GMs reported the interaction model was unintuitive.

3. **Hero units can face**: Heroes and Scattered formations should have no facing per the game rules (section 7.1 of the design doc), but the context menu showed Rotate Left/Right for every unit, and the Q/E keyboard shortcuts attempted to rotate heroes. This caused confusion when a hero's facing was changed with no visual effect (heroes don't render a directional indicator).

Additionally, three minor papercuts existed: the delete confirmation fired twice (once in the context menu, once in the parent component's callback); team button text was hardcoded to white regardless of the background luminance; and formation options appeared for hero units even though heroes have no formation mechanics.

## Solution

1. **Alliance changes flow through the game engine**: The `useTeamAlliances.setAlliance` function is passed as an `updateAlliance` callback to `useGameEngine`. Alliance changes are recorded as `ALLIANCE` action type entries in the command log with standard field-level deltas (`{ field: 'alliance_group', from, to }`). Undo and redo branch on `step.type === 'ALLIANCE'` to call `updateAlliance` instead of `updateUnit`, reversing or re-applying the group change on both local state and the `team_alliances` DB table.

2. **Drag-and-drop UI**: The alliance panel uses native HTML5 Drag and Drop. Each team is a draggable pill; each group box (Friendly, Enemy, Neutral) is a drop zone. Dragging a team from one group to another immediately changes its alliance. Visual feedback: the target group box brightens and shows a white ring while a team pill is hovering over it. The help text reads "Drag a team between groups".

3. **Hero facing removed**: The context menu conditionally renders the Rotate Left/Right options only when `unit.isHero` is false. The Q/E keyboard shortcuts in `ScenarioMap` skip hero units by checking `!contextMenuUnit.isHero` before calling `rotateUnit`.

4. **Hero formations removed**: The context menu also hides the Formations section for hero units. Heroes have no formation mechanics (they render as a single portrait with HP bar, not troop dots), so formation options are irrelevant.

5. **Minor fixes**: The duplicate confirm dialog was removed from the `onDeleteUnit` callback in `ScenarioMap` (the context menu already shows one). Team button text color uses the existing `getDotColor(team)` luminance-based utility instead of hardcoded `#fff`, so yellow, violet, and orange teams render readable black text.

## User Stories

1. As a GM, I want to undo an alliance change, so that I can correct a mistake without manually cycling teams back.
2. As a GM, I want to redo an undone alliance change, so that I can recover from an accidental undo.
3. As a GM, I want alliance undo/redo to work with Ctrl+Z/Ctrl+Y, matching the same keyboard shortcuts as unit actions.
4. As a GM, I want the alliance panel to show a visual "drag over" highlight when I drag a team to a group, so that I can see where the team will land.
5. As a GM, I want to drag a team pill between alliance groups, so that assigning a team's group is a single direct action instead of cycling through options.
6. As a developer, I want the game engine to handle `ALLIANCE` as a first-class action type, so that all actions use the same undo/redo infrastructure.
7. As a GM, I want hero tokens to not show Rotate Left/Right in the context menu, so that the menu only shows relevant options.
8. As a GM, I want pressing Q or E while a hero is selected to have no effect, so that I don't accidentally try to rotate a unit that can't face.
9. As a GM, I want only one confirmation prompt when deleting a unit, so that I don't have to dismiss two dialog boxes.
10. As a GM, I want team button text to be readable (black on light backgrounds, white on dark backgrounds), so that all team names are legible regardless of the team's color.
11. As a GM, I want hero tokens to not show formation options in the context menu, so that the menu only shows mechanics relevant to that unit type.

## Implementation Decisions

### GameEngine action type extension

`'ALLIANCE'` is added to the `ActionType` union in the standalone `GameEngine` class. No structural changes to the engine are required — it stores entries generically via `ActionType` and `SubStep` without special-casing individual types. The `redo()` and `peekRedo()` methods were already implemented.

### useGameEngine branching

The hook accepts a new optional `updateAlliance` prop of type `(team: string, group: AllianceGroup) => Promise<void>`. Three functions (`execute`, `undo`, `redo`) branch on each sub-step's type:

| Function | Non-`ALLIANCE` sub-step | `ALLIANCE` sub-step |
|----------|------------------------|---------------------|
| `execute` | calls `updateUnit(id, { field: to })` | calls `updateAlliance(team, to)` |
| `undo` | calls `updateUnit(id, { field: from })` | calls `updateAlliance(team, from)` |
| `redo` | calls `updateUnit(id, { field: to })` | calls `updateAlliance(team, to)` |

`updateAlliance` is wired to `useTeamAlliances.setAlliance`, which updates local React state and upserts the `team_alliances` row in Supabase. Because both the state update and DB persist happen inside `setAlliance`, undo/redo are idempotent — calling them multiple times produces the same result.

### ScenarioMap wiring

`useTeamAlliances` is called before `useGameEngine` so its `setAlliance` value is available for the `updateAlliance` prop. A `handleMoveTeam` callback wraps the `execute('ALLIANCE', ...)` call with the team name and target group, constructing a standard sub-step with the delta `{ field: 'alliance_group', from: currentGroup, to: targetGroup }`. No-op (dragging to the current group) is short-circuited before calling execute.

### AlliancePanel redesign

The component uses HTML5 native DnD via `draggable` attribute. No external drag library is added. Key interaction details:

- Each team pill: `draggable={true}`, `onDragStart` calls `e.dataTransfer.setData('text/plain', team)`
- Each group box: `onDragOver` calls `preventDefault()` to allow drop; `onDragEnter`/`onDragLeave` toggle local `dragOverGroup` state to control visual highlight; `onDrop` calls `onMoveTeam(team, targetGroup)`
- Visual highlight: `ring-2 ring-white` + brighter background tint on the target group
- Text color: uses `getDotColor(team)` from `tokenUtils.ts` (luminance-based, same function used for troop dot text throughout the app)
- The old `onCycleTeam` prop is replaced by `onMoveTeam(team, targetGroup: AllianceGroup)`

### Hero guard (rotate and formations)

The context menu wraps the two Rotate items and the entire Formations section in `{!unit.isHero && (<>...</>)}`. The keyboard handler in ScenarioMap adds `&& !contextMenuUnit.isHero` to both the Q and E key checks. This ensures heroes show only Weapons, Team assignment, Hide, and Delete — options that are actually meaningful for a hero unit.

### Duplicate confirm fix

The `onDeleteUnit` callback in ScenarioMap previously wrapped its `execute()` call in a second `confirm()` prompt. The outer confirm and its conditional block are removed, leaving only the confirm inside `ContextMenu.tsx`.

## Testing Decisions

**Seam**: The `GameEngine` class remains the highest-value testing seam for action execution and undo/redo stack management. However, the `ALLIANCE` action type does not introduce any new code paths in the engine — the engine already handles arbitrary action types generically. The behavior change lives entirely in the `useGameEngine` hook (the branching on `step.type === 'ALLIANCE'`), which requires a mocked Supabase client to test.

**No new tests are proposed**. The existing 45 tests in `weaponParser`, `templateMappers`, and `tokenUtils` are unaffected. The `GameEngine` test cases from the command-log spec (12 test cases covering execute, undo, permission, stack eviction) are not modified — the ALLIANCE type passes through the same generic paths.

**Manual verification paths**:
- Open a scenario as GM, open the Alliances panel, drag "blue" to Enemy → blue team token border changes to orange-red; undo restores it to blue; redo restores to orange-red
- Right-click a hero → no Rotate or Formations in context menu (only Weapons, Team, Hide, Delete); press Q while hero is selected → no rotation
- Right-click a non-hero unit → Rotate and Formations options appear; press Q/E → unit rotates
- Delete a non-hero unit → single confirm prompt fires

## Out of Scope

- Undo/redo visual feedback for the alliance panel itself (e.g., animating the team pill back to its previous group on undo)
- Alliance-based threat overlay highlighting enemy zone-of-control hexes
- Neutral team configurable behavior (currently always receives threat from all groups)
- Multi-player undo for alliance changes (GM-only action — player undo is irrelevant)
- Integration tests for the drag-and-drop interaction (would require Playwright or React Testing Library with DnD simulation)

## Further Notes

- The `useGameEngine` hook's dependency array for `execute`, `undo`, and `redo` includes `updateAlliance` directly, so the callbacks are re-created whenever the alliance function reference changes (which is stable because it comes from a `useCallback` with `[scenarioId]` as deps).
- The `handleMoveTeam` callback in `ScenarioMap` depends on both `alliances` (to read the current group) and `execute`; it is wrapped in `useCallback` with those deps for referential stability.
- The `getDotColor` function computes luminance from hex: `0.299*R + 0.587*G + 0.114*B`, thresholding at 0.6. This is the same luminance calculation used for troop dot text throughout the token renderer.
