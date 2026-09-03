// src/components/ScenarioMap/AddEffectModal.tsx
// 'use client' — the "Effects…" dialog opened from a unit's context menu.
// Offers the in-code effect catalog (magnitude + duration overridable), applies a
// temporary effect to the target unit, removes an existing one, and (GM-only)
// drops the same effect as a ground zone on the unit's hex.
'use client';
import React, { useState } from 'react';
import { Unit } from '@/types/gameProtocol';
import { EFFECT_TEMPLATES, isStatEffect, EffectSpec } from '@/lib/unitEffects';

interface AddEffectModalProps {
  unit: Unit;
  /** Team whose activations count the duration; null = every END_TURN. */
  teamOptions: string[];
  canPlaceZone: boolean;
  onApply: (spec: EffectSpec, duration: number) => void;
  onRemove: (key: string) => void;
  onPlaceZone: (spec: EffectSpec, duration: number) => void;
  onClose: () => void;
}

export function AddEffectModal({ unit, teamOptions, canPlaceZone, onApply, onRemove, onPlaceZone, onClose }: AddEffectModalProps) {
  const [templateId, setTemplateId] = useState('bless');
  const [delta, setDelta] = useState(0);
  const [duration, setDuration] = useState(3);
  const [tempo, setTempo] = useState<string>(unit.team || (teamOptions[0] ?? ''));
  const template = EFFECT_TEMPLATES.find(t => t.id === templateId) ?? EFFECT_TEMPLATES[0];
  const activeEffects = (unit.effects ?? []).filter(e => !e.zoneHex);

  const buildSpec = (): EffectSpec => ({
    name: template.name,
    color: template.color,
    kind: template.kind,
    delta: Number(delta) || 0,
    casterUnitId: null,
    casterTeam: tempo === 'every-turn' ? null : tempo,
  });

  return (
    <div className="absolute inset-0 z-[70] bg-black/50 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-5 w-[440px] text-white space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-yellow-300">Effects — {unit.unitName}</p>
          <button className="text-gray-400 hover:text-white" onClick={onClose}>✕</button>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">Effect</p>
          <select
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
            value={templateId}
            onChange={(e) => { const t = EFFECT_TEMPLATES.find(x => x.id === e.target.value)!; setTemplateId(e.target.value); setDelta(t.defaultDelta); setDuration(t.defaultDuration); }}
          >
            {EFFECT_TEMPLATES.map(t => (
              <option key={t.id} value={t.id}>{t.name} — {t.description}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-400">Magnitude
            <input
              type="number"
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              value={delta}
              onChange={(e) => setDelta(Math.floor(Number(e.target.value) || 0))}
            />
          </label>
          <label className="text-xs text-gray-400">Duration (turns)
            <input
              type="number" min={1} max={20}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </label>
        </div>

        <label className="block text-xs text-gray-400">Count on the turn of…
          <select className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm mt-1" value={tempo} onChange={(e) => setTempo(e.target.value)}>
            <option value="every-turn">Every alliance activation (DM)</option>
            {teamOptions.map(t => <option key={t} value={t}>{t} team</option>)}
          </select>
        </label>

        {isStatEffect(template.kind) && (
          <p className="text-xs text-gray-500">Stat effect — materializes {template.kind === 'ac' ? 'AC' : template.kind === 'movement' ? 'movement' : 'morale'} immediately.</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            className="flex-1 bg-yellow-600 hover:bg-yellow-500 rounded px-3 py-1.5 text-sm font-semibold"
            onClick={() => { onApply(buildSpec(), duration); onClose(); }}
          >
            Apply to Unit
          </button>
          {canPlaceZone && (
            <button
              className="flex-1 bg-purple-700 hover:bg-purple-600 rounded px-3 py-1.5 text-sm font-semibold"
              onClick={() => { onPlaceZone(buildSpec(), duration); onClose(); }}
            >
              Place Zone (unit's hex)
            </button>
          )}
          <button className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600" onClick={onClose}>Cancel</button>
        </div>

        {activeEffects.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Active on unit</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {activeEffects.map(e => (
                <div key={e.key} className="flex items-center justify-between bg-gray-800 rounded px-2 py-1 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: e.color }} />
                    {e.name}
                    <span className="text-gray-400 text-xs">{e.kind === 'dot' ? `${e.delta}/tick` : `${e.delta > 0 ? '+' : ''}${e.delta}`} · {e.turnsLeft} turn{e.turnsLeft === 1 ? '' : 's'}</span>
                  </span>
                  <button className="text-red-400 hover:text-red-300 text-xs" onClick={() => onRemove(e.key)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
