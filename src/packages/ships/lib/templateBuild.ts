// Builds the runtime ShipBuild input from an authored ShipTemplate. Shared by
// the Ship Editor and the scenario Ship Selector so both resolve the same
// catalogs, deck layout, and derived stats.

import { ShipArmor, ShipComponent, ShipTemplate, ShipWeapon } from '@/types/ship';
import { COMPONENT_NAMES, DECK_HULL_PCT, ShipBuild, componentById, componentByName, computeHullMass, roundTons } from './shipStats';
import { DeckCard, syncDeckLayout } from './deckLayout';

export function buildShipFromTemplate(
  template: ShipTemplate,
  armors: ShipArmor[],
  components: ShipComponent[],
  weapons: ShipWeapon[],
): ShipBuild | null {
  const armor = armors.find(a => a.id === template.armorId) || armors[0];
  if (!armor) return null;

  const componentKey = (name: string, fallback: string) => {
    const component = componentByName(components, name);
    return `component:${component.id || fallback}`;
  };
  const deckCards: DeckCard[] = [];
  const pushComponentCards = (baseKey: string, count: number, canCombine: boolean) => {
    if (count <= 0) return;
    if (canCombine) {
      deckCards.push({ key: baseKey, kind: 'component' });
      return;
    }
    for (let i = 0; i < count; i += 1) {
      deckCards.push({ key: `${baseKey}:${i}`, kind: 'component' });
    }
  };
  const helmComponent = componentByName(components, COMPONENT_NAMES.helm);
  pushComponentCards(`component:${helmComponent.id || 'helm'}`, template.helm, helmComponent.canCombine);
  const bridgeComponent = componentByName(components, COMPONENT_NAMES.commandBridge);
  pushComponentCards(`component:${bridgeComponent.id || 'command_bridge'}`, template.commandBridge, bridgeComponent.canCombine);
  // Deck is mandatory and always present (hittable, 20% of hull mass min 1).
  deckCards.push({ key: componentKey(COMPONENT_NAMES.deck, 'deck'), kind: 'component' });
  if (Math.round(template.crewQuarters) > 0) {
    deckCards.push({ key: componentKey(COMPONENT_NAMES.crewQuarters, 'crew_quarters'), kind: 'component' });
  }
  const hullAllocated = roundTons(computeHullMass(template.totalMass));
  const deckTons = hullAllocated > 0 ? Math.max(1, Math.round(hullAllocated * DECK_HULL_PCT)) : 0;
  if (hullAllocated - deckTons > 0) {
    deckCards.push({ key: componentKey(COMPONENT_NAMES.hull, 'hull'), kind: 'component' });
  }
  const sailComponent = componentByName(components, COMPONENT_NAMES.sail);
  pushComponentCards(`component:${sailComponent.id || 'sail'}`, template.sails, sailComponent.canCombine);
  const rudderComponent = componentByName(components, COMPONENT_NAMES.rudder);
  pushComponentCards(`component:${rudderComponent.id || 'rudder'}`, template.rudders, rudderComponent.canCombine);
  if (Math.round(template.cargoArea) > 0) {
    deckCards.push({ key: componentKey(COMPONENT_NAMES.cargo, 'cargo'), kind: 'component' });
  }
  for (const row of template.optionalComponents) {
    const component = componentById(components, row.componentId);
    pushComponentCards(`optional:${row.componentId}`, row.count, component.canCombine !== false);
  }
  for (const row of template.weapons) {
    for (let i = 0; i < row.count; i += 1) {
      deckCards.push({ key: `weapon:${row.id}:${i}`, kind: 'weapon' });
    }
  }

  const deckLayout = syncDeckLayout(template.deckLayout, deckCards);
  const cardKeys = new Set(deckCards.map(c => c.key));
  return {
    armor,
    components,
    weaponsCatalog: weapons,
    totalMass: template.totalMass,
    helm: template.helm,
    commandBridge: template.commandBridge,
    sails: template.sails,
    rudders: template.rudders,
    reinforcement: template.reinforcement,
    crewQuarters: template.crewQuarters ?? 0,
    weaponCapacity: template.weaponCapacity ?? 0,
    atmosphericSpeed: template.atmosphericSpeed ?? 0,
    damageThreshold: template.damageThreshold ?? 15,
    cargoArea: template.cargoArea,
    crews: template.crews,
    deckLayout,
    reinforcements: template.reinforcements.filter(key => cardKeys.has(key)),
    weaponArcs: template.weaponArcs,
    templateComponents: template.optionalComponents,
    templateWeapons: template.weapons,
  };
}
