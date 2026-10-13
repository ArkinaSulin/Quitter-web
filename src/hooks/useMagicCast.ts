// src/hooks/useMagicCast.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import { Weapon, SaveStat } from '@/packages/units';
import { SpellCastTokenSnapshot } from '@/components/TokenRenderer/drawToken';

const MAGIC_EVENT = 'magic-cast';

/** The target unit's six ability save bonuses (captured at cast open). */
export interface UnitSaveStats {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface MagicCircle {
  /** Center X as a fraction of the canvas width (0..1). */
  cx: number;
  /** Center Y as a fraction of the canvas height (0..1). */
  cy: number;
  /** Radius as a fraction of the canvas width (0..1). */
  r: number;
}

/** One placed area marker (a shape + the troop dots it covers). A normal spell
 *  has a single marker; a war-machine bombardment places up to `maxMarkers`
 *  (one per landed shot). */
export interface MagicMarker {
  circle: MagicCircle;
  affectedCount: number;
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
  /** Placed area markers (each = a covered circle + its troop count). */
  markers: MagicMarker[];
  /** How many markers may be placed (1 for a normal spell; #hits for a war
   *  machine bombardment). */
  maxMarkers: number;
  /** Rotation (degrees) of the area shape (cube/cone; circle is symmetric). */
  rotation: number;
  /** Which of the 6 ability save bonuses the target rolls, or 'none' (no save). */
  saveStat: SaveStat | 'none';
  /** The target unit's six ability save bonuses (for display + resolve). */
  targetStats: UnitSaveStats;
  saveDC: number;
  /** true = half damage on a successful save; false = negate (0) on success. */
  halfOnSave: boolean;
  resolved: boolean;
  result: MagicCastResult | null;
  /** This cast is an archer REACTION (spends the reaction + counts to the cap). */
  reaction?: boolean;
}

type MagicCastEvent =
  | { type: 'open'; id: string; casterId: string; casterName: string; casterUnitId: string; targetUnitId: string; targetUnitName: string; weapon: Weapon; snapshot: SpellCastTokenSnapshot; targetStats: UnitSaveStats; maxMarkers?: number; reaction?: boolean }
  | { type: 'cancel'; id: string }
  | { type: 'markers'; id: string; markers: MagicMarker[] }
  | { type: 'rotate'; id: string; rotation: number }
  | { type: 'save'; id: string; saveStat: SaveStat | 'none'; saveDC: number; halfOnSave: boolean }
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
              targetStats: event.targetStats,
              markers: [],
              maxMarkers: event.maxMarkers ?? 1,
              rotation: 0,
              saveStat: (event.weapon.savingThrow ?? 'Dex') as SaveStat | 'none',
              saveDC: event.weapon.saveDC ?? 10,
              halfOnSave: event.weapon.onSaveHalfOrNeg ?? true,
              resolved: false,
              result: null,
              reaction: !!event.reaction,
            };
          }
          return prev;
        }
        switch (event.type) {
          case 'cancel':
            return null;
          case 'markers':
            return { ...prev, markers: event.markers };
          case 'rotate':
            return { ...prev, rotation: event.rotation };
          case 'save':
            return { ...prev, saveStat: event.saveStat, saveDC: event.saveDC, halfOnSave: event.halfOnSave };
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

  const openCast = useCallback((opts: { casterId: string; casterName: string; casterUnitId: string; targetUnitId: string; targetUnitName: string; weapon: Weapon; snapshot: SpellCastTokenSnapshot; targetStats: UnitSaveStats; maxMarkers?: number; reaction?: boolean }) => {
    const id = crypto.randomUUID();
    const maxMarkers = Math.max(1, opts.maxMarkers ?? 1);
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
      targetStats: opts.targetStats,
      maxMarkers,
      reaction: opts.reaction,
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
      targetStats: opts.targetStats,
      markers: [],
      maxMarkers,
      rotation: 0,
      saveStat: (opts.weapon.savingThrow ?? 'Dex') as SaveStat | 'none',
      saveDC: opts.weapon.saveDC ?? 10,
      halfOnSave: opts.weapon.onSaveHalfOrNeg ?? true,
      resolved: false,
      result: null,
      reaction: !!opts.reaction,
    });
    send(event);
  }, [send]);

  const cancelCast = useCallback(() => {
    const current = castRef.current;
    if (!current) return;
    setCast(null);
    send({ type: 'cancel', id: current.id });
  }, [send]);

  const setMarkers = useCallback((markers: MagicMarker[]) => {
    const current = castRef.current;
    if (!current) return;
    setCast({ ...current, markers });
    send({ type: 'markers', id: current.id, markers });
  }, [send]);

  /** Place a marker: append while under `maxMarkers`, else replace the last one. */
  const placeMarker = useCallback((circle: MagicCircle, affectedCount: number) => {
    const current = castRef.current;
    if (!current) return;
    const markers = current.markers.length < current.maxMarkers
      ? [...current.markers, { circle, affectedCount }]
      : (current.markers.length > 0 ? [...current.markers.slice(0, -1), { circle, affectedCount }] : [{ circle, affectedCount }]);
    setMarkers(markers);
  }, [setMarkers]);

  const clearMarkers = useCallback(() => setMarkers([]), [setMarkers]);

  /** Update one marker's covered-troop count (the "Troops affected" stepper). */
  const overrideMarkerCount = useCallback((index: number, affectedCount: number) => {
    const current = castRef.current;
    if (!current) return;
    const clamped = Math.max(0, Math.min(current.snapshot.maxTroopCount, Math.round(affectedCount)));
    setMarkers(current.markers.map((m, i) => (i === index ? { ...m, affectedCount: clamped } : m)));
  }, [setMarkers]);

  const rotateArea = useCallback((rotation: number) => {
    const current = castRef.current;
    if (!current) return;
    const norm = ((rotation % 360) + 360) % 360;
    setCast({ ...current, rotation: norm });
    send({ type: 'rotate', id: current.id, rotation: norm });
  }, [send]);

  const setSave = useCallback((patch: { saveStat?: SaveStat | 'none'; saveDC?: number; halfOnSave?: boolean }) => {
    const current = castRef.current;
    if (!current) return;
    const next = {
      saveStat: patch.saveStat ?? current.saveStat,
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

  return { cast, openCast, cancelCast, placeMarker, clearMarkers, overrideMarkerCount, rotateArea, setSave, sendResolve };
}
