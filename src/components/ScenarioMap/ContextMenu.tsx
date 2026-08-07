// src/components/ScenarioMap/ContextMenu.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Unit, getOrganizationLevel, Formation } from '@/types/gameProtocol';
import { areHexesAdjacent } from '@/lib/unitMorale';
import { parseWeapons } from '@/lib/weaponParser';
import { canFormationCharge } from '@/lib/formationRules';
import { TEAM_COLORS } from '@/components/TokenRenderer/tokenUtils';

interface ContextMenuProps {
  unit: Unit;
  x: number;
  y: number;
  isGM: boolean;
  selectedWeapon?: number;
  formationsMap?: Record<string, Formation>;
  onClose: () => void;
  onRotate: (direction: 'left' | 'right') => void;
  onChangeFormation: (formation: string) => void;
  onSelectWeapon: (weaponIndex: number) => void;
  onAssignTeam: (team: string) => void;
  onToggleHide: () => void;
  onDeleteUnit: () => void;
  onCharge?: () => void;
  onAttachHero?: (heroId: string, targetUnitId: string) => void;
  /** Hero attached to `unit` (when the menu is showing the host) → "Switch to Hero". */
  attachedHero?: Unit;
  /** Host `unit` is attached to (when the menu is showing the hero) → "Switch to Unit". */
  hostUnit?: Unit;
  onSwitchToHero?: (hero: Unit) => void;
  onSwitchToUnit?: (host: Unit) => void;
  units: Unit[];
}

export function ContextMenu({
  unit,
  x,
  y,
  isGM,
  selectedWeapon = 0,
  formationsMap,
  onClose,
  onRotate,
  onChangeFormation,
  onSelectWeapon,
  onAssignTeam,
  onToggleHide,
  onDeleteUnit,
  onCharge,
  onAttachHero,
  attachedHero,
  hostUnit,
  onSwitchToHero,
  onSwitchToUnit,
  units,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showAttachSubmenu, setShowAttachSubmenu] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture phase so this fires before any other handler (drag, canvas, panel)
    // could stop propagation; pointerdown covers mouse, touch, and pen.
    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const weapons = parseWeapons(unit.weaponString || '');
  const teamNames = Object.keys(TEAM_COLORS);

  const availableFormations = unit.formationAvailability || ['Open Order', 'Close Order', 'Phalanx', 'Shield Wall', 'Scattered'];

  // Order formations by organization level, higher on top. Disable any formation
  // more than +1 org level above the current one (recomputed on every render).
  const currentOrgLevel = getOrganizationLevel(unit.currentFormation);
  const activeWeaponIsTwoHanded = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0]?.isTwoHanded || false;
  const formationOptions = [
    { value: 'Open Order' },
    { value: 'Close Order' },
    { value: 'Phalanx' },
    { value: 'Shield Wall' },
    { value: 'Scattered' },
  ]
    .filter(opt => availableFormations.includes(opt.value))
    .sort((a, b) => getOrganizationLevel(b.value) - getOrganizationLevel(a.value))
    .map(opt => ({
      value: opt.value,
      disabled: getOrganizationLevel(opt.value) > currentOrgLevel + 1 || (opt.value === 'Shield Wall' && activeWeaponIsTwoHanded),
    }));

  const canAttach = unit.isHero && (unit.sizeCategory || 100) <= 200 && !unit.attachedToUnitId && !!onAttachHero;

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
      {/* Switch between a host unit and its attached hero (attached heroes act as
          independent combatants; drag them away to separate). */}
      {attachedHero && onSwitchToHero && (
        <div
          className="px-3 py-1 hover:bg-amber-900 cursor-pointer text-amber-300 font-semibold"
          onClick={() => onSwitchToHero(attachedHero)}
        >
          Switch to Hero: {attachedHero.unitName}
        </div>
      )}
      {hostUnit && onSwitchToUnit && (
        <div
          className="px-3 py-1 hover:bg-amber-900 cursor-pointer text-amber-300 font-semibold"
          onClick={() => onSwitchToUnit(hostUnit)}
        >
          Switch to Unit: {hostUnit.unitName}
        </div>
      )}
      {(attachedHero || hostUnit) && <div className="border-t border-gray-700 my-1" />}

      {!unit.isHero && !unit.attachedToUnitId && (
        <>
          <div
            className={`px-3 py-1 ${unit.isCharging ? 'text-gray-600 cursor-not-allowed' : 'hover:bg-gray-700 cursor-pointer'}`}
            onClick={() => { if (unit.isCharging) return; onRotate('left'); onClose(); }}
          >
            Rotate Left
          </div>
          <div
            className={`px-3 py-1 ${unit.isCharging ? 'text-gray-600 cursor-not-allowed' : 'hover:bg-gray-700 cursor-pointer'}`}
            onClick={() => { if (unit.isCharging) return; onRotate('right'); onClose(); }}
          >
            Rotate Right
          </div>
          {unit.canCharge && !unit.isRouting && canFormationCharge(formationsMap?.[unit.currentFormation]) && !unit.isCharging && unit.actionsAvailable >= 1 && onCharge && (
            <div
              className="px-3 py-1 hover:bg-amber-900 cursor-pointer text-amber-300 font-semibold"
              onClick={() => { onCharge(); onClose(); }}
            >
              Charge!
            </div>
          )}
          <div className="border-t border-gray-700 my-1" />
        </>
      )}

      {!unit.isHero && !unit.attachedToUnitId && (
        <>
          {unit.isCharging && (
            <div className="px-3 py-1 text-gray-500 italic text-xs">Formation locked while charging</div>
          )}
          {formationOptions.map(opt => (
            <div
              key={opt.value}
              className={`px-3 py-1 ${opt.disabled || unit.isCharging ? 'text-gray-600 cursor-not-allowed' : 'hover:bg-gray-700 cursor-pointer'}`}
              onClick={() => { if (opt.disabled || unit.isCharging) return; onChangeFormation(opt.value); onClose(); }}
            >
              {opt.value}
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

      {/* Weapons */}
      {weapons.length > 0 && (
        <div className="px-3 py-1 text-gray-400 text-xs">Select Weapon (active: {weapons[selectedWeapon]?.name ?? '—'}):</div>
      )}
      {weapons.map((w, idx) => (
        <div key={idx} className="px-3 py-1 hover:bg-gray-700 cursor-pointer flex items-center gap-2" onClick={() => { onSelectWeapon(idx); onClose(); }}>
          <span className="w-3 text-emerald-400">{idx === selectedWeapon ? '✓' : ''}</span>
          <span className="flex-1">{w.name}</span>
          {w.numberOfAttacks > 1 && <span className="text-xs px-1 rounded bg-gray-800 text-gray-300" title="Attacks per round">{w.numberOfAttacks}×</span>}
          {w.isTwoHanded && <span className="text-xs px-1 rounded bg-red-900 text-red-300" title="Two-handed (no shield, no Shield Wall)">2H</span>}
          {w.freeAction && <span className="text-xs px-1 rounded bg-purple-900 text-purple-300" title="Free action">F</span>}
          {w.noRetaliation && <span className="text-xs px-1 rounded bg-blue-900 text-blue-300" title="No retaliation">NR</span>}
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