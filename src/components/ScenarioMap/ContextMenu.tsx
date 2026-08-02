// src/components/ScenarioMap/ContextMenu.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Unit } from '@/types/gameProtocol';
import { areHexesAdjacent } from '@/lib/unitMorale';
import { parseWeapons } from '@/lib/weaponParser';
import { TEAM_COLORS } from '@/components/TokenRenderer/tokenUtils';

interface ContextMenuProps {
  unit: Unit;
  x: number;
  y: number;
  isGM: boolean;
  selectedWeapon?: number;
  onClose: () => void;
  onRotate: (direction: 'left' | 'right') => void;
  onChangeFormation: (formation: string) => void;
  onSelectWeapon: (weaponIndex: number) => void;
  onAssignTeam: (team: string) => void;
  onToggleHide: () => void;
  onDeleteUnit: () => void;
  onAttachHero?: (heroId: string, targetUnitId: string) => void;
  onDetachHero?: (heroId: string) => void;
  units: Unit[];
}

export function ContextMenu({
  unit,
  x,
  y,
  isGM,
  selectedWeapon = 0,
  onClose,
  onRotate,
  onChangeFormation,
  onSelectWeapon,
  onAssignTeam,
  onToggleHide,
  onDeleteUnit,
  onAttachHero,
  onDetachHero,
  units,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showAttachSubmenu, setShowAttachSubmenu] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const weapons = parseWeapons(unit.weaponString || '');
  const teamNames = Object.keys(TEAM_COLORS);

  const availableFormations = unit.formationAvailability || ['Open Order', 'Close Order', 'Phalanx', 'Shield Wall', 'Scattered'];

  const formationOptions = [
    { label: 'Line - Open Order', value: 'Open Order' },
    { label: 'Line - Close Order', value: 'Close Order' },
    { label: 'Line - Phalanx', value: 'Phalanx' },
    { label: 'Line - Shield Wall', value: 'Shield Wall' },
    { label: 'Scattered', value: 'Scattered' },
  ].filter(opt => availableFormations.includes(opt.value));

  const canAttach = unit.isHero && (unit.sizeCategory || 100) <= 200 && !unit.attachedToUnitId && !!onAttachHero;
  const isAttachedHero = unit.isHero && !!unit.attachedToUnitId;
  const attachedHeroName = isAttachedHero ? units.find(u => u.id === unit.attachedToUnitId)?.unitName || 'unit' : '';
  const parentUnit = isAttachedHero ? units.find(u => u.id === unit.attachedToUnitId) : null;

  const attachedHeroOnThisUnit = !unit.isHero ? units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted) : null;

  const attachableTargets = units.filter(u =>
    u.id !== unit.id && !u.isDeleted && !u.isHero &&
    u.team === unit.team &&
    !units.some(h => h.attachedToUnitId === u.id && !h.isDeleted) &&
    areHexesAdjacent(unit.hex, u.hex)
  );

  function handleAttachClick() {
    if (attachableTargets.length === 0) {
      alert('No adjacent valid target units to attach to (must be same team, adjacent, not a hero, no attached hero)');
      return;
    }
    setShowAttachSubmenu(!showAttachSubmenu);
  }

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-gray-900 border border-gray-700 rounded shadow-xl py-1 min-w-[180px] text-sm text-white"
      style={{ left: x, top: y }}
    >
      {!unit.isHero && !unit.attachedToUnitId && (
        <>
          <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer" onClick={() => { onRotate('left'); onClose(); }}>
            Rotate Left
          </div>
          <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer" onClick={() => { onRotate('right'); onClose(); }}>
            Rotate Right
          </div>
          <div className="border-t border-gray-700 my-1" />
        </>
      )}

      {!unit.isHero && !unit.attachedToUnitId && (
        <>
          {formationOptions.map(opt => (
            <div key={opt.value} className="px-3 py-1 hover:bg-gray-700 cursor-pointer" onClick={() => { onChangeFormation(opt.value); onClose(); }}>
              {opt.label}
            </div>
          ))}
          {formationOptions.length === 0 && (
            <div className="px-3 py-1 text-gray-400 italic">No formations available</div>
          )}
          <div className="border-t border-gray-700 my-1" />
        </>
      )}

      {canAttach && (
        <>
          <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer flex justify-between items-center" onClick={handleAttachClick}>
            <span>Attach to Unit...</span>
            <span className="text-gray-500 text-xs">{attachableTargets.length}</span>
          </div>
          {showAttachSubmenu && attachableTargets.map(target => (
            <div
              key={target.id}
              className="px-6 py-1 hover:bg-gray-700 cursor-pointer text-gray-300"
              onClick={() => { onAttachHero!(unit.id, target.id); onClose(); }}
            >
              {target.unitName}
            </div>
          ))}
          <div className="border-t border-gray-700 my-1" />
        </>
      )}

      {isAttachedHero && onDetachHero && (
        <>
          <div className="px-3 py-1 text-gray-400 text-xs">Attached to {attachedHeroName}</div>
          <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer text-yellow-400" onClick={() => { onDetachHero(unit.id); onClose(); }}>
            Detach from {attachedHeroName}
          </div>
          <div className="border-t border-gray-700 my-1" />
        </>
      )}

      {attachedHeroOnThisUnit && onDetachHero && (
        <>
          <div className="px-3 py-1 text-gray-400 text-xs">Has attached hero</div>
          <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer text-yellow-400" onClick={() => { onDetachHero(attachedHeroOnThisUnit.id); onClose(); }}>
            Detach {attachedHeroOnThisUnit.unitName}
          </div>
          <div className="border-t border-gray-700 my-1" />
        </>
      )}

      {/* Weapons */}
      {weapons.length > 0 && (
        <div className="px-3 py-1 text-gray-400 text-xs">Select Weapon (active: {weapons[selectedWeapon]?.name ?? '—'}):</div>
      )}
      {weapons.map((w, idx) => (
        <div key={idx} className="px-3 py-1 hover:bg-gray-700 cursor-pointer flex items-center gap-2" onClick={() => { onSelectWeapon(idx); onClose(); }}>
          <span className="w-3 text-emerald-400">{idx === selectedWeapon ? '✓' : ''}</span>
          <span className="flex-1">{w.name}</span>
          {w.freeAction && <span className="text-xs px-1 rounded bg-purple-900 text-purple-300" title="Free action">F</span>}
          {w.noRetaliation && <span className="text-xs px-1 rounded bg-blue-900 text-blue-300" title="No retaliation">NR</span>}
          {w.ignoreAttackMultiplier && <span className="text-xs px-1 rounded bg-teal-900 text-teal-300" title="Ignores attack multiplier">IM</span>}
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