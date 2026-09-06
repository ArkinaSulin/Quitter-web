'use client';
// src/hooks/useCommandLogRows.ts
// Live list of the scenario's command_log rows (including undone rows, which
// the consumers skip by `deleted_at`). Refreshed on mount and on every
// realtime command-log change. Shared source for corpse piles + battle stats.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { CommandLogRow } from '@/lib/commandLog';

export function useCommandLogRows(scenarioId: string, enabled = true): CommandLogRow[] {
  const [rows, setRows] = useState<CommandLogRow[]>([]);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('command_log')
      .select('*')
      .eq('scenario_id', scenarioId)
      .order('seq', { ascending: true });
    if (data) setRows(data as CommandLogRow[]);
  }, [scenarioId]);

  useEffect(() => {
    if (!enabled || !scenarioId) return;
    void refresh();
    const channel = supabase
      .channel(`cmd-rows:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'command_log', filter: `scenario_id=eq.${scenarioId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scenarioId, enabled, refresh]);

  return rows;
}
