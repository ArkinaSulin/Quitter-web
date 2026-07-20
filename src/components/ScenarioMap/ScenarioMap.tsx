// src/components/ScenarioMap/ScenarioMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useHexGrid, hexToPixel } from '@/hooks/useHexGrid';
import { Hex, UnitTemplate } from '@/types/gameProtocol';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';
import { useScenarios } from '@/hooks/useScenarios';
import { useMessages } from '@/contexts/MessageContext';
import { LeftPanel } from './LeftPanel';
import { ContextMenu } from './ContextMenu';
import { UnitTooltip } from './UnitTooltip';
import { drawToken } from '@/components/TokenRenderer/drawToken';

interface ScenarioMapProps {
  scenarioId: string;
}

const HEX_SIZE = 100;
const TOKEN_WIDTH = HEX_SIZE * 1.6;
const TOKEN_HEIGHT = TOKEN_WIDTH * 0.75;

export function ScenarioMap({ scenarioId }: ScenarioMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedHex, setSelectedHex] = useState<Hex | null>(null);
  const { units, moveUnit, loading, error, addUnitFromTemplate, deleteUnit } = useSupabaseSync(scenarioId);
  const { getMyRole, updateScreenshot, unsubscribeFromPresence, subscribeToPresence, fetchScenarios } = useScenarios();
  const { addMessage } = useMessages();
  const [isGM, setIsGM] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Drag from panel
  const [isDraggingFromPanel, setIsDraggingFromPanel] = useState(false);
  const [draggingTemplate, setDraggingTemplate] = useState<UnitTemplate | null>(null);
  const [ghostHex, setGhostHex] = useState<Hex | null>(null);

  // Tooltip
  const [hoveredUnit, setHoveredUnit] = useState<Unit | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Context menu
  const [contextMenuUnit, setContextMenuUnit] = useState<Unit | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  const handleUnitMove = useCallback((unitId: string, targetHex: Hex) => {
    moveUnit(unitId, targetHex);
  }, [moveUnit]);

  // Refs for zoom/offset to be used in customDraw
  const zoomRef = useRef(1);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);

  // Custom draw function that uses drawToken
  const customDraw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const currentZoom = zoomRef.current;
    const tokenWidth = TOKEN_WIDTH * currentZoom;
    const tokenHeight = TOKEN_HEIGHT * currentZoom;
    for (const unit of units) {
      const pos = hexToPixel(unit.hex, HEX_SIZE);
      const cx = pos.x * currentZoom + offsetXRef.current;
      const cy = pos.y * currentZoom + offsetYRef.current;
      drawToken({
        unit,
        ctx,
        x: cx,
        y: cy,
        width: tokenWidth,
        height: tokenHeight,
        zoom: currentZoom,
        showDetails: true,
      }).catch(err => console.error('drawToken error:', err));
    }
  }, [units]);

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
    getHexFromScreen,
    getUnitAt,
    centerMap,
  } = useHexGrid({
    canvasRef,
    size: HEX_SIZE,
    gridRadius: 8,
    units: units,
    onUnitMove: handleUnitMove,
    onHexClick: (hex) => setSelectedHex(hex),
    onHexRightClick: (hex, unit) => {
      if (unit) {
        setContextMenuUnit(unit);
        setContextMenuPos({ x: window.event?.clientX || 0, y: window.event?.clientY || 0 });
      }
    },
    onUnitHover: (unit, screenX, screenY) => {
      setHoveredUnit(unit);
      setTooltipPos({ x: screenX, y: screenY });
    },
    onUnitLeave: () => {
      setHoveredUnit(null);
      setTooltipPos(null);
    },
    onAttack: (attackerId, targetId) => {
      addMessage(`Attack from ${attackerId} on ${targetId}`);
    },
    customDraw,
    autoCenter: isInitialLoad,
  });

  // Update refs when zoom/offset change
  useEffect(() => {
    zoomRef.current = zoom;
    offsetXRef.current = offsetX;
    offsetYRef.current = offsetY;
  }, [zoom, offsetX, offsetY]);

  // Center map on initial load
  useEffect(() => {
    if (isInitialLoad && !loading && canvasRef.current) {
      const timer = setTimeout(() => {
        centerMap();
        setIsInitialLoad(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isInitialLoad, loading, canvasRef, centerMap]);

  // ---- Drag from panel ----
  useEffect(() => {
    const handleDragStart = (e: CustomEvent) => {
      setDraggingTemplate(e.detail.template);
      setIsDraggingFromPanel(true);
    };
    window.addEventListener('unitDragStart', handleDragStart as EventListener);
    return () => window.removeEventListener('unitDragStart', handleDragStart as EventListener);
  }, []);

  useEffect(() => {
    if (!isDraggingFromPanel || !draggingTemplate) return;
    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const hex = getHexFromScreen(e.clientX - rect.left, e.clientY - rect.top);
        setGhostHex(hex);
      }
    };
    const onMouseUp = async (e: MouseEvent) => {
      if (window.getSelection) {
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      }
      if (canvasRef.current && draggingTemplate) {
        const rect = canvasRef.current.getBoundingClientRect();
        const hex = getHexFromScreen(e.clientX - rect.left, e.clientY - rect.top);
        if (hex) {
          const success = await addUnitFromTemplate(draggingTemplate, hex, 'black');
          if (success) addMessage(`Placed ${draggingTemplate.name} at (${hex.q}, ${hex.r})`);
          else addMessage(`Failed to place ${draggingTemplate.name}`);
        }
      }
      setIsDraggingFromPanel(false);
      setDraggingTemplate(null);
      setGhostHex(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDraggingFromPanel, draggingTemplate, addUnitFromTemplate, addMessage, getHexFromScreen]);

  // Simplified: template now has raceIconUrl and unitTypeIconUrl
  const handlePlaceUnit = useCallback(async (template: UnitTemplate, hex: Hex) => {
    const success = await addUnitFromTemplate(template, hex, 'black');
    if (success) addMessage(`Placed ${template.name} at (${hex.q}, ${hex.r})`);
    else addMessage(`Failed to place ${template.name}`);
  }, [addUnitFromTemplate, addMessage]);

  // ---- Screenshot capture (unchanged) ----
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
        const gridRadius = 8;
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

      const gridRadius = 8;
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

      const teamColors: Record<string, string> = {
        blue: '#0072B2',
        yellow: '#F0E442',
        black: '#333333',
        violet: '#CC79A7',
        orange: '#D55E00',
        green: '#009E73',
      };

      for (const unit of units) {
        const pos = hexToPixel(unit.hex, HEX_SIZE);
        const cx = pos.x * fitZoom + fitOffsetX;
        const cy = pos.y * fitZoom + fitOffsetY;
        const radius = HEX_SIZE * fitZoom * 0.4;
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
          const tipX = cx + HEX_SIZE * fitZoom * Math.cos(angle);
          const tipY = cy + HEX_SIZE * fitZoom * Math.sin(angle);
          const baseRadius = HEX_SIZE * fitZoom * 0.7;
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
  }, [canvasRef, units, scenarioId, updateScreenshot]);

  // ---- Auto-capture on exit ----
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isGM) {
        captureAndUploadScreenshot();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isGM, captureAndUploadScreenshot]);

  const goToLobby = async () => {
    if (isGM) {
      await captureAndUploadScreenshot();
      await fetchScenarios();
    }
    unsubscribeFromPresence(scenarioId);
    localStorage.removeItem('currentScenarioId');
    window.location.reload();
  };

  // ---- Role detection ----
  useEffect(() => {
    getMyRole(scenarioId).then(role => {
      const gm = role === 'GM';
      setIsGM(gm);
      if (gm) subscribeToPresence(scenarioId, () => {});
    });
  }, [scenarioId, getMyRole, subscribeToPresence]);

  if (loading) return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading scenario...</div>;
  if (error) return <div className="w-full h-screen bg-[#0d0d1a] text-red-500 flex items-center justify-center">Error: {error}</div>;

  return (
    <div className="relative w-full h-screen bg-[#0d0d1a] overflow-hidden select-none">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2 bg-black/40 backdrop-blur-sm">
        <div className="text-white text-lg font-semibold">
          Scenario Map - {isGM ? 'DM' : 'Player'}
        </div>
        <button onClick={goToLobby} className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded shadow-lg text-sm">
          Exit Session
        </button>
      </div>

      {/* Floating Left Panel */}
      <div className="absolute top-14 left-2 z-10">
        <LeftPanel scenarioId={scenarioId} onPlaceUnit={handlePlaceUnit} />
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-default"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleRightClick}
        onWheel={handleWheel}
      />

      {/* Ghost preview */}
      {isDraggingFromPanel && ghostHex && (
        <div
          className="absolute pointer-events-none border-2 border-dashed border-yellow-400 rounded-full"
          style={{
            left: `${(hexToPixel(ghostHex, HEX_SIZE).x * zoom + offsetX)}px`,
            top: `${(hexToPixel(ghostHex, HEX_SIZE).y * zoom + offsetY)}px`,
            width: `${TOKEN_WIDTH * zoom}px`,
            height: `${TOKEN_HEIGHT * zoom}px`,
            transform: 'translate(-50%, -50%)',
            background: 'rgba(255,255,0,0.2)',
          }}
        />
      )}

      {/* Tooltip */}
      {hoveredUnit && tooltipPos && (
        <UnitTooltip unit={hoveredUnit} x={tooltipPos.x} y={tooltipPos.y} />
      )}

      {/* Context Menu */}
      {contextMenuUnit && contextMenuPos && (
        <ContextMenu
          unit={contextMenuUnit}
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          isGM={isGM}
          onClose={() => { setContextMenuUnit(null); setContextMenuPos(null); }}
          onRotate={(dir) => addMessage(`Rotate ${dir} for ${contextMenuUnit.name}`)}
          onChangeFormation={(formation) => addMessage(`Set formation ${formation} for ${contextMenuUnit.name}`)}
          onSelectWeapon={(idx) => addMessage(`Selected weapon ${idx} for ${contextMenuUnit.name}`)}
          onAssignTeam={(team) => addMessage(`Assign team ${team} to ${contextMenuUnit.name}`)}
          onToggleHide={() => addMessage(`Toggle hide for ${contextMenuUnit.name}`)}
          onDeleteUnit={async () => {
            const success = await deleteUnit(contextMenuUnit.id);
            if (success) addMessage(`Deleted ${contextMenuUnit.name}`);
            else addMessage(`Failed to delete ${contextMenuUnit.name}`);
          }}
        />
      )}

      {/* Debug Panel */}
      <div className="absolute bottom-4 right-4 bg-black/60 text-white px-4 py-2 rounded-lg text-sm font-mono space-y-1 pointer-events-none">
        <div>Hover: {hoveredHex ? `${hoveredHex.q}, ${hoveredHex.r}` : '—'}</div>
        <div>Selected: {selectedHex ? `${selectedHex.q}, ${selectedHex.r}` : '—'}</div>
        <div>Dragging: {draggingUnitId || (isDraggingFromPanel ? 'from panel' : '—')}</div>
        <div className="text-green-400 text-xs">Realtime active</div>
        <div className="text-gray-400 text-xs">Units: {units.length}</div>
        <div className="text-gray-500 text-xs">Scenario: {scenarioId.slice(0, 8)}…</div>
        {isGM && <div className="text-yellow-400 text-xs">DM</div>}
      </div>
    </div>
  );
}