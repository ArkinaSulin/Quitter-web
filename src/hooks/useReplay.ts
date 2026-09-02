// src/hooks/useReplay.ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  buildReplayTimeline,
  replayStateToUnits,
  CommandLogRow,
  ReplayStep,
} from '@/lib/commandHistory';
import { Unit, AllianceGroup } from '@/types/gameProtocol';

const REPLAY_EVENT = 'replay';

export type ReplayMode = 'play' | 'replay';

type ReplayControlEvent =
  | { type: 'seek'; step: number; controllerId: string }
  | { type: 'play'; controllerId: string }
  | { type: 'pause'; controllerId: string }
  | { type: 'mode'; mode: ReplayMode; controllerId: string };

interface ReplaySync {
  scenarioId: string;
  channel: ReturnType<typeof supabase.channel> | null;
  subscribed: boolean;
  dead: boolean;
  pending: ReplayControlEvent[];
  listeners: number;
  dispatchIncoming: (event: ReplayControlEvent) => void;
}

// One realtime channel per scenario, shared by every hook instance in this client,
// mirroring useMessageSync's StrictMode-safe lifecycle: the channel is recreated
// after a real unmount (listeners -> 0) so dev double-mounting can't leave a dead
// channel that swallows broadcasts.
const replaySyncs = new Map<string, ReplaySync>();

function subscribeChannel(sync: ReplaySync): void {
  const channel = supabase
    .channel(`replay:${sync.scenarioId}`, {
      config: { broadcast: { self: false, ack: false } },
    })
    .on('broadcast', { event: REPLAY_EVENT }, (payload: any) => {
      const event = payload?.payload as ReplayControlEvent | undefined;
      if (!event?.type) return;
      sync.dispatchIncoming(event);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        sync.subscribed = true;
        const queued = sync.pending;
        sync.pending = [];
        for (const e of queued) {
          channel.send({ type: 'broadcast', event: REPLAY_EVENT, payload: e });
        }
      }
    });
  sync.channel = channel;
}

function getReplaySync(scenarioId: string, dispatchIncoming: (event: ReplayControlEvent) => void): ReplaySync {
  const existing = replaySyncs.get(scenarioId);
  if (existing) {
    existing.dispatchIncoming = dispatchIncoming;
    return existing;
  }
  const sync: ReplaySync = {
    scenarioId,
    channel: null,
    subscribed: false,
    dead: false,
    pending: [],
    listeners: 0,
    dispatchIncoming,
  };
  subscribeChannel(sync);
  replaySyncs.set(scenarioId, sync);
  return sync;
}

interface UseReplayOptions {
  /** Initial mode. Mode 1 (standalone replay) passes 'replay'; Mode 2 passes 'play'. */
  initialMode?: ReplayMode;
  /** Current user id — used as the co-watch controller identity. */
  playerId?: string;
}

export function useReplay(scenarioId: string, { initialMode = 'play', playerId = '' }: UseReplayOptions = {}) {
  const [steps, setSteps] = useState<ReplayStep[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mode, setModeState] = useState<ReplayMode>(initialMode);
  const [controllerId, setControllerId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Re-fetch the timeline whenever we (re)enter replay mode, so a mid-session
  // recap includes commands executed since mount.
  const [reloadKey, setReloadKey] = useState(0);

  // True while a state change came from a broadcast/realtime payload (not a local
  // action), so the persist effect below does NOT echo it straight back to the DB.
  const applyingRemoteRef = useRef(false);
  // Cursor to apply once the timeline finishes loading (late-joiner catch-up).
  const pendingCursorRef = useRef<number | null>(null);
  // Set once the initial replay_state read resolves, so the persist effect never
  // clobbers the driver's state with a pre-read default ('play').
  const hydratedRef = useRef(false);

  const stepsRef = useRef<ReplayStep[]>([]);
  stepsRef.current = steps;
  const cursorRef = useRef(0);
  cursorRef.current = cursor;

  // Re-bind when scenarioId changes so a different scenario gets its own channel.
  const syncRef = useRef<ReplaySync | null>(null);
  if (!syncRef.current || syncRef.current.scenarioId !== scenarioId) {
    syncRef.current = getReplaySync(scenarioId, (event) => {
      applyingRemoteRef.current = true;
      switch (event.type) {
        case 'seek':
          setCursor(Math.max(0, Math.min(event.step, stepsRef.current.length)));
          break;
        case 'play':
          setPlaying(true);
          break;
        case 'pause':
          setPlaying(false);
          break;
        case 'mode':
          setModeState(event.mode);
          if (event.mode === 'replay') {
            // Entering replay via another player must load the same timeline and
            // reset playback, mirroring local setMode — otherwise a player present
            // at the toggle lands on an empty 0/0 timeline.
            setPlaying(false);
            setCursor(0);
            setReloadKey(k => k + 1);
          }
          break;
      }
      if (event.controllerId) setControllerId(event.controllerId);
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
        replaySyncs.delete(scenarioId);
      }
    };
  }, [scenarioId]);

  const send = useCallback((event: ReplayControlEvent) => {
    const sync = syncRef.current!;
    if (sync.channel && sync.subscribed) {
      sync.channel.send({ type: 'broadcast', event: REPLAY_EVENT, payload: event });
    } else {
      sync.pending.push(event);
    }
  }, []);

  // Load the timeline per scenario (and again on each replay entry).
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSteps([]);
    setCursor(0);
    supabase
      .from('command_log')
      .select('id, scenario_id, player_id, player_name, action_type, description, sub_steps, chained, created_at, deleted_at')
      .eq('scenario_id', scenarioId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[Replay] Load failed:', error);
          return;
        }
        const timeline = buildReplayTimeline((data ?? []) as CommandLogRow[]);
        setSteps(timeline);
        setLoaded(true);
        // Late-joiner catch-up: apply the persisted cursor once the timeline lands.
        if (pendingCursorRef.current !== null) {
          setCursor(Math.max(0, Math.min(pendingCursorRef.current, timeline.length)));
          pendingCursorRef.current = null;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scenarioId, reloadKey]);

  // ---- replay_state: DB-persisted co-watch state so late joiners catch up. ----
  // Read once on mount: auto-enter replay with the driver's cursor if replaying.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('replay_state')
      .select('mode, cursor, playing')
      .eq('scenario_id', scenarioId)
      .maybeSingle()
      .then(({ data, error }) => {
        hydratedRef.current = true;
        if (cancelled || error || !data) return;
        if (data.mode === 'replay') {
          applyingRemoteRef.current = true;
          setModeState('replay');
          setPlaying(!!data.playing);
          pendingCursorRef.current = data.cursor ?? 0;
          setReloadKey(k => k + 1);
        }
      });
    return () => { cancelled = true; };
  }, [scenarioId]);

  // Persist local mode/cursor/playing (debounced) so a late joiner can catch up
  // to the current replay state. Skipped for state that arrived via broadcast
  // (the driver's own changes are what reaches the DB, not echoed follower state)
  // and until the initial read resolves (so we never clobber the driver's state
  // with a pre-read default).
  useEffect(() => {
    if (!hydratedRef.current || applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      supabase
        .from('replay_state')
        .upsert({ scenario_id: scenarioId, mode, cursor, playing, updated_at: new Date().toISOString() })
        .then(({ error }) => {
          if (error) console.error('[Replay] Persist failed:', error);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [scenarioId, mode, cursor, playing]);

  // Playback clock: advance one step per 1000/speed ms while playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setCursor((c) => {
        if (c >= stepsRef.current.length) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed]);

  const seek = useCallback((step: number) => {
    const clamped = Math.max(0, Math.min(step, stepsRef.current.length));
    setCursor(clamped);
    send({ type: 'seek', step: clamped, controllerId: playerId });
  }, [send, playerId]);

  const play = useCallback(() => {
    setPlaying(true);
    send({ type: 'play', controllerId: playerId });
  }, [send, playerId]);

  const pause = useCallback(() => {
    setPlaying(false);
    send({ type: 'pause', controllerId: playerId });
  }, [send, playerId]);

  const stepFwd = useCallback(() => {
    seek(cursorRef.current + 1);
  }, [seek]);

  const stepBack = useCallback(() => {
    seek(cursorRef.current - 1);
  }, [seek]);

  const setMode = useCallback((next: ReplayMode) => {
    setModeState(next);
    if (next === 'replay') {
      setPlaying(false);
      setCursor(0);
      setReloadKey(k => k + 1);
    }
    send({ type: 'mode', mode: next, controllerId: playerId });
  }, [send, playerId]);

  // Cursor semantics: 0 = empty world (before any command); cursor = N means the
  // state after the first N command groups. steps.length = final state.
  const currentStep = cursor > 0 ? steps[cursor - 1] : undefined;
  const replayUnits: Unit[] = currentStep ? replayStateToUnits(currentStep.state) : [];
  const replayAlliances: Record<string, AllianceGroup> = currentStep?.state.alliances ?? {};
  const replayTurnNumber = (currentStep?.state.scenario?.turn_number as number) ?? 0;
  const replayCurrentTurnAlliance =
    currentStep && typeof currentStep.state.scenario?.current_turn_alliance === 'string'
      ? (currentStep.state.scenario.current_turn_alliance as AllianceGroup)
      : null;

  // Slider marker: the cursor value (1-based step count) of the first frame where
  // turn 1 begins — i.e. the first step whose state has turn_number >= 1. Returns
  // -1 when the timeline never leaves turn 0 (no marker to draw).
  const turnOneIndex = useMemo(() => {
    for (let i = 0; i < steps.length; i++) {
      const tn = steps[i].state.scenario?.turn_number as number | undefined;
      if (typeof tn === 'number' && tn >= 1) return i + 1;
    }
    return -1;
  }, [steps]);

  return {
    loaded,
    steps,
    cursor,
    playing,
    speed,
    mode,
    controllerId,
    replayUnits,
    replayAlliances,
    replayTurnNumber,
    replayCurrentTurnAlliance,
    turnOneIndex,
    seek,
    play,
    pause,
    stepFwd,
    stepBack,
    setMode,
    setSpeed,
  };
}
