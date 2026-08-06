// src/components/ScenarioMap/UnitEditorModal.tsx
'use client';

import { useRef, useState } from 'react';
import { Unit, Formation, getOrganizationLevel } from '@/types/gameProtocol';
import { TEAM_COLORS, TEAM_SHAPES, Team } from '@/components/TokenRenderer/tokenUtils';
import { TeamShape } from '@/components/TokenRenderer/TeamChip';
import { getFormationModifier, getFormationMultiplier, computeEffectiveMovement } from '@/lib/unitStats';

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
  { key: 'level', label: 'Level', type: 'number', min: 1 },
  { key: 'baselineAc', label: 'Baseline AC', type: 'number' },
  { key: 'movementPoints', label: 'Movement (max MP)', type: 'number', min: 0 },
  { key: 'aggressiveness', label: 'Aggressiveness', type: 'number' },
  { key: 'baseMorale', label: 'Base Morale', type: 'number' },
  { key: 'weaponString', label: 'Weapons (string)', type: 'text' },
  { key: 'movementPointsAvailable', label: 'MP left this turn', type: 'number', min: 0 },
  { key: 'actionsAvailable', label: 'Actions left', type: 'number', min: 0 },
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
  { key: 'canCharge', label: 'Can charge', type: 'boolean' },
  { key: 'ignoreMoraleChecks', label: 'Immune to morale (never routs)', type: 'boolean' },
];

interface UnitEditorModalProps {
  unit: Unit;
  formationsMap: Record<string, Formation>;
  onClose: () => void;
  onSave: (changes: { field: string; from: any; to: any }[], description: string) => Promise<void>;
}

export function UnitEditorModal({ unit, formationsMap, onClose, onSave }: UnitEditorModalProps) {
  const [draft, setDraft] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of FIELDS) {
      if (f.type === 'boolean') init[f.key] = !!unit[f.key as keyof Unit];
      else if (f.type === 'multi') init[f.key] = [...((unit[f.key as keyof Unit] as string[]) ?? [])];
      else init[f.key] = String(unit[f.key as keyof Unit] ?? '');
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(20, (window.innerWidth - 420) / 2) : 60,
    y: typeof window !== 'undefined' ? Math.max(20, (window.innerHeight - 620) / 2) : 40,
  }));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const num = (v: any): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const parsedTroopHp = num(draft.troopHp);
  const parsedMaxTroop = unit.maxTroopCount;
  const parsedCurrentHp = num(draft.currentUnitHp);
  const parsedBaselineAc = num(draft.baselineAc);
  const formation = formationsMap[unit.currentFormation];
  const acMod = getFormationModifier(formationsMap, unit.currentFormation, 'ac_modifier');
  const movementMult = getFormationMultiplier(formationsMap, unit.currentFormation, 'movement_multiplier');
  // Formations sorted by organization level (highest first), then name — shared by
  // the formation select and the availability checkboxes.
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
    // Derived: organizationLevel tracks the formation.
    const formationChange = changes.find(c => c.field === 'currentFormation');
    if (formationChange) {
      changes.push({ field: 'organizationLevel', from: unit.organizationLevel, to: getOrganizationLevel(formationChange.to) });
    }
    // Derived: maxUnitHp recomputes from troopHp × maxTroopCount whenever troopHp changes.
    if (changes.some(c => c.field === 'troopHp')) {
      const newMax = Math.max(1, parsedTroopHp) * parsedMaxTroop;
      changes.push({ field: 'maxUnitHp', from: unit.maxUnitHp, to: newMax });
    }
    // Derived: currentTroopCount = ceil(currentUnitHp / troopHp) — it is a calculated
    // value, so it's derived from the (possibly edited) HP fields rather than edited
    // directly.
    const newTroopHp = changes.find(c => c.field === 'troopHp')?.to ?? unit.troopHp;
    const newCurrentHp = changes.find(c => c.field === 'currentUnitHp')?.to ?? unit.currentUnitHp;
    const newTroops = Math.max(0, Math.ceil(Math.max(0, newCurrentHp) / Math.max(1, newTroopHp)));
    if (newTroops !== unit.currentTroopCount) {
      changes.push({ field: 'currentTroopCount', from: unit.currentTroopCount, to: newTroops });
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

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 pointer-events-auto">
      <div
        className="bg-gray-900 border border-gray-600 rounded-xl shadow-2xl w-[420px] max-h-[90vh] flex flex-col"
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
          {/* Read-only identity row */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
              style={{ backgroundColor: TEAM_COLORS[team], color: '#000' }}
            >
              <TeamShape shape={TEAM_SHAPES[team]} color="#000" />
              {unit.team}
            </span>
            <span>Formation: {unit.currentFormation}</span>
            {unit.hidden && <span className="text-amber-400">HIDDEN</span>}
          </div>

          {/* Derived read-only fields */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-gray-800 rounded px-2 py-1.5">
              <div className="text-gray-500">Unit HP</div>
              <div className="text-white">{parsedCurrentHp} / {parsedTroopHp * parsedMaxTroop}</div>
            </div>
            <div className="bg-gray-800 rounded px-2 py-1.5">
              <div className="text-gray-500">Effective AC</div>
              <div className="text-white">{parsedBaselineAc} + {acMod} = {parsedBaselineAc + acMod}</div>
            </div>
            <div className="bg-gray-800 rounded px-2 py-1.5">
              <div className="text-gray-500">Effective Move</div>
              <div className="text-white">{computeEffectiveMovement({ ...unit, movementPoints: num(draft.movementPoints) }, movementMult)} MP</div>
            </div>
          </div>

          {FIELDS.map(f => (
            <div key={f.key} className="flex items-center justify-between gap-3">
              <label className="text-xs text-gray-300 w-40 shrink-0">{f.label}</label>
              {f.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={!!draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.checked }))}
                  className="h-4 w-4 accent-amber-400"
                />
              ) : f.type === 'select' ? (
                <select
                  value={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="flex-1 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700"
                >
                  {f.options!.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.type === 'formation' ? (
                <select
                  value={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="flex-1 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700"
                >
                  {formationOptions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : f.type === 'multi' ? (
                <div className="flex-1 flex flex-wrap gap-1 justify-end">
                  {formationOptions.map(name => {
                    const selected = (draft[f.key] as string[]).includes(name);
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
                            const arr = draft[f.key] as string[];
                            setDraft(d => ({ ...d, [f.key]: e.target.checked ? [...arr, name] : arr.filter(x => x !== name) }));
                          }}
                          className="h-3 w-3 accent-amber-400"
                        />
                        {name}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={draft[f.key]}
                  min={f.min}
                  max={f.max}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="flex-1 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 focus:border-amber-400"
                />
              )}
            </div>
          ))}

          <p className="text-[10px] text-gray-500 leading-snug">
            Team, visibility and troop capacity are managed elsewhere. All changes are
            logged and undo as one step.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
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
    </div>
  );
}

