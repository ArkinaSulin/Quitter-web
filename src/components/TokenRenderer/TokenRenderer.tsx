// src/components/TokenRenderer/TokenRenderer.tsx
'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Team, TEAM_COLORS, TEAM_SHAPES, getDotColor, generateDotPositions, getFormationConfig } from './tokenUtils';

export interface TokenRendererProps {
  unitName: string;
  bodyCount: number;
  maxBodyCount: number;
  formation: 'Loose' | 'Tight' | 'Scattered' | 'Phalanx' | 'Shield Wall' | 'Routed';
  team: Team;
  troopScale: number;
  isMounted: boolean;
  isRouted: boolean;
  morale: number;
  maxMorale: number;
  raceIconUrl?: string;
  weaponIconUrl?: string;
  width?: number;
  showInfo?: boolean;
  onRender?: (dataURL: string) => void;
}

// Internal render scale (higher = crisper when zoomed)
const RENDER_SCALE = 2;

export function TokenRenderer({
  unitName,
  bodyCount,
  maxBodyCount,
  formation,
  team,
  troopScale,
  isMounted,
  isRouted,
  morale,
  maxMorale,
  raceIconUrl,
  weaponIconUrl,
  width = 78,
  showInfo = true,
  onRender,
}: TokenRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const renderToken = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = width;
    const logicalWidth = width * RENDER_SCALE;

    canvas.width = logicalWidth * dpr;
    canvas.height = logicalWidth * dpr;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayWidth}px`;

    ctx.scale(dpr, dpr);

    const tokenWidth = logicalWidth;
    const tokenHeight = logicalWidth;

    const bgColor = TEAM_COLORS[team];
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, tokenWidth, tokenHeight);

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, tokenWidth, tokenHeight);

    const baseDotRadius = tokenWidth * 0.02 * (troopScale / 100);
    const config = getFormationConfig(
      isRouted ? 'Routed' : formation,
      isMounted,
      troopScale
    );

    const dotRadius = baseDotRadius * config.dotVisualModifier;
    const dotsPerRow = config.dotsPerRow;

    const seed = 42;
    const positions = generateDotPositions(
      bodyCount,
      maxBodyCount,
      isRouted ? 'Routed' : formation,
      isMounted,
      tokenWidth,
      tokenHeight,
      dotRadius,
      troopScale,
      seed
    );

    const dotColor = getDotColor(team);

    // --- PHALANX: Draw pikes BEFORE dots ---
    if (formation === 'Phalanx' && !isMounted && !isRouted) {
      const topEdge = 0;
      const secondRankTop = 0.5 * dotRadius;
      const maxRows = Math.min(2, Math.ceil(positions.length / dotsPerRow));
      for (let row = 0; row < maxRows; row++) {
        const startIdx = row * dotsPerRow;
        const endIdx = Math.min((row + 1) * dotsPerRow, positions.length);
        const offsetX = (row + 1) * 0.5 * dotRadius;
        const endY = (row === 0) ? topEdge : secondRankTop;
        for (let i = startIdx; i < endIdx; i++) {
          const pos = positions[i];
          if (!pos.isDead) {
            const x = pos.x + offsetX;
            const y = pos.y;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, endY);
            ctx.strokeStyle = dotColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }

    // --- SHIELD WALL: Draw shields BEFORE dots ---
    if (formation === 'Shield Wall' && !isMounted && !isRouted) {
      const frontRowDots = positions.slice(0, dotsPerRow);
      for (const pos of frontRowDots) {
        if (!pos.isDead) {
          const x = pos.x;
          const y = pos.y - dotRadius * 2;
          const shieldRadius = dotRadius * 0.7;
          const shieldOffsetY = dotRadius * 0.35;
          ctx.beginPath();
          ctx.arc(x, y + shieldOffsetY, shieldRadius, Math.PI, 0, false);
          ctx.strokeStyle = dotColor;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // --- Draw troops ---
    for (const pos of positions) {
      const { x, y, isDead, direction } = pos;

      if (isMounted) {
        const baseWidth = baseDotRadius * config.triangleBaseModifier * 1.8;
        const height = baseDotRadius * config.triangleHeightModifier * 2.0;
        ctx.save();
        ctx.translate(x, y);
        if (direction !== undefined) {
          ctx.rotate(direction);

        }
        ctx.beginPath();
        ctx.moveTo(0, -height / 2);
        ctx.lineTo(-baseWidth / 2, height / 2);
        ctx.lineTo(baseWidth / 2, height / 2);
        ctx.closePath();
        if (isDead) {
          ctx.strokeStyle = dotColor;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = dotColor;
          ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
        if (isDead) {
          ctx.strokeStyle = dotColor;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = dotColor;
          ctx.fill();
        }
      }
    }

    // --- Routed flag ---
    if (isRouted) {
      const flagSize = tokenWidth * 0.35;
      const flagX = (tokenWidth - flagSize) / 2;
      const flagY = (tokenHeight * 0.667 - flagSize) / 2;
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

    // --- Bottom info panel ---
    if (showInfo) {
      const infoY = tokenHeight * 0.667;
      const infoHeight = tokenHeight * 0.333;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, infoY, tokenWidth, infoHeight);

      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, infoY);
      ctx.lineTo(tokenWidth, infoY);
      ctx.stroke();

      const iconSize = infoHeight * 0.7;
      const iconY = infoY + (infoHeight - iconSize) / 2;

      const drawShapeUnder = (cx: number, cy: number, size: number, shape: string, color: string) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.6;
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
              const x = r * Math.cos(angle);
              const y = r * Math.sin(angle);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
            break;
          case 'square':
            ctx.fillRect(-16, -16, 32, 32);
            break;
          case 'halfmoon':
            ctx.beginPath();
            ctx.arc(0, 0, 20, 0, Math.PI, false);
            ctx.closePath();
            ctx.fill();
            break;
          case 'shield':
            ctx.beginPath();
            ctx.moveTo(0, -20);
            ctx.quadraticCurveTo(-20, -14, -20, 0);
            ctx.quadraticCurveTo(-20, 16, 0, 20);
            ctx.quadraticCurveTo(20, 16, 20, 0);
            ctx.quadraticCurveTo(20, -14, 0, -20);
            ctx.closePath();
            ctx.fill();
            break;
          default:
            break;
        }
        ctx.restore();
      };

      const raceShape = TEAM_SHAPES[team] || 'circle';
      const shapeColor = getDotColor(team) === '#000000' ? '#000000' : '#FFFFFF';
      drawShapeUnder(4 + iconSize/2, iconY + iconSize/2, iconSize, raceShape, shapeColor);

      if (raceIconUrl) {
        const img = new Image();
        img.src = raceIconUrl;
        img.onload = () => {
          ctx.drawImage(img, 4, iconY, iconSize, iconSize);
        };
        try {
          ctx.drawImage(img, 4, iconY, iconSize, iconSize);
        } catch {}
      } else {
        ctx.fillStyle = '#888';
        ctx.fillRect(4, iconY, iconSize, iconSize);
        ctx.fillStyle = '#FFF';
        ctx.font = `${iconSize * 0.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 4 + iconSize / 2, iconY + iconSize / 2);
      }

      const weaponShape = TEAM_SHAPES[team] || 'circle';
      drawShapeUnder(tokenWidth - iconSize/2 - 4, iconY + iconSize/2, iconSize, weaponShape, shapeColor);
      if (weaponIconUrl) {
        const img = new Image();
        img.src = weaponIconUrl;
        img.onload = () => {
          ctx.drawImage(img, tokenWidth - iconSize - 4, iconY, iconSize, iconSize);
        };
        try {
          ctx.drawImage(img, tokenWidth - iconSize - 4, iconY, iconSize, iconSize);
        } catch {}
      } else {
        ctx.fillStyle = '#888';
        ctx.fillRect(tokenWidth - iconSize - 4, iconY, iconSize, iconSize);
        ctx.fillStyle = '#FFF';
        ctx.font = `${iconSize * 0.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚔️', tokenWidth - iconSize / 2 - 4, iconY + iconSize / 2);
      }

      // --- CORRECTED HEART LOGIC ---
      // Only draw up to maxMorale hearts (morale capacity)
      const totalHeartsToDraw = Math.max(0, Math.min(10, maxMorale));

      // morale is the current morale value (out of maxMorale)
      const heartsFilled = Math.max(0, Math.min(morale, maxMorale));

      const heartAreaTop = infoY + 2;
      const heartAreaBottom = tokenHeight - 4;
      const heartAreaHeight = heartAreaBottom - heartAreaTop;

      // Middle 50% horizontally (25% margin on each side)
      const marginX = tokenWidth * 0.25;
      const heartAreaLeft = marginX;
      const heartAreaRight = tokenWidth - marginX;
      const heartAreaWidth = heartAreaRight - heartAreaLeft;

      const heartsPerRow = 5;
      const numRows = 2;

      // Calculate heart size to fill the available width with heartsPerRow hearts, side-touching
      const heartSize = Math.max(6, heartAreaWidth / heartsPerRow);

      // Calculate total height of all rows
      const totalHeartHeight = numRows * heartSize * 1.05; // 5% gap between rows
      const verticalPadding = Math.max(0, (heartAreaHeight - totalHeartHeight) / 2);

      // --- CENTERING FIX: centers the row of hearts within the middle 50% area ---
      // We want the centers of the hearts to be evenly spaced and centered.
      // The span of centers is from startX to startX + (heartsPerRow - 1) * heartSize.
      // The center of that span is startX + (heartsPerRow - 1) * heartSize / 2.
      // We want that to equal heartAreaLeft + heartAreaWidth / 2.
      const centerOfArea = heartAreaLeft + heartAreaWidth / 2;
      const startX = centerOfArea - ((heartsPerRow - 1) * heartSize) / 2;
      const startY = heartAreaTop + verticalPadding;

      // Draw only up to totalHeartsToDraw hearts (morale capacity)
      for (let i = 0; i < totalHeartsToDraw; i++) {
        const row = Math.floor(i / heartsPerRow);
        const col = i % heartsPerRow;
        const x = startX + col * heartSize;
        const y = startY + row * heartSize * 1.05;
        // Filled if index is less than heartsFilled
        const isFilled = i < heartsFilled;
        drawHeart(ctx, x, y, heartSize, isFilled);
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `${Math.min(9, infoHeight * 0.18)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const displayName = unitName.length > 12 ? unitName.slice(0, 10) + '…' : unitName;
      ctx.fillText(displayName, tokenWidth / 2, tokenHeight - 2);
    }

    const dataURL = canvas.toDataURL('image/png');
    if (onRender) {
      onRender(dataURL);
    }

    return dataURL;
  }, [
    bodyCount,
    maxBodyCount,
    formation,
    team,
    troopScale,
    isMounted,
    isRouted,
    morale,
    maxMorale,
    raceIconUrl,
    weaponIconUrl,
    width,
    showInfo,
    unitName,
    onRender,
  ]);

  function drawHeart(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    filled: boolean
  ) {
    const s = size / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 10, s / 10);
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.bezierCurveTo(-6, -3, -10, 3, 0, 10);
    ctx.bezierCurveTo(10, 3, 6, -3, 0, 3);
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = '#FF4444';
      ctx.fill();
      ctx.strokeStyle = '#CC2222';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#FF4444';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  useEffect(() => {
    renderToken();
  }, [renderToken]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={width}
      style={{ width: `${width}px`, height: `${width}px` }}
      className="rounded-sm"
    />
  );
}