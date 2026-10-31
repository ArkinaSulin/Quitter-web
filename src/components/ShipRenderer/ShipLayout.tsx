// src/components/ShipRenderer/ShipLayout.tsx
// Region-container deck layout. Every purchased component/weapon is a card in a
// Bow / Port / Body / Starboard / Stern container. Slot 1 of Bow is the fixed Ram
// slot. Cards can be dragged between slots (swap) and slots can be moved between
// regions from the context menu. A full middle row grows Port/Body/Starboard.

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

const MIDDLE_REGIONS: [ShipDeckRegion, string][] = [
  ['port', 'Port'],
  ['body', 'Body'],
  ['starboard', 'Starboard'],
];

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
      dt: component.dt ?? 15,
      crewRequired: crew,
      safe: opts.safe,
      note: component.effect || opts.note,
      reinforced: reinforced(build, key),
    };
  };

  if (build.helm > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.helm);
    addComponentCard(
      `component:${comp.id || 'helm'}`,
      build.helm > 1 ? `Helm ×${build.helm}` : 'Helm',
      m.helm,
      Math.ceil(build.helm * comp.crew),
      comp,
    );
  }

  if (build.commandBridge > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.commandBridge);
    addComponentCard(
      `component:${comp.id || 'command_bridge'}`,
      build.commandBridge > 1 ? `Bridge ×${build.commandBridge}` : 'Bridge',
      m.commandBridge,
      Math.ceil(build.commandBridge * comp.crew),
      comp,
      { note: `+${build.commandBridge * 5} command` },
    );
  }

  const hullComponent = componentByName(c, COMPONENT_NAMES.hull);
  const hullKey = `component:${hullComponent.id || 'hull'}`;
  cards[hullKey] = {
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
  };

  if (build.sails > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.sail);
    addComponentCard(
      `component:${comp.id || 'sail'}`,
      build.sails > 1 ? `Sails ×${build.sails}` : 'Sail',
      m.sails,
      Math.ceil(build.sails * comp.crew),
      comp,
    );
  }

  if (build.rudders > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.rudder);
    addComponentCard(
      `component:${comp.id || 'rudder'}`,
      build.rudders > 1 ? `Rudders ×${build.rudders}` : 'Rudder',
      m.rudders,
      Math.ceil(build.rudders * comp.crew),
      comp,
    );
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
    const key = `weapon:${row.id}`;
    cards[key] = {
      id: key,
      cardKey: key,
      name: weapon ? `${weapon.name}${row.count > 1 ? ` ×${row.count}` : ''}` : 'Weapon',
      tons: weapon ? weaponTons(weapon) * row.count : 0,
      ac: weapon?.ac ?? 10,
      dt: weapon?.dt ?? 15,
      crewRequired: weapon ? Math.ceil(weapon.crew * row.count) : 0,
      note: weapon?.special || undefined,
      reinforced: reinforced(build, key),
    };
  }

  for (const row of build.templateComponents) {
    const component = componentById(build.components, row.componentId);
    const key = `optional:${row.componentId}`;
    cards[key] = {
      id: key,
      cardKey: key,
      name: component.name ? `${component.name}${row.count > 1 ? ` ×${row.count}` : ''}` : row.componentId,
      tons: Math.round((component.mass || 0) * row.count),
      ac: component.ac ?? 10,
      dt: component.dt ?? 15,
      crewRequired: Math.ceil(component.crew * row.count),
      note: component.effect || undefined,
      reinforced: reinforced(build, key),
    };
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
    return empty(s.ram ? 'Ram' : 'Empty');
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
    // Ram slot is fixed: nothing leaves it, and only its own card may sit there.
    if (source.ram || target.ram) return;
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
    const direction = s.cardKey ? deckDirection(layout, s.cardKey) : s.ram ? 'Ram' : null;
    return (
      <div
        key={`${region}-${index}`}
        draggable={!readOnly && !!s.cardKey && !s.ram}
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
        {direction && !s.ram && (
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
    mode: 'row' | 'column',
  ) => (
    <div className="rounded-2xl border-2 border-gray-600/80 bg-gray-900/30 p-1.5">
      <div className="mb-1 text-center text-[8px] uppercase tracking-widest text-gray-500">
        {label}
      </div>
      <div className={mode === 'row' ? 'grid grid-cols-3 gap-1.5' : 'flex flex-col gap-1.5'}>
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
        {renderRegion('bow', 'Bow', 'row')}

        <div className="text-center text-[8px] uppercase tracking-widest text-gray-600">360°</div>

        <div className="grid grid-cols-3 gap-2">
          {MIDDLE_REGIONS.map(([region, label]) => (
            <div key={region}>{renderRegion(region, label, 'column')}</div>
          ))}
        </div>

        {renderRegion('stern', 'Stern', 'row')}
      </div>
    </div>
  );
}
