// src/components/TokenRenderer/tokenUtils.ts

import { Unit } from '@/types/gameProtocol';

// ---- Team definitions ----
export const TEAM_COLORS = {
  blue: '#0072B2',
  yellow: '#F0E442',
  violet: '#CC79A7',
  black: '#333333',
  orange: '#D55E00',
  green: '#009E73',
} as const;

export type Team = keyof typeof TEAM_COLORS;

export const TEAMS = Object.keys(TEAM_COLORS) as Team[];

export const TEAM_SHAPES: Record<Team, string> = {
  blue: 'circle',
  yellow: 'triangle',
  violet: 'star',
  black: 'square',
  orange: 'diamond',
  green: 'cross',
};

// ---- Formation configuration ----
export interface FormationConfig {
  dotsPerRow: number;
  rowSpacing: number;
  isMounted: boolean;
  triangleWidthMultiplier: number;
  triangleHeightMultiplier: number;
  scatteredLayout: 'random' | 'circle';
}

export function getFormationConfig(
  formation: string,
  isMounted: boolean,
  troopScale: number = 100
): FormationConfig {
  let baseRows = 10;

  if (troopScale >= 400) {
    baseRows = 1;
  } else if (troopScale >= 300) {
    baseRows = Math.floor(baseRows / 3);
  } else if (troopScale >= 200) {
    baseRows = Math.floor(baseRows / 2);
  }

  let dotsPerRow = baseRows;
  let rowSpacing = 2.0;
  let triangleWidthMultiplier = 1.3;
  let triangleHeightMultiplier = (5 / 3) * triangleWidthMultiplier;
  let scatteredLayout: 'random' | 'circle' = 'random';

  // Determine effective formation – mounted Phalanx/Shield Wall become Routed
  let effectiveFormation = formation;
  if (isMounted && (formation === 'Phalanx' || formation === 'Shield Wall')) {
    effectiveFormation = 'Routed';
  }

  if (isMounted) {
    if (effectiveFormation === 'Scattered') {
      scatteredLayout = 'circle';
      dotsPerRow = Math.min(Math.floor(baseRows / 2), 10);
    } else if (effectiveFormation === 'Routed') {
      scatteredLayout = 'random';
      dotsPerRow = Math.floor(baseRows / 2);
    }
    // Removed the 1.2 multiplier for triangles.
  }

  // Apply formation-specific dotsPerRow for both mounted and foot
  if (!isMounted || (effectiveFormation !== 'Scattered' && effectiveFormation !== 'Routed')) {
    switch (effectiveFormation) {
      case 'Loose':
        dotsPerRow = baseRows;
        rowSpacing = 2.0;
        break;
      case 'Tight':
        dotsPerRow = baseRows * 2;
        rowSpacing = 2.0;
        break;
      case 'Phalanx':
        dotsPerRow = baseRows * 2;
        rowSpacing = 1.0;
        break;
      case 'Shield Wall':
        dotsPerRow = baseRows * 2;
        rowSpacing = 1.0;
        break;
      case 'Scattered':
      case 'Routed':
        dotsPerRow = baseRows;
        rowSpacing = 2.0;
        break;
      default:
        dotsPerRow = baseRows;
        rowSpacing = 2.0;
    }
  }

  return {
    dotsPerRow: Math.max(1, dotsPerRow),
    rowSpacing,
    isMounted,
    triangleWidthMultiplier,
    triangleHeightMultiplier,
    scatteredLayout,
  };
}

// ---- Color utilities ----
export function getDotColor(team: Team | string | undefined): string {
  if (!team || !TEAM_COLORS[team as Team]) {
    return '#000000';
  }
  const bg = TEAM_COLORS[team as Team];
  const luminance = getLuminance(bg);
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
}

function getLuminance(hex: string): number {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) {
    return 0.5;
  }
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ---- Random helpers ----
export function seededRandom(seed: number): () => number {
  return function () {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

// ---- Dot position generation ----
export function generateDotPositions(
  bodyCount: number,
  maxBodyCount: number,
  formation: string,
  isMounted: boolean,
  tokenWidth: number,
  tokenHeight: number,
  dotRadius: number,
  troopScale: number,
  seed: number = 42
): Array<{ x: number; y: number; isDead: boolean; direction?: number }> {
  // Determine effective formation for layout
  let effectiveFormation = formation;
  if (isMounted && (formation === 'Phalanx' || formation === 'Shield Wall')) {
    effectiveFormation = 'Routed';
  }

  const config = getFormationConfig(effectiveFormation, isMounted, troopScale);
  const random = seededRandom(seed);

  const topStart = tokenHeight * 0.08;
  const topEnd = tokenHeight * 0.667;
  const availableHeight = topEnd - topStart;
  const padding = dotRadius * 0.5;

  // Routed mounted: random layout
  if (effectiveFormation === 'Routed' && isMounted && config.scatteredLayout === 'random') {
    return generateRandomPositions(
      bodyCount,
      maxBodyCount,
      tokenWidth,
      topStart,
      topEnd,
      dotRadius,
      padding,
      random,
      isMounted
    );
  }

  // Scattered mounted: circle layout
  if (effectiveFormation === 'Scattered' && isMounted && config.scatteredLayout === 'circle') {
    return generateCirclePositions(
      bodyCount,
      maxBodyCount,
      tokenWidth,
      topStart,
      topEnd,
      dotRadius,
      padding,
      random,
      isMounted
    );
  }

  // Scattered/Routed for foot: random distribution
  if (effectiveFormation === 'Scattered' || effectiveFormation === 'Routed') {
    return generateScatteredPositions(
      bodyCount,
      maxBodyCount,
      tokenWidth,
      topStart,
      topEnd,
      dotRadius,
      padding,
      random,
      isMounted
    );
  }

  // Regular formations
  const dotsPerRow = config.dotsPerRow;
  const rows = Math.ceil(maxBodyCount / dotsPerRow);
  let rowSpacing = dotRadius * 2 * config.rowSpacing;
  const totalHeight = rows * rowSpacing;
  if (totalHeight > availableHeight) {
    rowSpacing = availableHeight / rows;
    rowSpacing = Math.max(rowSpacing, dotRadius * 1.5);
  }

  const startY = topStart + dotRadius;
  const positions: Array<{ x: number; y: number; isDead: boolean }> = [];

  for (let row = 0; row < rows; row++) {
    const startIdx = row * dotsPerRow;
    const endIdx = Math.min(startIdx + dotsPerRow, maxBodyCount);
    const countInRow = endIdx - startIdx;
    const spacing = tokenWidth / (countInRow + 1);
    const y = startY + row * rowSpacing;

    for (let col = 0; col < countInRow; col++) {
      const i = startIdx + col;
      const isDead = i >= bodyCount;
      const x = spacing + col * spacing;
      positions.push({ x, y, isDead });
    }
  }

  return positions;
}

// ---- Internal helper functions ----
function generateRandomPositions(
  bodyCount: number,
  maxBodyCount: number,
  tokenWidth: number,
  topStart: number,
  topEnd: number,
  dotRadius: number,
  padding: number,
  random: () => number,
  isMounted: boolean
): Array<{ x: number; y: number; isDead: boolean; direction?: number }> {
  const positions: Array<{ x: number; y: number; isDead: boolean; direction?: number }> = [];
  const minDist = dotRadius * 2.5 + padding;

  const placeDot = (index: number, isDead: boolean) => {
    let attempts = 0;
    let placed = false;
    let x: number, y: number;

    while (!placed && attempts < 200) {
      x = padding + random() * (tokenWidth - 2 * padding);
      y = topStart + padding + random() * (topEnd - topStart - 2 * padding);
      placed = true;
      for (const pos of positions) {
        const dx = pos.x - x;
        const dy = pos.y - y;
        if (dx * dx + dy * dy < minDist * minDist) {
          placed = false;
          break;
        }
      }
      attempts++;
    }

    if (!placed) {
      x = padding + random() * (tokenWidth - 2 * padding);
      y = topStart + padding + random() * (topEnd - topStart - 2 * padding);
    }

    const direction = random() * 2 * Math.PI;
    return { x, y, isDead, direction };
  };

  for (let i = bodyCount; i < maxBodyCount; i++) {
    positions.push(placeDot(i, true));
  }
  for (let i = 0; i < bodyCount; i++) {
    positions.push(placeDot(i, false));
  }

  return positions;
}

function generateCirclePositions(
  bodyCount: number,
  maxBodyCount: number,
  tokenWidth: number,
  topStart: number,
  topEnd: number,
  dotRadius: number,
  padding: number,
  random: () => number,
  isMounted: boolean
): Array<{ x: number; y: number; isDead: boolean; direction?: number }> {
  const positions: Array<{ x: number; y: number; isDead: boolean; direction?: number }> = [];
  const count = maxBodyCount;
  const centerX = tokenWidth / 2;
  const centerY = (topStart + topEnd) / 2;
  const radius = Math.min(tokenWidth, topEnd - topStart) * 0.35;

  const maxPerCircle = 8;
  const numCircles = Math.ceil(count / maxPerCircle);
  const perCircle = Math.ceil(count / numCircles);

  for (let c = 0; c < numCircles; c++) {
    const startIdx = c * perCircle;
    const endIdx = Math.min(startIdx + perCircle, count);
    const circleCount = endIdx - startIdx;
    const circleRadius = radius * (1 - c * 0.3);
    const angleOffset = random() * 2 * Math.PI;

    for (let i = startIdx; i < endIdx; i++) {
      const isDead = i >= bodyCount;
      const angle = angleOffset + (i - startIdx) / circleCount * 2 * Math.PI;
      const x = centerX + circleRadius * Math.cos(angle);
      const y = centerY + circleRadius * Math.sin(angle);
      const direction = Math.atan2(y - centerY, x - centerX);
      positions.push({ x, y, isDead, direction });
    }
  }

  return positions;
}

function generateScatteredPositions(
  bodyCount: number,
  maxBodyCount: number,
  tokenWidth: number,
  topStart: number,
  topEnd: number,
  dotRadius: number,
  padding: number,
  random: () => number,
  isMounted: boolean
): Array<{ x: number; y: number; isDead: boolean; direction?: number }> {
  const positions: Array<{ x: number; y: number; isDead: boolean; direction?: number }> = [];
  const minDist = dotRadius * 2 + padding;
  const maxAttempts = 200;

  const placeDot = (index: number, isDead: boolean) => {
    let attempts = 0;
    let placed = false;
    let x: number, y: number;

    while (!placed && attempts < maxAttempts) {
      x = padding + random() * (tokenWidth - 2 * padding);
      y = topStart + padding + random() * (topEnd - topStart - 2 * padding);
      placed = true;
      for (const pos of positions) {
        const dx = pos.x - x;
        const dy = pos.y - y;
        if (dx * dx + dy * dy < minDist * minDist) {
          placed = false;
          break;
        }
      }
      attempts++;
    }

    if (!placed) {
      x = padding + random() * (tokenWidth - 2 * padding);
      y = topStart + padding + random() * (topEnd - topStart - 2 * padding);
    }

    return { x, y, isDead, direction: isMounted ? random() * 2 * Math.PI : undefined };
  };

  for (let i = bodyCount; i < maxBodyCount; i++) {
    positions.push(placeDot(i, true));
  }
  for (let i = 0; i < bodyCount; i++) {
    positions.push(placeDot(i, false));
  }

  return positions;
}