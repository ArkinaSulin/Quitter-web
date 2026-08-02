// src/hooks/useMessageSync.ts
'use client';

import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useMessages } from '@/contexts/MessageContext';

const MESSAGE_EVENT = 'game-message';

interface PendingMessage {
  text: string;
  tone?: string;
}

interface ScenarioSync {
  scenarioId: string;
  channel: ReturnType<typeof supabase.channel> | null;
  subscribed: boolean;
  dead: boolean;
  pending: PendingMessage[];
  listeners: number;
  dispatchIncoming: (text: string, tone?: string) => void;
}

// One realtime channel per scenario, shared by every hook instance in this client
// (ScenarioMap + useGameEngine) so received broadcasts dispatch exactly once.
// The channel is recreated after a real unmount (listeners -> 0) so React StrictMode's
// simulated unmount/remount (dev double-invoked effects) can't leave a dead channel:
// every send would otherwise hit a removed channel and stay local to the sender.
const syncs = new Map<string, ScenarioSync>();

function subscribeChannel(sync: ScenarioSync): void {
  const channel = supabase
    .channel(`messages:${sync.scenarioId}`, {
      config: { broadcast: { self: false, ack: false } },
    })
    .on('broadcast', { event: MESSAGE_EVENT }, (payload: any) => {
      const msg = payload?.payload as PendingMessage | undefined;
      if (!msg?.text) return;
      sync.dispatchIncoming(msg.text, msg.tone);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        sync.subscribed = true;
        const queued = sync.pending;
        sync.pending = [];
        for (const m of queued) {
          channel.send({ type: 'broadcast', event: MESSAGE_EVENT, payload: m });
        }
      }
    });
  sync.channel = channel;
}

function getSync(scenarioId: string, dispatchIncoming: (text: string, tone?: string) => void): ScenarioSync {
  const existing = syncs.get(scenarioId);
  if (existing) {
    existing.dispatchIncoming = dispatchIncoming;
    return existing;
  }

  const sync: ScenarioSync = {
    scenarioId,
    channel: null,
    subscribed: false,
    dead: false,
    pending: [],
    listeners: 0,
    dispatchIncoming,
  };

  subscribeChannel(sync);
  syncs.set(scenarioId, sync);
  return sync;
}

/**
 * Bridges the local MessageContext to Supabase Realtime broadcast on a per-scenario
 * channel so every connected client sees the same message log.
 *
 * The sender dispatches locally AND broadcasts (`self: false` means it never receives
 * its own message back, avoiding duplicates); other clients dispatch on receipt.
 * Messages sent before the channel subscribes are buffered and flushed on SUBSCRIBED.
 */
export function useMessageSync(scenarioId: string) {
  const { addMessage, addError } = useMessages();

  const addMessageRef = useRef(addMessage);
  const addErrorRef = useRef(addError);
  addMessageRef.current = addMessage;
  addErrorRef.current = addError;

  // Re-bind when scenarioId changes so a different scenario gets its own channel.
  const syncRef = useRef<ScenarioSync | null>(null);
  if (!syncRef.current || syncRef.current.scenarioId !== scenarioId) {
    syncRef.current = getSync(scenarioId, (text, tone) => {
      if (tone === 'error') addErrorRef.current(text);
      else addMessageRef.current(text);
    });
  }

  useEffect(() => {
    const sync = syncRef.current!;
    // A previous unmount removed this channel — bring it back before sending.
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
        syncs.delete(scenarioId);
      }
    };
  }, [scenarioId]);

  const send = useCallback((msg: PendingMessage) => {
    const sync = syncRef.current!;
    if (sync.channel && sync.subscribed) {
      sync.channel.send({ type: 'broadcast', event: MESSAGE_EVENT, payload: msg });
    } else {
      sync.pending.push(msg);
    }
  }, []);

  const syncAddMessage = useCallback((text: string) => {
    addMessageRef.current(text);
    send({ text });
  }, [send]);

  const syncAddError = useCallback((text: string) => {
    addErrorRef.current(text);
    send({ text, tone: 'error' });
  }, [send]);

  return { addMessage: syncAddMessage, addError: syncAddError };
}
