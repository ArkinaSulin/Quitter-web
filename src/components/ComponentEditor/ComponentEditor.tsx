'use client';

// Component Workshop — one editor over the three ship catalogs:
//   Components (ship_components, built-in rows, edit-only)
//   Weapons    (ship_weapons)
//   Accessories(ship_accessories, mounts)
//
// The catalogs use UUID ids + a unique `name`; the current id strings are the
// display/name values after migration 137.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import {
  ShipAccessory,
  ShipCatalogKind,
  ShipComponent,
  ShipComponentTemplate,
  ShipWeapon,
} from '@/types/ship';
import {
  componentTemplateToAccessoryRow,
  componentTemplateToComponentRow,
  componentTemplateToWeaponRow,
  mapAccessoryToTemplate,
  mapComponentToTemplate,
  mapShipAccessoryRow,
  mapShipComponentRow,
  mapShipWeaponRow,
  mapWeaponToTemplate,
  validateShipComponentTemplate,
} from '@/packages/ships';
import { ComponentFields } from './ComponentFields';

const KIND_LABEL: Record<ShipCatalogKind, string> = {
  component: 'Components',
  weapon: 'Weapons',
  accessory: 'Accessories',
};

const KIND_SINGULAR: Record<ShipCatalogKind, string> = {
  component: 'Component',
  weapon: 'Weapon',
  accessory: 'Accessory',
};

function humanize(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function freshTemplate(kind: ShipCatalogKind): ShipComponentTemplate {
  return {
    id: '',
    kind,
    name: '',
    mass: 1,
    crew: kind === 'weapon' ? 1 : 0,
    hittable: true,
    cost: 0,
    effect: '',
    damage: kind === 'weapon' ? '1d6' : '',
    minRange: 0,
    range: 1,
    maxRange: 1,
    fireCycleStep: 1,
    special: '',
    ac: 10,
    imageUrl: '',
  };
}

export default function ComponentEditor({ readOnly }: { readOnly: boolean }) {
  const [rows, setRows] = useState<ShipComponentTemplate[]>([]);
  const [tab, setTab] = useState<ShipCatalogKind>('component');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<ShipComponentTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async (): Promise<ShipComponentTemplate[]> => {
    const [componentsRes, weaponsRes, accessoriesRes] = await Promise.all([
      supabase.from('ship_components').select('*').order('name'),
      supabase.from('ship_weapons').select('*').order('name'),
      supabase.from('ship_accessories').select('*').order('name'),
    ]);
    if (componentsRes.error) throw componentsRes.error;
    if (weaponsRes.error) throw weaponsRes.error;
    if (accessoriesRes.error) throw accessoriesRes.error;

    const mapped = [
      ...(componentsRes.data || []).map((r: any) => mapComponentToTemplate(mapShipComponentRow(r))),
      ...(weaponsRes.data || []).map((r: any) => mapWeaponToTemplate(mapShipWeaponRow(r))),
      ...(accessoriesRes.data || []).map((r: any) => mapAccessoryToTemplate(mapShipAccessoryRow(r))),
    ].sort((a, b) => a.name.localeCompare(b.name));
    setRows(mapped);
    return mapped;
  }, []);

  useEffect(() => {
    void load().catch((e: any) => setStatus('Load failed: ' + (e?.message || 'unknown')));
  }, [load]);

  const counts = useMemo(() => ({
    component: rows.filter(r => r.kind === 'component').length,
    weapon: rows.filter(r => r.kind === 'weapon').length,
    accessory: rows.filter(r => r.kind === 'accessory').length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => r.kind === tab && (!q || r.name.toLowerCase().includes(q)));
  }, [rows, tab, search]);

  const selectTab = (next: ShipCatalogKind) => {
    setTab(next);
    setDraft(null);
    setStatus('');
  };

  const selectRow = (row: ShipComponentTemplate) => {
    setDraft({ ...row });
    setStatus('');
  };

  const save = async () => {
    if (!draft || readOnly) return;
    const error = validateShipComponentTemplate(draft);
    if (error) {
      setStatus(error);
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      let savedId = draft.id;
      if (draft.kind === 'component') {
        if (!draft.id) throw new Error('Built-in components cannot be created.');
        const { error: saveError } = await supabase
          .from('ship_components')
          .update(componentTemplateToComponentRow(draft))
          .eq('id', draft.id);
        if (saveError) throw saveError;
      } else if (draft.kind === 'weapon') {
        const row = componentTemplateToWeaponRow(draft);
        if (draft.id) {
          const { error: saveError } = await supabase.from('ship_weapons').update(row).eq('id', draft.id);
          if (saveError) throw saveError;
        } else {
          const { data, error: saveError } = await supabase.from('ship_weapons').insert(row).select('id').single();
          if (saveError) throw saveError;
          savedId = data.id;
        }
      } else {
        const row = componentTemplateToAccessoryRow(draft);
        if (draft.id) {
          const { error: saveError } = await supabase.from('ship_accessories').update(row).eq('id', draft.id);
          if (saveError) throw saveError;
        } else {
          const { data, error: saveError } = await supabase.from('ship_accessories').insert(row).select('id').single();
          if (saveError) throw saveError;
          savedId = data.id;
        }
      }

      const loaded = await load();
      const saved = loaded.find(r => r.id === savedId);
      if (saved) setDraft({ ...saved });
      setStatus('Saved.');
    } catch (e: any) {
      setStatus('Save failed: ' + (e?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || readOnly || draft.kind === 'component') return;
    if (!confirm(`Delete ${KIND_SINGULAR[draft.kind].toLowerCase()} "${humanize(draft.name)}"?`)) return;
    setBusy(true);
    try {
      const table = draft.kind === 'weapon' ? 'ship_weapons' : 'ship_accessories';
      const { error } = await supabase.from(table).delete().eq('id', draft.id);
      if (error) throw error;
      setDraft(null);
      setStatus('Deleted.');
      await load();
    } catch (e: any) {
      setStatus('Delete failed: ' + (e?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const clone = () => {
    if (!draft || readOnly || draft.kind === 'component') return;
    setDraft({ ...draft, id: '', name: `${draft.name}_copy` });
    setStatus('');
  };

  const newRow = () => {
    if (readOnly || tab === 'component') return;
    setDraft(freshTemplate(tab));
    setStatus('');
  };

  return (
    <div className="flex flex-col w-full h-screen bg-[#0d0d1a] text-white overflow-hidden select-none">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900">
        <h1 className="text-xl font-bold text-yellow-300">Component Workshop</h1>
        <div className="flex items-center gap-2">
          {readOnly && <span className="text-xs bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-gray-300">Read-only view</span>}
          <a href="/" className="text-sm bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded">Main Menu</a>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="w-64 lg:w-72 shrink-0 border-r border-gray-700 p-2 flex flex-col min-h-0">
          <div className="grid grid-cols-3 gap-1 mb-2">
            {(['component', 'weapon', 'accessory'] as ShipCatalogKind[]).map(kind => (
              <button
                key={kind}
                type="button"
                onClick={() => selectTab(kind)}
                className={`rounded px-1 py-1.5 text-[10px] border ${
                  tab === kind
                    ? 'bg-yellow-700/40 border-yellow-500 text-yellow-100'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                }`}
                title={KIND_LABEL[kind]}
              >
                <span className="block truncate">{KIND_LABEL[kind]}</span>
                <span className="block text-[9px] text-gray-400">{counts[kind]}</span>
              </button>
            ))}
          </div>

          {!readOnly && tab !== 'component' && (
            <button
              type="button"
              onClick={newRow}
              className="w-full py-1.5 rounded bg-emerald-800 hover:bg-emerald-700 text-sm mb-2"
            >
              New {KIND_SINGULAR[tab]}
            </button>
          )}

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-amber-400 outline-none mb-2"
          />

          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {filtered.length === 0 && <p className="text-xs text-gray-500">No {KIND_LABEL[tab].toLowerCase()} yet.</p>}
            {filtered.map(row => (
              <button
                key={row.id}
                type="button"
                onClick={() => selectRow(row)}
                className={`w-full text-left text-xs px-2 py-1.5 rounded border ${
                  draft?.id === row.id
                    ? 'bg-yellow-700/40 border-yellow-500'
                    : 'bg-gray-800 border-transparent hover:bg-gray-700'
                }`}
              >
                {humanize(row.name) || '(unnamed)'}
                <span className="block text-[10px] text-gray-400">
                  {row.mass} ton{row.mass === 1 ? '' : 's'} · {row.cost}gp
                  {row.kind === 'weapon' ? ` · ${row.damage}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0 p-4 overflow-y-auto">
          {!draft ? (
            <p className="text-gray-500 text-sm">
              Select a row from the left (or create one) to edit it.
            </p>
          ) : (
            <div className="w-full max-w-3xl">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs uppercase tracking-widest text-gray-500">{KIND_SINGULAR[draft.kind]}</span>
                {draft.kind === 'component' && (
                  <span className="text-[10px] text-amber-300">Built-in rows are edit-only.</span>
                )}
              </div>
              <ComponentFields value={draft} onChange={setDraft} readOnly={readOnly} />
              {!readOnly && (
                <div className="sticky bottom-0 bg-[#0d0d1a]/95 py-2 mt-4 border-t border-gray-800 flex gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={busy}
                    className="px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-sm disabled:opacity-50"
                  >
                    {draft.id ? 'Save' : 'Create'}
                  </button>
                  {draft.kind !== 'component' && draft.id && (
                    <button
                      type="button"
                      onClick={clone}
                      disabled={busy}
                      className="px-4 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm disabled:opacity-50"
                    >
                      Clone
                    </button>
                  )}
                  {draft.kind !== 'component' && draft.id && (
                    <button
                      type="button"
                      onClick={() => void remove()}
                      disabled={busy}
                      className="px-4 py-1.5 rounded bg-red-900 hover:bg-red-800 text-sm disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                  {status && <span className="text-xs text-amber-300 self-center">{status}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
