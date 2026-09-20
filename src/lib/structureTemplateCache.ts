// src/lib/structureTemplateCache.ts
import { supabase } from '@/lib/supabaseClient';
import { StructureTemplate } from '@/types/structure';
import { mapStructureRow } from '@/lib/structureTemplates';

// Session-scoped cache of the map_structure_templates library, keyed by id. Small
// and rarely changed, so load once and share across the Map Editor, ScenarioMap
// (structures -> Walls derivation) and any future painter.
let cache: Record<string, StructureTemplate> | null = null;
let inflight: Promise<Record<string, StructureTemplate>> | null = null;

export function invalidateStructureTemplatesCache(): void {
  cache = null;
  inflight = null;
}

export async function getStructureTemplates(): Promise<Record<string, StructureTemplate>> {
  if (cache) return cache;
  if (!inflight) {
    const p = supabase
      .from('map_structure_templates')
      .select('*')
      .then(({ data }) => {
        const map: Record<string, StructureTemplate> = {};
        for (const row of data || []) {
          const t = mapStructureRow(row);
          map[t.id] = t;
        }
        cache = map;
        return map;
      });
    inflight = Promise.resolve(p);
    inflight.then(
      () => { inflight = null; },
      () => { inflight = null; },
    );
  }
  return inflight;
}
