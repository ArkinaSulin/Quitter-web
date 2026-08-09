// src/components/WeaponEditorModal.tsx
'use client';

// Shared single-weapon editor used by UnitEditor (template) and the scenario DM
// stat editor (UnitEditorModal). Owns all field state and the weapon-library
// search/pre-fill; calls onSave(weapon) with the completed Weapon.

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Weapon, SaveStat, SAVE_STATS } from '@/lib/weaponParser';

function isValidDamageDice(dice: string): boolean {
  const pattern = /^(\d+d\d+)([+-]\d+)?(\+\d+d\d+)*([+-]\d+)?$/;
  return pattern.test(dice.trim());
}

interface LibraryWeapon {
  id: string;
  name: string;
  damage_dice: string;
  attack_bonus?: number;
  magic_radius?: number;
  range?: number;
  max_range?: number;
  is_reach?: boolean;
  is_two_handed?: boolean;
  number_of_attacks?: number;
  no_retaliation?: boolean;
  free_action?: boolean;
  on_save_half_or_neg?: boolean;
  saving_throw?: SaveStat;
  is_healing?: boolean;
}

interface WeaponEditorModalProps {
  /** The weapon being edited, or null for a fresh Add. */
  initial: Weapon | null;
  title: string;
  onSave: (weapon: Weapon) => void;
  onClose: () => void;
}

export function WeaponEditorModal({ initial, title, onSave, onClose }: WeaponEditorModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [attackBonus, setAttackBonus] = useState(initial?.attackBonus ?? 0);
  const [damageDice, setDamageDice] = useState(initial?.damageDice ?? '1d6');
  const [isHealing, setIsHealing] = useState(initial?.isHealing ?? false);
  const [range, setRange] = useState(initial?.range ?? 1);
  const [maxRange, setMaxRange] = useState(initial?.maxRange ?? 0);
  const [magicRadius, setMagicRadius] = useState(initial?.magicRadius ?? 0);
  const [reach, setReach] = useState(initial?.reach ?? false);
  const [freeAction, setFreeAction] = useState(initial?.freeAction ?? false);
  const [noRetaliation, setNoRetaliation] = useState(initial?.noRetaliation ?? false);
  const [isTwoHanded, setIsTwoHanded] = useState(initial?.isTwoHanded ?? false);
  const [numberOfAttacks, setNumberOfAttacks] = useState(initial?.numberOfAttacks ?? 1);
  const [halfOnSave, setHalfOnSave] = useState(initial?.onSaveHalfOrNeg ?? true);
  const [savingThrow, setSavingThrow] = useState<SaveStat>(initial?.savingThrow ?? 'Dex');
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [library, setLibrary] = useState<LibraryWeapon[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('weapons')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setLibrary((data ?? []) as LibraryWeapon[]);
      });
    return () => { cancelled = true; };
  }, []);

  const handleRangeChange = (value: number) => {
    const next = Math.max(1, value);
    setRange(next);
    setNoRetaliation(noRetaliation || next > 1);
    setMaxRange(prev => Math.max(prev, next));
  };

  const selectFromLibrary = (weapon: LibraryWeapon) => {
    setName(weapon.name);
    setDamageDice(weapon.damage_dice);
    setAttackBonus(weapon.attack_bonus || 0);
    const nextRange = weapon.range || 1;
    setRange(nextRange);
    setMaxRange(weapon.max_range ?? 0);
    setNoRetaliation(weapon.no_retaliation ?? (nextRange > 1));
    setFreeAction(weapon.free_action || false);
    setMagicRadius(weapon.magic_radius || 0);
    setReach(weapon.is_reach || false);
    setIsTwoHanded(weapon.is_two_handed || false);
    setNumberOfAttacks(weapon.number_of_attacks || 1);
    setHalfOnSave(weapon.on_save_half_or_neg ?? true);
    setSavingThrow(SAVE_STATS.includes(weapon.saving_throw as SaveStat) ? (weapon.saving_throw as SaveStat) : 'Dex');
    setIsHealing(weapon.is_healing || false);
  };

  const handleSave = () => {
    if (!name.trim()) {
      setError('Weapon name is required');
      return;
    }
    if (!isValidDamageDice(damageDice)) {
      setError('Damage dice must be in format like "1d6", "2d6+2", or "1d4+2d6"');
      return;
    }
    if (range < 1) {
      setError('Range must be at least 1 (adjacent)');
      return;
    }
    onSave({
      name: name.trim(),
      attackBonus: attackBonus || 0,
      damageDice: damageDice.trim(),
      isHealing,
      range,
      maxRange: Math.max(maxRange || range, range),
      magicRadius,
      reach,
      freeAction,
      noRetaliation,
      isTwoHanded,
      numberOfAttacks: Math.max(1, numberOfAttacks || 1),
      onSaveHalfOrNeg: halfOnSave,
      savingThrow,
    });
  };

  const suggestions = searchTerm.trim()
    ? library.filter(w => w.name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 5)
    : [];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-[800px] max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col">
        <h2 className="text-xl font-bold mb-4 text-white">{title}</h2>
        <div className="flex flex-1 overflow-hidden gap-6">
          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Weapon Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                placeholder="e.g., Longsword"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Number of Attacks / round</label>
              <input
                type="number"
                value={numberOfAttacks}
                onChange={(e) => setNumberOfAttacks(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Attack Bonus</label>
              <input
                type="number"
                value={attackBonus}
                onChange={(e) => setAttackBonus(parseInt(e.target.value) || 0)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                Damage Dice
                <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={isHealing}
                    onChange={(e) => setIsHealing(e.target.checked)}
                    className="w-3.5 h-3.5 accent-emerald-400"
                  />
                  Healing (recovers HP instead of damaging)
                </span>
              </label>
              <input
                type="text"
                value={damageDice}
                onChange={(e) => setDamageDice(e.target.value)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                placeholder="e.g., 1d8, 2d6+2"
              />
              <p className="text-xs text-gray-400 mt-1">Examples: 1d6, 2d10, 2d6+2, 1d8-1, 1d4+2d6</p>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Range (hexes)</label>
              <input
                type="number"
                value={range}
                onChange={(e) => handleRangeChange(parseInt(e.target.value) || 1)}
                min={1}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
              />
              <p className="text-xs text-gray-400 mt-1">{range === 1 ? 'Adjacent (melee)' : `${range} hexes (ranged)`}</p>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Max Range (hexes)</label>
              <input
                type="number"
                value={maxRange}
                onChange={(e) => setMaxRange(Math.max(range, parseInt(e.target.value) || range))}
                min={range}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
              />
              <p className="text-xs text-gray-400 mt-1">Must be ≥ range; 0 = same as range. Attacks between range and max range are at disadvantage.</p>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Magic Radius (ft)</label>
              <input
                type="number"
                value={magicRadius}
                onChange={(e) => setMagicRadius(Math.max(0, parseInt(e.target.value) || 0))}
                min={0}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                placeholder="0 for single target"
              />
              <p className="text-xs text-gray-400 mt-1">{'> 0'} makes this an area-effect weapon (opens the spell-cast window).</p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={reach}
                  onChange={(e) => setReach(e.target.checked)}
                  className="w-4 h-4 accent-yellow-400"
                />
                Reach (e.g., pike, lance)
              </label>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={isTwoHanded}
                  onChange={(e) => setIsTwoHanded(e.target.checked)}
                  className="w-4 h-4 accent-red-400"
                />
                Two-Handed (occupies both hands — no shield, no Shield Wall)
              </label>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={freeAction}
                  onChange={(e) => setFreeAction(e.target.checked)}
                  className="w-4 h-4 accent-purple-400"
                />
                Free Action (costs no action to attack)
              </label>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={noRetaliation}
                  onChange={(e) => setNoRetaliation(e.target.checked)}
                  className="w-4 h-4 accent-blue-400"
                />
                No Retaliation (defender can't strike back)
              </label>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={halfOnSave}
                  onChange={(e) => setHalfOnSave(e.target.checked)}
                  className="w-4 h-4 accent-yellow-400"
                />
                {halfOnSave ? '1/2 damage' : 'Negate'} on successful save
              </label>
              <label className="flex items-center gap-2">
                Saving throw:
                <select
                  value={savingThrow}
                  onChange={(e) => setSavingThrow(e.target.value as SaveStat)}
                  className="px-2 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600"
                >
                  {SAVE_STATS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={handleSave}
              >
                {initial ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
          <div className="w-1/2 border-l border-gray-700 pl-4 flex flex-col">
            <label className="block text-sm text-gray-300 mb-2">Weapon Library</label>
            <input
              type="text"
              placeholder="Search weapons..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400 mb-2"
            />
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {suggestions
                .map((weapon) => (
                  <button
                    key={weapon.id}
                    onClick={() => selectFromLibrary(weapon)}
                    className="w-full text-left px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 transition text-sm flex items-center justify-between"
                  >
                    <span className="truncate">{weapon.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{weapon.damage_dice}</span>
                  </button>
                ))}
              {library.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">No weapons in library.</div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">Click a weapon to populate the form, then modify as needed.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
