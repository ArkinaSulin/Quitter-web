// src/lib/mapStructures.ts
// Placed map structures (instances) on the library/scenario map layers, keyed by
// anchor: "q,r,dir" for an edge structure, "q,r" for a hex structure. Values are
// StructureInstance (template id + optional runtime overrides).
//
// Edge structures are converted to the runtime `Walls` shape (the movement/combat/
// render model). Movement is direction-relative: the template's `_in` fields apply
// crossing OUTSIDE->INSIDE, `_out` the reverse, mapped onto the canonical edge
// sides by the instance `outside` flag. Durability is two pools (door gates
// passage, HP gates modifiers). Modifiers may be overridden per instance.
import { Walls, Wall, WallFace, edgeRef, directionBetween } from './walls';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { EffectModifier, modifierAmount } from '@/lib/effectTemplates';
import { templateDoorMax } from '@/lib/structureTemplates';
import { GroundEffect, Unit, getOrganizationLevel } from '@/types/gameProtocol';
import { formationAtOrBelow } from '@/lib/formationCost';

export type MapStructures = Record<string, StructureInstance>;

const EDGE_KEY = /^-?\d+,-?\d+,[0-5]$/;
const HEX_KEY = /^-?\d+,-?\d+$/;

export function isEdgeStructureKey(key: string): boolean {
  return EDGE_KEY.test(key);
}

export function isHexStructureKey(key: string): boolean {
  return !isEdgeStructureKey(key) && HEX_KEY.test(key);
}

const intOr = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.round(v));
};

/** Sanitize the jsonb structures blob into a MapStructures record. */
export function parseStructures(raw: any): MapStructures {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: MapStructures = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!isEdgeStructureKey(key) && !isHexStructureKey(key)) continue;
    if (!v || typeof v !== 'object') continue;
    const templateId = (v as any).templateId;
    if (typeof templateId !== 'string' || !templateId) continue;
    const inst: StructureInstance = { templateId };
    const hp = intOr((v as any).hp); if (hp !== undefined) inst.hp = hp;
    const doorHp = intOr((v as any).doorHp); if (doorHp !== undefined) inst.doorHp = doorHp;
    const outside = (v as any).outside;
    if (outside === 'a' || outside === 'b') inst.outside = outside;
    if ((v as any).open === true) inst.open = true;
    if (Array.isArray((v as any).modifiers)) inst.modifiers = (v as any).modifiers as EffectModifier[];
    out[key] = inst;
  }
  return out;
}

/** The modifier list a placed instance actually uses (override else template). */
export function instanceModifiers(inst: StructureInstance | null | undefined, t: StructureTemplate | null | undefined): EffectModifier[] {
  return inst?.modifiers ?? t?.modifiers ?? [];
}

/** Current door pool of a placed instance (null door defaults to maxHp). */
export function instanceDoorState(inst: StructureInstance, t: StructureTemplate): { doorMax: number; doorHp: number; open: boolean; standing: boolean } {
  const doorMax = templateDoorMax(t);
  const doorHp = inst.doorHp ?? doorMax;
  const open = inst.open === true;
  return { doorMax, doorHp, open, standing: !open && doorHp > 0 };
}

/**
 * Instance-relative door state. Damage reduces BOTH the door pool and the
 * structure HP together, so "no door" is `doorNow >= hpNow` (equal stays equal
 * through equal damage) — comparing to the template max would falsely turn a
 * no-door structure into "has a door" once damaged.
 */
export interface StructureDoorState {
  hpNow: number;
  doorNow: number;
  noDoor: boolean;
  hasDoor: boolean;
  /** Toggleable: a real door with `0 < doorNow < hpNow`. */
  intact: boolean;
  open: boolean;
  /** Open or broken (`doorNow <= 0`): crossable at BASE cost. */
  openOrBroken: boolean;
}

export function structureDoorState(inst: StructureInstance, t: StructureTemplate): StructureDoorState {
  const hpNow = inst.hp ?? t.maxHp;
  const doorNow = inst.doorHp ?? templateDoorMax(t);
  const open = inst.open === true;
  const noDoor = doorNow >= hpNow;
  return {
    hpNow,
    doorNow,
    noDoor,
    hasDoor: !noDoor,
    intact: doorNow > 0 && doorNow < hpNow,
    open,
    openOrBroken: open || doorNow <= 0,
  };
}

/** The hex a structure's DOOR belongs to: hex structure = its hex; edge = the
 *  INSIDE hex (opposite the instance's `outside`). */
export function structureDoorHex(key: string, inst: StructureInstance): { q: number; r: number } | null {
  if (isHexStructureKey(key)) {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  }
  if (!isEdgeStructureKey(key)) return null;
  const [q, r, dir] = key.split(',').map(Number);
  const ref = edgeRef(q, r, dir);
  const outsideIsA = (inst.outside ?? 'a') === 'a';
  return outsideIsA ? { q: ref.bq, r: ref.br } : { q: ref.aq, r: ref.ar };
}

/**
 * May this viewer toggle the door? Only a structure with an INTACT door, and
 * only the DM or the owner of the unit on the door hex (on that unit's turn,
 * via `canControlUnit`). Dynamic — lost as soon as the unit leaves.
 */
export function canToggleStructureDoor(
  key: string,
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  units: Unit[],
  isGM: boolean,
  canControlUnit: (u: Unit) => boolean,
): boolean {
  const inst = structures?.[key];
  if (!inst) return false;
  const t = templates?.[inst.templateId];
  if (!t) return false;
  if (!structureDoorState(inst, t).intact) return false;
  if (isGM) return true;
  const hex = structureDoorHex(key, inst);
  if (!hex) return false;
  const unit = units.find(u => !u.isDeleted && u.hex.q === hex.q && u.hex.r === hex.r);
  return !!unit && canControlUnit(unit);
}

/**
 * Occupied hexes that may be TRAVERSED (entered, not stopped on) because a hex
 * structure there has a door that is open/broken and the structure still stands.
 */
export function doorPassThroughHexes(
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  occupied: Set<string>,
): Set<string> {
  const out = new Set<string>();
  if (!structures) return out;
  for (const [key, inst] of Object.entries(structures)) {
    if (!isHexStructureKey(key) || !occupied.has(key)) continue;
    const t = templates?.[inst.templateId];
    if (!t) continue;
    const st = structureDoorState(inst, t);
    if (st.hpNow > 0 && st.hasDoor && st.openOrBroken) out.add(key);
  }
  return out;
}

/** AC (melee / ranged) a template's `ac` modifiers grant across its edge. */
function coverAc(mods: EffectModifier[]): { melee: number; ranged: number } {
  let melee = 0;
  let ranged = 0;
  for (const m of mods) {
    if (m.kind !== 'ac') continue;
    const d = modifierAmount(m.dice);
    if (m.mode === 'melee') melee += d;
    else if (m.mode === 'ranged') ranged += d;
    else { melee += d; ranged += d; }
  }
  return { melee, ranged };
}

/** One template side -> a runtime wall face. When the door is open/broken the
 *  crossing cost is WAIVED (falls back to the destination hex's MP). */
function faceFromTemplate(t: StructureTemplate, mods: EffectModifier[], which: 'inside' | 'outside', openOrBroken: boolean): WallFace {
  const foot = which === 'inside' ? t.mpFootIn : t.mpFootOut;
  const mounted = which === 'inside' ? t.mpMountedIn : t.mpMountedOut;
  const ac = coverAc(mods);
  const f: WallFace = {};
  if (!openOrBroken) {
    if (foot !== null && foot !== undefined) f.moveCostFoot = foot;
    if (mounted !== null && mounted !== undefined) f.moveCostMounted = mounted;
  }
  if (ac.melee) f.meleeAc = ac.melee;
  if (ac.ranged) f.rangedAc = ac.ranged;
  return f;
}

/**
 * Derive the runtime `Walls` map from edge structures. `outside` chooses which
 * canonical side is the outside: template `_in` applies crossing into the inside
 * face, `_out` into the outside face. Durability/door come from the instance.
 */
export function structuresToWalls(
  structures: MapStructures,
  templates: Record<string, StructureTemplate>,
): Walls {
  const walls: Walls = {};
  for (const [key, inst] of Object.entries(structures)) {
    if (!isEdgeStructureKey(key)) continue;
    const t = templates[inst.templateId];
    if (!t) continue;
    const [q, r, dir] = key.split(',').map(Number);
    const ref = edgeRef(q, r, dir);
    const mods = instanceModifiers(inst, t);
    const outsideIsA = (inst.outside ?? 'a') === 'a';
    const st = structureDoorState(inst, t);
    // Face A (canonical hex): inside when outsideIsA? No — outsideIsA means the
    // canonical face IS the outside, so its cost is the `_out` ("enter outside").
    const aFace = outsideIsA ? faceFromTemplate(t, mods, 'outside', st.openOrBroken) : faceFromTemplate(t, mods, 'inside', st.openOrBroken);
    const bFace = outsideIsA ? faceFromTemplate(t, mods, 'inside', st.openOrBroken) : faceFromTemplate(t, mods, 'outside', st.openOrBroken);
    const maxHp = t.maxHp;
    const door = instanceDoorState(inst, t);
    const wall: Wall = { a: aFace, b: bFace, source: 'map' };
    if (maxHp > 0) {
      wall.maxHp = maxHp;
      wall.hp = inst.hp ?? maxHp;
      wall.dt = t.dt;
    }
    if (door.doorMax > 0) {
      wall.doorHp = door.doorHp;
      wall.doorMax = door.doorMax;
      if (door.open) wall.open = true;
    }
    walls[ref.key] = wall;
  }
  return walls;
}

/** Count edge/hex structures (for the editor summary). */
export function structureCounts(s: MapStructures): { edges: number; hexes: number } {
  let edges = 0;
  let hexes = 0;
  for (const key of Object.keys(s)) {
    if (isEdgeStructureKey(key)) edges++;
    else if (isHexStructureKey(key)) hexes++;
  }
  return { edges, hexes };
}

/** True when a structure's modifiers gate entry for a unit of this org level
 *  (`max_org_level_allowed`: only formations with org level <= value may enter). */
export function structureBlocksOrg(t: StructureTemplate | null | undefined, orgLevel: number, inst?: StructureInstance | null): boolean {
  return instanceModifiers(inst, t).some(m => m.kind === 'max_org_level_allowed' && orgLevel > modifierAmount(m.dice));
}

/** True when a ground zone on (q,r) gates entry for this org level. */
export function zoneBlocksOrg(zones: GroundEffect[] | null | undefined, q: number, r: number, orgLevel: number): boolean {
  if (!zones) return false;
  return zones.some(z => z.q === q && z.r === r && z.kind === 'max_org_level_allowed' && orgLevel > modifierAmount(z.dice));
}

/** One `max_org_level_allowed` gate governing entry into a hex, with its verdict for a
 *  mover of a given organization level (`passes` = orgLevel <= max). */
export interface OrgGateCheck {
  source: 'zone' | 'hex structure' | 'edge structure';
  name: string;
  max: number;
  passes: boolean;
}

/**
 * Enumerate every `max_org_level_allowed` gate that governs entering `toHex` from
 * `fromHex`, mirroring `makeBlockedEdge`: an edge structure on the crossed edge
 * (only when the two hexes are adjacent), a hex structure on the destination
 * hex, and any ground zone there. Empty when nothing gates the entry. Used to
 * explain a move that was rejected as unreachable.
 */
export function orgGatesForEntry(
  fromHex: { q: number; r: number },
  toHex: { q: number; r: number },
  orgLevel: number,
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  zones: GroundEffect[] | null | undefined,
): OrgGateCheck[] {
  const out: OrgGateCheck[] = [];
  const push = (source: OrgGateCheck['source'], name: string, dice: string | undefined) => {
    const max = modifierAmount(dice);
    out.push({ source, name, max, passes: orgLevel <= max });
  };
  const dir = directionBetween(fromHex, toHex);
  if (dir >= 0 && structures) {
    const ref = edgeRef(fromHex.q, fromHex.r, dir);
    const edgeInst = structures[ref.key];
    if (edgeInst) {
      const t = templates?.[edgeInst.templateId];
      for (const m of instanceModifiers(edgeInst, t)) if (m.kind === 'max_org_level_allowed') push('edge structure', t?.name ?? edgeInst.templateId, m.dice);
    }
  }
  const hexInst = structures?.[`${toHex.q},${toHex.r}`];
  if (hexInst) {
    const t = templates?.[hexInst.templateId];
    for (const m of instanceModifiers(hexInst, t)) if (m.kind === 'max_org_level_allowed') push('hex structure', t?.name ?? hexInst.templateId, m.dice);
  }
  if (zones) {
    for (const z of zones) if (z.q === toHex.q && z.r === toHex.r && z.kind === 'max_org_level_allowed') push('zone', z.name, z.dice);
  }
  return out;
}

/**
 * Explain a move that failed because of an `max_org_level_allowed` gate. Returns null
 * when no gate blocks (the caller falls back to the generic unreachable message).
 * `plain` is the normal-mode line naming the first blocking gate; `verbose` is
 * the per-test breakdown (lines are `✗`/`✓`-prefixed so the messages panel can
 * tint the failing ones).
 */
export function describeOrgGateBlock(
  unitName: string,
  formation: string,
  orgLevel: number,
  toHex: { q: number; r: number },
  verb: string,
  gates: OrgGateCheck[],
): { plain: string; verbose: string } | null {
  const blocked = gates.filter(g => !g.passes);
  if (blocked.length === 0) return null;
  const first = blocked[0];
  const label = first.name || first.source;
  const plain = `${unitName} cannot ${verb} (${toHex.q}, ${toHex.r}) — ${formation} (org level ${orgLevel}) exceeds the ${label} gate (org ≤ ${first.max})`;
  const verbose = [
    `${unitName} (${formation}, org level ${orgLevel}) — ${verb} (${toHex.q}, ${toHex.r}) blocked by organization gate:`,
    ...gates.map(g => {
      const tag = g.source + (g.name ? ` "${g.name}"` : '');
      return `${g.passes ? '✓' : '✗'} ${tag}: org ≤ ${g.max}${g.passes ? '' : ` (level ${orgLevel} exceeds)`}`;
    }),
  ].join('\n');
  return { plain, verbose };
}

/**
 * The formation to break to when entering `toHex` from `fromHex`, or null when
 * no `max_org_level_allowed` gate is exceeded. The strictest cap across every
 * governing gate (edge structure on the crossed edge, hex structure on the
 * destination, and any ground zone there) wins; the unit breaks to the highest
 * formation at or below that cap.
 */
export function entryBreakFormation(
  fromHex: { q: number; r: number },
  toHex: { q: number; r: number },
  currentFormation: string,
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  zones: GroundEffect[] | null | undefined,
): string | null {
  const orgLevel = getOrganizationLevel(currentFormation);
  const gates = orgGatesForEntry(fromHex, toHex, orgLevel, structures, templates, zones);
  if (gates.length === 0) return null;
  const minMax = Math.min(...gates.map(g => g.max));
  if (orgLevel <= minMax) return null;
  return formationAtOrBelow(currentFormation, minMax);
}

/**
 * The persistent org cap a unit must respect while STANDING on `hex`: the
 * strictest `max_org_level_allowed` across the hex structure there and any
 * ground zone there (edge structures are a one-time crossing gate, not a
 * standing cap). Returns Infinity when nothing caps the hex.
 */
export function standingMaxOrg(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  zones: GroundEffect[] | null | undefined,
): number {
  let cap = Infinity;
  const hexInst = structures?.[`${hex.q},${hex.r}`];
  if (hexInst) {
    const t = templates?.[hexInst.templateId];
    for (const m of instanceModifiers(hexInst, t)) {
      if (m.kind === 'max_org_level_allowed') cap = Math.min(cap, modifierAmount(m.dice));
    }
  }
  if (zones) {
    for (const z of zones) {
      if (z.q === hex.q && z.r === hex.r && z.kind === 'max_org_level_allowed') {
        cap = Math.min(cap, modifierAmount(z.dice));
      }
    }
  }
  return cap;
}

/** The hex structure instance at a hex (keyed "q,r"), if any. */
export function hexStructureAt(
  structures: MapStructures | null | undefined,
  hex: { q: number; r: number },
): StructureInstance | null {
  return structures?.[`${hex.q},${hex.r}`] ?? null;
}

/**
 * Attack-roll flags a unit standing on a hex structure gains from its effect
 * modifiers (tower auras). `advantage`/`disadvantage` affect the occupant's own
 * attacks; `grant_advantage`/`grant_disadvantage` affect attackers targeting it.
 */
export interface StructureAuraFlags {
  advantage: boolean;
  disadvantage: boolean;
  grantAdvantage: boolean;
  grantDisadvantage: boolean;
}

export function structureAuraFlags(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
): StructureAuraFlags {
  const flags: StructureAuraFlags = { advantage: false, disadvantage: false, grantAdvantage: false, grantDisadvantage: false };
  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  for (const m of instanceModifiers(inst, t)) {
    if (m.kind === 'advantage') flags.advantage = true;
    else if (m.kind === 'disadvantage') flags.disadvantage = true;
    else if (m.kind === 'grant_advantage') flags.grantAdvantage = true;
    else if (m.kind === 'grant_disadvantage') flags.grantDisadvantage = true;
  }
  return flags;
}

/** True when any aura flag is set. */
export function hasAuraFlags(f: StructureAuraFlags): boolean {
  return f.advantage || f.disadvantage || f.grantAdvantage || f.grantDisadvantage;
}

/**
 * Expand every HEX structure's modifiers into PERMANENT ground zones so the one
 * ground-effect runtime engine applies them (membership auras, `range`, `ac`,
 * `block_attacks`, `max_org_level_allowed`, entry/dot). Edge structures have no hex-zone
 * equivalent (their effects are per-crossing) and stay on the edge path.
 */
export function structureZones(
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
): import('@/types/gameProtocol').GroundEffect[] {
  const out: import('@/types/gameProtocol').GroundEffect[] = [];
  if (!structures) return out;
  for (const [key, inst] of Object.entries(structures)) {
    if (!isHexStructureKey(key)) continue;
    const t = templates?.[inst.templateId];
    if (!t) continue;
    const [q, r] = key.split(',').map(Number);
    instanceModifiers(inst, t).forEach((m, i) => {
      out.push({
        key: `struct-${key}-${i}`,
        q,
        r,
        name: t.name,
        color: t.color,
        ...(t.imageUrl ? { imageUrl: t.imageUrl } : {}),
        kind: m.kind as import('@/types/gameProtocol').GroundEffect['kind'],
        ...(m.dice ? { dice: m.dice } : {}),
        ...(m.healing ? { healing: true } : {}),
        ...(m.savingThrow ? { savingThrow: m.savingThrow } : {}),
        ...(m.saveDC !== undefined ? { saveDC: m.saveDC } : {}),
        ...(m.onSaveHalfOrNeg !== undefined ? { onSaveHalfOrNeg: m.onSaveHalfOrNeg } : {}),
        ...(m.mode ? { mode: m.mode } : {}),
        ...(m.direction ? { direction: m.direction } : {}),
        permanent: true,
        duration: 0,
        turnsLeft: 0,
        casterUnitId: null,
        casterTeam: null,
        casterPlayerId: null,
      });
    });
  }
  return out;
}

/** Open/closed state of a hex structure (edge structures are never "open"). */
export function structureIsOpen(inst: StructureInstance | null | undefined): boolean {
  return inst?.open === true;
}

/**
 * MP to ENTER this hex from a hex structure (replace semantics). Returns
 * `undefined` when there is no structure or no configured cost (caller falls
 * back to terrain). A standing door does not block here — see `structureHexBlocked`.
 */
export function structureHexEntryCost(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  isMounted: boolean,
): number | undefined {
  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  if (!inst || !t) return undefined;
  // Open/broken door → BASE hex MP. No door or intact door → the structure MP.
  if (structureDoorState(inst, t).openOrBroken) return undefined;
  const cost = isMounted ? t.mpMountedIn : t.mpFootIn;
  if (cost === null || cost === undefined || cost < 0) return undefined;
  return cost;
}

/**
 * True only when a hex structure HARD-BLOCKS entry (negative MP for the mover's
 * locomotion). Doors never gate hex entry: "If a unit can pay the structure's MP
 * and the hex is not occupied, it may enter — a closed door (0 < door_hp < max_hp)
 * is NOT a gate for hex structures; passage is governed by the structure MP, not
 * the base hex MP." Edge structures keep the door gate (see `isBlockedEdge`).
 */
export function structureHexBlocked(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  isMounted: boolean,
): boolean {
  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  if (!inst || !t) return false;
  const cost = isMounted ? t.mpMountedIn : t.mpFootIn;
  return cost !== null && cost !== undefined && cost < 0;
}

/** Weapon-range bonus (hexes) a unit standing on this hex gains from a structure. */
export function structureRangeBonus(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
): number {
  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  let sum = 0;
  for (const m of instanceModifiers(inst, t)) if (m.kind === 'range') sum += modifierAmount(m.dice);
  return sum;
}
