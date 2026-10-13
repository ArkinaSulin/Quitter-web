'use client';
// src/components/EffectEditor/EffectModifierFields.tsx
// One effect-modifier row (kind / amount / heal / save) shared by the Effect
// Editor, the drop modal, and the instance edit modal. The single "amount"
// field accepts a plain number or dice "XdY±Z" (X=0 = flat Z); the flat part is
// mirrored into `delta` for stat kinds and legacy consumers.
import React from 'react';
import { EffectModifier, EffectModifierKind, isFlagModifierKind, honorsMode, modifierUsesSave, EFFECT_MODIFIER_LABELS, KIND_GROUPS } from '@/packages/effects';
import { EffectDirection } from '@/packages/effects';

/** Leading indent for an option inside its `<optgroup>` so the grouping reads. */
const OPT_INDENT = '\u00A0\u00A0\u00A0';

/** Flat kind options (keyword-first), derived from the grouped table in the package. */
export const KIND_OPTIONS: { value: EffectModifierKind; label: string }[] =
  KIND_GROUPS.flatMap(g => g.kinds.map(k => ({ value: k, label: EFFECT_MODIFIER_LABELS[k] })));

export const DEFAULT_INPUT_CLASS =
  'bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none disabled:opacity-50';

/** Apply a typed amount ("4" or "2d6+2") onto a modifier's canonical `dice`. */
export function patchAmount(mod: EffectModifier, raw: string): EffectModifier {
  const text = raw.trim();
  return { ...mod, dice: text || undefined };
}

interface EffectModifierFieldsProps {
  modifier: EffectModifier;
  onChange: (m: EffectModifier) => void;
  readOnly?: boolean;
  onRemove?: () => void;
  inputClass?: string;
  /** Kinds to omit from the dropdown (e.g. the Structure Editor hides `ignore_climb`). */
  excludeKinds?: EffectModifierKind[];
}

export function EffectModifierFields({ modifier: m, onChange, readOnly = false, onRemove, inputClass, excludeKinds }: EffectModifierFieldsProps) {
  const input = inputClass ?? DEFAULT_INPUT_CLASS;
  const patch = (p: Partial<EffectModifier>) => onChange({ ...m, ...p });
  const flag = isFlagModifierKind(m.kind);
  const kindGroups = KIND_GROUPS
    .map(g => ({ label: g.label, kinds: excludeKinds?.length ? g.kinds.filter(k => !excludeKinds.includes(k)) : g.kinds }))
    .filter(g => g.kinds.length > 0);

  return (
    <div className="rounded border border-gray-800 p-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select className={input + ' !w-56 min-w-0'} value={m.kind} disabled={readOnly} onChange={e => patch({ kind: e.target.value as EffectModifierKind })}>
          {kindGroups.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.kinds.map(k => <option key={k} value={k}>{OPT_INDENT}{EFFECT_MODIFIER_LABELS[k]}</option>)}
            </optgroup>
          ))}
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
        {m.kind === 'block_attacks' && (
          <select
            className={input + ' !w-24'}
            value={m.direction ?? 'both'}
            disabled={readOnly}
            onChange={e => patch({ direction: e.target.value === 'both' ? undefined : (e.target.value as EffectDirection) })}
            title="Block attacks coming IN (targeting the carrier/hex), going OUT (made from it), or both. On a wall, IN/OUT is outside->inside / inside->outside."
          >
            <option value="both">In + Out</option>
            <option value="in">In only</option>
            <option value="out">Out only</option>
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
            <label className="flex items-center gap-1 text-[11px] text-gray-300 whitespace-nowrap" title="Aura: apply to same-alliance allies within the radius instead of the carrier (hero must be Leading or Inspired).">
              <input type="checkbox" disabled={readOnly} checked={!!m.aura} onChange={e => patch({ aura: e.target.checked, radius: e.target.checked ? (m.radius ?? 1) : undefined })} />
              aura
            </label>
            {m.aura && (
              <label className="flex items-center gap-1 text-[11px] text-gray-300 whitespace-nowrap" title="Aura reach in hexes (0 = the carrier's own hex; 1 = the 7 surrounding hexes).">
                r
                <input
                  className={input + ' !w-16'}
                  type="number"
                  min={0}
                  value={m.radius ?? 1}
                  disabled={readOnly}
                  onChange={e => patch({ radius: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </label>
            )}
          </>
        )}
        {!readOnly && onRemove && (
          <button className="px-2 py-1 rounded text-xs bg-red-900/60 hover:bg-red-800 text-red-100" onClick={onRemove}>
            ✕
          </button>
        )}
      </div>
      {!flag && modifierUsesSave(m.kind) && (
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
