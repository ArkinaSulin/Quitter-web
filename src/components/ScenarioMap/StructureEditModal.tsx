'use client';
// src/components/ScenarioMap/StructureEditModal.tsx
// In-scenario editor for a PLACED structure instance (opened with Shift +
// double-click while the map-inspect overlay is up). Edits the instance's own
// runtime state: HP, door HP, gate open, outside side and its modifier list
// (inherited from the template, overridable here).
import React, { useState } from 'react';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { EffectModifier } from '@/lib/effectTemplates';
import { EffectModifierFields } from '@/components/EffectEditor/EffectModifierFields';
import { instanceDoorState } from '@/lib/mapStructures';

export interface StructureInstancePatch {
  hp?: number;
  doorHp?: number;
  open?: boolean;
  outside?: 'a' | 'b';
  modifiers?: EffectModifier[];
}

interface StructureEditModalProps {
  template: StructureTemplate;
  instance: StructureInstance;
  onSave: (patch: StructureInstancePatch) => void;
  onClose: () => void;
}

const input =
  'bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none';

export function StructureEditModal({ template, instance, onSave, onClose }: StructureEditModalProps) {
  const door = instanceDoorState(instance, template);
  const [hp, setHp] = useState<number>(instance.hp ?? template.maxHp);
  const [doorHp, setDoorHp] = useState<number>(door.doorHp);
  const [open, setOpen] = useState<boolean>(!!instance.open);
  const [outside, setOutside] = useState<'a' | 'b'>(instance.outside ?? 'a');
  const [mods, setMods] = useState<EffectModifier[]>(instance.modifiers ?? template.modifiers);

  const patchMod = (i: number, p: Partial<EffectModifier>) => setMods(m => m.map((x, idx) => (idx === i ? { ...x, ...p } : x)));

  const save = () => {
    onSave({ hp, doorHp, open, outside, modifiers: mods });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60" onMouseDown={onClose}>
      <div className="w-[min(640px,calc(100vw-24px))] max-h-[calc(100vh-48px)] overflow-y-auto rounded-lg border border-gray-700 bg-[#11111f] p-4 space-y-3" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-amber-300">{template.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>
        <p className="text-[11px] text-gray-500">{template.description}</p>

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="text-gray-400">HP
            <input type="number" min={0} max={template.maxHp} className={input + ' !w-24 block'} value={hp}
              onChange={e => setHp(Math.max(0, Math.min(template.maxHp, Math.round(Number(e.target.value) || 0))))} />
          </label>
          {door.doorMax > 0 && (
            <label className="text-gray-400">Door HP
              <input type="number" min={0} max={door.doorMax} className={input + ' !w-24 block'} value={doorHp}
                onChange={e => setDoorHp(Math.max(0, Math.min(door.doorMax, Math.round(Number(e.target.value) || 0))))} />
            </label>
          )}
          {door.doorMax > 0 && (
            <label className="flex items-center gap-2 text-gray-300 pb-1.5">
              <input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} /> gate open
            </label>
          )}
          {template.anchor === 'edge' && (
            <label className="text-gray-400">Outside side
              <select className={input + ' !w-24 block'} value={outside} onChange={e => setOutside(e.target.value as 'a' | 'b')}>
                <option value="a">A</option>
                <option value="b">B</option>
              </select>
            </label>
          )}
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">Modifiers (inherited from the template; edit to override this placement)</p>
          <div className="space-y-1.5">
            {mods.map((m, i) => (
              <EffectModifierFields
                key={i}
                modifier={m}
                inputClass={input}
                onChange={next => patchMod(i, next)}
                onRemove={() => setMods(list => list.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
          <button className="mt-2 px-3 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600"
            onClick={() => setMods(list => [...list, { kind: 'ac', delta: 1, mode: 'melee' }])}>
            + Add modifier
          </button>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600">Cancel</button>
          <button onClick={save} className="px-4 py-1.5 rounded text-sm bg-emerald-700 hover:bg-emerald-600">Save</button>
        </div>
      </div>
    </div>
  );
}
