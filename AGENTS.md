## Work Summary (Anchored)

The last conversation added the combat system (attack/damage), removed brace, and migrated from hardcoded size caps + additive formation movement to data-driven DB columns. Here's the state:

### Completed

- `src/lib/unitCombat.ts`: pure combat resolution (AGR → reach → attack roll vs AC → damage capped at troopHp → retaliation by position; routed guard — no retaliation from routed units).
- `src/lib/unitCombat.test.ts`: 33 tests (row capacity with multiplier, position, AGR, reach, damage cap, formation mod, routed guard).
- `src/components/ScenarioMap/ScenarioMap.tsx`: `onAttack` wired with full combat sequence, `getFormationMultiplier` for row_capacity_multiplier, alliance friendly-fire check, morale cascade after combat, chained ROUT.
- Brace removed from AGR fail (code + docs); optional rule noted in HANDBOOK §7.3.
- `NOTEBOOK.md` with 6 worked combat examples.
- `.scratch/combat-system/spec.md` published.
- `HANDBOOK.md` §7.2 rewritten, §5 and §14.1/§14.2 updated.
- `gameProtocol.ts`: `SizeCategory` interface added, `Formation`: `movement_multiplier` + `row_capacity_multiplier` replace `movement_modifier`.
- `unitCaps.ts` deleted.
- `src/lib/unitStats.ts`: `computeEffectiveMovement` uses `max(1, floor(pts × mult))`, `getFormationMultiplier` helper added.
- `src/hooks/useSupabaseSync.ts`: fetches `size_categories`, replaces `getMaxTroopCount` with DB lookup; exports `SizeCategory[]` state.
- `src/components/UnitEditor.tsx`: fetches `size_categories`, replaces all `getMaxTroopCount` calls with `getMaxTroopForSize` lookup.
- `src/components/ScenarioMap/UnitTooltip.tsx`: uses `movement_multiplier` with multiplicative display.
- Migration `008_formation_size_category.sql` written.

### Active

- Running the migration against real DB (needs `supabase db push` or manual apply).
- `useSupabaseSync.ts` returns `sizeCategories` — callers could use it if needed (currently consumed inline via closure in `addUnitFromTemplate`).

### Blocked

- (none)

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles map to their default names (e.g. `ready-for-agent`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.
