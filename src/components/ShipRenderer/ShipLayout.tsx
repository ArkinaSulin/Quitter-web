// src/components/ShipRenderer/ShipLayout.tsx
// Region-container deck layout. Every purchased component/weapon is a card in a
// Bow / Port / Body / Starboard / Stern container. Weapons and non-combinable
// components get one card per unit. Cards can be dragged between slots (swap)
// and slots can be moved between regions from the context menu.

import { useRef } from 'react';
import {
  COMPONENT_NAMES,
  ShipBuild,
  ShipDerivedStats,
  componentById,
  componentByName,
  deckDirection,
  deckOrderedCardKeys,
  swapCards,
  weaponById,
  weaponTons,
} from '@/packages/ships';
import { ShipDeckLayout, ShipDeckRegion, ShipDeckSlot } from '@/types/ship';
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
  readOnly = false,
  onDeckChange,
  onSlotContextMenu,
}: {
  build: ShipBuild;
  stats: ShipDerivedStats;
  readOnly?: boolean;
  onDeckChange?: (layout: ShipDeckLayout) => void;
  onSlotContextMenu?: (
    event: React.MouseEvent,
    region: ShipDeckRegion,
    index: number,
    card?: ShipComponentCardData,
  ) => void;
}) {
  const c = build.components;
  const m = stats.massBreakdown;
  const layout = build.deckLayout;
  const dragRef = useRef<{ region: ShipDeckRegion; index: number } | null>(null);

  if (!layout) {
    return (
      <div className="rounded-3xl border border-gray-700 bg-gray-900/40 p-4 text-[11px] text-gray-500">
        Deck layout unavailable.
      </div>
    );
  }

  const cards: Record<string, ShipComponentCardData> = {};
  const cardDt = (componentDt: number | undefined) =>
    Math.max(build.damageThreshold ?? 15, componentDt ?? 15);

  const addComponentCard = (
    key: string,
    name: string,
    tons: number,
    crew: number,
    component: ReturnType<typeof componentByName>,
    opts: { safe?: boolean; note?: string } = {},
  ) => {
    cards[key] = {
      id: key,
      cardKey: key,
      name,
      tons,
      ac: component.ac ?? 10,
      dt: cardDt(component.dt),
      crewRequired: crew,
      safe: opts.safe,
      note: component.effect || opts.note,
      kind: 'component',
      reinforced: reinforced(build, key),
    };
  };

  const addCountedComponentCards = (
    baseKey: string,
    name: string,
    count: number,
    component: ReturnType<typeof componentByName>,
    opts: {
      aggregateTons: number;
      aggregateCrew: number;
      unitTons: number;
      unitCrew: number;
      aggregateNote?: string;
      unitNote?: string;
    },
  ) => {
    if (count <= 0) return;
    if (component.canCombine) {
      addComponentCard(
        baseKey,
        count > 1 ? `${name} ×${count}` : name,
        opts.aggregateTons,
        opts.aggregateCrew,
        component,
        { note: opts.aggregateNote },
      );
      return;
    }
    for (let i = 0; i < count; i += 1) {
      addComponentCard(
        `${baseKey}:${i}`,
        name,
        opts.unitTons,
        opts.unitCrew,
        component,
        { note: opts.unitNote },
      );
    }
  };

  if (build.helm > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.helm);
    addCountedComponentCards(`component:${comp.id || 'helm'}`, 'Helm', build.helm, comp, {
      aggregateTons: m.helm,
      aggregateCrew: Math.ceil(build.helm * comp.crew),
      unitTons: Math.round(comp.mass),
      unitCrew: Math.ceil(comp.crew),
    });
  }

  if (build.commandBridge > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.commandBridge);
    addCountedComponentCards(`component:${comp.id || 'command_bridge'}`, 'Bridge', build.commandBridge, comp, {
      aggregateTons: m.commandBridge,
      aggregateCrew: Math.ceil(build.commandBridge * comp.crew),
      unitTons: Math.round(comp.mass),
      unitCrew: Math.ceil(comp.crew),
      aggregateNote: `+${build.commandBridge * 5} command`,
      unitNote: '+5 command',
    });
  }

  const hullComponent = componentByName(c, COMPONENT_NAMES.hull);
  const hullKey = `component:${hullComponent.id || 'hull'}`;
  cards[hullKey] = {
    id: hullKey,
    cardKey: hullKey,
    name: 'Hull',
    tons: m.hull,
    ac: hullComponent.ac ?? 10,
    dt: cardDt(hullComponent.dt),
    crewRequired: 0,
    safe: true,
    note: hullComponent.effect || 'structural',
    kind: 'component',
    reinforced: reinforced(build, hullKey),
  };

  if (build.sails > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.sail);
    addCountedComponentCards(`component:${comp.id || 'sail'}`, 'Sail', build.sails, comp, {
      aggregateTons: m.sails,
      aggregateCrew: Math.ceil(build.sails * comp.crew),
      unitTons: Math.round(comp.mass),
      unitCrew: Math.ceil(comp.crew),
    });
  }

  if (build.rudders > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.rudder);
    addCountedComponentCards(`component:${comp.id || 'rudder'}`, 'Rudder', build.rudders, comp, {
      aggregateTons: m.rudders,
      aggregateCrew: Math.ceil(build.rudders * comp.crew),
      unitTons: Math.round(comp.mass),
      unitCrew: Math.ceil(comp.crew),
    });
  }

  if (m.cargo > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.cargo);
    addComponentCard(`component:${comp.id || 'cargo'}`, 'Cargo', m.cargo, 0, comp);
  }

  if (m.crewQuarters > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.crewQuarters);
    addComponentCard(
      `component:${comp.id || 'crew_quarters'}`,
      'Crew quarters',
      m.crewQuarters,
      0,
      comp,
      { note: `${stats.crewCapacity} capacity` },
    );
  }

  for (const row of build.templateWeapons) {
    const weapon = weaponById(build.weaponsCatalog, row.weaponId);
    for (let i = 0; i < row.count; i += 1) {
      const key = `weapon:${row.id}:${i}`;
      cards[key] = {
        id: key,
        cardKey: key,
        name: weapon?.name || 'Weapon',
        tons: weapon ? weaponTons(weapon) : 0,
        ac: weapon?.ac ?? 10,
        dt: cardDt(weapon?.dt),
        crewRequired: weapon ? Math.ceil(weapon.crew) : 0,
        note: weapon?.special || undefined,
        kind: 'weapon',
        reinforced: reinforced(build, key),
      };
    }
  }

  for (const row of build.templateComponents) {
    const component = componentById(build.components, row.componentId);
    const baseKey = `optional:${row.componentId}`;
    const addOptional = (key: string, count: number, combined: boolean) => {
      cards[key] = {
        id: key,
        cardKey: key,
        name: component.name ? `${component.name}${combined && count > 1 ? ` ×${count}` : ''}` : row.componentId,
        tons: combined ? Math.round((component.mass || 0) * count) : Math.round(component.mass || 0),
        ac: component.ac ?? 10,
        dt: cardDt(component.dt),
        crewRequired: combined ? Math.ceil(component.crew * count) : Math.ceil(component.crew),
        note: component.effect || undefined,
        kind: 'component',
        reinforced: reinforced(build, key),
      };
    };
    if (component.canCombine) {
      addOptional(baseKey, row.count, true);
    } else {
      for (let i = 0; i < row.count; i += 1) addOptional(`${baseKey}:${i}`, 1, false);
    }
  }

  // Non-functional preview: consume the roster in deck order.
  const previewCrew = build.crews ?? [];
  let crewIdx = 0;
  for (const key of deckOrderedCardKeys(layout)) {
    const card = cards[key];
    if (!card) continue;
    const count = Math.max(0, Math.round(card.crewRequired));
    card.crewSlots = Array.from({ length: count }, () => {
      const crew = previewCrew[crewIdx];
      if (crew) crewIdx += 1;
      return crew
        ? { name: crew.name ?? undefined, level: crew.level, assigned: true }
        : { assigned: false };
    });
  }

  const slotCard = (s: ShipDeckSlot): ShipComponentCardData => {
    if (s.cardKey && cards[s.cardKey]) return cards[s.cardKey];
    return empty('Empty');
  };

  const handleDrop = (
    event: React.DragEvent,
    region: ShipDeckRegion,
    index: number,
  ) => {
    event.preventDefault();
    if (readOnly || !onDeckChange) return;
    const from = dragRef.current;
    dragRef.current = null;
    if (!from || (from.region === region && from.index === index)) return;
    const source = layout[from.region][from.index];
    const target = layout[region][index];
    if (!source || !target) return;
    onDeckChange(swapCards(layout, from, { region, index }));
  };

  const handleSlotMenu = (
    event: React.MouseEvent,
    region: ShipDeckRegion,
    index: number,
  ) => {
    if (!onSlotContextMenu) return;
    event.preventDefault();
    const s = layout[region][index];
    onSlotContextMenu(event, region, index, s?.cardKey ? cards[s.cardKey] : undefined);
  };

  const renderSlot = (region: ShipDeckRegion, index: number) => {
    const s = layout[region][index];
    const card = slotCard(s);
    const direction = card.kind === 'weapon' && s.cardKey ? deckDirection(layout, s.cardKey) : null;
    return (
      <div
        key={`${region}-${index}`}
        draggable={!readOnly && !!s.cardKey}
        onDragStart={(e) => {
          dragRef.current = { region, index };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `${region}:${index}`);
        }}
        onDragEnd={() => { dragRef.current = null; }}
        onDragOver={(e) => { if (!readOnly) e.preventDefault(); }}
        onDrop={(e) => handleDrop(e, region, index)}
        onContextMenu={(e) => handleSlotMenu(e, region, index)}
        className="relative h-full min-w-0"
        title={direction ? `${direction}` : undefined}
      >
        {direction && (
          <span className="pointer-events-none absolute right-1 top-1 z-10 rounded bg-black/60 px-1 text-[7px] uppercase tracking-wide text-gray-300">
            {direction}
          </span>
        )}
        <ShipComponentCard data={card} />
      </div>
    );
  };

  const renderRegion = (
    region: ShipDeckRegion,
    label: string,
    mode: 'row' | 'column' | 'body',
    wrapperClass = '',
  ) => (
    <div className={`rounded-2xl border-2 border-gray-600/80 bg-gray-900/30 p-1.5 ${wrapperClass}`}>
      <div className="mb-1 text-center text-[8px] uppercase tracking-widest text-gray-500">
        {label}
      </div>
      <div
        className={
          mode === 'row'
            ? 'grid grid-cols-3 gap-1.5'
            : mode === 'body'
              ? 'grid grid-cols-2 gap-1.5'
              : 'flex flex-col gap-1.5'
        }
      >
        {layout[region].map((_, i) => renderSlot(region, i))}
      </div>
    </div>
  );

  return (
    <div className="relative rounded-3xl border border-gray-700 bg-gray-900/40 p-3">
      <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[8px] uppercase tracking-widest text-gray-600">
        Port
      </span>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90 text-[8px] uppercase tracking-widest text-gray-600">
        Starboard
      </span>

      <div className="mx-auto max-w-[420px] space-y-2 px-3">
        {renderRegion('bow', 'Bow', 'row', 'w-3/4 mx-auto')}

        <div className="text-center text-[8px] uppercase tracking-widest text-gray-600">360°</div>

        <div className="grid grid-cols-4 gap-2">
          <div>{renderRegion('port', 'Port', 'column')}</div>
          <div className="col-span-2">{renderRegion('body', 'Body', 'body')}</div>
          <div>{renderRegion('starboard', 'Starboard', 'column')}</div>
        </div>

        {renderRegion('stern', 'Stern', 'row', 'w-3/4 mx-auto')}
      </div>
    </div>
  );
}
