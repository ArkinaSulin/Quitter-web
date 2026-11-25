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
  /**
   * Pending Intelligence captaincy bonus for this card's next d20 card roll
   * (docs/dev/21). A card holds at most one pending bonus; it may be negative.
   */
  commandBonus?: number;
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
  const entry = cardState?.[cardKey];
  const commandBonus = entry?.turn === turn ? entry.commandBonus : undefined;
  return {
    ...(cardState ?? {}),
    [cardKey]: {
      turn,
      step,
      stepsUsed: next,
      ...(commandBonus !== undefined ? { commandBonus } : {}),
    },
  };
}

/** Pending Intelligence captaincy bonus on a card, or undefined when none. */
export function cardCommandBonus(
  cardState: ShipCardStepState | null | undefined,
  cardKey: string,
  turn: number,
): number | undefined {
  const entry = cardState?.[cardKey];
  if (!entry || entry.turn !== turn || entry.commandBonus === undefined) return undefined;
  return Math.round(entry.commandBonus);
}

/** Place the captain's pending bonus on a card. Only one pending bonus per card. */
export function setCardCommandBonus(
  cardState: ShipCardStepState | null | undefined,
  cardKey: string,
  turn: number,
  step: number,
  bonus: number,
): ShipCardStepState {
  const entry = cardState?.[cardKey];
  const sameTurn = entry?.turn === turn;
  return {
    ...(cardState ?? {}),
    [cardKey]: {
      turn,
      step: sameTurn ? (entry?.step ?? step) : step,
      stepsUsed: sameTurn ? clampSteps(entry?.stepsUsed) : 0,
      commandBonus: Math.round(bonus),
    },
  };
}

/** Remove a card's pending command bonus (it was consumed by a d20 roll). */
export function clearCardCommandBonus(
  cardState: ShipCardStepState | null | undefined,
  cardKey: string,
  turn: number,
): ShipCardStepState {
  const entry = cardState?.[cardKey];
  if (!entry || entry.turn !== turn || entry.commandBonus === undefined) {
    return cardState ?? {};
  }
  const { commandBonus: _unused, ...rest } = entry;
  return { ...(cardState ?? {}), [cardKey]: rest };
}

/** Drop every pending command bonus (end of turn). */
export function clearCommandBonuses(
  cardState: ShipCardStepState | null | undefined,
): ShipCardStepState {
  if (!cardState) return {};
  let changed = false;
  const out: ShipCardStepState = {};
  for (const [key, entry] of Object.entries(cardState)) {
    if (entry.commandBonus !== undefined) {
      changed = true;
      const { commandBonus: _unused, ...rest } = entry;
      out[key] = rest;
    } else {
      out[key] = entry;
    }
  }
  return changed ? out : cardState;
}

/** Sanitize stored card_state JSON. */
export function normalizeCardStepState(raw: unknown): ShipCardStepState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ShipCardStepState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const commandBonus = entry.commandBonus === undefined
      ? undefined
      : Math.round(Number(entry.commandBonus) || 0);
    out[key] = {
      turn: Math.max(0, Math.floor(Number(entry.turn) || 0)),
      step: Math.max(0, Math.floor(Number(entry.step) || 0)),
      stepsUsed: clampSteps(entry.stepsUsed),
      ...(commandBonus !== undefined ? { commandBonus } : {}),
    };
  }
  return out;
}
