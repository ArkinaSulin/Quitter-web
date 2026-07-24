// src/components/TokenRenderer/drawToken.ts
import { Unit } from '@/types/gameProtocol';
import { Team, TEAM_COLORS, TEAM_SHAPES, getDotColor, generateDotPositions, getFormationConfig } from './tokenUtils';

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(url: string): Promise<HTMLImageElement> {
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

  ctx.save();

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
  ctx.fillStyle = teamColor + '40';
  ctx.fill();
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // ---- Team shape overlay ----
  const overlaySize = Math.min(width, height) * 0.7;
  const teamShapeOffsetX = overlaySize * 0.3;
  drawTeamShape(ctx, x - teamShapeOffsetX, y - height / 6, overlaySize, shape, '#999999', 0.35);

  // ---- Hero handling ----
  if (unit.isHero) {
    const imageUrl = customImageUrl || raceIconUrl;
    const topAreaHeight = height * 0.667;
    const padding = Math.min(width, height) * 0.05;
    if (imageUrl) {
      try {
        let img: HTMLImageElement | undefined;
        if (preloadedImages?.has(imageUrl)) {
          img = preloadedImages.get(imageUrl);
        } else {
          img = await loadImage(imageUrl);
        }
        if (img) {
          const imageSize = Math.min(width - padding * 2, topAreaHeight - padding * 2);
          const ix = x - imageSize / 2;
          const shapeCenterY = y - height / 6;
          const iy = shapeCenterY - imageSize / 2;
          ctx.drawImage(img, ix, iy, imageSize, imageSize);
        } else {
          drawRaceFallback(ctx, x, y, width, topAreaHeight);
        }
      } catch {
        drawRaceFallback(ctx, x, y, width, topAreaHeight);
      }
    } else {
      drawRaceFallback(ctx, x, y, width, topAreaHeight);
    }
    drawHeroHpBar(ctx, x, y, width, height, unit.currentUnitHp, unit.maxUnitHp);
    drawName(ctx, unit.unitName, x, y, width, height, team, false);
    ctx.restore();
    return;
  }

  // ---- Normal unit ----
  const troopCount = Math.min(unit.currentTroopCount ?? 10, 200);
  const maxTroopCount = Math.min(unit.maxTroopCount || 10, 200);
  const visualScale = unit.visualScale || 100;
  const sizeCategory = unit.sizeCategory || 100;
  const formation = unit.currentFormation || 'Tight';
  const isRouted = unit.isRouting || false;
  const isMounted = !!unit.mountId;

  // Determine effective formation for rendering decisions
  let effectiveFormation = formation;
  if (isMounted && (formation === 'Phalanx' || formation === 'Shield Wall')) {
    effectiveFormation = 'Routed';
  }

  const config = getFormationConfig(effectiveFormation, isMounted, sizeCategory);
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
    42
  );

  // ---- Phalanx pikes (only if not mounted and formation is actually Phalanx) ----
  if (formation === 'Phalanx' && !isRouted && !isMounted) {
    const topEdge = y - height / 2;
    const secondRankTop = y - height / 2 + 0.5 * dotRadius;
    const maxRows = Math.min(2, Math.ceil(positions.length / dotsPerRow));
    for (let row = 0; row < maxRows; row++) {
      const startIdx = row * dotsPerRow;
      const endIdx = Math.min((row + 1) * dotsPerRow, positions.length);
      const offsetX = (row + 1) * 0.5 * dotRadius;
      const endY = row === 0 ? topEdge : secondRankTop;
      for (let i = startIdx; i < endIdx; i++) {
        const pos = positions[i];
        if (!pos.isDead) {
          const px = x - width/2 + pos.x + offsetX;
          const py = y - height/2 + pos.y;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px, endY);
          ctx.strokeStyle = dotColor;
          ctx.lineWidth = 1.5;
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
        const sx = x - width/2 + pos.x;
        const sy = y - height/2 + pos.y - dotRadius * 2.5;
        const shieldRadius = dotRadius * 1.3;
        const shieldOffsetY = dotRadius * 0.5;
        ctx.beginPath();
        ctx.ellipse(sx, sy + dotRadius, shieldRadius, shieldOffsetY, 0, Math.PI, 0, false);
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

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
        ctx.setLineDash([2, 3]);
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
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
    }
  }

  // ---- Routed flag ----
  if (isRouted) {
    const flagSize = Math.min(width, height) * 0.35;
    const flagX = x - flagSize / 2;
    const flagY = y - height * 0.667 / 2 + (height * 0.667 - flagSize) / 2;
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

  // ---- Bottom info ----
  if (showDetails) {
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
      team,
      preloadedImages
    );
  }

  // ---- Name ----
  drawName(ctx, unit.unitName, x, y, width, height, team, false);

  ctx.restore();
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
  ctx.fillStyle = getDotColor(team);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const nameY = cy + height/2 - 1;
  ctx.fillText(testName, cx, nameY);
  ctx.restore();
}

function drawHeroHpBar(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number, height: number, hp: number, maxHp: number) {
  const infoY = cy + height / 6;
  const infoHeight = height / 3;
  const barWidth = width * 0.75;
  const barHeight = infoHeight * 0.3;
  const barX = cx - width * 0.5;
  const barY = infoY + (infoHeight - barHeight) / 3;
  const hpPercent = Math.max(0, Math.min(1, hp / maxHp));
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = '#FF4444';
  ctx.fillRect(barX + barWidth * (1 - hpPercent), barY, barWidth * hpPercent, barHeight);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);

  const textX = cx + width * 0.46;
  const textY = infoY + infoHeight * 0.25;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${infoHeight * 0.35}px sans-serif`;
  ctx.fillText(`${Math.floor(hp)}`, textX, textY);
  ctx.fillStyle = '#AAAAAA';
  ctx.font = `${infoHeight * 0.25}px sans-serif`;
  ctx.fillText(`${Math.floor(maxHp)}`, textX, textY + infoHeight * 0.35);
  ctx.restore();
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
    const img = preloadedImages?.get(leftIcon);
    if (img) {
      ctx.drawImage(img, cx - width/2 + 4, iconY, iconSize, iconSize);
    } else {
      loadImage(leftIcon).then(img => {
        ctx.drawImage(img, cx - width/2 + 4, iconY, iconSize, iconSize);
      }).catch(() => {
        ctx.fillStyle = '#888';
        ctx.fillRect(cx - width/2 + 4, iconY, iconSize, iconSize);
        ctx.fillStyle = '#FFF';
        ctx.font = `${iconSize * 0.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', cx - width/2 + 4 + iconSize/2, iconY + iconSize/2);
      });
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
    const img = preloadedImages?.get(unitTypeIconUrl);
    if (img) {
      ctx.drawImage(img, cx + width/2 - iconSize - 4, iconY, iconSize, iconSize);
    } else {
      loadImage(unitTypeIconUrl).then(img => {
        ctx.drawImage(img, cx + width/2 - iconSize - 4, iconY, iconSize, iconSize);
      }).catch(() => {
        ctx.fillStyle = '#888';
        ctx.fillRect(cx + width/2 - iconSize - 4, iconY, iconSize, iconSize);
        ctx.fillStyle = '#FFF';
        ctx.font = `${iconSize * 0.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚔️', cx + width/2 - iconSize/2 - 4, iconY + iconSize/2);
      });
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

  if (!isHero && baseMorale !== undefined && moraleModifier !== undefined) {
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
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}