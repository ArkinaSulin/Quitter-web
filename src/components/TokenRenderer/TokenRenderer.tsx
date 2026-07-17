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
  sizeCategory: number;
  isMounted: boolean;
  isRouted: boolean;
  morale: number;
  maxMorale: number;
  isHero: boolean;
  raceIconUrl?: string;
  weaponIconUrl?: string;
  customImageUrl?: string;
  width?: number;
  showInfo?: boolean;
  onRender?: (dataURL: string) => void;
  currentHp?: number;
  maxHp?: number;
  onImageClick?: () => void;
}

const RENDER_SCALE = 1;

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

export function TokenRenderer({
  unitName,
  bodyCount,
  maxBodyCount,
  formation,
  team,
  troopScale,
  sizeCategory,
  isMounted,
  isRouted,
  morale,
  maxMorale,
  isHero,
  raceIconUrl,
  weaponIconUrl,
  customImageUrl,
  width = 400,
  showInfo = true,
  onRender,
  currentHp = 50,
  maxHp = 100,
  onImageClick,
}: TokenRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heroCacheKeyRef = useRef<string>('');
  const heroReadyRef = useRef<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);

  // --- Helper: create offscreen canvas for hero cache ---
  const getOffscreenCanvas = useCallback((w: number, h: number) => {
    if (!offscreenCanvasRef.current) {
      const canvas = document.createElement('canvas');
      offscreenCanvasRef.current = canvas;
    }
    const canvas = offscreenCanvasRef.current;
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }, []);

  // --- Helper: draw static hero content onto offscreen canvas ---
  const drawHeroStatic = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const bgColor = TEAM_COLORS[team];
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    drawTeamShapeOverlay(ctx, team, w, h, true);

    const imageUrl = customImageUrl || raceIconUrl;
    const topAreaHeight = h * 0.667;
    const padding = w * 0.05;

    if (imageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const imageSize = Math.min(w - padding * 2, topAreaHeight - padding * 2);
        const x = (w - imageSize) / 2;
        const y = padding;
        ctx.drawImage(img, x, y, imageSize, imageSize);
        drawName(ctx, unitName, w, h, team);
        heroReadyRef.current = true;
        // Trigger re-render to show cached image
        renderToken();
      };
      img.onerror = () => {
        drawRaceIconFallback(ctx, null, w, h);
        drawName(ctx, unitName, w, h, team);
        heroReadyRef.current = true;
        renderToken();
      };
      img.src = imageUrl;
    } else {
      drawRaceIconFallback(ctx, null, w, h);
      drawName(ctx, unitName, w, h, team);
      heroReadyRef.current = true;
    }
  }, [team, customImageUrl, raceIconUrl, unitName]);

  // --- The render function ---
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

    const config = getFormationConfig(
      isRouted ? 'Routed' : formation,
      isMounted,
      sizeCategory
    );

    const dotRadius = tokenWidth * 0.02 * (troopScale / 100) * (sizeCategory / 100);
    const dotsPerRow = config.dotsPerRow;
    const dotColor = getDotColor(team);

    // --- HERO RENDERING (with offscreen caching) ---
    if (isHero) {
      const imageUrl = customImageUrl || raceIconUrl || '';
      const cacheKey = `${team}-${imageUrl}-${unitName}-${tokenWidth}-${tokenHeight}`;

      // Check if cache is invalid or not ready
      if (!heroReadyRef.current || heroCacheKeyRef.current !== cacheKey) {
        heroCacheKeyRef.current = cacheKey;
        heroReadyRef.current = false;
        const offscreen = getOffscreenCanvas(tokenWidth, tokenHeight);
        const offCtx = offscreen.getContext('2d')!;
        drawHeroStatic(offCtx, tokenWidth, tokenHeight);
        // If image is loading, drawHeroStatic will call renderToken again when loaded.
        // For now, draw a placeholder and return.
        if (!heroReadyRef.current) {
          // Draw fallback placeholder on main canvas
          drawRaceIconFallback(ctx, null, tokenWidth, tokenHeight);
          drawName(ctx, unitName, tokenWidth, tokenHeight, team);
          drawBottomHero(ctx, tokenWidth, tokenHeight, currentHp, maxHp);
          if (onRender) onRender(canvas.toDataURL());
          return;
        }
      }

      // If cache is ready, draw it and overlay HP bar
      if (heroReadyRef.current && offscreenCanvasRef.current) {
        ctx.drawImage(offscreenCanvasRef.current, 0, 0, tokenWidth, tokenHeight);
        drawBottomHero(ctx, tokenWidth, tokenHeight, currentHp, maxHp);
        if (onRender) onRender(canvas.toDataURL());
        return;
      }

      // Fallback: draw directly (should rarely happen)
      drawRaceIconFallback(ctx, null, tokenWidth, tokenHeight);
      drawName(ctx, unitName, tokenWidth, tokenHeight, team);
      drawBottomHero(ctx, tokenWidth, tokenHeight, currentHp, maxHp);
      if (onRender) onRender(canvas.toDataURL());
      return;
    }

    // --- NORMAL UNIT RENDERING (full original logic) ---
    const seed = 42;
    const positions = generateDotPositions(
      bodyCount,
      maxBodyCount,
      isRouted ? 'Routed' : formation,
      isMounted,
      tokenWidth,
      tokenHeight,
      dotRadius,
      sizeCategory,
      seed
    );

    // PHALANX pikes
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

    // SHIELD WALL shields
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

    // Draw troops
    for (const pos of positions) {
      const { x, y, isDead, direction } = pos;
      if (isMounted) {
        const baseWidth = dotRadius * config.triangleBaseModifier * 1.8;
        const height = dotRadius * config.triangleHeightModifier * 2.0;
        ctx.save();
        ctx.translate(x, y);
        if (direction !== undefined) ctx.rotate(direction);
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

    // Routed flag
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

    // Unit name (for normal units)
    drawName(ctx, unitName, tokenWidth, tokenHeight, team);

    // Bottom info – icons and morale hearts
    if (showInfo) {
      drawBottomInfo(
        ctx,
        tokenWidth,
        tokenHeight,
        team,
        dotColor,
        raceIconUrl,
        weaponIconUrl,
        customImageUrl,
        morale,
        maxMorale,
        unitName,
        isHero
      );
    }

    const dataURL = canvas.toDataURL('image/png');
    if (onRender) onRender(dataURL);
  }, [
    unitName,
    bodyCount,
    maxBodyCount,
    formation,
    team,
    troopScale,
    sizeCategory,
    isMounted,
    isRouted,
    morale,
    maxMorale,
    isHero,
    raceIconUrl,
    weaponIconUrl,
    customImageUrl,
    width,
    showInfo,
    onRender,
    currentHp,
    maxHp,
    drawHeroStatic,
    getOffscreenCanvas,
  ]);

  // --- Helper functions ---

  function drawTeamShapeOverlay(ctx: CanvasRenderingContext2D, team: Team, tokenWidth: number, tokenHeight: number, large: boolean = false) {
    const centerX = tokenWidth / 2;
    const centerY = tokenHeight / 3;
    const radius = large ? Math.min(tokenWidth, tokenHeight) * 0.45 : Math.min(tokenWidth, tokenHeight) * 0.35;
    const shape = TEAM_SHAPES[team] || 'circle';
    const color = getDotColor(team);
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = color;
    ctx.translate(centerX, centerY);
    const s = radius;
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

  function drawName(ctx: CanvasRenderingContext2D, name: string, tokenWidth: number, tokenHeight: number, team: Team) {
    const infoY = tokenHeight * 0.667;
    const nameY = infoY + 10;
    const maxNameWidth = tokenWidth * 0.9;
    let fontSize = tokenWidth * 0.12;
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
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = getDotColor(team);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(testName, tokenWidth / 2, nameY);
    ctx.restore();
  }

  function drawBottomHero(ctx: CanvasRenderingContext2D, tokenWidth: number, tokenHeight: number, currentHp: number, maxHp: number) {
    const infoY = tokenHeight * 0.667;
    const infoHeight = tokenHeight * 0.333;
    const barWidth = tokenWidth * 0.75;
    const barHeight = infoHeight * 0.6;
    const barX = 0;
    const barY = infoY + (infoHeight - barHeight) / 2;
    const hpPercent = Math.max(0, Math.min(1, currentHp / maxHp));
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = '#FF4444';
    ctx.fillRect(barX + barWidth * (1 - hpPercent), barY, barWidth * hpPercent, barHeight);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    // HP numbers further right
    const textX = tokenWidth * 0.92;
    const textY = infoY + infoHeight * 0.25;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${infoHeight * 0.35}px sans-serif`;
    ctx.fillText(`${Math.floor(currentHp)}`, textX, textY);
    ctx.fillStyle = '#AAAAAA';
    ctx.font = `${infoHeight * 0.25}px sans-serif`;
    ctx.fillText(`${Math.floor(maxHp)}`, textX, textY + infoHeight * 0.35);
    ctx.restore();
  }

  function drawRaceIconFallback(ctx: CanvasRenderingContext2D, url: string | undefined, tokenWidth: number, tokenHeight: number) {
    const size = Math.min(tokenWidth, tokenHeight) * 0.3;
    const x = (tokenWidth - size) / 2;
    const y = (tokenHeight * 0.667 - size) / 2;
    ctx.fillStyle = '#666';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#FFF';
    ctx.font = `${size * 0.4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', tokenWidth / 2, tokenHeight * 0.333);
  }

  function drawBottomInfo(
    ctx: CanvasRenderingContext2D,
    tokenWidth: number,
    tokenHeight: number,
    team: Team,
    dotColor: string,
    raceIconUrl?: string,
    weaponIconUrl?: string,
    customImageUrl?: string,
    morale?: number,
    maxMorale?: number,
    unitName?: string,
    isHero?: boolean
  ) {
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
    };

    const shape = TEAM_SHAPES[team] || 'circle';
    const shapeColor = getDotColor(team) === '#000000' ? '#000000' : '#FFFFFF';

    // Left icon: custom image or race icon
    const leftIconUrl = customImageUrl || raceIconUrl;
    if (leftIconUrl) {
      loadImage(leftIconUrl)
        .then((img) => {
          ctx.drawImage(img, 4, iconY, iconSize, iconSize);
          if (onRender) onRender(canvasRef.current?.toDataURL() || '');
        })
        .catch(() => {
          ctx.fillStyle = '#888';
          ctx.fillRect(4, iconY, iconSize, iconSize);
          ctx.fillStyle = '#FFF';
          ctx.font = `${iconSize * 0.5}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', 4 + iconSize / 2, iconY + iconSize / 2);
          if (onRender) onRender(canvasRef.current?.toDataURL() || '');
        });
    } else {
      ctx.fillStyle = '#888';
      ctx.fillRect(4, iconY, iconSize, iconSize);
      ctx.fillStyle = '#FFF';
      ctx.font = `${iconSize * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 4 + iconSize / 2, iconY + iconSize / 2);
    }
    drawShapeUnder(4 + iconSize/2, iconY + iconSize/2, iconSize * 1.2, shape, shapeColor);

    // Right icon: weapon icon
    if (weaponIconUrl) {
      loadImage(weaponIconUrl)
        .then((img) => {
          ctx.drawImage(img, tokenWidth - iconSize - 4, iconY, iconSize, iconSize);
          if (onRender) onRender(canvasRef.current?.toDataURL() || '');
        })
        .catch(() => {
          ctx.fillStyle = '#888';
          ctx.fillRect(tokenWidth - iconSize - 4, iconY, iconSize, iconSize);
          ctx.fillStyle = '#FFF';
          ctx.font = `${iconSize * 0.5}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⚔️', tokenWidth - iconSize / 2 - 4, iconY + iconSize / 2);
          if (onRender) onRender(canvasRef.current?.toDataURL() || '');
        });
    } else {
      ctx.fillStyle = '#888';
      ctx.fillRect(tokenWidth - iconSize - 4, iconY, iconSize, iconSize);
      ctx.fillStyle = '#FFF';
      ctx.font = `${iconSize * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚔️', tokenWidth - iconSize / 2 - 4, iconY + iconSize / 2);
    }
    drawShapeUnder(tokenWidth - iconSize/2 - 4, iconY + iconSize/2, iconSize * 1.2, shape, shapeColor);

    // Morale hearts (only for non-hero)
    if (!isHero) {
      const totalHeartsToDraw = Math.max(0, Math.min(10, maxMorale || 0));
      const heartsFilled = Math.max(0, Math.min(morale || 0, maxMorale || 0));
      const heartAreaTop = infoY + 2;
      const heartAreaBottom = tokenHeight - 4;
      const heartAreaHeight = heartAreaBottom - heartAreaTop;
      const marginX = tokenWidth * 0.25;
      const heartAreaLeft = marginX;
      const heartAreaRight = tokenWidth - marginX;
      const heartAreaWidth = heartAreaRight - heartAreaLeft;
      const heartsPerRow = 5;
      const numRows = 2;
      const heartSize = Math.max(6, heartAreaWidth / heartsPerRow);
      const totalHeartHeight = numRows * heartSize * 1.05;
      const verticalPadding = Math.max(0, (heartAreaHeight - totalHeartHeight) / 2);
      const centerOfArea = heartAreaLeft + heartAreaWidth / 2;
      const startX = centerOfArea - ((heartsPerRow - 1) * heartSize) / 2;
      const startY = heartAreaTop + verticalPadding;

      for (let i = 0; i < totalHeartsToDraw; i++) {
        const row = Math.floor(i / heartsPerRow);
        const col = i % heartsPerRow;
        const x = startX + col * heartSize;
        const y = startY + row * heartSize * 1.05;
        const isFilled = i < heartsFilled;
        drawHeart(ctx, x, y, heartSize, isFilled);
      }
    }
  }

  function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, filled: boolean) {
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

  // --- Use requestAnimationFrame to debounce renders ---
  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      renderToken();
      animationFrameRef.current = null;
    });
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [renderToken]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={width}
      style={{ width: `${width}px`, height: `${width}px` }}
      className="rounded-sm cursor-pointer"
      onClick={onImageClick}
    />
  );
}