// src/hooks/useHexGrid.ts
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Hex, Unit } from '@/types/gameProtocol';
import { isUnitInteractable } from '@/lib/unitInteractions';
import { elevationOffset, canFly, parseClimbTo, hexDirection } from '@/lib/flying';
import { hexToPixel, pixelToHex } from '@/lib/hexGeometry';
import { getAttachedHeroPos, getHeroSquareSize, TOKEN_HEIGHT } from '@/lib/heroLayout';
import { EdgeRef, Walls, nearestWallEdge } from '@/lib/walls';

// Re-export the pure hex math so existing importers keep working.
export { hexToPixel, pixelToHex } from '@/lib/hexGeometry';

export interface UseHexGridProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  size: number;
  gridRadius: number;
  units: Unit[];
  onUnitMove: (unitId: string, targetHex: Hex) => void;
  onHexClick?: (hex: Hex, unit?: Unit, clientX?: number, clientY?: number) => void;
  /** A click (mouse down + up with negligible movement) on a unit token. */
  onUnitClick?: (unit: Unit, clientX: number, clientY: number) => void;
  onHexRightClick?: (hex: Hex, unit: Unit | undefined, clientX: number, clientY: number) => void;
  onUnitHover?: (unit: Unit, screenX: number, screenY: number) => void;
  onUnitLeave?: () => void;
  onAttack?: (attackerId: string, targetId: string) => void;
  /** Walls on the board (drag-onto-the-edge wall attacks). */
  walls?: Walls;
  /** Dropped onto a wall edge: attack that barrier instead of moving. */
  onAttackWall?: (unitId: string, edge: EdgeRef) => void;
  /** Whether the dragged unit may attack this wall edge (reach gate, overlay hint). */
  canAttackWallEdge?: (unitId: string, edge: EdgeRef) => boolean;
  /** Whether a wall edge EXISTS here for a Shift-drop to attempt (no reach gate —
   *  the attack itself reports "cannot reach"). */
  canAttemptWallEdge?: (unitId: string, edge: EdgeRef) => boolean;
  /** Dropped onto a hex with an attackable structure (gate/tower): attack it. */
  onAttackStructure?: (unitId: string, hex: Hex) => void;
  /** Whether a structure EXISTS on this hex for a Shift-drop to attempt (no reach
   *  gate — the attack itself reports "cannot reach"). */
  canAttemptStructure?: (unitId: string, hex: Hex) => boolean;
  /** Wall edge under the pointer while dragging (for the overlay hint). */
  onHoverWallEdge?: (edge: EdgeRef | null) => void;
  /** Inspect mode (Shift held): unit hover is suppressed and hex/edge info hover fires. */
  shiftHeld?: boolean;
  /** Air-only view (Space held): tokens/wireframe show only airborne units, so
   *  ground units are skipped by hit-testing (hover/drag/click). */
  airOnly?: boolean;
  /** Hover on a hex with no unit under the cursor (hex info tooltip). */
  onHexHover?: (hex: Hex, x: number, y: number) => void;
  onHexLeave?: () => void;
  /** Hover near a wall edge (edge structure tooltip). */
  onEdgeHover?: (edge: EdgeRef, x: number, y: number) => void;
  onEdgeLeave?: () => void;
  /** Permission gate for grabbing a token (drag-move/attack). Return false to silently not grab. */
  canGrabUnit?: (unit: Unit) => boolean;
  /** Fired when a token starts being grabbed — lets callers auto-activate an
   *  attached hero so its token (not the host) is the one dragged. */
  onGrabUnit?: (unit: Unit) => void;
  /** Ctrl/meta + left-click handler (attention ping). */
  onPing?: (hex: Hex) => void;
  /** When set (via the context-menu "Switch to Hero"), the attached hero with this
   *  id is the grabbable entity at its host's hex instead of the host. */
  activeHeroId?: string | null;
  customDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number, zoom: number, offsetX: number, offsetY: number) => void;
  autoCenter?: boolean;
  backgroundImage?: { url: string; offsetX: number; offsetY: number; scale: number } | null;
  overlayMap?: Record<string, string> | null;
  /** Read-only mode: pan/zoom/hover enabled, but unit drag-move, attack, and
   *  context menu are disabled (used by replay). */
  readOnly?: boolean;
}

export function useHexGrid({
  canvasRef,
  size,
  gridRadius,
  units,
  onUnitMove,
  onHexClick,
  onUnitClick,
  onHexRightClick,
  onUnitHover,
  onUnitLeave,
  onAttack,
  walls,
  onAttackWall,
  canAttackWallEdge,
  canAttemptWallEdge,
  onAttackStructure,
  canAttemptStructure,
  onHoverWallEdge,
  shiftHeld = false,
  airOnly = false,
  onHexHover,
  onHexLeave,
  onEdgeHover,
  onEdgeLeave,
  canGrabUnit,
  onGrabUnit,
  onPing,
  activeHeroId,
  customDraw,
  autoCenter = true,
  backgroundImage,
  overlayMap = null,
  readOnly = false,
}: UseHexGridProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [hoveredHex, setHoveredHex] = useState<Hex | null>(null);
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [mouseDownTarget, setMouseDownTarget] = useState<'unit' | 'hex' | 'none'>('none');
  const [lastHoveredUnit, setLastHoveredUnit] = useState<Unit | null>(null);

  const rafIdRef = useRef<number | null>(null);
  /** Last reported hovered wall-edge key (dedupes the overlay-hint callback). */
  const hoveredEdgeKeyRef = useRef<string | null>(null);
  /** Last reported hex/edge info-hover key (dedupes the tooltip callbacks). */
  const hoveredInfoKeyRef = useRef<string | null>(null);
  const pointerDownRef = useRef<{ unitId: string; x: number; y: number } | null>(null);
  // True while a middle-button pan has actually moved; suppresses the hex click
  // (which would otherwise paint the active map feature on release).
  const panMovedRef = useRef(false);

  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);
  // Offscreen canvas holding the STATIC layer (background image + hex grid) so
  // the per-frame redraw only blits it instead of re-drawing ~gridRadius² hexes.
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticKeyRef = useRef('');

  useEffect(() => {
    if (!backgroundImage?.url) {
      bgImageRef.current = null;
      setBgLoaded(false);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      bgImageRef.current = img;
      setBgLoaded(true);
    };
    img.onerror = () => {
      bgImageRef.current = null;
      setBgLoaded(false);
    };
    img.src = backgroundImage.url;
  }, [backgroundImage?.url]);

  // ---- Pan by a screen-pixel delta (WASD keyboard panning) ----
  const panBy = useCallback((dx: number, dy: number) => {
    setOffsetX(p => p + dx);
    setOffsetY(p => p + dy);
  }, []);

  // ---- Center map ----
  const centerMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const centerPixel = hexToPixel({ q: 0, r: 0, s: 0 }, size);
    setOffsetX(width / 2 - centerPixel.x * zoom);
    setOffsetY(height / 2 - centerPixel.y * zoom);
  }, [canvasRef, size, zoom]);

  useEffect(() => {
    if (autoCenter) {
      const timer = setTimeout(() => centerMap(), 50);
      return () => clearTimeout(timer);
    }
  }, [autoCenter, centerMap]);

  useEffect(() => {
    const handleResize = () => centerMap();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [centerMap]);

  // ---- Draw ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    const drawHex = (target: CanvasRenderingContext2D, hex: Hex, fillColor?: string) => {
      const pos = hexToPixel(hex, size);
      const cx = pos.x * zoom + offsetX;
      const cy = pos.y * zoom + offsetY;
      target.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i - 30);
        const px = cx + size * zoom * Math.cos(angle);
        const py = cy + size * zoom * Math.sin(angle);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      if (fillColor) {
        target.fillStyle = fillColor;
        target.fill();
      }
      target.strokeStyle = '#2a2a4a';
      target.lineWidth = 0.8;
      target.stroke();
    };

    // Static layer (background image + hex grid) is pre-rendered to an offscreen
    // canvas and only re-drawn when geometry/background change, so hover/overlay/
    // unit updates just blit it instead of re-drawing ~gridRadius² hexes.
    const staticKey = [width, height, zoom, offsetX, offsetY, gridRadius, backgroundImage?.url, backgroundImage?.offsetX, backgroundImage?.offsetY, backgroundImage?.scale, bgLoaded].join('|');
    if (staticKey !== staticKeyRef.current) {
      staticKeyRef.current = staticKey;
      let sc = staticCanvasRef.current;
      if (!sc) {
        sc = document.createElement('canvas');
        staticCanvasRef.current = sc;
      }
      sc.width = width * dpr;
      sc.height = height * dpr;
      const sctx = sc.getContext('2d');
      if (sctx) {
        sctx.scale(dpr, dpr);
        sctx.clearRect(0, 0, width, height);
        sctx.fillStyle = '#1a1a2e';
        sctx.fillRect(0, 0, width, height);

        if (bgImageRef.current && backgroundImage) {
          const img = bgImageRef.current;
          const imgW = img.naturalWidth * backgroundImage.scale * zoom;
          const imgH = img.naturalHeight * backgroundImage.scale * zoom;
          const imgX = backgroundImage.offsetX * zoom + offsetX - imgW / 2;
          const imgY = backgroundImage.offsetY * zoom + offsetY - imgH / 2;
          sctx.drawImage(img, imgX, imgY, imgW, imgH);
        }

        for (let q = -gridRadius; q <= gridRadius; q++) {
          for (let r = -gridRadius; r <= gridRadius; r++) {
            const s = -q - r;
            if (Math.abs(s) <= gridRadius) drawHex(sctx, { q, r, s });
          }
        }
      }
    }

    const sc = staticCanvasRef.current;
    if (sc && sc.width > 0) {
      ctx.drawImage(sc, 0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);
    }

    // Dynamic overlay fills (threat/reach highlights) on top of the static grid.
    if (overlayMap) {
      for (const [key, fill] of Object.entries(overlayMap)) {
        const [q, r] = key.split(',').map(Number);
        if (Number.isNaN(q) || Number.isNaN(r)) continue;
        drawHex(ctx, { q, r, s: -q - r }, fill);
      }
    }

    if (customDraw) {
      customDraw(ctx, width, height, zoom, offsetX, offsetY);
    }
  }, [canvasRef, size, gridRadius, offsetX, offsetY, zoom, customDraw, bgLoaded, backgroundImage, overlayMap]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ---- Apply zoom (shared logic) ----
  const applyZoom = useCallback((deltaY: number, clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // World coordinates under mouse
    const worldX = (mouseX - offsetX) / zoom;
    const worldY = (mouseY - offsetY) / zoom;

    const delta = deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(zoom * delta, 0.2), 3);

    const newOffsetX = mouseX - worldX * newZoom;
    const newOffsetY = mouseY - worldY * newZoom;

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    rafIdRef.current = requestAnimationFrame(() => {
      setZoom(newZoom);
      setOffsetX(newOffsetX);
      setOffsetY(newOffsetY);
      rafIdRef.current = null;
      draw();
    });
  }, [canvasRef, offsetX, offsetY, zoom, draw]);

  // ---- Attach native wheel listener with passive:false ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(e.deltaY, e.clientX, e.clientY);
    };

    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [applyZoom]);

  // ---- Mouse handlers (unchanged) ----
  const getHexFromScreen = useCallback((screenX: number, screenY: number): Hex | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (screenX - rect.left) || 0;
    const y = (screenY - rect.top) || 0;
    const worldX = (x - offsetX) / zoom;
    const worldY = (y - offsetY) / zoom;
    return pixelToHex({ x: worldX, y: worldY }, size);
  }, [canvasRef, offsetX, offsetY, zoom, size]);

  /** World-space point under a screen point (canvas-local, pan/zoom applied). */
  const getWorldFromScreen = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    const x = rect ? screenX - rect.left : screenX;
    const y = rect ? screenY - rect.top : screenY;
    return { x: (x - offsetX) / zoom, y: (y - offsetY) / zoom };
  }, [canvasRef, offsetX, offsetY, zoom]);

  /** The nearest wall edge to a screen point, within a fraction-of-hex threshold. */
  const getWallEdgeAt = useCallback((screenX: number, screenY: number, ratio = 0.38): EdgeRef | null => {
    const hex = getHexFromScreen(screenX, screenY);
    if (!hex) return null;
    const world = getWorldFromScreen(screenX, screenY);
    return nearestWallEdge(walls, hex, world, size, size * ratio);
  }, [getHexFromScreen, getWorldFromScreen, walls, size]);

  const getUnitAt = useCallback((hex: Hex): Unit | undefined => {
    // An "active" attached hero (switched via the context menu) becomes the
    // grabbable entity at its host's hex instead of the host.
    if (activeHeroId) {
      const hero = units.find(u => u.id === activeHeroId && !u.isDeleted && u.hex.q === hex.q && u.hex.r === hex.r && u.hex.s === hex.s);
      if (hero) return hero;
    }
    return units.find(u => isUnitInteractable(u) && u.hex.q === hex.q && u.hex.r === hex.r && u.hex.s === hex.s);
  }, [units, activeHeroId]);

  /**
   * Point-based hit test: the token's ACTUAL drawn location (hex centre plus its
   * elevation offset, NE 45°), not just its hex. This is what lets an elevated
   * token be grabbed/hovered where it is rendered, and lets a flyer stacked with a
   * ground unit be selected (the nearest token centre wins; `airOnly` skips ground
   * so the Space-held air view still targets the flyer).
   */
  const getUnitAtScreen = useCallback((screenX: number, screenY: number, opts?: { airOnly?: boolean }): Unit | undefined => {
    const airOnlyMode = opts?.airOnly ?? airOnly;
    const world = getWorldFromScreen(screenX, screenY);
    const hex = getHexFromScreen(screenX, screenY);
    const halfW = size * 0.8;  // TOKEN_WIDTH / 2  (HEX_SIZE * 1.6 / 2)
    const halfH = size * 0.6;  // TOKEN_HEIGHT / 2 (HEX_SIZE * 1.2 / 2)
    // The context-menu-switched active hero is grabbable at its DISPLAYED token
    // (attached offset + the host's elevation offset), not the whole hex — so a
    // rider / front / back hero of a flying host can be grabbed where it's drawn.
    if (activeHeroId) {
      const hero = units.find(u => u.id === activeHeroId && !u.isDeleted);
      if (hero) {
        const host = units.find(u => u.id === hero.attachedToUnitId);
        const hostElev = host?.elevation ?? hero.elevation ?? 0;
        if (!airOnlyMode || hostElev > 0) {
          const hostHex = host?.hex ?? hero.hex;
          const hostFacing = host?.facing ?? hero.facing;
          const hostSize = host?.sizeCategory ?? hero.sizeCategory;
          const hostPos = hexToPixel(hostHex, size);
          const hostClimb = host ? parseClimbTo(host.climbTo) : null;
          const off = elevationOffset(hostElev, size, host ? (canFly(host) && !hostClimb) : false, host && hostClimb ? hexDirection(host.hex, hostClimb, size) : undefined);
          const hostCx = hostPos.x + off.dx;
          const hostCy = hostPos.y + off.dy;
          // Host token box (the combined pair is the hero's grabbable entity)…
          if (Math.abs(world.x - hostCx) <= halfW && Math.abs(world.y - hostCy) <= halfH) return hero;
          // …or the hero's own square at its attached position.
          const hPos = getAttachedHeroPos(hostHex, hostFacing, hero.attachedPosition, hostSize);
          const heroHalf = getHeroSquareSize(TOKEN_HEIGHT, hero.sizeCategory) / 2;
          if (Math.abs(world.x - (hPos.x + off.dx)) <= heroHalf && Math.abs(world.y - (hPos.y + off.dy)) <= heroHalf) return hero;
        }
      }
    }
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const u of units) {
      if (!isUnitInteractable(u)) continue;
      if (airOnlyMode && (u.elevation ?? 0) <= 0) continue;
      const pos = hexToPixel(u.hex, size);
      const uClimb = parseClimbTo(u.climbTo);
      const off = elevationOffset(u.elevation, size, canFly(u) && !uClimb, uClimb ? hexDirection(u.hex, uClimb, size) : undefined);
      const dx = world.x - (pos.x + off.dx);
      const dy = world.y - (pos.y + off.dy);
      if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) {
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = u; }
      }
    }
    if (best) return best;
    // Fallback keeps the broad whole-hex hit for GROUND units; flyers stay
    // token-only (their hex hit box is intentionally tight).
    if (!airOnlyMode && hex) {
      return units.find(u => isUnitInteractable(u) && (u.elevation ?? 0) <= 0 && u.hex.q === hex.q && u.hex.r === hex.r && u.hex.s === hex.s);
    }
    return undefined;
  }, [units, activeHeroId, size, airOnly, getWorldFromScreen, getHexFromScreen]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (hex) setHoveredHex(hex);

    const unit = getUnitAtScreen(e.clientX, e.clientY, { airOnly });
    // Inspect mode (Shift) suppresses unit hover so the map info tooltip shows.
    const hoverUnit = shiftHeld ? undefined : unit;
    if (hoverUnit && hoverUnit !== lastHoveredUnit) {
      setLastHoveredUnit(hoverUnit);
      // Viewport (client) coords — the tooltips are portal/fixed, browser-bound.
      if (onUnitHover) onUnitHover(hoverUnit, e.clientX, e.clientY);
    } else if (!hoverUnit && lastHoveredUnit) {
      setLastHoveredUnit(null);
      if (onUnitLeave) onUnitLeave();
    }

    // Hex/edge info hover (skip while a unit tooltip is showing). The edge
    // hit-box is enlarged in inspect mode for easier navigation.
    const rect = canvasRef.current?.getBoundingClientRect();
    const infoKey = (() => {
      if (hoverUnit || draggingUnitId || !hex || !rect) return null;
      const edge = getWallEdgeAt(e.clientX, e.clientY, shiftHeld ? 0.6 : 0.38);
      return edge ? `e:${edge.key}` : `h:${hex.q},${hex.r}`;
    })();
    if (infoKey !== hoveredInfoKeyRef.current) {
      hoveredInfoKeyRef.current = infoKey;
      onHexLeave?.();
      onEdgeLeave?.();
      if (infoKey && hex && rect) {
        // Viewport (client) coords — the info tooltip is portal/fixed.
        if (infoKey.startsWith('e:')) {
          const edge = getWallEdgeAt(e.clientX, e.clientY, shiftHeld ? 0.6 : 0.38);
          if (edge) onEdgeHover?.(edge, e.clientX, e.clientY);
        } else {
          onHexHover?.(hex, e.clientX, e.clientY);
        }
      }
    }

    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      if (dx !== 0 || dy !== 0) panMovedRef.current = true;
      setOffsetX(prev => prev + dx);
      setOffsetY(prev => prev + dy);
      setPanStart({ x: e.clientX, y: e.clientY });
    }

    // Drag-onto-the-edge: while dragging, report the wall edge under the pointer
    // (only when the dragged unit may actually attack it) for the overlay hint.
    const rawEdge = draggingUnitId ? getWallEdgeAt(e.clientX, e.clientY) : null;
    const nextEdge = rawEdge && draggingUnitId && (!canAttackWallEdge || canAttackWallEdge(draggingUnitId, rawEdge)) ? rawEdge : null;
    if (nextEdge?.key !== hoveredEdgeKeyRef.current) {
      hoveredEdgeKeyRef.current = nextEdge?.key ?? null;
      onHoverWallEdge?.(nextEdge);
    }
  }, [getHexFromScreen, getUnitAtScreen, airOnly, isPanning, panStart, lastHoveredUnit, onUnitHover, onUnitLeave, draggingUnitId, canAttackWallEdge, getWallEdgeAt, onHoverWallEdge, shiftHeld, onHexHover, onHexLeave, onEdgeHover, onEdgeLeave]);

  // Pointer leaves the canvas (e.g. onto a modal overlay): drop all hover state so
  // tooltips disappear and a re-entry re-fires the hover callbacks.
  const handleMouseLeave = useCallback(() => {
    if (lastHoveredUnit) {
      setLastHoveredUnit(null);
      onUnitLeave?.();
    }
    hoveredEdgeKeyRef.current = null;
    onHoverWallEdge?.(null);
    hoveredInfoKeyRef.current = null;
    onHexLeave?.();
    onEdgeLeave?.();
  }, [lastHoveredUnit, onUnitLeave, onHoverWallEdge, onHexLeave, onEdgeLeave]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (!hex) return;

    if (e.button === 1) {
      e.preventDefault();
      panMovedRef.current = false;
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      // 'none' so a middle press/release NEVER routes to onHexClick (which would
      // drop the armed MP-cost pen or a structure on the map).
      setMouseDownTarget('none');
      return;
    }

    // In read-only (replay) mode, left-click never starts a drag or a hex select;
    // pan (button 1) and hover still work. Right-click is handled separately.
    if (e.button !== 0 || readOnly) {
      setMouseDownTarget('none');
      return;
    }

    // Ctrl/meta + left-click = attention ping (feature #4). Never starts a drag.
    if (e.ctrlKey || e.metaKey) {
      if (onPing) onPing(hex);
      setMouseDownTarget('none');
      return;
    }

    const unit = getUnitAtScreen(e.clientX, e.clientY, { airOnly });
    // Record which unit (if any) the press started on, regardless of whether it
    // can be grabbed — lets clicks on tokens (e.g. the archer-reaction button)
    // be detected even for units the turn gate won't let you drag.
    pointerDownRef.current = unit ? { unitId: unit.id, x: e.clientX, y: e.clientY } : null;
    if (unit && (canGrabUnit ? canGrabUnit(unit) : true)) {
      if (onGrabUnit) onGrabUnit(unit);
      setDraggingUnitId(unit.id);
      setDragStartPos({ x: e.clientX, y: e.clientY });
      setMouseDownTarget('unit');
      return;
    }
    setMouseDownTarget('hex');
  }, [getHexFromScreen, getUnitAtScreen, airOnly, readOnly, canGrabUnit, onGrabUnit, onPing]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const targetHex = getHexFromScreen(e.clientX, e.clientY);
    // A click (release within ~4px of the press, on the same unit) is distinct
    // from a drag. Route it to onUnitClick — but keep the rest of the flow so a
    // click on a non-grabbable unit still selects its hex exactly as before.
    const pd = pointerDownRef.current;
    const upUnit = getUnitAtScreen(e.clientX, e.clientY, { airOnly });
    const clickedToken =
      !!pd && !!upUnit && upUnit.id === pd.unitId &&
      Math.abs(e.clientX - pd.x) <= 4 && Math.abs(e.clientY - pd.y) <= 4;
    if (clickedToken && onUnitClick && upUnit) {
      onUnitClick(upUnit, e.clientX, e.clientY);
    }
    pointerDownRef.current = null;

    if (draggingUnitId && dragStartPos && targetHex) {
      const unit = units.find(u => u.id === draggingUnitId);
      if (unit) {
        const targetUnit = getUnitAtScreen(e.clientX, e.clientY, { airOnly });
        const wallEdge = getWallEdgeAt(e.clientX, e.clientY);
        // Identity gate (a wall/structure EXISTS here), NOT a reach gate: an
        // out-of-range Shift-drop must still route to the attack so it can report
        // "cannot reach" instead of silently falling through to a move.
        const canHitWall = !!wallEdge && (!canAttemptWallEdge || canAttemptWallEdge(draggingUnitId, wallEdge));
        // Structure attacks require Shift at drop (plain drop = move). This is
        // the same gesture for edge (walls/spikes) and hex (gates/towers).
        const shift = e.shiftKey;
        if (targetUnit && targetUnit.id !== draggingUnitId) {
          if (onAttack) onAttack(draggingUnitId, targetUnit.id);
        } else if (!targetUnit && shift && canHitWall && onAttackWall) {
          // Shift-dropped onto a wall segment: attack it (reach reported there).
          onAttackWall(draggingUnitId, wallEdge!);
        } else if (!targetUnit && shift && onAttackStructure && canAttemptStructure?.(draggingUnitId, targetHex)) {
          // Shift-dropped onto a hex with a structure (gate/tower): attack it.
          onAttackStructure(draggingUnitId, targetHex);
        } else if (!targetUnit) {
          // A climbing unit may also "move" within its own hex — that drop means
          // climb DOWN (any other hex is up toward its target).
          if (unit.hex.q !== targetHex.q || unit.hex.r !== targetHex.r || unit.climbTo) {
            onUnitMove(draggingUnitId, targetHex);
          }
        }
      }
      setDraggingUnitId(null);
      setDragStartPos(null);
      if (hoveredEdgeKeyRef.current !== null) {
        hoveredEdgeKeyRef.current = null;
        onHoverWallEdge?.(null);
      }
    }

    if (mouseDownTarget === 'hex' && !draggingUnitId && !panMovedRef.current) {
      if (targetHex && onHexClick) onHexClick(targetHex, getUnitAtScreen(e.clientX, e.clientY, { airOnly }), e.clientX, e.clientY);
    }
    panMovedRef.current = false;

    setIsPanning(false);
    setPanStart(null);
    setMouseDownTarget('none');
  }, [draggingUnitId, dragStartPos, getHexFromScreen, units, getUnitAtScreen, airOnly, onAttack, onAttackWall, canAttemptWallEdge, onAttackStructure, canAttemptStructure, getWallEdgeAt, onUnitMove, onUnitClick, mouseDownTarget, onHexClick]);

  const handleRightClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (readOnly) return;
    // On macOS, ctrl+click fires a contextmenu event — it's a ping here, not a menu.
    if (e.ctrlKey || e.metaKey) return;
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (hex) {
      const unit = getUnitAtScreen(e.clientX, e.clientY, { airOnly });
      if (onHexRightClick) onHexRightClick(hex, unit, e.clientX, e.clientY);
    }
  }, [getHexFromScreen, getUnitAtScreen, airOnly, onHexRightClick, readOnly]);

  const centerOn = useCallback((hex: { q: number; r: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = hexToPixel({ q: hex.q, r: hex.r, s: -hex.q - hex.r }, size);
    setOffsetX(rect.width / 2 - p.x * zoom);
    setOffsetY(rect.height / 2 - p.y * zoom);
  }, [canvasRef, size, zoom]);

  return {
    handleMouseMove,
    handleMouseLeave,
    handleMouseDown,
    handleMouseUp,
    handleRightClick,
    // No handleWheel – it's internal now
    hoveredHex,
    draggingUnitId,
    offsetX,
    offsetY,
    zoom,
    getHexFromScreen,
    getUnitAt,
    getUnitAtScreen,
    centerMap,
    centerOn,
    panBy,
  };
}