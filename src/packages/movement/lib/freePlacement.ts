// src/packages/movement/lib/freePlacement.ts
// Free-placement level chooser. Free Move / turn 0 / Unit Selector drops ask
// which level a token occupies when a hex offers more than one valid home:
// a structure top, a door/ground floor, a ship deck, or a friendly host unit.
// Normal paid movement does not use this module.

export type FreePlacementOptionKind =
  | 'board'
  | 'attach'
  | 'ride'
  | 'structure-top'
  | 'structure-door'
  | 'ground'
  | 'air';

export interface FreePlacementOption {
  kind: FreePlacementOptionKind;
  id: string;
  label: string;
  detail?: string;
  elevation?: number;
  shipId?: string;
  hostId?: string;
  position?: 'back' | 'rider';
}

export interface FreePlacementOccupant {
  id: string;
  name: string;
  team: string;
  elevation: number;
  /** Same alliance as the mover (or the GM allows any host). */
  friendly: boolean;
  /** The existing mount/size/rider rule allows a rider position. */
  canRide: boolean;
}

export interface FreePlacementShip {
  id: string;
  name: string;
}

export interface FreePlacementArgs {
  isHero: boolean;
  canFly: boolean;
  hasStructure: boolean;
  structureTop: number;
  /** Open or broken door only; an intact door offers the top only. */
  doorOpenOrBroken: boolean;
  groundFree: boolean;
  topFree: boolean;
  ships: FreePlacementShip[];
  occupants: FreePlacementOccupant[];
  /** New Unit Selector hero: any host is allowed (host team is adopted). */
  allowAnyUnit: boolean;
}

function feet(value: number): string {
  return `${Math.max(0, Math.round(value))} ft`;
}

/** Ordered options for the free-placement chooser. */
export function buildFreePlacementOptions(args: FreePlacementArgs): FreePlacementOption[] {
  const options: FreePlacementOption[] = [];

  for (const ship of args.ships) {
    if (!args.isHero) continue;
    options.push({
      kind: 'board',
      id: `board:${ship.id}`,
      label: `Board ${ship.name}`,
      detail: 'Attach to the ship',
      shipId: ship.id,
    });
  }

  if (args.isHero) {
    for (const occupant of args.occupants) {
      if (!occupant.friendly && !args.allowAnyUnit) continue;
      options.push({
        kind: 'attach',
        id: `attach:${occupant.id}`,
        label: `Attach to ${occupant.name}`,
        detail: occupant.elevation > 0 ? `Back · ${feet(occupant.elevation)}` : 'Back',
        hostId: occupant.id,
        position: 'back',
        elevation: occupant.elevation,
      });
      if (occupant.canRide) {
        options.push({
          kind: 'ride',
          id: `ride:${occupant.id}`,
          label: `Ride ${occupant.name}`,
          detail: occupant.elevation > 0 ? `Rider · ${feet(occupant.elevation)}` : 'Rider',
          hostId: occupant.id,
          position: 'rider',
          elevation: occupant.elevation,
        });
      }
    }
  }

  if (args.hasStructure && args.topFree) {
    options.push({
      kind: 'structure-top',
      id: 'structure-top',
      label: 'Structure top',
      detail: feet(args.structureTop),
      elevation: args.structureTop,
    });
  }

  if (args.hasStructure && args.doorOpenOrBroken && args.groundFree) {
    options.push({
      kind: 'structure-door',
      id: 'structure-door',
      label: 'Door level',
      detail: '0 ft · inside',
      elevation: 0,
    });
  }

  if (!args.hasStructure && args.groundFree) {
    options.push({
      kind: 'ground',
      id: 'ground',
      label: 'Ground',
      detail: '0 ft',
      elevation: 0,
    });
  }

  if (args.canFly) {
    options.push({
      kind: 'air',
      id: 'air',
      label: 'Air altitude…',
      detail: 'Choose a flying height',
    });
  }

  return options;
}
