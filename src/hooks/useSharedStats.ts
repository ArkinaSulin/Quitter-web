'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import type { BattleStats } from '@/packages/battle';

const STATS_EVENT = 'scenario-stats';

/**
 * Shares a read-only scenario-statistics snapshot with every client in the
 * scenario. The DM computes the exact table once and broadcasts it, so players
 * see the same modal the DM sees (including hidden units) without needing the
 * full command log locally.
 */
export function useSharedStats(scenarioId: string) {
  const [sharedStats, setSharedStats] = useState<BattleStats | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);
  const pendingRef = useRef<BattleStats[]>([]);

  useEffect(() => {
    subscribedRef.current = false;
    const channel = supabase
      .channel(`stats:${scenarioId}`, { config: { broadcast: { self: false, ack: false } } })
      .on('broadcast', { event: STATS_EVENT }, (payload: any) => {
        const stats = payload?.payload?.stats as BattleStats | undefined;
        if (stats && Array.isArray(stats.alliances)) setSharedStats(stats);
      })
      .subscribe(status => {
        if (status !== 'SUBSCRIBED') return;
        subscribedRef.current = true;
        const queued = pendingRef.current;
        pendingRef.current = [];
        for (const stats of queued) {
          channel.send({ type: 'broadcast', event: STATS_EVENT, payload: { stats } });
        }
      });
    channelRef.current = channel;
    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [scenarioId]);

  const shareStats = useCallback((stats: BattleStats) => {
    if (subscribedRef.current && channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: STATS_EVENT, payload: { stats } });
    } else {
      pendingRef.current.push(stats);
    }
  }, []);

  const clearSharedStats = useCallback(() => setSharedStats(null), []);

  return { sharedStats, shareStats, clearSharedStats };
}
