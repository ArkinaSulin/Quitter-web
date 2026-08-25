// src/components/TokenRenderer/drawToken.ts
import { Unit, Formation, SizeCategory } from '@/types/gameProtocol';
import { Team, TEAM_COLORS, TEAM_SHAPES, getDotColor, generateDotPositions, getFormationConfig, FormationConfig } from './tokenUtils';
import { ALLIANCE_COLORS, AllianceGroup } from '@/types/gameProtocol';

const imageCache = new Map<string, HTMLImageElement>();

const HERO_SQUARE_RATIOS: Record<number, number> = {
  75: 0.375,
  100: 1 / 2,
  200: 4 / 6,
  300: 5 / 6,
  400: 1,
};

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (imageCache.has(url)) {
      const cached = imageCache.get(url);
      if (cached?.complete) {
        resolve(cached);
        return;
      }
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function computeScatterSeed(unit: Unit, turnNumber: number): number {
  const str = `${turnNumber}|${unit.hex.q},${unit.hex.r}|${unit.currentTroopCount}`;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Phalanx pikes and Shield Wall shields, drawn behind the troop dots. */
function drawFormationExtras(
  ctx: CanvasRenderingContext2D,
  opts: {
    formation: string;
    isRouted: boolean;
    isMounted: boolean;
    positions: Array<{ x: number; y: number; isDead: boolean; direction?: number }>;
    dotsPerRow: number;
    dotRadius: number;
    dotColor: string;
    x: number;
    y: number;
    width: number;
    height: number;
  },
): void {
  const { formation, isRouted, isMounted, positions, dotsPerRow, dotRadius, dotColor, x, y, width, height } = opts;

  // ---- Phalanx pikes (only if not mounted and formation is actually Phalanx) ----
  if (formation === 'Phalanx' && !isRouted && !isMounted) {
    const rows = Math.ceil(positions.length / dotsPerRow);
    const pikeRows = Math.min(3, rows);
    for (let row = 0; row < pikeRows; row++) {
      const startIdx = row * dotsPerRow;
      const endIdx = Math.min((row + 1) * dotsPerRow, positions.length);
      for (let i = startIdx; i < endIdx; i++) {
        const pos = positions[i];
        if (!pos.isDead) {
          const px = x - width / 2 + pos.x;
          const py = y - height / 2 + pos.y;
          ctx.beginPath();
          ctx.moveTo(px + dotRadius * 0.5, py + dotRadius);
          ctx.lineTo(px + dotRadius * 0.5, py + dotRadius - dotRadius * 8);
          ctx.strokeStyle = dotColor;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  // ---- Shield Wall shields (only if not mounted and formation is actually Shield Wall) ----
  if (formation === 'Shield Wall' && !isRouted && !isMounted) {
    const frontRowDots = positions.slice(0, dotsPerRow);
    for (const pos of frontRowDots) {
      if (!pos.isDead) {
        const sx = x - width / 2 + pos.x;
        const sy = y - height / 2 + pos.y - dotRadius * 2.5;
        const shieldRadius = dotRadius * 1.3;
        const shieldOffsetY = dotRadius * 0.5;
        ctx.save();
        ctx.translate(sx, sy + dotRadius);
        ctx.rotate(-Math.PI / 18);
        ctx.beginPath();
        ctx.ellipse(0, 0, shieldRadius, shieldOffsetY, 0, Math.PI, 0, false);
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

export interface DrawTokenOptions {
  unit: Unit;
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  zoom?: number;
  showDetails?: boolean;
  preloadedImages?: Map<string, HTMLImageElement>;
  turnNumber?: number;
  teamAlliances?: Record<string, AllianceGroup>;
  isAttached?: boolean;
  formationsMap?: Record<string, Formation>;
  sizeCategories?: SizeCategory[];
}

export async function drawToken(options: DrawTokenOptions): Promise<void> {
  const {
    unit,
    ctx,
    x, y,
    width,
    height,
    zoom = 1,
    showDetails = true,
    preloadedImages,
    turnNumber = 0,
    formationsMap,
    sizeCategories,
  } = options;

  const team = unit.team || 'black';
  const teamColor = TEAM_COLORS[team as Team] || '#333333';
  const shape = TEAM_SHAPES[team as Team] || 'square';

  const halfW = width / 2;
  const halfH = height / 2;
  const radius = 4;

  const raceIconUrl = unit.raceIconUrl || '';
  const unitTypeIconUrl = unit.unitTypeIconUrl || '';
  const customImageUrl = unit.customImageUrl || '';

  // ---- Preload hero image before rotation scope ----
  let heroImage: HTMLImageElement | undefined;
  if (unit.isHero) {
    const imageUrl = customImageUrl || raceIconUrl;
    if (imageUrl) {
      if (preloadedImages?.has(imageUrl)) {
        heroImage = preloadedImages.get(imageUrl);
      } else if (imageCache.has(imageUrl)) {
        heroImage = imageCache.get(imageUrl);
      } else {
        try { heroImage = await loadImage(imageUrl); } catch { /* ignore */ }
      }
    }
  }

  ctx.save();

  // ---- Facing rotation ----
  if (unit.facing) {
    const facingAngle = (unit.facing * Math.PI) / 3;
    ctx.translate(x, y);
    ctx.rotate(facingAngle);
    ctx.translate(-x, -y);
  }

  try {

  const alliance = (options.teamAlliances && options.teamAlliances[team]) || 'friendly';
  const allianceColor = ALLIANCE_COLORS[alliance];

  // ---- Hero square token ----
  if (unit.isHero) {
    if (unit.currentUnitHp <= 0) ctx.filter = 'grayscale(100%)';
    drawHeroSquareToken(ctx, x, y, width, height, unit, heroImage, team, shape, allianceColor, options.isAttached || false);
    // Routed heroes carry the same white flag as units — the hero square itself
    // never changes, so the flag is the only "this unit actually routed" marker.
    if (unit.isRouting && unit.currentUnitHp > 0) {
      const heroSize = getHeroSquareSize(height, unit.sizeCategory || 100);
      const displaySize = options.isAttached ? heroSize / 2 : heroSize;
      const flagSize = displaySize * 0.5;
      await drawRoutedFlag(ctx, x - flagSize / 2, y - displaySize / 2 - flagSize * 0.25, flagSize);
    }
    return;
  }

  // ---- Background rectangle ----
  ctx.beginPath();
  ctx.moveTo(x - halfW + radius, y - halfH);
  ctx.lineTo(x + halfW - radius, y - halfH);
  ctx.quadraticCurveTo(x + halfW, y - halfH, x + halfW, y - halfH + radius);
  ctx.lineTo(x + halfW, y + halfH - radius);
  ctx.quadraticCurveTo(x + halfW, y + halfH, x + halfW - radius, y + halfH);
  ctx.lineTo(x - halfW + radius, y + halfH);
  ctx.quadraticCurveTo(x - halfW, y + halfH, x - halfW, y + halfH - radius);
  ctx.lineTo(x - halfW, y - halfH + radius);
  ctx.quadraticCurveTo(x - halfW, y - halfH, x - halfW + radius, y - halfH);
  ctx.closePath();
  ctx.fillStyle = teamColor + 'BF';
  ctx.fill();
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // ---- Alliance ring ----
  ctx.strokeStyle = allianceColor;
  ctx.lineWidth = 4;
  ctx.stroke();

  // ---- Team shape overlay ----
  const overlaySize = Math.min(width, height) * 0.7;
  const teamShapeOffsetX = overlaySize * 0.3;
  drawTeamShape(ctx, x - teamShapeOffsetX, y - height / 6, overlaySize, shape, '#999999', getTeamShapeAlpha(team));

  // ---- Normal unit ----
  const troopCount = Math.min(unit.currentTroopCount ?? 10, 200);
  const maxTroopCount = Math.min(unit.maxTroopCount || 10, 200);
  const visualScale = unit.visualScale || 100;
  const sizeCategory = unit.sizeCategory || 100;
  const formation = unit.currentFormation || 'Close Order';
  const isRouted = unit.isRouting || false;
  const isCorpse = (unit.currentUnitHp ?? 0) <= 0;
  const isMounted = !!unit.mountId;

  // Determine effective formation for rendering decisions
  let effectiveFormation = formation;
  if (isMounted && (formation === 'Phalanx' || formation === 'Shield Wall')) {
    effectiveFormation = 'Routed';
  }

  const sizeCat = sizeCategories?.find(s => s.size_category === (unit.sizeCategory || 100));
  const formationEntry = formationsMap?.[unit.currentFormation || 'Close Order'];
  const rowCap = sizeCat?.row_capacity ?? 10;
  const rowCapMult = formationEntry?.row_capacity_multiplier ?? 2;
  const visualDotsPerRow = rowCap * rowCapMult;

  const config = getFormationConfig(effectiveFormation, isMounted, sizeCategory, visualDotsPerRow);
  const dotRadius = Math.min(width, height) * 0.025 * (visualScale / 100) * (sizeCategory / 100);
  const dotsPerRow = config.dotsPerRow;
  const dotColor = getDotColor(team);

  const positions = generateDotPositions(
    troopCount,
    maxTroopCount,
    effectiveFormation,
    isMounted,
    width,
    height,
    dotRadius,
    sizeCategory,
    computeScatterSeed(unit, turnNumber),
    visualDotsPerRow,
    !!unit.isCharging,
  );

  // ---- Phalanx pikes / Shield Wall shields (drawn behind the troops) ----
  drawFormationExtras(ctx, {
    formation,
    isRouted,
    isMounted,
    positions,
    dotsPerRow,
    dotRadius,
    dotColor,
    x,
    y,
    width,
    height,
  });

  // ---- Troops ----
  for (const pos of positions) {
    const { x: dx, y: dy, isDead, direction } = pos;
    const px = x - width/2 + dx;
    const py = y - height/2 + dy;

    if (isMounted) {
      const baseWidth = dotRadius * config.triangleWidthMultiplier;
      const triHeight = dotRadius * config.triangleHeightMultiplier;
      ctx.save();
      ctx.translate(px, py);
      if (direction !== undefined) ctx.rotate(direction);
      ctx.beginPath();
      ctx.moveTo(0, -triHeight / 2);
      ctx.lineTo(-baseWidth / 2, triHeight / 2);
      ctx.lineTo(baseWidth / 2, triHeight / 2);
      ctx.closePath();
      if (isDead) {
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, 2 * Math.PI);
      if (isDead) {
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 1]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
    }
  }

  // ---- Routed flag (hidden on corpses — hollow dots only) ----
  if (isRouted && !isCorpse) {
    const flagSize = Math.min(width, height) * 0.35;
    const flagX = x - flagSize / 2;
    const flagY = y - height * 0.667 / 2 + (height * 0.667 - flagSize) / 2;
    await drawRoutedFlag(ctx, flagX, flagY, flagSize);
  }

  // ---- Bottom info (hidden on corpses) ----
  if (showDetails && !isCorpse) {
    drawBottomInfo(
      ctx,
      x, y, width, height,
      teamColor,
      dotColor,
      raceIconUrl,
      unitTypeIconUrl,
      customImageUrl,
      unit.baseMorale || 10,
      unit.currentMoraleModifier || 0,
      unit.isHero || false,
      unit.ignoreMoraleChecks || false,
      team,
      preloadedImages
    );

    if (typeof unit.actionsAvailable === 'number') {
      const infoY = y + height / 6;
      const badgeH = height * 0.16;
      const badgeW = badgeH;
      drawActionBadge(
        ctx,
        { left: x + width / 2 - 2 - badgeW, top: infoY - 2 - badgeH, width: badgeW, height: badgeH },
        unit.actionsAvailable,
      );
    }
  }

  // ---- Name (hidden on corpses) ----
  if (!isCorpse) {
    drawName(ctx, unit.unitName, x, y, width, height, team, false);
  }

  } finally {
    ctx.restore();
  }
}

export interface SpellCastTokenSnapshot {
  team: string;
  currentFormation: string;
  currentTroopCount: number;
  maxTroopCount: number;
  sizeCategory: number;
  visualScale: number;
  mountId: string | null;
}

export interface DrawSpellCastTokenOptions {
  snapshot: SpellCastTokenSnapshot;
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Deterministic scatter seed so every client draws the same layout. */
  seed: number;
  sizeCategories?: SizeCategory[];
  formationsMap?: Record<string, Formation>;
}

export interface SpellCastLayout {
  positions: Array<{ x: number; y: number; isDead: boolean; direction?: number }>;
  dotRadius: number;
  isMounted: boolean;
  config: FormationConfig;
  dotColor: string;
}

/**
 * Computes the troop layout for a unit in the area-magic targeting window:
 * full token height (no bottom 1/3 info bar), default (uncompressed) row spacing.
 * Exported so the targeting UI can draw the token and count covered troops from
 * the same positions.
 */
export function computeSpellCastLayout(
  snapshot: SpellCastTokenSnapshot,
  width: number,
  height: number,
  seed: number,
  sizeCategories?: SizeCategory[],
  formationsMap?: Record<string, Formation>,
): SpellCastLayout {
  const team = snapshot.team || 'black';
  const troopCount = Math.min(snapshot.currentTroopCount ?? 10, 200);
  const maxTroopCount = Math.min(snapshot.maxTroopCount || 10, 200);
  const visualScale = snapshot.visualScale || 100;
  const sizeCategory = snapshot.sizeCategory || 100;
  const formation = snapshot.currentFormation || 'Close Order';
  const isMounted = !!snapshot.mountId;

  let effectiveFormation = formation;
  if (isMounted && (formation === 'Phalanx' || formation === 'Shield Wall')) {
    effectiveFormation = 'Routed';
  }

  const sizeCat = sizeCategories?.find(s => s.size_category === sizeCategory);
  const formationEntry = formationsMap?.[formation];
  const rowCap = sizeCat?.row_capacity ?? 10;
  const rowCapMult = formationEntry?.row_capacity_multiplier ?? 2;
  const visualDotsPerRow = rowCap * rowCapMult;

  const config = getFormationConfig(effectiveFormation, isMounted, sizeCategory, visualDotsPerRow);
  const dotRadius = Math.min(width, height) * 0.025 * (visualScale / 100) * (sizeCategory / 100);
  const dotColor = getDotColor(team);

  const positions = generateDotPositions(
    troopCount,
    maxTroopCount,
    effectiveFormation,
    isMounted,
    width,
    height,
    dotRadius,
    sizeCategory,
    seed,
    visualDotsPerRow,
    false,
    { fitVertical: false, top: 0.05, bottom: 0.95 },
  );

  return { positions, dotRadius, isMounted, config, dotColor };
}

/**
 * Draws a unit's troop layout inside a token frame for the area-magic targeting
 * window: no bottom 1/3 info bar, default (uncompressed) row spacing spanning the
 * full token height, and troops facing north (upward), consistent with the map token.
 * regardless of the unit's actual map facing.
 */
export function drawSpellCastToken(options: DrawSpellCastTokenOptions): void {
  const { snapshot, ctx, x, y, width, height, seed, sizeCategories, formationsMap } = options;

  const team = snapshot.team || 'black';
  const teamColor = TEAM_COLORS[team as Team] || '#333333';
  const halfW = width / 2;
  const halfH = height / 2;
  const corner = 4;

  // ---- Background (rounded rectangle, matching the map token) ----
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - halfW + corner, y - halfH);
  ctx.lineTo(x + halfW - corner, y - halfH);
  ctx.quadraticCurveTo(x + halfW, y - halfH, x + halfW, y - halfH + corner);
  ctx.lineTo(x + halfW, y + halfH - corner);
  ctx.quadraticCurveTo(x + halfW, y + halfH, x + halfW - corner, y + halfH);
  ctx.lineTo(x - halfW + corner, y + halfH);
  ctx.quadraticCurveTo(x - halfW, y + halfH, x - halfW, y + halfH - corner);
  ctx.lineTo(x - halfW, y - halfH + corner);
  ctx.quadraticCurveTo(x - halfW, y - halfH, x - halfW + corner, y - halfH);
  ctx.closePath();
  ctx.fillStyle = teamColor + 'BF';
  ctx.fill();
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const { positions, dotRadius, isMounted, config, dotColor } = computeSpellCastLayout(snapshot, width, height, seed, sizeCategories, formationsMap);
  const isRouted = snapshot.currentFormation === 'Routed';

  // ---- Phalanx pikes / Shield Wall shields (drawn behind the troops) ----
  drawFormationExtras(ctx, {
    formation: snapshot.currentFormation,
    isRouted,
    isMounted,
    positions,
    dotsPerRow: config.dotsPerRow,
    dotRadius,
    dotColor,
    x,
    y,
    width,
    height,
  });

  // ---- Troops (facing north, consistent with the map token) ----
  for (const pos of positions) {
    const { x: dx, y: dy, isDead, direction } = pos;
    const px = x - width / 2 + dx;
    const py = y - height / 2 + dy;

    if (isMounted) {
      const baseWidth = dotRadius * config.triangleWidthMultiplier;
      const triHeight = dotRadius * config.triangleHeightMultiplier;
      ctx.save();
      ctx.translate(px, py);
      if (direction !== undefined) ctx.rotate(direction);
      ctx.beginPath();
      ctx.moveTo(0, -triHeight / 2);
      ctx.lineTo(-baseWidth / 2, triHeight / 2);
      ctx.lineTo(baseWidth / 2, triHeight / 2);
      ctx.closePath();
      if (isDead) {
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, 2 * Math.PI);
      if (isDead) {
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 1]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
    }
  }
}

// ---- Hero square helpers ----
function getHeroSquareSize(unitTokenHeight: number, sizeCategory: number): number {
  const ratio = HERO_SQUARE_RATIOS[sizeCategory] || 0.5;
  return unitTokenHeight * ratio;
}

function roundedSquarePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, radius: number) {
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx - half + radius, cy - half);
  ctx.lineTo(cx + half - radius, cy - half);
  ctx.quadraticCurveTo(cx + half, cy - half, cx + half, cy - half + radius);
  ctx.lineTo(cx + half, cy + half - radius);
  ctx.quadraticCurveTo(cx + half, cy + half, cx + half - radius, cy + half);
  ctx.lineTo(cx - half + radius, cy + half);
  ctx.quadraticCurveTo(cx - half, cy + half, cx - half, cy + half - radius);
  ctx.lineTo(cx - half, cy - half + radius);
  ctx.quadraticCurveTo(cx - half, cy - half, cx - half + radius, cy - half);
  ctx.closePath();
}

function drawHeroSquareHpBar(ctx: CanvasRenderingContext2D, cx: number, cy: number, squareSize: number, hp: number, maxHp: number) {
  const hpAreaTop = cy - squareSize / 2 + squareSize * 0.75;
  const hpAreaHeight = squareSize * 0.25;
  const barWidth = squareSize * 0.9;
  const barHeight = Math.max(3, hpAreaHeight * 0.45);
  const barX = cx - barWidth / 2;
  const barY = hpAreaTop + (hpAreaHeight - barHeight) / 2;
  const hpPercent = Math.max(0, Math.min(1, hp / maxHp));

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = '#FF4444';
  ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
}

/**
 * Routed white flag drawn at the given rect. Shared by unit tokens and the hero
 * square path (which previously never rendered a rout indicator).
 */
async function drawRoutedFlag(
  ctx: CanvasRenderingContext2D,
  flagX: number,
  flagY: number,
  flagSize: number,
): Promise<void> {
  try {
    const img = await loadImage('/images/whiteflag.png');
    ctx.drawImage(img, flagX, flagY, flagSize, flagSize);
  } catch {
    ctx.save();
    ctx.fillStyle = '#888888';
    ctx.fillRect(flagX + flagSize * 0.1, flagY, 2, flagSize * 0.8);
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(flagX + flagSize * 0.15, flagY);
    ctx.lineTo(flagX + flagSize * 0.9, flagY + flagSize * 0.35);
    ctx.lineTo(flagX + flagSize * 0.15, flagY + flagSize * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(flagX + flagSize * 0.15, flagY);
    ctx.lineTo(flagX + flagSize * 0.9, flagY + flagSize * 0.35);
    ctx.lineTo(flagX + flagSize * 0.15, flagY + flagSize * 0.7);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

function drawHeroSquareToken(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  tokenWidth: number, tokenHeight: number,
  unit: Unit,
  heroImage: HTMLImageElement | undefined,
  team: string,
  shape: string,
  allianceColor: string,
  isAttached: boolean,
) {
  const teamColor = TEAM_COLORS[team as Team] || '#333333';
  const heroSize = getHeroSquareSize(tokenHeight, unit.sizeCategory || 100);
  const displaySize = isAttached ? heroSize / 2 : heroSize;
  const halfSize = displaySize / 2;
  const cornerRadius = Math.max(2, displaySize * 0.08);

  roundedSquarePath(ctx, cx, cy, displaySize, cornerRadius);
  ctx.fillStyle = teamColor + 'BF';
  ctx.fill();
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = allianceColor;
  ctx.lineWidth = 4;
  ctx.stroke();

  const displayTop = cy - halfSize;
  const displayHeight = displaySize * 0.75;
  const displayCenterY = displayTop + displayHeight / 2;

  const teamShapeX = cx - halfSize + displaySize * 0.35;
  const teamShapeSize = displaySize * 0.8
  drawTeamShape(ctx, teamShapeX, displayCenterY, teamShapeSize, shape, '#999999', getTeamShapeAlpha(team));

  const iconX = cx + halfSize - displaySize * 0.35;
  const iconSize = displaySize * 0.7;
  if (heroImage) {
    ctx.save();
    ctx.drawImage(heroImage, iconX - iconSize / 2, displayCenterY - iconSize / 2, iconSize, iconSize);
    ctx.restore();
  } else {
    const x = iconX - iconSize / 2;
    const y = displayCenterY - iconSize / 2;
    ctx.fillStyle = '#666';
    ctx.fillRect(x, y, iconSize, iconSize);
    ctx.fillStyle = '#FFF';
    ctx.font = `${iconSize * 0.4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', iconX, displayCenterY);
  }

  drawHeroSquareHpBar(ctx, cx, cy, displaySize, unit.currentUnitHp, unit.maxUnitHp);

  if (!isAttached && typeof unit.actionsAvailable === 'number') {
    const hpAreaTop = cy - displaySize / 2 + displaySize * 0.75;
    const badgeH = displaySize * 0.16;
    const badgeW = badgeH;
    drawActionBadge(
      ctx,
      { left: cx + halfSize - 2 - badgeW, top: hpAreaTop - 2 - badgeH, width: badgeW, height: badgeH },
      unit.actionsAvailable,
    );
  }

  if (!isAttached) {
    drawName(ctx, unit.unitName, cx, cy, tokenWidth, tokenHeight, team, true);
  }
}

// ---- Helper functions ----
function drawTeamShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, shape: string, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.translate(cx, cy);
  const s = size / 2;
  ctx.scale(s / 24, s / 24);
  switch (shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, 2 * Math.PI);
      ctx.fill();
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(-18, 14);
      ctx.lineTo(18, 14);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star':
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? 20 : 9;
        const px = r * Math.cos(angle);
        const py = r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(-16, -16, 32, 32);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(18, 0);
      ctx.lineTo(0, 22);
      ctx.lineTo(-18, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case 'cross':
      ctx.fillRect(-5, -22, 10, 44);
      ctx.fillRect(-22, -5, 44, 10);
      break;
    default:
      break;
  }
  ctx.restore();
}

function getTeamShapeAlpha(team: string): number {
  if (team === 'violet') return 1;
  if (team === 'yellow' || team === 'orange') return 0.7;
  return 0.35;
}

function drawRaceFallback(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number, topAreaHeight: number) {
  const iconSize = Math.min(width, topAreaHeight) * 0.3;
  const x = cx - iconSize / 2;
  const y = cy - topAreaHeight / 2 + (topAreaHeight - iconSize) / 2;
  ctx.fillStyle = '#666';
  ctx.fillRect(x, y, iconSize, iconSize);
  ctx.fillStyle = '#FFF';
  ctx.font = `${iconSize * 0.4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, y + iconSize / 2);
}

function drawName(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, width: number, height: number, team: string | undefined, isHero: boolean) {
  const maxNameWidth = width * 0.9;
  let fontSize = Math.min(width, height) * 0.12;
  let testName = name;
  ctx.font = `bold ${fontSize}px sans-serif`;
  let nameWidth = ctx.measureText(testName).width;
  while (nameWidth > maxNameWidth && fontSize > 8) {
    fontSize *= 0.95;
    ctx.font = `bold ${fontSize}px sans-serif`;
    nameWidth = ctx.measureText(testName).width;
  }
  if (nameWidth > maxNameWidth) {
    let ellipsis = '…';
    while (testName.length > 1) {
      testName = testName.slice(0, -1);
      if (ctx.measureText(testName + ellipsis).width <= maxNameWidth) {
        testName += ellipsis;
        break;
      }
    }
    if (testName === '…') testName = '…';
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const nameY = cy + height/2 - 1;
  ctx.fillText(testName, cx, nameY);
  ctx.restore();
}

function getActionColor(actions: number): string {
  if (actions <= 0) return '#FF4444';
  if (actions === 1) return '#FFD700';
  return '#FFFFFF';
}

function drawActionBadge(
  ctx: CanvasRenderingContext2D,
  box: { left: number; top: number; width: number; height: number },
  actions: number,
) {
  const color = getActionColor(actions);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(box.left, box.top, box.width, box.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.left, box.top, box.width, box.height);
  ctx.fillStyle = color;
  ctx.font = `bold ${box.height * 0.62}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(actions), box.left + box.width / 2, box.top + box.height / 2);
}

function drawBottomInfo(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  width: number, height: number,
  teamColor: string,
  dotColor: string,
  raceIconUrl?: string,
  unitTypeIconUrl?: string,
  customImageUrl?: string,
  baseMorale?: number,
  moraleModifier?: number,
  isHero?: boolean,
  ignoreMoraleChecks?: boolean,
  team?: string,
  preloadedImages?: Map<string, HTMLImageElement>
) {
  const infoY = cy + height / 6;
  const infoHeight = height / 3;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(cx - width/2, infoY, width, infoHeight);

  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - width/2, infoY);
  ctx.lineTo(cx + width/2, infoY);
  ctx.stroke();

  const iconSize = Math.min(infoHeight * 0.7, width * 0.15);
  const iconY = infoY + (infoHeight - iconSize) / 2;

  const leftIcon = customImageUrl || raceIconUrl;
  if (leftIcon) {
    const img = preloadedImages?.get(leftIcon) || imageCache.get(leftIcon);
    if (img) {
      ctx.drawImage(img, cx - width/2 + 4, iconY, iconSize, iconSize);
    } else {
      loadImage(leftIcon).catch(() => {});
      ctx.fillStyle = '#888';
      ctx.fillRect(cx - width/2 + 4, iconY, iconSize, iconSize);
      ctx.fillStyle = '#FFF';
      ctx.font = `${iconSize * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx - width/2 + 4 + iconSize/2, iconY + iconSize/2);
    }
  } else {
    ctx.fillStyle = '#888';
    ctx.fillRect(cx - width/2 + 4, iconY, iconSize, iconSize);
    ctx.fillStyle = '#FFF';
    ctx.font = `${iconSize * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx - width/2 + 4 + iconSize/2, iconY + iconSize/2);
  }

  if (unitTypeIconUrl) {
    const img = preloadedImages?.get(unitTypeIconUrl) || imageCache.get(unitTypeIconUrl);
    if (img) {
      ctx.drawImage(img, cx + width/2 - iconSize - 4, iconY, iconSize, iconSize);
    } else {
      loadImage(unitTypeIconUrl).catch(() => {});
      ctx.fillStyle = '#888';
      ctx.fillRect(cx + width/2 - iconSize - 4, iconY, iconSize, iconSize);
      ctx.fillStyle = '#FFF';
      ctx.font = `${iconSize * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚔️', cx + width/2 - iconSize/2 - 4, iconY + iconSize/2);
    }
  } else {
    ctx.fillStyle = '#888';
    ctx.fillRect(cx + width/2 - iconSize - 4, iconY, iconSize, iconSize);
    ctx.fillStyle = '#FFF';
    ctx.font = `${iconSize * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚔️', cx + width/2 - iconSize/2 - 4, iconY + iconSize/2);
  }

  if (!isHero && !ignoreMoraleChecks && baseMorale !== undefined && moraleModifier !== undefined) {
    const effectiveMorale = baseMorale + moraleModifier;
    const totalHearts = Math.max(0, Math.min(10, Math.max(baseMorale, effectiveMorale)));
    const heartsFilled = Math.max(0, Math.min(effectiveMorale, totalHearts));
    const baseHeartCount = Math.min(baseMorale, heartsFilled);
    const heartAreaLeft = cx - width * 0.25;
    const heartAreaRight = cx + width * 0.25;
    const heartAreaWidth = heartAreaRight - heartAreaLeft;
    const heartsPerRow = 5;
    const numRows = 2;
    let heartSize = Math.max(4, Math.min(heartAreaWidth / heartsPerRow, (infoHeight * 0.8) / numRows));
    heartSize *= 1.2;
    const totalHeartHeight = numRows * heartSize * 0.9;
    const verticalPadding = Math.max(0, (infoHeight * 0.8 - totalHeartHeight) / 2);
    const startX = heartAreaLeft + (heartAreaWidth - (heartsPerRow - 1) * heartSize) / 2;
    const startY = infoY + (infoHeight - totalHeartHeight) / 2 + verticalPadding;

    for (let i = 0; i < totalHearts; i++) {
      const row = Math.floor(i / heartsPerRow);
      const col = i % heartsPerRow;
      const hx = startX + col * heartSize;
      const hy = startY + row * heartSize * 0.6;
      if (i < heartsFilled) {
        const color = i < baseHeartCount ? '#FF4444' : '#FFD700';
        drawHeart(ctx, hx, hy, heartSize, color);
      } else {
        drawHeart(ctx, hx, hy, heartSize);
      }
    }
  }
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fillColor?: string) {
  const s = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 10, s / 10);
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.bezierCurveTo(-6, -3, -10, 3, 0, 10);
  ctx.bezierCurveTo(10, 3, 6, -3, 0, 3);
  ctx.closePath();
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = fillColor === '#FF4444' ? '#CC2222' : '#CCB000';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#FF4444';
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}