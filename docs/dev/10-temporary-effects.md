# 10 — Temporary Effects (buffs / debuffs / DoT)

Effects are **data on the unit row** (`units.effects jsonb`, migration 073) —
not separate tables — and ground zones live in
`scenarios.map_data.groundEffects`. Pure logic: `src/lib/unitEffects.ts`.
Effect changes ride the command log as `EFFECT` sub-steps, so apply/remove/
expiry are all undoable and realtime-consistent.

## Types & materialization

`EffectKind = 'ac' | 'morale' | 'movement' | 'dot'`.

- Stat kinds materialize **on the real unit fields** (so combat/morale/
  movement consumers need no edits):
  - `ac` → `currentAc`, `morale` → `currentMoraleModifier`,
    `movement` → `movementPoints` (base max).
  - Applying snapshots the pre-effect value as `effect.base`; removal restores
    it. A weapon switch that rebuilds AC rebases the AC buff.
- `dot` damages HP (`dotDamageChanges`: HP minus delta, troops = ceil(hp/troopHp),
  clamped to `[0, maxTroopCount]`, HP ≥ 0). A negative dot delta = **Regen**
  (healing).

**No same-kind stacking per carrier** — a second effect of an existing kind is
ignored.

## Duration & the clock

- Duration counts **activations of the caster**, not the carrier: an effect
  ticks when play transitions INTO the caster's alliance (END_TURN sweep), and
  expires at 0 — "N turns" really means "for N of the caster's own turns".
- If the **caster unit is destroyed the effect expires immediately**.
- Effects with no caster unit (GM-placed zones) tick on their recorded
  `casterTeam`. GM/tempo-null effects tick every activation.

## Ground zones

A `GroundEffect` sits on one hex. Standing units get a **zone-membership
effect** materialized at their own activation start (enter/leave auto; no
same-kind stacking conflicts). `dot` zones tick every standing unit when the
zone's caster team activates; `stat` zones only expire on their own clock.
Expired zones are removed and memberships restored.

## The END_TURN sweep

`computeEndTurnEffects(ctx)` is folded into the END_TURN command
(`EFFECT` sub-steps) whenever play transitions into `nextGroup`:

1. Unit effects whose caster died → expire (restore stat).
2. Effects whose caster team is `nextGroup` → **tick**: DoT damage lands,
   `turnsLeft--`, expire at 0.
3. Ground zones with caster in the incoming group → tick DoT on all standing
   units, decrement; expired zones removed + memberships restored everywhere.
4. Units of the incoming group reconcile their zone memberships (enter/leave
   the zones underfoot).

One sub-step per affected unit, `effects` collapsed to a single from-original
→ to-final change so undo never restores an intermediate draft.

## Catalog (apply UI offers; magnitude/duration overridable)

| Template | Kind | Default | Description |
|---|---|---|---|
| Bless | ac | +2 ×3 | +2 AC |
| Bane | ac | −2 ×3 | −2 AC |
| Haste | movement | +2 ×3 | +2 movement hexes |
| Slow | movement | −2 ×3 | −2 movement hexes |
| Rally | morale | +3 ×3 | +3 morale |
| Fear | morale | −3 ×3 | −3 morale |
| Burning | dot | 4 ×3 | 4 damage each tick |
| Regen | dot | −4 ×3 | heal 4 each tick |

## UI surfaces

- Context menu → **Effects…** modal (`AddEffectModal`): pick a catalog
  template, amount + duration + tempo (whose team's turn counts), Apply to Unit
  or (GM) Place Zone; lists the unit's active effects **and** the ground zones
  on its hex, each with **Edit / Clone / ✕**.
- **Effect Editor** (`/effect-editor`, `EffectEditor.tsx`) authors reusable
  templates: identity (name/colour/**image**/**layer**), scope, default
  duration, and one or more modifiers. The colour field is a swatch + hex box +
  preset palette (`ColorField`); the image is picked/uploaded from the
  `effect_images` storage bucket (`ImagePickerModal`, generalized by bucket);
  `layer` is **below unit** (default) or **above unit**. Each modifier has a
  single **amount** field accepting a plain number (flat) or dice `XdY±Z`
  (`X=0` = flat `Z`); the flat part is mirrored into `delta` for stat kinds and
  legacy consumers. The modifier row is the shared `EffectModifierFields`.
- **Drop form** (`EffectFormModal`): dragging a library effect onto the map (unit
  or hex) opens an editable form showing name/colour/image/layer, duration,
  tempo, and every modifier *before* applying. There is **no radius** — a zone
  drops on a single hex. There is no description field here (descriptions are
  authored only in the Effect Editor).
- **Placed-effect edit**: right-clicking a hex with zones offers
  **Move up / Move down / Edit / Clone / Drop**. *Edit* reopens
  `EffectFormModal` for that zone (or a unit's own effect, via its context
  menu). *Clone* arms a one-shot copy — the next left-click places it (Esc /
  right-click cancels).
- Effect artwork renders on the map at `layer` (below / above the unit token);
  "above" artwork hides while the unit on its hex is hovered so the token stays
  inspectable. UnitTooltip shows effect chips (colour + remaining turns); tokens
  draw effect pips below the token.
- GM palette tab paints ground zones onto hexes (with the stat/tempo picker).
