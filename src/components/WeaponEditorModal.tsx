// src/components/WeaponEditorModal.tsx
'use client';

// Shared single-weapon editor used by UnitEditor (template) and the scenario DM
// stat editor (UnitEditorModal). Owns all field state and the weapon-library
// search/pre-fill; calls onSave(weapon) with the completed Weapon.

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Weapon, SaveStat, SAVE_STATS, AreaShape, AREA_SHAPES } from '@/lib/weaponParser';

function isValidDamageDice(dice: string): boolean {
  const pattern = /^(\d+d\d+)([+-]\d+)?(\+\d+d\d+)*([+-]\d+)?$/;
  return pattern.test(dice.trim());
}

function Cell({ label, children, widthClass = 'flex-1' }: { label: string; children: React.ReactNode; widthClass?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-gray-400 min-w-0 ${widthClass}`}>
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min, max }: {
  value: any; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(parseInt(e.target.value) || 0)}
      className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-yellow-400"
    />
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-yellow-400">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-300">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-yellow-400" />
      {label}
    </label>
  );
}

function ToggleRow({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-gray-200 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 mt-0.5 accent-yellow-400" />
      <span>
        <span className="block">{label}</span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );
}

interface LibraryWeapon {
  id: string;
  name: string;
  damage_dice: string;
  attack_bonus?: number;
  magic_dimension?: number;
  shape?: AreaShape;
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
  const [magicDimension, setMagicDimension] = useState(initial?.magicDimension ?? 0);
  const [shape, setShape] = useState<AreaShape>(initial?.shape ?? 'circle');
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
  const [libraryError, setLibraryError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('weapons')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLibraryError(`Failed to load weapon library: ${error.message}`);
          return;
        }
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
    setMagicDimension(weapon.magic_dimension || 0);
    setShape(AREA_SHAPES.includes(weapon.shape as AreaShape) ? (weapon.shape as AreaShape) : 'circle');
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
      magicDimension,
      shape,
      reach,
      freeAction,
      noRetaliation,
      isTwoHanded,
      numberOfAttacks: Math.max(1, numberOfAttacks || 1),
      onSaveHalfOrNeg: halfOnSave,
      savingThrow,
    });
  };

  const suggestions = library.filter(w => w.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-[800px] max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col">
        <h2 className="text-xl font-bold mb-4 text-white">{title}</h2>
        <div className="flex flex-1 overflow-hidden gap-6">
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            <Cell label="Weapon Name" widthClass="w-full">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-yellow-400"
                placeholder="e.g., Longsword"
              />
            </Cell>

            <div className="flex items-end gap-3">
              <Cell label="Damage Dice">
                <input
                  type="text"
                  value={damageDice}
                  onChange={(e) => setDamageDice(e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-yellow-400"
                  placeholder="e.g., 1d8, 2d6+2"
                />
              </Cell>
              <div className="pb-1.5"><Toggle checked={isHealing} onChange={setIsHealing} label="Healing" /></div>
            </div>

            <div className="flex items-end gap-3">
              <Cell label="# Attacks"><NumInput value={numberOfAttacks} min={1} onChange={(v) => setNumberOfAttacks(Math.max(1, v || 1))} /></Cell>
              <Cell label="Atk bonus"><NumInput value={attackBonus} onChange={(v) => setAttackBonus(v)} /></Cell>
            </div>

            <div className="flex items-end gap-3">
              <Cell label="Range"><NumInput value={range} min={1} onChange={(v) => handleRangeChange(v || 1)} /></Cell>
              <Cell label="Max range"><NumInput value={maxRange} min={range} onChange={(v) => setMaxRange(Math.max(range, v || range))} /></Cell>
            </div>

            <div className="flex items-end gap-3">
              <Cell label="Magic Dimension (ft)"><NumInput value={magicDimension} min={0} onChange={(v) => setMagicDimension(Math.max(0, v))} /></Cell>
              <Cell label="Shape"><SelectInput value={shape} onChange={(v) => setShape(v as AreaShape)} options={AREA_SHAPES.map(s => ({ value: s, label: s }))} /></Cell>
            </div>

            <p className="text-xs text-gray-500 -mt-2">Shape: circle = dimension is radius · cube = side · cone = 60° wedge. Dimension &gt; 0 makes this an area-effect weapon.</p>

            <div className="flex items-end gap-3">
              <div className="pb-1.5"><Toggle checked={halfOnSave} onChange={setHalfOnSave} label={halfOnSave ? '1/2 damage' : 'Negate'} /></div>
              <Cell label="Saving throw"><SelectInput value={savingThrow} onChange={(v) => setSavingThrow(v as SaveStat)} options={SAVE_STATS.map(s => ({ value: s, label: s }))} /></Cell>
            </div>

            <div className="space-y-3 border-t border-gray-700 pt-3">
              <ToggleRow checked={reach} onChange={setReach} label="Reach" description="Strikes first against shorter weapons and cancels the opponent's retaliation." />
              <ToggleRow checked={isTwoHanded} onChange={setIsTwoHanded} label="Two-Handed" description="Requires both hands — shield defense is dropped while this is the active weapon." />
              <ToggleRow checked={freeAction} onChange={setFreeAction} label="Free Action" description="Does not cost an action to use." />
              <ToggleRow checked={noRetaliation} onChange={setNoRetaliation} label="No Retaliation" description="Provokes no retaliation and beats reach — fully safe attack." />
            </div>

            {error && <p className="text-red-400 text-xs">{error}</p>}
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
              {libraryError ? (
                <div className="text-sm text-red-400 text-center py-4">{libraryError}</div>
              ) : suggestions.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-4">No weapons in library.</div>
              ) : (
                suggestions.map((weapon) => (
                  <button
                    key={weapon.id}
                    onClick={() => selectFromLibrary(weapon)}
                    className="w-full text-left px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 transition text-sm flex items-center justify-between"
                  >
                    <span className="truncate">{weapon.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{weapon.damage_dice}</span>
                  </button>
                ))
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">Click a weapon to populate the form, then modify as needed.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
