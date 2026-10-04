'use client';
// src/components/ScenarioMap/useCanvasDraw.ts
// Canvas rendering for the scenario map: live token drawing (customDraw, fed
// into useHexGrid) and the GM screenshot capture. Both are pure functions of
// the passed-in state — no handlers, no DB access.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { hexToPixel } from '@/hooks/useHexGrid';
import { Unit, Hex, AllianceGroup, Formation, SizeCategory, GroundEffect } from '@/types/gameProtocol';
import { drawToken, loadImage, getLoadedImage, drawArcherReactionButton } from '@/components/TokenRenderer/drawToken';
import { computeEffectiveMoraleModifier } from '@/lib/unitMorale';
import { isDeadCorpse } from '@/lib/unitInteractions';
import { corpseDots, FallenMap } from '@/lib/corpseTracker';
import { TEAM_COLORS, Team } from '@/components/TokenRenderer/tokenUtils';
import { DEFAULT_GRID_RADIUS, HEX_SIZE, TOKEN_HEIGHT, TOKEN_WIDTH, tokenDrawOrder, getAttachedHeroPos, elevationOffset, canFly, MapBackgroundConfig, costShade, hexMpLabelAt } from './mapGeometry';
import { parseClimbTo, hexDirection } from '@/lib/flying';
import { FOG_RGB } from '@/lib/fogOfWar';
import { Walls, EdgeRef, wallHp, edgeRef } from '@/lib/walls';
import { MapStructures, isHexStructureKey, structureSurfaceAt, structureWaivesClimb } from '@/lib/mapStructures';
import { structureHasLadder } from '@/lib/structureTemplates';
import { StructureTemplate } from '@/types/structure';
import { strokeFillText, fillHexPath, structureBadges, MP_COST_GREY } from '@/components/shared/mapFeatureDraw';
import { battlementPath, battlementDepth, crossMarksPath, sineWavePath, ladderPaths } from '@/lib/structureDraw';
import { AiOverlayData } from './aiTypes';

interface CanvasDrawDeps {
  canvasRef: RefObject<HTMLCanvasElement>;
  units: Unit[];
  displayUnits: Unit[];
  displayAlliances: Record<string, AllianceGroup>;
  displayTurnNumber: number;
  isGM: boolean;
  fogReveal: Set<string> | null;
  fogDim: Map<string, number> | null;
  fogUnseenAlpha: number | null;
  formationsMap: Record<string, Formation>;
  sizeCategories: SizeCategory[];
  activeHeroId: string | null;
  reactionOffers: Map<string, string>;
  reactionMode: { archer: Unit } | null;
  bowBlinkOn: boolean;
  canReactToUnit: (unit: Unit) => boolean;
  alliances: Record<string, AllianceGroup>;
  backgroundConfig: MapBackgroundConfig | null;
  walls?: Walls;
  /** Placed structures + templates (hex structure rendering; battlement aura). */
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  /** Wall edge highlighted while dragging a unit over it (drag-to-attack). */
  hoveredWallEdge?: EdgeRef | null;
  /** Inspect mode (Shift held): hide all unit/hero tokens and corpse piles,
   *  except `keepVisibleUnitId` (the unit currently being dragged). */
  hideUnits?: boolean;
  keepVisibleUnitId?: string | null;
  /** Air-only view (Space held): hide ground units (elevation 0), show flyers. */
  hideGroundUnits?: boolean;
  groundZones?: GroundEffect[];
  /** Effective zones (painted + hex-structure modifiers) for the MP-cost label. */
  mpZones?: GroundEffect[];
  scenarioId: string;
  updateScreenshot: (scenarioId: string, file: File) => Promise<void>;
  /** Per-hex fallen-troop piles (decorative corpses), from the log. */
  corpseCounts?: FallenMap;
  /** AI assist overlay (checkmarks + preview routes). Optional. */
  aiOverlay?: AiOverlayData | null;
  /** Unit currently hovered on the map — highlights its AI route. */
  aiHoveredUnitId?: string | null;
}

export function useCanvasDraw(deps: CanvasDrawDeps) {
  const {
    canvasRef,
    units,
    displayUnits,
    displayAlliances,
    displayTurnNumber,
    isGM,
    fogReveal,
    fogDim,
    fogUnseenAlpha,
    formationsMap,
    sizeCategories,
    activeHeroId,
    reactionOffers,
    reactionMode,
    bowBlinkOn,
    canReactToUnit,
    alliances,
    backgroundConfig,
    walls,
    structures,
    templates,
    hoveredWallEdge,
    hideUnits = false,
    keepVisibleUnitId = null,
    hideGroundUnits = false,
    groundZones,
    mpZones,
    scenarioId,
    updateScreenshot,
    corpseCounts,
    aiOverlay,
    aiHoveredUnitId,
  } = deps;

  // Effect artwork is loaded asynchronously; bump a tick once the set decodes so
  // the canvas redraws (customDraw itself stays synchronous via getLoadedImage).
  const [imageTick, setImageTick] = useState(0);
  const effectImageUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const z of groundZones ?? []) if (z.imageUrl) urls.add(z.imageUrl);
    for (const u of displayUnits) {
      if (u.isDeleted) continue;
      for (const e of u.effects ?? []) if (e.imageUrl && !e.zoneHex) urls.add(e.imageUrl);
    }
    for (const inst of Object.values(structures ?? {})) {
      const t = templates?.[inst.templateId];
      if (t?.imageUrl) urls.add(t.imageUrl);
    }
    return Array.from(urls).sort().join('|');
  }, [groundZones, displayUnits, structures, templates]);

  useEffect(() => {
    const urls = effectImageUrls ? effectImageUrls.split('|') : [];
    if (urls.length === 0) return;
    let cancelled = false;
    Promise.all(urls.map(u => loadImage(u).catch(() => null))).then(() => {
      if (!cancelled) setImageTick(t => t + 1);
    });
    return () => { cancelled = true; };
  }, [effectImageUrls]);

  // Per-unit effective morale modifier (incl. formation + current modifier), computed
  // ONCE per units/alliances/formations change — not per redraw. The token loop
  // only looks it up, removing O(n²) rule math from the draw hot path.
  const moraleMods = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of displayUnits) {
      if (u.isDeleted) continue;
      const formation = formationsMap[u.currentFormation] ?? null;
      m.set(u.id, u.currentMoraleModifier + computeEffectiveMoraleModifier(u, displayUnits, displayAlliances, formation));
    }
    return m;
  }, [displayUnits, displayAlliances, formationsMap]);

  const customDraw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, currentZoom: number, offsetX: number, offsetY: number) => {
    const tokenWidth = TOKEN_WIDTH * currentZoom;
    const tokenHeight = TOKEN_HEIGHT * currentZoom;

    // One pass over the units: hostId -> attached hero (avoids a find per token).
    const attachedByHost = new Map<string, Unit>();
    for (const u of displayUnits) {
      if (u.attachedToUnitId && !u.isDeleted) attachedByHost.set(u.attachedToUnitId, u);
    }

    // Corpses (HP <= 0) draw first so live tokens stacked on their hex render on top.
    const drawOrder = [...displayUnits].sort(tokenDrawOrder);

    // Ground effects + painted terrain tints (drawn beneath tokens; fog drawn last
    // covers the unseen). Visible only where the viewer can see when fog is on.
    const hexCenter = (hex: Hex) => {
      const pos = hexToPixel(hex, HEX_SIZE);
      return { cx: pos.x * currentZoom + offsetX, cy: pos.y * currentZoom + offsetY };
    };
    const fillHex = (hex: Hex, color: string) => {
      const { cx, cy } = hexCenter(hex);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        const px = cx + HEX_SIZE * currentZoom * Math.cos(angle);
        const py = cy + HEX_SIZE * currentZoom * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    const strokeHex = (hex: Hex, color: string, width: number) => {
      const { cx, cy } = hexCenter(hex);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        const px = cx + HEX_SIZE * currentZoom * Math.cos(angle);
        const py = cy + HEX_SIZE * currentZoom * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const isFogHidden = (key: string) => !!fogReveal && !fogReveal.has(key);

    // Effect artwork on hexes. "below" draws under corpses/tokens (here);
    // "above" draws after the token loop. A hex whose unit is hovered skips its
    // "above" artwork so the token stays inspectable.
    const drawEffectImage = (hex: Hex, url: string, scale: number, elevation: number, structTop: number) => {
      const img = getLoadedImage(url);
      if (!img) return;
      const { cx, cy } = hexCenter(hex);
      const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
      const h = tokenHeight * ((scale || 100) / 100);
      const w = h * ratio;
      // Elevated effects offset like tokens: level 1 (half) when the effect sits at
      // the structure top, level 2 (full) + a ground shadow when above it.
      const level = elevation > 0 ? (elevation > structTop ? 2 : 1) : 0;
      const dist = HEX_SIZE * currentZoom * 0.5 * level * Math.SQRT1_2;
      const dx = dist, dy = -dist;
      if (level === 2) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.32, w * 0.13, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(img, cx - w / 2 + dx, cy - h / 2 + dy, w, h);
      ctx.restore();
    };
    const belowImages: { hex: Hex; url: string; z: number; scale: number; elevation: number; structTop: number }[] = [];
    const aboveImages: { hex: Hex; url: string; z: number; scale: number; elevation: number; structTop: number }[] = [];
    const pushEffectImage = (hex: Hex, url: string, layer: 'above' | 'below', z: number, scale: number, elevation = 0) => {
      if (!url || isFogHidden(`${hex.q},${hex.r}`)) return;
      const structTop = structureSurfaceAt(hex, structures, templates);
      (layer === 'above' ? aboveImages : belowImages).push({ hex, url, z, scale, elevation, structTop });
    };
    for (const z of groundZones ?? []) {
      if (z.imageUrl) pushEffectImage({ q: z.q, r: z.r, s: -z.q - z.r }, z.imageUrl, z.layer ?? 'below', z.zIndex ?? 0, z.imageScale ?? 100, z.elevation ?? 0);
    }
    for (const u of displayUnits) {
      if (u.isDeleted || u.attachedToUnitId) continue;
      for (const e of u.effects ?? []) {
        if (e.imageUrl && !e.zoneHex) pushEffectImage(u.hex, e.imageUrl, e.layer ?? 'below', 0, e.imageScale ?? 100);
      }
    }
    for (const im of belowImages) drawEffectImage(im.hex, im.url, im.scale, im.elevation, im.structTop);
    const hoveredHexKey = (() => {
      const hu = displayUnits.find(u => u.id === aiHoveredUnitId);
      return hu ? `${hu.hex.q},${hu.hex.r}` : null;
    })();
    if (groundZones && groundZones.length > 0) {
      for (const z of [...groundZones].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))) {
        const key = `${z.q},${z.r}`;
        if (isFogHidden(key)) continue;
        const c = z.color || '#ff7043';
        ctx.save();
        if (!z.transparentBackground) {
          ctx.globalAlpha = 0.15;
          fillHex({ q: z.q, r: z.r, s: -z.q - z.r }, c);
        }
        ctx.globalAlpha = 0.9;
        const { cx, cy } = hexCenter({ q: z.q, r: z.r, s: -z.q - z.r });
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, 6 * currentZoom), 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      }
    }
    // MP-cost numbers (foot/mounted) from hex structures + mp_cost zones — the
    // "higher of the two" board label. Drawn beneath the hex structures and tokens.
    const mpHexKeys = new Set<string>();
    if (structures) for (const key of Object.keys(structures)) if (isHexStructureKey(key)) mpHexKeys.add(key);
    if (mpZones) for (const z of mpZones) if (z.kind === 'mp_cost') mpHexKeys.add(`${z.q},${z.r}`);
    if (mpHexKeys.size > 0) {
      ctx.save();
      // Capped at 1/3 of the hex's rendered height so the number never dwarfs a
      // zoomed-out hex (pointy-top height = 2 × circumradius).
      const hexHeightPx = 2 * HEX_SIZE * currentZoom;
      const mpFont = `bold ${Math.min(39, hexHeightPx / 3)}px ui-monospace, monospace`;
      for (const key of Array.from(mpHexKeys)) {
        if (isFogHidden(key)) continue;
        const [q, r] = key.split(',').map(Number);
        if (Number.isNaN(q) || Number.isNaN(r)) continue;
        const label = hexMpLabelAt({ q, r }, structures, templates, mpZones);
        if (!label) continue;
        const shade = label.blocked ? 'rgba(220, 38, 38, 0.4)' : costShade(label.cost);
        const { cx, cy } = hexCenter({ q, r, s: -q - r });
        if (shade) fillHexPath(ctx, cx, cy, HEX_SIZE * currentZoom, shade);
        strokeFillText(ctx, cx, cy, label.text, mpFont, 4, MP_COST_GREY, 'rgba(0,0,0,0)');
      }
      ctx.restore();
    }

    // Hex structures (gates/towers): tint + artwork + HP/door badge, drawn under
    // the edge walls and tokens.
    if (structures && Object.keys(structures).length > 0) {
      ctx.save();
      for (const key of Object.keys(structures)) {
        if (!isHexStructureKey(key)) continue;
        const [q, r] = key.split(',').map(Number);
        if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
        if (isFogHidden(`${q},${r}`)) continue;
        const inst = structures[key];
        const t = templates?.[inst.templateId];
        const hx = { q, r, s: -q - r };
        // Transparent background: a thick black outline only (no colour tint) —
        // unless the template opts out (decorative hexes: `hex_border` false).
        if (t?.hexBorder !== false) strokeHex(hx, 'rgba(0,0,0,0.95)', Math.max(3, 5 * currentZoom));
        const { cx, cy } = hexCenter(hx);
        if (t?.imageUrl) {
          const img = getLoadedImage(t.imageUrl);
          if (img && img.complete && img.naturalWidth > 0) {
            const h = 1.2 * HEX_SIZE * currentZoom;
            const w = (img.naturalWidth / img.naturalHeight) * h;
            ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
          }
        }
        const badges = structureBadges(t, inst);
        const ly = cy - HEX_SIZE * currentZoom * 0.55;
        if (badges.destroyed) {
          strokeFillText(ctx, cx, ly, '✕', `bold ${Math.max(11, 12 * currentZoom)}px ui-monospace, monospace`, Math.max(2, 3 * currentZoom), MP_COST_GREY);
        } else if (badges.hpText !== null) {
          strokeFillText(ctx, cx, ly, badges.hpText, `bold ${Math.max(11, 12 * currentZoom)}px ui-monospace, monospace`, Math.max(2, 3 * currentZoom), '#ffe0b2');
        }
        if (badges.doorText) {
          strokeFillText(ctx, cx, cy + HEX_SIZE * currentZoom * 0.55, badges.doorText, `bold ${Math.max(10, 11 * currentZoom)}px ui-monospace, monospace`, Math.max(2, 3 * currentZoom), badges.doorOpen ? '#a5d6a7' : '#ffd9c9');
        }
      }
      ctx.restore();
    }

    // Edge walls/barriers: a thick segment along the shared edge, styled by
    // property (blocked = near-black, moveCost = tan, AC-only = steel). Drawn
    // over the terrain shade, under tokens.
    if (walls && Object.keys(walls).length > 0) {
      ctx.save();
      ctx.lineCap = 'round';
      const cornerScreen = (q: number, r: number, i: number) => {
        const { cx, cy } = hexCenter({ q, r, s: -q - r });
        const angle = (Math.PI / 180) * (60 * ((i % 6 + 6) % 6) - 30);
        return { x: cx + HEX_SIZE * currentZoom * Math.cos(angle), y: cy + HEX_SIZE * currentZoom * Math.sin(angle) };
      };
      for (const key of Object.keys(walls)) {
        const [q, r, d] = key.split(',').map(Number);
        if (!Number.isFinite(q) || !Number.isFinite(r) || !Number.isFinite(d)) continue;
        if (isFogHidden(`${q},${r}`)) continue;
        const w = walls[key];
        const destructible = (w.maxHp ?? 0) > 0;
        const damaged = destructible && wallHp(w) < (w.maxHp ?? 0);
        const inst = structures?.[key];
        const t = inst ? templates?.[inst.templateId] : undefined;
        const decoration = t?.sinWave ? 'sinWave' : t?.barricade ? 'barricade' : t?.battlement ? 'battlement' : 'none';
        const a = cornerScreen(q, r, d);
        const b = cornerScreen(q, r, d + 1);
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        // Ladder (variant C): a trapezoid ladder — 3 rungs parallel to the edge
        // (short on the lower hex side, long on the higher), rails leaning against
        // the rung ends and extruded past them. Auto-oriented from the surfaces.
        // Drawn for any edge structure with the `ladder` decoration flag OR an
        // `ignore_climb` modifier (the latter keeps old effect-based stairs drawn).
        if (inst && t && (structureHasLadder(t, inst) || structureWaivesClimb(inst, t))) {
          const ref = edgeRef(q, r, d);
          const sA = structureSurfaceAt({ q: ref.aq, r: ref.ar }, structures, templates);
          const sB = structureSurfaceAt({ q: ref.bq, r: ref.br }, structures, templates);
          const ca = hexCenter({ q: ref.aq, r: ref.ar, s: -ref.aq - ref.ar });
          const cb = hexCenter({ q: ref.bq, r: ref.br, s: -ref.bq - ref.br });
          const hi = sB >= sA ? cb : ca;
          const { rungs, rails } = ladderPaths(a, b, { x: hi.cx, y: hi.cy });
          ctx.save();
          ctx.strokeStyle = '#c49a58';
          ctx.lineCap = 'round';
          ctx.lineWidth = Math.max(2, 3 * currentZoom);
          ctx.stroke(new Path2D(rungs));
          ctx.lineWidth = Math.max(1.5, 2 * currentZoom);
          ctx.stroke(new Path2D(rails));
          ctx.restore();
          if (hoveredWallEdge && hoveredWallEdge.key === key) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 140, 60, 0.95)';
            ctx.lineWidth = 11 * currentZoom;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.restore();
          }
          continue;
        }
        // Battlement (and plain edges) draw the thick base line; a barricade / sin
        // wave draws only its marks, centred on the edge.
        if (decoration !== 'barricade' && decoration !== 'sinWave') {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
          ctx.lineWidth = 6 * currentZoom;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        if (decoration !== 'none' && inst) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
          ctx.lineWidth = 2 * currentZoom;
          let d2 = '';
          if (decoration === 'battlement') {
            const ref = edgeRef(q, r, d);
            const outsideIsA = (inst.outside ?? 'a') === 'a';
            const oc = hexCenter({ q: outsideIsA ? ref.aq : ref.bq, r: outsideIsA ? ref.ar : ref.br, s: 0 });
            let nx = oc.cx - (a.x + b.x) / 2;
            let ny = oc.cy - (a.y + b.y) / 2;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            d2 = battlementPath(a, b, { x: nx, y: ny }, battlementDepth(seg, 8), 8);
          } else if (decoration === 'barricade') {
            d2 = crossMarksPath(a, b, battlementDepth(seg, 8), 8);
          } else {
            d2 = sineWavePath(a, b, battlementDepth(seg, 8), 2);
          }
          ctx.stroke(new Path2D(d2));
        }
        // Damaged barriers show their remaining HP at the segment midpoint.
        if (damaged) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const label = `${wallHp(w)}/${w.maxHp}`;
          ctx.font = `bold ${Math.max(11, 12 * currentZoom)}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = Math.max(2, 3 * currentZoom);
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
          ctx.strokeText(label, mx, my);
          ctx.fillStyle = '#ffd9c9';
          ctx.fillText(label, mx, my);
        }
        // Drag-to-attack hint: the edge under the pointer gets a bright cap.
        if (hoveredWallEdge && hoveredWallEdge.key === key) {
          ctx.strokeStyle = 'rgba(255, 140, 60, 0.95)';
          ctx.lineWidth = 11 * currentZoom;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Structure + effect elevation badges (DISPLAY only): the feet value just
    // under the hex's north vertex. The effect badge sits slightly lower and is
    // hidden when its elevation equals the structure's. 0 = no height = no badge.
    {
      const structureTop = new Map<string, number>();
      if (structures) {
        for (const key of Object.keys(structures)) {
          if (!isHexStructureKey(key)) continue; // edge walls don't define a hex surface
          const [q, r] = key.split(',').map(Number);
          if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
          const inst = structures[key];
          const t = templates?.[inst.templateId];
          const top = Math.max(0, Math.round(inst.elevation ?? t?.elevation ?? 0));
          if (top > 0) structureTop.set(`${q},${r}`, top);
        }
      }
      const effectTop = new Map<string, number>();
      for (const z of groundZones ?? []) {
        const e = Math.max(0, Math.round(z.elevation ?? 0));
        if (e <= 0) continue;
        const key = `${z.q},${z.r}`;
        const cur = effectTop.get(key);
        if (cur === undefined || e > cur) effectTop.set(key, e);
      }
      const badgeKeys = Array.from(structureTop.keys()).concat(Array.from(effectTop.keys()));
      if (badgeKeys.length > 0) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const sFont = `bold ${Math.max(10, 12 * currentZoom)}px ui-monospace, monospace`;
        const eFont = `bold ${Math.max(9, 11 * currentZoom)}px ui-monospace, monospace`;
        for (const key of badgeKeys) {
          if (isFogHidden(key)) continue;
          const [q, r] = key.split(',').map(Number);
          if (Number.isNaN(q) || Number.isNaN(r)) continue;
          const top = structureTop.get(key) ?? 0;
          const eff = effectTop.get(key) ?? 0;
          const { cx, cy } = hexCenter({ q, r, s: -q - r });
          const baseY = cy - HEX_SIZE * currentZoom * 0.72;
          if (top > 0) {
            ctx.font = sFont;
            ctx.lineWidth = Math.max(2, 3 * currentZoom);
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.strokeText(`${top}`, cx, baseY);
            ctx.fillStyle = '#ffe0b2';
            ctx.fillText(`${top}`, cx, baseY);
          }
          if (eff > 0 && eff !== top) {
            const y = baseY + HEX_SIZE * currentZoom * 0.17;
            ctx.font = eFont;
            ctx.lineWidth = Math.max(2, 3 * currentZoom);
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.strokeText(`${eff}`, cx, y);
            ctx.fillStyle = '#b2e0ff';
            ctx.fillText(`${eff}`, cx, y);
          }
        }
        ctx.restore();
      }
    }

    // Decorative fallen-troop piles: dots per hex with deaths (positions seeded
    // by q+r so the scatter is stable as piles grow). Each dot mirrors its dead
    // unit: team colour, mounted = triangle vs foot = circle, radius from size.
    // Drawn UNDER live tokens; corpses never occupy hexes or interact with rules.
    if (corpseCounts && !hideUnits) {
      ctx.save();
      for (const [key, groups] of Object.entries(corpseCounts)) {
        if (!groups || groups.length === 0) continue;
        if (isFogHidden(key)) continue; // corpses never reveal through fog
        const [q, r] = key.split(',').map(Number);
        if (Number.isNaN(q) || Number.isNaN(r)) continue;
        const dots = corpseDots(q, r, groups);
        if (dots.length === 0) continue;
        const c = hexCenter({ q, r, s: -q - r });
        for (const dot of dots) {
          const cr = Math.max(1.2, HEX_SIZE * currentZoom * 0.03 * (dot.visualScale / 100) * (dot.sizeCategory / 100));
          const x = c.cx + dot.dx * HEX_SIZE * currentZoom;
          const y = c.cy + dot.dy * HEX_SIZE * currentZoom;
          const color = TEAM_COLORS[dot.team as Team] || '#9e9e9e';
          ctx.beginPath();
          if (dot.mounted) {
            ctx.moveTo(x, y - cr * 1.15);
            ctx.lineTo(x - cr * 1.0, y + cr * 0.8);
            ctx.lineTo(x + cr * 1.0, y + cr * 0.8);
            ctx.closePath();
          } else {
            ctx.arc(x, y, cr, 0, 2 * Math.PI);
          }
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    for (const unit of drawOrder) {
      if (unit.isDeleted || unit.attachedToUnitId || isDeadCorpse(unit)) continue;
      // Inspect mode: hide every token except the unit being dragged (or a host
      // whose attached hero is being dragged).
      if (hideUnits && unit.id !== keepVisibleUnitId && attachedByHost.get(unit.id)?.id !== keepVisibleUnitId) continue;
      // Air-only view (Space): hide ground units, keep flyers.
      if (hideGroundUnits && (unit.elevation ?? 0) <= 0) continue;
      if (unit.hidden) {
        if (!isGM) continue;
        ctx.save();
        ctx.globalAlpha = 0.3;
      }
      const formationMoraleMod = formationsMap[unit.currentFormation] ?? null;
      const pos = hexToPixel(unit.hex, HEX_SIZE);
      const cx = pos.x * currentZoom + offsetX;
      const cy = pos.y * currentZoom + offsetY;
      // A climber offsets TOWARD its target hex (stage-1 magnitude); a normal
      // elevated unit uses the NE default (flyer = full, ground = half).
      const climbTarget = parseClimbTo(unit.climbTo);
      const elev = elevationOffset(
        unit.elevation, HEX_SIZE,
        canFly(unit) && !climbTarget,
        climbTarget ? hexDirection(unit.hex, climbTarget, HEX_SIZE) : undefined,
      );
      const tokenCx = cx + elev.dx * currentZoom;
      const tokenCy = cy + elev.dy * currentZoom;
      const unitMoraleMod = moraleMods.get(unit.id) ?? (unit.currentMoraleModifier + computeEffectiveMoraleModifier(unit, displayUnits, displayAlliances, formationMoraleMod));
      // Shadow dot on the ground hex under an elevated token.
      if ((unit.elevation ?? 0) > 0) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(cx, cy, tokenWidth * 0.3, tokenHeight * 0.12, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      }
      try {
        drawToken({
          unit: { ...unit, currentMoraleModifier: unitMoraleMod },
          ctx,
          x: tokenCx,
          y: tokenCy,
          width: tokenWidth,
          height: tokenHeight,
          zoom: currentZoom,
          showDetails: true,
          turnNumber: displayTurnNumber,
          teamAlliances: displayAlliances,
          formationsMap,
          sizeCategories,
        });
      } catch (err) {
        console.error('drawToken error:', err);
      }
      // Elevation badge (feet) in the top-left corner of an elevated token.
      if ((unit.elevation ?? 0) > 0) {
        ctx.save();
        const bw = tokenWidth * 0.4;
        const bh = Math.max(12, tokenHeight * 0.16);
        const bx = tokenCx - tokenWidth / 2;
        const by = tokenCy - tokenHeight / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#ffe08a';
        ctx.font = `bold ${Math.max(10, 11 * currentZoom)}px ui-monospace, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`${unit.elevation}`, bx + 4, by + 2);
        ctx.restore();
      }
      if (unit.hidden) ctx.restore();

      // Reaction overlay: the acting archer gets a highlight ring; every unit with
      // an available reaction (owned by the viewer) shows the blinking bow button,
      // centered on the hex at ~50% hex size regardless of token size.
      if (reactionMode && unit.id === reactionMode.archer.id) {
        ctx.save();
        const ringR = Math.min(tokenWidth, tokenHeight) * 0.55;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = Math.max(2, 3 * currentZoom);
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = ringR * 0.4;
        ctx.stroke();
        ctx.restore();
      } else if (!reactionMode && reactionOffers.has(unit.id) && !unit.archerReactionUsed && canReactToUnit(unit)) {
        drawArcherReactionButton(ctx, cx, cy, HEX_SIZE * currentZoom * 0.5, bowBlinkOn ? 0.4 : 1);
      }

      const attachedHero = attachedByHost.get(unit.id);
      if (attachedHero) {
        const heroPos = getAttachedHeroPos(unit.hex, unit.facing, attachedHero.attachedPosition, unit.sizeCategory);
        const hostClimb = parseClimbTo(unit.climbTo);
        const elevOff = elevationOffset(unit.elevation, HEX_SIZE, canFly(unit) && !hostClimb, hostClimb ? hexDirection(unit.hex, hostClimb, HEX_SIZE) : undefined);
        const heroCx = heroPos.x * currentZoom + offsetX + elevOff.dx * currentZoom;
        const heroCy = heroPos.y * currentZoom + offsetY + elevOff.dy * currentZoom;
        const heroFormationMoraleMod = formationsMap[attachedHero.currentFormation] ?? null;
        const heroMoraleMod = moraleMods.get(attachedHero.id) ?? (attachedHero.currentMoraleModifier + computeEffectiveMoraleModifier(attachedHero, displayUnits, displayAlliances, heroFormationMoraleMod));
        try {
          drawToken({
            unit: { ...attachedHero, currentMoraleModifier: heroMoraleMod },
            ctx,
            x: heroCx,
            y: heroCy,
            width: tokenWidth,
            height: tokenHeight,
            zoom: currentZoom,
            showDetails: true,
            turnNumber: displayTurnNumber,
            teamAlliances: displayAlliances,
            isAttached: true,
            formationsMap,
            sizeCategories,
          });
        } catch (err) {
          console.error('drawToken error (attached hero):', err);
        }
        // Highlight the "active" hero (Switch to Hero) so it's clear it's the
        // grabbable entity — drag it away to separate, or drag onto a target to
        // attack with the hero.
        if (attachedHero.id === activeHeroId) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 210, 63, 0.95)';
          ctx.lineWidth = 3;
          ctx.strokeRect(heroCx - tokenWidth / 2 - 2, heroCy - tokenHeight / 2 - 2, tokenWidth + 4, tokenHeight + 4);
          ctx.restore();
        }
      }
    }

    // "Above unit" effect artwork (hides while the unit on its hex is hovered).
    for (const im of aboveImages.sort((a, b) => a.z - b.z)) {
      if (hoveredHexKey && `${im.hex.q},${im.hex.r}` === hoveredHexKey) continue;
      drawEffectImage(im.hex, im.url, im.scale, im.elevation, im.structTop);
    }

    // Active-effect pips: one colored dot per effect under the token (small, cheap).
    if (!isGM && !hideUnits) {
      ctx.save();
      for (const unit of displayUnits) {
        const effects = unit.effects ?? [];
        if (unit.isDeleted || unit.attachedToUnitId || effects.length === 0) continue;
        const { cx, cy } = hexCenter(unit.hex);
        const baseY = cy + tokenHeight * 0.62;
        const visible = effects.slice(0, 5);
        for (let i = 0; i < visible.length; i++) {
          ctx.fillStyle = visible[i].color || '#cccccc';
          ctx.beginPath();
          ctx.arc(cx - (visible.length - 1) * 4 * currentZoom + i * 8 * currentZoom, baseY, Math.max(1.5, 3 * currentZoom), 0, 2 * Math.PI);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Fog of war: GRADED visibility (soft fog rings), not binary. Revealed hexes
    // that no unit can see stay under an opaque veil for players (hides enemies)
    // or a translucent one for the DM / replay (so they see through the boundary).
    // At the EDGE of a unit's sight the veil is dim instead: the outermost revealed
    // ring gets fogDim (0.6), the next ring in 0.3, and hexes closer than that are
    // crisp (no fill). Where units overlap, computeFog already kept the clearest.
    if (fogReveal && fogDim && fogUnseenAlpha !== null) {
      const gridRadius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
      const fogHex = (hex: Hex, alpha: number) => {
        const pos = hexToPixel(hex, HEX_SIZE);
        const cx = pos.x * currentZoom + offsetX;
        const cy = pos.y * currentZoom + offsetY;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 180) * (60 * i - 30);
          const px = cx + HEX_SIZE * currentZoom * Math.cos(angle);
          const py = cy + HEX_SIZE * currentZoom * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(${FOG_RGB.r},${FOG_RGB.g},${FOG_RGB.b},${alpha})`;
        ctx.fill();
      };
      for (let q = -gridRadius; q <= gridRadius; q++) {
        for (let r = -gridRadius; r <= gridRadius; r++) {
          const s = -q - r;
          if (Math.abs(s) > gridRadius) continue;
          const key = `${q},${r}`;
          const alpha = fogReveal.has(key)
            ? (fogDim.get(key) ?? 0)
            : fogUnseenAlpha;
          if (alpha > 0) fogHex({ q, r, s }, alpha);
        }
      }
    }

    // AI assist overlay — drawn last so the DM always reads it. Checkmarks on
    // AI-selected units, grey opt-out badges on AI-excluded-but-eligible units,
    // and preview/execute routes (polyline + crossed swords for attacks + a
    // ghost at the final hex). Routes dim unless hovered.
    if (aiOverlay && (aiOverlay.checkedUnitIds.length > 0 || aiOverlay.excludedUnitIds.length > 0 || aiOverlay.routes.length > 0)) {
      const byId = new Map(displayUnits.map(u => [u.id, u]));
      // Checkmarks: fixed on-screen size (does not grow with zoom).
      const badgeR = 9;
      for (const id of aiOverlay.checkedUnitIds) {
        const u = byId.get(id);
        if (!u || u.isDeleted || u.attachedToUnitId || u.hidden) continue;
        const pos = hexToPixel(u.hex, HEX_SIZE);
        const bx = pos.x * currentZoom + offsetX + tokenWidth * 0.46;
        const by = pos.y * currentZoom + offsetY - tokenHeight * 0.52;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(17,24,39,0.92)';
        ctx.fill();
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(bx - 4.5, by);
        ctx.lineTo(bx - 1.2, by + 3.6);
        ctx.lineTo(bx + 4.8, by - 3.4);
        ctx.stroke();
        ctx.restore();
      }
      // Opt-out badge (AI-eligible unit the DM excluded): grey circle + minus.
      for (const id of aiOverlay.excludedUnitIds ?? []) {
        const u = byId.get(id);
        if (!u || u.isDeleted || u.attachedToUnitId || u.hidden) continue;
        const pos = hexToPixel(u.hex, HEX_SIZE);
        const bx = pos.x * currentZoom + offsetX + tokenWidth * 0.46;
        const by = pos.y * currentZoom + offsetY - tokenHeight * 0.52;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(17,24,39,0.92)';
        ctx.fill();
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx - 4, by);
        ctx.lineTo(bx + 4, by);
        ctx.stroke();
        ctx.restore();
      }

      const hexP = (h: Hex) => {
        const c = hexCenter(h);
        return { x: c.cx, y: c.cy };
      };
      const line = (a: { x: number; y: number }, b: { x: number; y: number }, color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };
      const arrowHead = (tip: { x: number; y: number }, from: { x: number; y: number }, color: string) => {
        const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
        const s = 7;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - s * Math.cos(ang - 0.42), tip.y - s * Math.sin(ang - 0.42));
        ctx.lineTo(tip.x - s * Math.cos(ang + 0.42), tip.y - s * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
      };

      for (const route of aiOverlay.routes) {
        const dimmed = aiHoveredUnitId != null && route.unitId !== aiHoveredUnitId;
        const color = aiHoveredUnitId === route.unitId ? '#fde047' : '#38bdf8';
        ctx.save();
        if (dimmed) ctx.globalAlpha = 0.25;
        const lineW = Math.max(2, 2.2 * currentZoom);
        const pts = route.waypoints.map(hexP);
        for (let i = 1; i < pts.length; i++) {
          if (pts[i - 1].x === pts[i].x && pts[i - 1].y === pts[i].y) continue;
          line(pts[i - 1], pts[i], color, lineW);
          arrowHead(pts[i], pts[i - 1], color);
        }
        // Turn glyphs: a curved arrow at the hex where the unit rotates.
        if (route.turns) {
          for (const t of route.turns) {
            const c = hexCenter(t.hex);
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1.5, 1.5 * currentZoom);
            const r = Math.max(8, 10 * currentZoom);
            const startA = t.dir === 'left' ? Math.PI * 0.2 : Math.PI * 0.8;
            const sweep = t.dir === 'left' ? 1.5 : -1.5;
            ctx.beginPath();
            ctx.arc(c.cx, c.cy, r, startA, startA + sweep, sweep < 0);
            ctx.stroke();
            const endA = startA + sweep;
            const tip = { x: c.cx + r * Math.cos(endA), y: c.cy + r * Math.sin(endA) };
            const backA = endA + (sweep < 0 ? 1 : -1) * 0.4;
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(c.cx + (r + 4 * currentZoom) * Math.cos(backA), c.cy + (r + 4 * currentZoom) * Math.sin(backA));
            ctx.stroke();
          }
        }
        // Formation chip drawn under the start hex when the unit will reform.
        if (route.formation && pts.length > 0) {
          const s = pts[0];
          const label = route.formation;
          ctx.font = `bold ${Math.max(9, 11 * currentZoom)}px ui-sans-serif, system-ui`;
          const tw = ctx.measureText(label).width + 8;
          ctx.fillStyle = 'rgba(17,24,39,0.9)';
          ctx.beginPath();
          ctx.roundRect(s.x - tw / 2, s.y + tokenHeight * 0.62, tw, Math.max(13, 15 * currentZoom), 4);
          ctx.fill();
          ctx.strokeStyle = '#a78bfa';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#e9d5ff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, s.x, s.y + tokenHeight * 0.62 + Math.max(13, 15 * currentZoom) / 2);
        }
        // Attack markers: hex-ring + crossed swords at each attacked target hex.
        for (const atk of route.attacks) {
          const t = hexP(atk.targetHex);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = Math.max(2, 2 * currentZoom);
          ctx.beginPath();
          ctx.arc(t.x, t.y, Math.max(10, HEX_SIZE * currentZoom * 0.42), 0, 2 * Math.PI);
          ctx.stroke();
          const s = Math.max(5, 7 * currentZoom);
          ctx.beginPath();
          ctx.moveTo(t.x - s, t.y - s);
          ctx.lineTo(t.x + s, t.y + s);
          ctx.moveTo(t.x + s, t.y - s);
          ctx.lineTo(t.x - s, t.y + s);
          ctx.moveTo(t.x, t.y - s * 1.4);
          ctx.lineTo(t.x, t.y + s * 1.4);
          ctx.stroke();
        }
        // Ghost at the final waypoint.
        if (pts.length > 0) {
          const g = pts[pts.length - 1];
          const w = Math.min(tokenWidth * 0.8, tokenWidth);
          const h = Math.min(tokenHeight * 0.8, tokenHeight);
          ctx.fillStyle = 'rgba(56,189,248,0.22)';
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.5, 1.5 * currentZoom);
          ctx.setLineDash([4 * currentZoom, 3 * currentZoom]);
          ctx.beginPath();
          ctx.roundRect(g.x - w / 2, g.y - h / 2, w, h, 6);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }
  }, [displayUnits, displayTurnNumber, displayAlliances, isGM, fogReveal, fogDim, fogUnseenAlpha, formationsMap, sizeCategories, activeHeroId, reactionOffers, reactionMode, bowBlinkOn, canReactToUnit, walls, structures, templates, hoveredWallEdge, hideUnits, keepVisibleUnitId, hideGroundUnits, groundZones, mpZones, corpseCounts, aiOverlay, aiHoveredUnitId, imageTick, moraleMods]);

  const captureAndUploadScreenshot = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('[Screenshot] Canvas not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[Screenshot] Context not found');
      return;
    }

    try {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const displayWidth = rect.width;
      const displayHeight = rect.height;

      // Calculate bounds (units or full grid)
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      if (units.length > 0) {
        for (const unit of units) {
          const pos = hexToPixel(unit.hex, HEX_SIZE);
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x);
          maxY = Math.max(maxY, pos.y);
        }
        const padding = Math.max((maxX - minX) * 0.2, 100);
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
      } else {
        const gridRadius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
        const hexes: Hex[] = [];
        for (let q = -gridRadius; q <= gridRadius; q++) {
          for (let r = -gridRadius; r <= gridRadius; r++) {
            const s = -q - r;
            if (Math.abs(s) <= gridRadius) hexes.push({ q, r, s });
          }
        }
        for (const hex of hexes) {
          const pos = hexToPixel(hex, HEX_SIZE);
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x);
          maxY = Math.max(maxY, pos.y);
        }
        const padding = 100;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
      }

      const worldWidth = maxX - minX;
      const worldHeight = maxY - minY;
      const zoomX = displayWidth / worldWidth;
      const zoomY = displayHeight / worldHeight;
      const fitZoom = Math.min(zoomX, zoomY, 2);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const fitOffsetX = displayWidth / 2 - centerX * fitZoom;
      const fitOffsetY = displayHeight / 2 - centerY * fitZoom;

      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, displayWidth, displayHeight);

      // Draw background image in screenshot
      if (backgroundConfig) {
        try {
          const bgImg = await loadImage(backgroundConfig.imageUrl);
          const imgW = bgImg.naturalWidth * backgroundConfig.scale * fitZoom;
          const imgH = bgImg.naturalHeight * backgroundConfig.scale * fitZoom;
          const imgX = backgroundConfig.offsetX * fitZoom + fitOffsetX - imgW / 2;
          const imgY = backgroundConfig.offsetY * fitZoom + fitOffsetY - imgH / 2;
          ctx.drawImage(bgImg, imgX, imgY, imgW, imgH);
        } catch {
          // background image failed to load, skip
        }
      }

      // Draw hex grid
      const gridRadius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
      const hexes: Hex[] = [];
      for (let q = -gridRadius; q <= gridRadius; q++) {
        for (let r = -gridRadius; r <= gridRadius; r++) {
          const s = -q - r;
          if (Math.abs(s) <= gridRadius) hexes.push({ q, r, s });
        }
      }

      const drawHex = (hex: Hex) => {
        const pos = hexToPixel(hex, HEX_SIZE);
        const cx = pos.x * fitZoom + fitOffsetX;
        const cy = pos.y * fitZoom + fitOffsetY;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 180 * (60 * i - 30);
          const px = cx + HEX_SIZE * fitZoom * Math.cos(angle);
          const py = cy + HEX_SIZE * fitZoom * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fill();
        ctx.strokeStyle = '#2a2a4a';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      };

      for (const hex of hexes) drawHex(hex);

      // Preload token images so all draws are synchronous
      const imageUrls = new Set<string>();
      for (const unit of units) {
        if (unit.isDeleted) continue;
        if (unit.raceIconUrl) imageUrls.add(unit.raceIconUrl);
        if (unit.unitTypeIconUrl) imageUrls.add(unit.unitTypeIconUrl);
        if (unit.customImageUrl) imageUrls.add(unit.customImageUrl);
      }
      await Promise.all(Array.from(imageUrls).map(url => loadImage(url).catch(() => {})));

      // Draw units using drawToken
      const tokenWidth = TOKEN_WIDTH * fitZoom;
      const tokenHeight = TOKEN_HEIGHT * fitZoom;

      const screenshotDrawOrder = [...units].sort(tokenDrawOrder);

      for (const unit of screenshotDrawOrder) {
        if (unit.isDeleted || unit.attachedToUnitId) continue;
        if (unit.hidden) {
          ctx.save();
          ctx.globalAlpha = 0.3;
        }
        const pos = hexToPixel(unit.hex, HEX_SIZE);
        const cx = pos.x * fitZoom + fitOffsetX;
        const cy = pos.y * fitZoom + fitOffsetY;

        try {
          drawToken({
            unit,
            ctx,
            x: cx,
            y: cy,
            width: tokenWidth,
            height: tokenHeight,
            zoom: fitZoom,
            showDetails: true,
            teamAlliances: alliances,
          });
        } catch (err) {
          console.error(`[Screenshot] Error drawing token ${unit.id}:`, err);
        }
        if (unit.hidden) ctx.restore();

        const attachedHero = units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted);
        if (attachedHero) {
          const heroPos = getAttachedHeroPos(unit.hex, unit.facing, attachedHero.attachedPosition, unit.sizeCategory);
          const heroCx = heroPos.x * fitZoom + fitOffsetX;
          const heroCy = heroPos.y * fitZoom + fitOffsetY;
          try {
            drawToken({
              unit: attachedHero,
              ctx,
              x: heroCx,
              y: heroCy,
              width: tokenWidth,
              height: tokenHeight,
              zoom: fitZoom,
              showDetails: true,
              teamAlliances: alliances,
              isAttached: true,
            });
          } catch (err) {
            console.error(`[Screenshot] Error drawing attached hero ${attachedHero.id}:`, err);
          }
        }
      }

      const dataUrl = canvas.toDataURL('image/png');
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      const fileName = `scenario_${scenarioId}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      await updateScreenshot(scenarioId, file);
      console.log('[Screenshot] Uploaded successfully:', fileName);

      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      ctx.scale(dpr, dpr);
    } catch (err) {
      console.error('[Screenshot] Error:', err);
    }
  }, [canvasRef, units, scenarioId, updateScreenshot, backgroundConfig]);

  return { customDraw, captureAndUploadScreenshot };
}
