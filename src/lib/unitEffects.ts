// src/lib/unitEffects.ts
// Temporary-effect domain logic (pure, unit-tested): unit buffs/debuffs/DoTs and
// ground (hex) effects. Shared by the live map (apply/remove commands, the
// END_TURN expiry/DoT sweep) and replay.
//
// Semantics (locked):
//  - Duration counts ACTIVATIONS OF THE CASTER. A tick happens at the start of the
//    caster's activation (END_TURN transitions INTO the caster's alliance): DoT
//    damage lands, turnsLeft decrements, and at 0 the effect expires (stat restored).
//  - If the caster unit is destroyed the effect expires immediately. Effects with no
//    caster unit (GM-placed ground effects) tick on their recorded casterTeam.
//  - No same-kind stacking on one carrier: a second effect of the same kind is
//    ignored (stat math = snapshot base + delta, restore = base).
//  - Stat deltas materialize on the REAL unit fields (currentAc, currentMoraleModifier,
//    movementPoints base) so combat/morale/movement consumers need no edits.

import { Unit, UnitEffect, GroundEffect, EffectKind, AllianceGroup } from '@/types/gameProtocol';
import { SubStep, UnitChange } from '@/lib/commandLog';
import { parseDice, rollDice } from '@/lib/effectTemplates';

/** The real unit field a stat kind modifies (dot/hp_borrow have none — they touch HP). */
export function statFieldOf(kind: EffectKind): 'currentAc' | 'currentMoraleModifier' | 'movementPoints' | null {
  switch (kind) {
    case 'ac': return 'currentAc';
    case 'morale': return 'currentMoraleModifier';
    case 'movement': return 'movementPoints';
    case 'dot':
    case 'hp_borrow':
    case 'entry':
    case 'mp_cost': return null;
  }
}

export function isStatEffect(kind: EffectKind): boolean {
  return kind === 'ac' || kind === 'morale' || kind === 'movement';
}

/** Apply-time payload for a new effect (duration/turnsLeft filled by the engine). */
export type EffectSpec = Omit<UnitEffect, 'key' | 'base' | 'turnsLeft' | 'duration'>;

/** Stable instance id (injectable for tests). */
export function newEffectKey(rnd: () => number = Math.random): string {
  return `eff-${Date.now().toString(36)}-${rnd().toString(36).slice(2, 9)}`;
}

export function effectAt(unit: Unit | null | undefined, kind: EffectKind): UnitEffect | undefined {
  return (unit?.effects ?? []).find(e => e.kind === kind);
}

export function effectByKey(unit: Unit | null | undefined, key: string): UnitEffect | undefined {
  return (unit?.effects ?? []).find(e => e.key === key);
}

/** Field value a stat effect snapshots/restores on the carrier. */
function statValue(unit: Unit, kind: EffectKind): number {
  const field = statFieldOf(kind);
  if (!field) return 0;
  const v = unit[field] as number;
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

/**
 * UnitChanges that materialize a NEW effect on `effects`. Stat kinds write
 * field = current + delta and snapshot the pre-effect value as `base`. DoT writes
 * nothing now (it damages at each caster tick).
 */
export function applyEffectChanges(unit: Unit, spec: Omit<UnitEffect, 'key' | 'base'>, key = newEffectKey()): { changes: UnitChange[]; effect: UnitEffect } {
  const effects = unit.effects ?? [];
  // No same-kind stacking on one carrier.
  if (effects.some(e => e.kind === spec.kind)) {
    return { changes: [], effect: effects.find(e => e.kind === spec.kind)! };
  }
  const effect: UnitEffect = { ...spec, key, base: isStatEffect(spec.kind) ? statValue(unit, spec.kind) : undefined };
  const changes: UnitChange[] = [
    { field: 'effects', from: effects, to: [...effects, effect] },
  ];
  const field = statFieldOf(spec.kind);
  if (field) {
    const to = statValue(unit, spec.kind) + spec.delta;
    changes.unshift({ field, from: unit[field], to });
  }
  // Sleep (hp_borrow): HP is deducted immediately (never below 1); the refund
  // happens when the effect expires (see removeEffectChanges / END_TURN).
  if (spec.kind === 'hp_borrow' && (spec.delta || 0) > 0) {
    changes.unshift(...hpBorrowDamageChanges(unit, spec.delta));
  }
  return { changes, effect };
}

/**
 * UnitChanges that revert one effect by key: removes it from `effects` and, for a
 * stat kind, restores the field to the snapshot `base`.
 */
export function removeEffectChanges(unit: Unit, key: string): UnitChange[] {
  const effects = unit.effects ?? [];
  const entry = effects.find(e => e.key === key);
  if (!entry) return [];
  const changes: UnitChange[] = [
    { field: 'effects', from: effects, to: effects.filter(e => e.key !== key) },
  ];
  const field = statFieldOf(entry.kind);
  if (field && typeof entry.base === 'number') {
    changes.unshift({ field, from: unit[field], to: entry.base });
  }
  // Sleep refund: expiring/removing an hp_borrow gives the borrowed HP back
  // (capped) unless the unit was killed in the meantime.
  if (entry.kind === 'hp_borrow') {
    changes.unshift(...hpBorrowRefundChanges(unit, entry.delta || 0));
  }
  return changes;
}

/**
 * UnitChanges that replace one effect in place (same key slot, new payload):
 * remove the old (restores any stat snapshot) then re-apply the new spec. Used
 * by the instance edit modal so stat effects rebase correctly.
 */
export function editEffectChanges(
  unit: Unit,
  key: string,
  spec: Omit<UnitEffect, 'key' | 'base' | 'turnsLeft' | 'duration'>,
  duration: number,
  newKey = newEffectKey(),
): UnitChange[] {
  const remove = removeEffectChanges(unit, key);
  if (remove.length === 0) return [];
  const unitAfter: Unit = { ...unit };
  for (const c of remove) (unitAfter as any)[c.field] = c.to;
  const { changes: apply } = applyEffectChanges(unitAfter, { ...spec, duration: Math.max(1, duration), turnsLeft: Math.max(1, duration) }, newKey);
  return [...remove, ...apply];
}

/** DoT damage: a unit's damage over time landing on `target` (flat per tick). */
export function dotDamageChanges(target: Unit, damage: number): UnitChange[] {
  if (damage <= 0) return [];
  const newHp = Math.max(0, (target.currentUnitHp ?? 0) - damage);
  const newTroops = Math.min(target.maxTroopCount ?? 0, Math.max(0, Math.ceil(newHp / Math.max(1, target.troopHp ?? 1))));
  return [
    { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
    { field: 'currentTroopCount', from: target.currentTroopCount, to: newTroops },
  ];
}

function troopFromHp(target: Unit, hp: number): number {
  return Math.min(target.maxTroopCount ?? hp, Math.max(1, Math.ceil(hp / Math.max(1, target.troopHp ?? 1))));
}

/** Sleep (hp_borrow): remove X HP now — NEVER below 1 HP (cannot kill). */
export function hpBorrowDamageChanges(target: Unit, x: number): UnitChange[] {
  if (x <= 0) return [];
  const newHp = Math.max(1, (target.currentUnitHp ?? 1) - x);
  return [
    { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
    { field: 'currentTroopCount', from: target.currentTroopCount, to: troopFromHp(target, newHp) },
  ];
}

/** Sleep refund: give the borrowed X HP back (capped at max) — only if alive. */
export function hpBorrowRefundChanges(target: Unit, x: number): UnitChange[] {
  if (x <= 0 || (target.currentUnitHp ?? 0) <= 0) return [];
  const newHp = Math.min(target.maxUnitHp ?? (target.currentUnitHp ?? 0) + x, (target.currentUnitHp ?? 0) + x);
  return [
    { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
    { field: 'currentTroopCount', from: target.currentTroopCount, to: troopFromHp(target, newHp) },
  ];
}

const thOf = (t: Unit) => Math.max(1, t.troopHp ?? 1);
type SaveStatName = 'Str' | 'Dex' | 'Con' | 'Int' | 'Wis' | 'Cha';

/** One troop's saving throw: d20 + bonus >= DC passes (standard saves). */
function troopSaves(target: Unit, stat: SaveStatName, dc: number, rng: () => number): boolean {
  const bonus = ((target as any)[stat.toLowerCase()] as number) || 0;
  return Math.floor(rng() * 20) + 1 + bonus >= dc;
}

function healChanges(target: Unit, amount: number): UnitChange[] {
  if (amount <= 0) return [];
  const newHp = Math.min(target.maxUnitHp ?? (target.currentUnitHp ?? 0) + amount, (target.currentUnitHp ?? 0) + amount);
  return [
    { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
    { field: 'currentTroopCount', from: target.currentTroopCount, to: troopFromHp(target, newHp) },
  ];
}

/**
 * Structured result of an effect damage/heal resolution (for chat messages/logs).
 * `total` is the absolute HP changed; troop counts bracket the resolution.
 */
export interface EffectDamageDetail {
  /** Troops targeted (flat path: all current troops). */
  affected: number;
  /** Troops that passed their save. */
  passed: number;
  /** Troops that failed their save (affected - passed). */
  failed: number;
  /** Absolute HP change. */
  total: number;
  healing: boolean;
  /** Dice expression when one was rolled. */
  dice?: string;
  /** Each troop's individual raw die roll (dice path only). */
  rolls?: number[];
  /** Sum of the per-troop rolls (dice path only). */
  roll?: number;
  hpBefore: number;
  hpAfter: number;
  troopsBefore: number;
  troopsAfter: number;
}

/** One damage/heal event from a temporary effect, for the message log. */
export interface EffectDamageEvent {
  unitId: string;
  unitName: string;
  /** Effect or zone name that caused it. */
  source: string;
  detail: EffectDamageDetail;
}

/**
 * Damage/heal from an effect modifier, returning both the UnitChanges and a
 * structured detail (rolls, saves, troop counts) for messaging.
 *  - `dice` present: the dice are rolled **once per affected troop** — each troop
 *    takes its own roll (save-adjusted, CAPPED at its troop HP); `healing` flips
 *    damage to healing (also capped per troop at troopHp). Per-troop saves when
 *    `savingThrow` + `saveDC` are set (pass => half if onSaveHalfOrNeg, else 0).
 *  - no `dice`: legacy flat amount applied to the unit HP once (unchanged).
 */
export function resolveEffectDamage(
  target: Unit,
  mod: {
    delta?: number;
    dice?: string;
    healing?: boolean;
    savingThrow?: SaveStatName | null;
    saveDC?: number | null;
    onSaveHalfOrNeg?: boolean;
  },
  rng: () => number = Math.random,
  affectedOverride?: number,
): { changes: UnitChange[]; detail: EffectDamageDetail } {
  const hpBefore = target.currentUnitHp ?? 0;
  const troopsBefore = target.currentTroopCount ?? 0;
  const healing = !!mod.healing;
  const parsed = parseDice(mod.dice);

  let changes: UnitChange[] = [];
  let affected = 0;
  let passed = 0;
  let rolls: number[] | undefined;
  let roll: number | undefined;

  if (!parsed) {
    const amt = mod.delta ?? 0;
    affected = Math.max(0, troopsBefore);
    if (amt > 0) changes = healing ? healChanges(target, amt) : dotDamageChanges(target, amt);
  } else {
    const currentTroops = Math.max(0, troopsBefore);
    affected = Math.max(0, Math.min(affectedOverride ?? currentTroops, currentTroops));
    if (affected > 0) {
      const th = thOf(target);
      const halfOnSave = mod.onSaveHalfOrNeg !== false;
      rolls = [];
      let total = 0;
      for (let i = 0; i < affected; i++) {
        const r = Math.max(0, rollDice(mod.dice, rng));
        rolls.push(r);
        let per = Math.min(r, th);
        if (mod.savingThrow && mod.saveDC != null && troopSaves(target, mod.savingThrow, mod.saveDC, rng)) {
          passed++;
          per = halfOnSave ? Math.min(Math.floor(r / 2), th) : 0;
        }
        total += per;
      }
      roll = rolls.reduce((a, b) => a + b, 0);
      if (healing) {
        changes = healChanges(target, total);
      } else {
        const newHp = Math.max(0, hpBefore - total);
        changes = [
          { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: target.currentTroopCount, to: Math.max(0, Math.ceil(newHp / th)) },
        ];
      }
    }
  }

  const hpAfter = changes.find(c => c.field === 'currentUnitHp')?.to ?? hpBefore;
  const troopsAfter = changes.find(c => c.field === 'currentTroopCount')?.to ?? troopsBefore;
  return {
    changes,
    detail: {
      affected,
      passed,
      failed: Math.max(0, affected - passed),
      total: Math.abs(hpAfter - hpBefore),
      healing,
      ...(parsed ? { dice: mod.dice } : {}),
      ...(rolls ? { rolls } : {}),
      ...(roll != null ? { roll } : {}),
      hpBefore,
      hpAfter,
      troopsBefore,
      troopsAfter,
    },
  };
}

/** UnitChanges only (legacy signature used by apply/entry paths). */
export function effectDamageChanges(
  target: Unit,
  mod: {
    delta?: number;
    dice?: string;
    healing?: boolean;
    savingThrow?: SaveStatName | null;
    saveDC?: number | null;
    onSaveHalfOrNeg?: boolean;
  },
  rng: () => number = Math.random,
  affectedOverride?: number,
): UnitChange[] {
  return resolveEffectDamage(target, mod, rng, affectedOverride).changes;
}

/**
 * One-line chat summary of an effect damage/heal event: who, how many troops
 * were affected, and the damage/heal taken. Verbose mode adds the die roll and
 * the save count.
 */
export function describeEffectDamage(unitName: string, source: string, d: EffectDamageDetail, verbose = false): string {
  const troopWord = d.affected === 1 ? 'troop' : 'troops';
  const rollTxt = d.dice
    ? (d.rolls && d.rolls.length
        ? `${d.dice} per troop → ${d.rolls.join(', ')}${d.rolls.length > 1 ? ` (Σ ${d.roll})` : ''}`
        : d.dice)
    : 'flat';
  const saveTxt = d.passed > 0 ? `, ${d.passed} saved` : '';
  if (d.healing) {
    const recovered = Math.max(0, d.troopsAfter - d.troopsBefore);
    return verbose
      ? `${unitName} healed ${d.total} from ${source} (${d.affected} ${troopWord}, ${rollTxt}${saveTxt})`
      : `${unitName} healed ${d.total} from ${source} (${d.affected} ${troopWord} affected${recovered ? `, ${recovered} recovered` : ''})`;
  }
  const lost = Math.max(0, d.troopsBefore - d.troopsAfter);
  return verbose
    ? `${unitName} took ${d.total} from ${source} (${d.affected} ${troopWord}, ${rollTxt}${saveTxt}, ${lost} lost)`
    : `${unitName} took ${d.total} damage from ${source} (${d.affected} ${troopWord} affected, ${lost} lost)`;
}

/** Remaining ticks of an effect (its own countdown) — DoT ticks then expires. */
function tickDown(effect: UnitEffect): UnitEffect {
  return { ...effect, turnsLeft: Math.max(0, effect.turnsLeft - 1) };
}

interface EndTurnEffectsContext {
  units: Unit[];
  zones: GroundEffect[];
  /** The alliance about to act (END_TURN transition target). */
  nextGroup: AllianceGroup;
  /** Team -> alliance group for the scenario. */
  alliances: Record<string, AllianceGroup>;
  makeKey?: () => string;
  /** Injectable RNG for dice/save rolls (tests). */
  rng?: () => number;
}

export interface EndTurnEffectsResult {
  /** Unit sub-steps to fold into the END_TURN command (before the refresh steps). */
  subSteps: SubStep[];
  /** Ground zones after ticks/expiry — persist to scenarios.map_data. */
  zonesAfter: GroundEffect[];
  /** Damage/heal events this tick, for the message log (who/affected/damage). */
  damageEvents: EffectDamageEvent[];
}

function teamsOf(alliances: Record<string, AllianceGroup>, group: AllianceGroup): Set<string> {
  const teams = new Set<string>();
  for (const [team, g] of Object.entries(alliances)) {
    if (g === group) teams.add(team);
  }
  return teams;
}

/**
 * Compute every effect change that happens when play transitions into `nextGroup`
 * (the start of that alliance's segment):
 *   1. Unit effects whose caster unit was destroyed expire immediately.
 *   2. Effects tick when the incoming alliance is the caster's; effects with NO
 *      caster team (GM/table-tempo-free) tick once per game turn on the FIRST
 *      active alliance: DoT damage to the carrier, turnsLeft--, expire at 0.
 *   3. Ground zones: DoT to every unit standing on the zone when the caster's
 *      alliance (or the first-active alliance for tempo-free zones) activates;
 *      stat zones only expire at 0. Expired zones are removed and their
 *      membership effects restored on standing carriers.
 *   4. Units of the incoming alliance reconcile their ground-zone memberships at
 *      the start of their own activation (enter/leave the zone).
 * Returns unit sub-steps (ordered, one per affected unit) + the surviving zones.
 */
export function computeEndTurnEffects(ctx: EndTurnEffectsContext): EndTurnEffectsResult {
  const { units, zones, nextGroup, alliances, makeKey = newEffectKey, rng = Math.random } = ctx;
  const activeTeams = teamsOf(alliances, nextGroup);
  // GM/table-placed effects and zones have no caster team ("tempo-free"). They
  // should tick ONCE per game turn, not on every alliance's end-turn — anchor
  // them to the FIRST active alliance in the cycle (friendly if none assigned).
  const firstActive: AllianceGroup =
    (['friendly', 'enemy', 'neutral'] as const).find(g => teamsOf(alliances, g).size > 0) ?? 'friendly';
  const subSteps: SubStep[] = [];
  const zonesAfter = zones.map(z => ({ ...z }));
  const damageEvents: EffectDamageEvent[] = [];

  // Fold changes onto per-unit change lists so one sub-step per affected unit.
  type UnitDraft = { effects: UnitEffect[]; changes: UnitChange[]; hpChanged: boolean };
  const drafts = new Map<string, UnitDraft>();
  const draftFor = (u: Unit): UnitDraft => {
    let d = drafts.get(u.id);
    if (!d) {
      d = { effects: [...(u.effects ?? [])], changes: [], hpChanged: false };
      drafts.set(u.id, d);
    }
    return d;
  };
  const alive = (id?: string | null) => !id || units.some(u => u.id === id && !u.isDeleted);

  // --- 1 & 2: unit effects ---
  for (const unit of units) {
    if (unit.isDeleted) continue;
    const d = draftFor(unit);
    for (const e of d.effects) {
      // Ground-zone membership is handled by the zone + reconcile passes, never
      // ticked here (its life is the zone's).
      if (e.zoneHex) continue;
      if (!alive(e.casterUnitId)) {
        // Caster destroyed -> expire now (restore stat).
        const changes = removeEffectChanges({ ...unit, effects: d.effects }, e.key);
        for (const c of changes) d.changes.push(c);
        d.effects = d.effects.filter(x => x.key !== e.key);
        continue;
      }
      const casterActive = e.casterTeam ? activeTeams.has(e.casterTeam) : nextGroup === firstActive;
      if (!casterActive) continue;
      // Caster's activation start: tick.
      const ticked = tickDown(e);
      if (e.kind === 'dot') {
        const { changes, detail } = resolveEffectDamage(unit, e, rng);
        for (const c of changes) d.changes.push(c);
        d.hpChanged = true;
        damageEvents.push({ unitId: unit.id, unitName: unit.unitName, source: e.name, detail });
      }
      if (ticked.turnsLeft <= 0) {
        for (const c of removeEffectChanges({ ...unit, effects: d.effects }, e.key)) d.changes.push(c);
        d.effects = d.effects.filter(x => x.key !== e.key);
      } else {
        d.effects = d.effects.map(x => (x.key === e.key ? ticked : x));
      }
    }
  }

  // --- 3: ground zones tick/expire ---
  const removedZones: string[] = [];
  for (const zone of zonesAfter) {
    const casterActive = zone.casterTeam ? activeTeams.has(zone.casterTeam) : nextGroup === firstActive;
    const casterDead = zone.casterUnitId ? !alive(zone.casterUnitId) : false;
    if (!casterActive && !casterDead) continue;
    const zoneKey = zone.key;
    const standing = units.filter(u => !u.isDeleted && u.hex.q === zone.q && u.hex.r === zone.r);
    let surviving = zone;
    if (!casterDead) {
      // DoT lands every tick while the zone is alive.
      if (zone.kind === 'dot') {
        for (const u of standing) {
          const d = draftFor(u);
          const { changes, detail } = resolveEffectDamage(u, zone, rng);
          for (const c of changes) { d.changes.push(c); d.hpChanged = true; }
          damageEvents.push({ unitId: u.id, unitName: u.unitName, source: zone.name, detail });
        }
      }
      surviving = { ...zone, turnsLeft: Math.max(0, zone.turnsLeft - 1) };
    }
    if (casterDead || surviving.turnsLeft <= 0) {
      removedZones.push(zoneKey);
      // Expired: remove zone memberships from carriers standing on it (restore).
      for (const u of units) {
        if (u.isDeleted) continue;
        const mem = (u.effects ?? []).find(e => e.zoneHex && e.key === zoneKey);
        if (!mem) continue;
        const d = draftFor(u);
        for (const c of removeEffectChanges({ ...u, effects: d.effects }, zoneKey)) d.changes.push(c);
        d.effects = d.effects.filter(x => x.key !== zoneKey);
      }
    } else {
      // Survived the tick — keep the decremented zone.
      const idx = zonesAfter.findIndex(z => z.key === zoneKey);
      if (idx >= 0) zonesAfter[idx] = surviving;
    }
  }
  const finalZones = zonesAfter.filter(z => !removedZones.includes(z.key));

  // --- 4: membership reconcile at the unit's own activation start ---
  for (const unit of units) {
    if (unit.isDeleted || !activeTeams.has(unit.team)) continue;
    const d = draftFor(unit);
    const zonesAt = finalZones.filter(z => z.q === unit.hex.q && z.r === unit.hex.r);
    const zoneKeysAt = new Set(zonesAt.map(z => z.key));
    // Drop memberships whose zone is gone or whose hex no longer matches.
    for (const e of [...d.effects]) {
      if (!e.zoneHex) continue;
      const still = zoneKeysAt.has(e.key) && e.zoneHex.q === unit.hex.q && e.zoneHex.r === unit.hex.r;
      if (!still) {
        for (const c of removeEffectChanges({ ...unit, effects: d.effects }, e.key)) d.changes.push(c);
        d.effects = d.effects.filter(x => x.key !== e.key);
      }
    }
    // Create membership for each stat zone underfoot (skips stacking conflicts).
    for (const z of zonesAt) {
      if (z.kind === 'dot') continue;
      const already = d.effects.some(e => e.zoneHex && e.key === z.key) || d.effects.some(e => e.kind === z.kind);
      if (already) continue;
      const membership: UnitEffect = {
        key: z.key,
        zoneHex: { q: unit.hex.q, r: unit.hex.r, s: -unit.hex.q - unit.hex.r },
        name: z.name,
        color: z.color,
        kind: z.kind,
        delta: z.delta,
        duration: z.duration,
        turnsLeft: z.turnsLeft,
        casterUnitId: z.casterUnitId,
        casterTeam: z.casterTeam,
        casterPlayerId: z.casterPlayerId,
        base: isStatEffect(z.kind) ? statValue(unit, z.kind) : undefined,
      };
      const field = statFieldOf(z.kind);
      if (field) {
        d.changes.push({ field, from: unit[field], to: statValue(unit, z.kind) + z.delta });
      }
      d.effects.push(membership);
    }
  }

  // Emit one sub-step per affected unit (skip pure effects-list no-ops). Effects
  // changes are collapsed into a SINGLE from-original -> to-final change so undo
  // never restores an intermediate draft array.
  drafts.forEach((draft, unitId) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    const originalEffects = unit.effects ?? [];
    const statChanges = draft.changes.filter(c => c.field !== 'effects');
    const effChanged = !sameEffects(originalEffects, draft.effects);
    const finalChanges: UnitChange[] = effChanged
      ? [{ field: 'effects', from: originalEffects, to: draft.effects }, ...statChanges]
      : statChanges;
    if (finalChanges.length === 0) return;
    const kind = draft.hpChanged || finalChanges.some(c => c.field === 'currentUnitHp') ? 'DoT' : 'effect';
    subSteps.push({
      type: 'EFFECT',
      description: `${unit.unitName} — ${kind} resolved at the start of the ${nextGroup} turn`,
      unitId,
      changes: finalChanges,
    });
  });

  return { subSteps, zonesAfter: finalZones, damageEvents };
}

function sameEffects(a: UnitEffect[], b: UnitEffect[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.key === y.key && x.turnsLeft === y.turnsLeft && x.base === y.base && x.zoneHex?.q === y.zoneHex?.q && x.zoneHex?.r === y.zoneHex?.r;
  });
}

/** All active ground zones' stat kinds at a hex (used for tooltips/tests). */
export function zonesAt(zones: GroundEffect[], hex: { q: number; r: number }): GroundEffect[] {
  return zones.filter(z => z.q === hex.q && z.r === hex.r);
}

// --- Effect catalog (in-code templates the apply UI offers; magnitude/duration
// are overridable at apply time). ---
export interface EffectTemplate {
  id: string;
  name: string;
  color: string;
  kind: EffectKind;
  defaultDelta: number;
  defaultDuration: number;
  description: string;
}

export const EFFECT_TEMPLATES: EffectTemplate[] = [
  { id: 'bless', name: 'Bless', color: '#ffd54d', kind: 'ac', defaultDelta: 2, defaultDuration: 3, description: '+2 AC' },
  { id: 'bane', name: 'Bane', color: '#ff8a65', kind: 'ac', defaultDelta: -2, defaultDuration: 3, description: '-2 AC' },
  { id: 'haste', name: 'Haste', color: '#a5d6a7', kind: 'movement', defaultDelta: 2, defaultDuration: 3, description: '+2 movement hexes' },
  { id: 'slow', name: 'Slow', color: '#9e9d24', kind: 'movement', defaultDelta: -2, defaultDuration: 3, description: '-2 movement hexes' },
  { id: 'rally', name: 'Rally', color: '#4fc3f7', kind: 'morale', defaultDelta: 3, defaultDuration: 3, description: '+3 morale' },
  { id: 'fear', name: 'Fear', color: '#9575cd', kind: 'morale', defaultDelta: -3, defaultDuration: 3, description: '-3 morale' },
  { id: 'burn', name: 'Burning', color: '#ff7043', kind: 'dot', defaultDelta: 4, defaultDuration: 3, description: '4 damage each tick' },
  { id: 'regen', name: 'Regen', color: '#81c784', kind: 'dot', defaultDelta: -4, defaultDuration: 3, description: 'heal 4 each tick' },
];

export function templateById(id: string): EffectTemplate | undefined {
  return EFFECT_TEMPLATES.find(t => t.id === id);
}
