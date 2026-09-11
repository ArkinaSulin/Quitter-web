'use client';
// src/components/ScenarioMap/EffectFormModal.tsx
// Shared pre-apply / edit form for an effect. Shows and lets the user edit all
// current settings (name, colour, image + layer, duration, tempo, and every
// modifier) before applying. No description and no zone radius here.
import React, { useState } from 'react';
import { ImagePickerModal } from '@/components/ImagePickerModal';
import { ColorField } from '@/components/ColorField';
import { EffectModifierFields, DEFAULT_INPUT_CLASS } from '@/components/EffectEditor/EffectModifierFields';
import { EffectModifier, EffectLayer } from '@/lib/effectTemplates';

export interface EffectFormValue {
  name: string;
  color: string;
  imageUrl: string;
  /** Image size multiplier in percent (100 = default). */
  imageScale: number;
  /** Skip the zone hex tint so only the artwork/marker show. */
  transparentBackground: boolean;
  layer: EffectLayer;
  duration: number;
  /** '' = every alliance activation (tempo-free); otherwise a team name. */
  casterTeam: string;
  modifiers: EffectModifier[];
}

interface EffectFormModalProps {
  title: string;
  value: EffectFormValue;
  onChange: (v: EffectFormValue) => void;
  teamOptions: string[];
  confirmLabel?: string;
  /** Instance edit = false (exactly one modifier, no add/remove). */
  allowMultipleModifiers?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const input = DEFAULT_INPUT_CLASS;

export function EffectFormModal({
  title,
  value,
  onChange,
  teamOptions,
  confirmLabel = 'Apply',
  allowMultipleModifiers = true,
  onConfirm,
  onCancel,
}: EffectFormModalProps) {
  const [showImagePicker, setShowImagePicker] = useState(false);
  const patch = (p: Partial<EffectFormValue>) => onChange({ ...value, ...p });
  const setMod = (i: number, next: EffectModifier) => patch({ modifiers: value.modifiers.map((m, idx) => (idx === i ? next : m)) });

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onCancel}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-[480px] max-h-[85vh] overflow-y-auto" onMouseDown={e => e.stopPropagation()}>
        <p className="text-white font-semibold mb-3">{title}</p>

        <div className="space-y-3">
          <label className="block text-xs text-gray-400">Name
            <input className={input + ' w-full'} value={value.name} onChange={e => patch({ name: e.target.value })} />
          </label>

          <div>
            <p className="text-xs text-gray-400 mb-1">Color</p>
            <ColorField value={value.color} onChange={color => patch({ color })} />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2">
              {value.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={value.imageUrl} alt="" className="w-12 h-12 rounded border border-gray-700 object-contain bg-gray-800" />
              ) : (
                <span className="w-12 h-12 rounded border border-dashed border-gray-600 grid place-items-center text-[10px] text-gray-500">none</span>
              )}
              <button type="button" className="px-3 py-1.5 rounded text-xs bg-gray-700 hover:bg-gray-600" onClick={() => setShowImagePicker(true)}>
                {value.imageUrl ? 'Change image' : 'Select image'}
              </button>
              {value.imageUrl && (
                <button type="button" className="px-2 py-1.5 rounded text-xs bg-red-900/60 hover:bg-red-800" onClick={() => patch({ imageUrl: '' })}>
                  Clear
                </button>
              )}
            </div>
            <label className="text-xs text-gray-400">Layer
              <select className={input + ' !w-36'} value={value.layer} onChange={e => patch({ layer: e.target.value as EffectLayer })}>
                <option value="below">Below unit</option>
                <option value="above">Above unit</option>
              </select>
            </label>
          </div>

          <label className="block text-xs text-gray-400">Image size — {value.imageScale}%
            <input
              type="range" min={10} max={300} step={5}
              value={value.imageScale}
              onChange={e => patch({ imageScale: Math.max(10, Math.min(300, parseInt(e.target.value) || 100)) })}
              className="w-full accent-amber-400"
            />
          </label>

          <label className="flex items-center gap-2 text-[11px] text-gray-400">
            <input
              type="checkbox"
              checked={value.transparentBackground}
              onChange={e => patch({ transparentBackground: e.target.checked })}
              className="h-3.5 w-3.5 accent-amber-400"
            />
            Transparent background (no zone hex tint)
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-400">Duration (caster activations)
              <input
                type="number" min={1} max={50} value={value.duration}
                onChange={e => patch({ duration: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                className={input + ' w-full'}
              />
            </label>
            <label className="text-xs text-gray-400">Count on the turn of…
              <select className={input + ' w-full'} value={value.casterTeam} onChange={e => patch({ casterTeam: e.target.value })}>
                <option value="">Every alliance activation (DM)</option>
                {teamOptions.map(t => <option key={t} value={t}>{t} team</option>)}
              </select>
            </label>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1">Modifiers</p>
            <div className="space-y-1.5">
              {value.modifiers.map((m, i) => (
                <EffectModifierFields
                  key={i}
                  modifier={m}
                  inputClass={input}
                  onChange={next => setMod(i, next)}
                  onRemove={allowMultipleModifiers && value.modifiers.length > 1 ? () => patch({ modifiers: value.modifiers.filter((_, idx) => idx !== i) }) : undefined}
                />
              ))}
            </div>
            {allowMultipleModifiers && (
              <button
                type="button"
                className="mt-2 px-3 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600"
                onClick={() => patch({ modifiers: [...value.modifiers, { kind: 'ac', delta: 1, dice: '1' }] })}
              >
                + Add modifier
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={onCancel}>Cancel</button>
          <button className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-sm" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>

      {showImagePicker && (
        <ImagePickerModal
          current={value.imageUrl}
          uploadKey="effect"
          bucket="effect_images"
          title="Select Effect Image"
          showRaces={false}
          onSelect={url => { patch({ imageUrl: url ?? '' }); setShowImagePicker(false); }}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  );
}
