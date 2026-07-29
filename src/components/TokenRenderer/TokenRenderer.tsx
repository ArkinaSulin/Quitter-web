// src/components/TokenRenderer/TokenRenderer.tsx
'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { drawToken } from './drawToken';
import { Team } from './tokenUtils';

export interface TokenRendererProps {
  unitName: string;
  troopCount: number;
  maxTroopCount: number;
  currentFormation: 'Open Order' | 'Close Order' | 'Scattered' | 'Phalanx' | 'Shield Wall' | 'Routed';
  team: Team;
  visualScale: number;
  sizeCategory: number;
  isRouted: boolean;
  currentMorale: number;
  baseMorale: number;
  isHero: boolean;
  raceIconUrl?: string;
  unitTypeIconUrl?: string;
  customImageUrl?: string;
  width?: number;
  height?: number;
  showInfo?: boolean;
  onRender?: (dataURL: string) => void;
  currentUnitHp?: number;
  maxUnitHp?: number;
  onImageClick?: () => void;
  mountId?: string | null;
}

export function TokenRenderer(props: TokenRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    unitName,
    troopCount,
    maxTroopCount,
    currentFormation,
    team,
    visualScale,
    sizeCategory,
    isRouted,
    currentMorale,
    baseMorale,
    isHero,
    raceIconUrl,
    unitTypeIconUrl,
    customImageUrl,
    width = 400,
    height,
    showInfo = true,
    onRender,
    currentUnitHp = 50,
    maxUnitHp = 100,
    onImageClick,
    mountId = null,
  } = props;

  const isMounted = !!mountId;
  const logicalHeight = height ?? width;
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [preloadedImages, setPreloadedImages] = useState<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    const imageUrls: string[] = [];
    if (customImageUrl) imageUrls.push(customImageUrl);
    if (raceIconUrl) imageUrls.push(raceIconUrl);
    if (unitTypeIconUrl) imageUrls.push(unitTypeIconUrl);

    if (imageUrls.length === 0) {
      setImagesLoaded(true);
      return;
    }

    const loadImage = (url: string): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    };

    const loadAll = async () => {
      const map = new Map<string, HTMLImageElement>();
      try {
        const results = await Promise.allSettled(imageUrls.map(url => loadImage(url)));
        results.forEach((result, idx) => {
          if (result.status === 'fulfilled') {
            map.set(imageUrls[idx], result.value);
          } else {
            console.warn(`Failed to load image: ${imageUrls[idx]}`);
          }
        });
        setPreloadedImages(map);
      } catch (e) {
        console.error('Image loading error:', e);
      } finally {
        setImagesLoaded(true);
      }
    };

    loadAll();
  }, [customImageUrl, raceIconUrl, unitTypeIconUrl]);

  const renderToken = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = logicalHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${logicalHeight}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, logicalHeight);

    const unit = {
      id: 'preview',
      unitName: unitName,
      hex: { q: 0, r: 0, s: 0 },
      facing: 0,
      team: team,
      currentUnitHp: currentUnitHp,
      maxUnitHp: maxUnitHp,
      isHero: isHero,
      attachedToUnitId: null,
      currentFormation: currentFormation,
      aggressiveness: 3,
      baseMorale: baseMorale,
      currentMoraleModifier: currentMorale,
      baseAc: 10,
      currentAc: 10,
      isRouting: isRouted,
      weaponString: '',
      templateId: null,
      currentTroopCount: troopCount,
      maxTroopCount: maxTroopCount,
      visualScale: visualScale,
      sizeCategory: sizeCategory,
      mountId: mountId,
      raceIconUrl: raceIconUrl || '',
      unitTypeIconUrl: unitTypeIconUrl || '',
      customImageUrl: customImageUrl || '',
      hidden: false,
      formationAvailability: [],
    } as any;

    const tokenWidth = width * 0.9;
    const tokenHeight = logicalHeight * 0.9;

    await drawToken({
      unit,
      ctx,
      x: width / 2,
      y: logicalHeight / 2,
      width: tokenWidth,
      height: tokenHeight,
      zoom: 1,
      showDetails: showInfo,
      preloadedImages: preloadedImages,
    });

    const dataURL = canvas.toDataURL('image/png');
    if (onRender) onRender(dataURL);
  }, [width, logicalHeight, onRender, preloadedImages, imagesLoaded, mountId, unitName, troopCount, maxTroopCount, currentFormation, team, visualScale, sizeCategory, isRouted, currentMorale, baseMorale, isHero, raceIconUrl, unitTypeIconUrl, customImageUrl, currentUnitHp, maxUnitHp, showInfo]);

  useEffect(() => {
    if (imagesLoaded) {
      renderToken();
    }
  }, [renderToken, imagesLoaded]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={logicalHeight}
      style={{ width: `${width}px`, height: `${logicalHeight}px` }}
      className="rounded-sm cursor-pointer"
      onClick={onImageClick}
    />
  );
}