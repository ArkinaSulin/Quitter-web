'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { AllianceGroup } from '@/types/gameProtocol';
import { TEAMS } from '@/components/TokenRenderer/tokenUtils';

function buildMap(rows: { team: string; alliance_group: string }[]): Record<string, AllianceGroup> {
  const map: Record<string, AllianceGroup> = {};
  for (const t of TEAMS) map[t] = 'friendly';
  for (const row of rows) {
    if (row.team && row.alliance_group) map[row.team] = row.alliance_group as AllianceGroup;
  }
  return map;
}

export function useTeamAlliances(scenarioId: string, isGM: boolean) {
  const [alliances, setAlliances] = useState<Record<string, AllianceGroup>>(() => {
    const init: Record<string, AllianceGroup> = {};
    for (const t of TEAMS) init[t] = 'friendly';
    return init;
  });

  // Keep a copy of the latest rows so realtime INSERT/UPDATE/DELETE events can be
  // applied incrementally without refetching (the table is GM-written, so events
  // only arrive for the current scenario).
  const rowsRef = useRef<{ team: string; alliance_group: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('team_alliances')
      .select('team, alliance_group')
      .eq('scenario_id', scenarioId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error('[TeamAlliances] Fetch error:', error); return; }
        rowsRef.current = data ?? [];
        setAlliances(buildMap(rowsRef.current));
      });

    // Live-sync alliance changes (GM drags a team between groups) to every client.
    const channel = supabase
      .channel(`team-alliances:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_alliances', filter: `scenario_id=eq.${scenarioId}` },
        (payload: any) => {
          const rows = rowsRef.current;
          if (payload.eventType === 'DELETE') {
            rowsRef.current = rows.filter(r => r.team !== payload.old.team);
          } else if (payload.eventType === 'INSERT') {
            if (!rows.some(r => r.team === payload.new.team)) {
              rowsRef.current = [...rows, payload.new];
            }
          } else if (payload.eventType === 'UPDATE') {
            rowsRef.current = rows.map(r => (r.team === payload.new.team ? payload.new : r));
          }
          setAlliances(buildMap(rowsRef.current));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [scenarioId]);

  const setAlliance = useCallback(async (team: string, group: AllianceGroup) => {
    setAlliances(prev => ({ ...prev, [team]: group }));
    const { error } = await supabase
      .from('team_alliances')
      .upsert({
        scenario_id: scenarioId,
        team,
        alliance_group: group,
      }, { onConflict: 'scenario_id,team' });
    if (error) console.error('[TeamAlliances] Upsert error:', error);
  }, [scenarioId]);

  const cycleAlliance = useCallback((team: string) => {
    const current = alliances[team] || 'friendly';
    const next: Record<AllianceGroup, AllianceGroup> = {
      friendly: 'enemy',
      enemy: 'neutral',
      neutral: 'friendly',
    };
    setAlliance(team, next[current]);
  }, [alliances, setAlliance]);

  return { alliances, setAlliance, cycleAlliance };
}
