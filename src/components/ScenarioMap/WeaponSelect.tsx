'use client';
// src/components/ScenarioMap/WeaponSelect.tsx
// Shared weapon picker for the flyer drop modal, the ground-attack picker and
// the archer-reaction picker. Lists every weapon; each that cannot attack the
// target from the attacker's current hex is DISABLED (greyed) so the player can
// see why without cancelling. Below it, a Damage field shows the selected
// weapon's `[x]d[y]+[z]` with up/down arrows that change ONLY the leading die
// count `[x]` (upcast — e.g. a caster using a higher slot).
import { Unit } from '@/types/gameProtocol';
import { Weapon, withDamageDiceCount } from '@/lib/weaponParser';
import { canWeaponAttack } from '@/lib/meleeFallback';

export function WeaponSelect({ attacker, target, weapons, value, rangeBonus, onChange, diceCount, onDiceCountChange }: {
  attacker: Unit;
  target: Unit;
  weapons: Weapon[];
  value: number;
  /** Attacker `range` effect/zone bonus (applies to ranged weapons only). */
  rangeBonus: number;
  onChange: (index: number) => void;
  /** Leading damage-die count `[x]` for the selected weapon (upcast). */
  diceCount: number;
  onDiceCountChange: (count: number) => void;
}) {
  if (weapons.length === 0) return <p className="text-xs text-gray-400 italic">No weapons</p>;
  const selected = weapons[value];
  const damage = selected ? withDamageDiceCount(selected.damageDice, diceCount) : '';
  return (
    <div className="flex flex-col gap-1 text-xs text-gray-300">
      <div className="flex items-center gap-2">
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
      {selected && (
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap">Damage</span>
          <input
            type="text"
            readOnly
            value={damage}
            className="bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 outline-none w-28 text-center tabular-nums"
          />
          <div className="flex flex-col leading-none">
            <button
              type="button"
              aria-label="Increase damage dice"
              className="px-1.5 py-0.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-t"
              onClick={() => onDiceCountChange(diceCount + 1)}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Decrease damage dice"
              disabled={diceCount <= 1}
              className={`px-1.5 py-0.5 rounded-b ${diceCount <= 1 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:text-white hover:bg-gray-700'}`}
              onClick={() => onDiceCountChange(Math.max(1, diceCount - 1))}
            >
              ▼
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
