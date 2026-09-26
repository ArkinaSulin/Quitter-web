'use client';
// src/components/ScenarioMap/EffectsPanel.tsx
// Left-panel Effects tab for every assigned player (and the GM): the effects
// authored in the Effect Editor are shown as draggable cards. Drag one onto the
// map — an empty hex places a zone (with an editable pre-apply form), a unit
// applies the effect.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { EffectTemplate, mapEffectRow, modifierSummary } from '@/lib/effectTemplates';

export function dragPayload(t: EffectTemplate): string {
  return JSON.stringify({
    kind: 'quitter-effect',
    id: t.id,
    name: t.name,
    color: t.color,
    imageUrl: t.imageUrl,
    imageScale: t.imageScale,
    transparentBackground: t.transparentBackground,
    layer: t.layer,
    scope: t.scope,
    defaultDuration: t.defaultDuration,
    modifiers: t.modifiers,
  });
}

export function parseDragPayload(raw: string): Pick<EffectTemplate, 'id' | 'name' | 'color' | 'imageUrl' | 'imageScale' | 'transparentBackground' | 'layer' | 'scope' | 'defaultDuration' | 'modifiers'> | null {
  try {
    const o = JSON.parse(raw);
    if (!o || o.kind !== 'quitter-effect' || !o.name) return null;
    return {
      id: o.id,
      name: o.name,
      color: o.color || '#cccccc',
      imageUrl: o.imageUrl || '',
      imageScale: Number(o.imageScale) || 100,
      transparentBackground: !!o.transparentBackground,
      layer: o.layer === 'above' ? 'above' : 'below',
      scope: o.scope === 'zone' ? 'zone' : o.scope === 'both' ? 'both' : 'unit',
      defaultDuration: Number(o.defaultDuration) || 3,
      modifiers: Array.isArray(o.modifiers) ? o.modifiers : [],
    };
  } catch {
    return null;
  }
}

/** Hover tooltip: the effect template's scope, duration and full modifier list. */
function EffectTooltip({ t, x, y }: { t: EffectTemplate; x: number; y: number }) {
  return (
    <div
      className="fixed z-[80] pointer-events-none bg-black/95 border border-gray-600 rounded shadow-xl p-2.5 text-[11px] text-white w-64"
      style={{ left: Math.min(x + 12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280), top: Math.min(y + 12, (typeof window !== 'undefined' ? window.innerHeight : 800) - 220) }}
    >
      <div className="font-semibold" style={{ color: t.color }}>{t.name}</div>
      <div className="text-gray-300 capitalize mt-0.5">{t.scope} · {t.defaultDuration} turn{t.defaultDuration === 1 ? '' : 's'}</div>
      <div className="text-gray-400 mt-1">
        {t.modifiers.length > 0 ? t.modifiers.map(modifierSummary).join(', ') : 'no modifiers'}
      </div>
      {t.description && <div className="text-gray-500 mt-1">{t.description}</div>}
    </div>
  );
}

export default function EffectsPanel() {
  const [list, setList] = useState<EffectTemplate[]>([]);
  const [hint, setHint] = useState('');
  const [hover, setHover] = useState<{ t: EffectTemplate; x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('map_effect_templates')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setList((data as any[]).map(mapEffectRow));
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">Effects (drag onto the map)</p>
      {list.length === 0 && <p className="text-xs text-gray-500">No effects yet.</p>}
      {list.map(t => (
        <div
          key={t.id}
          draggable
          onDragStart={e => {
            e.dataTransfer.setData('application/json', dragPayload(t));
            setHint(`Drop "${t.name}" on an empty hex (zone) or on a unit.`);
          }}
          onDragEnd={() => setHint('')}
          onMouseEnter={e => setHover({ t, x: e.clientX, y: e.clientY })}
          onMouseMove={e => setHover(h => (h?.t.id === t.id ? { t, x: e.clientX, y: e.clientY } : h))}
          onMouseLeave={() => setHover(null)}
          className="cursor-grab rounded border px-2 py-1.5 text-xs bg-gray-800 hover:bg-gray-700"
          style={{ borderColor: t.color }}
        >
          <span className="font-semibold text-gray-100">{t.name}</span>
          <span className="block text-[10px] text-gray-400 capitalize">{t.scope}</span>
        </div>
      ))}
      <p className="text-[11px] text-gray-500">
        {hint || 'Drag an effect onto the board to place it.'}
        {' '}DoT damage begins on the effect's next tick — use a zone <b>entry</b> effect for immediate damage.
      </p>
      {hover && <EffectTooltip t={hover.t} x={hover.x} y={hover.y} />}
    </div>
  );
}
