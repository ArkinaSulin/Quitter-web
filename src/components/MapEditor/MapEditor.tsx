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
import { edgeRef } from '@/lib/walls';
import { MapStructures } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { getStructureTemplates } from '@/lib/structureTemplateCache';
import { structureHasDoor } from '@/lib/structureTemplates';
import { EffectTemplate, mapEffectRow, modifierSummary, modifierAmount } from '@/lib/effectTemplates';
import { StructureEditModal, StructureInstancePatch } from '@/components/StructureEditModal';
import { MapCanvas } from './MapCanvas';

type Tab = 'image' | 'movement' | 'structures' | 'effects';

const movementNote = 'Pick a number, then left-click / drag across hexes on the map to paint. Empty = default 1 MP. Right-click clears back to 1 MP. Painted hexes show a tan tint + cost number.';
const structuresNote = 'Pick a structure, then click/drag a hex or near a hex edge to place it. Click a placed edge again to flip its battlement. Right-click removes. Shift + double-click a placed structure to edit it.';
const effectsNote = 'Pick an effect, then click/drag hexes to place it (one per hex); clicking its own hex clears it. Authored effects are permanent and snapshot into the scenario on assign.';

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
    structures: {},
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
  // Natural dimensions of the selected image (for offset-slider steps of ~1% of
  // the currently scaled image size).
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  const entity = selectedId ? maps.find(m => m.id === selectedId) ?? null : null;

  // Measure the selected image's natural size whenever it changes.
  useEffect(() => {
    let cancelled = false;
    const url = entity?.imageUrl;
    if (!url) { setImgSize(null); return; }
    const img = new Image();
    img.onload = () => { if (!cancelled) setImgSize({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 }); };
    img.onerror = () => { if (!cancelled) setImgSize(null); };
    img.src = url;
    return () => { cancelled = true; };
  }, [entity?.imageUrl]);

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
    if (paintValue === 1) delete terrainCosts[`${q},${r}`]; // 1 = default/clear
    else terrainCosts[`${q},${r}`] = paintValue; // 0 = free entry, 2..9 = cost
    update({ terrainCosts });
  }, [paintValue, entity, update]);

  // Right-click (paint mode): clear back to the default 1 MP.
  const handleClearHex = useCallback((q: number, r: number) => {
    if (!entity) return;
    const terrainCosts = { ...entity.terrainCosts };
    delete terrainCosts[`${q},${r}`];
    update({ terrainCosts });
  }, [entity, update]);

  // ---- effects (authored per-hex effect templates) ----
  const [effectTemplates, setEffectTemplates] = useState<Record<string, EffectTemplate>>({});
  const [effectTemplateId, setEffectTemplateId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
        .from('map_effect_templates')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, EffectTemplate> = {};
        for (const row of data as any[]) {
          const t = mapEffectRow(row);
          // Hex-authored effects only make sense for zone-capable templates.
          if (t.scope !== 'unit') map[t.id] = t;
        }
        setEffectTemplates(map);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (effectTemplateId && !effectTemplates[effectTemplateId]) setEffectTemplateId(null);
  }, [effectTemplates, effectTemplateId]);

  /** Paint the armed template on a hex (one effect per hex). Clicking the same
   *  template on its own hex clears it; a different template replaces it. */
  const paintHexEffect = useCallback((q: number, r: number) => {
    if (!entity || !effectTemplateId) return;
    const existing = entity.hexEffects.find(h => h.q === q && h.r === r);
    const next = existing && existing.effectId === effectTemplateId
      ? entity.hexEffects.filter(h => !(h.q === q && h.r === r))
      : [...entity.hexEffects.filter(h => !(h.q === q && h.r === r)), { q, r, effectId: effectTemplateId }];
    update({ hexEffects: next });
  }, [entity, effectTemplateId, update]);

  const clearHexEffect = useCallback((q: number, r: number) => {
    if (!entity) return;
    update({ hexEffects: entity.hexEffects.filter(h => !(h.q === q && h.r === r)) });
  }, [entity, update]);


  // ---- structures ----
  const [templates, setTemplates] = useState<Record<string, StructureTemplate>>({});
  const [paletteId, setPaletteId] = useState<string | null>(null);
  const [selectedStructureKey, setSelectedStructureKey] = useState<string | null>(null);
  // Shift + double-click a placed structure opens the shared instance editor.
  const [structureEditKey, setStructureEditKey] = useState<string | null>(null);
  // Hover info tooltip (item info and/or the tab's instruction note).
  const [tip, setTip] = useState<{ lines: string[]; note: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStructureTemplates().then(t => { if (!cancelled) setTemplates(t); });
    return () => { cancelled = true; };
  }, []);

  // Reconcile the armed palette if its template disappears.
  useEffect(() => {
    if (paletteId && !templates[paletteId]) setPaletteId(null);
  }, [templates, paletteId]);

  /** Click an edge structure: place a new one, select an existing one, or (already
   *  selected) flip its battlement/outside to the other side. */
  const paintStructureEdge = useCallback((q: number, r: number, dir: number) => {
    if (!entity || !paletteId) return;
    const ref = edgeRef(q, r, dir);
    const existing = entity.structures[ref.key];
    if (!existing) {
      update({ structures: { ...entity.structures, [ref.key]: { templateId: paletteId } } });
      setSelectedStructureKey(ref.key);
    } else if (selectedStructureKey === ref.key) {
      const nextOutside = (existing.outside ?? 'a') === 'a' ? 'b' : 'a';
      update({ structures: { ...entity.structures, [ref.key]: { ...existing, outside: nextOutside } } });
    } else {
      setSelectedStructureKey(ref.key);
    }
  }, [entity, paletteId, selectedStructureKey, update]);

  const paintStructureHex = useCallback((q: number, r: number) => {
    if (!entity || !paletteId) return;
    const key = `${q},${r}`;
    const existing = entity.structures[key];
    if (!existing) {
      update({ structures: { ...entity.structures, [key]: { templateId: paletteId } } });
    }
    setSelectedStructureKey(key);
  }, [entity, paletteId, update]);

  const clearStructure = useCallback((key: string) => {
    if (!entity || !entity.structures[key]) return;
    const next: MapStructures = { ...entity.structures };
    delete next[key];
    update({ structures: next });
    setSelectedStructureKey(sel => (sel === key ? null : sel));
  }, [entity, update]);

  /** Patch one placed structure instance by key (Shift + double-click modal). */
  const patchStructureAt = useCallback((key: string, patch: StructureInstancePatch) => {
    if (!entity) return;
    const inst = entity.structures[key];
    if (!inst) return;
    const next: any = { ...inst };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    update({ structures: { ...entity.structures, [key]: next } });
  }, [entity, update]);

  /** Info lines for a structure template (hover tooltip). */
  const structureLines = useCallback((t: StructureTemplate): string[] => {
    const mp = (v: number | null) => (v === null ? '—' : v < 0 ? 'block' : `${v}`);
    const cover = t.modifiers.filter(m => m.kind === 'ac');
    const melee = cover.filter(m => m.mode !== 'ranged').reduce((s, m) => s + modifierAmount(m.dice), 0);
    const ranged = cover.filter(m => m.mode !== 'melee').reduce((s, m) => s + modifierAmount(m.dice), 0);
    const rest = t.modifiers.filter(m => m.kind !== 'ac').map(modifierSummary);
    const door = t.doorHp ?? t.maxHp;
    const lines = [
      `${t.anchor}${t.spikes ? ' · stakes' : t.battlement ? ' · battlement' : ''}`,
      t.anchor === 'edge' ? `In foot ${mp(t.mpFootIn)} / mtd ${mp(t.mpMountedIn)} MP` : `Enter foot ${mp(t.mpFootIn)} / mtd ${mp(t.mpMountedIn)} MP`,
      `HP ${t.maxHp} · DT ${t.dt}${structureHasDoor(t) ? ` · door ${door}` : ''}`,
    ];
    if (melee || ranged) lines.push(`Cover AC melee ${melee} / ranged ${ranged}`);
    if (rest.length) lines.push(`Effects: ${rest.join(', ')}`);
    return lines;
  }, []);

  const armedAnchor = paletteId ? templates[paletteId]?.anchor ?? null : null;

  const uploadImage = useCallback(async (file: File) => {
    if (!file) return;
    // Keep the original file name, sanitized for storage: lowercase, spaces -> _,
    // any other unsafe chars collapsed to _, and a serial suffix on duplicates.
    const rawName = file.name.replace(/\.[^./\\]+$/, '') || 'map';
    const ext = ((file.name.split('.').pop() || 'png').toLowerCase() || 'png');
    const base = (rawName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')) || 'map';
    let path = `${base}.${ext}`;
    let serial = 2;
    for (let attempt = 0; attempt < 50; attempt++) {
      const { error } = await supabase.storage.from('map_images').upload(path, file, { cacheControl: '3600', upsert: false });
      if (!error) break;
      const msg = (error?.message || '').toLowerCase();
      if (!msg.includes('duplicate') && !/already exists|23505/.test(msg)) {
        console.error('[MapEditor] upload failed:', error.message);
        return;
      }
      path = `${base}_${serial}.${ext}`;
      serial += 1;
    }
    const url = supabase.storage.from('map_images').getPublicUrl(path).data.publicUrl;
    setImages(prev => (prev.includes(url) ? prev : [url, ...prev]));
    update({ imageUrl: url });
  }, [update]);

  if (loading) {
    return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading maps…</div>;
  }

  const panelDefs: { id: Tab; label: string }[] = [
    { id: 'image', label: 'Image' },
    { id: 'movement', label: 'Movement cost' },
    { id: 'structures', label: 'Structures' },
    { id: 'effects', label: 'Effects' },
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

          <div className="flex-1 min-h-0 flex flex-col p-3 gap-3">
            {tab === 'image' && entity && (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
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

                {(() => {
                  const scaledW = (imgSize?.w || 0) * entity.scale;
                  const scaledH = (imgSize?.h || 0) * entity.scale;
                  const stepX = Math.max(0.01, Math.round(scaledW * 0.01 * 100) / 100);
                  const stepY = Math.max(0.01, Math.round(scaledH * 0.01 * 100) / 100);
                  const offset = (axis: 'x' | 'y', v: number) => {
                    const rounded = Math.round((Number(v) || 0) * 10) / 10;
                    return axis === 'x' ? update({ offsetX: rounded }) : update({ offsetY: rounded });
                  };
                  return (
                    <>
                      <label className="block text-xs text-gray-400">Offset X ({entity.offsetX.toFixed(1)}) — 1% of width
                        <input type="range" min={-scaledW} max={scaledW} step={stepX} value={entity.offsetX} disabled={readOnly || scaledW <= 0} onChange={(e) => offset('x', Number(e.target.value))} className="w-full disabled:opacity-40" />
                      </label>
                      <label className="block text-xs text-gray-400">Offset Y ({entity.offsetY.toFixed(1)}) — 1% of height
                        <input type="range" min={-scaledH} max={scaledH} step={stepY} value={entity.offsetY} disabled={readOnly || scaledH <= 0} onChange={(e) => offset('y', Number(e.target.value))} className="w-full disabled:opacity-40" />
                      </label>
                    </>
                  );
                })()}
                <label className="block text-xs text-gray-400">Scale ({entity.scale.toFixed(1)})
                  <input type="range" min={0.1} max={6} step={0.1} value={entity.scale} disabled={readOnly} onChange={(e) => update({ scale: Math.round(Number(e.target.value) * 10) / 10 })} className="w-full" />
                </label>
                <label className="block text-xs text-gray-400">Grid radius ({entity.gridRadius})
                  <input type="number" min={3} max={30} value={entity.gridRadius} disabled={readOnly} onChange={(e) => update({ gridRadius: Math.max(3, Math.min(30, Math.floor(Number(e.target.value) || 12))) })} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50" />
                </label>
                <label className="block text-xs text-gray-400">Description
                  <textarea value={entity.description} disabled={readOnly} onChange={(e) => update({ description: e.target.value })} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50" rows={2} />
                </label>
              </div>
            )}

            {tab === 'movement' && entity && (
              <div
                className="flex-1 min-h-0 overflow-y-auto space-y-3"
                onMouseEnter={e => setTip({ lines: [], note: movementNote, x: e.clientX, y: e.clientY })}
                onMouseMove={e => setTip(t => (t && t.lines.length === 0 ? { lines: [], note: movementNote, x: e.clientX, y: e.clientY } : t))}
                onMouseLeave={() => setTip(null)}
              >
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
                {paintValue !== null && (
                  <p className="text-xs text-yellow-300">
                    Pen: <b>{paintValue === 0 ? 'Free (0)' : paintValue === 1 ? 'Clear (1)' : `${paintValue} MP`}</b> — left-click or drag. Click the number again to put the pen down.
                  </p>
                )}
              </div>
            )}

            {tab === 'structures' && entity && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Map structures</p>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                  {Object.values(templates).length === 0 && (
                    <p className="text-xs text-gray-500">No structure templates yet — author them in the Structure Editor.</p>
                  )}
                  {Object.values(templates)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(t => (
                      <button
                        key={t.id}
                        disabled={readOnly}
                        onClick={() => { setPaletteId(id => (id === t.id ? null : t.id)); setSelectedStructureKey(null); }}
                        onMouseEnter={e => setTip({ lines: structureLines(t), note: structuresNote, x: e.clientX, y: e.clientY })}
                        onMouseMove={e => setTip(tip => (tip ? { ...tip, x: e.clientX, y: e.clientY } : tip))}
                        onMouseLeave={() => setTip(null)}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded border ${paletteId === t.id ? 'bg-yellow-700/40 border-yellow-500' : 'bg-gray-800 border-transparent hover:bg-gray-700'}`}
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle bg-black/80 border border-gray-500" />
                        {t.name}
                        <span className="block text-[10px] text-gray-400">{t.anchor}{t.battlement ? ' · battlement' : ''}{t.spikes ? ' · stakes' : ''}{structureHasDoor(t) ? ` · door ${t.doorHp}` : ''} · {t.maxHp}hp</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {tab === 'effects' && entity && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Map effects (permanent)</p>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                  {Object.values(effectTemplates).length === 0 && (
                    <p className="text-xs text-gray-500">No zone-capable effects yet — author them in the Effect Editor.</p>
                  )}
                  {Object.values(effectTemplates).map(t => {
                    const active = effectTemplateId === t.id;
                    return (
                      <button
                        key={t.id}
                        disabled={readOnly}
                        onClick={() => setEffectTemplateId(active ? null : t.id)}
                        onMouseEnter={e => setTip({ lines: [t.name, `${t.scope} · ${t.defaultDuration} turn${t.defaultDuration === 1 ? '' : 's'}`, t.modifiers.map(modifierSummary).join(', ') || 'no modifiers'], note: effectsNote, x: e.clientX, y: e.clientY })}
                        onMouseMove={e => setTip(tip => (tip ? { ...tip, x: e.clientX, y: e.clientY } : tip))}
                        onMouseLeave={() => setTip(null)}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded border ${active ? 'bg-yellow-700/40 border-yellow-500' : 'bg-gray-800 border-transparent hover:bg-gray-700'}`}
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: t.color }} />
                        {t.name}
                        <span className="block text-[10px] text-gray-400">{t.scope} · {t.modifiers.map(m => m.kind).join('+') || '—'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
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
            structures={entity.structures}
            templates={templates}
            structureAnchors={tab === 'structures' ? armedAnchor : null}
            selectedStructureKey={selectedStructureKey}
            hexEffects={entity.hexEffects}
            effectTemplates={effectTemplates}
            effectArmed={tab === 'effects' && !!effectTemplateId}
            paintValue={tab === 'movement' ? paintValue : null}
            readOnly={readOnly}
            onPaintHex={handlePaint}
            onClearHex={handleClearHex}
            onPaintStructureEdge={paintStructureEdge}
            onPaintStructureHex={paintStructureHex}
            onClearStructure={clearStructure}
            onPaintEffect={paintHexEffect}
            onClearEffect={clearHexEffect}
            onEditStructureKey={setStructureEditKey}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            Select a map or create one to start painting.
          </div>
        )}
      </div>

      {/* Hover info tooltip: item info (+ the tab's instruction note at the bottom). */}
      {tip && (
        <div
          className="fixed z-[90] pointer-events-none bg-black/95 border border-gray-600 rounded shadow-xl p-2.5 text-[11px] text-white w-64"
          style={{ left: Math.min(tip.x + 12, window.innerWidth - 280), top: Math.min(tip.y + 12, window.innerHeight - 200) }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i === 0 ? 'font-semibold text-amber-300' : 'text-gray-300'}>{l}</div>
          ))}
          {tip.lines.length > 0 && <div className="my-1 border-t border-gray-700" />}
          <div className="text-gray-400">{tip.note}</div>
        </div>
      )}

      {/* Shift + double-click a placed structure → instance editor. */}
      {structureEditKey && entity?.structures[structureEditKey] && templates[entity.structures[structureEditKey].templateId] && (
        <StructureEditModal
          template={templates[entity.structures[structureEditKey].templateId]}
          instance={entity.structures[structureEditKey]}
          onSave={(patch) => patchStructureAt(structureEditKey, patch)}
          onClose={() => setStructureEditKey(null)}
        />
      )}
    </div>
  );
}
