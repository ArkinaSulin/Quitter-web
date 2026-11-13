'use client';

// Saved Halloween Siege sequences (presets). Stores only the authored plan;
// loading fills the editor draft and never arms the siege. Global DM library
// (RLS: create_scenario), shared like the map/structure template libraries.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import {
  halloweenSiegePlanTemplateIds,
  halloweenSiegePresetToRow,
  isHalloweenSiegePlanValid,
  parseHalloweenSiegePresetRow,
  planFromConfig,
  type HalloweenSiegeConfig,
  type HalloweenSiegePlan,
  type HalloweenSiegePreset,
} from '@/packages/world';

interface HalloweenSiegePresetBarProps {
  /** Current editor draft (only its plan fields are saved). */
  config: HalloweenSiegeConfig;
  /** Known unit-template ids, for the stale-template warning on load. */
  knownTemplateIds: Set<string>;
  /** False while unit templates are still loading: suppress a false stale-template warning. */
  templatesReady: boolean;
  onLoad: (plan: HalloweenSiegePlan) => void;
}

export function HalloweenSiegePresetBar({
  config,
  knownTemplateIds,
  templatesReady,
  onLoad,
}: HalloweenSiegePresetBarProps) {
  const [presets, setPresets] = useState<HalloweenSiegePreset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const loadPresets = useCallback(async (): Promise<HalloweenSiegePreset[]> => {
    const { data, error: loadError } = await supabase
      .from('halloween_siege_presets')
      .select('*')
      .order('name');
    if (loadError) {
      setError(`Failed to load saved sequences: ${loadError.message}`);
      setLoaded(true);
      return [];
    }
    const list = (data || []).map(parseHalloweenSiegePresetRow);
    setPresets(list);
    setError(null);
    setLoaded(true);
    return list;
  }, []);

  useEffect(() => { void loadPresets(); }, [loadPresets]);

  const selected = presets.find(preset => preset.id === selectedId) ?? null;

  const handleSelect = (id: string) => {
    setSelectedId(id || null);
    setNotice(null);
    setWarning(null);
    const preset = presets.find(item => item.id === id) ?? null;
    setName(preset?.name ?? '');
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    const plan = planFromConfig(config);
    if (!trimmed) { setError('Enter a name for the saved sequence.'); return; }
    if (!isHalloweenSiegePlanValid(plan)) {
      setError('Add at least one valid wave (each totalling 100%) before saving a sequence.');
      return;
    }
    const existing = presets.find(preset => preset.name.toLowerCase() === trimmed.toLowerCase());
    if (existing && existing.id !== selectedId && !window.confirm(`Overwrite the saved sequence "${existing.name}"?`)) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setWarning(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const row = {
        ...halloweenSiegePresetToRow(plan, trimmed, selectedId ? undefined : authData.user?.id),
        updated_at: new Date().toISOString(),
      };
      const { data, error: saveError } = await supabase
        .from('halloween_siege_presets')
        .upsert(row, { onConflict: 'name' })
        .select('*')
        .single();
      if (saveError) throw saveError;
      const saved = parseHalloweenSiegePresetRow(data);
      await loadPresets();
      setSelectedId(saved.id);
      setName(saved.name);
      setNotice(`Saved "${saved.name}".`);
    } catch (err: any) {
      setError(`Failed to save sequence: ${err?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete the saved sequence "${selected.name}"?`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setWarning(null);
    try {
      const { error: deleteError } = await supabase
        .from('halloween_siege_presets')
        .delete()
        .eq('id', selected.id);
      if (deleteError) throw deleteError;
      await loadPresets();
      setSelectedId(null);
      setName('');
      setNotice(`Deleted "${selected.name}".`);
    } catch (err: any) {
      setError(`Failed to delete sequence: ${err?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = () => {
    if (!selected) return;
    onLoad(selected);
    setNotice(`Loaded "${selected.name}" into the draft. Save & arm to start it.`);
    const missing = templatesReady
      ? halloweenSiegePlanTemplateIds(selected).filter(id => !knownTemplateIds.has(id))
      : [];
    setWarning(missing.length > 0
      ? `${missing.length} monster template${missing.length === 1 ? '' : 's'} in this sequence no longer exist (${missing.join(', ')}). Those entries will be skipped when spawning.`
      : null);
  };

  return (
    <div className="shrink-0 rounded border border-gray-700 bg-gray-800/40 p-2 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-gray-400">
          <span>Saved sequence</span>
          <select
            value={selectedId ?? ''}
            onChange={e => handleSelect(e.target.value)}
            disabled={busy || !loaded}
            className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700"
          >
            <option value="">{loaded ? 'Select a sequence…' : 'Loading…'}</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
        </label>
        <button
          onClick={handleLoad}
          disabled={busy || !selected}
          className={`px-3 py-1 rounded text-sm ${selected ? 'bg-amber-700 hover:bg-amber-600 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
        >
          Load
        </button>
        <label className="flex min-w-0 flex-[1.4] flex-col gap-1 text-[11px] text-gray-400">
          <span>Sequence name</span>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Goblin Night"
            disabled={busy}
            className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:outline-none focus:border-amber-400"
          />
        </label>
        <button
          onClick={handleSave}
          disabled={busy}
          className="px-3 py-1 rounded text-sm bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={handleDelete}
          disabled={busy || !selected}
          className="px-3 py-1 rounded text-sm bg-gray-700 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Delete
        </button>
        <button
          onClick={() => { setNotice(null); setWarning(null); void loadPresets(); }}
          disabled={busy}
          className="text-[11px] text-gray-500 hover:text-white disabled:opacity-50"
          title="Refresh saved sequences"
        >
          refresh
        </button>
      </div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
      {notice && <div className="text-[11px] text-emerald-300">{notice}</div>}
      {warning && <div className="text-[11px] text-amber-300">{warning}</div>}
    </div>
  );
}
