// src/components/ScenarioMap/UnitTooltip.tsx
'use client';

import React from 'react';
import { Unit } from '@/types/gameProtocol';

interface UnitTooltipProps {
  unit: Unit;
  x: number;
  y: number;
}

export function UnitTooltip({ unit, x, y }: UnitTooltipProps) {
  return (
    <div
      className="absolute z-50 pointer-events-none bg-black/90 border border-gray-600 rounded shadow-xl p-3 text-xs text-white whitespace-nowrap"
      style={{ left: x + 12, top: y + 12 }}
    >
      <div className="font-bold">{unit.name}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
        <span>HP:</span><span>{unit.hp}/{unit.maxHp}</span>
        <span>AC:</span><span>{unit.currentAc}</span>
        <span>Formation:</span><span>{unit.formation}</span>
        <span>Team:</span><span className="capitalize">{unit.team}</span>
        <span>AGR:</span><span>{unit.aggressiveness}</span>
        <span>MOR:</span><span>{unit.currentMorale}</span>
        {unit.isHero && <span className="col-span-2 text-yellow-400">⭐ Hero</span>}
        {unit.isRouting && <span className="col-span-2 text-red-400">🏃 Routed!</span>}
      </div>
    </div>
  );
}