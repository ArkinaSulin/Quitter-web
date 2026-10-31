// src/components/ShipRenderer/ShipLayout.tsx
// Fixed ship layout (first pass). Armor and reinforcement are not cards; every
// purchased component/weapon is rendered as a card. The card positions are
// persisted as future 3x9 deck cells by the editor.

import {
  COMPONENT_NAMES,
  ShipBuild,
  ShipDerivedStats,
  componentById,
  componentByName,
  weaponById,
  weaponTons,
} from '@/packages/ships';
import { ShipComponentCard, ShipComponentCardData } from './ShipComponentCard';

function empty(name: string): ShipComponentCardData {
  return { id: `empty-${name}`, name, tons: 0, ac: 0, dt: 0, crewRequired: 0, empty: true };
}

function reinforced(build: ShipBuild, key: string): boolean {
  return (build.reinforcements ?? []).includes(key);
}

export function ShipLayout({
  build,
  stats,
  onCardContextMenu,
}: {
  build: ShipBuild;
  stats: ShipDerivedStats;
  onCardContextMenu?: (event: React.MouseEvent, data: ShipComponentCardData) => void;
}) {
  const c = build.components;
  const m = stats.massBreakdown;

  const componentCard = (
    name: string,
    display: string,
    tons: number,
    crew: number,
    opts: { safe?: boolean; note?: string; emptyLabel?: string } = {},
  ): ShipComponentCardData => {
    if (tons <= 0 && !opts.note) return empty(opts.emptyLabel || display);
    const component = componentByName(c, name);
    const cardKey = `component:${component.id || name}`;
    return {
      id: cardKey,
      cardKey,
      name: display,
      tons,
      ac: component.ac ?? 10,
      dt: component.dt ?? 15,
      crewRequired: crew,
      safe: opts.safe,
      note: component.effect || opts.note,
      reinforced: reinforced(build, cardKey),
      onContextMenu: onCardContextMenu,
    };
  };

  const helmCount = Math.max(0, build.helm);
  const helm = componentCard(
    COMPONENT_NAMES.helm,
    helmCount > 1 ? `Helm ×${helmCount}` : 'Helm',
    m.helm,
    Math.ceil(helmCount * componentByName(c, COMPONENT_NAMES.helm).crew),
    { emptyLabel: 'Helm' },
  );

  const bridge = componentCard(
    COMPONENT_NAMES.commandBridge,
    build.commandBridge > 1 ? `Bridge ×${build.commandBridge}` : 'Bridge',
    m.commandBridge,
    Math.ceil(build.commandBridge * componentByName(c, COMPONENT_NAMES.commandBridge).crew),
    { note: build.commandBridge > 0 ? `+${build.commandBridge * 5} command` : undefined, emptyLabel: 'Bridge' },
  );

  const hullComponent = componentByName(c, COMPONENT_NAMES.hull);
  const hullKey = `component:${hullComponent.id || 'hull'}`;
  const hull: ShipComponentCardData = {
    id: hullKey,
    cardKey: hullKey,
    name: 'Hull',
    tons: m.hull,
    ac: hullComponent.ac ?? 10,
    dt: hullComponent.dt ?? 15,
    crewRequired: 0,
    safe: true,
    note: hullComponent.effect || 'structural',
    reinforced: reinforced(build, hullKey),
    onContextMenu: onCardContextMenu,
  };

  const sail = componentCard(
    COMPONENT_NAMES.sail,
    build.sails > 1 ? `Sails ×${build.sails}` : 'Sail',
    m.sails,
    Math.ceil(build.sails * componentByName(c, COMPONENT_NAMES.sail).crew),
    { emptyLabel: 'Sail' },
  );

  const rudder = componentCard(
    COMPONENT_NAMES.rudder,
    build.rudders > 1 ? `Rudders ×${build.rudders}` : 'Rudder',
    m.rudders,
    Math.ceil(build.rudders * componentByName(c, COMPONENT_NAMES.rudder).crew),
    { emptyLabel: 'Rudder' },
  );

  const cargo = componentCard(
    COMPONENT_NAMES.cargo,
    'Cargo',
    m.cargo,
    0,
    { emptyLabel: 'Cargo' },
  );

  const quarters = componentCard(
    COMPONENT_NAMES.crewQuarters,
    'Crew quarters',
    m.crewQuarters,
    0,
    { note: m.crewQuarters > 0 ? `${stats.crewCapacity} capacity` : undefined, emptyLabel: 'Quarters' },
  );

  const weaponCards: ShipComponentCardData[] = build.templateWeapons.map((row) => {
    const weapon = weaponById(build.weaponsCatalog, row.weaponId);
    const tons = weapon ? weaponTons(weapon) * row.count : 0;
    const cardKey = `weapon:${row.weaponId}:${row.mountSlot}`;
    return {
      id: cardKey,
      cardKey,
      name: weapon ? `${weapon.name}${row.count > 1 ? ` ×${row.count}` : ''}` : 'Weapon',
      tons,
      ac: weapon?.ac ?? 10,
      dt: weapon?.dt ?? 15,
      crewRequired: weapon ? Math.ceil(weapon.crew * row.count) : 0,
      note: row.mountSlot,
      reinforced: reinforced(build, cardKey),
      onContextMenu: onCardContextMenu,
    };
  });
  const weaponRows = build.templateWeapons.map((row, idx) => ({ row, card: weaponCards[idx] }));
  const ramWeapons = weaponRows.filter(w => w.row.mountSlot === 'Ram').map(w => w.card);
  const otherWeapons = weaponRows.filter(w => w.row.mountSlot !== 'Ram').map(w => w.card);

  const optionalComponentCards: ShipComponentCardData[] = build.templateComponents.map((row) => {
    const component = componentById(build.components, row.componentId);
    const cardKey = `optional:${row.componentId}`;
    return {
      id: cardKey,
      cardKey,
      name: component.name ? `${component.name}${row.count > 1 ? ` ×${row.count}` : ''}` : row.componentId,
      tons: Math.round((component.mass || 0) * row.count),
      ac: component.ac ?? 10,
      dt: component.dt ?? 15,
      crewRequired: Math.ceil(component.crew * row.count),
      note: component.effect || undefined,
      reinforced: reinforced(build, cardKey),
      onContextMenu: onCardContextMenu,
    };
  });

  const weaponSlot = (idx: number) => otherWeapons[idx] ?? empty('Weapon');
  const optionalComponentSlot = (idx: number) => optionalComponentCards[idx] ?? empty('Component');
  const ramSlot = ramWeapons[0] ?? empty('Ram');

  const extraWeapons = otherWeapons.slice(6);
  const extraRamWeapons = ramWeapons.slice(1);
  const extraOptionalComponents = optionalComponentCards.slice(4);

  // Non-functional editor preview: consume the roster in layout order.
  const previewCrew = build.crews ?? [];
  let crewIdx = 0;
  const orderedCards: ShipComponentCardData[] = [
    optionalComponentSlot(0), ramSlot, optionalComponentSlot(1),
    weaponSlot(0), weaponSlot(1), weaponSlot(2),
    helm, bridge, hull, sail, rudder, cargo, quarters,
    optionalComponentSlot(2), optionalComponentSlot(3),
    weaponSlot(3), weaponSlot(4), weaponSlot(5),
    ...extraWeapons, ...extraRamWeapons, ...extraOptionalComponents,
  ];
  for (const card of orderedCards) {
    if (card.empty) continue;
    const count = Math.max(0, Math.round(card.crewRequired));
    card.crewSlots = Array.from({ length: count }, () => {
      const crew = previewCrew[crewIdx];
      if (crew) crewIdx += 1;
      return crew
        ? { name: crew.name ?? undefined, level: crew.level, assigned: true }
        : { assigned: false };
    });
  }

  return (
    <div className="relative rounded-3xl border border-gray-700 bg-gray-900/40 p-3">
      <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[8px] uppercase tracking-widest text-gray-600">
        Port
      </span>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90 text-[8px] uppercase tracking-widest text-gray-600">
        Starboard
      </span>

      <div className="mx-auto max-w-[420px] space-y-2 px-3">
        <div className="grid grid-cols-3 gap-2">
          <ShipComponentCard data={optionalComponentSlot(0)} />
          <ShipComponentCard data={ramSlot} />
          <ShipComponentCard data={optionalComponentSlot(1)} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ShipComponentCard data={weaponSlot(0)} />
          <ShipComponentCard data={weaponSlot(1)} />
          <ShipComponentCard data={weaponSlot(2)} />
        </div>

        <div className="text-center text-[8px] uppercase tracking-widest text-gray-600">360°</div>

        <div className="grid grid-cols-3 gap-2">
          <div />
          <ShipComponentCard data={helm} />
          <div />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div />
          <ShipComponentCard data={bridge} />
          <div />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div />
          <ShipComponentCard data={hull} />
          <div />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ShipComponentCard data={sail} />
          <ShipComponentCard data={rudder} />
          <div />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div />
          <ShipComponentCard data={cargo} />
          <div />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ShipComponentCard data={quarters} />
          <ShipComponentCard data={optionalComponentSlot(2)} />
          <ShipComponentCard data={optionalComponentSlot(3)} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ShipComponentCard data={weaponSlot(3)} />
          <ShipComponentCard data={weaponSlot(4)} />
          <ShipComponentCard data={weaponSlot(5)} />
        </div>

        {extraWeapons.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {extraWeapons.map((card) => <ShipComponentCard key={card.id} data={card} />)}
          </div>
        )}

        {extraRamWeapons.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {extraRamWeapons.map((card) => <ShipComponentCard key={card.id} data={card} />)}
          </div>
        )}

        {extraOptionalComponents.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {extraOptionalComponents.map((card) => <ShipComponentCard key={card.id} data={card} />)}
          </div>
        )}
      </div>
    </div>
  );
}
