// src/components/ShipRenderer/ShipLayout.tsx
// Region-container deck layout. Every purchased component/weapon is a card in a
// Bow / Port / Body / Starboard / Stern container. Weapons and non-combinable
// components get one card per unit. Cards can be dragged between slots (swap)
// and slots can be moved between regions from the context menu.

import { useEffect, useRef, useState } from 'react';
import { AllianceGroup, Unit } from '@/types/gameProtocol';
import { drawToken, loadImage } from '@/components/TokenRenderer/drawToken';
import {
  COMPONENT_NAMES,
  ShipBuild,
  ShipDerivedStats,
  componentById,
  componentByName,
  deckOrderedCardKeys,
  effectiveWeaponArcs,
  ensureDeckSlot,
  findCardSlot,
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

export interface ShipHeroToken {
  id: string;
  name: string;
  unit: Unit;
  xPct?: number;
  yPct?: number;
}

function HeroTokenCanvas({
  unit,
  teamAlliances,
  width,
  height,
}: {
  unit: Unit;
  teamAlliances?: Record<string, AllianceGroup>;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [tick, setTick] = useState(0);
  const imageUrl = unit.customImageUrl || unit.unitTypeIconUrl || unit.raceIconUrl || '';

  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    void loadImage(imageUrl)
      .then(() => { if (!cancelled) setTick(t => t + 1); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [imageUrl]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      drawToken({
        unit,
        ctx,
        x: canvas.width / 2,
        y: canvas.height / 2,
        width: canvas.width,
        height: canvas.height,
        showDetails: false,
        teamAlliances,
      });
    } catch {
      // Ignore transient image/render failures.
    }
  }, [unit, teamAlliances, tick]);

  return (
    <canvas
      ref={ref}
      width={128}
      height={96}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}

function HeroTokenLayer({
  cardKey,
  heroes,
  teamAlliances,
  hideHeroTokens,
  onHeroDrop,
  onHeroDropToMap,
}: {
  cardKey: string;
  heroes: ShipHeroToken[];
  teamAlliances?: Record<string, AllianceGroup>;
  hideHeroTokens?: boolean;
  onHeroDrop?: (heroId: string, fromCardKey: string, toCardKey: string, xPct: number, yPct: number) => void;
  onHeroDropToMap?: (heroId: string, clientX: number, clientY: number) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ heroId: string; fromCardKey: string; x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tokenW = Math.max(1, Math.min(size.w, size.h));
  const tokenH = tokenW * 0.75;
  const hitW = tokenW * 0.5;
  const hitH = tokenH * 0.5;

  const startDrag = (event: React.PointerEvent, hero: ShipHeroToken) => {
    if (!onHeroDrop) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({ heroId: hero.id, fromCardKey: cardKey, x: event.clientX, y: event.clientY, w: tokenW, h: tokenH });
    const move = (ev: PointerEvent) => {
      setDrag(d => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-card-key]') as HTMLElement | null;
      const toCardKey = target?.dataset.cardKey;
      if (toCardKey) {
        const rect = target.getBoundingClientRect();
        // Horizontal: hitbox half (transparent edges may extrude).
        const halfW = Math.min(hitW / 2, rect.width / 2);
        // Vertical: full token half (never spill onto cards above/below).
        const halfH = Math.min(tokenH / 2, rect.height / 2);
        const px = Math.max(halfW, Math.min(rect.width - halfW, ev.clientX - rect.left));
        const py = Math.max(halfH, Math.min(rect.height - halfH, ev.clientY - rect.top));
        onHeroDrop(hero.id, cardKey, toCardKey, (px / rect.width) * 100, (py / rect.height) * 100);
      } else if (document.elementFromPoint(ev.clientX, ev.clientY)?.tagName === 'CANVAS') {
        onHeroDropToMap?.(hero.id, ev.clientX, ev.clientY);
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (size.w <= 0 || size.h <= 0) {
    return <div ref={layerRef} className="pointer-events-none absolute inset-0" />;
  }

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0">
      {heroes.map((h, idx) => {
        const left = h.xPct ?? 50 + ((idx % 3) - 1) * 20;
        const top = h.yPct ?? 50 + Math.floor(idx / 3) * 20;
        return (
          <div
            key={h.id}
            className={`absolute z-20 ${hideHeroTokens ? 'pointer-events-none opacity-0' : ''}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: tokenW,
              height: tokenH,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="pointer-events-none">
              <HeroTokenCanvas unit={h.unit} teamAlliances={teamAlliances} width={tokenW} height={tokenH} />
            </div>
            <div
              className="absolute left-1/2 top-1/2 cursor-grab rounded-full"
              style={{ width: hitW, height: hitH, transform: 'translate(-50%, -50%)', pointerEvents: 'auto' }}
              onPointerDown={e => startDrag(e, h)}
            />
          </div>
        );
      })}
      {drag && (
        <div
          className="pointer-events-none fixed z-[200] rounded-full border border-amber-300 bg-amber-400/30"
          style={{
            left: drag.x,
            top: drag.y,
            width: drag.w,
            height: drag.h,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
    </div>
  );
}

export function ShipLayout({
  build,
  stats,
  readOnly = false,
  hideEmpty = false,
  heroesByCard,
  boxState,
  presentCrewByCard,
  occupantsByCard,
  weaponInfoByCard,
  teamAlliances,
  hideHeroTokens = false,
  onHeroDrop,
  onHeroDropToMap,
  onDeckChange,
  onSlotContextMenu,
}: {
  build: ShipBuild;
  stats: ShipDerivedStats;
  readOnly?: boolean;
  /** Skip vacant slots (the region boxes stay) — used by the compact runtime window. */
  hideEmpty?: boolean;
  /** Boarded heroes keyed by deck card key. */
  heroesByCard?: Record<string, ShipHeroToken[]>;
  /** Destroyed boxes per card key (1 ton = 1 box). */
  boxState?: Record<string, number>;
  /** Operating crew per card key (NPC + heroes). */
  presentCrewByCard?: Record<string, number>;
  /** Actual occupants (heroes first, then crew) per card key. */
  occupantsByCard?: Record<string, { id: string; name: string; isHero: boolean }[]>;
  /** Weapon damage/reload/fire state per weapon card key. */
  weaponInfoByCard?: Record<string, import('./ShipComponentCard').ShipCardWeaponInfo>;
  teamAlliances?: Record<string, AllianceGroup>;
  /** Shift/1 held: hide hero tokens so the card info is visible. */
  hideHeroTokens?: boolean;
  onHeroDrop?: (heroId: string, fromCardKey: string, toCardKey: string, xPct: number, yPct: number) => void;
  /** Dropped outside any card: try to disembark onto the scenario map. */
  onHeroDropToMap?: (heroId: string, clientX: number, clientY: number) => void;
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
  const deckComponent = componentByName(c, COMPONENT_NAMES.deck);
  const deckKey = `component:${deckComponent.id || 'deck'}`;
  const layout = build.deckLayout ? ensureDeckSlot(build.deckLayout, deckKey) : build.deckLayout;
  const dragRef = useRef<{ region: ShipDeckRegion; index: number } | null>(null);

  if (!layout) {
    return (
      <div className="rounded-3xl border border-gray-700 bg-gray-900/40 p-4 text-[11px] text-gray-500">
        Deck layout unavailable.
      </div>
    );
  }

  const cards: Record<string, ShipComponentCardData> = {};
  const cardAc = (componentAc: number | undefined) =>
    Math.max(stats.ac ?? 10, componentAc ?? 10);
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
      ac: cardAc(component.ac),
      dt: cardDt(component.dt),
      crewRequired: crew,
      safe: opts.safe ?? !component.hittable,
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

  cards[deckKey] = {
    id: deckKey,
    cardKey: deckKey,
    name: 'Deck',
    tons: m.deck,
    ac: cardAc(deckComponent.ac),
    dt: cardDt(deckComponent.dt),
    crewRequired: 0,
    safe: !deckComponent.hittable,
    note: 'open deck',
    kind: 'component',
    reinforced: reinforced(build, deckKey),
  };

  if (m.hull > 0) {
    const hullComponent = componentByName(c, COMPONENT_NAMES.hull);
    const hullKey = `component:${hullComponent.id || 'hull'}`;
    cards[hullKey] = {
      id: hullKey,
      cardKey: hullKey,
      name: 'Hull',
      tons: m.hull,
      ac: cardAc(hullComponent.ac),
      dt: cardDt(hullComponent.dt),
      crewRequired: 0,
      safe: !hullComponent.hittable,
      note: hullComponent.effect || 'structural',
      kind: 'component',
      reinforced: reinforced(build, hullKey),
    };
  }

  if (build.sails > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.sail);
    addCountedComponentCards(`component:${comp.id || 'sail'}`, 'Sail', build.sails, comp, {
      aggregateTons: m.sails,
      aggregateCrew: Math.max(1, Math.floor(build.sails / 4)),
      unitTons: Math.round(comp.mass),
      unitCrew: Math.max(1, Math.floor(build.sails / 4)),
    });
  }

  if (build.rudders > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.rudder);
    addCountedComponentCards(`component:${comp.id || 'rudder'}`, 'Rudder', build.rudders, comp, {
      aggregateTons: m.rudders,
      aggregateCrew: Math.max(1, Math.ceil(build.rudders / 2)),
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
      const placed = findCardSlot(layout, key);
      cards[key] = {
        id: key,
        cardKey: key,
        name: weapon?.name || 'Weapon',
        tons: weapon ? weaponTons(weapon) : 0,
        ac: cardAc(weapon?.ac),
        dt: cardDt(weapon?.dt),
        crewRequired: weapon ? Math.ceil(weapon.crew) : 0,
        note: weapon?.special || undefined,
        kind: 'weapon',
        arcs: placed ? effectiveWeaponArcs(placed.region, build.weaponArcs?.[key]) : [],
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
        ac: cardAc(component.ac),
        dt: cardDt(component.dt),
        crewRequired: combined ? Math.ceil(component.crew * count) : Math.ceil(component.crew),
        safe: !component.hittable,
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

  // Runtime: show the actual occupants (heroes first, then crew), with hollow
  // slots for the remaining crew requirement on limited cards.
  if (occupantsByCard) {
    for (const [key, occupants] of Object.entries(occupantsByCard)) {
      const card = cards[key];
      if (!card) continue;
      const capacity = Math.max(0, Math.round(card.crewRequired));
      const slots: { name?: string; assigned: boolean }[] = occupants.map(o => ({ name: o.name, assigned: true }));
      while (slots.length < capacity) slots.push({ assigned: false });
      card.crewSlots = slots;
    }
  }

  const isRenderableCard = (key: string | null | undefined): boolean => {
    if (!key) return false;
    const card = cards[key];
    return !!card && !card.safe && card.tons > 0;
  };

  const cardStatus = (card: ShipComponentCardData): 'normal' | 'yellow' | 'red' => {
    const key = card.cardKey ?? card.id;
    if (!key || card.safe || card.tons <= 0) return 'normal';
    const destroyed = Math.max(0, Math.min(card.tons, Number(boxState?.[key] ?? 0)));
    const remaining = Math.max(0, card.tons - destroyed);
    if (remaining <= 0) return 'red';
    const present = Math.max(0, Number(presentCrewByCard?.[key] ?? 0));
    if (card.kind === 'weapon') {
      return present >= card.crewRequired ? 'normal' : 'red';
    }
    if (card.name.startsWith('Rudder')) {
      const effective = Math.max(0, build.rudders - Math.floor(destroyed / 1.5));
      if (effective <= 0) return 'red';
      const required = Math.max(1, Math.ceil(effective / 2));
      if (present <= 0) return 'red';
      return present >= required ? 'normal' : 'yellow';
    }
    if (card.name.startsWith('Sail')) {
      const effective = Math.max(0, build.sails - Math.floor(destroyed));
      if (effective <= 0) return 'red';
      const required = Math.max(1, Math.floor(effective / 4));
      if (present <= 0) return 'red';
      return present >= required ? 'normal' : 'yellow';
    }
    if (card.crewRequired > 0) {
      const required = Math.max(1, Math.ceil(card.crewRequired * (remaining / card.tons)));
      if (present <= 0) return 'red';
      return present >= required ? 'normal' : 'yellow';
    }
    return 'normal';
  };

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
    const status = cardStatus(card);
    return (
      <div
        key={`${region}-${index}`}
        data-card-key={card.cardKey ?? undefined}
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
      >
        <ShipComponentCard
          data={card}
          weaponInfo={card.cardKey ? weaponInfoByCard?.[card.cardKey] : undefined}
        />
        {status !== 'normal' && (
          <div
            className={`pointer-events-none absolute inset-0 rounded-2xl ${
              status === 'red' ? 'bg-red-600/25' : 'bg-yellow-500/20'
            }`}
          />
        )}
        {card.cardKey && heroesByCard?.[card.cardKey]?.length ? (
          <HeroTokenLayer
            cardKey={card.cardKey}
            heroes={heroesByCard[card.cardKey]}
            teamAlliances={teamAlliances}
            hideHeroTokens={hideHeroTokens}
            onHeroDrop={onHeroDrop}
            onHeroDropToMap={onHeroDropToMap}
          />
        ) : null}
      </div>
    );
  };

  const renderSlotRows = (region: ShipDeckRegion, indices: number[], rowSize = 3) => {
    const rows: number[][] = [];
    for (let i = 0; i < indices.length; i += rowSize) rows.push(indices.slice(i, i + rowSize));
    return rows.map((row, rowIndex) => (
      <div
        key={`${region}-row-${rowIndex}`}
        className="flex justify-center gap-1"
      >
        {row.map(index => (
          <div key={`${region}-${index}`} style={{ width: 'var(--card-w)' }}>
            {renderSlot(region, index)}
          </div>
        ))}
      </div>
    ));
  };

  const visibleIndices = (region: ShipDeckRegion): number[] => {
    const all = layout[region].map((_, i) => i);
    const renderable = all.filter(i => {
      const key = layout[region][i]?.cardKey;
      if (!key) return !hideEmpty;
      return isRenderableCard(key);
    });
    return renderable;
  };
  const cardCount = (region: ShipDeckRegion): number =>
    layout[region].filter(s => isRenderableCard(s.cardKey)).length;

  const renderRegion = (
    region: ShipDeckRegion,
    label: string,
    mode: 'row' | 'column' | 'body' | 'bow',
    wrapperClass = '',
    wrapperStyle?: React.CSSProperties,
  ) => {
    const indices = visibleIndices(region);
    const count = cardCount(region);
    const compact = hideEmpty && count > 0 && count <= 2;
    const rowSize = compact ? count : 3;
    return (
      <div
        className={`rounded-2xl bg-gray-900/30 px-1 py-1 ring-2 ring-inset ring-gray-600/80 ${wrapperClass}`}
        style={wrapperStyle}
      >
        <div className="mb-1 text-center text-[8px] uppercase tracking-widest text-gray-500">
          {label}
        </div>
        <div
          className={
            mode === 'bow' || mode === 'row' || mode === 'body'
              ? 'space-y-1'
              : 'flex flex-col gap-1'
          }
        >
          {mode === 'bow' || mode === 'row' ? (
            renderSlotRows(region, indices, rowSize)
          ) : mode === 'body' ? (
            renderSlotRows(region, indices, 2)
          ) : (
            indices.map(i => renderSlot(region, i))
          )}
        </div>
      </div>
    );
  };

  const bowCount = cardCount('bow');
  const sternCount = cardCount('stern');
  const portCount = cardCount('port');
  const starboardCount = cardCount('starboard');
  const showBow = !hideEmpty || bowCount > 0;
  const showStern = !hideEmpty || sternCount > 0;
  const showPort = !hideEmpty || portCount > 0;
  const showStarboard = !hideEmpty || starboardCount > 0;
  const bowColumns = Math.max(1, Math.min(3, hideEmpty ? bowCount : layout.bow.length));
  const sternColumns = Math.max(1, Math.min(3, hideEmpty ? sternCount : layout.stern.length));
  const presentMiddle = (showPort ? 1 : 0) + 1 + (showStarboard ? 1 : 0);
  const middleCols = (showPort ? 1 : 0) + 2 + (showStarboard ? 1 : 0);
  const middleExtra = 12 * presentMiddle;
  // One card width that fits every row (middle, bow, stern) equally; shorter
  // rows centre. The lower bound keeps cards readable (and lets the deck scroll).
  const widthCandidates = [`calc((100cqw - ${middleExtra}px) / ${middleCols})`];
  if (showBow) widthCandidates.push(`calc((100cqw - ${4 * bowColumns + 4}px) / ${bowColumns})`);
  if (showStern) widthCandidates.push(`calc((100cqw - ${4 * sternColumns + 4}px) / ${sternColumns})`);
  const cardWidthCss = `max(64px, min(${widthCandidates.join(', ')}))`;
  const deckStyle = {
    containerType: 'inline-size' as const,
    ['--card-w' as string]: cardWidthCss,
  } as React.CSSProperties;
  const regionWidth = (columns: number): React.CSSProperties => ({
    width: `calc(${columns} * var(--card-w) + ${(columns - 1) * 4 + 8}px)`,
  });

  return (
    <div className="relative overflow-x-auto rounded-3xl border border-gray-700 bg-gray-900/40 px-1 py-1">
      <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[8px] uppercase tracking-widest text-gray-600">
        Port
      </span>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90 text-[8px] uppercase tracking-widest text-gray-600">
        Starboard
      </span>

      <div className="mx-auto space-y-1" style={deckStyle}>
        {showBow && (
          <div className="mx-auto" style={regionWidth(bowColumns)}>
            {renderRegion('bow', 'Bow', 'bow')}
          </div>
        )}

        <div className="text-center text-[8px] uppercase tracking-widest text-gray-600">360°</div>

        <div className="flex justify-center gap-1">
          {showPort && <div style={regionWidth(1)}>{renderRegion('port', 'Port', 'column')}</div>}
          <div style={regionWidth(2)}>{renderRegion('body', 'Body', 'body')}</div>
          {showStarboard && <div style={regionWidth(1)}>{renderRegion('starboard', 'Starboard', 'column')}</div>}
        </div>

        {showStern && (
          <div className="mx-auto" style={regionWidth(sternColumns)}>
            {renderRegion('stern', 'Stern', 'row')}
          </div>
        )}
      </div>
    </div>
  );
}
