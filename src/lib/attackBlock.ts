// src/lib/attackBlock.ts
// Hard "block attacks" gate for a temporary effect / ground zone / structure.
//
// A `block_attacks` modifier denies attacks crossing into or out of its carrier,
// scoped by `mode` (melee/ranged; absent = both) and `direction` (in/out/both;
// absent = both). On a WALL the block stops attacks THROUGH the edge only, and
// IN/OUT is relative to the placement: IN = outside->inside, OUT = inside->outside.
// Healing is not affected. AoE magic casts are out of scope (separate path).
import { Unit, GroundEffect } from '@/types/gameProtocol';
import { edgeRef, directionBetween } from './walls';
import { MapStructures, instanceModifiers } from './mapStructures';
import { StructureTemplate } from '@/types/structure';
import { EffectModifier } from './effectTemplates';
import { hexEnteringFrom } from './hexLine';

export interface BlockAttackCtx {
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  zones?: GroundEffect[];
}

type Mode = 'melee' | 'ranged';

const modeOk = (m: EffectModifier, mode: Mode): boolean => m.kind === 'block_attacks' && (m.mode === undefined || m.mode === mode);

/** Does any modifier block entering (wantIn) or leaving this surface? */
function blocksList(mods: EffectModifier[], mode: Mode, wantIn: boolean): boolean {
  return mods.some(m => modeOk(m, mode) && coversDirection(m.direction, wantIn));
}

function coversDirection(direction: EffectModifier['direction'], wantIn: boolean): boolean {
  if (direction === undefined || direction === 'both') return true;
  return wantIn ? direction === 'in' : direction === 'out';
}

/** Effects/zone/hex-structure blocking onto (in) or out of (out) a hex. */
function hexBlocks(hex: { q: number; r: number }, mode: Mode, wantIn: boolean, ctx: BlockAttackCtx): boolean {
  const zones = (ctx.zones ?? []).filter(z => z.q === hex.q && z.r === hex.r);
  if (blocksList(zones as unknown as EffectModifier[], mode, wantIn)) return true;
  const inst = ctx.structures?.[`${hex.q},${hex.r}`];
  if (inst) {
    const t = ctx.templates?.[inst.templateId];
    if (blocksList(instanceModifiers(inst, t), mode, wantIn)) return true;
  }
  return false;
}

/** A wall on the crossed edge blocking the shot/step through it. */
function edgeBlocks(attacker: { q: number; r: number }, target: { q: number; r: number }, isRanged: boolean, mode: Mode, ctx: BlockAttackCtx): boolean {
  const from = isRanged ? (hexEnteringFrom(attacker as any, target as any) ?? attacker) : attacker;
  const dir = directionBetween(from, target);
  if (dir < 0) return false;
  const ref = edgeRef(from.q, from.r, dir);
  const inst = ctx.structures?.[ref.key];
  if (!inst) return false;
  const t = ctx.templates?.[inst.templateId];
  const mods = instanceModifiers(inst, t);
  if (!mods.some(m => modeOk(m, mode))) return false;
  const outside = inst.outside ?? 'a';
  const fromIsA = ref.aq === from.q && ref.ar === from.r;
  const crossingIn = (fromIsA ? 'a' : 'b') === outside; // outside -> inside
  return mods.some(m => modeOk(m, mode) && (m.direction === undefined || m.direction === 'both' || (crossingIn ? m.direction === 'in' : m.direction === 'out')));
}

/**
 * True when an attack `attacker -> target` (melee when `isRanged` false) is
 * blocked by a `block_attacks` effect, ground zone or structure.
 */
export function attacksBlocked(attacker: Unit, target: Unit, isRanged: boolean, ctx: BlockAttackCtx = {}): boolean {
  const mode: Mode = isRanged ? 'ranged' : 'melee';
  const attackerMods = (attacker.effects ?? []) as unknown as EffectModifier[];
  const targetMods = (target.effects ?? []) as unknown as EffectModifier[];
  // Outgoing attacks made from the attacker's carrier / hex.
  if (blocksList(attackerMods, mode, false)) return true;
  if (hexBlocks(attacker.hex, mode, false, ctx)) return true;
  // Incoming attacks targeting the target's carrier / hex.
  if (blocksList(targetMods, mode, true)) return true;
  if (hexBlocks(target.hex, mode, true, ctx)) return true;
  // Through a wall on the crossed edge.
  return edgeBlocks(attacker.hex, target.hex, isRanged, mode, ctx);
}
