// src/components/ScenarioMap/AddEffectModal.tsx
// 'use client' — the "Effects…" dialog opened from a unit's context menu.
// Lists the effect library (effect_templates: composites, Sleep, zones), applies
// the chosen template to the unit or drops it as a ground zone on the unit's hex,
// edits/removes the unit's active effects, and edits/clones/drops the ground zones
// already on its hex.
'use client';
import React, { useEffect, useState } from 'react';
import { Unit, UnitEffect, GroundEffect } from '@/types/gameProtocol';
import { supabase } from '@/lib/supabaseClient';
import { EffectTemplate, mapEffectRow, modifierSummary } from '@/lib/effectTemplates';
import { EffectFormValue } from './EffectFormModal';

interface AddEffectModalProps {
  unit: Unit;
  /** Team whose activations count the duration; null = every END_TURN. */
  teamOptions: string[];
  canPlaceZone: boolean;
  /** Apply the assembled form to the unit. */
  onApplyForm: (form: EffectFormValue) => void;
  onRemove: (key: string) => void;
  /** Place the assembled form as a zone on the unit's hex. */
  onPlaceZoneForm: (form: EffectFormValue) => void;
  /** Edit this unit's own effect (opens the shared instance form). */
  onEditEffect?: (effect: UnitEffect) => void;
  /** Ground zones on the unit's hex, with edit/clone/drop. */
  zones?: GroundEffect[];
  onEditZone?: (zone: GroundEffect) => void;
  onCloneZone?: (zone: GroundEffect) => void;
  onDropZone?: (zone: GroundEffect) => void;
  onClose: () => void;
}

export function AddEffectModal({
  unit, teamOptions, canPlaceZone, onApplyForm, onRemove, onPlaceZoneForm,
  onEditEffect, zones = [], onEditZone, onCloneZone, onDropZone, onClose,
}: AddEffectModalProps) {
  const [templates, setTemplates] = useState<EffectTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [duration, setDuration] = useState(3);
  const [tempo, setTempo] = useState<string>(unit.team || (teamOptions[0] ?? ''));
  const [borrowAmount, setBorrowAmount] = useState(0);
  const activeEffects = (unit.effects ?? []).filter(e => !e.zoneHex);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('effect_templates')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        const list = (data as any[]).map(mapEffectRow);
        setTemplates(list);
        setTemplateId(prev => prev || list[0]?.id || '');
      });
    return () => { cancelled = true; };
  }, []);

  const template = templates.find(t => t.id === templateId) ?? templates[0];
  const hasBorrow = !!template?.modifiers.some(m => m.kind === 'hp_borrow');

  useEffect(() => {
    if (template) setDuration(Math.max(1, template.defaultDuration));
  }, [template?.id]);

  const buildForm = (): EffectFormValue => ({
    name: template?.name ?? '',
    color: template?.color ?? '#cccccc',
    imageUrl: template?.imageUrl ?? '',
    imageScale: template?.imageScale ?? 100,
    layer: template?.layer ?? 'below',
    duration: Math.max(1, duration),
    casterTeam: tempo === 'every-turn' ? '' : tempo,
    modifiers: (template?.modifiers ?? []).map(m =>
      m.kind === 'hp_borrow' && borrowAmount > 0 ? { ...m, delta: borrowAmount } : m,
    ),
  });

  return (
    <div className="absolute inset-0 z-[70] bg-black/50 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-5 w-[460px] text-white space-y-3" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-yellow-300">Effects — {unit.unitName}</p>
          <button className="text-gray-400 hover:text-white" onClick={onClose}>✕</button>
        </div>

        {templates.length === 0 ? (
          <p className="text-xs text-gray-400">No effects in the library yet. Author some in the Effect Editor.</p>
        ) : (
          <>
            <div>
              <p className="text-xs text-gray-400 mb-1">Effect</p>
              <select
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
                value={template?.id ?? ''}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name} — {t.description}</option>
                ))}
              </select>
              {template && (
                <p className="text-[11px] text-gray-500 mt-1">
                  {template.scope} · {template.modifiers.map(modifierSummary).join(', ') || '—'}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-400">Duration (turns)
                <input
                  type="number" min={1} max={20}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
                  value={duration}
                  onChange={(e) => setDuration(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                />
              </label>
              {hasBorrow && (
                <label className="text-xs text-gray-400">Borrow HP now
                  <input
                    type="number" min={1}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
                    value={borrowAmount}
                    onChange={(e) => setBorrowAmount(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
                  />
                </label>
              )}
            </div>

            <label className="block text-xs text-gray-400">Count on the turn of…
              <select className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm mt-1" value={tempo} onChange={(e) => setTempo(e.target.value)}>
                <option value="every-turn">Every alliance activation (DM)</option>
                {teamOptions.map(t => <option key={t} value={t}>{t} team</option>)}
              </select>
            </label>

            <div className="flex gap-2 pt-1">
              <button
                className="flex-1 bg-yellow-600 hover:bg-yellow-500 rounded px-3 py-1.5 text-sm font-semibold"
                onClick={() => { onApplyForm(buildForm()); onClose(); }}
              >
                Apply to Unit
              </button>
              {canPlaceZone && (
                <button
                  className="flex-1 bg-purple-700 hover:bg-purple-600 rounded px-3 py-1.5 text-sm font-semibold"
                  onClick={() => { onPlaceZoneForm(buildForm()); onClose(); }}
                >
                  Place Zone (unit's hex)
                </button>
              )}
              <button className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {activeEffects.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Active on unit</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {activeEffects.map(e => (
                <div key={e.key} className="flex items-center justify-between bg-gray-800 rounded px-2 py-1 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: e.color }} />
                    {e.name}
                    <span className="text-gray-400 text-xs">{e.dice ?? (e.kind === 'dot' ? `${e.delta}/tick` : `${e.delta > 0 ? '+' : ''}${e.delta}`)} · {e.turnsLeft} turn{e.turnsLeft === 1 ? '' : 's'}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {onEditEffect && (
                      <button className="text-yellow-300 hover:text-yellow-200 text-xs" onClick={() => { onEditEffect(e); onClose(); }}>Edit</button>
                    )}
                    <button className="text-red-400 hover:text-red-300 text-xs" onClick={() => onRemove(e.key)}>✕</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {zones.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Ground effects on this hex</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {zones.map(z => (
                <div key={z.key} className="flex items-center justify-between bg-gray-800 rounded px-2 py-1 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: z.color }} />
                    {z.name}
                    <span className="text-gray-400 text-xs">{z.dice ?? z.delta}{z.healing ? ' heal' : ''} · {z.turnsLeft} turn{z.turnsLeft === 1 ? '' : 's'}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {onEditZone && <button className="text-yellow-300 hover:text-yellow-200 text-xs" onClick={() => { onEditZone(z); onClose(); }}>Edit</button>}
                    {onCloneZone && <button className="text-cyan-300 hover:text-cyan-200 text-xs" onClick={() => { onCloneZone(z); onClose(); }}>Clone</button>}
                    {onDropZone && <button className="text-red-400 hover:text-red-300 text-xs" onClick={() => onDropZone(z)}>✕</button>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
