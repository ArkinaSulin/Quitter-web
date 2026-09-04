// src/components/ScenarioMap/MapPickerList.tsx
'use client';
// Map-tab entity picker: lists reusable maps and snapshots the chosen one into
// the scenario (image + placement + terrain costs). Assigning is optional — a
// scenario with no map keeps its plain board.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { MapEntity, mapMapRow } from '@/lib/mapEntities';

interface MapPickerListProps {
  currentMapId: string | null;
  onAssignMap: (entity: MapEntity) => void;
  onClearMap: () => void;
}

export function MapPickerList({ currentMapId, onAssignMap, onClearMap }: MapPickerListProps) {
  const [maps, setMaps] = useState<MapEntity[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('maps').select('*').order('name');
    if (!error) setMaps((data || []).map(mapMapRow));
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const current = maps.find(m => m.id === currentMapId) ?? null;

  return (
    <div className="p-3 space-y-2 border-b border-gray-700 bg-gray-900/40">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-300">Map entity</p>
        <button onClick={() => void load()} className="text-[10px] text-gray-500 hover:text-white">refresh</button>
      </div>
      <div className="max-h-36 overflow-y-auto space-y-1">
        {loaded && maps.length === 0 && <p className="text-xs text-gray-600">No reusable maps yet.</p>}
        {maps.map(m => {
          const active = m.id === currentMapId;
          return (
            <div key={m.id} className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs ${active ? 'bg-yellow-700/30 border border-yellow-600' : 'bg-gray-800/60 hover:bg-gray-700/70'}`}>
              <div className="flex items-center gap-2 min-w-0">
                {m.imageUrl ? (
                  <img src={m.imageUrl} alt="" className="w-8 h-6 rounded object-cover" />
                ) : (
                  <span className="w-8 h-6 rounded bg-gray-700" />
                )}
                <span className="truncate" title={m.description}>{m.name}</span>
              </div>
              {active ? (
                <button onClick={onClearMap} className="shrink-0 text-gray-400 hover:text-red-300">Active · clear</button>
              ) : (
                <button onClick={() => onAssignMap(m)} className="shrink-0 text-yellow-300 hover:text-yellow-200">Assign</button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-600">Assigning snapshots the map into this scenario; the DM can still tune terrain and image placement below.</p>
      {current && <p className="text-[10px] text-gray-500">Loaded: {current.name}</p>}
    </div>
  );
}
