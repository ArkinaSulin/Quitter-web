# 17 — AI Assist (enemy AI plotting tool)

> **Status: shipped (v3 + Pass 1/2a/2b).** A GM-only-by-default tool — no turn
> automation. Pass 1 (movement/safety), Pass 2a (line assignment, leftover MP,
> stance, cohesion) and Pass 2b (aggressive/defensive profiles) are in
> `src/packages/ai/lib/planner.ts` (commits `009a6b1`, `f4e3695`). Full-AI mode
> (an alliance auto-plays its whole turn) remains a future layer on the same
> engine. Remaining rounds and the next-session order are in
> `docs/dev/outstanding.md` §AI assist.

## What it is

A Scenario-Settings toggle (`scenarios.ai_assist_enabled`, migration 076)
reveals an **AI** tab in the GM's left panel. Two further flags tune access and
behaviour (migration **130**):

| Setting | Column | Meaning |
|---|---|---|
| **AI assist** | `ai_assist_enabled` | Master switch: shows the AI tab. |
| **Advanced AI** | `ai_assist_advanced` | OFF = the green-friendly greedy brain (shipped default). ON = retaliation-aware melee, finish/overkill value, kill-zone/spacing penalties, and light target reservation. |
| **Allow players to use AI assist** | `ai_assist_players` | Non-GM participants may open/use the tab during the active side's turn. The GM still owns all three settings. |

The effective gate is
`ai_assist_enabled && (effectiveIsGM || ai_assist_players) && !controlsLocked`;
the same gate controls the token-click opt-out. Replays and DM-offline lock the
tab. No access-matrix change: server-side `execute_command` already permits
participant MOVE / ATTACK / ROTATE / FORMATION commands.

The GM drags teams into an **AI control box**; every eligible unit on those teams
(for the active alliance) gets a **checkmark** on the map — a plain **click on a
checked token toggles that unit's opt-out** (grey badge), so individual units can
be excluded from the plot. **Preview** runs the pure planner
and draws the plot (route polylines, crossed swords on attack targets, ghost
at the end hex). **Reset** clears it — nothing is written until **Execute**.
Execute replays the plan **through the normal action path** (`performMove` /
`performAttack`), one command at a time, with Pause / Step / Resume / Cancel
remainder controls. Undo stays unit-by-unit; an **Undo Execute** macro rewinds
the whole batch back to its start.

**AI-assist mode** is deliberately *assist*: the DM (or an allowed player)
triggers Preview/Execute, answers normal prompts (routs, at-cap retaliation), and
presses End Turn. It never auto-acts.


## Files

| Concern | File |
|---|---|
| Pure planner + gates | `src/packages/ai/lib/planner.ts` (+ `ai/planner.test.ts`, `index.ts`) |
| Panel (UI + Execute driver + undo macro) | `src/components/ScenarioMap/AiPanel.tsx` |
| Overlay types (canvas) | `src/components/ScenarioMap/aiTypes.ts` |
| Overlay drawing (✓, routes, ghosts) | `useCanvasDraw.ts` (optional `aiOverlay`/`aiHoveredUnitId`) |
| Left panel tab | `LeftPanel.tsx` (optional `aiPanelContent`) |
| Scenario wiring | `ScenarioMap.tsx` (settings toggles + `aiOverlay` state + panel node) |
| Columns | `supabase/migrations/076_ai_assist.sql`, `130_ai_assist_flags.sql` |

## Control & eligibility gates (locked)

A unit may be handed to the AI **only when all** of:

- not `isDeleted`, not `hidden`, and `currentUnitHp > 0` (killed/downed out) —
  *and* it never targets deleted/killed/hidden units either;
- **not a hero**, **not an attached hero**, and **not the host of an attached
  hero** — heroes and hero-mounted units are played by the players/DM, never by
  the AI;
- **Routed units ARE eligible** — the planner flees them as far from the
  nearest hostile as their full move allows (`chooseFleeHex`), never attacking;
- not in the DM's per-unit **opt-out** set (`excludeUnitIds` — clicking the
  token toggles it; opt-outs clear at each End Turn);
- its **team is in the AI control box** AND its **alliance equals the current
  turn alliance** (`currentTurnAlliance`); free play (null turn) never plots;
- `actionsAvailable >= 1`.

A team only ever attacks units of the **adversarial alliance**
(`friendly ↔ enemy`; neutral is never auto-attacked or auto-driven). Fog is
respected: attack targets must lie in the AI side's visible hexes, computed with
`computeVisibleHexes` (darkvision-aware; hidden units never reveal). The planner
also treats hidden units as non-blocking scenery for its own occupancy/threat
model.

## Planner (`planAiMoves`) — v3

Snapshot-in/snapshot-out; near-equal battle-role choices use `Math.random`, while the committed plan is logged and replayed through undo/redo:
- Simulates the board on **copies** as it plots, so later units plan against
  the evolving positions/occupancy and two units never target the same hex.
- Steps can be **move, attack, turn (60°), or formation**. A unit may now
  **rotate** to face an objective (1 MP/60° for formed units via `applyMpSpend`,
  free for Hero/Scattered/Routed; no about-turns — org levels are never dropped)
  and **change formation** (real `applyFormationChange` accounting) — so
  previews can show curved turn glyphs and a formation chip.
- **Real map context**: per-unit `makeCostOfHex` / `makeBlockedEdge` (structures,
  walls, zones, mount, `ignore_climb`), per-surface occupancy
  (`unitStandingSurface` + `computeOccupiedHexes`), structure-aware threat maps,
  door/loose pass-through, and `enter_org_max` breaks via `entryBreakFormation`.
  This mirrors the human drag pipeline, so the AI no longer plans through walls,
  closed structures or org gates.
- **Doctrine is automatic by weapon type**: ranged-only units **stand off**
  (keep a gap from melee enemies, adopt **Scattered** when contact looms and it
  is affordable) and back away instead of swinging fists; melee/hybrid units
  **engage**.
- **Ranged targets pick the biggest threat first**: an enemy **within 2 hexes**,
  else a **Phalanx**, else a **Close Order** unit; value breaks ties within a
  tier.
- **Melee attacks prefer the best arc**: of the targets at adjacency, the one it
  is attacking from the enemy's **rear**, then **flank**, then front. Movement
  approaches try **cheap flanking** — up to a few 60° turns plus a straight leg,
  within the unit's real MP/action budget — landing in the enemy's flank/rear
  hexes; otherwise it closes frontally.
- **Multi-maneuver movement (both brains)**: each maneuver spends one action's
  movement pool; the unit may repeat move/turn legs across its remaining actions
  (a mounted unit can eventually do move → turn → move → turn → charge).
  **Strict turn rule**: if any **0-turn** option can attack/charge, every turned
  option is discarded. Otherwise a turn is allowed only when it immediately
  enables an attack/charge. Lane assignment, cohesion and line bearing may choose
  among no-turn options but **never** justify a rotation. After a unit attacks,
  no further turn is plotted for that activation (an AGR failure still spends the
  attack action, so a follow-up turn could otherwise be unaffordable).
  **Scattered free turns** are exempt: they cost 0 MP/action and no attack
  surcharge, so the unit may use the full facing circle for positioning,
  exposure, the next attack, or reaction coverage (including a post-move facing
  when it does not attack).
  There is **no generic "no contact" penalty** — melee contact is symmetric, and
  the Advanced retaliation/trade model values the exchange. A charge-specific
  setup penalty can be added in Round 3 if needed. The step budget is per unit:
  `max(5, ceil(computeMoveBudget(unit, effectiveMax)))` (a 6-MP mounted unit gets
  12, heavy infantry 2 MP gets 4→5), enough for the whole action budget's hexes
  plus turns/attacks.
- **Leftover MP and holding**: a unit remains plottable while it has actions
  **or** materialized MP. With 0 actions it may still spend leftover MP on a
  final move, but attacks require an action. Holding position is always a
  scored option, so a unit does not move/turn merely because it has MP left.
  **Melee full-turn advance**: if a melee unit still has actions/MP, is not
  adjacent to an enemy, and the scoring chooses a hold, it instead takes the
  best no-turn destination closer to its assigned lane (or nearest enemy). This
  prevents a defensive line from stopping after one maneuver and needing a
  second Preview/Execute to finish the turn.
- **Real post-move attack accounting**: `maneuverOptions` applies
  `applyMoveCost` before checking `leadsToAttack`, so a move can spend leftover
  MP and still leave the action needed for an attack. This replaces the old
  `actionsAvailable >= 2` approximation.
- **Stable defensive cluster cap**: the slowest-member speed cap is measured
  from the **initial** positions for the whole plan, not the mutating working
  state. A fast unit cannot escape the cap once the slow members move, and the
  line stays together.
- **Battle roles (both brains)**: `assignBattleRoles` generates candidate
  contiguous frontage windows of `enemies.length` units and scores each by
  coverage, connection/isolation, flank/rear reach, extra movement speed, own
  exposure, and stance. The window may shift left/right, so the whole line can
  cover one end while two adjacent surplus units flank the other. Surplus units
  strongly prefer fast troops for flanking (e.g. 4-MP wolf riders over 3-MP
  warriors), and a surplus pair stays on the same end when possible to reduce
  isolation. Roles are `frontage`, `flank`, `rear`,
  `reserve`, `ranged`, and `structure`. Near-equal candidates use **`Math.random`**
  jitter; consistency comes from the command log/undo-redo, not from forcing the
  same choice on every Preview. `assignTargets` remains as the simple 6-vs-6
  line-assignment helper.
- **Aggressive surplus**: rear first when reachable (no AGR, no retaliation,
  doubled threat → faster rout), else flank. Flankers wait until the target is
  **melee-locked** by a friendly, never take a redundant front attack, and never
  front-charge. They may rotate only when it enables a flank/rear attack.
- **Defensive surplus**: defaults to **second rank / reserve**, connected to the
  line; it can patch a routing hole. A connected flank is taken only when safe.
- **Ranged support**: ranged-only units are excluded from frontage/flank roles.
  They stand off, never voluntarily enter melee contact, shoot with both actions
  when possible, and retreat/kite when closed on. Scattered is the escape/transit
  formation.
- **Structure defenders**: a unit on a standing hex structure or on the inside hex
  of a standing edge structure holds it in **all stances**. It may attack,
  rotate, and change formation, but never voluntarily moves out; it is excluded
  from frontage/flank roles. Routed units flee normally; a destroyed/removed
  structure releases the hold.
- **Ranged reaction awareness**: when archer reaction is enabled, ranged hold
  positions score clear reaction lanes (snap-shot `range`, front arc, LoS, no
  friendly/obstacle blocker). Reaction uses only actions left after the unit
  stands and holds — the planner does **not** reserve an action or trade away an
  attack for it. Safe repositioning for a clear lane is allowed; moving into
  contact is not.
- **Line-order compatibility**: 6-vs-6 style assignments still pair sorted units
  and enemies left-to-right with adjacent value swaps via `assignTargets`.

- **Self-preservation (both brains)**:
  - a destination is penalized for OTHER live enemies in the mover's **rear**
    (heaviest) or **flank** arc; the intended melee target is excluded only when
    the unit will actually have an action to attack it after the move;
  - a path that passes adjacent to a non-target enemy is penalized;
  - the nearest non-target enemy keeps its **line bearing** even at long range:
    turning the flank/rear toward the enemy battle line is penalized, so a unit
    does not wrap around the line while merely advancing;
  - turns are gated by the **strict turn rule** above: a no-turn attack always
    wins, and lane/line scores only break ties among no-turn options;
  - at adjacency, the estimate uses a melee weapon/fists rather than the active
    ranged weapon's point-blank profile.
- **Formation-aware retaliation (both brains)**: `expectedRetaliation` respects
  the defender's `retaliate_arcs` (`none` → no counter-blow; `rows` → the
  defensive rows-based count `ceil(troops / visualDotsPerRow)`; `full` → normal),
  `retaliate_vs_ranged`, `noRetaliation`, and the attacker's `be_attacked_*`
  vulnerability.
- **Basic vs Advanced**:
  - **Basic** (default) = raw expected damage plus the safety/retaliation fixes
    above. No formation shopping.
  - **Advanced** additionally weighs expected retaliation, adds a finishing
    bonus, reserves damage per target so a second unit does not overkill a
    nearly-dead squad, and penalizes destinations crowded by friendlies or
    covered by extra enemy weapons/kill zones.
  - **Advanced formation changes (role-aware)**: near contact or in a hostile
    ZoC, melee units upgrade to the **highest available organisation level**
    (`canAdoptFormation`, `isFormationChangeAffordable`, Shield Wall shield/2H
    restrictions). Frontage/reserve/structure units prioritise that upgrade even
    if it costs the attack; flankers attack first and upgrade only when no attack
    is available. Flankers may chain two upgrades in one action
    (Scattered → Open → Close) when the budget covers both. Defensive units
    prioritise the highest formation over speed. Ranged units use Scattered only
    as an escape/transit formation and otherwise stand off.
  - **Rear attack value**: `attackValue` discounts front/flank priority by an
    approximate AGR pass chance; rear attacks are guaranteed (no AGR), have no
    retaliation, and carry a rout-threat bonus.
  - **Reaction fire**: archer-reaction hold positions score clear snapshot lanes
    (`range`, arc, LoS); the planner uses only actions left after the unit holds
    and never sacrifices an attack for reaction eligibility.
  - **Basic vs Advanced + stance**: Basic = Simple, Advanced = Advance; the
    AI-tab **Aggressive / Defensive** toggle selects the posture (default
    Aggressive, per preview, local state).
  - **Aggressive simple**: max damage via the line assignment; safety only as a
    tie-break (equal damage → lower expected counter-blow). Mounted charges
    come with Round 3.
  - **Aggressive advance**: adds retaliation/overkill value, prioritizes
    **isolated / low-AC** targets, and avoids a non-lethal **melee lock** when
    the target is expected to survive and answer. Formation consideration uses
    the melee formation evaluator above. Mounted charges come with Round 3.
  - **Defensive simple**: safety weights exposure/line above damage; ranged
    units avoid destinations that force them into an enemy ZoC (reactive
    archery's stop-before is respected); melee units stay together and never
    present a flank/rear; then damage.
  - **Defensive advance**: ranged formation posture — **Close Order** when far
    and not under ranged fire (max attacks), **Open/Scattered** when taking
    ranged fire (lower `be_attacked_range_modifier`), **Scattered** when melee
    is imminent (all-direction disengage). A defensive cluster's movement is
    capped to its **slowest member's effective speed** and the slowest unit is
    planned first so the fast units can follow. AGR scales cohesion linearly
    (low AGR sticks, high AGR may range).
- **Never over-budget**: every simulated action uses the real accounting
  functions (`applyMpSpend`, `applyMoveCost`, `applyFormationChange`) so no plan
  raises a soft-enforcement prompt. If a planned step still becomes unaffordable
  at execution (e.g. a reaction changed the live state), the executor reports it
  once and drops that unit's remaining steps instead of running a stale sequence.
- Routed units instead **flee**: each step picks the reachable hex strictly
  farthest from the nearest hostile (enemy kill-zone landings penalized), for
  as many actions as they have — they never attack. The run **stops at the
  map's outer rim** (`gridRadius` in the plan context): a routed unit never
  moves beyond the drawn grid, and one already at/outside the rim (e.g. after
  the GM shrank the grid) stays put — giving the DM a chance to hide it.

## Artillery (Round 2a, planned)

War-machine units are **emplaced** in this game: the weapon is represented by a
placed structure (AC/HP) and the unit token is the crew, so the AI must not
reposition the crew once the weapon is set up.

- **Detect** artillery by any parsed weapon with `warMachine` (no new flag).
- **Immobile while operating**: no move, turn, or formation steps — fire or hold.
  The rule is **AI-only**; players may still reposition with DM adjudication.
- **Firing** needs 2 actions and `attacksUsed < 5` (one shot consumes all 5
  attacks). Damage is estimated with a war-machine-specific helper
  (`acVsWarMachine`, shot count, min/max range, LoS) rather than the per-troop
  melee estimate.
- **Bombard step**: the attack step is marked `bombard`; execution routes it
  through `handleAttackRequest`, and the batch **pauses for the GM's normal AoE
  marker placement**, then resumes. No auto-placement rule.
- **Rout is normal**: the crew flees like any routed unit; the weapon structure
  is already on the map (no extra marker), so no artillery-specific rout rule.

## Execute driver (in `AiPanel`)

- Steps are validated **just-in-time** against live state: a unit that died/
  routed/was blocked, or a target that vanished/left range, is **skipped with
  a message** ("X was routed — skipped"). Leftover units keep their actions
  for the DM or a new batch.
- Pause / Step / Resume / Cancel remainder turn Execute into a controllable
  session (player reactions and rout prompts resolve between steps).
- Rout decisions still route to the DM (existing flow: a routed team with no
  non-GM owner is orchestrated by the GM), so an AI unit that routs mid-execute
  shows the DM the normal retreat card.
- Steps emit through the real `performMove` / `performAttack` / `rotateUnit` /
  `changeFormation` callbacks — the same code a human invokes — so facing, cost,
  retaliation, morale, reactions and rout chains behave identically and land in
  the command log.

## Undo

- **Default: unit-by-unit.** Every AI action is a normal command (with its
  chained rout/pursuit consequences); Ctrl+Z reverts the last one.
- **Undo Execute macro:** records the live top `scenario_command_log` id *before* the
  batch, then loops the server-validated `undo()` while the current top id
  differs from that baseline (stops at any foreign boundary, e.g. a player's
  reaction that isn't part of the batch). No schema or RPC changes.

## Invariants

- The planner never produces friendly fire, out-of-fog targets, over-budget
  moves, or over-cap attacks (asserted in tests).
- Hidden/deleted/killed units are invisible to the AI both as *drivers* and as
  *targets*.
- Nothing is logged until Execute; Preview→Reset is free.
- AI commands ride the normal log → Messages, Replay and Undo debug all work.

## Non-goals (future layers)

Whole-turn auto-director (Round 5), auto-answering every prompt, AI magic/
reactions/hero attach, bot accounts. The next layers, in order, are **Round 2a
archers + artillery** (including the war-machine slice below), **Round 3 mounted
charges**, **Round 4 full coordination**, and **Round 5 full auto-turn**;
difficulty levels beyond Basic/Advanced also remain. The planner + Execute driver
here are the foundation those would reuse. The planner still ignores ZoC
scatter/pursue, flight, and some elevation nuances, and never controls heroes.
