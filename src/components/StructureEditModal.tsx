'use client';
// src/components/StructureEditModal.tsx
// Shared editor for a PLACED structure instance (Scenario Map: Shift + double-click
// while inspect mode is up; Map Editor: Shift + double-click a placed structure).
// Full mode (DM) edits HP / door HP / outside side / modifiers; `restricted` mode
// (a player controlling the hex) exposes ONLY the door Open/Close toggle.
import React, { useState } from 'react';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { EffectModifier } from '@/packages/effects';
import { EffectModifierFields } from '@/components/EffectEditor/EffectModifierFields';
import { structureDoorState } from '@/packages/movement';

export interface StructureInstancePatch {
  hp?: number;
  maxHp?: number;
  ac?: number;
  mpClimbUp?: number;
  mpClimbDown?: number;
  mpMountedUp?: number;
  mpMountedDown?: number;
  doorHp?: number;
  open?: boolean;
  outside?: 'a' | 'b';
  elevation?: number;
  ladder?: boolean;
  modifiers?: EffectModifier[];
}

interface StructureEditModalProps {
  template: StructureTemplate;
  instance: StructureInstance;
  onSave: (patch: StructureInstancePatch) => void;
  onClose: () => void;
  /** Player door-only mode: show just the Open/Close toggle. */
  restricted?: boolean;
  /** Restricted mode action (command-logged by the caller). */
  onToggleDoor?: (open: boolean) => void;
  /** DM-only: remove this placed structure (command-logged by the caller). */
  onRemove?: () => void;
  /** DM-only: manage the ground effects on this hex (only when they exist). */
  onEditEffects?: () => void;
}

const input =
  'bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none';

export function StructureEditModal({ template, instance, onSave, onClose, restricted = false, onToggleDoor, onRemove, onEditEffects }: StructureEditModalProps) {
  const st = structureDoorState(instance, template);
  const [hp, setHp] = useState<number>(st.hpNow);
  const [maxHp, setMaxHp] = useState<number>(Math.max(0, Math.round(instance.maxHp ?? template.maxHp)));
  const [ac, setAc] = useState<number>(Math.max(0, Math.round(instance.ac ?? template.ac ?? 10)));
  const [climbUp, setClimbUp] = useState<number>(instance.mpClimbUp ?? template.mpClimbUp);
  const [climbDown, setClimbDown] = useState<number>(instance.mpClimbDown ?? template.mpClimbDown);
  const [climbMUp, setClimbMUp] = useState<number>(instance.mpMountedUp ?? template.mpMountedUp);
  const [climbMDown, setClimbMDown] = useState<number>(instance.mpMountedDown ?? template.mpMountedDown);
  const [doorHp, setDoorHp] = useState<number>(st.doorNow);
  const [open, setOpen] = useState<boolean>(!!instance.open);
  const [outside, setOutside] = useState<'a' | 'b'>(instance.outside ?? 'a');
  const [elev, setElev] = useState<number>(Math.max(0, Math.round(instance.elevation ?? template.elevation ?? 0)));
  const [ladder, setLadder] = useState<boolean>(!!(instance.ladder ?? template.ladder));
  const [mods, setMods] = useState<EffectModifier[]>(instance.modifiers ?? template.modifiers);

  const patchMod = (i: number, p: Partial<EffectModifier>) => setMods(m => m.map((x, idx) => (idx === i ? { ...x, ...p } : x)));

  const save = () => {
    // A DESTRUCTIBLE structure at 0 HP is destroyed — REMOVED from the map (edge and
    // hex alike). Decorative structures (max HP = 0, e.g. a ladder) have hp 0 by
    // default and must NOT be removed by an ordinary edit.
    if (maxHp > 0 && hp <= 0 && onRemove) {
      onRemove();
      onClose();
      return;
    }
    onSave({ hp, maxHp, ac, mpClimbUp: climbUp, mpClimbDown: climbDown, mpMountedUp: climbMUp, mpMountedDown: climbMDown, doorHp, open, outside, elevation: elev, ladder, modifiers: mods });
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

        {restricted ? (
          <>
            <p className="text-xs text-gray-400">
              Door: <span className="text-amber-300">{st.intact ? (st.open ? 'open' : `closed (${st.doorNow}/${st.hpNow})`) : st.openOrBroken ? 'open / broken' : 'none'}</span>
            </p>
            {st.intact && (
              <button
                onClick={() => { onToggleDoor?.(!st.open); onClose(); }}
                className={`px-4 py-1.5 rounded text-sm ${st.open ? 'bg-gray-700 hover:bg-gray-600' : 'bg-emerald-700 hover:bg-emerald-600'}`}
              >
                {st.open ? 'Close gate' : 'Open gate'}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <label className="text-gray-400">AC
                <input type="number" min={0} max={99} className={input + ' !w-20 block'} value={ac}
                  onChange={e => setAc(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
              </label>
              <label className="text-gray-400">Max HP
                <input type="number" min={0} max={9999} className={input + ' !w-24 block'} value={maxHp}
                  onChange={e => setMaxHp(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
              </label>
              <label className="text-gray-400">HP
                <input type="number" min={0} max={maxHp} className={input + ' !w-24 block'} value={hp}
                  onChange={e => setHp(Math.max(0, Math.min(maxHp, Math.round(Number(e.target.value) || 0))))} />
              </label>
              <label className="text-gray-400">Door HP
                <input type="number" min={0} max={hp} className={input + ' !w-24 block'} value={doorHp}
                  onChange={e => setDoorHp(Math.max(0, Math.min(hp, Math.round(Number(e.target.value) || 0))))} />
              </label>
              {st.hasDoor && (
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
              <label className="text-gray-400">Elevation (ft)
                <input type="number" min={0} step={10} className={input + ' !w-24 block'} value={elev}
                  onChange={e => setElev(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
              </label>
              <label className="text-gray-400" title="MP per 10 ft to climb UP (foot). Negative = hard block. Defaults to the template.">Climb up
                <input type="number" min={-1} max={99} className={input + ' !w-20 block'} value={climbUp}
                  onChange={e => setClimbUp(Math.round(Number(e.target.value) || 0))} />
              </label>
              <label className="text-gray-400" title="MP per 10 ft to climb DOWN (foot).">Climb down
                <input type="number" min={-1} max={99} className={input + ' !w-20 block'} value={climbDown}
                  onChange={e => setClimbDown(Math.round(Number(e.target.value) || 0))} />
              </label>
              <label className="text-gray-400" title="MP per 10 ft to climb UP (mounted).">Mount up
                <input type="number" min={-1} max={99} className={input + ' !w-20 block'} value={climbMUp}
                  onChange={e => setClimbMUp(Math.round(Number(e.target.value) || 0))} />
              </label>
              <label className="text-gray-400" title="MP per 10 ft to climb DOWN (mounted).">Mount down
                <input type="number" min={-1} max={99} className={input + ' !w-20 block'} value={climbMDown}
                  onChange={e => setClimbMDown(Math.round(Number(e.target.value) || 0))} />
              </label>
              {template.anchor === 'edge' && (
                <label className="flex items-center gap-2 text-gray-300 pb-1.5" title="Draw the trapezoid ladder on this edge (pure visual).">
                  <input type="checkbox" checked={ladder} onChange={e => setLadder(e.target.checked)} /> ladder
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
                onClick={() => setMods(list => [...list, { kind: 'ac', dice: '1', mode: 'melee' }])}>
                + Add modifier
              </button>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              {onEditEffects && (
                <button onClick={onEditEffects} className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600">
                  Effects on this hex…
                </button>
              )}
              {onRemove && (
                <button onClick={onRemove} className="px-3 py-1.5 rounded text-sm bg-red-900/70 hover:bg-red-800 text-red-200">
                  Remove
                </button>
              )}
              <button onClick={onClose} className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600">Cancel</button>
              <button onClick={save} className="px-4 py-1.5 rounded text-sm bg-emerald-700 hover:bg-emerald-600">Save</button>
            </div>
          </>
        )}
        {restricted && (
          <div className="flex justify-end pt-1">
            <button onClick={onClose} className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
