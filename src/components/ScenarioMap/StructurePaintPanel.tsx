// src/components/ScenarioMap/StructurePaintPanel.tsx
'use client';
// Left-panel Map tab (GM): the live structure brush. Arm it, pick a template,
// then click near a hex edge (edge structures) or a hex (hex structures) on the
// scenario canvas to place one; click a placed edge again to flip its battlement;
// right-click removes. The selected instance exposes HP/DT/door overrides.
import { MapStructures } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';

interface StructurePaintPanelProps {
  armed: boolean;
  onToggleArm: () => void;
  templates: Record<string, StructureTemplate>;
  paletteId: string | null;
  onSetPaletteId: (id: string | null) => void;
  structures: MapStructures;
  selectedKey: string | null;
  onPatchStructure: (patch: { maxHp?: number; hp?: number; dt?: number; doorHp?: number; outside?: 'a' | 'b'; open?: boolean }) => void;
  onRemoveStructure: (key: string) => void;
}

function Num({ value, placeholder, disabled, onChange }: { value: number | undefined; placeholder: string; disabled: boolean; onChange: (v: number | undefined) => void }) {
  return (
    <input
      type="number"
      min={0}
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))))}
      className="w-14 bg-gray-800 border border-gray-600 rounded px-1 py-0.5"
    />
  );
}

export function StructurePaintPanel({
  armed, onToggleArm, templates, paletteId, onSetPaletteId, structures, selectedKey, onPatchStructure, onRemoveStructure,
}: StructurePaintPanelProps) {
  const list = Object.values(templates).sort((a, b) => a.name.localeCompare(b.name));
  const armedTemplate = paletteId ? templates[paletteId] ?? null : null;
  const instance = selectedKey ? structures[selectedKey] ?? null : null;
  const instanceTemplate = instance ? templates[instance.templateId] ?? null : null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">Map structures (temporary GM edit)</p>
      <button
        onClick={onToggleArm}
        className={`w-full py-1.5 rounded border text-xs font-semibold ${armed ? 'bg-yellow-600 text-black border-yellow-300' : 'bg-gray-800 text-gray-100 border-gray-600 hover:bg-gray-700'}`}
      >
        {armed ? 'Structure tools enabled' : 'Enable structure tools'}
      </button>
      <p className="text-xs text-gray-500">
        {armed
          ? armedTemplate
            ? `Armed: ${armedTemplate.name}. Click/drag ${armedTemplate.anchor === 'hex' ? 'a hex' : 'near a hex edge'} to place; click a placed edge again to flip its battlement. Right-click removes.`
            : 'Pick a structure below.'
          : 'Enable the tools to place structures in this scenario.'}
      </p>

      <div className="space-y-1 max-h-48 overflow-y-auto">
        {list.length === 0 && <p className="text-xs text-gray-500">No structure templates yet.</p>}
        {list.map(t => (
          <button
            key={t.id}
            onClick={() => onSetPaletteId(paletteId === t.id ? null : t.id)}
            className={`w-full text-left text-xs px-2 py-1.5 rounded border ${paletteId === t.id ? 'bg-yellow-700/40 border-yellow-500' : 'bg-gray-800 border-transparent hover:bg-gray-700'}`}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle bg-black/80 border border-gray-500" />
            {t.name}
            <span className="block text-[10px] text-gray-400">{t.anchor}{t.battlement ? ' · battlement' : ''}{t.doorHp !== null ? ` · door ${t.doorHp}` : ''} · {t.maxHp}hp</span>
          </button>
        ))}
      </div>

      {instance && instanceTemplate && selectedKey && (
        <div className="rounded border border-gray-700 p-2 space-y-2">
          <p className="text-xs text-gray-300 font-semibold">{instanceTemplate.name}</p>
          <p className="text-[10px] text-gray-500">{selectedKey}</p>
          <div className="flex items-center gap-3 text-[11px]">
            <label className="flex items-center gap-1">Max HP
              <Num value={instance.maxHp} placeholder={String(instanceTemplate.maxHp)} disabled={false} onChange={v => onPatchStructure({ maxHp: v })} />
            </label>
            <label className="flex items-center gap-1">DT
              <Num value={instance.dt} placeholder={String(instanceTemplate.dt)} disabled={false} onChange={v => onPatchStructure({ dt: v })} />
            </label>
          </div>
          {instanceTemplate.anchor === 'hex' && instanceTemplate.doorHp !== null && (
            <>
              <label className="flex items-center gap-1 text-[11px]">Door HP
                <Num value={instance.doorHp} placeholder={String(instanceTemplate.doorHp)} disabled={false} onChange={v => onPatchStructure({ doorHp: v })} />
              </label>
              <button
                onClick={() => onPatchStructure({ open: !instance.open })}
                className={`text-xs px-2 py-1 rounded ${instance.open ? 'bg-emerald-800 hover:bg-emerald-700 text-emerald-50' : 'bg-gray-700 hover:bg-gray-600 text-gray-100'}`}
              >
                {instance.open ? 'Gate open — click to close' : 'Gate closed — click to open'}
              </button>
            </>
          )}
          {instanceTemplate.anchor === 'edge' && (
            <div className="text-[11px] text-gray-400">
              Battlement side: <span className="text-amber-300">{(instance.outside ?? 'a') === 'a' ? 'A (outside)' : 'B (outside)'}</span>{' '}
              <button className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600"
                onClick={() => onPatchStructure({ outside: (instance.outside ?? 'a') === 'a' ? 'b' : 'a' })}>
                Flip
              </button>
            </div>
          )}
          <button onClick={() => onRemoveStructure(selectedKey)} className="text-xs px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-100">Remove structure</button>
        </div>
      )}
    </div>
  );
}
