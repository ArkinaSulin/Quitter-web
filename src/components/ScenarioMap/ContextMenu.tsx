// src/components/ScenarioMap/ContextMenu.tsx
'use client';

import React, { useEffect, useRef } from 'react';
import { Unit } from '@/types/gameProtocol';
import { TEAM_COLORS } from '@/components/TokenRenderer/tokenUtils';

interface ContextMenuProps {
  unit: Unit;
  x: number;
  y: number;
  isGM: boolean;
  onClose: () => void;
  onRotate: (direction: 'left' | 'right') => void;
  onChangeFormation: (formation: string) => void;
  onSelectWeapon: (weaponIndex: number) => void;
  onAssignTeam: (team: string) => void;
  onToggleHide: () => void;
  onDeleteUnit: () => void;
}

export function ContextMenu({
  unit,
  x,
  y,
  isGM,
  onClose,
  onRotate,
  onChangeFormation,
  onSelectWeapon,
  onAssignTeam,
  onToggleHide,
  onDeleteUnit,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const weapons = unit.weaponString ? unit.weaponString.split(';').map(w => w.trim()) : [];
  const teamNames = Object.keys(TEAM_COLORS);

  const availableFormations = unit.formationAvailability || ['Loose', 'Tight', 'Phalanx', 'Shield Wall', 'Scattered'];

  const formationOptions = [
    { label: 'Line - Loose', value: 'Loose' },
    { label: 'Line - Tight', value: 'Tight' },
    { label: 'Line - Phalanx', value: 'Phalanx' },
    { label: 'Line - Shield Wall', value: 'Shield Wall' },
    { label: 'Scattered', value: 'Scattered' },
  ].filter(opt => availableFormations.includes(opt.value));

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-gray-900 border border-gray-700 rounded shadow-xl py-1 min-w-[180px] text-sm text-white"
      style={{ left: x, top: y }}
    >
      {/* Rotate */}
      <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer" onClick={() => { onRotate('left'); onClose(); }}>
        Rotate Left
      </div>
      <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer" onClick={() => { onRotate('right'); onClose(); }}>
        Rotate Right
      </div>
      <div className="border-t border-gray-700 my-1" />

      {/* Formations */}
      {formationOptions.map(opt => (
        <div key={opt.value} className="px-3 py-1 hover:bg-gray-700 cursor-pointer" onClick={() => { onChangeFormation(opt.value); onClose(); }}>
          {opt.label}
        </div>
      ))}
      {formationOptions.length === 0 && (
        <div className="px-3 py-1 text-gray-400 italic">No formations available</div>
      )}
      <div className="border-t border-gray-700 my-1" />

      {/* Weapons */}
      {weapons.length > 0 && weapons.map((w, idx) => (
        <div key={idx} className="px-3 py-1 hover:bg-gray-700 cursor-pointer" onClick={() => { onSelectWeapon(idx); onClose(); }}>
          {w}
        </div>
      ))}
      {weapons.length === 0 && (
        <div className="px-3 py-1 text-gray-400 italic">No weapons</div>
      )}
      <div className="border-t border-gray-700 my-1" />

      {/* Team assignment (GM only) */}
      {isGM && (
        <>
          <div className="px-3 py-1 text-gray-400 text-xs">Assign Team:</div>
          {teamNames.map(team => (
            <div key={team} className="px-3 py-1 hover:bg-gray-700 cursor-pointer capitalize" onClick={() => { onAssignTeam(team); onClose(); }}>
              {team}
            </div>
          ))}
          <div className="border-t border-gray-700 my-1" />
          <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer" onClick={() => { onToggleHide(); onClose(); }}>
            {unit.hidden ? 'Unhide' : 'Hide'}
          </div>
          <div
            className="px-3 py-1 hover:bg-red-700 cursor-pointer text-red-400"
            onClick={() => {
              // Single confirmation here
              if (confirm(`Delete unit "${unit.unitName}"?`)) {
                onDeleteUnit();
                onClose();
              }
            }}
          >
            Delete Unit
          </div>
        </>
      )}
    </div>
  );
}