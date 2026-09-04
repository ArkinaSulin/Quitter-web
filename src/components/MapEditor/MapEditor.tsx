// src/components/MapEditor/MapEditor.tsx
'use client';
// Map Editor — author reusable map entities (background image + per-hex MP
// entry costs), ScenarioMap-style: full-height canvas + a floating left panel
// with Image / Movement cost tabs. Every edit autosaves to the `maps` table.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { MapEntity, mapMapRow, mapEntityToRow } from '@/lib/mapEntities';
import { MAP_DEFAULTS } from '@/lib/mapEntities';
import { MapCanvas } from './MapCanvas';

type Tab = 'image' | 'movement';

function blankMap(): MapEntity {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m-${Date.now()}`,
    name: 'New Map',
    description: '',
    imageUrl: '',
    offsetX: 0,
    offsetY: 0,
    scale: MAP_DEFAULTS.scale,
    gridRadius: 12,
    terrainCosts: {},
    hexEffects: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default function MapEditor({ readOnly = false }: { readOnly?: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [maps, setMaps] = useState<MapEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('movement');
  const [paintValue, setPaintValue] = useState<number | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const entity = selectedId ? maps.find(m => m.id === selectedId) ?? null : null;

  // ---- maps load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('maps').select('*').order('name');
      if (cancelled) return;
      if (!error) {
        const list = (data || []).map(mapMapRow);
        setMaps(list);
        if (list.length > 0) setSelectedId(list[0].id);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- storage thumbnails (same bucket + listing as the scenario MapEditorPanel) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: string[] = [];
      let offset = 0;
      const pageSize = 100;
      while (true) {
        const { data, error } = await supabase.storage.from('map_images').list('', { limit: pageSize, offset });
        if (error) break;
        if (!data || data.length === 0) break;
        for (const f of data) {
          if (f.name === '.emptyFolderPlaceholder') continue;
          out.push(supabase.storage.from('map_images').getPublicUrl(f.name).data.publicUrl);
        }
        if (data.length < pageSize) break;
        offset += data.length;
      }
      if (!cancelled) setImages(out);
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- autosave (debounced) ----
  const entityRef = useRef(entity);
  entityRef.current = entity;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const e = entityRef.current;
    if (!e || readOnly) return;
    setBusy(true);
    const row = mapEntityToRow(e, userId || undefined);
    const { data, error } = await supabase.from('maps').upsert({ id: e.id, ...row }).select('id').single();
    if (error) {
      console.error('[MapEditor] autosave failed:', error.message);
    } else if (data?.id) {
      // ensure the list holds the saved row (id stable already)
    }
    setBusy(false);
  }, [readOnly, userId]);
  const scheduleSave = useCallback(() => {
    if (readOnly) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush(); }, 350);
  }, [readOnly, flush]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const update = useCallback((patch: Partial<MapEntity>) => {
    setMaps(prev => prev.map(m => (m.id === selectedId ? { ...m, ...patch } : m)));
    scheduleSave();
  }, [selectedId, scheduleSave]);

  // ---- actions ----
  const createNew = useCallback(async () => {
    const m = blankMap();
    setMaps(prev => [...prev, m]);
    setSelectedId(m.id);
    setPaintValue(null);
    // persist immediately so New/Clone maps are on the server.
    await new Promise(r => setTimeout(r, 0));
    entityRef.current = m;
    await flush();
  }, [flush]);

  const removeMap = useCallback(async () => {
    if (!entity) return;
    if (!window.confirm(`Delete map "${entity.name}"? This does not affect scenarios that already snapshot it.`)) return;
    const { error } = await supabase.from('maps').delete().eq('id', entity.id);
    if (error) { console.error('[MapEditor] delete failed:', error.message); return; }
    setMaps(prev => prev.filter(m => m.id !== entity.id));
    setSelectedId(prevId => {
      const rest = maps.filter(m => m.id !== prevId);
      return rest.length > 0 ? rest[0].id : null;
    });
    setPaintValue(null);
  }, [entity, maps]);

  const handlePaint = useCallback((q: number, r: number) => {
    if (paintValue === null || !entity) return;
    const terrainCosts = { ...entity.terrainCosts };
    if (paintValue <= 1) delete terrainCosts[`${q},${r}`];
    else terrainCosts[`${q},${r}`] = paintValue;
    update({ terrainCosts });
  }, [paintValue, entity, update]);

  const uploadImage = useCallback(async (file: File) => {
    if (!file) return;
    const ext = file.name.split('.').pop() || 'png';
    const path = `map_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('map_images').upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) { console.error('[MapEditor] upload failed:', error.message); return; }
    const url = supabase.storage.from('map_images').getPublicUrl(path).data.publicUrl;
    setImages(prev => [url, ...prev]);
    update({ imageUrl: url });
  }, [update]);

  if (loading) {
    return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading maps…</div>;
  }

  const panelDefs: { id: Tab; label: string }[] = [
    { id: 'image', label: 'Image' },
    { id: 'movement', label: 'Movement cost' },
  ];

  return (
    <div className="flex flex-col w-full h-screen bg-[#0d0d1a] text-white overflow-hidden select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-yellow-300">Map Editor</h1>
          {readOnly && (
            <span className="text-xs bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-gray-300">
              Read-only — editing requires an author role
            </span>
          )}
          {busy && <span className="text-xs text-gray-500">saving…</span>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          {!readOnly && (
            <>
              <button onClick={() => void createNew()} className="px-3 py-1 bg-green-800 border border-yellow-400 rounded hover:bg-green-700">New Map</button>
              <button
                onClick={() => void removeMap()}
                disabled={!entity}
                className="px-3 py-1 bg-red-900 border border-red-600 rounded hover:bg-red-800 disabled:opacity-40"
              >
                Delete
              </button>
            </>
          )}
          <button onClick={() => router.push('/')} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">Main Menu</button>
        </div>
      </div>

      {/* Body: left panel + canvas */}
      <div className="flex-1 relative">
        {/* Left panel */}
        <div className="absolute top-2 left-2 bottom-2 w-72 z-10 flex flex-col bg-gray-900/95 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
          {/* Map list */}
          <div className="px-3 py-2 border-b border-gray-700 max-h-44 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Maps</p>
            <div className="space-y-1">
              {maps.length === 0 && <p className="text-xs text-gray-500">No maps yet — create one.</p>}
              {maps.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setSelectedId(m.id); setPaintValue(null); }}
                  className={`w-full text-left text-xs px-2 py-1 rounded ${m.id === selectedId ? 'bg-yellow-700/40 border border-yellow-500' : 'bg-gray-800 border border-transparent hover:bg-gray-700'}`}
                >
                  {m.name}
                  {m.imageUrl && <span className="text-gray-500 ml-1">· img</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-700">
            {panelDefs.map(d => (
              <button
                key={d.id}
                onClick={() => setTab(d.id)}
                className={`flex-1 py-1.5 text-xs font-semibold ${tab === d.id ? 'bg-yellow-700/30 text-yellow-300 border-b-2 border-yellow-500' : 'text-gray-400 hover:bg-gray-800'}`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {tab === 'image' && entity && (
              <>
                <label className="block text-xs text-gray-400">Map name
                  <input
                    value={entity.name}
                    disabled={readOnly}
                    onChange={(e) => update({ name: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50"
                  />
                </label>

                <div>
                  <p className="text-xs text-gray-400 mb-1">Background image</p>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                    <button
                      disabled={readOnly}
                      onClick={() => update({ imageUrl: '' })}
                      className={`w-14 h-14 rounded border flex items-center justify-center text-[10px] ${!entity.imageUrl ? 'border-yellow-500 bg-gray-700' : 'border-gray-600 bg-gray-800'}`}
                    >
                      None
                    </button>
                    {images.map(url => (
                      <button
                        key={url}
                        disabled={readOnly}
                        onClick={() => update({ imageUrl: url })}
                        className={`w-14 h-14 rounded overflow-hidden border ${entity.imageUrl === url ? 'border-yellow-500' : 'border-gray-600'}`}
                        style={{ backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                        title={url.split('/').pop()}
                      />
                    ))}
                  </div>
                  {!readOnly && (
                    <label className="mt-2 block text-xs bg-gray-800 border border-gray-600 rounded px-2 py-1.5 cursor-pointer text-center">
                      Upload image…
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} />
                    </label>
                  )}
                </div>

                <label className="block text-xs text-gray-400">Offset X
                  <input type="number" value={entity.offsetX} disabled={readOnly} onChange={(e) => update({ offsetX: Number(e.target.value) || 0 })} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50" />
                </label>
                <label className="block text-xs text-gray-400">Offset Y
                  <input type="number" value={entity.offsetY} disabled={readOnly} onChange={(e) => update({ offsetY: Number(e.target.value) || 0 })} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50" />
                </label>
                <label className="block text-xs text-gray-400">Scale ({entity.scale.toFixed(2)})
                  <input type="range" min={0.1} max={6} step={0.05} value={entity.scale} disabled={readOnly} onChange={(e) => update({ scale: Number(e.target.value) })} className="w-full" />
                </label>
                <label className="block text-xs text-gray-400">Grid radius ({entity.gridRadius})
                  <input type="number" min={3} max={30} value={entity.gridRadius} disabled={readOnly} onChange={(e) => update({ gridRadius: Math.max(3, Math.min(30, Math.floor(Number(e.target.value) || 12))) })} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50" />
                </label>
                <label className="block text-xs text-gray-400">Description
                  <textarea value={entity.description} disabled={readOnly} onChange={(e) => update({ description: e.target.value })} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50" rows={2} />
                </label>
              </>
            )}

            {tab === 'movement' && entity && (
              <>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Movement cost to ENTER a hex</p>
                <div className="flex flex-wrap gap-1.5">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                    <button
                      key={n}
                      disabled={readOnly}
                      title={n === 0 ? 'Free' : n === 1 ? 'Clear (default)' : `Cost ${n} MP`}
                      onClick={() => setPaintValue(paintValue === n ? null : n)}
                      className={`w-9 h-9 rounded border text-sm font-bold ${paintValue === n ? 'bg-yellow-600 text-black border-yellow-300' : 'bg-gray-800 text-gray-100 border-gray-600 hover:bg-gray-700'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {paintValue === null ? (
                  <p className="text-xs text-gray-500">Pick a number, then left-click / drag across hexes on the map to paint. Empty = default 1 MP.</p>
                ) : (
                  <p className="text-xs text-yellow-300">
                    Pen: <b>{paintValue === 0 ? 'Free (0)' : paintValue === 1 ? 'Clear (1)' : `${paintValue} MP`}</b> — left-click or drag. Click the number again to put the pen down.
                  </p>
                )}
                <div className="pt-1 border-t border-gray-700">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Legend</p>
                  <p className="text-xs text-gray-400">Painted hexes show a tan tint + cost number. Unpainted hexes cost the default <b>1 MP</b>. Drag to paint multiple hexes in one stroke.</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Canvas */}
        {entity ? (
          <MapCanvas
            imageUrl={entity.imageUrl}
            offsetX={entity.offsetX}
            offsetY={entity.offsetY}
            scale={entity.scale}
            gridRadius={entity.gridRadius}
            terrainCosts={entity.terrainCosts}
            paintValue={tab === 'movement' ? paintValue : null}
            readOnly={readOnly}
            onPaintHex={handlePaint}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            Select a map or create one to start painting.
          </div>
        )}
      </div>
    </div>
  );
}
