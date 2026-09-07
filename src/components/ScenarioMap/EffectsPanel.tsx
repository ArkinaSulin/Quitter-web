'use client';
// src/components/ScenarioMap/EffectsPanel.tsx
// Left-panel Effects tab for every assigned player (and the GM): the effect
// library is shown as draggable cards. Drag one onto the map — an empty hex
// places a zone (with duration/radius prompts), a unit applies the effect.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { EffectTemplate, mapEffectRow } from '@/lib/effectTemplates';

export function dragPayload(t: EffectTemplate): string {
  return JSON.stringify({
    kind: 'quitter-effect',
    id: t.id,
    name: t.name,
    color: t.color,
    scope: t.scope,
    defaultDuration: t.defaultDuration,
    modifiers: t.modifiers,
  });
}

export function parseDragPayload(raw: string): Pick<EffectTemplate, 'id' | 'name' | 'color' | 'scope' | 'defaultDuration' | 'modifiers'> | null {
  try {
    const o = JSON.parse(raw);
    if (!o || o.kind !== 'quitter-effect' || !o.name) return null;
    return {
      id: o.id,
      name: o.name,
      color: o.color || '#cccccc',
      scope: o.scope === 'zone' ? 'zone' : o.scope === 'both' ? 'both' : 'unit',
      defaultDuration: Number(o.defaultDuration) || 3,
      modifiers: Array.isArray(o.modifiers) ? o.modifiers : [],
    };
  } catch {
    return null;
  }
}

export default function EffectsPanel() {
  const [list, setList] = useState<EffectTemplate[]>([]);
  const [hint, setHint] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('effect_templates')
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
      {list.length === 0 && <p className="text-xs text-gray-500">No effects in the library yet.</p>}
      {list.map(t => (
        <div
          key={t.id}
          draggable
          onDragStart={e => {
            e.dataTransfer.setData('application/json', dragPayload(t));
            setHint(`Drop "${t.name}" on an empty hex (zone) or on a unit.`);
          }}
          onDragEnd={() => setHint('')}
          className="cursor-grab rounded border px-2 py-1.5 text-xs bg-gray-800 hover:bg-gray-700"
          style={{ borderColor: t.color }}
        >
          <span className="font-semibold text-gray-100">{t.name}</span>
          <span className="block text-[10px] text-gray-400">
            {t.scope} · {t.modifiers.map(m => `${m.kind}${m.delta >= 0 ? '+' : ''}${m.delta}`).join(', ') || '—'}
          </span>
        </div>
      ))}
      <p className="text-[11px] text-gray-500">{hint || 'Drag an effect onto the board to place it.'}</p>
    </div>
  );
}
