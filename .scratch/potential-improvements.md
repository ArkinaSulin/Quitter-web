# Potential Improvements

## Magic / Spells
- **Effect list**: a system for tracking active effects on units (buffs/debuffs with durations, stack behavior, and cleanup on turn end / expiry).
- **Saving throws in unitTemplate**: add a saving-throw bonus list to unit templates so spells (weapons with `magicRadius > 0`) resolve saves against the target's own modifiers instead of a global constant.

## Weapon System
- **Auto-suggest weapon** when default weapon range doesn't match target distance: after warning, offer to switch to a suitable weapon automatically
- **Weapon selection persistence**: remember which weapon the player selected last for each unit during the session
- **Multiple attacks**: units with `numberOfAttacks > 1` should be able to make multiple attacks per action

## Alliance Groups
- ~~**Undo for alliance changes**: alliance changes are currently logged to command_log but not undoable.~~ **Done** — Alliances now flow through the game engine's undo/redo stack as `ALLIANCE` action type.
- **Alliance-based threat overlay**: highlight enemy-zone-of-control hexes based on alliance groups
- **Neutral team behavior**: currently neutral doesn't generate threat but receives it. Could add configurable neutral behavior per scenario.

## Formation System
- **Animation**: smooth transition between formation layouts when formation changes
- **Formation preview in context menu**: show a small icon or tooltip of what each formation looks like

## Turn System
- **Turn-based action tracking**: use `actionsAvailable` and `movementPointsAvailable` to enforce action economy per turn
- **End Turn auto-reset**: reset all units' movementPointsAvailable and actionsAvailable when turn advances

## UI/UX
- **Visual feedback for warnings**: flash the token border red when a weapon range warning is shown
- **Better message styling**: color-code messages (green for actions, red for warnings, yellow for system)
- **Undo/Redo buttons**: add visible Redo button next to Undo in top bar (currently only keyboard Ctrl+Y)
- **Selected unit indicator**: highlight which unit is currently selected (for Q/E rotate keyboard shortcuts)

## Performance
- ~~**Image preloading**: preload all race/unit icons on scenario load to avoid async draw latencies~~ **Done** — images are loaded on first miss and cached; screenshots preload all images before drawing. Remaining gap: no proactive preload on scenario entry (only on screenshot capture).

## Combat
- **Actual combat resolution**: damage calculation, saving throws, morale checks
- **Attack of opportunity**: when a unit leaves an enemy's adjacency
