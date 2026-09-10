'use client';
// src/components/WeaponEditor/WeaponEditor.tsx
// Weapon Editor — author the reusable weapons library (2 panels: list + form).
// The form body is the same `WeaponFields` the Add/Edit Weapon modal uses.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { blankWeapon, validateWeapon } from '@/lib/weaponParser';
import { LibraryWeapon, mapWeaponRow, mapWeaponToRow } from '@/lib/weaponMappers';
import { WeaponFields } from '@/components/WeaponEditor/WeaponFields';

export default function WeaponEditor({ readOnly }: { readOnly: boolean }) {
  const [list, setList] = useState<LibraryWeapon[]>([]);
  const [draft, setDraft] = useState<LibraryWeapon | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('weapons').select('*').order('name', { ascending: true });
    if (data) setList(data.map(mapWeaponRow));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = (w: LibraryWeapon) => setDraft({ ...w });
  const fresh = () => setDraft({ ...blankWeapon(), id: '', notes: '', costGp: 0 });

  const save = async () => {
    if (!draft || readOnly) return;
    const err = validateWeapon(draft);
    if (err) { setStatus(err); return; }
    setBusy(true);
    setStatus('');
    try {
      const row = mapWeaponToRow(draft);
      if (draft.id) {
        const { error } = await supabase.from('weapons').update(row).eq('id', draft.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('weapons').insert(row).select('*').single();
        if (error) throw error;
        setDraft(mapWeaponRow(data));
      }
      setStatus('Saved.');
      await load();
    } catch (e: any) {
      setStatus('Save failed: ' + (e?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || readOnly) return;
    if (!confirm(`Delete weapon "${draft.name}"?`)) return;
    setBusy(true);
    try {
      await supabase.from('weapons').delete().eq('id', draft.id);
      setDraft(null);
      setStatus('Deleted.');
      await load();
    } catch (e: any) {
      setStatus('Delete failed: ' + (e?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? list.filter(w => w.name.toLowerCase().includes(q)) : list;
  }, [list, search]);

  return (
    <div className="flex flex-col w-full h-screen bg-[#0d0d1a] text-white overflow-hidden select-none">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900">
        <h1 className="text-xl font-bold text-yellow-300">Weapon Editor</h1>
        {readOnly && <span className="text-xs bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-gray-300">Read-only view</span>}
        <a href="/" className="text-sm bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded">Main Menu</a>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* LEFT — weapon list */}
        <div className="w-64 lg:w-72 shrink-0 border-r border-gray-700 p-2 space-y-1 overflow-y-auto">
          {!readOnly && (
            <button onClick={fresh} className="w-full py-1.5 rounded bg-emerald-800 hover:bg-emerald-700 text-sm mb-2">
              New Weapon
            </button>
          )}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search weapons…"
            className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-amber-400 outline-none mb-1"
          />
          {filtered.length === 0 && <p className="text-xs text-gray-500">No weapons yet.</p>}
          {filtered.map(w => (
            <button
              key={w.id}
              onClick={() => select(w)}
              className={`w-full text-left text-xs px-2 py-1.5 rounded border ${draft?.id === w.id ? 'bg-yellow-700/40 border-yellow-500' : 'bg-gray-800 border-transparent hover:bg-gray-700'}`}
            >
              {w.name || '(unnamed)'}
              <span className="block text-[10px] text-gray-400">
                {w.damageDice}{w.isHealing ? ' heal' : ''} · {w.range}hex{w.magicDimension > 0 ? ` · ${w.magicDimension}ft` : ''}
              </span>
            </button>
          ))}
        </div>

        {/* MIDDLE — form */}
        <div className="flex-1 min-w-0 p-4 overflow-y-auto">
          {!draft ? (
            <p className="text-gray-500 text-sm">Select a weapon from the list (or create one) to edit it.</p>
          ) : (
            <fieldset disabled={readOnly} className="space-y-3 w-full max-w-3xl">
              <WeaponFields
                value={draft}
                onChange={w => setDraft(prev => (prev ? { ...prev, ...w } : prev))}
                meta={{ notes: draft.notes, costGp: draft.costGp }}
                onMetaChange={m => setDraft(prev => (prev ? { ...prev, ...m } : prev))}
              />
              {!readOnly && (
                <div className="flex gap-2 sticky bottom-0 bg-[#0d0d1a]/95 py-2 border-t border-gray-800">
                  <button onClick={() => void save()} disabled={busy} className="px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-sm disabled:opacity-50">
                    {draft.id ? 'Save' : 'Create'}
                  </button>
                  {draft.id && (
                    <>
                      <button
                        onClick={() => setDraft({ ...draft, id: '', name: `${draft.name} (copy)` })}
                        disabled={busy}
                        className="px-4 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm disabled:opacity-50"
                      >
                        Clone
                      </button>
                      <button onClick={() => void remove()} disabled={busy} className="px-4 py-1.5 rounded bg-red-900 hover:bg-red-800 text-sm disabled:opacity-50">
                        Delete
                      </button>
                    </>
                  )}
                  {status && <span className="text-xs text-amber-300 self-center">{status}</span>}
                </div>
              )}
            </fieldset>
          )}
        </div>
      </div>
    </div>
  );
}
