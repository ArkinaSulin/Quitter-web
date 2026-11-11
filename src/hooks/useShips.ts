'use client';

// Scenario ship instances (`ship_spelljammer`). Mirrors `useSupabaseSync` for
// units: load the scenario rows, keep them in sync over realtime, and expose an
// optimistic local patch used by the command log.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import { mapShipRuntimeRow, ShipRuntime } from '@/packages/ships';

export function useShips(scenarioId: string) {
  const [ships, setShips] = useState<ShipRuntime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('ship_spelljammer')
      .select('*')
      .eq('scenario_id', scenarioId)
      .eq('is_deleted', false)
      .order('created_at');
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setShips((data || []).map(mapShipRuntimeRow));
    setError(null);
    setLoading(false);
  }, [scenarioId]);

  useEffect(() => {
    setLoading(true);
    void refresh();

    const channel = supabase
      .channel(`ships:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ship_spelljammer', filter: `scenario_id=eq.${scenarioId}` },
        (payload: any) => {
          const row = payload.new as any;
          if (payload.eventType === 'DELETE') {
            const oldId = payload.old?.id;
            if (oldId) setShips(prev => prev.filter(s => s.id !== oldId));
            return;
          }
          if (!row?.id) return;
          if (row.is_deleted) {
            setShips(prev => prev.filter(s => s.id !== row.id));
            return;
          }
          const mapped = mapShipRuntimeRow(row);
          setShips(prev => {
            const idx = prev.findIndex(s => s.id === mapped.id);
            if (idx === -1) return [...prev, mapped];
            const next = [...prev];
            // Realtime UPDATE payloads can omit unchanged TOASTed columns (the
            // large `snapshot` jsonb), so never drop a known snapshot.
            const existing = next[idx];
            next[idx] = {
              ...existing,
              ...mapped,
              snapshot: mapped.snapshot ?? existing.snapshot,
            };
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [scenarioId, refresh]);

  /** Optimistic local apply for SHIP commands (camelCase patch). */
  const setShipLocal = useCallback((shipId: string, patch: Record<string, unknown>) => {
    setShips(prev => {
      if (patch.__delete) return prev.filter(s => s.id !== shipId);
      const idx = prev.findIndex(s => s.id === shipId);
      if (idx === -1) {
        const { __delete, ...rest } = patch as Record<string, unknown>;
        void __delete;
        return [...prev, { id: shipId, ...rest } as unknown as ShipRuntime];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch } as ShipRuntime;
      return next;
    });
  }, []);

  return { ships, loading, error, refresh, setShipLocal };
}
