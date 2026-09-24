'use client';
// src/components/EffectEditor/EffectModifierFields.tsx
// One effect-modifier row (kind / amount / heal / save) shared by the Effect
// Editor, the drop modal, and the instance edit modal. The single "amount"
// field accepts a plain number or dice "XdY±Z" (X=0 = flat Z); the flat part is
// mirrored into `delta` for stat kinds and legacy consumers.
import React from 'react';
import { EffectModifier, EffectModifierKind, parseDice, isFlagModifierKind, honorsMode, EFFECT_MODIFIER_LABELS } from '@/lib/effectTemplates';

export const KIND_OPTIONS: { value: EffectModifierKind; label: string }[] = [
  { value: 'ac', label: 'AC ±' },
  { value: 'morale', label: 'Morale ±' },
  { value: 'movement', label: 'Movement ±' },
  { value: 'dot', label: 'DoT / heal per tick' },
  { value: 'hp_borrow', label: 'Borrow HP (sleep)' },
  { value: 'entry', label: 'Zone: damage on entry' },
  { value: 'mp_cost', label: 'Zone: hex MP cost' },
  { value: 'enter_org_max', label: EFFECT_MODIFIER_LABELS.enter_org_max },
  { value: 'range', label: EFFECT_MODIFIER_LABELS.range },
  { value: 'advantage', label: EFFECT_MODIFIER_LABELS.advantage },
  { value: 'disadvantage', label: EFFECT_MODIFIER_LABELS.disadvantage },
  { value: 'grant_advantage', label: EFFECT_MODIFIER_LABELS.grant_advantage },
  { value: 'grant_disadvantage', label: EFFECT_MODIFIER_LABELS.grant_disadvantage },
];

export const DEFAULT_INPUT_CLASS =
  'bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none disabled:opacity-50';

/** Apply a typed amount ("4" or "2d6+2") onto a modifier. */
export function patchAmount(mod: EffectModifier, raw: string): EffectModifier {
  const text = raw.trim();
  const parsed = parseDice(text);
  return { ...mod, dice: text || undefined, delta: parsed ? parsed.bonus : 0 };
}

interface EffectModifierFieldsProps {
  modifier: EffectModifier;
  onChange: (m: EffectModifier) => void;
  readOnly?: boolean;
  onRemove?: () => void;
  inputClass?: string;
}

export function EffectModifierFields({ modifier: m, onChange, readOnly = false, onRemove, inputClass }: EffectModifierFieldsProps) {
  const input = inputClass ?? DEFAULT_INPUT_CLASS;
  const patch = (p: Partial<EffectModifier>) => onChange({ ...m, ...p });
  const flag = isFlagModifierKind(m.kind);

  return (
    <div className="rounded border border-gray-800 p-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select className={input + ' !w-40 min-w-0'} value={m.kind} disabled={readOnly} onChange={e => patch({ kind: e.target.value as EffectModifierKind })}>
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {honorsMode(m.kind) && (
          <select
            className={input + ' !w-24'}
            value={m.mode ?? 'both'}
            disabled={readOnly}
            onChange={e => patch({ mode: e.target.value === 'both' ? undefined : (e.target.value as 'melee' | 'ranged') })}
            title="Which attack distance this modifier applies to (both = melee and ranged)."
          >
            <option value="both">Both</option>
            <option value="melee">Melee</option>
            <option value="ranged">Ranged</option>
          </select>
        )}
        {flag ? (
          <span className="flex-1 min-w-[6rem] text-[11px] text-gray-400 italic">
            Flag effect — no amount or save
          </span>
        ) : (
          <>
            <input
              className={input + ' !w-32 flex-1 min-w-[6rem]'}
              type="text"
              value={m.dice ?? ''}
              disabled={readOnly}
              onChange={e => onChange(patchAmount(m, e.target.value))}
              placeholder="amount / 2d6+2"
              title="Amount: a plain number (flat) or dice XdY±Z (X=0 = flat Z). Used for both stats and damage."
            />
            <label className="flex items-center gap-1 text-[11px] text-gray-300 whitespace-nowrap">
              <input type="checkbox" disabled={readOnly} checked={!!m.healing} onChange={e => patch({ healing: e.target.checked })} />
              heal
            </label>
          </>
        )}
        {!readOnly && onRemove && (
          <button className="px-2 py-1 rounded text-xs bg-red-900/60 hover:bg-red-800 text-red-100" onClick={onRemove}>
            ✕
          </button>
        )}
      </div>
      {!flag && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
          <span>Save:</span>
          <select
            className={input + ' !w-24'}
            value={m.savingThrow ?? ''}
            disabled={readOnly}
            onChange={e => patch({ savingThrow: (e.target.value || null) as EffectModifier['savingThrow'] })}
          >
            <option value="">none</option>
            {['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span>DC</span>
          <input
            className={input + ' !w-20'}
            type="number"
            value={m.saveDC ?? ''}
            disabled={readOnly || !m.savingThrow}
            onChange={e => patch({ saveDC: e.target.value === '' ? null : Number(e.target.value) })}
            title="d20 + save bonus ≥ DC passes. Very high DC = auto-fail (full damage)."
          />
          <label className="flex items-center gap-1 whitespace-nowrap" title="Passing the save halves damage; unchecked = negates (0).">
            <input type="checkbox" disabled={readOnly || !m.savingThrow} checked={m.onSaveHalfOrNeg !== false} onChange={e => patch({ onSaveHalfOrNeg: e.target.checked })} />
            half on save
          </label>
        </div>
      )}
    </div>
  );
}
