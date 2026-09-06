# 17 — AI Assist (enemy AI plotting tool)

> **Status: shipped (v0).** A GM-only tool — no turn automation. Full-AI mode
> (an alliance auto-plays its whole turn) is a future layer on the same
> engine.

## What it is

A Scenario-Settings toggle (`scenarios.ai_assist_enabled`, migration 076)
reveals an **AI** tab in the GM's left panel. The GM drags teams into an
**AI control box**; every eligible unit on those teams (for the active
alliance) gets a **checkmark** on the map. **Preview** runs the pure planner
and draws the plot (route polylines, crossed-swords on attack targets, ghost
at the end hex). **Reset** clears it — nothing is written until **Execute**.
Execute replays the plan **through the normal action path** (`performMove` /
`performAttack`), one command at a time, with Pause / Step / Resume / Cancel
remainder controls. Undo stays unit-by-unit; an **Undo Execute** macro rewinds
the whole batch back to its start.

**AI-assist mode** is deliberately *assist*: the DM triggers Preview/Execute,
answers normal prompts (routs, at-cap retaliation), and presses End Turn. It
never auto-acts.

## Files

| Concern | File |
|---|---|
| Pure planner + gates | `src/lib/enemyAI/planner.ts` (+ `planner.test.ts`, `index.ts`) |
| Panel (UI + Execute driver + undo macro) | `src/components/ScenarioMap/AiPanel.tsx` |
| Overlay types (canvas) | `src/components/ScenarioMap/aiTypes.ts` |
| Overlay drawing (✓, routes, ghosts) | `useCanvasDraw.ts` (optional `aiOverlay`/`aiHoveredUnitId`) |
| Left panel tab | `LeftPanel.tsx` (optional `aiPanelContent`) |
| Scenario wiring | `ScenarioMap.tsx` (settings toggle + `aiOverlay` state + panel node) |
| Column | `supabase/migrations/076_ai_assist.sql` |

## Control & eligibility gates (locked)

A unit may be handed to the AI **only when all** of:

- not `isDeleted`, not `hidden`, and `currentUnitHp > 0` (killed/downed out) —
  *and* it never targets deleted/killed/hidden units either;
- not an attached hero and not the host of an attached hero (split-accounting
  is out of v0);
- not Routed (the rout flow already handles those);
- its **team is in the AI control box** AND its **alliance equals the current
  turn alliance** (`currentTurnAlliance`); free play (null turn) never plots;
- `actionsAvailable >= 1`.

A team only ever attacks units of the **adversarial alliance**
(`friendly ↔ enemy`; neutral is never auto-attacked or auto-driven). Fog is
respected: attack targets must lie in the AI side's visible hexes.

## Planner (`planAiMoves`)

Deterministic, pure, snapshot-in/snapshot-out:
- Simulates the board on **copies** as it plots, so later units plan against
  the evolving positions/occupancy and two units never target the same hex.
- Per unit (≤ `maxStepsPerUnit`, default 3): prefer the best **attack**
  (highest expected damage among `legalTargets`, computed from row/attack-cap
  math, hit chance incl. disadvantage, mean damage capped at troop HP); else
  **move** to the best scored reachable hex (`computeReachableMap`, threat/
  ZOC-aware via `computeThreatHexes`, terrain costs honored). A move uses real
  MP accounting (`computeMovePool` + `applyMoveCost`) so the AI **never plans
  an over-budget (soft-enforcement) action**.
- Scoring favors landing hexes that enable an attack now, then closeness to
  the nearest enemy; landing in an enemy zone of control is penalized.

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
- Steps emit through the real `performMove`/`performAttack` callbacks — the
  same code a human drag invokes — so retaliation, morale, reactions and rout
  chains behave identically and land in the command log.

## Undo

- **Default: unit-by-unit.** Every AI action is a normal command (with its
  chained rout/pursuit consequences); Ctrl+Z reverts the last one.
- **Undo Execute macro:** records the live top `command_log` id *before* the
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

Whole-turn auto-director, auto-answering every prompt, AI charges/magic/
reactions/hero attach, difficulty knobs, bot accounts. The planner + Execute
driver here are the foundation those would reuse.
