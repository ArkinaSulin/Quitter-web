// src/components/ScenarioMap/UndoDebugPanel.tsx
'use client';

// Debug view of the scenario's command log (the undo queue). Shows every command
// with its description, the actor (player_name), undo status (deleted_at) and
// chained flag; the most recent step is highlighted. Visible to everyone.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { CommandLogRow } from '@/lib/commandHistory';

interface UndoDebugPanelProps {
  scenarioId: string;
}

export function UndoDebugPanel({ scenarioId }: UndoDebugPanelProps) {
  const [rows, setRows] = useState<CommandLogRow[]>([]);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('command_log')
      .select('id, scenario_id, player_id, player_name, action_type, description, sub_steps, chained, created_at, deleted_at')
      .eq('scenario_id', scenarioId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error('[UndoDebug] Load error:', error);
      return;
    }
    setRows((data ?? []) as CommandLogRow[]);
  }, [scenarioId]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`undo-debug:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'command_log', filter: `scenario_id=eq.${scenarioId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'command_log', filter: `scenario_id=eq.${scenarioId}` },
        refresh,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scenarioId, refresh]);

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-gray-500">command_log — most recent first (highlighted = latest step)</div>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-4">No commands yet.</div>
      ) : (
        <div className="text-[11px]">
          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1 bg-gray-800/80 rounded-t text-gray-400 font-semibold">
            <span>Description</span>
            <span>Actor</span>
            <span>Status</span>
            <span>Chained</span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto border border-gray-700 rounded-b bg-gray-900/40 divide-y divide-gray-800">
            {rows.map((r, i) => (
              <div
                key={r.id}
                className={`grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 items-baseline ${
                  i === 0 ? 'bg-amber-900/40 text-amber-100 font-semibold' : 'text-gray-300'
                }`}
              >
                <span className="truncate" title={r.description}>{r.description || '—'}</span>
                <span className="text-gray-400 truncate max-w-[72px]" title={r.player_name}>{r.player_name || '—'}</span>
                <span className={r.deleted_at ? 'text-red-400' : 'text-gray-400'}>{r.deleted_at ? 'undid' : '---'}</span>
                <span className="text-gray-400">{r.chained ? 'Y' : 'N'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
