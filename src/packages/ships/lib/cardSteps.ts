// src/packages/ships/lib/cardSteps.ts
// Per-card function budget. Every card function except Fill/Empty station costs
// one card step; a card can spend at most 5 per turn. In wildspace a card can
// spend at most one step per ship step; in atmosphere all five are available
// during the turn. Approved negative actions are logged separately and do not
// add an extra card step (a card already at 5/5 may still be used that way).

export interface ShipCardStepEntry {
  /** Turn number this entry belongs to. */
  turn?: number;
  /** Last wildspace ship step that spent a card step. */
  step?: number;
  /** Card steps spent this turn (0..5). */
  stepsUsed?: number;
}

export type ShipCardStepState = Record<string, ShipCardStepEntry>;

export const SHIP_CARD_STEPS_PER_TURN = 5;

function clampSteps(value: unknown): number {
  return Math.max(0, Math.min(SHIP_CARD_STEPS_PER_TURN, Math.floor(Number(value) || 0)));
}

/** Card steps used this turn for one card (resets only when the turn changes). */
export function cardStepsUsed(
  cardState: ShipCardStepState | null | undefined,
  cardKey: string,
  turn: number,
): number {
  const entry = cardState?.[cardKey];
  if (!entry || entry.turn !== turn) return 0;
  return clampSteps(entry.stepsUsed);
}

/** Whether this exact wildspace step already spent a card step. */
export function cardStepUsedInStep(
  cardState: ShipCardStepState | null | undefined,
  cardKey: string,
  turn: number,
  step: number,
  mode: 'atmosphere' | 'wildspace',
): boolean {
  if (mode !== 'wildspace') return false;
  const entry = cardState?.[cardKey];
  return !!entry && entry.turn === turn && entry.step === step;
}

export function cardStepsRemaining(
  cardState: ShipCardStepState | null | undefined,
  cardKey: string,
  turn: number,
): number {
  return Math.max(0, SHIP_CARD_STEPS_PER_TURN - cardStepsUsed(cardState, cardKey, turn));
}

/** Whether a card can spend a normal (non-negative) card step right now. */
export function canSpendCardStep(
  cardState: ShipCardStepState | null | undefined,
  cardKey: string,
  turn: number,
  step: number,
  mode: 'atmosphere' | 'wildspace',
): boolean {
  return cardStepsRemaining(cardState, cardKey, turn) > 0
    && !cardStepUsedInStep(cardState, cardKey, turn, step, mode);
}

/** Spend card steps for one card (capped at 5). Returns a new card-state map. */
export function spendCardSteps(
  cardState: ShipCardStepState | null | undefined,
  cardKey: string,
  turn: number,
  step: number,
  mode: 'atmosphere' | 'wildspace',
  count = 1,
): ShipCardStepState {
  const used = cardStepsUsed(cardState, cardKey, turn);
  const spend = Math.max(0, Math.floor(count));
  const next = Math.min(SHIP_CARD_STEPS_PER_TURN, used + spend);
  return {
    ...(cardState ?? {}),
    [cardKey]: { turn, step, stepsUsed: next },
  };
}

/** Sanitize stored card_state JSON. */
export function normalizeCardStepState(raw: unknown): ShipCardStepState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ShipCardStepState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    out[key] = {
      turn: Math.max(0, Math.floor(Number(entry.turn) || 0)),
      step: Math.max(0, Math.floor(Number(entry.step) || 0)),
      stepsUsed: clampSteps(entry.stepsUsed),
    };
  }
  return out;
}
