// src/components/TokenRenderer/tokenUtils.ts

import { Unit } from '@/types/gameProtocol';

// 6 colorblind‑friendly colors (Paul Tol palette)
export const TEAM_COLORS = {
  blue: '#0072B2',
  yellow: '#F0E442',
  violet: '#CC79A7',
  black: '#333333',
  orange: '#D55E00',
  green: '#009E73',
} as const;

export type Team = keyof typeof TEAM_COLORS;

// Shape names for each team (used for overlays)
export const TEAM_SHAPES: Record<Team, string> = {
  blue: 'circle',
  yellow: 'triangle',
  violet: 'star',
  black: 'square',
  orange: 'halfmoon',
  green: 'shield',
};

// Formation configuration
export interface FormationConfig {
  dotsPerRow: number;
  rowSpacing: number;
  isMounted: boolean;
  dotVisualModifier: number;
  triangleBaseModifier: number;
  triangleHeightModifier: number;
  scatteredLayout: 'random' | 'circle';
}

export function getFormationConfig(
  formation: string,
  isMounted: boolean,
  troopScale: number = 100
): FormationConfig {
  // Base row capacity: 10 per row
  let baseRows = 10;
  if (troopScale > 200) {
    baseRows = 1; // heroes
  }

  let dotsPerRow = baseRows;
  let rowSpacing = 1.8;
  let dotVisualModifier = 1.0;
  let triangleBaseModifier = 1.25;
  let triangleHeightModifier = 2.5;
  let scatteredLayout: 'random' | 'circle' = 'random';

  if (isMounted) {
    // Mounted units: wider spacing to prevent overlap
    rowSpacing = 4.0;

    // Handle formation logic for mounted
    if (formation === 'Phalanx' || formation === 'Shield Wall') {
      // Mounted cannot form Phalanx or Shield Wall – fallback to Routed
      formation = 'Routed';
    }

    if (formation === 'Scattered') {
      scatteredLayout = 'circle';
      dotsPerRow = Math.min(Math.floor(baseRows / 2), 10); // 5 per row for circle layout
    } else if (formation === 'Routed') {
      scatteredLayout = 'random'; // Routed uses random layout
      dotsPerRow = Math.floor(baseRows / 2); // 5 per row
    } else if (formation === 'Tight') {
      dotsPerRow = baseRows; // 10 per row for mounted Tight
    } else {
      // Loose (default for mounted)
      dotsPerRow = Math.floor(baseRows / 2); // 5 per row for mounted Loose
    }
  } else {
    // Foot units: standard logic
    dotVisualModifier = 1.0;
    switch (formation) {
      case 'Loose':
        dotsPerRow = baseRows;
        rowSpacing = 1.8;
        break;
      case 'Tight':
        dotsPerRow = baseRows * 2;
        rowSpacing = 1.8;
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
        rowSpacing = 1.8;
        break;
      default:
        dotsPerRow = baseRows;
        rowSpacing = 1.8;
    }
  }

  return {
    dotsPerRow: Math.max(1, dotsPerRow),
    rowSpacing,
    isMounted,
    dotVisualModifier,
    triangleBaseModifier,
    triangleHeightModifier,
    scatteredLayout,
  };
}

export function getDotColor(team: Team): string {
  const bg = TEAM_COLORS[team];
  const luminance = getLuminance(bg);
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
}

function getLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Deterministic random for consistent rendering
export function seededRandom(seed: number): () => number {
  return function () {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

// Generate dot positions for a given formation
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
  const config = getFormationConfig(formation, isMounted, troopScale);
  const random = seededRandom(seed);

  // Top area: only use top 2/3 of token, start from top with 1/6 gap
  const topStart = tokenHeight * 0.08;
  const topEnd = tokenHeight * 0.667;
  const availableHeight = topEnd - topStart;
  const padding = dotRadius * 0.5;

  // Handle mounted Routed with random layout
  if (formation === 'Routed' && isMounted && config.scatteredLayout === 'random') {
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

  // Mounted Scattered: circle layout (unchanged)
  if (formation === 'Scattered' && isMounted && config.scatteredLayout === 'circle') {
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

  // Foot Scattered / Routed
  if (formation === 'Scattered' || formation === 'Routed') {
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

  // Standard formations: compute rows and adjust spacing to fit available height
  const dotsPerRow = config.dotsPerRow;
  const rows = Math.ceil(maxBodyCount / dotsPerRow);
  let rowSpacing = dotRadius * 2 * config.rowSpacing;
  const totalHeight = rows * rowSpacing;
  if (totalHeight > availableHeight) {
    // Scale down rowSpacing to fit
    rowSpacing = availableHeight / rows;
    // Clamp to minimum spacing (at least dotRadius * 1.5)
    rowSpacing = Math.max(rowSpacing, dotRadius * 1.5);
  }

  // Start at the top
  const startY = topStart + dotRadius;

  const positions: Array<{ x: number; y: number; isDead: boolean }> = [];

  // --- CENTERING FIX: use equal gaps on both ends ---
  const spacing = tokenWidth / (dotsPerRow + 1);

  for (let i = 0; i < maxBodyCount; i++) {
    const row = Math.floor(i / dotsPerRow);
    const col = i % dotsPerRow;
    const isDead = i >= bodyCount;

    const x = spacing + col * spacing;
    const y = startY + row * rowSpacing;

    positions.push({ x, y, isDead });
  }

  return positions;
}

// Random layout for mounted Routed
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
    const pos = placeDot(i, true);
    positions.push(pos);
  }
  for (let i = 0; i < bodyCount; i++) {
    const pos = placeDot(i, false);
    positions.push(pos);
  }

  return positions;
}

// Circle layout for mounted Scattered (unchanged)
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

// Scattered positions (foot)
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
    const pos = placeDot(i, true);
    positions.push(pos);
  }
  for (let i = 0; i < bodyCount; i++) {
    const pos = placeDot(i, false);
    positions.push(pos);
  }

  return positions;
}