// src/lib/formationCache.ts
import { supabase } from '@/lib/supabaseClient';
import { Formation } from '@/types/gameProtocol';

// Session-scoped cache of the formations lookup table. The matrix is small and
// rarely changes, so load it once and share it across all consumers (ScenarioMap,
// UnitEditor, combat helpers). Call invalidate() if an admin edits formations.
let cache: Record<string, Formation> | null = null;
let inflight: Promise<Record<string, Formation>> | null = null;

export function invalidateFormationsCache(): void {
  cache = null;
  inflight = null;
}

export async function getFormations(): Promise<Record<string, Formation>> {
  if (cache) return cache;
  if (!inflight) {
    const p = supabase
      .from('formations')
      .select('*')
      .then(({ data }) => {
        const map: Record<string, Formation> = {};
        for (const f of data || []) {
          map[f.name] = {
            ...f,
            melee_target_arcs: f.melee_target_arcs ?? ['front'],
            ranged_target_arcs: f.ranged_target_arcs ?? ['front', 'flank', 'rear'],
            threat_arcs: f.threat_arcs ?? ['front', 'flank'],
            double_threat_arcs: f.double_threat_arcs ?? ['rear'],
            retaliate_arcs: f.retaliate_arcs ?? { front: 'full', flank: 'rows', rear: 'none' },
            retaliate_vs_ranged: f.retaliate_vs_ranged ?? false,
            can_charge: f.can_charge ?? false,
            stop_enemy_movement_arcs: f.stop_enemy_movement_arcs ?? ['front'],
            charge_through_arcs: f.charge_through_arcs ?? [],
            be_attacked_melee_modifier: f.be_attacked_melee_modifier ?? 1,
            be_attacked_range_modifier: f.be_attacked_range_modifier ?? 1,
          } as Formation;
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

/** Convenience: fetch the formation row by name (falls back to a sensible default). */
export async function getFormation(name: string | undefined): Promise<Formation | null> {
  if (!name) return null;
  const map = await getFormations();
  return map[name] ?? null;
}
