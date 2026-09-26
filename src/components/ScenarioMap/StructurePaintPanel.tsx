// src/components/ScenarioMap/StructurePaintPanel.tsx
'use client';
// Left-panel Features tab (GM): the live structure brush. Arm it, pick a template,
// then click near a hex edge (edge structures) or a hex (hex structures) on the
// scenario canvas to place one; click a placed edge again to flip its battlement;
// right-click removes. Hover a template for its full info (Unit-Selector style);
// placed instances are edited with Shift + double-click on the canvas.
import { useState } from 'react';
import { MapStructures } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { modifierAmount, modifierSummary } from '@/lib/effectTemplates';

interface StructurePaintPanelProps {
  templates: Record<string, StructureTemplate>;
  paletteId: string | null;
  onSetPaletteId: (id: string | null) => void;
  structures: MapStructures;
  selectedKey: string | null;
  onPatchStructure: (patch: { hp?: number; doorHp?: number; outside?: 'a' | 'b'; open?: boolean; modifiers?: any[] }) => void;
  onRemoveStructure: (key: string) => void;
}

const mpText = (v: number | null): string => (v === null ? '—' : v < 0 ? 'block' : `${v}`);

/** Hover tooltip: the structure template's movement, durability and modifiers. */
function StructureTooltip({ t, x, y }: { t: StructureTemplate; x: number; y: number }) {
  const cover = t.modifiers.filter(m => m.kind === 'ac');
  const melee = cover.filter(m => m.mode !== 'ranged').reduce((s, m) => s + modifierAmount(m.dice), 0);
  const ranged = cover.filter(m => m.mode !== 'melee').reduce((s, m) => s + modifierAmount(m.dice), 0);
  const rest = t.modifiers.filter(m => m.kind !== 'ac');
  const door = t.doorHp ?? t.maxHp;
  return (
    <div
      className="fixed z-[80] pointer-events-none bg-black/95 border border-gray-600 rounded shadow-xl p-2.5 text-[11px] text-white w-64"
      style={{ left: Math.min(x + 12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280), top: Math.min(y + 12, (typeof window !== 'undefined' ? window.innerHeight : 800) - 220) }}
    >
      <div className="font-semibold text-amber-300 mb-1">{t.name}</div>
      <div className="text-gray-300 capitalize">{t.anchor}{t.spikes ? ' · stakes' : t.battlement ? ' · battlement' : ''}</div>
      {t.anchor === 'edge' ? (
        <>
          <div className="text-gray-400 mt-1">In: foot {mpText(t.mpFootIn)} · mtd {mpText(t.mpMountedIn)} MP</div>
          <div className="text-gray-400">Out: foot {mpText(t.mpFootOut)} · mtd {mpText(t.mpMountedOut)} MP</div>
        </>
      ) : (
        <div className="text-gray-400 mt-1">Enter: foot {mpText(t.mpFootIn)} · mtd {mpText(t.mpMountedIn)} MP</div>
      )}
      <div className="text-gray-400 mt-1">HP {t.maxHp} · DT {t.dt} · door {door === 0 ? 'none' : door}</div>
      {(melee || ranged) ? <div className="text-gray-400">Cover AC melee {melee} · ranged {ranged}</div> : null}
      {rest.length > 0 && <div className="text-gray-400">Effects: {rest.map(modifierSummary).join(', ')}</div>}
      {t.description && <div className="text-gray-500 mt-1">{t.description}</div>}
    </div>
  );
}

export function StructurePaintPanel({
  templates, paletteId, onSetPaletteId,
}: StructurePaintPanelProps) {
  const [hover, setHover] = useState<{ t: StructureTemplate; x: number; y: number } | null>(null);
  const list = Object.values(templates).sort((a, b) => a.name.localeCompare(b.name));
  const armedTemplate = paletteId ? templates[paletteId] ?? null : null;

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">Map structures (temporary GM edit)</p>
      <p className="text-xs text-gray-500">
        {armedTemplate
          ? `Armed: ${armedTemplate.name}. Click/drag ${armedTemplate.anchor === 'hex' ? 'a hex' : 'near a hex edge'} to place; click a placed edge again to flip its battlement. Right-click removes. Shift + double-click a placed structure to edit it.`
          : 'Pick a structure below to arm placement.'}
      </p>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {list.length === 0 && <p className="text-xs text-gray-500">No structure templates yet.</p>}
        {list.map(t => (
          <button
            key={t.id}
            onClick={() => onSetPaletteId(paletteId === t.id ? null : t.id)}
            onMouseEnter={e => setHover({ t, x: e.clientX, y: e.clientY })}
            onMouseMove={e => setHover(h => (h?.t.id === t.id ? { t, x: e.clientX, y: e.clientY } : h))}
            onMouseLeave={() => setHover(null)}
            className={`w-full text-left text-xs px-2 py-1.5 rounded border ${paletteId === t.id ? 'bg-yellow-700/40 border-yellow-500' : 'bg-gray-800 border-transparent hover:bg-gray-700'}`}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: t.color }} />
            {t.name}
            <span className="block text-[10px] text-gray-400">{t.anchor}{t.battlement ? ' · battlement' : ''}{t.spikes ? ' · stakes' : ''} · {t.maxHp}hp</span>
          </button>
        ))}
      </div>

      {hover && <StructureTooltip t={hover.t} x={hover.x} y={hover.y} />}
    </div>
  );
}
