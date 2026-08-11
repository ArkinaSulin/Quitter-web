// src/components/ScenarioMap/UnitTemplateTooltip.tsx
'use client';

import React from 'react';
import { UnitTemplate } from '@/types/gameProtocol';
import { parseWeapons } from '@/lib/weaponParser';

interface UnitTemplateTooltipProps {
  template: UnitTemplate;
  x: number;
  y: number;
}

const SIZE_LABELS: Record<number, string> = {
  75: 'Small',
  100: 'Medium',
  200: 'Large',
  300: 'Huge',
  400: 'Gargantuan',
};

const SAVE_STATS: { key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; label: string }[] = [
  { key: 'str', label: 'Str' },
  { key: 'dex', label: 'Dex' },
  { key: 'con', label: 'Con' },
  { key: 'int', label: 'Int' },
  { key: 'wis', label: 'Wis' },
  { key: 'cha', label: 'Cha' },
];

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function UnitTemplateTooltip({ template, x, y }: UnitTemplateTooltipProps) {
  const weapons = parseWeapons(template.weaponString || '');
  const sizeLabel = SIZE_LABELS[template.sizeCategory] || 'Medium';

  return (
    <div
      className="fixed z-50 pointer-events-none bg-black/90 border border-gray-600 rounded shadow-xl p-3 text-xs text-white whitespace-nowrap"
      style={{ left: x + 12, top: y + 12 }}
    >
      <div className="font-bold mb-1">
        {template.raceName && <span className="capitalize text-gray-400">{template.raceName}</span>}{' '}
        {template.unitName}
        {template.isHero && <span className="text-yellow-400 ml-1">⭐ Hero</span>}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <span className="text-gray-400">Level:</span><span>{template.level}</span>
        <span className="text-gray-400">Size:</span><span>{sizeLabel}</span>
        <span className="text-gray-400">Movement:</span><span>{template.movementPoints}</span>
        <span className="text-gray-400">AC:</span><span>{template.baselineAc}</span>
        <span className="text-gray-400">Troops:</span><span>{template.troopCount}</span>
        <span className="text-gray-400">Troop HP:</span><span>{template.troopHp}</span>
        <span className="text-gray-400">Max unit HP:</span><span>{template.maxUnitHp}</span>
        <span className="text-gray-400">AGR:</span><span>{template.aggressiveness}</span>
        <span className="text-gray-400">MOR:</span><span className={template.ignoreMoraleChecks ? 'text-yellow-400' : ''}>{template.ignoreMoraleChecks ? 'fearless' : template.baseMorale}</span>
        <span className="text-gray-400">Can Charge:</span><span>{template.canCharge ? 'Yes' : 'No'}</span>
        <span className="text-gray-400">Mount:</span><span>{template.mountName || 'None'}</span>
        <span className="text-gray-400">Equip:</span><span>{template.equipCostGp}gp</span>
        <span className="text-gray-400">Weekly:</span><span>{template.weeklyCostGp}gp</span>
      </div>

      {weapons.length > 0 && (
        <>
          <div className="border-t border-gray-600 my-1.5" />
          <div>
            <span className="text-gray-400">Weapons:</span>
            <div className="ml-2 text-gray-300">
              {weapons.map((w, i) => (
                <div key={i}>
                  {w.name}{w.isTwoHanded && <span className="text-red-400 ml-1" title="Two-handed (no shield, no Shield Wall)">[2H]</span>} (+{w.attackBonus} atk, {w.damageDice}{w.isHealing ? '(h)' : ''}{w.numberOfAttacks > 1 ? `, ${w.numberOfAttacks} att` : ''}{w.magicDimension > 0 ? `, ${w.magicDimension}ft ${w.shape}` : ''})
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="border-t border-gray-600 my-1.5" />

      <div>
        <span className="text-gray-400">Formations:</span>
        <span className="ml-2 text-gray-300">
          {(template.formationAvailability || []).join(', ')}
        </span>
      </div>

      <div className="border-t border-gray-600 my-1.5" />

      <div className="flex items-center gap-1.5">
        <span className="text-gray-400">Saves:</span>
        {SAVE_STATS.map(s => (
          <span key={s.key} className={template[s.key] !== 0 ? 'text-gray-300' : 'text-gray-500'}>
            {s.label} {signed(template[s.key] ?? 0)}
          </span>
        ))}
      </div>
    </div>
  );
}
