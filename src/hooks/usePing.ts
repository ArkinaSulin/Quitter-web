// src/hooks/usePing.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Hex } from '@/types/gameProtocol';

const PING_EVENT = 'ping';
const PING_LIFETIME = 1300;
const MAX_PINGS = 10;

export interface Ping {
  id: string;
  hex: Hex;
  name: string;
  createdAt: number;
}

interface PingSync {
  scenarioId: string;
  channel: ReturnType<typeof supabase.channel> | null;
  subscribed: boolean;
  dead: boolean;
  pending: Ping[];
  listeners: number;
  dispatchIncoming: (ping: Ping) => void;
}

// One broadcast channel per scenario, shared by every hook instance in this client
// (StrictMode-safe lifecycle copied from useReplay).
const pingSyncs = new Map<string, PingSync>();

function subscribeChannel(sync: PingSync): void {
  const channel = supabase
    .channel(`ping:${sync.scenarioId}`, {
      config: { broadcast: { self: false, ack: false } },
    })
    .on('broadcast', { event: PING_EVENT }, (payload: any) => {
      const ping = payload?.payload as Ping | undefined;
      if (!ping?.id || !ping.hex) return;
      sync.dispatchIncoming(ping);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        sync.subscribed = true;
        const queued = sync.pending;
        sync.pending = [];
        for (const p of queued) {
          channel.send({ type: 'broadcast', event: PING_EVENT, payload: p });
        }
      }
    });
  sync.channel = channel;
}

function getPingSync(scenarioId: string, dispatchIncoming: (ping: Ping) => void): PingSync {
  const existing = pingSyncs.get(scenarioId);
  if (existing) {
    existing.dispatchIncoming = dispatchIncoming;
    return existing;
  }
  const sync: PingSync = {
    scenarioId,
    channel: null,
    subscribed: false,
    dead: false,
    pending: [],
    listeners: 0,
    dispatchIncoming,
  };
  subscribeChannel(sync);
  pingSyncs.set(scenarioId, sync);
  return sync;
}

/**
 * Any participant can ctrl/meta-click the map to drop an attention ping that all
 * room clients see as expanding concentric rings (rendered by PingLayer).
 */
export function usePing(scenarioId: string) {
  const [pings, setPings] = useState<Ping[]>([]);

  const syncRef = useRef<PingSync | null>(null);
  if (!syncRef.current || syncRef.current.scenarioId !== scenarioId) {
    syncRef.current = getPingSync(scenarioId, (ping) => {
      setPings(prev => [...prev.slice(-(MAX_PINGS - 1)), ping]);
      setTimeout(() => {
        setPings(prev => prev.filter(p => p.id !== ping.id));
      }, PING_LIFETIME);
    });
  }

  useEffect(() => {
    const sync = syncRef.current!;
    if (sync.dead) {
      sync.dead = false;
      sync.subscribed = false;
      subscribeChannel(sync);
    }
    sync.listeners += 1;
    return () => {
      sync.listeners -= 1;
      if (sync.listeners <= 0) {
        if (sync.channel) supabase.removeChannel(sync.channel);
        sync.dead = true;
        sync.subscribed = false;
        sync.channel = null;
        pingSyncs.delete(scenarioId);
      }
    };
  }, [scenarioId]);

  const pingAtHex = useCallback((hex: Hex, name: string) => {
    const ping: Ping = { id: crypto.randomUUID(), hex, name, createdAt: Date.now() };
    const sync = syncRef.current!;
    setPings(prev => [...prev.slice(-(MAX_PINGS - 1)), ping]);
    if (sync.channel && sync.subscribed) {
      sync.channel.send({ type: 'broadcast', event: PING_EVENT, payload: ping });
    } else {
      sync.pending.push(ping);
    }
    setTimeout(() => {
      setPings(prev => prev.filter(p => p.id !== ping.id));
    }, PING_LIFETIME);
  }, []);

  return { pings, pingAtHex };
}
