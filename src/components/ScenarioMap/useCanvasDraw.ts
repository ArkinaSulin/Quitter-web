'use client';
// src/components/ScenarioMap/useCanvasDraw.ts
// Canvas rendering for the scenario map: live token drawing (customDraw, fed
// into useHexGrid) and the GM screenshot capture. Both are pure functions of
// the passed-in state — no handlers, no DB access.
import { useCallback } from 'react';
import type { RefObject } from 'react';
import { hexToPixel } from '@/hooks/useHexGrid';
import { Unit, Hex, AllianceGroup, Formation, SizeCategory, GroundEffect } from '@/types/gameProtocol';
import { drawToken, loadImage, drawArcherReactionButton } from '@/components/TokenRenderer/drawToken';
import { computeEffectiveMoraleModifier } from '@/lib/unitMorale';
import { DEFAULT_GRID_RADIUS, HEX_SIZE, TOKEN_HEIGHT, TOKEN_WIDTH, corpseLast, getAttachedHeroPos, MapBackgroundConfig, TerrainCosts, costShade } from './mapGeometry';
import { FOG_RGB } from '@/lib/fogOfWar';

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
  terrainCosts?: TerrainCosts;
  groundZones?: GroundEffect[];
  scenarioId: string;
  updateScreenshot: (scenarioId: string, file: File) => Promise<void>;
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
    terrainCosts,
    groundZones,
    scenarioId,
    updateScreenshot,
  } = deps;

  const customDraw = useCallback(async (ctx: CanvasRenderingContext2D, width: number, height: number, currentZoom: number, offsetX: number, offsetY: number) => {
    const tokenWidth = TOKEN_WIDTH * currentZoom;
    const tokenHeight = TOKEN_HEIGHT * currentZoom;

    // One pass over the units: hostId -> attached hero (avoids a find per token).
    const attachedByHost = new Map<string, Unit>();
    for (const u of displayUnits) {
      if (u.attachedToUnitId && !u.isDeleted) attachedByHost.set(u.attachedToUnitId, u);
    }

    // Corpses (HP <= 0) draw first so live tokens stacked on their hex render on top.
    const drawOrder = [...displayUnits].sort(corpseLast);

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
    const isFogHidden = (key: string) => !!fogReveal && !fogReveal.has(key);
    if (groundZones && groundZones.length > 0) {
      for (const z of groundZones) {
        const key = `${z.q},${z.r}`;
        if (isFogHidden(key)) continue;
        const c = z.color || '#ff7043';
        ctx.save();
        ctx.globalAlpha = 0.3;
        fillHex({ q: z.q, r: z.r, s: -z.q - z.r }, c);
        ctx.globalAlpha = 0.9;
        const { cx, cy } = hexCenter({ q: z.q, r: z.r, s: -z.q - z.r });
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, 6 * currentZoom), 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      }
    }
    if (terrainCosts) {
      ctx.save();
      // Constant on-screen size (screen space, NOT multiplied by zoom) so the
      // cost numbers stay readable at any zoom level.
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      for (const [key, cost] of Object.entries(terrainCosts)) {
        if (cost === 1) continue;
        if (isFogHidden(key)) continue;
        const [q, r] = key.split(',').map(Number);
        if (Number.isNaN(q) || Number.isNaN(r)) continue;
        const shade = costShade(cost);
        if (!shade) continue;
        fillHex({ q, r, s: -q - r }, shade);
        const { cx, cy } = hexCenter({ q, r, s: -q - r });
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.strokeText(String(cost), cx, cy);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(cost), cx, cy);
      }
      ctx.restore();
    }

    for (const unit of drawOrder) {
      if (unit.isDeleted || unit.attachedToUnitId) continue;
      if (unit.hidden) {
        if (!isGM) continue;
        ctx.save();
        ctx.globalAlpha = 0.3;
      }
      const formationMoraleMod = formationsMap[unit.currentFormation] ?? null;
      const pos = hexToPixel(unit.hex, HEX_SIZE);
      const cx = pos.x * currentZoom + offsetX;
      const cy = pos.y * currentZoom + offsetY;
      const unitMoraleMod = unit.currentMoraleModifier + computeEffectiveMoraleModifier(unit, displayUnits, displayAlliances, formationMoraleMod);
      try {
        await drawToken({
          unit: { ...unit, currentMoraleModifier: unitMoraleMod },
          ctx,
          x: cx,
          y: cy,
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
        await drawArcherReactionButton(ctx, cx, cy, HEX_SIZE * currentZoom * 0.5, bowBlinkOn ? 0.4 : 1);
      }

      const attachedHero = attachedByHost.get(unit.id);
      if (attachedHero) {
        const heroPos = getAttachedHeroPos(unit.hex, unit.facing, attachedHero.attachedPosition);
        const heroCx = heroPos.x * currentZoom + offsetX;
        const heroCy = heroPos.y * currentZoom + offsetY;
        const heroFormationMoraleMod = formationsMap[attachedHero.currentFormation] ?? null;
        const heroMoraleMod = attachedHero.currentMoraleModifier + computeEffectiveMoraleModifier(attachedHero, displayUnits, displayAlliances, heroFormationMoraleMod);
        try {
          await drawToken({
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

    // Active-effect pips: one colored dot per effect under the token (small, cheap).
    if (!isGM) {
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
  }, [displayUnits, displayTurnNumber, displayAlliances, isGM, fogReveal, fogDim, fogUnseenAlpha, formationsMap, sizeCategories, activeHeroId, reactionOffers, reactionMode, bowBlinkOn, canReactToUnit, terrainCosts, groundZones]);

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

      const screenshotDrawOrder = [...units].sort(corpseLast);

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
          await drawToken({
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
          const heroPos = getAttachedHeroPos(unit.hex, unit.facing);
          const heroCx = heroPos.x * fitZoom + fitOffsetX;
          const heroCy = heroPos.y * fitZoom + fitOffsetY;
          try {
            await drawToken({
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
