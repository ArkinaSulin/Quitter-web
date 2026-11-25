// src/components/ShipRenderer/ShipLayout.tsx
// Region-container deck layout. Every purchased component/weapon is a card in a
// Bow / Port / Body / Starboard / Stern container. Weapons and non-combinable
// components get one card per unit. Cards can be dragged between slots (swap)
// and slots can be moved between regions from the context menu.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AllianceGroup, Unit } from '@/types/gameProtocol';
import { drawToken, loadImage } from '@/components/TokenRenderer/drawToken';
import {
  COMPONENT_NAMES,
  ShipBuild,
  ShipDerivedStats,
  componentById,
  componentByName,
  createDefaultDeckLayout,
  effectiveWeaponArcs,
  ensureCardSlot,
  ensureDeckSlot,
  findCardSlot,
  heroCheckBonus,
  bestCheckBonus,
  captaincyBonus,
  signedBonus,
  regionSlotAt,
  regionSlotCount,
  swapCards,
  weaponById,
  weaponTons,
  survivingSailRudder,
} from '@/packages/ships';
import { ShipDeckLayout, ShipDeckRegion, ShipDeckSlot } from '@/types/ship';
import { getSetting } from '@/packages/infra';
import { ShipComponentCard, ShipComponentCardData } from './ShipComponentCard';
import { BoundedTooltip } from '@/components/shared/BoundedTooltip';

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
  const [devicePixelRatio, setDevicePixelRatio] = useState(() => (
    typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1)
  ));
  const imageUrl = unit.customImageUrl || unit.unitTypeIconUrl || unit.raceIconUrl || '';
  // Max deck zoom is 200%: render at that size (times DPR) so the token is 1:1
  // and crisp at max zoom, then CSS scales it down as the deck zooms out.
  const renderScale = 2 * devicePixelRatio;
  const canvasWidth = Math.max(1, Math.ceil(width * renderScale));
  const canvasHeight = Math.max(1, Math.ceil(height * renderScale));

  useEffect(() => {
    const update = () => setDevicePixelRatio(Math.max(1, window.devicePixelRatio || 1));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

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
  }, [unit, teamAlliances, tick, canvasWidth, canvasHeight]);

  return (
    <canvas
      ref={ref}
      width={canvasWidth}
      height={canvasHeight}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}

const HERO_TOKEN_SCALE = 1.2;

function HeroTokenLayer({
  cardKey,
  heroes,
  teamAlliances,
  hideHeroTokens,
  deckZoom,
  onHeroDrop,
  onHeroDropToMap,
  onHeroHover,
  onHeroLeave,
  onHeroContextMenu,
}: {
  cardKey: string;
  heroes: ShipHeroToken[];
  teamAlliances?: Record<string, AllianceGroup>;
  hideHeroTokens?: boolean;
  deckZoom: number;
  onHeroDrop?: (heroId: string, fromCardKey: string, toCardKey: string, xPct: number, yPct: number) => void;
  onHeroDropToMap?: (heroId: string, clientX: number, clientY: number) => void;
  onHeroHover?: (hero: ShipHeroToken, event: React.MouseEvent) => void;
  onHeroLeave?: () => void;
  onHeroContextMenu?: (event: React.MouseEvent, hero: ShipHeroToken) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ heroId: string; fromCardKey: string; x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const zoom = Math.max(0.01, deckZoom);
      setSize({ w: rect.width / zoom, h: rect.height / zoom });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [deckZoom]);

  const tokenW = Math.max(1, Math.min(size.w, size.h) * HERO_TOKEN_SCALE);
  const tokenH = tokenW * 0.75;
  const hitW = tokenW * 0.5;
  const hitH = tokenH * 0.5;

  const openHeroMenu = (event: React.MouseEvent, hero: ShipHeroToken) => {
    // Non-GM: no team menu — let the right-click fall through to the card menu.
    if (!onHeroContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onHeroContextMenu(event, hero);
  };

  const startDrag = (event: React.PointerEvent, hero: ShipHeroToken) => {
    // Left-click/pen/touch only. A right-click must reach the context menu;
    // preventDefault here would start a drag and suppress `contextmenu`.
    if (event.button !== 0) return;
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
        const zoom = Math.max(0.01, deckZoom);
        // Horizontal: hitbox half (transparent edges may extrude).
        const halfW = Math.min((hitW / 2) * zoom, rect.width / 2);
        // Vertical: full token half (never spill onto cards above/below).
        const halfH = Math.min((tokenH / 2) * zoom, rect.height / 2);
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
            onMouseEnter={e => { e.stopPropagation(); onHeroHover?.(h, e); }}
            onMouseMove={e => { e.stopPropagation(); onHeroHover?.(h, e); }}
            onMouseLeave={e => { e.stopPropagation(); onHeroLeave?.(); }}
            onContextMenu={e => openHeroMenu(e, h)}
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
              onContextMenu={e => openHeroMenu(e, h)}
            />
          </div>
        );
      })}
      {drag && createPortal(
        <div
          className="pointer-events-none fixed z-[200] rounded-full border border-amber-300 bg-amber-400/30"
          style={{
            left: drag.x,
            top: drag.y,
            width: drag.w * deckZoom,
            height: drag.h * deckZoom,
            transform: 'translate(-50%, -50%)',
          }}
        />,
        document.body,
      )}
    </div>
  );
}

export function ShipLayout({
  build,
  stats,
  facing = 0,
  readOnly = false,
  hideEmpty = false,
  heroesByCard,
  boxState,
  cardStepsByCard,
  presentCrewByCard,
  occupantsByCard,
  weaponInfoByCard,
  cardFunctions,
  teamAlliances,
  hideHeroTokens = false,
  onHeroDrop,
  onHeroDropToMap,
  onHeroContextMenu,
  onDeckChange,
  onSlotContextMenu,
  onEmptySlotClick,
  revealAllCards = true,
  visibleCardKeys,
  cardToggles,
  onToggleCard,
  cardChecks,
  commandBonusByCard,
  targetOverlay,
}: {
  build: ShipBuild;
  stats: ShipDerivedStats;
  /** Runtime ship facing (0-5); the deck rotates while cards stay upright. */
  facing?: number;
  readOnly?: boolean;
  /** Skip vacant slots (the region boxes stay) — used by the compact runtime window. */
  hideEmpty?: boolean;
  /** Boarded heroes keyed by deck card key. */
  heroesByCard?: Record<string, ShipHeroToken[]>;
  /** Destroyed boxes per card key (1 ton = 1 box). */
  boxState?: Record<string, number>;
  /** Remaining card steps per card key this turn (runtime only). */
  cardStepsByCard?: Record<string, number>;
  /** Operating crew per card key (NPC + heroes). */
  presentCrewByCard?: Record<string, number>;
  /** Actual occupants (heroes first, then crew) per card key. */
  occupantsByCard?: Record<string, { id: string; name: string; isHero: boolean }[]>;
  /** Weapon damage/reload/fire state per weapon card key. */
  weaponInfoByCard?: Record<string, import('./ShipComponentCard').ShipCardWeaponInfo>;
  /** Station action buttons per card key. */
  cardFunctions?: Record<string, import('./ShipComponentCard').ShipCardFunction[]>;
  teamAlliances?: Record<string, AllianceGroup>;
  /** Shift/1 held: hide hero tokens so the card info is visible. */
  hideHeroTokens?: boolean;
  onHeroDrop?: (heroId: string, fromCardKey: string, toCardKey: string, xPct: number, yPct: number) => void;
  /** Dropped outside any card: try to disembark onto the scenario map. */
  onHeroDropToMap?: (heroId: string, clientX: number, clientY: number) => void;
  /** Right-click a boarded hero token (DM team assignment). */
  onHeroContextMenu?: (event: React.MouseEvent, hero: ShipHeroToken) => void;
  onDeckChange?: (layout: ShipDeckLayout) => void;
  onSlotContextMenu?: (
    event: React.MouseEvent,
    region: ShipDeckRegion,
    index: number,
    card?: ShipComponentCardData,
  ) => void;
  /** Auto-assign arm mode: card key -> enabled. */
  cardToggles?: Record<string, boolean>;
  onToggleCard?: (cardKey: string) => void;
  /** Left-click an empty Body slot to remove that exact slot (editor). */
  onEmptySlotClick?: (region: ShipDeckRegion, index: number) => void;
  /** When false, cards not in `visibleCardKeys` render name + boundary only. */
  revealAllCards?: boolean;
  visibleCardKeys?: string[];
  /** Best current occupant check per card, for the hover tooltip. */
  cardChecks?: Record<string, { label: string; bonus: number; name: string }>;
  /** Pending Int captaincy bonus per card key. */
  commandBonusByCard?: Record<string, number>;
  /**
   * Deck targeting mode (Bridge Command bonus / hull repair): eligible cards
   * take a click overlay instead of a separate picker list.
   */
  targetOverlay?: {
    keys: string[];
    label: (cardKey: string) => string;
    title: (card: ShipComponentCardData) => string;
    onTarget: (cardKey: string) => void;
  } | null;
}) {
  const c = build.components;
  const m = stats.massBreakdown;
  const deckComponent = componentByName(c, COMPONENT_NAMES.deck);
  const deckKey = `component:${deckComponent.id || 'deck'}`;
  const hullComponentForSlot = build.components.find(c => c.name === 'Hull');
  const hasLayout = !!build.deckLayout;
  const visibleCardSet = new Set(visibleCardKeys ?? []);
  let layout = build.deckLayout ? ensureDeckSlot(build.deckLayout, deckKey) : createDefaultDeckLayout();
  if (hullComponentForSlot) {
    layout = ensureCardSlot(layout, `component:${hullComponentForSlot.id || 'hull'}`);
  }
  const dragRef = useRef<{ region: ShipDeckRegion; index: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  const [contentSize, setContentSize] = useState({ w: 0, h: 0 });
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const minZoomRef = useRef(0.2);
  const initializedRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: React.ReactNode } | null>(null);
  const deckWidth = Math.max(80, viewportSize.w - 8);
  const facingStep = ((Math.floor(Number(facing) || 0) % 6) + 6) % 6;
  const layoutAngle = facingStep * 60;
  const counterRotate: React.CSSProperties | undefined = layoutAngle !== 0
    ? { transform: `rotate(${-layoutAngle}deg)` }
    : undefined;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportSize({ w: viewport.clientWidth, h: viewport.clientHeight - 8 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setContentSize({ w: content.offsetWidth, h: content.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);


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

  // No-box Hull exception: Hull is always shown, even at 0 tons/boxes, because
  // it remains the repair station.
  {
    const hullComponent = componentByName(c, COMPONENT_NAMES.hull);
    const hullKey = `component:${hullComponent.id || 'hull'}`;
    const hullDestroyed = m.hull > 0
      && Math.max(0, Number(boxState?.[hullKey] ?? 0)) >= m.hull;
    cards[hullKey] = {
      id: hullKey,
      cardKey: hullKey,
      name: 'Hull',
      tons: m.hull,
      ac: cardAc(hullComponent.ac),
      dt: cardDt(hullComponent.dt),
      crewRequired: hullDestroyed ? 0 : 3,
      // Hull circles only appear while occupied (heroes/crew placed by hand).
      crewSlots: [],
      safe: !hullComponent.hittable,
      note: hullComponent.effect || 'structural',
      kind: 'component',
      reinforced: reinforced(build, hullKey),
    };
  }

  if (build.sails > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.sail);
    const sailKey = `component:${comp.id || 'sail'}`;
    const surviving = survivingSailRudder(build, boxState ?? null);
    const unitTons = Math.max(1, Math.round(comp.mass || 1));
    if (comp.canCombine) {
      addComponentCard(
        sailKey,
        build.sails > 1 ? `Sail ×${build.sails}` : 'Sail',
        m.sails,
        surviving.sails > 0 ? Math.max(1, Math.ceil(surviving.sails / 4)) : 0,
        comp,
      );
    } else {
      for (let i = 0; i < build.sails; i += 1) {
        const key = `${sailKey}:${i}`;
        const destroyed = Math.max(0, Number(boxState?.[key] ?? 0));
        addComponentCard(key, 'Sail', unitTons, destroyed < unitTons ? 1 : 0, comp);
      }
    }
  }

  if (build.rudders > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.rudder);
    const rudderKey = `component:${comp.id || 'rudder'}`;
    const surviving = survivingSailRudder(build, boxState ?? null);
    const unitTons = Math.max(1, Math.round(comp.mass || 1.5));
    const unitCrew = Math.max(1, Math.ceil(comp.crew));
    if (comp.canCombine) {
      addComponentCard(
        rudderKey,
        build.rudders > 1 ? `Rudder ×${build.rudders}` : 'Rudder',
        m.rudders,
        surviving.rudders > 0 ? Math.max(1, Math.ceil(surviving.rudders / 2)) : 0,
        comp,
      );
    } else {
      for (let i = 0; i < build.rudders; i += 1) {
        const key = `${rudderKey}:${i}`;
        const destroyed = Math.max(0, Number(boxState?.[key] ?? 0));
        addComponentCard(key, 'Rudder', unitTons, destroyed < unitTons ? unitCrew : 0, comp);
      }
    }
  }

  if (m.cargo > 0) {
    const comp = componentByName(c, COMPONENT_NAMES.cargo);
    addComponentCard(`component:${comp.id || 'cargo'}`, 'Cargo', m.cargo, 0, comp);
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
        arcRotation: facingStep * 60,
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
    return !!card && !card.safe && (card.tons > 0 || card.name === 'Hull');
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
    if (card.name.startsWith('Rudder') || card.name.startsWith('Sail')) {
      // crewRequired already reflects surviving hardware boxes.
      if (card.crewRequired <= 0) return 'red';
      if (present <= 0) return 'red';
      return present >= card.crewRequired ? 'normal' : 'yellow';
    }
    // The hull is a repair station, not a crewed operating station.
    if (card.name === 'Hull') return 'normal';
    if (card.crewRequired > 0) {
      const required = Math.max(1, Math.ceil(card.crewRequired * (remaining / card.tons)));
      if (present <= 0) return 'red';
      return present >= required ? 'normal' : 'yellow';
    }
    return 'normal';
  };

  const slotCard = (s: ShipDeckSlot, region: ShipDeckRegion, index: number): ShipComponentCardData => {
    if (s.cardKey && cards[s.cardKey]) return cards[s.cardKey];
    const removable = !!onEmptySlotClick && region === 'body';
    const card = empty(removable ? 'Remove' : 'Empty');
    if (removable) {
      card.emptyGlyph = '\u00d7';
      card.onAdd = () => onEmptySlotClick!(region, index);
    }
    return card;
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
    const source = regionSlotAt(layout, from.region, from.index);
    const target = regionSlotAt(layout, region, index);
    if (!source || !target) return;
    onDeckChange(swapCards(layout, from, { region, index }));
  };

  const handleSlotMenu = (
    event: React.MouseEvent,
    region: ShipDeckRegion,
    index: number,
  ) => {
    // Never let the browser menu replace the deck/card menu (or appear when the
    // runtime window has no menu at all).
    event.preventDefault();
    if (!onSlotContextMenu) return;
    const s = regionSlotAt(layout, region, index);
    onSlotContextMenu(event, region, index, s?.cardKey ? cards[s.cardKey] : undefined);
  };

  const cardTooltip = (card: ShipComponentCardData) => {
    const key = card.cardKey;
    if (!key) return null;
    const occupants = occupantsByCard?.[key] ?? [];
    const present = presentCrewByCard?.[key] ?? occupants.length;
    const check = cardChecks?.[key];
    const info = weaponInfoByCard?.[key];
    return (
      <div className="space-y-0.5">
        <div className="text-[11px] font-semibold text-amber-200">{card.name}</div>
        <div className="text-gray-400">
          {card.tons}t - AC {card.ac} - DT {card.dt}
          {info ? ` - Damage ${info.damage}` : ''}
        </div>
        <div className="text-gray-400">
          {card.tons - Math.max(0, Math.min(card.tons, Number(boxState?.[key] ?? 0)))}/{card.tons} boxes intact
        </div>
        {typeof cardStepsByCard?.[key] === 'number' && (
          <div className="text-gray-400">{cardStepsByCard[key]}/5 card steps left this turn</div>
        )}
        {card.kind === 'weapon' && info && <div className="text-gray-400">{info.reloadLabel}</div>}
        <div className="text-gray-300">Crew {present}/{card.crewRequired}</div>
        {occupants.length > 0 && (
          <div className="text-gray-400">On card: {occupants.map(o => o.name).join(', ')}</div>
        )}
        {check && <div className="text-gray-300">{check.label}: {signedBonus(check.bonus)} ({check.name})</div>}
        {commandBonusByCard?.[key] !== undefined && (
          <div className="text-amber-300">Pending command bonus: {commandBonusByCard[key] > 0 ? '+' : ''}{commandBonusByCard[key]}</div>
        )}
        {card.note && <div className="text-gray-500">{card.note}</div>}
      </div>
    );
  };

  const heroTooltip = (hero: ShipHeroToken) => {
    const unit = hero.unit;
    return (
      <div className="space-y-0.5">
        <div className="text-[11px] font-semibold text-amber-200">{unit.unitName}</div>
        <div className="text-gray-400">Level {unit.level} - HP {unit.currentUnitHp}/{unit.maxUnitHp}</div>
        <div className="text-gray-300">
          Actions:{' '}
          <span className={unit.actionsAvailable <= 0 ? 'text-red-400' : ''}>
            {unit.actionsAvailable}/{getSetting('hero_actions_per_turn', 5)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 text-gray-300">
          <span>Repair: {signedBonus(heroCheckBonus(unit, 'str'))}</span>
          <span>Captaincy: {signedBonus(captaincyBonus(unit))}</span>
          <span>Weapon: {signedBonus(heroCheckBonus(unit, 'dex'))}</span>
          <span>Sail trimming: {signedBonus(heroCheckBonus(unit, 'int'))}</span>
          <span>Sail maxing: {signedBonus(heroCheckBonus(unit, 'con'))}</span>
          <span>Helm: {signedBonus(bestCheckBonus(unit, ['wis', 'int']))}</span>
        </div>
      </div>
    );
  };

  const renderSlot = (region: ShipDeckRegion, index: number) => {
    const s = regionSlotAt(layout, region, index) ?? { cardKey: null };
    const hidden = hideEmpty && (!s?.cardKey || !isRenderableCard(s.cardKey));
    if (hidden) {
      return <div key={`${region}-${index}`} className="invisible min-h-[110px] w-full" />;
    }
    const card = slotCard(s, region, index);
    const minimal = !revealAllCards && !!card.cardKey && !visibleCardSet.has(card.cardKey);
    const status = minimal ? 'normal' : cardStatus(card);
    const destroyedBoxes = !minimal && card.cardKey
      ? Math.max(0, Math.min(Math.round(card.tons), Number(boxState?.[card.cardKey] ?? 0)))
      : 0;
    const hasCardFunction = !minimal && !!card.cardKey && (
      !!weaponInfoByCard?.[card.cardKey]
      || (cardFunctions?.[card.cardKey]?.length ?? 0) > 0
    );
    const cardSteps = hasCardFunction && card.cardKey ? cardStepsByCard?.[card.cardKey] : undefined;
    const commandBonus = card.cardKey ? commandBonusByCard?.[card.cardKey] : undefined;
    const targetable = !!card.cardKey && !!targetOverlay
      && targetOverlay.keys.includes(card.cardKey);
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
        onMouseEnter={e => {
          if (!minimal && !card.empty && card.cardKey) setTooltip({ x: e.clientX, y: e.clientY, node: cardTooltip(card) });
        }}
        onMouseLeave={() => setTooltip(null)}
        className="relative h-full min-w-0"
        style={counterRotate}
      >
        <ShipComponentCard
          data={{ ...card, minimal, destroyedBoxes, cardSteps, commandBonus }}
          weaponInfo={!minimal && card.cardKey ? weaponInfoByCard?.[card.cardKey] : undefined}
          functions={!minimal && card.cardKey ? cardFunctions?.[card.cardKey] : undefined}
        />
        {targetable && card.cardKey && targetOverlay && (
          <button
            type="button"
            title={targetOverlay.title(card)}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); targetOverlay.onTarget(card.cardKey!); }}
            className="absolute inset-0 z-30 rounded-2xl border-2 border-amber-300 bg-amber-400/10 hover:bg-amber-400/25"
          >
            <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border border-amber-300 bg-gray-950/90 px-1 py-0.5 text-[9px] font-semibold text-amber-200">
              {targetOverlay.label(card.cardKey)}
            </span>
          </button>
        )}
        {!minimal && card.cardKey && cardToggles && card.cardKey in cardToggles && (
          <button
            type="button"
            title={cardToggles[card.cardKey] ? 'Enabled for Auto' : 'Skipped by Auto'}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onToggleCard?.(card.cardKey!); }}
            className={`absolute right-0.5 top-0.5 z-30 grid h-4 w-4 place-items-center rounded-full border text-[9px] font-bold ${
              cardToggles[card.cardKey]
                ? 'border-emerald-300 bg-emerald-700/80 text-emerald-100'
                : 'border-gray-500 bg-gray-800/90 text-gray-300'
            }`}
          >
            {cardToggles[card.cardKey] ? '\u2713' : '-'}
          </button>
        )}
        {status !== 'normal' && (
          <div
            className={`pointer-events-none absolute inset-0 rounded-2xl ${
              status === 'red' ? 'bg-red-600/25' : 'bg-yellow-500/20'
            }`}
          />
        )}
        {!minimal && card.cardKey && heroesByCard?.[card.cardKey]?.length ? (
          <HeroTokenLayer
            cardKey={card.cardKey}
            heroes={heroesByCard[card.cardKey]}
            teamAlliances={teamAlliances}
            hideHeroTokens={hideHeroTokens}
            deckZoom={camera.zoom}
            onHeroDrop={onHeroDrop}
            onHeroDropToMap={onHeroDropToMap}
            onHeroHover={(hero, event) => setTooltip({ x: event.clientX, y: event.clientY, node: heroTooltip(hero) })}
            onHeroLeave={() => setTooltip(null)}
            onHeroContextMenu={onHeroContextMenu}
          />
        ) : null}
      </div>
    );
  };

  const renderRowGroups = (region: ShipDeckRegion, rows: number[][]) =>
    rows.map((row, rowIndex) => (
      <div
        key={`${region}-row-${rowIndex}`}
        className="flex justify-center gap-1"
      >
        {row.map(index => (
          <div key={`${region}-${index}`} style={{ width: cardWidthPx }}>
            {renderSlot(region, index)}
          </div>
        ))}
      </div>
    ));

  const renderSlotRows = (region: ShipDeckRegion, indices: number[], rowSize = 3) => {
    const rows: number[][] = [];
    for (let i = 0; i < indices.length; i += rowSize) rows.push(indices.slice(i, i + rowSize));
    return renderRowGroups(region, rows);
  };

  // Body rows are explicit (1–2 slots); a lone slot centres via justify-center.
  const renderBodyRows = (region: ShipDeckRegion) => {
    const rows: number[][] = [];
    let running = 0;
    for (const row of layout.body) {
      rows.push(Array.from({ length: row.length }, (_, col) => running + col));
      running += row.length;
    }
    return renderRowGroups(region, rows);
  };

  const cardCount = (region: ShipDeckRegion): number => {
    let count = 0;
    const total = regionSlotCount(layout, region);
    for (let i = 0; i < total; i += 1) {
      if (isRenderableCard(regionSlotAt(layout, region, i)?.cardKey ?? null)) count += 1;
    }
    return count;
  };

  const renderRegion = (
    region: ShipDeckRegion,
    label: string,
    mode: 'row' | 'column' | 'body' | 'bow',
    wrapperClass = '',
    wrapperStyle?: React.CSSProperties,
  ) => {
    const indices = Array.from({ length: regionSlotCount(layout, region) }, (_, i) => i);
    const hiddenRegion = hideEmpty && cardCount(region) === 0;
    return (
      <div
        className={`shrink-0 rounded-2xl bg-gray-900/30 px-1 py-1 ring-2 ring-inset ring-gray-600/80 ${hiddenRegion ? 'invisible' : ''} ${wrapperClass}`}
        style={wrapperStyle}
      >
        <div className="mb-1 text-center text-[8px] uppercase tracking-widest text-gray-500" style={counterRotate}>
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
            renderSlotRows(region, indices, 3)
          ) : mode === 'body' ? (
            renderBodyRows(region)
          ) : (
            indices.map(i => renderSlot(region, i))
          )}
        </div>
      </div>
    );
  };

  // Hidden regions keep their grid columns/rows reserved (like the Ship
  // Editor) so visible cards never stretch or change position. Only the boxes
  // and cards themselves become invisible.
  const showBow = layout.bow.length > 0;
  const showStern = layout.stern.length > 0;
  const showPort = layout.port.length > 0;
  const showStarboard = layout.starboard.length > 0;
  const bowColumns = Math.max(1, Math.min(3, layout.bow.length));
  const sternColumns = Math.max(1, Math.min(3, layout.stern.length));
  const presentMiddle = (showPort ? 1 : 0) + 1 + (showStarboard ? 1 : 0);
  const middleCols = (showPort ? 1 : 0) + 2 + (showStarboard ? 1 : 0);
  const middleExtra = 12 * presentMiddle;
  const widthCandidates = [(deckWidth - middleExtra) / middleCols];
  if (showBow) widthCandidates.push((deckWidth - (4 * bowColumns + 4)) / bowColumns);
  if (showStern) widthCandidates.push((deckWidth - (4 * sternColumns + 4)) / sternColumns);
  const cardWidthPx = Math.max(64, Math.min(...widthCandidates));
  const contentWidth = Math.max(
    deckWidth,
    middleCols * cardWidthPx + middleExtra,
    showBow ? bowColumns * cardWidthPx + (bowColumns - 1) * 4 + 8 : 0,
    showStern ? sternColumns * cardWidthPx + (sternColumns - 1) * 4 + 8 : 0,
  );
  const regionWidth = (columns: number): React.CSSProperties => ({
    width: columns * cardWidthPx + (columns - 1) * 4 + 8,
  });

  const contentHeight = Math.max(1, contentSize.h);
  const fitScale = Math.min(
    1,
    viewportSize.w > 0 ? viewportSize.w / contentWidth : 1,
    viewportSize.h > 0 ? viewportSize.h / contentHeight : 1,
  );

  useEffect(() => {
    if (!viewportSize.w || !viewportSize.h || contentSize.h <= 0) return;
    minZoomRef.current = Math.max(0.1, fitScale);
    if (!initializedRef.current) {
      initializedRef.current = true;
      setCamera({
        zoom: fitScale,
        x: (viewportSize.w - contentWidth * fitScale) / 2,
        y: (viewportSize.h - contentHeight * fitScale) / 2,
      });
      return;
    }
    setCamera(current => {
      if (current.zoom >= fitScale) return current;
      return {
        zoom: fitScale,
        x: (viewportSize.w - contentWidth * fitScale) / 2,
        y: (viewportSize.h - contentHeight * fitScale) / 2,
      };
    });
  }, [viewportSize.w, viewportSize.h, contentWidth, contentHeight, fitScale, contentSize.h]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = viewport.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      setCamera(current => {
        const nextZoom = Math.max(
          minZoomRef.current,
          Math.min(2, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1)),
        );
        if (nextZoom === current.zoom) return current;
        const worldX = (mx - current.x) / current.zoom;
        const worldY = (my - current.y) / current.zoom;
        return {
          zoom: nextZoom,
          x: mx - worldX * nextZoom,
          y: my - worldY * nextZoom,
        };
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  const onPanDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    panRef.current = { x: e.clientX, y: e.clientY, ox: camera.x, oy: camera.y };
    setPanning(true);
    const move = (ev: MouseEvent) => {
      const pan = panRef.current;
      if (!pan) return;
      setCamera(current => ({
        ...current,
        x: pan.ox + (ev.clientX - pan.x),
        y: pan.oy + (ev.clientY - pan.y),
      }));
    };
    const up = () => {
      panRef.current = null;
      setPanning(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const deckStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: contentWidth,
    transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
    transformOrigin: 'top left',
  } as React.CSSProperties;

  if (!hasLayout) {
    return (
      <div className="rounded-3xl border border-gray-700 bg-gray-900/40 p-4 text-[11px] text-gray-500">
        Deck layout unavailable.
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative h-full min-h-0">
    <div
      ref={viewportRef}
      className={`relative h-full w-full overflow-hidden rounded-3xl border border-gray-700 bg-gray-900/40 px-1 py-1 ${panning ? 'cursor-grabbing' : ''}`}
      onMouseDown={onPanDown}
      onAuxClick={e => { if (e.button === 1) e.preventDefault(); }}
    >
      {layoutAngle === 0 && (
        <>
          <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[8px] uppercase tracking-widest text-gray-600">
            Port
          </span>
          <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90 text-[8px] uppercase tracking-widest text-gray-600">
            Starboard
          </span>
        </>
      )}

      <div ref={contentRef} className="space-y-1" style={deckStyle}>
        <div
          className="space-y-1"
          style={{
            transform: `rotate(${layoutAngle}deg)`,
            transformOrigin: 'center center',
          }}
        >
          {showBow && (
            <div className="mx-auto shrink-0" style={regionWidth(bowColumns)}>
              {renderRegion('bow', 'Bow', 'bow')}
            </div>
          )}

          <div className="text-center text-[8px] uppercase tracking-widest text-gray-600" style={counterRotate}>360°</div>

          <div className="flex min-w-max justify-center gap-1">
            {showPort && <div className="shrink-0" style={regionWidth(1)}>{renderRegion('port', 'Port', 'column')}</div>}
            <div className="shrink-0" style={regionWidth(2)}>{renderRegion('body', 'Body', 'body')}</div>
            {showStarboard && <div className="shrink-0" style={regionWidth(1)}>{renderRegion('starboard', 'Starboard', 'column')}</div>}
          </div>

          {showStern && (
            <div className="mx-auto shrink-0" style={regionWidth(sternColumns)}>
              {renderRegion('stern', 'Stern', 'row')}
            </div>
          )}
        </div>
      </div>
    </div>
    {tooltip && (
      <BoundedTooltip boundsRef={rootRef} x={tooltip.x} y={tooltip.y}>
        {tooltip.node}
      </BoundedTooltip>
    )}
    </div>
  );
}
