// src/components/HexMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useHexGrid } from '@/hooks/useHexGrid';
import { Hex } from '@/types/gameProtocol';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';

interface HexMapProps {
  scenarioId: string;
}

export function HexMap({ scenarioId }: HexMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedHex, setSelectedHex] = useState<Hex | null>(null);

  const { units, moveUnit, loading, error, seedDemoUnits } = useSupabaseSync(scenarioId);

  // Seed demo units only once per scenario
  useEffect(() => {
    seedDemoUnits();
  }, [seedDemoUnits]);

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

  // Go back to lobby: clear stored scenario and reload
  const goToLobby = () => {
    localStorage.removeItem('currentScenarioId');
    window.location.reload(); // simple reload to reset state
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
      {/* Back button */}
      <button
        onClick={goToLobby}
        className="absolute top-4 left-4 z-10 bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded shadow-lg text-sm"
      >
        ← Back to Lobby
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
      </div>
    </div>
  );
}