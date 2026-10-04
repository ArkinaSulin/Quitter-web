'use client';
// src/components/ScenarioMap/WeaponSelect.tsx
// Shared weapon picker for the flyer drop modal and the ground-attack picker.
// Lists every weapon; each that cannot attack the target from the attacker's
// current hex is DISABLED (greyed) so the player can see why without cancelling.
import { Unit } from '@/types/gameProtocol';
import { Weapon } from '@/lib/weaponParser';
import { canWeaponAttack } from '@/lib/meleeFallback';

export function WeaponSelect({ attacker, target, weapons, value, rangeBonus, onChange }: {
  attacker: Unit;
  target: Unit;
  weapons: Weapon[];
  value: number;
  /** Attacker `range` effect/zone bonus (applies to ranged weapons only). */
  rangeBonus: number;
  onChange: (index: number) => void;
}) {
  if (weapons.length === 0) return <p className="text-xs text-gray-400 italic">No weapons</p>;
  return (
    <div className="flex items-center gap-2 text-xs text-gray-300">
      <span className="whitespace-nowrap">Attack with</span>
      <select
        className="bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      >
        {weapons.map((w, i) => {
          const usable = canWeaponAttack(w, attacker, target, rangeBonus);
          return (
            <option key={i} value={i} disabled={!usable}>
              {w.name}{usable ? '' : ' — cannot reach'}
            </option>
          );
        })}
      </select>
    </div>
  );
}
