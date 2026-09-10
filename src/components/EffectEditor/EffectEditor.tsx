'use client';
// src/components/EffectEditor/EffectEditor.tsx
// Effect Editor (3 panels like Unit Editor). Author reusable effect templates —
// a name/color/image/layer plus a list of modifiers (ac/morale/movement/dot/
// hp_borrow/entry/mp_cost) — that any scenario can apply.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ImagePickerModal } from '@/components/ImagePickerModal';
import { ColorField } from '@/components/ColorField';
import { EffectModifierFields } from '@/components/EffectEditor/EffectModifierFields';
import { EffectHexPreview } from '@/components/EffectEditor/EffectHexPreview';
import {
  EffectTemplate, EffectModifier, EffectLayer, EffectScope,
  mapEffectRow, mapEffectToRow, blankEffectTemplate,
} from '@/lib/effectTemplates';

type Draft = Omit<EffectTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

const input =
  'w-full bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none disabled:opacity-50';

export default function EffectEditor({ readOnly }: { readOnly: boolean }) {
  const [list, setList] = useState<EffectTemplate[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [showImagePicker, setShowImagePicker] = useState(false);

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
        <h1 className="text-xl font-bold text-yellow-300">Effect Editor</h1>
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
              <label className="block text-xs text-gray-400">Name
                <input className={input} value={draft.name} disabled={readOnly} onChange={e => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <div>
                <p className="text-xs text-gray-400 mb-1">Color</p>
                <ColorField value={draft.color} readOnly={readOnly} onChange={color => setDraft({ ...draft, color })} />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-2">
                  {draft.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.imageUrl} alt="" className="w-12 h-12 rounded border border-gray-700 object-contain bg-gray-900" />
                  ) : (
                    <span className="w-12 h-12 rounded border border-dashed border-gray-600 grid place-items-center text-[10px] text-gray-500">none</span>
                  )}
                  <button type="button" disabled={readOnly} className="px-3 py-1.5 rounded text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50" onClick={() => setShowImagePicker(true)}>
                    {draft.imageUrl ? 'Change image' : 'Select image'}
                  </button>
                  {draft.imageUrl && (
                    <button type="button" disabled={readOnly} className="px-2 py-1.5 rounded text-xs bg-red-900/60 hover:bg-red-800 disabled:opacity-50" onClick={() => setDraft({ ...draft, imageUrl: '' })}>
                      Clear
                    </button>
                  )}
                </div>
                <label className="text-xs text-gray-400">Layer
                  <select className={input + ' !w-36'} value={draft.layer} disabled={readOnly} onChange={e => setDraft({ ...draft, layer: e.target.value as EffectLayer })}>
                    <option value="below">Below unit</option>
                    <option value="above">Above unit</option>
                  </select>
                </label>
              </div>
              <label className="block text-xs text-gray-400">Image size — {draft.imageScale}%
                <input
                  type="range" min={10} max={300} step={5}
                  value={draft.imageScale}
                  disabled={readOnly || !draft.imageUrl}
                  onChange={e => setDraft({ ...draft, imageScale: Math.max(10, Math.min(300, parseInt(e.target.value) || 100)) })}
                  className="w-full accent-amber-400 disabled:opacity-40"
                />
              </label>
              <label className="block text-xs text-gray-400">Description
                <textarea className={input} rows={2} value={draft.description} disabled={readOnly} onChange={e => setDraft({ ...draft, description: e.target.value })} />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs text-gray-400">Scope
                  <select className={input} value={draft.scope} disabled={readOnly} onChange={e => setDraft({ ...draft, scope: e.target.value as EffectScope })}>
                    <option value="unit">Unit</option>
                    <option value="zone">Zone (area)</option>
                    <option value="both">Unit + Zone</option>
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
                    <EffectModifierFields
                      key={i}
                      modifier={m}
                      readOnly={readOnly}
                      inputClass={input}
                      onChange={next => patchMod(i, next)}
                      onRemove={() => setDraft({ ...draft, modifiers: draft.modifiers.filter((_, idx) => idx !== i) })}
                    />
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
                <img src={draft.imageUrl} alt="" className="max-h-24 rounded border border-gray-700 object-contain bg-gray-900" />
              )}
              <p className="text-[10px] uppercase tracking-wide text-gray-500">On the map</p>
              <EffectHexPreview imageUrl={draft.imageUrl} imageScale={draft.imageScale} color={draft.color} layer={draft.layer} />
              <p className="text-xs text-gray-300">{summary}</p>
              <p className="text-[11px] text-gray-500">{draft.description}</p>
              <p className="text-[11px] text-gray-500">
                Scope: {draft.scope} · Layer: {draft.layer} · Duration: {draft.defaultDuration}
              </p>
            </>
          )}
        </div>
      </div>

      {showImagePicker && draft && (
        <ImagePickerModal
          current={draft.imageUrl}
          uploadKey="effect"
          bucket="effect_images"
          title="Select Effect Image"
          showRaces={false}
          onSelect={url => { setDraft({ ...draft, imageUrl: url ?? '' }); setShowImagePicker(false); }}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  );
}
