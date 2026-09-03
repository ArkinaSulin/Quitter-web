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

/** The real unit field a stat kind modifies (dot has none — it damages HP). */
export function statFieldOf(kind: EffectKind): 'currentAc' | 'currentMoraleModifier' | 'movementPoints' | null {
  switch (kind) {
    case 'ac': return 'currentAc';
    case 'morale': return 'currentMoraleModifier';
    case 'movement': return 'movementPoints';
    case 'dot': return null;
  }
}

export function isStatEffect(kind: EffectKind): boolean {
  return kind !== 'dot';
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
  return changes;
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
}

export interface EndTurnEffectsResult {
  /** Unit sub-steps to fold into the END_TURN command (before the refresh steps). */
  subSteps: SubStep[];
  /** Ground zones after ticks/expiry — persist to scenarios.map_data. */
  zonesAfter: GroundEffect[];
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
 *   2. Effects whose caster is in the incoming alliance tick: DoT damage to the
 *      carrier, turnsLeft--, expire at 0 (stat restored).
 *   3. Ground zones with a caster in the incoming alliance tick: DoT damage to
 *      every unit standing on the zone; stat zones only expire at 0. Expired zones
 *      are removed and their membership effects restored on standing carriers.
 *   4. Units of the incoming alliance reconcile their ground-zone memberships at
 *      the start of their own activation (enter/leave the zone).
 * Returns unit sub-steps (ordered, one per affected unit) + the surviving zones.
 */
export function computeEndTurnEffects(ctx: EndTurnEffectsContext): EndTurnEffectsResult {
  const { units, zones, nextGroup, alliances, makeKey = newEffectKey } = ctx;
  const activeTeams = teamsOf(alliances, nextGroup);
  const subSteps: SubStep[] = [];
  const zonesAfter = zones.map(z => ({ ...z }));

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
      const casterActive = e.casterTeam ? activeTeams.has(e.casterTeam) : true;
      if (!casterActive) continue;
      // Caster's activation start: tick.
      const ticked = tickDown(e);
      if (e.kind === 'dot') {
        for (const c of dotDamageChanges(unit, e.delta)) d.changes.push(c);
        d.hpChanged = true;
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
    const casterActive = zone.casterTeam ? activeTeams.has(zone.casterTeam) : true;
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
          for (const c of dotDamageChanges(u, zone.delta)) { d.changes.push(c); d.hpChanged = true; }
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

  return { subSteps, zonesAfter: finalZones };
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
