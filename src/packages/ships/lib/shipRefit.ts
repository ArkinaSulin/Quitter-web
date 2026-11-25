// src/packages/ships/lib/shipRefit.ts
// Pure dry-dock refit pricing. A refit is priced from the difference between
// the ship as it entered the dock and the edited design:
//   - removal labour: 100 gp per ton removed
//   - addition labour: 100 gp per ton added
//   - patch removal: 50 gp per patched HP
//   - repair: 100 gp per damaged HP
//   - equipment: each added part's cost per ton × tons added
//   - crew: one week of the added person's weekly cost
//   - cargo: added quantity × the ship_cargo catalog price
// Removed parts and people are never refunded.
//
// Equipment uses one rule for every part: cost per ton. Components and weapons
// derive it from their authored unit price and mass; armor authors it directly.

import {
  CargoCategory,
  ShipArmor,
  ShipCargoItem,
  ShipComponent,
  ShipTemplate,
  ShipWeapon,
} from '@/types/ship';
import {
  COMPONENT_NAMES,
  componentById,
  componentByName,
  roundTons,
} from './shipStats';
import {
  cargoUnitLabel,
  findShipCargoItem,
} from './cargoManifest';
import { computeShipPatchDamage } from './shipRepair';

export const REFIT_LABOUR_PER_TON = 100;
export const REFIT_PATCH_PER_HP = 50;
export const REFIT_REPAIR_PER_HP = 100;

export interface ShipRefitRates {
  labourPerTon: number;
  patchPerHp: number;
  repairPerHp: number;
}

export const DEFAULT_REFIT_RATES: ShipRefitRates = {
  labourPerTon: REFIT_LABOUR_PER_TON,
  patchPerHp: REFIT_PATCH_PER_HP,
  repairPerHp: REFIT_REPAIR_PER_HP,
};

export type ShipRefitLineKind =
  | 'labour_removal'
  | 'labour_addition'
  | 'labour_remove_patch'
  | 'repair'
  | 'equipment_component'
  | 'equipment_weapon'
  | 'equipment_armor'
  | 'crew'
  | 'cargo';

export interface ShipRefitLine {
  kind: ShipRefitLineKind;
  label: string;
  /** Price per unit (ton, HP, person, cargo unit). */
  rate: number;
  /** Tons, HP, people, or cargo units. */
  quantity: number;
  unit: string;
  subtotal: number;
  detail?: string;
}

export interface ShipRefitInvoice {
  lines: ShipRefitLine[];
  total: number;
  removedTons: number;
  addedTons: number;
  patchedHp: number;
  damageHp: number;
  warnings: string[];
}

export interface ShipRefitRepairState {
  currentHp: number;
  /** Lowest HP the ship reached before this dock visit. */
  minHp: number;
  maxHp: number;
}

export interface ShipRefitInput {
  before: ShipTemplate;
  after: ShipTemplate;
  armors: ShipArmor[];
  components: ShipComponent[];
  weapons: ShipWeapon[];
  cargoCatalog?: ShipCargoItem[];
  repair: ShipRefitRepairState;
  rates?: Partial<ShipRefitRates>;
}

/** Cost per ton for a component/weapon; zero-mass parts fall back to unit cost. */
export function partCostPerTon(part: { mass: number; cost: number }): number {
  const mass = Number(part.mass) || 0;
  const cost = Math.max(0, Number(part.cost) || 0);
  return mass > 0 ? cost / mass : 0;
}

/** Armor mass in whole tons, matching the ship mass breakdown. */
export function armorTons(totalMass: number, armor: ShipArmor | null | undefined): number {
  if (!armor) return 0;
  return roundTons(Math.max(0, totalMass) * Math.max(0, armor.massPct));
}

function roundGp(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function tone(tons: number): string {
  const rounded = Math.round(tons * 10) / 10;
  return `${rounded} ton${rounded === 1 ? '' : 's'}`;
}

function countMap<T extends { count: number }>(rows: T[], key: (row: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.count <= 0) continue;
    map.set(key(row), (map.get(key(row)) ?? 0) + row.count);
  }
  return map;
}

/** Keys present in either map; positive = added, negative = removed. */
function diffMaps(before: Map<string, number>, after: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const keys: string[] = [];
  before.forEach((_value, key) => { keys.push(key); });
  after.forEach((_value, key) => { if (!before.has(key)) keys.push(key); });
  for (const key of keys) {
    const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    if (delta !== 0) out.set(key, delta);
  }
  return out;
}

function armorById(armors: ShipArmor[], id: string): ShipArmor | null {
  return armors.find(armor => armor.id === id) ?? null;
}

/**
 * Build the itemized dry-dock invoice. The caller is responsible for blocking a
 * total-mass change and a destroyed hull; this function only prices the job.
 */
export function computeShipRefitInvoice(input: ShipRefitInput): ShipRefitInvoice {
  const rates: ShipRefitRates = { ...DEFAULT_REFIT_RATES, ...(input.rates ?? {}) };
  const before = input.before;
  const after = input.after;
  const components = input.components ?? [];
  const weapons = input.weapons ?? [];
  const armors = input.armors ?? [];
  const warnings: string[] = [];
  const lines: ShipRefitLine[] = [];
  let removedTons = 0;
  let addedTons = 0;

  if (before.totalMass !== after.totalMass) {
    warnings.push('Total ship mass changed; dry-dock refits must keep the declared mass.');
  }

  const addLabour = (tons: number, added: boolean, label: string) => {
    if (tons <= 0) return;
    if (added) addedTons += tons;
    else removedTons += tons;
    lines.push({
      kind: added ? 'labour_addition' : 'labour_removal',
      label,
      rate: rates.labourPerTon,
      quantity: Math.round(tons * 10) / 10,
      unit: 'ton',
      subtotal: roundGp(rates.labourPerTon * tons),
      detail: tone(tons),
    });
  };

  const addEquipment = (
    kind: ShipRefitLine['kind'],
    label: string,
    tons: number,
    part: { mass: number; cost: number; costPerTon?: number } | null,
    count = 1,
  ) => {
    if (tons <= 0 && count <= 0) return;
    if (!part) {
      warnings.push(`${label} was added but is missing from the catalog.`);
      return;
    }
    const authoredPerTon = Number(part.costPerTon ?? 0);
    const rate = authoredPerTon > 0 ? authoredPerTon : partCostPerTon(part);
    if (tons <= 0) {
      // Zero-mass part: charge its unit price directly.
      const unitCost = Math.max(0, Number(part.cost) || 0);
      if (unitCost <= 0 || count <= 0) return;
      lines.push({
        kind,
        label,
        rate: unitCost,
        quantity: count,
        unit: 'unit',
        subtotal: roundGp(unitCost * count),
      });
      return;
    }
    if (rate <= 0) return;
    const subtotal = roundGp(rate * tons);
    if (subtotal <= 0) return;
    lines.push({
      kind,
      label,
      rate: Math.round(rate * 100) / 100,
      quantity: Math.round(tons * 10) / 10,
      unit: 'ton',
      subtotal,
      detail: count > 0 ? `${count} × ${part.mass} ton` : tone(tons),
    });
  };

  // --- Armor ---------------------------------------------------------------
  const beforeArmor = armorById(armors, before.armorId);
  const afterArmor = armorById(armors, after.armorId);
  if ((before.armorId || '') !== (after.armorId || '')) {
    const removedArmorTons = armorTons(before.totalMass, beforeArmor);
    const addedArmorTons = armorTons(after.totalMass, afterArmor);
    addLabour(removedArmorTons, false, 'Labour — armor removal');
    addLabour(addedArmorTons, true, 'Labour — armor addition');
    if (addedArmorTons > 0 && afterArmor) {
      addEquipment(
        'equipment_armor',
        `Armor — ${afterArmor.name}`,
        addedArmorTons,
        { mass: addedArmorTons, cost: 0, costPerTon: afterArmor.costPerTon ?? 0 },
        0,
      );
    }
  }

  // --- Counted built-in fittings ------------------------------------------
  const builtIns: Array<{
    name: string;
    before: number;
    after: number;
    tonsOf: (component: ShipComponent) => number;
  }> = [
    {
      name: COMPONENT_NAMES.helm,
      before: before.helm,
      after: after.helm,
      tonsOf: component => component.mass,
    },
    {
      name: COMPONENT_NAMES.commandBridge,
      before: before.commandBridge,
      after: after.commandBridge,
      tonsOf: component => component.mass,
    },
    {
      name: COMPONENT_NAMES.sail,
      before: before.sails,
      after: after.sails,
      tonsOf: component => component.mass,
    },
    {
      name: COMPONENT_NAMES.rudder,
      before: before.rudders,
      after: after.rudders,
      tonsOf: component => component.mass,
    },
    {
      name: COMPONENT_NAMES.reinforcement,
      before: before.reinforcement,
      after: after.reinforcement,
      tonsOf: component => component.mass,
    },
  ];

  for (const row of builtIns) {
    const component = componentByName(components, row.name);
    const delta = row.after - row.before;
    if (delta === 0) continue;
    const tons = Math.abs(delta) * row.tonsOf(component);
    addLabour(tons, delta > 0, `Labour — ${row.name} ${delta > 0 ? 'addition' : 'removal'}`);
    if (delta > 0) {
      addEquipment(
        'equipment_component',
        `${row.name} ×${delta}`,
        tons,
        component,
        delta,
      );
    }
  }

  // Cargo hold and weapon capacity are authored tonnages, not counts.
  const cargoTonsDelta = Math.max(0, after.cargoArea) - Math.max(0, before.cargoArea);
  if (cargoTonsDelta !== 0) {
    addLabour(Math.abs(cargoTonsDelta), cargoTonsDelta > 0, `Labour — cargo hold ${cargoTonsDelta > 0 ? 'addition' : 'removal'}`);
    if (cargoTonsDelta > 0) {
      addEquipment(
        'equipment_component',
        'Cargo hold',
        cargoTonsDelta,
        componentByName(components, COMPONENT_NAMES.cargo),
      );
    }
  }
  const capacityTonsDelta = Math.max(0, after.weaponCapacity) - Math.max(0, before.weaponCapacity);
  if (capacityTonsDelta !== 0) {
    addLabour(
      Math.abs(capacityTonsDelta),
      capacityTonsDelta > 0,
      `Labour — weapon capacity ${capacityTonsDelta > 0 ? 'addition' : 'removal'}`,
    );
    if (capacityTonsDelta > 0) {
      addEquipment(
        'equipment_component',
        'Weapon capacity',
        capacityTonsDelta,
        componentByName(components, COMPONENT_NAMES.weaponCapacity),
      );
    }
  }

  // --- Placed weapons ------------------------------------------------------
  const beforeWeapons = countMap(before.weapons, row => row.weaponId);
  const afterWeapons = countMap(after.weapons, row => row.weaponId);
  for (const [weaponId, delta] of Array.from(diffMaps(beforeWeapons, afterWeapons).entries())) {
    const weapon = weapons.find(w => w.id === weaponId) ?? null;
    const count = Math.abs(delta);
    const tons = count * Math.max(0, weapon?.mass ?? 0);
    if (!weapon) warnings.push(`Weapon ${weaponId} is missing from the catalog.`);
    addLabour(tons, delta > 0, `Labour — weapon ${delta > 0 ? 'addition' : 'removal'}`);
    if (delta > 0) {
      addEquipment(
        'equipment_weapon',
        `${weapon?.name ?? 'Weapon'} ×${count}`,
        tons,
        weapon ? { mass: weapon.mass, cost: weapon.cost } : null,
        count,
      );
    }
  }

  // --- Optional components -------------------------------------------------
  const beforeOptional = countMap(before.optionalComponents, row => row.componentId);
  const afterOptional = countMap(after.optionalComponents, row => row.componentId);
  for (const [componentId, delta] of Array.from(diffMaps(beforeOptional, afterOptional).entries())) {
    const component = componentById(components, componentId);
    const count = Math.abs(delta);
    const tons = count * Math.max(0, component.mass);
    if (!component.id) warnings.push(`Component ${componentId} is missing from the catalog.`);
    addLabour(tons, delta > 0, `Labour — ${component.name || 'component'} ${delta > 0 ? 'addition' : 'removal'}`);
    if (delta > 0) {
      addEquipment(
        'equipment_component',
        `${component.name || 'Component'} ×${count}`,
        tons,
        component.id ? component : null,
        count,
      );
    }
  }

  // --- Crew ----------------------------------------------------------------
  const beforeCrew = new Map(before.crews.map(crew => [crew.id, crew]));
  const afterCrew = new Map(after.crews.map(crew => [crew.id, crew]));
  const addedCrew = after.crews.filter(crew => !beforeCrew.has(crew.id));
  const removedCrew = before.crews.filter(crew => !afterCrew.has(crew.id));
  if (removedCrew.length > 0) {
    // No refund and no removal fee: people are not ship parts.
    warnings.push(`${removedCrew.length} crew member${removedCrew.length === 1 ? '' : 's'} left the ship (no refund).`);
  }
  const crewGroups = new Map<string, { label: string; cost: number; count: number }>();
  for (const crew of addedCrew) {
    const label = crew.name?.trim() || `Level ${crew.level} crew`;
    const key = `${label}|${crew.level}|${crew.cost}`;
    const entry = crewGroups.get(key) ?? { label, cost: Math.max(0, crew.cost), count: 0 };
    entry.count += 1;
    crewGroups.set(key, entry);
  }
  for (const group of Array.from(crewGroups.values())) {
    if (group.cost <= 0) continue;
    lines.push({
      kind: 'crew',
      label: `Crew — ${group.label}`,
      rate: group.cost,
      quantity: group.count,
      unit: 'person',
      subtotal: roundGp(group.cost * group.count),
    });
  }

  // --- Cargo ---------------------------------------------------------------
  const cargoKey = (item: { category: CargoCategory; name: string }) =>
    `${item.category}|${item.name.trim().toLowerCase()}`;
  const beforeCargo = new Map<string, { category: CargoCategory; name: string; quantity: number }>();
  for (const item of before.manifest ?? []) {
    if (item.quantity <= 0) continue;
    const key = cargoKey(item);
    const entry = beforeCargo.get(key) ?? { category: item.category, name: item.name, quantity: 0 };
    entry.quantity += item.quantity;
    beforeCargo.set(key, entry);
  }
  for (const item of after.manifest ?? []) {
    if (item.quantity <= 0) continue;
    const key = cargoKey(item);
    const beforeQuantity = beforeCargo.get(key)?.quantity ?? 0;
    const addedQuantity = item.quantity - beforeQuantity;
    if (addedQuantity <= 0) continue;
    const catalogItem = findShipCargoItem(input.cargoCatalog, item.name);
    const unit = catalogItem?.unit || cargoUnitLabel(item.category);
    if (!catalogItem) {
      warnings.push(`No ship_cargo price for “${item.name}”; the cargo line is 0 gp.`);
      lines.push({
        kind: 'cargo',
        label: `Cargo — ${item.name}`,
        rate: 0,
        quantity: addedQuantity,
        unit,
        subtotal: 0,
        detail: 'unpriced — add it to ship_cargo',
      });
      continue;
    }
    lines.push({
      kind: 'cargo',
      label: `Cargo — ${catalogItem.name}`,
      rate: catalogItem.unitCost,
      quantity: addedQuantity,
      unit,
      subtotal: roundGp(catalogItem.unitCost * addedQuantity),
      detail: item.category !== catalogItem.category ? `catalog category ${catalogItem.category}` : undefined,
    });
  }

  // --- Patch removal and repair -------------------------------------------
  const repairState = computeShipPatchDamage(input.repair);
  const { currentHp, minHp, maxHp, patchedHp, damageHp } = repairState;

  if (patchedHp > 0) {
    lines.push({
      kind: 'labour_remove_patch',
      label: 'Labour — remove field patch',
      rate: rates.patchPerHp,
      quantity: patchedHp,
      unit: 'HP',
      subtotal: roundGp(rates.patchPerHp * patchedHp),
      detail: `${currentHp} current − ${minHp} worst`,
    });
  }
  if (damageHp > 0) {
    lines.push({
      kind: 'repair',
      label: 'Repair — structural damage',
      rate: rates.repairPerHp,
      quantity: damageHp,
      unit: 'HP',
      subtotal: roundGp(rates.repairPerHp * damageHp),
      detail: `${maxHp} max − ${minHp} worst`,
    });
  }

  // --- Labour summary lines ------------------------------------------------
  const summary: ShipRefitLine[] = [];
  if (removedTons > 0) {
    summary.push({
      kind: 'labour_removal',
      label: 'Labour — removal',
      rate: rates.labourPerTon,
      quantity: Math.round(removedTons * 10) / 10,
      unit: 'ton',
      subtotal: roundGp(rates.labourPerTon * removedTons),
    });
  }
  if (addedTons > 0) {
    summary.push({
      kind: 'labour_addition',
      label: 'Labour — addition',
      rate: rates.labourPerTon,
      quantity: Math.round(addedTons * 10) / 10,
      unit: 'ton',
      subtotal: roundGp(rates.labourPerTon * addedTons),
    });
  }

  // Remove the per-part labour lines; the two summary lines replace them so the
  // invoice reads as requested (removal / addition totals).
  const equipmentAndRest = lines.filter(line =>
    line.kind !== 'labour_removal' && line.kind !== 'labour_addition');
  const allLines = [...summary, ...equipmentAndRest];
  const total = roundGp(allLines.reduce((sum, line) => sum + line.subtotal, 0));

  return {
    lines: allLines,
    total,
    removedTons: Math.round(removedTons * 10) / 10,
    addedTons: Math.round(addedTons * 10) / 10,
    patchedHp,
    damageHp,
    warnings: Array.from(new Set(warnings)),
  };
}
