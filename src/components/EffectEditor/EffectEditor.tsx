'use client';
// src/components/EffectEditor/EffectEditor.tsx
// Effects Library editor (3 panels like Unit Editor). Author reusable effect
// templates — a name/color/image plus a list of modifiers (ac/morale/movement/
// dot/hp_borrow/entry/mp_cost) — that any scenario can apply.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  EffectTemplate, EffectModifier, EffectModifierKind, EffectScope, MagnitudeMode,
  mapEffectRow, mapEffectToRow, blankEffectTemplate, parseDice,
} from '@/lib/effectTemplates';

const KIND_OPTIONS: { value: EffectModifierKind; label: string }[] = [
  { value: 'ac', label: 'AC ±' },
  { value: 'morale', label: 'Morale ±' },
  { value: 'movement', label: 'Movement ±' },
  { value: 'dot', label: 'DoT / heal per tick' },
  { value: 'hp_borrow', label: 'Borrow HP (sleep)' },
  { value: 'entry', label: 'Zone: damage on entry' },
  { value: 'mp_cost', label: 'Zone: hex MP cost' },
];

type Draft = Omit<EffectTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

const input =
  'w-full bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none disabled:opacity-50';

export default function EffectEditor({ readOnly }: { readOnly: boolean }) {
  const [list, setList] = useState<EffectTemplate[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('effect_templates').select('*').order('name', { ascending: true });
    if (data) setList((data as any[]).map(mapEffectRow));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = (t: EffectTemplate) => setDraft({ ...t, id: t.id });
  const fresh = () => setDraft({ ...blankEffectTemplate() });

  const save = async () => {
    if (!draft || !draft.name.trim()) { setStatus('Give the effect a name.'); return; }
    setBusy(true);
    setStatus('');
    try {
      const row = mapEffectToRow(draft);
      let id = draft.id;
      if (id) {
        await supabase.from('effect_templates').update(row).eq('id', id);
      } else {
        const { data, error } = await supabase.from('effect_templates').insert(row).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      setStatus('Saved.');
      await load();
      if (id) {
        const found = list.find(t => t.id === id);
        if (found) select(found);
        else {
          const { data } = await supabase.from('effect_templates').select('*').eq('id', id).single();
          if (data) select(mapEffectRow(data));
        }
      }
    } catch (err: any) {
      setStatus('Save failed: ' + (err?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || readOnly) return;
    if (!confirm(`Delete effect "${draft.name}"?`)) return;
    setBusy(true);
    try {
      await supabase.from('effect_templates').delete().eq('id', draft.id);
      setDraft(null);
      setStatus('Deleted.');
      await load();
    } catch (err: any) {
      setStatus('Delete failed: ' + (err?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const patchMod = (i: number, p: Partial<EffectModifier>) => {
    if (!draft) return;
    setDraft({ ...draft, modifiers: draft.modifiers.map((m, idx) => (idx === i ? { ...m, ...p } : m)) });
  };

  // One "amount" field: a plain number or dice ("2d6+2"; X=0 => flat Z). The
  // flat part is mirrored into `delta` for stat kinds / legacy consumers.
  const patchAmount = (i: number, raw: string) => {
    const text = raw.trim();
    const parsed = parseDice(text);
    patchMod(i, { dice: text || undefined, delta: parsed ? parsed.bonus : 0 });
  };

  const summary = useMemo(
    () =>
      draft
        ? draft.modifiers.map(m => `${m.kind}: ${m.dice ?? (m.delta > 0 ? `+${m.delta}` : m.delta)}`).join(' · ') || '(no modifiers)'
        : '',
    [draft],
  );

  const activeSel = !!draft;

  return (
    <div className="flex flex-col w-full h-screen bg-[#0d0d1a] text-white overflow-hidden select-none">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900">
        <h1 className="text-xl font-bold text-yellow-300">Effects Library</h1>
        {readOnly && <span className="text-xs bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-gray-300">Read-only view</span>}
        <a href="/" className="text-sm bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded">Main Menu</a>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* LEFT — template selector */}
        <div className="w-52 lg:w-64 shrink-0 border-r border-gray-700 p-2 space-y-1 overflow-y-auto">
          {!readOnly && (
            <button onClick={fresh} className="w-full py-1.5 rounded bg-emerald-800 hover:bg-emerald-700 text-sm mb-2">
              New Effect
            </button>
          )}
          {list.length === 0 && <p className="text-xs text-gray-500">No effects yet.</p>}
          {list.map(t => (
            <button
              key={t.id}
              onClick={() => select(t)}
              className={`w-full text-left text-xs px-2 py-1.5 rounded border ${draft?.id === t.id ? 'bg-yellow-700/40 border-yellow-500' : 'bg-gray-800 border-transparent hover:bg-gray-700'}`}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: t.color }} />
              {t.name}
              <span className="block text-[10px] text-gray-400">
                {t.scope} · {t.modifiers.map(m => m.kind).join('+') || '—'}
              </span>
            </button>
          ))}
        </div>

        {/* MIDDLE — editor */}
        <div className="flex-1 min-w-0 p-4 overflow-y-auto">
          {!draft ? (
            <p className="text-gray-500 text-sm">Select an effect from the list (or create one) to edit it.</p>
          ) : (
            <fieldset disabled={readOnly} className="space-y-3 w-full max-w-full">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <label className="text-xs text-gray-400">Name
                  <input className={input} value={draft.name} disabled={readOnly} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">Color
                  <input className={input} type="text" value={draft.color} disabled={readOnly} onChange={e => setDraft({ ...draft, color: e.target.value })} placeholder="#rrggbb" />
                </label>
              </div>
              <label className="block text-xs text-gray-400">Image URL (optional — rendered on the map as the effect image)
                <input className={input} value={draft.imageUrl} disabled={readOnly} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} />
              </label>
              <label className="block text-xs text-gray-400">Description
                <textarea className={input} rows={2} value={draft.description} disabled={readOnly} onChange={e => setDraft({ ...draft, description: e.target.value })} />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-xs text-gray-400">Scope
                  <select className={input} value={draft.scope} disabled={readOnly} onChange={e => setDraft({ ...draft, scope: e.target.value as EffectScope })}>
                    <option value="unit">Unit</option>
                    <option value="zone">Zone (area)</option>
                    <option value="both">Unit + Zone</option>
                  </select>
                </label>
                <label className="text-xs text-gray-400">Magnitude
                  <select className={input} value={draft.magnitudeMode} disabled={readOnly} onChange={e => setDraft({ ...draft, magnitudeMode: e.target.value as MagnitudeMode })}>
                    <option value="fixed">Fixed</option>
                    <option value="caster_input">Caster chooses (X)</option>
                  </select>
                </label>
                <label className="text-xs text-gray-400">Duration (caster activations)
                  <input className={input} type="number" min={1} max={50} value={draft.defaultDuration} disabled={readOnly} onChange={e => setDraft({ ...draft, defaultDuration: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                </label>
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-1">Modifiers (combine freely — e.g. Haunted = AC −2 + Morale −1)</p>
                <div className="space-y-1.5">
                  {draft.modifiers.map((m, i) => (
                    <div key={i} className="rounded border border-gray-800 p-1.5 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <select className={input + ' !w-48 min-w-0'} value={m.kind} disabled={readOnly} onChange={e => patchMod(i, { kind: e.target.value as EffectModifierKind })}>
                          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input
                          className={input + ' flex-1 min-w-[8rem]'} type="text"
                          value={m.dice ?? ''}
                          disabled={readOnly}
                          onChange={e => patchAmount(i, e.target.value)}
                          placeholder="amount — 4 or 2d6+2"
                          title="Amount: a plain number (flat) or dice XdY±Z (X=0 = flat Z). Used for both stats and damage."
                        />
                        <label className="flex items-center gap-1 text-[11px] text-gray-300 whitespace-nowrap">
                          <input type="checkbox" disabled={readOnly} checked={!!m.healing} onChange={e => patchMod(i, { healing: e.target.checked })} />
                          heal
                        </label>
                        {!readOnly && (
                          <button
                            className="px-2 py-1 rounded text-xs bg-red-900/60 hover:bg-red-800 text-red-100"
                            onClick={() => setDraft({ ...draft, modifiers: draft.modifiers.filter((_, idx) => idx !== i) })}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-400">
                        <span>Save:</span>
                        <select
                          className={input + ' !w-24'}
                          value={m.savingThrow ?? ''}
                          disabled={readOnly}
                          onChange={e => patchMod(i, { savingThrow: (e.target.value || null) as EffectModifier['savingThrow'] })}
                        >
                          <option value="">none</option>
                          {['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <span>DC</span>
                        <input
                          className={input + ' !w-20'} type="number"
                          value={m.saveDC ?? ''}
                          disabled={readOnly || !m.savingThrow}
                          onChange={e => patchMod(i, { saveDC: e.target.value === '' ? null : Number(e.target.value) })}
                          title="d20 + save bonus ≥ DC passes. Very high DC = auto-fail (full damage)."
                        />
                        <label className="flex items-center gap-1 whitespace-nowrap" title="Passing the save halves damage; unchecked = negates (0).">
                          <input type="checkbox" disabled={readOnly || !m.savingThrow} checked={m.onSaveHalfOrNeg !== false} onChange={e => patchMod(i, { onSaveHalfOrNeg: e.target.checked })} />
                          half on save
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                {!readOnly && (
                  <button
                    className="mt-2 px-3 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600"
                    onClick={() => setDraft({ ...draft, modifiers: [...draft.modifiers, { kind: 'ac', delta: 1, dice: '1' }] })}
                  >
                    + Add modifier
                  </button>
                )}
              </div>

              {!readOnly && (
                <div className="flex gap-2 sticky bottom-0 bg-[#0d0d1a]/95 py-2 border-t border-gray-800">
                  <button onClick={() => void save()} disabled={busy || !activeSel} className="px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-sm disabled:opacity-50">
                    {draft.id ? 'Save' : 'Create'}
                  </button>
                  {draft.id && (
                    <button onClick={() => void remove()} disabled={busy} className="px-4 py-1.5 rounded bg-red-900 hover:bg-red-800 text-sm disabled:opacity-50">
                      Delete
                    </button>
                  )}
                </div>
              )}
              {status && <p className="text-xs text-amber-300">{status}</p>}
            </fieldset>
          )}
        </div>

        {/* RIGHT — preview summary */}
        <div className="w-56 lg:w-80 shrink-0 border-l border-gray-700 p-4 space-y-3 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Preview</p>
          {!draft ? (
            <p className="text-xs text-gray-500">Nothing selected.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded border border-gray-600" style={{ backgroundColor: draft.color || '#cccccc' }} />
                <span className="text-sm font-semibold">{draft.name || '(unnamed)'}</span>
              </div>
              {draft.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.imageUrl} alt="" className="max-h-28 rounded border border-gray-700 object-contain bg-gray-900" />
              )}
              <p className="text-xs text-gray-300">{summary}</p>
              <p className="text-[11px] text-gray-500">{draft.description}</p>
              <p className="text-[11px] text-gray-500">
                Scope: {draft.scope} · Magnitude: {draft.magnitudeMode} · Duration: {draft.defaultDuration}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
