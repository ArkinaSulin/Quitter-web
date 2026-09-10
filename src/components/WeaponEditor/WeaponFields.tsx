'use client';
// src/components/WeaponEditor/WeaponFields.tsx
// The shared weapon form body — used by the Weapon Editor page (mid panel) and
// the Add/Edit Weapon modal, so both always look and behave identically.
import React from 'react';
import { Weapon, SaveStat, SAVE_STATS, AreaShape, AREA_SHAPES } from '@/lib/weaponParser';

export const WEAPON_INPUT =
  'w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-yellow-400 outline-none disabled:opacity-50';

export function Cell({ label, children, widthClass = 'flex-1' }: { label: string; children: React.ReactNode; widthClass?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-gray-400 min-w-0 ${widthClass}`}>
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

export function NumInput({ value, onChange, min, max }: { value: any; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(parseInt(e.target.value) || 0)}
      className={WEAPON_INPUT}
    />
  );
}

export function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={WEAPON_INPUT}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-300">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-yellow-400" />
      {label}
    </label>
  );
}

export function ToggleRow({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string }) {
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

export interface WeaponMeta {
  notes: string;
  costGp: number;
}

interface WeaponFieldsProps {
  value: Weapon;
  onChange: (w: Weapon) => void;
  /** Library metadata (Weapon Editor only). */
  meta?: WeaponMeta;
  onMetaChange?: (m: WeaponMeta) => void;
  error?: string;
}

export function WeaponFields({ value, onChange, meta, onMetaChange, error }: WeaponFieldsProps) {
  const patch = (p: Partial<Weapon>) => onChange({ ...value, ...p });

  const handleRangeChange = (raw: number) => {
    const next = Math.max(1, raw || 1);
    patch({
      range: next,
      noRetaliation: value.noRetaliation || next > 1,
      maxRange: Math.max(value.maxRange || next, next),
    });
  };

  return (
    <div className="space-y-4">
      <Cell label="Weapon Name" widthClass="w-full">
        <input
          type="text"
          value={value.name}
          onChange={e => patch({ name: e.target.value })}
          className={WEAPON_INPUT}
          placeholder="e.g., Longsword"
        />
      </Cell>

      <div className="flex items-end gap-3">
        <Cell label="Damage Dice">
          <input
            type="text"
            value={value.damageDice}
            onChange={e => patch({ damageDice: e.target.value })}
            className={WEAPON_INPUT}
            placeholder="e.g., 1d8, 2d6+2"
          />
        </Cell>
        <div className="pb-1.5"><Toggle checked={value.isHealing} onChange={v => patch({ isHealing: v })} label="Healing" /></div>
      </div>

      <div className="flex items-end gap-3">
        <Cell label="# Attacks"><NumInput value={value.numberOfAttacks} min={1} onChange={v => patch({ numberOfAttacks: Math.max(1, v || 1) })} /></Cell>
        <Cell label="Atk bonus"><NumInput value={value.attackBonus} onChange={v => patch({ attackBonus: v })} /></Cell>
      </div>

      <div className="flex items-end gap-3">
        <Cell label="Range"><NumInput value={value.range} min={1} onChange={handleRangeChange} /></Cell>
        <Cell label="Max range"><NumInput value={value.maxRange} min={value.range} onChange={v => patch({ maxRange: Math.max(value.range, v || value.range) })} /></Cell>
      </div>

      <div className="border-t border-gray-700" />

      <div className="flex items-end gap-3">
        <Cell label="Magic Dimension (ft)"><NumInput value={value.magicDimension} min={0} onChange={v => patch({ magicDimension: Math.max(0, v) })} /></Cell>
        <Cell label="Shape"><SelectInput value={value.shape} onChange={v => patch({ shape: v as AreaShape })} options={AREA_SHAPES.map(s => ({ value: s, label: s }))} /></Cell>
      </div>

      <p className="text-xs text-gray-500 -mt-2">Shape: circle = dimension is radius · cube = side · cone = 60° wedge. Dimension &gt; 0 makes this an area-effect weapon.</p>

      <div className="flex items-end gap-3">
        <div className="pb-1.5"><Toggle checked={value.onSaveHalfOrNeg} onChange={v => patch({ onSaveHalfOrNeg: v })} label={value.onSaveHalfOrNeg ? '1/2 damage' : 'Negate'} /></div>
        <Cell label="Saving throw"><SelectInput value={value.savingThrow} onChange={v => patch({ savingThrow: v as SaveStat })} options={SAVE_STATS.map(s => ({ value: s, label: s }))} /></Cell>
      </div>

      <div className="space-y-3 border-t border-gray-700 pt-3">
        <ToggleRow checked={value.reach} onChange={v => patch({ reach: v })} label="Reach" description="Strikes first against shorter weapons and cancels the opponent's retaliation." />
        <ToggleRow checked={value.isTwoHanded} onChange={v => patch({ isTwoHanded: v })} label="Two-Handed" description="Requires both hands — shield defense is dropped while this is the active weapon." />
        <ToggleRow checked={value.freeAction} onChange={v => patch({ freeAction: v })} label="Free Action" description="Does not cost an action to use." />
        <ToggleRow checked={value.noRetaliation} onChange={v => patch({ noRetaliation: v })} label="No Retaliation" description="Provokes no retaliation and beats reach — fully safe attack." />
      </div>

      {meta && onMetaChange && (
        <div className="space-y-3 border-t border-gray-700 pt-3">
          <div className="flex items-end gap-3">
            <Cell label="Cost (gp)"><NumInput value={meta.costGp} min={0} onChange={v => onMetaChange({ ...meta, costGp: Math.max(0, v) })} /></Cell>
            <Cell label="Notes" widthClass="flex-[2]">
              <input type="text" value={meta.notes} onChange={e => onMetaChange({ ...meta, notes: e.target.value })} className={WEAPON_INPUT} placeholder="optional" />
            </Cell>
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
