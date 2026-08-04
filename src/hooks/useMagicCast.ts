// src/hooks/useMagicCast.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Weapon } from '@/lib/weaponParser';
import { SpellCastTokenSnapshot } from '@/components/TokenRenderer/drawToken';

const MAGIC_EVENT = 'magic-cast';

export interface MagicCircle {
  /** Center X as a fraction of the canvas width (0..1). */
  cx: number;
  /** Center Y as a fraction of the canvas height (0..1). */
  cy: number;
  /** Radius as a fraction of the canvas width (0..1). */
  r: number;
}

export interface MagicCastResult {
  baseDamage: number;
  totalDamage: number;
  troopsKilled: number;
  newHp: number;
  savedCount: number;
  failedCount: number;
  description: string;
}

export interface MagicCastState {
  id: string;
  open: boolean;
  casterId: string;
  casterName: string;
  casterUnitId: string;
  targetUnitId: string;
  targetUnitName: string;
  weapon: Weapon;
  /** Snapshot of the target's troop layout so every client draws the same token. */
  snapshot: SpellCastTokenSnapshot;
  circle: MagicCircle | null;
  /** Number of dots/triangles covered by the circle (auto-computed, overridable). */
  affectedCount: number;
  countManual: boolean;
  saveBonus: number;
  saveDC: number;
  /** true = half damage on a successful save; false = negate (0) on success. */
  halfOnSave: boolean;
  resolved: boolean;
  result: MagicCastResult | null;
}

type MagicCastEvent =
  | { type: 'open'; id: string; casterId: string; casterName: string; casterUnitId: string; targetUnitId: string; targetUnitName: string; weapon: Weapon; snapshot: SpellCastTokenSnapshot }
  | { type: 'cancel'; id: string }
  | { type: 'place'; id: string; circle: MagicCircle; affectedCount: number }
  | { type: 'count'; id: string; affectedCount: number; countManual: boolean }
  | { type: 'save'; id: string; saveBonus: number; saveDC: number; halfOnSave: boolean }
  | { type: 'resolve'; id: string; result: MagicCastResult };

interface MagicCastSync {
  scenarioId: string;
  channel: ReturnType<typeof supabase.channel> | null;
  subscribed: boolean;
  dead: boolean;
  pending: MagicCastEvent[];
  listeners: number;
  dispatchIncoming: (event: MagicCastEvent) => void;
}

// One realtime broadcast channel per scenario, shared by every hook instance in
// this client, mirroring useReplay's StrictMode-safe lifecycle.
const magicSyncs = new Map<string, MagicCastSync>();

function subscribeChannel(sync: MagicCastSync): void {
  const channel = supabase
    .channel(`magic:${sync.scenarioId}`, {
      config: { broadcast: { self: false, ack: false } },
    })
    .on('broadcast', { event: MAGIC_EVENT }, (payload: any) => {
      const event = payload?.payload as MagicCastEvent | undefined;
      if (!event?.type) return;
      sync.dispatchIncoming(event);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        sync.subscribed = true;
        const queued = sync.pending;
        sync.pending = [];
        for (const e of queued) {
          channel.send({ type: 'broadcast', event: MAGIC_EVENT, payload: e });
        }
      }
    });
  sync.channel = channel;
}

function getMagicSync(scenarioId: string, dispatchIncoming: (event: MagicCastEvent) => void): MagicCastSync {
  const existing = magicSyncs.get(scenarioId);
  if (existing) {
    existing.dispatchIncoming = dispatchIncoming;
    return existing;
  }
  const sync: MagicCastSync = {
    scenarioId,
    channel: null,
    subscribed: false,
    dead: false,
    pending: [],
    listeners: 0,
    dispatchIncoming,
  };
  subscribeChannel(sync);
  magicSyncs.set(scenarioId, sync);
  return sync;
}

export function useMagicCast(scenarioId: string) {
  const [cast, setCast] = useState<MagicCastState | null>(null);
  const castRef = useRef<MagicCastState | null>(null);
  castRef.current = cast;

  const syncRef = useRef<MagicCastSync | null>(null);
  if (!syncRef.current || syncRef.current.scenarioId !== scenarioId) {
    syncRef.current = getMagicSync(scenarioId, (event) => {
      setCast((prev) => {
        if (!prev || prev.id !== event.id) {
          if (event.type === 'open') {
            return {
              id: event.id,
              open: true,
              casterId: event.casterId,
              casterName: event.casterName,
              casterUnitId: event.casterUnitId,
              targetUnitId: event.targetUnitId,
              targetUnitName: event.targetUnitName,
              weapon: event.weapon,
              snapshot: event.snapshot,
              circle: null,
              affectedCount: 0,
              countManual: false,
              saveBonus: 0,
              saveDC: 10,
              halfOnSave: true,
              resolved: false,
              result: null,
            };
          }
          return prev;
        }
        switch (event.type) {
          case 'cancel':
            return null;
          case 'place':
            return { ...prev, circle: event.circle, affectedCount: event.affectedCount, countManual: false };
          case 'count':
            return { ...prev, affectedCount: event.affectedCount, countManual: event.countManual };
          case 'save':
            return { ...prev, saveBonus: event.saveBonus, saveDC: event.saveDC, halfOnSave: event.halfOnSave };
          case 'resolve':
            return { ...prev, resolved: true, result: event.result };
          default:
            return prev;
        }
      });
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
        magicSyncs.delete(scenarioId);
      }
    };
  }, [scenarioId]);

  const send = useCallback((event: MagicCastEvent) => {
    const sync = syncRef.current!;
    if (sync.channel && sync.subscribed) {
      sync.channel.send({ type: 'broadcast', event: MAGIC_EVENT, payload: event });
    } else {
      sync.pending.push(event);
    }
  }, []);

  const openCast = useCallback((opts: { casterId: string; casterName: string; casterUnitId: string; targetUnitId: string; targetUnitName: string; weapon: Weapon; snapshot: SpellCastTokenSnapshot }) => {
    const id = crypto.randomUUID();
    const event: MagicCastEvent = {
      type: 'open',
      id,
      casterId: opts.casterId,
      casterName: opts.casterName,
      casterUnitId: opts.casterUnitId,
      targetUnitId: opts.targetUnitId,
      targetUnitName: opts.targetUnitName,
      weapon: opts.weapon,
      snapshot: opts.snapshot,
    };
    setCast({
      id,
      open: true,
      casterId: opts.casterId,
      casterName: opts.casterName,
      casterUnitId: opts.casterUnitId,
      targetUnitId: opts.targetUnitId,
      targetUnitName: opts.targetUnitName,
      weapon: opts.weapon,
      snapshot: opts.snapshot,
      circle: null,
      affectedCount: 0,
      countManual: false,
      saveBonus: 0,
      saveDC: 10,
      halfOnSave: true,
      resolved: false,
      result: null,
    });
    send(event);
  }, [send]);

  const cancelCast = useCallback(() => {
    const current = castRef.current;
    if (!current) return;
    setCast(null);
    send({ type: 'cancel', id: current.id });
  }, [send]);

  const placeCircle = useCallback((circle: MagicCircle, affectedCount: number) => {
    const current = castRef.current;
    if (!current) return;
    setCast({ ...current, circle, affectedCount, countManual: false });
    send({ type: 'place', id: current.id, circle, affectedCount });
  }, [send]);

  const overrideCount = useCallback((affectedCount: number) => {
    const current = castRef.current;
    if (!current) return;
    const clamped = Math.max(0, Math.min(current.snapshot.maxTroopCount, Math.round(affectedCount)));
    setCast({ ...current, affectedCount: clamped, countManual: true });
    send({ type: 'count', id: current.id, affectedCount: clamped, countManual: true });
  }, [send]);

  const setSave = useCallback((patch: { saveBonus?: number; saveDC?: number; halfOnSave?: boolean }) => {
    const current = castRef.current;
    if (!current) return;
    const next = {
      saveBonus: patch.saveBonus ?? current.saveBonus,
      saveDC: patch.saveDC ?? current.saveDC,
      halfOnSave: patch.halfOnSave ?? current.halfOnSave,
    };
    setCast({ ...current, ...next });
    send({ type: 'save', id: current.id, ...next });
  }, [send]);

  const sendResolve = useCallback((result: MagicCastResult) => {
    const current = castRef.current;
    if (!current) return;
    setCast({ ...current, resolved: true, result });
    send({ type: 'resolve', id: current.id, result });
  }, [send]);

  return { cast, openCast, cancelCast, placeCircle, overrideCount, setSave, sendResolve };
}
