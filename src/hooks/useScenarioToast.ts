'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';

const TOAST_EVENT = 'scenario-toast';

export interface ScenarioToastState {
  id: number;
  text: string;
}

export function useScenarioToast(scenarioId: string) {
  const [toast, setToast] = useState<ScenarioToastState | null>(null);
  const nextId = useRef(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);
  const pendingRef = useRef<string[]>([]);

  const push = useCallback((text: string) => {
    if (!text) return;
    setToast({ id: ++nextId.current, text });
  }, []);

  useEffect(() => {
    subscribedRef.current = false;
    const channel = supabase
      .channel(`toasts:${scenarioId}`, { config: { broadcast: { self: false, ack: false } } })
      .on('broadcast', { event: TOAST_EVENT }, (payload: any) => {
        const text = payload?.payload?.text;
        if (typeof text === 'string') push(text);
      })
      .subscribe(status => {
        if (status !== 'SUBSCRIBED') return;
        subscribedRef.current = true;
        const queued = pendingRef.current;
        pendingRef.current = [];
        for (const text of queued) {
          channel.send({ type: 'broadcast', event: TOAST_EVENT, payload: { text } });
        }
      });
    channelRef.current = channel;
    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [scenarioId, push]);

  const showToast = useCallback((text: string) => {
    push(text);
    if (subscribedRef.current && channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: TOAST_EVENT, payload: { text } });
    } else {
      pendingRef.current.push(text);
    }
  }, [push]);

  const dismissToast = useCallback((id: number) => {
    setToast(current => (current?.id === id ? null : current));
  }, []);

  return { toast, showToast, dismissToast };
}
