// src/components/ScenarioMap/WallPaintPanel.tsx
'use client';
// Left-panel Map tab (GM): the live wall brush. Arm it, then click near a hex
// edge on the scenario canvas to place a barrier (right-click removes). The
// selected edge shows two per-side face editors (MP replacement / block /
// melee AC / ranged AC), mirroring the Map Editor.
import { WallFace, Walls, edgeRef } from '@/lib/walls';

interface WallPaintPanelProps {
  armed: boolean;
  onToggleArm: () => void;
  walls: Walls;
  selectedEdge: { q: number; r: number; dir: number } | null;
  onChangeFace: (side: 'a' | 'b', patch: Partial<WallFace>) => void;
  /** Patch the whole segment (destructibility: maxHp / dt). */
  onChangeWall: (patch: { maxHp?: number; dt?: number }) => void;
  onRemove: () => void;
}

function num(v: number | undefined): string {
  return v === undefined ? '' : String(v);
}

export function WallPaintPanel({ armed, onToggleArm, walls, selectedEdge, onChangeFace, onChangeWall, onRemove }: WallPaintPanelProps) {
  const ref = selectedEdge ? edgeRef(selectedEdge.q, selectedEdge.r, selectedEdge.dir) : null;
  const wall = ref ? walls[ref.key] : undefined;

  const face = (side: 'a' | 'b', label: string) => {
    const f = wall![side];
    const parse = (raw: string): number | undefined => (raw === '' ? undefined : Math.max(0, Math.min(99, Math.round(Number(raw)))));
    return (
      <div className="rounded border border-gray-700 p-2 space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">Face — hex {label}</p>
        <div className="flex items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1" title="Replaces the entered hex's terrain cost when crossing into this side.">MP
            <input type="number" min={0} max={99} value={num(f.moveCost)} placeholder="—" onChange={e => onChangeFace(side, { moveCost: parse(e.target.value) })} className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-0.5" />
          </label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={!!f.block} onChange={e => onChangeFace(side, { block: e.target.checked })} />block</label>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1">Melee AC
            <input type="number" value={num(f.meleeAc)} placeholder="0" onChange={e => onChangeFace(side, { meleeAc: parse(e.target.value) })} className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-0.5" />
          </label>
          <label className="flex items-center gap-1">Ranged AC
            <input type="number" value={num(f.rangedAc)} placeholder="0" onChange={e => onChangeFace(side, { rangedAc: parse(e.target.value) })} className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-0.5" />
          </label>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">Edge walls (temporary GM edit)</p>
      <button
        onClick={onToggleArm}
        className={`w-full py-1.5 rounded border text-xs font-semibold ${armed ? 'bg-yellow-600 text-black border-yellow-300' : 'bg-gray-800 text-gray-100 border-gray-600 hover:bg-gray-700'}`}
      >
        {armed ? 'Wall tool ON' : 'Arm wall tool'}
      </button>
      <p className="text-xs text-gray-500">
        {armed ? 'Click near a hex edge to place a barrier; click again selects it. Right-click removes.' : 'Arm the tool to add walls to this scenario.'}
      </p>
      {ref && wall ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Edge ({ref.aq},{ref.ar}) ⇄ ({ref.bq},{ref.br}).</p>
          {face('a', `(${ref.aq}, ${ref.ar})`)}
          {face('b', `(${ref.bq}, ${ref.br})`)}
          <div className="rounded border border-gray-700 p-2 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Destructibility</p>
            <div className="flex items-center gap-3 text-[11px]">
              <label className="flex items-center gap-1" title="Max HP: above 0 makes the segment attackable; destroyed at 0 HP.">Max HP
                <input type="number" min={0} max={999} value={num(wall.maxHp)} placeholder="—"
                  onChange={e => onChangeWall({ maxHp: e.target.value === '' ? undefined : Math.max(0, Math.min(999, Math.round(Number(e.target.value)))) })}
                  className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-0.5" />
              </label>
              <label className="flex items-center gap-1" title="Damage Threshold: a hit at or below this does nothing; above deals full damage.">DT
                <input type="number" min={0} max={99} value={num(wall.dt)} placeholder="0"
                  onChange={e => onChangeWall({ dt: e.target.value === '' ? undefined : Math.max(0, Math.min(99, Math.round(Number(e.target.value)))) })}
                  className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-0.5" />
              </label>
            </div>
          </div>
          <button onClick={onRemove} className="text-xs px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-100">Remove wall</button>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Click an edge on the map to edit it.</p>
      )}
    </div>
  );
}
