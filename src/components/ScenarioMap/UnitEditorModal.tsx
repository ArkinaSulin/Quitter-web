// src/components/ScenarioMap/UnitEditorModal.tsx
'use client';

// Compact DM stat editor: grouped rows that fit one screen, with the Save/Cancel
// footer pinned (no scrolling to save). Derived read-only values ({...}) recompute
// live from the draft.

import { useEffect, useRef, useState } from 'react';
import { Unit, Formation, AllianceGroup, getOrganizationLevel } from '@/types/gameProtocol';
import { TEAM_COLORS, TEAM_SHAPES, Team } from '@/components/TokenRenderer/tokenUtils';
import { TeamShape } from '@/components/TokenRenderer/TeamChip';
import { computeEffectiveMovement } from '@/lib/unitStats';
import { computeEffectiveMoraleModifier } from '@/lib/unitMorale';
import { parseWeapons, stringifyWeapons, Weapon, formatWeaponDisplay } from '@/lib/weaponParser';
import { WeaponEditorModal } from '@/components/WeaponEditorModal';
import { ImagePickerModal } from '@/components/ImagePickerModal';
import { supabase } from '@/lib/supabaseClient';

const SIZE_LABELS: Record<number, string> = {
  75: 'Small',
  100: 'Medium',
  200: 'Large',
  300: 'Huge',
  400: 'Gargantuan',
};
const SIZE_VALUES = [75, 100, 200, 300, 400];

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'formation' | 'multi';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

const FIELDS: FieldDef[] = [
  { key: 'unitName', label: 'Name', type: 'text' },
  { key: 'currentUnitHp', label: 'Unit HP (current)', type: 'number', min: 0 },
  { key: 'troopHp', label: 'Troop HP', type: 'number', min: 1 },
  { key: 'maxTroopCount', label: 'Max troops', type: 'number', min: 1 },
  { key: 'level', label: 'Level', type: 'number', min: 1 },
  { key: 'baselineAc', label: 'Baseline AC', type: 'number' },
  { key: 'movementPoints', label: 'Movement (max MP)', type: 'number', min: 0 },
  { key: 'aggressiveness', label: 'Aggressiveness', type: 'number' },
  { key: 'baseMorale', label: 'Base Morale', type: 'number' },
  { key: 'str', label: 'Str save', type: 'number' },
  { key: 'dex', label: 'Dex save', type: 'number' },
  { key: 'con', label: 'Con save', type: 'number' },
  { key: 'int', label: 'Int save', type: 'number' },
  { key: 'wis', label: 'Wis save', type: 'number' },
  { key: 'cha', label: 'Cha save', type: 'number' },
  { key: 'movementPointsAvailable', label: 'MP left this turn', type: 'number', min: 0 },
  { key: 'actionsAvailable', label: 'Actions left', type: 'number', min: 0 },
  { key: 'archerReactionUsed', label: 'Reaction used', type: 'boolean' },
  {
    key: 'sizeCategory',
    label: 'Size',
    type: 'select',
    options: SIZE_VALUES.map(v => ({ value: String(v), label: `${SIZE_LABELS[v]} (${v})` })),
  },
  { key: 'visualScale', label: 'Visual scale', type: 'number', min: 50, max: 149 },
  { key: 'currentFormation', label: 'Formation', type: 'formation' },
  { key: 'formationAvailability', label: 'Formation availability', type: 'multi' },
  { key: 'isShielded', label: 'Shield', type: 'boolean' },
  { key: 'isCharging', label: 'Charging', type: 'boolean' },
  { key: 'canCharge', label: 'Can charge', type: 'boolean' },
  { key: 'ignoreMoraleChecks', label: 'Immune to morale (never routs)', type: 'boolean' },
];

interface UnitEditorModalProps {
  unit: Unit;
  formationsMap: Record<string, Formation>;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  onClose: () => void;
  onSave: (changes: { field: string; from: any; to: any }[], description: string) => Promise<void>;
}

function Cell({ label, children, widthClass = 'w-16' }: { label: string; children: React.ReactNode; widthClass?: string }) {
  return (
    <label className={`flex flex-col gap-0.5 text-[10px] text-gray-400 min-w-0 ${widthClass}`}>
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min, max, readOnly }: {
  value: any; onChange: (v: string) => void; min?: number; max?: number; readOnly?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      readOnly={readOnly}
      min={min}
      max={max}
      onChange={e => onChange(e.target.value)}
      className={`w-full bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 focus:border-amber-400 ${readOnly ? 'opacity-70 cursor-default' : ''}`}
    />
  );
}

/** Read-only derived value, boxed like an input so columns line up. */
function ReadBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 opacity-70">
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-300">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-amber-400" />
      {label}
    </label>
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 focus:border-amber-400"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function UnitEditorModal({ unit, formationsMap, units, alliances, onClose, onSave }: UnitEditorModalProps) {
  const [draft, setDraft] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of FIELDS) {
      if (f.type === 'boolean') init[f.key] = !!unit[f.key as keyof Unit];
      else if (f.type === 'multi') init[f.key] = [...((unit[f.key as keyof Unit] as string[]) ?? [])];
      else init[f.key] = String(unit[f.key as keyof Unit] ?? '');
    }
    init.mountId = unit.mountId ?? '';
    init.mountName = unit.mountName ?? '';
    init.customImageUrl = unit.customImageUrl ?? '';
    return init;
  });
  const [weaponsDraft, setWeaponsDraft] = useState<Weapon[]>(() => parseWeapons(unit.weaponString || ''));
  const [weaponEditorOpen, setWeaponEditorOpen] = useState(false);
  const [weaponEditingIndex, setWeaponEditingIndex] = useState<number | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [mounts, setMounts] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(20, (window.innerWidth - 460) / 2) : 60,
    y: typeof window !== 'undefined' ? Math.max(20, (window.innerHeight - 640) / 2) : 40,
  }));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    supabase.from('mounts').select('id, name').order('name').then(({ data }) => {
      if (data) setMounts((data as { id: string; name: string }[]));
    });
  }, []);

  const num = (v: any): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const draftFormation = String(draft.currentFormation || unit.currentFormation);
  const parsedTroopHp = Math.max(1, num(draft.troopHp));
  const parsedMaxTroop = Math.max(1, num(draft.maxTroopCount) || unit.maxTroopCount);
  const parsedCurrentHp = num(draft.currentUnitHp);
  const parsedBaselineAc = num(draft.baselineAc);
  const maxHp = parsedTroopHp * parsedMaxTroop;
  const troops = Math.min(parsedMaxTroop, Math.max(0, Math.ceil(parsedCurrentHp / parsedTroopHp)));
  const formation = formationsMap[draftFormation] ?? null;
  const acMod = formation?.ac_modifier ?? 0;
  const movementMult = formation?.movement_multiplier ?? 1;
  const effMove = computeEffectiveMovement({ ...unit, movementPoints: num(draft.movementPoints) }, movementMult);
  const moraleSnap = { ...unit, currentUnitHp: parsedCurrentHp, currentFormation: draftFormation };
  const effMorale = num(draft.baseMorale) + unit.currentMoraleModifier + computeEffectiveMoraleModifier(moraleSnap, units, alliances, formation);

  // Formations sorted by organization level (highest first), then name.
  const formationOptions = Object.values(formationsMap)
    .map(f => f.name)
    .sort((a, b) => getOrganizationLevel(b) - getOrganizationLevel(a) || a.localeCompare(b));

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const set = (key: string, value: any) => setDraft(d => ({ ...d, [key]: value }));

  const handleMountChange = (mountId: string) => {
    setDraft(d => ({
      ...d,
      mountId,
      mountName: mountId ? (mounts.find(m => m.id === mountId)?.name ?? d.mountName) : '',
    }));
  };

  const handleSave = async () => {
    const changes: { field: string; from: any; to: any }[] = [];
    for (const f of FIELDS) {
      const current = unit[f.key as keyof Unit] as any;
      let value: any = draft[f.key];
      if (f.type === 'number') value = num(value);
      else if (f.type === 'select') value = parseInt(value, 10) || current;
      else if (f.type === 'text') value = String(value ?? '');
      else if (f.type === 'formation') value = String(value ?? '');
      else if (f.type === 'multi') value = Array.isArray(value) ? value.filter((x: any) => typeof x === 'string' && x.length > 0) : [];
      const currentKey = Array.isArray(current) ? current.join('|') : String(current);
      const valueKey = Array.isArray(value) ? value.join('|') : String(value);
      if (valueKey !== currentKey) {
        changes.push({ field: f.key, from: current, to: value });
      }
    }
    // Mount.
    const mountIdValue = draft.mountId ? String(draft.mountId) : null;
    if ((unit.mountId ?? null) !== mountIdValue) changes.push({ field: 'mountId', from: unit.mountId, to: mountIdValue });
    if ((unit.mountName ?? '') !== String(draft.mountName ?? '')) changes.push({ field: 'mountName', from: unit.mountName, to: String(draft.mountName ?? '') });
    // Custom image.
    const imgValue = draft.customImageUrl ? String(draft.customImageUrl) : null;
    if ((unit.customImageUrl ?? null) !== imgValue) changes.push({ field: 'customImageUrl', from: unit.customImageUrl ?? null, to: imgValue });
    // Derived: organizationLevel tracks the formation.
    const formationChange = changes.find(c => c.field === 'currentFormation');
    if (formationChange) {
      changes.push({ field: 'organizationLevel', from: unit.organizationLevel, to: getOrganizationLevel(formationChange.to) });
    }
    // Derived: maxUnitHp recomputes from troopHp × maxTroopCount whenever either changes.
    const maxTroopChange = changes.find(c => c.field === 'maxTroopCount')?.to ?? unit.maxTroopCount;
    if (changes.some(c => c.field === 'troopHp') || changes.some(c => c.field === 'maxTroopCount')) {
      changes.push({ field: 'maxUnitHp', from: unit.maxUnitHp, to: parsedTroopHp * Math.max(1, maxTroopChange) });
    }
    // Derived: currentTroopCount = ceil(currentUnitHp / troopHp), clamped to the
    // (possibly reduced) max troops. If capacity shrank, clamp current HP too.
    const newMaxUnitHp = parsedTroopHp * Math.max(1, maxTroopChange);
    const newTroopHp = changes.find(c => c.field === 'troopHp')?.to ?? unit.troopHp;
    let newCurrentHp = changes.find(c => c.field === 'currentUnitHp')?.to ?? unit.currentUnitHp;
    if (newCurrentHp > newMaxUnitHp) {
      changes.push({ field: 'currentUnitHp', from: unit.currentUnitHp, to: newMaxUnitHp });
      newCurrentHp = newMaxUnitHp;
    }
    const newTroops = Math.min(Math.max(1, maxTroopChange), Math.max(0, Math.ceil(Math.max(0, newCurrentHp) / Math.max(1, newTroopHp))));
    if (newTroops !== unit.currentTroopCount) {
      changes.push({ field: 'currentTroopCount', from: unit.currentTroopCount, to: newTroops });
    }
    // Weapons: edited via the shared weapon editor (whole-string change).
    const newWeaponString = stringifyWeapons(weaponsDraft);
    if (newWeaponString !== unit.weaponString) {
      changes.push({ field: 'weaponString', from: unit.weaponString, to: newWeaponString });
    }
    if (changes.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const fieldNames = changes.map(c => c.field).filter(f => f !== 'maxUnitHp' && f !== 'currentTroopCount' && f !== 'organizationLevel').join(', ');
      await onSave(changes, `Edited ${unit.unitName} (${fieldNames})`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const team = unit.team as Team;
  const mountOptions = [{ value: '', label: 'None' }, ...mounts.map(m => ({ value: m.id, label: m.name }))];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 pointer-events-auto">
      <div
        className="bg-gray-900 border border-gray-600 rounded-xl shadow-2xl w-[460px] max-h-[92vh] flex flex-col"
        style={{ left: pos.x, top: pos.y, position: 'absolute' }}
      >
        {/* Title bar — drag to move */}
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-gray-700 cursor-move select-none rounded-t-xl bg-gray-800"
          onMouseDown={startDrag}
        >
          <span className="text-white font-semibold text-sm">Edit Unit — {unit.unitName}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm px-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {/* R1 Identity */}
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
              style={{ backgroundColor: TEAM_COLORS[team], color: '#000' }}
            >
              <TeamShape shape={TEAM_SHAPES[team]} color="#000" />
              {unit.team}
            </span>
            <input
              type="text"
              value={draft.unitName}
              onChange={e => set('unitName', e.target.value)}
              className="flex-1 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 focus:border-amber-400"
            />
            {unit.hidden && <span className="text-amber-400 text-[11px] shrink-0">HIDDEN</span>}
            <button
              onClick={() => setShowImagePicker(true)}
              className="shrink-0 text-[11px] bg-blue-700 hover:bg-blue-600 text-white rounded px-2 py-1"
            >
              Image
            </button>
          </div>

          {/* R2 HP */}
          <div className="flex items-end gap-2">
            <Cell label="Current HP"><NumInput value={draft.currentUnitHp} min={0} onChange={v => set('currentUnitHp', v)} /></Cell>
            <Cell label="Troop HP"><NumInput value={draft.troopHp} min={1} onChange={v => set('troopHp', v)} /></Cell>
            <Cell label="Max troops"><NumInput value={draft.maxTroopCount} min={1} onChange={v => set('maxTroopCount', v)} /></Cell>
            <Cell label="Max HP"><ReadBox>{maxHp}</ReadBox></Cell>
            <Cell label="Troops"><ReadBox>{troops}</ReadBox></Cell>
          </div>

          {/* R3 Armor */}
          <div className="flex items-end gap-2">
            <Cell label="Effective AC"><ReadBox>{parsedBaselineAc + acMod}</ReadBox></Cell>
            <Cell label="Base AC"><NumInput value={draft.baselineAc} onChange={v => set('baselineAc', v)} /></Cell>
            <div className="pb-1"><Toggle checked={!!draft.isShielded} onChange={v => set('isShielded', v)} label="Shield" /></div>
          </div>

          {/* R4 Movement */}
          <div className="flex items-end gap-2">
            <Cell label="MP left"><NumInput value={draft.movementPointsAvailable} min={0} onChange={v => set('movementPointsAvailable', v)} /></Cell>
            <Cell label="Max MP"><NumInput value={draft.movementPoints} min={0} onChange={v => set('movementPoints', v)} /></Cell>
            <Cell label="Eff. move"><ReadBox>{effMove}</ReadBox></Cell>
          </div>

          {/* R5 Combat */}
          <div className="flex items-end gap-2">
            <Cell label="Actions left"><NumInput value={draft.actionsAvailable} min={0} onChange={v => set('actionsAvailable', v)} /></Cell>
            <div className="pb-1"><Toggle checked={!!draft.archerReactionUsed} onChange={v => set('archerReactionUsed', v)} label="Reaction used" /></div>
          </div>

          {/* R6 Morale */}
          <div className="flex items-end gap-2">
            <Cell label="Aggress."><NumInput value={draft.aggressiveness} onChange={v => set('aggressiveness', v)} /></Cell>
            <Cell label="Current morale"><ReadBox>{effMorale}</ReadBox></Cell>
            <Cell label="Base morale"><NumInput value={draft.baseMorale} onChange={v => set('baseMorale', v)} /></Cell>
            <div className="pb-1"><Toggle checked={!!draft.ignoreMoraleChecks} onChange={v => set('ignoreMoraleChecks', v)} label="Fearless" /></div>
          </div>

          {/* R7 Formation + Charging + Mount + Can charge */}
          <div className="flex items-end gap-2">
            <Cell label="Formation" widthClass="w-32"><SelectInput value={String(draft.currentFormation)} onChange={v => set('currentFormation', v)} options={formationOptions.map(n => ({ value: n, label: n }))} /></Cell>
            <div className="pb-1"><Toggle checked={!!draft.isCharging} onChange={v => set('isCharging', v)} label="Charging" /></div>
            <Cell label="Mount" widthClass="w-28"><SelectInput value={String(draft.mountId || '')} onChange={handleMountChange} options={mountOptions} /></Cell>
            <div className="pb-1"><Toggle checked={!!draft.canCharge} onChange={v => set('canCharge', v)} label="Charge" /></div>
          </div>

          {/* R8 Availability */}
          <div className="flex flex-wrap gap-1">
            <span className="text-[10px] text-gray-400 self-center mr-1">Available:</span>
            {formationOptions.map(name => {
              const selected = (draft.formationAvailability as string[]).includes(name);
              return (
                <label
                  key={name}
                  className={`inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 cursor-pointer border ${
                    selected ? 'bg-amber-900/40 text-amber-200 border-amber-700/60' : 'bg-gray-800 text-gray-300 border-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={e => {
                      const arr = draft.formationAvailability as string[];
                      set('formationAvailability', e.target.checked ? [...arr, name] : arr.filter(x => x !== name));
                    }}
                    className="h-3 w-3 accent-amber-400"
                  />
                  {name}
                </label>
              );
            })}
          </div>

          {/* R9 Saving throws */}
          <div className="flex gap-1.5">
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(s => (
              <Cell key={s} label={s.toUpperCase()} widthClass="w-10">
                <NumInput value={draft[s]} onChange={v => set(s, v)} />
              </Cell>
            ))}
          </div>

          {/* R10 Rank & Token */}
          <div className="flex items-end gap-2">
            <Cell label="Level"><NumInput value={draft.level} min={1} onChange={v => set('level', v)} /></Cell>
            <Cell label="Size" widthClass="w-24"><SelectInput value={String(draft.sizeCategory)} onChange={v => set('sizeCategory', v)} options={SIZE_VALUES.map(v => ({ value: String(v), label: `${SIZE_LABELS[v]} (${v})` }))} /></Cell>
            <Cell label="Visual scale"><NumInput value={draft.visualScale} min={50} max={149} onChange={v => set('visualScale', v)} /></Cell>
          </div>

          {/* Weapons — edited via the shared weapon editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-300">Weapons</label>
              <button
                onClick={() => { setWeaponEditingIndex(null); setWeaponEditorOpen(true); }}
                className="text-xs bg-green-700 hover:bg-green-600 text-white rounded px-2 py-1"
              >
                + Add
              </button>
            </div>
            {weaponsDraft.length === 0 ? (
              <p className="text-[11px] text-gray-500">No weapons.</p>
            ) : (
              weaponsDraft.map((w, i) => (
                <div key={i} className="flex items-center justify-between gap-2 bg-gray-800 rounded px-2 py-1">
                  <span className="text-[11px] text-yellow-300">{formatWeaponDisplay(w)}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setWeaponsDraft(list => i > 0 ? list.map((x, j) => j === i ? list[i - 1] : j === i - 1 ? list[i] : x) : list)}
                      disabled={i === 0}
                      className="text-[10px] bg-gray-700 hover:bg-gray-600 text-white rounded px-1.5 py-0.5 disabled:opacity-40"
                      title="Move up (weapon order = priority: index 0 is the primary)"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => setWeaponsDraft(list => i < list.length - 1 ? list.map((x, j) => j === i ? list[i + 1] : j === i + 1 ? list[i] : x) : list)}
                      disabled={i >= weaponsDraft.length - 1}
                      className="text-[10px] bg-gray-700 hover:bg-gray-600 text-white rounded px-1.5 py-0.5 disabled:opacity-40"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => { setWeaponEditingIndex(i); setWeaponEditorOpen(true); }}
                      className="text-[10px] bg-blue-700 hover:bg-blue-600 text-white rounded px-1.5 py-0.5"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setWeaponsDraft(list => list.filter((_, j) => j !== i))}
                      className="text-[10px] bg-red-700 hover:bg-red-600 text-white rounded px-1.5 py-0.5"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <p className="text-[10px] text-gray-500 leading-snug">
            {`{...}`} values are derived and recompute live. All changes are logged and undo as one step.
          </p>
        </div>

        {/* Pinned footer — always visible, no scroll needed to save */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700 bg-gray-900">
          <button onClick={onClose} className="px-4 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Shared weapon editor overlay */}
      {weaponEditorOpen && (
        <WeaponEditorModal
          initial={weaponEditingIndex !== null ? (weaponsDraft[weaponEditingIndex] ?? null) : null}
          title={weaponEditingIndex !== null ? 'Edit Weapon' : 'Add Weapon'}
          onSave={(w) => {
            setWeaponsDraft(list => {
              const next = [...list];
              if (weaponEditingIndex !== null) next[weaponEditingIndex] = w;
              else next.push(w);
              return next;
            });
            setWeaponEditorOpen(false);
          }}
          onClose={() => setWeaponEditorOpen(false)}
        />
      )}

      {/* Shared image picker overlay */}
      {showImagePicker && (
        <ImagePickerModal
          current={draft.customImageUrl || undefined}
          uploadKey={unit.id}
          onSelect={(url) => { set('customImageUrl', url ?? ''); setShowImagePicker(false); }}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  );
}
