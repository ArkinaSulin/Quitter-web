// src/components/ShipRenderer/ShipLayout.tsx
// First-pass ship layout: fixed positions for hull/helm/bridge/sail/rudder/cargo,
// generic component slots for armor/reinforcement/quarters/accessories, and
// weapon slots. Each slot uses the square ShipComponentCard.

import {
  COMPONENT_IDS,
  ShipBuild,
  ShipDerivedStats,
  accessoryById,
  componentById,
  weaponById,
  weaponTons,
} from '@/packages/ships';
import { ShipComponentCard, ShipComponentCardData } from './ShipComponentCard';

function empty(name: string, onAdd?: () => void): ShipComponentCardData {
  return { id: `empty-${name}`, name, tons: 0, ac: 0, crewRequired: 0, empty: true, onAdd };
}

function label(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function ShipLayout({
  build,
  stats,
  onAddWeapon,
  onAddComponent,
}: {
  build: ShipBuild;
  stats: ShipDerivedStats;
  onAddWeapon?: () => void;
  onAddComponent?: () => void;
}) {
  const c = build.components;
  const t = stats.tonnage;

  const componentCard = (
    id: string,
    label: string,
    tons: number,
    crew: number,
    opts: { safe?: boolean; note?: string; emptyLabel?: string } = {},
  ): ShipComponentCardData => {
    if (tons <= 0 && !opts.note) return empty(opts.emptyLabel || label);
    const component = componentById(c, id);
    return {
      id,
      name: label,
      imageUrl: component.imageUrl,
      tons,
      ac: component.ac ?? 10,
      crewRequired: crew,
      safe: opts.safe,
      note: opts.note,
    };
  };

  const armor: ShipComponentCardData = {
    id: 'armor',
    name: label(build.armor.id),
    imageUrl: build.armor.imageUrl,
    tons: t.armor,
    ac: build.armor.ac,
    crewRequired: 0,
    safe: true,
    note: build.armor.hpMult > 1 ? `HP ×${build.armor.hpMult}` : undefined,
  };

  const helmCount = Math.max(0, build.helm);
  const helm: ShipComponentCardData = componentCard(
    COMPONENT_IDS.helm,
    helmCount > 1 ? `Helm ×${helmCount}` : 'Helm',
    t.helm,
    Math.ceil(helmCount * componentById(c, COMPONENT_IDS.helm).crew),
    { emptyLabel: 'Helm' },
  );

  const bridge = componentCard(
    COMPONENT_IDS.commandBridge,
    build.commandBridge > 1 ? `Bridge ×${build.commandBridge}` : 'Bridge',
    t.commandBridge,
    Math.ceil(build.commandBridge * componentById(c, COMPONENT_IDS.commandBridge).crew),
    { note: build.commandBridge > 0 ? `+${build.commandBridge * 5} command` : undefined, emptyLabel: 'Bridge' },
  );

  const hull: ShipComponentCardData = {
    id: 'hull',
    name: 'Hull',
    imageUrl: componentById(c, COMPONENT_IDS.hull).imageUrl,
    tons: t.hull,
    ac: componentById(c, COMPONENT_IDS.hull).ac ?? 10,
    crewRequired: 0,
    safe: true,
    note: 'structural',
  };

  const sail = componentCard(
    COMPONENT_IDS.sail,
    build.sails > 1 ? `Sails ×${build.sails}` : 'Sail',
    t.sails,
    Math.ceil(build.sails * componentById(c, COMPONENT_IDS.sail).crew),
    { emptyLabel: 'Sail' },
  );

  const rudder = componentCard(
    COMPONENT_IDS.rudder,
    build.rudders > 1 ? `Rudders ×${build.rudders}` : 'Rudder',
    t.rudders,
    Math.ceil(build.rudders * componentById(c, COMPONENT_IDS.rudder).crew),
    { emptyLabel: 'Rudder' },
  );

  const cargo = componentCard(
    COMPONENT_IDS.cargo,
    'Cargo',
    t.cargo,
    0,
    { emptyLabel: 'Cargo' },
  );

  const reinforcement = componentCard(
    COMPONENT_IDS.reinforcement,
    build.reinforcement > 1 ? `Reinforcement ×${build.reinforcement}` : 'Reinforcement',
    t.reinforcement,
    0,
    { note: build.reinforcement > 0 ? `+${build.reinforcement * 10} temp HP` : undefined, emptyLabel: 'Reinforcement' },
  );

  const quarters = componentCard(
    COMPONENT_IDS.crewQuarters,
    'Crew quarters',
    t.crewQuarters,
    0,
    { note: t.crewQuarters > 0 ? `${stats.crewCapacity} capacity` : undefined, emptyLabel: 'Quarters' },
  );

  const weaponCards: ShipComponentCardData[] = build.templateWeapons.map((row, idx) => {
    const weapon = weaponById(build.weaponsCatalog, row.weaponId);
    const tons = weapon ? weaponTons(weapon) * row.count : 0;
    return {
      id: `weapon-${idx}`,
      name: weapon ? `${label(weapon.id)}${row.count > 1 ? ` ×${row.count}` : ''}` : 'Weapon',
      imageUrl: weapon?.imageUrl,
      tons,
      ac: weapon?.ac ?? 10,
      crewRequired: weapon ? Math.ceil(weapon.crew * row.count) : 0,
      note: row.mountSlot,
    };
  });

  const accessoryCards: ShipComponentCardData[] = build.templateAccessories.map((row) => {
    const accessory = accessoryById(build.accessoriesCatalog, row.accessoryId);
    return {
      id: `accessory-${row.accessoryId}`,
      name: accessory ? `${label(accessory.id)}${row.count > 1 ? ` ×${row.count}` : ''}` : row.accessoryId,
      imageUrl: accessory?.imageUrl,
      tons: Math.round((accessory?.mass || 0) * row.count),
      ac: accessory?.ac ?? 10,
      crewRequired: accessory ? Math.ceil(accessory.crew * row.count) : 0,
      note: accessory?.effect || undefined,
    };
  });

  const weaponSlot = (idx: number) => weaponCards[idx] ?? empty('Weapon', onAddWeapon);
  const accessorySlot = (idx: number) =>
    accessoryCards[idx] ?? empty('Component', onAddComponent);

  const extraWeapons = weaponCards.slice(6);

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
          <ShipComponentCard data={armor} />
          <ShipComponentCard data={accessorySlot(0)} />
          <ShipComponentCard data={reinforcement} />
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
          <ShipComponentCard data={empty('Add weapon', onAddWeapon)} />
          <ShipComponentCard data={bridge} />
          <ShipComponentCard data={empty('Add weapon', onAddWeapon)} />
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
          <ShipComponentCard data={accessorySlot(1)} />
          <ShipComponentCard data={accessorySlot(2)} />
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

        {accessoryCards.length > 3 && (
          <div className="grid grid-cols-3 gap-2">
            {accessoryCards.slice(3).map((card) => <ShipComponentCard key={card.id} data={card} />)}
          </div>
        )}
      </div>
    </div>
  );
}
