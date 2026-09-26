'use client';
// src/components/StructureEditor/StructureEditor.tsx
// Map Structure Editor (arranged like the Effect Editor): author reusable map
// features — walls, stakes, gates, towers. A template is an anchor (edge or hex),
// direction-relative movement (mp foot/mounted in/out; negative = hard block),
// an optional battlement/stakes decoration, two durability pools (door gates
// passage, HP gates modifiers), a Damage Threshold and a mode-scoped modifier list.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ImagePickerModal } from '@/components/ImagePickerModal';
import { EffectModifierFields } from '@/components/EffectEditor/EffectModifierFields';
import { StructurePreview } from '@/components/StructureEditor/StructurePreview';
import { StructureTemplate, StructureAnchor } from '@/types/structure';
import { EffectModifier, modifierAmount } from '@/lib/effectTemplates';
import {
  mapStructureRow, mapStructureToRow, blankStructureTemplate, sanitizeStructureTemplate,
} from '@/lib/structureTemplates';

type Draft = Omit<StructureTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

const input =
  'w-full bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none disabled:opacity-50';

/** Integer field allowing negatives (movement: negative = hard block). Blank = null. */
function MoveInput({ value, onChange, readOnly, placeholder = '—' }: {
  value: number | null;
  onChange: (v: number | null) => void;
  readOnly: boolean;
  placeholder?: string;
}) {
  return (
    <input
      className={input + ' !w-16'}
      type="number"
      value={value === null ? '' : String(value)}
      placeholder={placeholder}
      disabled={readOnly}
      onChange={e => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        const n = Math.round(Number(raw));
        onChange(Number.isFinite(n) ? Math.max(-1, Math.min(99, n)) : null);
      }}
    />
  );
}

/** Nullable non-negative integer field (door HP). Blank = null (no explicit door). */
function NumInput({ value, onChange, readOnly, max = 999, placeholder = '—' }: {
  value: number | null;
  onChange: (v: number | null) => void;
  readOnly: boolean;
  max?: number;
  placeholder?: string;
}) {
  return (
    <input
      className={input + ' !w-20'}
      type="number"
      min={0}
      max={max}
      value={value === null ? '' : String(value)}
      placeholder={placeholder}
      disabled={readOnly}
      onChange={e => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        const n = Math.round(Number(raw));
        onChange(Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : null);
      }}
    />
  );
}

function coverAc(mods: EffectModifier[]): { melee: number; ranged: number } {
  let melee = 0;
  let ranged = 0;
  for (const m of mods) {
    if (m.kind !== 'ac') continue;
    const d = modifierAmount(m.dice);
    if (m.mode === 'melee') melee += d;
    else if (m.mode === 'ranged') ranged += d;
    else { melee += d; ranged += d; }
  }
  return { melee, ranged };
}

export default function StructureEditor({ readOnly }: { readOnly: boolean }) {
  const [list, setList] = useState<StructureTemplate[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [showImagePicker, setShowImagePicker] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('map_structure_templates').select('*').order('name', { ascending: true });
    if (data) setList((data as any[]).map(mapStructureRow));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = (p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d));
  const select = (t: StructureTemplate) => setDraft({ ...t, id: t.id });
  const fresh = () => setDraft({ ...blankStructureTemplate() });
  const clone = () => {
    if (!draft) return;
    const { id, ...rest } = draft;
    setDraft({ ...rest, name: `${draft.name} copy` });
  };

  const save = async () => {
    if (!draft || !draft.name.trim()) { setStatus('Give the structure a name.'); return; }
    setBusy(true);
    setStatus('');
    try {
      const row = mapStructureToRow(sanitizeStructureTemplate(draft));
      let id = draft.id;
      if (id) {
        await supabase.from('map_structure_templates').update(row).eq('id', id);
      } else {
        const { data, error } = await supabase.from('map_structure_templates').insert(row).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      setStatus('Saved.');
      await load();
      if (id) {
        const { data } = await supabase.from('map_structure_templates').select('*').eq('id', id).single();
        if (data) select(mapStructureRow(data));
      }
    } catch (err: any) {
      setStatus('Save failed: ' + (err?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || readOnly) return;
    if (!confirm(`Delete structure "${draft.name}"?`)) return;
    setBusy(true);
    try {
      await supabase.from('map_structure_templates').delete().eq('id', draft.id);
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
    patch({ modifiers: draft.modifiers.map((m, idx) => (idx === i ? { ...m, ...p } : m)) });
  };

  const cover = draft ? coverAc(draft.modifiers) : { melee: 0, ranged: 0 };

  const summary = useMemo(
    () =>
      draft
        ? draft.modifiers.map(m => `${m.kind}${m.mode ? ` (${m.mode})` : ''}: ${m.dice ?? ''}`.trim()).join(' · ') || '(no modifiers)'
        : '',
    [draft],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? list.filter(t => t.name.toLowerCase().includes(q)) : list;
  }, [list, search]);

  return (
    <div className="flex flex-col w-full h-screen bg-[#0d0d1a] text-white overflow-hidden select-none">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900">
        <h1 className="text-xl font-bold text-yellow-300">Map Structure Editor</h1>
        {readOnly && <span className="text-xs bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-gray-300">Read-only view</span>}
        <a href="/" className="text-sm bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded">Main Menu</a>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* LEFT — template selector */}
        <div className="w-56 lg:w-64 shrink-0 border-r border-gray-700 p-2 space-y-1 overflow-y-auto">
          {!readOnly && (
            <button onClick={fresh} className="w-full py-1.5 rounded bg-emerald-800 hover:bg-emerald-700 text-sm mb-2">
              New Structure
            </button>
          )}
          <input
            className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none mb-2"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {filtered.length === 0 && <p className="text-xs text-gray-500">No structures yet.</p>}
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => select(t)}
              className={`w-full text-left text-xs px-2 py-1.5 rounded border ${draft?.id === t.id ? 'bg-yellow-700/40 border-yellow-500' : 'bg-gray-800 border-transparent hover:bg-gray-700'}`}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: t.color }} />
              {t.name}
              <span className="block text-[10px] text-gray-400">
                {t.anchor}{t.battlement ? ' · battlement' : ''}{t.spikes ? ' · stakes' : ''} · {t.maxHp}hp
              </span>
            </button>
          ))}
        </div>

        {/* MIDDLE — editor */}
        <div className="flex-1 min-w-0 p-4 overflow-y-auto">
          {!draft ? (
            <p className="text-gray-500 text-sm">Select a structure from the list (or create one) to edit it.</p>
          ) : (
            <fieldset disabled={readOnly} className="space-y-3 w-full max-w-3xl">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-xs text-gray-400 flex-1 min-w-[12rem]">Name
                  <input className={input} value={draft.name} disabled={readOnly} onChange={e => patch({ name: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">Anchor
                  <select className={input + ' !w-32'} value={draft.anchor} disabled={readOnly} onChange={e => patch({ anchor: e.target.value as StructureAnchor })}>
                    <option value="edge">Edge</option>
                    <option value="hex">Hex</option>
                  </select>
                </label>
              </div>

              <label className="block text-xs text-gray-400">Description
                <textarea className={input} rows={2} value={draft.description} disabled={readOnly} onChange={e => patch({ description: e.target.value })} />
              </label>

              <div className="flex flex-wrap items-start gap-4">
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
                    <button type="button" disabled={readOnly} className="px-2 py-1.5 rounded text-xs bg-red-900/60 hover:bg-red-800 disabled:opacity-50" onClick={() => patch({ imageUrl: '' })}>
                      Clear
                    </button>
                  )}
                  <label className="flex items-center gap-1 text-xs text-gray-400">Tint
                    <input type="color" disabled={readOnly} value={draft.color} onChange={e => patch({ color: e.target.value })} className="h-7 w-10 rounded border border-gray-600 bg-transparent" />
                  </label>
                </div>
              </div>

              {draft.anchor === 'edge' ? (
                <>
                  <label className="flex items-center gap-2 text-[11px] text-gray-300">
                    <input type="checkbox" disabled={readOnly} checked={draft.battlement} onChange={e => patch({ battlement: e.target.checked })} className="h-3.5 w-3.5 accent-amber-400" />
                    Draw a battlement (crenellation) on the outside face
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-gray-300">
                    <input type="checkbox" disabled={readOnly} checked={draft.spikes} onChange={e => patch({ spikes: e.target.checked })} className="h-3.5 w-3.5 accent-amber-400" />
                    Draw small stakes (triangles) facing outward (e.g. archer's stakes)
                  </label>
                  <div className="rounded border border-gray-700 p-2 space-y-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Movement (MP to cross; blank = terrain; negative = block)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                      <div className="space-y-1">
                        <p className="text-gray-400">Into inside (outside → inside)</p>
                        <label className="flex items-center gap-1">Foot
                          <MoveInput value={draft.mpFootIn} readOnly={readOnly} onChange={v => patch({ mpFootIn: v })} />
                        </label>
                        <label className="flex items-center gap-1">Mounted
                          <MoveInput value={draft.mpMountedIn} readOnly={readOnly} onChange={v => patch({ mpMountedIn: v })} />
                        </label>
                      </div>
                      <div className="space-y-1">
                        <p className="text-gray-400">Into outside (inside → outside)</p>
                        <label className="flex items-center gap-1">Foot
                          <MoveInput value={draft.mpFootOut} readOnly={readOnly} onChange={v => patch({ mpFootOut: v })} />
                        </label>
                        <label className="flex items-center gap-1">Mounted
                          <MoveInput value={draft.mpMountedOut} readOnly={readOnly} onChange={v => patch({ mpMountedOut: v })} />
                        </label>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded border border-gray-700 p-2 space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Hex entry MP (blank = terrain; negative = block)</p>
                  <div className="flex flex-wrap items-center gap-3 text-[11px]">
                    <label className="flex items-center gap-1">Foot
                      <MoveInput value={draft.mpFootIn} readOnly={readOnly} onChange={v => patch({ mpFootIn: v })} />
                    </label>
                    <label className="flex items-center gap-1">Mounted
                      <MoveInput value={draft.mpMountedIn} readOnly={readOnly} onChange={v => patch({ mpMountedIn: v })} />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-gray-300">
                    <input type="checkbox" disabled={readOnly} checked={draft.hexBorder} onChange={e => patch({ hexBorder: e.target.checked })} className="h-3.5 w-3.5 accent-amber-400" />
                    Draw the thick hex outline (off for decorative hexes)
                  </label>
                </div>
              )}

              <div className="rounded border border-gray-700 p-2 space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Durability</p>
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <label className="flex items-center gap-1">Max HP
                    <NumInput value={draft.maxHp} readOnly={readOnly} onChange={v => patch({ maxHp: v ?? 0 })} max={9999} />
                  </label>
                  <label className="flex items-center gap-1">DT
                    <NumInput value={draft.dt} readOnly={readOnly} onChange={v => patch({ dt: v ?? 0 })} max={999} />
                  </label>
                  <label className="flex items-center gap-1">Door HP
                    <NumInput value={draft.doorHp} readOnly={readOnly} onChange={v => patch({ doorHp: v })} max={9999} placeholder="= max HP" />
                  </label>
                </div>
                <p className="text-[10px] text-gray-500">
                  Door gates passage (0 = passable), HP gates modifiers (0 = destroyed). Damage hits both.
                  Blank door defaults to max HP (no free passage).
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-1">Effect modifiers (cover AC, attack-roll flags, tower auras, `enter_org_max` gate)</p>
                <div className="space-y-1.5">
                  {draft.modifiers.map((m, i) => (
                    <EffectModifierFields
                      key={i}
                      modifier={m}
                      readOnly={readOnly}
                      inputClass={input}
                      onChange={next => patchMod(i, next)}
                      onRemove={() => patch({ modifiers: draft.modifiers.filter((_, idx) => idx !== i) })}
                    />
                  ))}
                </div>
                {!readOnly && (
                  <button
                    className="mt-2 px-3 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600"
                    onClick={() => patch({ modifiers: [...draft.modifiers, { kind: 'ac', dice: '1', mode: 'melee' }] })}
                  >
                    + Add modifier
                  </button>
                )}
              </div>

              {!readOnly && (
                <div className="flex gap-2 sticky bottom-0 bg-[#0d0d1a]/95 py-2 border-t border-gray-800">
                  <button onClick={() => void save()} disabled={busy} className="px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-sm disabled:opacity-50">
                    {draft.id ? 'Save' : 'Create'}
                  </button>
                  <button onClick={clone} disabled={busy} className="px-4 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm disabled:opacity-50">
                    Clone
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

        {/* RIGHT — preview */}
        <div className="w-64 lg:w-80 shrink-0 border-l border-gray-700 p-4 space-y-3 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Preview</p>
          {!draft ? (
            <p className="text-xs text-gray-500">Nothing selected.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{draft.name || '(unnamed)'}</span>
              </div>
              <StructurePreview
                anchor={draft.anchor}
                imageUrl={draft.imageUrl}
                battlement={draft.battlement}
                spikes={draft.spikes}
                hexBorder={draft.hexBorder}
                mpFootIn={draft.mpFootIn}
                mpFootOut={draft.mpFootOut}
                mpMountedIn={draft.mpMountedIn}
                mpMountedOut={draft.mpMountedOut}
                coverMelee={cover.melee}
                coverRanged={cover.ranged}
                doorHp={draft.doorHp}
                maxHp={draft.maxHp}
                dt={draft.dt}
              />
              <p className="text-xs text-gray-300">{summary}</p>
              <p className="text-[11px] text-gray-500">{draft.description}</p>
            </>
          )}
        </div>
      </div>

      {showImagePicker && draft && (
        <ImagePickerModal
          current={draft.imageUrl}
          uploadKey="structure"
          bucket="structure_images"
          title="Select Structure Image"
          showRaces={false}
          onSelect={url => { patch({ imageUrl: url ?? '' }); setShowImagePicker(false); }}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  );
}
