# Quitter Game Logic Map

Anchor document for the code review. Verified against source 2026-08-28.

## 1. Scenario-level state machine

| Field | Values | Written by | Read by |
|---|---|---|---|
| `current_turn_alliance` | `null` (free play) \| `friendly` \| `enemy` \| `neutral` | `END_TURN` command | permission gate, End Turn button |
| `turn_number` | 0 → n | `END_TURN` (only on free-play exit or full cycle wrap) | header, tooltips |
| `free_move` | bool | GM toggle + `END_TURN` (auto-off on first turn) | move handler, overlay |
| `archer_reaction_enabled` | bool | GM settings modal | reaction offering |
| `mounted_charge_enabled` | bool | GM settings modal | ContextMenu Charge button |
| `dm_heartbeat_at` | timestamp | GM every 5 s (RPC) | all clients poll → `dmGone` → `controlsLocked` |

**Turn order**: `friendly → enemy → neutral` (only groups with ≥1 team assigned). `advanceTurn` wraps; wrap or free-play-exit → `turn_number + 1`.

**End Turn gates** (button): `isGM` **or** (`myTeam` set ∧ current turn ≠ null ∧ `alliances[myTeam] === currentTurnAlliance`). Server re-validates; client advances turn state **only on `ok`**.

**End Turn effect** (one command, sub-steps):

```
SCENARIO step   → current_turn_alliance = next, turn_number, free_move=false (on exit)
CHARGE_END × n  → units in the ENDING group still isCharging: clear charge, drop 1 org (forfeit)
END_TURN × n    → units in the NEXT group:
                    hero  → movementPointsAvailable = full effective max, actions = 5, attacksUsed = 0
                    unit  → MP = 0 (turn_start_mp), actions = 2, attacksUsed = 0
                    both  → archerReactionUsed = false
```

## 2. Unit resource economy

| | Unit | Hero |
|---|---|---|
| Turn start | 0 MP + 2 actions | full MP + 5 actions |
| Move | spends leftover MP first; when MP exhausted, 1 action → full `maxMP` pool; final pool remainder stays | same, but each action converts `maxMP/5` MP (fraction carried, display floors) |
| Rotate | −1 MP / 60° (`applyMpSpend`); **free for Scattered, Routed, free-move** | free |
| Formation | `applyFormationChange`: **flat 50% of current pool** (`max(1, ceil(oldMax × 0.5))`, setting `formation_change_cost_per_step`), leftover rescales proportionally to `newMax` (floored, clamped); never > 1 action; free for hero / free-move | free |
| Attach/Detach/Swap | — | −1 MP (`applyHeroMpSpend`), converts actions if needed |
| Attack | −1 action + `attacksUsed + 1` (cap `unit_attack_cap`, default 5) | −1 action + `attacksUsed + 1` (same cap) |
| Free-action / charge attack | action-free but still `attacksUsed + 1` | action-free but still `attacksUsed + 1` |
| Over-budget | soft: confirm modal, deduct fully (can go negative), red message | same |

## 3. Command pipeline (single writer)

```
UI handler ──► execute('ACTION', subSteps, desc, {chained}) ──► RPC execute_command
      ▲                                                           │ (server validates,
      │                                                           │  writes units + log atomically)
      │                                                           ▼
      └── optimistic applyDeltas('to') ◄────────────── rows[0] (command row + seq)
      └── refreshUnitsByIds(touched)   ← authoritative DB truth on EVERY client
      └── addMessage/addError + refreshUndoState
Realtime: command-log INSERT/UPDATE → ScenarioMap listener (reaction offers + refetch)
Undo: refreshUndoState → RPC undo_commands(ids) → applyDeltas('from', reversed) → refetch
```

Chain rule: one logical action = one command row; undo reverts the whole chain.

## 4. Interaction flows

### 4.1 MOVE (`handleUnitMove`)

```
grab gate: canGrabUnit → reactionMode ? (id === archer.id) : canControlUnit(u)
  1. isCharging
       ├─ target ∉ charge wedge            → msg, return
       ├─ over budget (unit or hero)       → pendingMove (soft)
       └─ OK → performMove + CHARGE(distance += cost) + finishHeroMove
  2. freeMove
       ├─ hex occupied                      → msg, return
       └─ OK → moveUnitFree + autoRanged + offerReactions + prune
  3. normal
       pool = min(unitPool, heroPool)        (heroes: MP + actions×maxMP/5)
       reachable = computeReachableMap(unit, pool, occupied, threatHexes)
       ├─ target ∉ reachable                → pendingMove (cost = straight-line, ≥1)  [soft]
       ├─ entry.needsTurn                   → msg "must turn first"
       ├─ over budget (unit or hero)        → pendingMove
       └─ OK → performMove + finishHeroMove
performMove: red msg if overBudget → moveUnitRecorded (MOVE + optional hero MOVE) → maybeAutoReturnToRanged → offerReactionsFor → prune
finishHeroMove: moved unit was attached? → chained DETACH_HERO (no MP — move already paid)
```

Threat hexes (move-blocking): hostile units' front arcs per `canStopEnemyMovement`; heroes/Routed/Scattered/detached never block. **Movement never routs.**

### 4.2 ATTACK (`handleAttackRequest` → `performAttack`)

```
  1. attacker & target exist, both HP > 0
  2. canControlUnit(attacker)
  3. hero can attach? (hero ∧ size≤cap ∧ target not hero/attached/deleted/hidden ∧ target hero-free ∧ same team) → attach modal
  4. same friendly alliance                    → msg, return
  5. weapon exists; dist > maxRange            → hard block + red flash (at maxRange = allowed, long-range disadvantage)
  6. isHealing ∧ non-magic                     → performHeal (no combat/AGR/morale)
  7. magicDimension > 0                        → magic cast window (Routed can't cast)
  8. melee: canMeleeTarget (formation arcs) ∧ non-hero: isInFrontArc
  9. ranged: canRangedTarget
 10. isCharging:
       ├─ distance < full (2)                  → pendingChargeAttack (confirm = normal attack + end charge)
       ├─ at 5-cap                             → pendingAttackCap
       └─ performAttack(isCharging) → result?
             ├─ undefined (retaliation prompt open) → stop, don't end charge
             ├─ charge-over eligible           → pendingChargeThrough (ride over, 2 MP, chained MOVE)
             └─ else performChargeEnd(dropOrg=true)
 11. not charging: at 5-cap                    → pendingAttackCap
 12. actions < 1 ∧ !freeAction                 → pendingAttack
 13. performAttack
```

`performAttack` internals:

```
  overBudget → red msg (cap msg vs no-actions msg)
  adjacency auto-draw: melee switch (WEAPON_SELECT sub-step) or FISTS; AC recalculated (2H drops shield)
  effective position: getEffectivePosition (hero = all front, Scattered = side, Routed = rear)
  attached front-arc heroes → damage-sharing pools (back = protected, untouched)
  resolveCombatSequence(attacker, defender, weapons, mods, rng, isCharging, formations)
  sub-steps: [WEAPON_SELECT? ×2] [ATTACK: action −1, attacksUsed +1 (or cap-count only if free/charge)]
  AGR fail           → execute(desc "failed, no attack"), return (action already spent)
  reach symmetric    → both sides strike regardless of kill/rout
  else first-strike kill/rout of retaliator → suppressed retaliation
  retaliator at cap  → pendingRetaliationCap (dice STASHED; resume = suppressRetaliation allow/deny)
  DAMAGE sub-steps both ways → morale checks (shouldRout) → chained ROUT
  maybeAutoReturnToRanged ×2
  returns {attackerRouted, attackerKilled, defenderRouted, defenderKilled} (charge-over uses it)
```

**Range rings** (ScenarioMap:1704): `dist ≤ range` full effect · `range < dist ≤ maxRange` long-range disadvantage · `dist > maxRange` hard block + red flash.

### 4.3 CHARGE (full lifecycle)

```
ContextMenu "Charge!" (gated mounted_charge_enabled) → isCharging=true, distance=0
  moves: only through front-arc wedge; distance += cost each move
  attack < 2 hexes  → confirm (loses free attack)
  attack ≥ 2 hexes  → free double-damage attack
  after: charge-over offer → or CHARGE_END (clear + drop 1 org)
  still charging at own End Turn → forfeit (clear + drop 1 org)
```

### 4.4 REACTION (opportunity fire)

```
MOVE command commits (any client) → command-log listener derives offers from the log hex
  owner sees bow (canReactToUnit: isGM ∨ same team — NO turn gate)
  click bow → reactionMode (locked: only archer can act)
  drag hostile in range    → reaction shot (resolveCombatSequence; −1 action; counts to cap; can rout)
  drag reachable hex (50% budget, no turn-required) → reposition (applyMoveCost; −1 action)
  right-click              → formation picker (availability, +1 org max, no 2H Shield Wall)
  all set archerReactionUsed = true (once/turn)
  Esc ends mode; END_TURN clears markers; GM reset of archerReactionUsed revives bow
  prune: marker dropped when mover out of range / archer invalid (uses authoritative positions)
  hidden units: cannot be movers (already), cannot be reaction targets (guard added 2026-08-28)
```

### 4.5 HERO attach / swap / detach

```
attach: same team ∧ adjacent ∧ target has no hero ∧ hero size ≤ cap ∧ target not hero/attached/deleted/hidden
  cost 1 hero MP → MP < 1:
    actions enough to convert (⌈needed/maxMP/5⌉) → pendingHeroAttachConversion
    else                                             → pendingAttachOverBudget
  OK → attachHero (ATTACH_HERO: attach fields + hex = target hex + MP spend)
swap: front↔back, 1 MP (free during freeMove), same conversion ladder
detach: ONLY via drag-away (move already paid MP — DETACH_HERO carries no cost)
```

### 4.6 FORMATION / ROTATE / MAGIC / MORALE

```
FORMATION: 2H weapon → no Shield Wall; hero ∨ freeMove → free;
           50% of current pool + proportional rescale, affordable check else pendingFormation;
           Routed rally: effective morale must be > 0, clears isRouting
ROTATE:    hero ∨ Scattered ∨ Routed ∨ freeMove → free; else 1 MP/60°;
           180° about-turn: mounted Close Order blocked; setting cost + org penalty
MAGIC:     circle placement → per-troop save → damage/heal; action unless freeAction;
           morale check on target → rout; over-budget → pendingCastOverBudget
MORALE:    modifier = base + currentMoraleModifier + effective modifier (kill zones/threats);
           only attacks/spells can rout (movement never); Routed: move any direction,
           cannot attack/cast, can rally via formation change
```

## 5. Soft-enforcement inventory — the 12 modals

| Pending state | Trigger | Confirm action |
|---|---|---|
| `pendingMove` | move ∉ reachable OR unit/hero over budget | performMove(overBudget=true) → red msg |
| `pendingAttack` | 0 actions, attack attempted | performAttack(true) |
| `pendingAttackCap` | attacker at cap (units AND heroes; charge variant) | attack, counts over cap |
| `pendingRetaliationCap` | retaliator at cap (units AND heroes) | stash dice → resume allow/deny |
| `pendingFormation` | formation change over budget | changeFormation anyway |
| `pendingCastOverBudget` | caster 0 actions | handleResolveCast(true) |
| `pendingChargeAttack` | charge attack < 2 hexes | normal attack + end charge |
| `pendingChargeThrough` | post-charge ride-over offered | chained CHARGE_END + MOVE (2 MP) |
| `pendingHeroAttachConversion` | attach, MP<1, actions cover it | convert N actions → attach |
| `pendingHeroSwapConversion` | swap, MP<1, actions cover it | convert N actions → swap |
| `pendingAttachOverBudget` | attach, no MP/actions | attach over budget |
| `pendingSwapOverBudget` | swap, no MP/actions | swap over budget |

Every one: modal + confirm/cancel, `controlsLocked` guard on resume, red `addError` when over budget.

## 6. Permission matrix

| Gate | Rule |
|---|---|
| `canControlUnit` | GM bypass; else caps ∧ own team's alliance ∧ turn gate (from turn 1: only current alliance) ∧ freeMove |
| `canReactToUnit` | isGM ∨ same team (turn gate **not** applied) |
| `canEditUnit` | caps ∧ same alliance |
| `controlsLocked` | `inReplay ∨ dmGone` — disables drag, click, context menu, undo, keyboard, modals |

## 7. Hidden units (2026-08-28 rules)

Hidden units (only GM sees tokens): no hover/tooltip, no context menu, no double-click edit (non-GM),
**cannot be attached to**, **cannot be attack targets**, **cannot be reaction targets or movers**.
Movement blocking (occupied hexes) STAYS — a hidden unit still occupies its hex.

## 8. Known chart-adjacent findings (pre-review)

- `detachHero` in `useGameEngine.ts:609` is dead code (destructured but never called) — removed 2026-08-28.
- `routeReactionUnit` (ScenarioMap:631) duplicated by local `routeUnit` builders in `performAttack` (1588) and `handleResolveCast` (1939).
- AGENTS.md work-summary line "1 MP per org-level step" for formation cost is stale (actual: flat 50%).
