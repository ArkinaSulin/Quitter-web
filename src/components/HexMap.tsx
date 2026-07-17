// src/components/HexMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useHexGrid, hexToPixel } from '@/hooks/useHexGrid';
import { Hex } from '@/types/gameProtocol';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';
import { useScenarios } from '@/hooks/useScenarios';
import { supabase } from '@/lib/supabaseClient';
import { parseWeapons, getWeaponDisplayText } from '@/lib/weaponParser';

interface HexMapProps {
  scenarioId: string;
}

export function HexMap({ scenarioId }: HexMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedHex, setSelectedHex] = useState<Hex | null>(null);
  const { units, moveUnit, loading, error, seedDemoUnits } = useSupabaseSync(scenarioId);
  const { getMyRole, updateScreenshot, unsubscribeFromPresence, subscribeToPresence } = useScenarios();
  const [isGM, setIsGM] = useState(false);

  const handleUnitMove = useCallback((unitId: string, targetHex: Hex) => {
    moveUnit(unitId, targetHex);
  }, [moveUnit]);

  const {
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleRightClick,
    handleWheel,
    hoveredHex,
    draggingUnitId,
    offsetX,
    offsetY,
    zoom,
  } = useHexGrid({
    canvasRef,
    size: 80,
    gridRadius: 8,
    units: units,
    onUnitMove: handleUnitMove,
    onHexClick: (hex) => {
      setSelectedHex(hex);
      console.log('[HexMap] Clicked hex:', hex);
    },
    onHexRightClick: (hex) => {
      console.log('[HexMap] Right-clicked hex:', hex);
    },
  });

  useEffect(() => {
    seedDemoUnits();
    getMyRole(scenarioId).then(role => {
      const gm = role === 'GM';
      setIsGM(gm);
      if (gm) {
        subscribeToPresence(scenarioId, () => {});
      }
    });
  }, [scenarioId, seedDemoUnits, getMyRole, subscribeToPresence]);

  /**
   * Capture current canvas with zoom‑to‑fit and upload using deterministic filename.
   */
  const captureAndUploadScreenshot = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      // Step 1: Save current canvas state (to restore later)
      const currentWidth = canvas.width;
      const currentHeight = canvas.height;
      const currentStyleWidth = canvas.style.width;
      const currentStyleHeight = canvas.style.height;
      const dpr = window.devicePixelRatio || 1;

      // Step 2: Determine bounding box of units (if any)
      const size = 80;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      if (units.length > 0) {
        for (const unit of units) {
          const pos = hexToPixel(unit.hex, size);
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
        // No units: capture the full visible area with some margin
        const rect = canvas.getBoundingClientRect();
        minX = -rect.width * 0.25;
        minY = -rect.height * 0.25;
        maxX = rect.width * 0.25;
        maxY = rect.height * 0.25;
      }

      const worldWidth = maxX - minX;
      const worldHeight = maxY - minY;
      const rect = canvas.getBoundingClientRect();
      const displayWidth = rect.width;
      const displayHeight = rect.height;
      const zoomX = displayWidth / worldWidth;
      const zoomY = displayHeight / worldHeight;
      const fitZoom = Math.min(zoomX, zoomY, 2);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const fitOffsetX = displayWidth / 2 - centerX * fitZoom;
      const fitOffsetY = displayHeight / 2 - centerY * fitZoom;

      // Step 3: Set canvas size for the screenshot
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      ctx.scale(dpr, dpr);

      // Step 4: Clear and draw the grid and units with fit transformation
      const drawFitGrid = () => {
        ctx.clearRect(0, 0, displayWidth, displayHeight);
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, displayWidth, displayHeight);

        // Draw hex grid
        const gridRadius = 8;
        const hexes: Hex[] = [];
        for (let q = -gridRadius; q <= gridRadius; q++) {
          for (let r = -gridRadius; r <= gridRadius; r++) {
            const s = -q - r;
            if (Math.abs(s) <= gridRadius) hexes.push({ q, r, s });
          }
        }

        const drawHex = (hex: Hex) => {
          const pos = hexToPixel(hex, size);
          const cx = pos.x * fitZoom + fitOffsetX;
          const cy = pos.y * fitZoom + fitOffsetY;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (60 * i - 30);
            const px = cx + size * fitZoom * Math.cos(angle);
            const py = cy + size * fitZoom * Math.sin(angle);
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

        for (const hex of hexes) {
          drawHex(hex);
        }

        // Draw units
        const teamColors: Record<string, string> = {
          blue: '#0072B2',
          yellow: '#F0E442',
          black: '#333333',
          violet: '#CC79A7',
        };

        for (const unit of units) {
          const pos = hexToPixel(unit.hex, size);
          const cx = pos.x * fitZoom + fitOffsetX;
          const cy = pos.y * fitZoom + fitOffsetY;
          const radius = size * fitZoom * 0.4;
          const fillColor = teamColors[unit.team] || '#888';

          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
          ctx.fillStyle = fillColor;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = `${Math.max(10, radius * 0.7)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(unit.name.substring(0, 4), cx, cy - radius - 2);

          const hpWidth = radius * 1.6;
          const hpX = cx - hpWidth / 2;
          const hpY = cy + radius + 4;
          const hpHeight = 4;
          ctx.fillStyle = '#222222';
          ctx.fillRect(hpX, hpY, hpWidth, hpHeight);
          const hpRatio = Math.max(0, unit.hp / unit.maxHp);
          ctx.fillStyle = hpRatio > 0.5 ? '#44ff44' : '#ff4444';
          ctx.fillRect(hpX, hpY, hpWidth * hpRatio, hpHeight);

          if (!unit.isHero && unit.formation !== 'Scattered') {
            const angle = (60 * unit.facing - 30) * Math.PI / 180;
            const tipX = cx + size * fitZoom * Math.cos(angle);
            const tipY = cy + size * fitZoom * Math.sin(angle);
            const baseRadius = size * fitZoom * 0.7;
            const halfSpread = 0.4;
            const baseX1 = cx + baseRadius * Math.cos(angle - halfSpread);
            const baseY1 = cy + baseRadius * Math.sin(angle - halfSpread);
            const baseX2 = cx + baseRadius * Math.cos(angle + halfSpread);
            const baseY2 = cy + baseRadius * Math.sin(angle + halfSpread);
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(baseX1, baseY1);
            ctx.lineTo(baseX2, baseY2);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      };

      drawFitGrid();

      // Step 5: Convert canvas to JPEG Blob and create a File
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // Use deterministic filename: scenario_{scenarioId}.png
      const fileName = `scenario_${scenarioId}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      // Step 6: Call the unified updateScreenshot with the File
      await updateScreenshot(scenarioId, file);
      console.log('[Screenshot] Uploaded successfully using deterministic filename:', fileName);

      // Step 7: Restore canvas to its original state (preserve view)
      canvas.width = currentWidth;
      canvas.height = currentHeight;
      canvas.style.width = currentStyleWidth;
      canvas.style.height = currentStyleHeight;
      ctx.scale(dpr, dpr);

      // Redraw the original grid (using the current zoom/pan from useHexGrid)
      // We'll simply trigger a re-render by resetting offset/zoom (but we don't have that state here)
      // The canvas will be redrawn by the next frame anyway.
    } catch (err) {
      console.error('[Screenshot] Error:', err);
    }
  }, [canvasRef, units, scenarioId, updateScreenshot]);

  // --- Auto‑capture on beforeunload (only for GM) ---
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isGM) {
        captureAndUploadScreenshot();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isGM, captureAndUploadScreenshot]);

  // --- Exit session ---
  const goToLobby = async () => {
    if (isGM) {
      await captureAndUploadScreenshot();
    }
    unsubscribeFromPresence(scenarioId);
    localStorage.removeItem('currentScenarioId');
    window.location.reload();
  };

  if (loading) return (
    <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">
      Loading scenario...
    </div>
  );
  if (error) return (
    <div className="w-full h-screen bg-[#0d0d1a] text-red-500 flex items-center justify-center">
      Error: {error}
    </div>
  );

  return (
    <div className="relative w-full h-screen bg-[#0d0d1a] overflow-hidden">
      <button
        onClick={goToLobby}
        className="absolute top-4 left-4 z-10 bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded shadow-lg text-sm"
      >
        ← Exit Session
      </button>

      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-default"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleRightClick}
        onWheel={handleWheel}
      />

      <div className="absolute bottom-4 left-4 bg-black/60 text-white px-4 py-2 rounded-lg text-sm font-mono space-y-1">
        <div>Hover: {hoveredHex ? `${hoveredHex.q}, ${hoveredHex.r}` : '—'}</div>
        <div>Selected: {selectedHex ? `${selectedHex.q}, ${selectedHex.r}` : '—'}</div>
        <div>Dragging: {draggingUnitId || '—'}</div>
        <div className="text-green-400 text-xs">🟢 Realtime active</div>
        <div className="text-gray-400 text-xs">Units: {units.length}</div>
        <div className="text-gray-500 text-xs">Scenario: {scenarioId.slice(0, 8)}…</div>
        {isGM && <div className="text-yellow-400 text-xs">👑 DM</div>}
      </div>
    </div>
  );
}