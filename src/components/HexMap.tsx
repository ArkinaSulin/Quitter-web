// src/components/HexMap.tsx
'use client';

import React, { useRef, useState, useCallback } from 'react';
import { useHexGrid } from '@/hooks/useHexGrid';
import { Hex, Unit } from '@/types/gameProtocol';

// Hardcoded demo units for MVP
const DEMO_UNITS: Unit[] = [
  {
    id: 'unit-1',
    name: 'Blue Knight',
    hex: { q: 0, r: 0, s: 0 },
    facing: 0,
    team: 'blue',
    hp: 10,
    maxHp: 10,
    isHero: true,
    formation: 'Tight',
  },
  {
    id: 'unit-2',
    name: 'Yellow Archer',
    hex: { q: 3, r: -2, s: -1 },
    facing: 3,
    team: 'yellow',
    hp: 6,
    maxHp: 6,
    isHero: false,
    formation: 'Loose',
  },
  {
    id: 'unit-3',
    name: 'Violet Mage',
    hex: { q: -2, r: 4, s: -2 },
    facing: 2,
    team: 'violet',
    hp: 8,
    maxHp: 8,
    isHero: true,
    formation: 'Scattered',
  },
];

export function HexMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedHex, setSelectedHex] = useState<Hex | null>(null);
  const [units, setUnits] = useState<Unit[]>(DEMO_UNITS);

  // Handle unit movement
  const handleUnitMove = useCallback((unitId: string, targetHex: Hex) => {
    setUnits((prevUnits) =>
      prevUnits.map((unit) =>
        unit.id === unitId
          ? { ...unit, hex: targetHex }
          : unit
      )
    );
    console.log(`[UI] Moved unit ${unitId} to (${targetHex.q}, ${targetHex.r})`);
  }, []);

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
    size: 50,
    gridRadius: 12,
    units: units,
    onUnitMove: handleUnitMove,
    onHexHover: (hex) => {
      // Optional: update UI with hex info
    },
    onHexClick: (hex, event) => {
      setSelectedHex(hex);
      console.log('Clicked hex:', hex);
    },
    onHexRightClick: (hex, event) => {
      console.log('Right-clicked hex:', hex);
    },
  });

  return (
    <div className="relative w-full h-screen bg-[#0d0d1a] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-default"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleRightClick}
        onWheel={handleWheel}
      />
      {/* Status overlay */}
      <div className="absolute bottom-4 left-4 bg-black/60 text-white px-4 py-2 rounded-lg text-sm font-mono space-y-1">
        <div>Hover: {hoveredHex ? `${hoveredHex.q}, ${hoveredHex.r}` : '—'}</div>
        <div>Selected: {selectedHex ? `${selectedHex.q}, ${selectedHex.r}` : '—'}</div>
        <div>Dragging: {draggingUnitId || '—'}</div>
      </div>
      {/* Unit count */}
      <div className="absolute top-4 right-4 bg-black/60 text-white px-4 py-2 rounded-lg text-sm">
        Units: {units.length}
      </div>
    </div>
  );
}