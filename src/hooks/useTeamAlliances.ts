'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { AllianceGroup } from '@/types/gameProtocol';
import { TEAMS } from '@/components/TokenRenderer/tokenUtils';

export function useTeamAlliances(scenarioId: string, isGM: boolean) {
  const [alliances, setAlliances] = useState<Record<string, AllianceGroup>>(() => {
    const init: Record<string, AllianceGroup> = {};
    for (const t of TEAMS) init[t] = 'friendly';
    return init;
  });

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('team_alliances')
      .select('team, alliance_group')
      .eq('scenario_id', scenarioId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error('[TeamAlliances] Fetch error:', error); return; }
        if (data && data.length > 0) {
          const map: Record<string, AllianceGroup> = {};
          for (const t of TEAMS) map[t] = 'friendly';
          for (const row of data) {
            if (row.team && row.alliance_group) map[row.team] = row.alliance_group;
          }
          setAlliances(map);
        }
      });
    return () => { cancelled = true; };
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
