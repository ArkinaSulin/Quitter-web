// src/components/ScenarioMap/EffectsPaintPanel.tsx
'use client';
// Left-panel Effects tab: GM places temporary ground-effect zones (runtime,
// ticking) by arming a template then left-clicking hexes. Left-click again on a
// same-name zone removes it; right-click clears MP cost (see TerrainPaintPanel).
import { useEffect } from 'react';
import { EffectTemplate, EFFECT_TEMPLATES } from '@/lib/unitEffects';

interface EffectsPaintPanelProps {
  activeTemplateId: string | null;
  onSetTemplate: (id: string | null) => void;
}

export function EffectsPaintPanel({ activeTemplateId, onSetTemplate }: EffectsPaintPanelProps) {
  useEffect(() => () => onSetTemplate(null), [onSetTemplate]);
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">Ground-effect zones (temporary)</p>
      <div className="flex flex-wrap gap-1.5">
        {EFFECT_TEMPLATES.map(t => {
          const active = activeTemplateId === t.id;
          return (
            <button
              key={t.id}
              title={`${t.name} — ${t.description}`}
              onClick={() => onSetTemplate(active ? null : t.id)}
              className={`px-2 py-1 rounded text-xs border ${active ? 'text-black' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
              style={active ? { background: t.color, borderColor: t.color } : { borderColor: t.color }}
            >
              {t.name}
            </button>
          );
        })}
      </div>
      {activeTemplateId === null ? (
        <p className="text-xs text-gray-500">Pick an effect to place a zone.</p>
      ) : (
        <p className="text-xs text-yellow-300">Zone pen armed — click a hex to place/remove. Esc exits.</p>
      )}
      <p className="text-xs text-gray-400">Zones tick on the effect's tempo and expire; stat zones affect a unit while it stands on the hex.</p>
    </div>
  );
}

export type { EffectTemplate };
