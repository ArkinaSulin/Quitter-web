'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { computeEffectiveMovement, getFormationMultiplier } from '@/lib/unitStats';
import { applyFormationChange } from '@/lib/formationCost';
import { nextLowerFormation } from '@/lib/formationCost';
import { applyMoveCost, applyMpSpend, applyHeroMoveCost, applyHeroMpSpend } from '@/lib/moveCost';
import { getSetting } from '@/lib/settingsCache';
import { parseWeapons } from '@/lib/weaponParser';
import { isUnitRouted } from '@/lib/unitMorale';
import { useMessageSync } from '@/hooks/useMessageSync';
import { ActionType, SubStep, CommandLogRow, UndoState, parseSubSteps } from '@/lib/commandLog';
import { getActiveGroups, advanceTurn } from '@/lib/turnState';

interface UseGameEngineProps {
  scenarioId: string;
  playerId: string;
  playerName: string;
  isGM: boolean;
  freeMove: boolean;
  applyLocalUnit: (unitId: string, updates: Partial<Unit>) => void;
  refreshUnitsByIds?: (ids: string[]) => Promise<void>;
  setAllianceLocal?: (team: string, group: AllianceGroup) => void;
  setScenarioLocal?: (fields: Record<string, any>) => void;
}

export function useGameEngine({
  scenarioId,
  playerId,
  playerName,
  freeMove,
  applyLocalUnit,
  refreshUnitsByIds,
  setAllianceLocal,
  setScenarioLocal,
}: UseGameEngineProps) {
  const { addMessage, addError } = useMessageSync(scenarioId);

  // Server-derived undo/redo state (what the RPCs consider undoable right now).
  // Rebuilt on mount, on every command_log change, and after each action.
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const undoStateRef = useRef<UndoState | null>(null);
  undoStateRef.current = undoState;

  const refreshUndoState = useCallback(async (): Promise<UndoState | null> => {
    const { data, error } = await supabase.rpc('undo_state', { p_scenario_id: scenarioId });
    if (error) {
      console.error('[UndoState] Refresh failed:', error);
      return null;
    }
    const state = (data as unknown) as UndoState;
    setUndoState(state);
    return state;
  }, [scenarioId]);

  // Realtime command_log events can be missed, so also re-fetch the undo cache
  // on an interval and on window focus (same belt-and-braces as UndoDebugPanel /
  // useTeamAlliances). Keeps the Undo/Redo buttons from going stale mid-session.
  useEffect(() => {
    refreshUndoState();
    const t = setInterval(() => { refreshUndoState(); }, 5000);
    const onFocus = () => { refreshUndoState(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshUndoState]);

  /**
   * Apply sub-step deltas to local state (optimistic UI; realtime confirms the
   * server's authoritative apply). `field` picks `from` (undo) or `to`
   * (execute/redo); `reverse` replays newest-first like the server's undo.
   */
  const applyDeltas = useCallback(
    async (steps: SubStep[], field: 'from' | 'to', reverse: boolean, commandSeq?: number): Promise<void> => {
      // Optimistic LOCAL apply only — the server RPCs (execute_command /
      // undo_commands / redo_commands) are the ONLY writers to the DB. Painting
      // local state here keeps the UI snappy; realtime confirms the authoritative
      // apply. (Writing directly to the DB from the client raced realtime and
      // broke undo — each command was written twice with conflicting command_seq.)
      //
      // `commandSeq` is the executing/undone command's authoritative stamp. We set
      // it on the local unit so the realtime handler's stale-event guard can drop
      // any PRE-command realtime event that lands late (the undo "snaps back" bug).
      const list = reverse ? [...steps].reverse() : steps;
      for (const step of list) {
        if (step.type === 'ALLIANCE' && setAllianceLocal) {
          for (const change of step.changes) {
            setAllianceLocal(step.unitId, change[field] as AllianceGroup);
          }
        } else if (step.type === 'SCENARIO' && setScenarioLocal) {
          const update: any = {};
          for (const change of step.changes) {
            update[change.field] = change[field];
          }
          if (Object.keys(update).length > 0) {
            setScenarioLocal(update);
          }
        } else {
          const update: any = {};
          for (const change of step.changes) {
            update[change.field] = change[field];
          }
          if (commandSeq !== undefined) update.commandSeq = commandSeq;
          if (Object.keys(update).length > 0) {
            applyLocalUnit(step.unitId, update);
          }
        }
      }
    },
    [applyLocalUnit, setAllianceLocal, setScenarioLocal],
  );

  // All unit ids touched by a batch of sub-steps (units written by the command).
  const touchedUnitIds = useCallback(
    (rows: CommandLogRow[]): string[] => {
      const ids: string[] = [];
      for (const row of rows) {
        for (const step of parseSubSteps(row.sub_steps)) {
          if (step.unitId && step.type !== 'ALLIANCE' && step.type !== 'SCENARIO') {
            ids.push(step.unitId);
          }
        }
      }
      return ids;
    },
    [],
  );

  const execute = useCallback(
    async (
      actionType: ActionType,
      subSteps: SubStep[],
      description: string,
      options?: { chained?: boolean },
    ): Promise<CommandLogRow | null> => {
      const isChained = options?.chained ?? false;

      // Server-authoritative: apply the deltas and insert the log row in ONE
      // transaction, so the units table and the command log can never diverge.
      const { data, error } = await supabase.rpc('execute_command', {
        p_scenario_id: scenarioId,
        p_player_id: playerId,
        p_player_name: playerName,
        p_action_type: actionType,
        p_description: description,
        p_sub_steps: subSteps,
        p_chained: isChained,
      });
      if (error || !data || (data as any[]).length === 0) {
        console.error('[CommandLog] Execute failed:', error);
        addError(`Action failed — ${description}`);
        return null;
      }

      const row = (data as any[])[0] as CommandLogRow;

      // Optimistic local apply for snappiness; realtime confirms.
      // Stamp the local unit with this command's authoritative seq so a late
      // pre-command realtime event can't regress the optimistic paint.
      await applyDeltas(subSteps, 'to', false, row?.seq);

      // Authoritative convergence: refetch the touched units from the DB. The
      // per-change server writes emit multiple realtime events per unit with the
      // SAME command_seq, and the stale-guard applies the first and drops the
      // rest — leaving non-optimistic clients (e.g. the DM) on an intermediate
      // state. Refetching the DB's final row makes every client match the truth,
      // immune to event ordering (same pattern undo/redo already use).
      if (refreshUnitsByIds) {
        const touched = touchedUnitIds([row]);
        if (touched.length > 0) await refreshUnitsByIds(touched);
      }

      // Unit edits (incl. by players editing their own unit) are flagged to everyone.
      if (actionType === 'EDIT_UNIT') addError(description);
      else addMessage(description);
      refreshUndoState();
      return row;
    },
    [scenarioId, playerId, playerName, applyDeltas, refreshUnitsByIds, touchedUnitIds, addMessage, addError, refreshUndoState],
  );

  const subscribeToCommandLog = useCallback((): (() => void) => {
    const channel = supabase
      .channel(`command-log-${scenarioId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'command_log', filter: `scenario_id=eq.${scenarioId}` },
        () => { refreshUndoState(); },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'command_log', filter: `scenario_id=eq.${scenarioId}` },
        () => { refreshUndoState(); },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scenarioId, refreshUndoState]);

  const undo = useCallback(async (): Promise<CommandLogRow[] | null> => {
    // Always fetch a fresh undo_state first — the cached state can lag realtime
    // events, and a stale/null cache is what made undo/redo intermittently do
    // nothing. The RPC still re-validates, so this stays race-safe.
    const fresh = await refreshUndoState();
    const ids = fresh?.undo?.ids;
    if (!ids || ids.length === 0) {
      addMessage('Nothing to undo right now');
      return null;
    }

    const { data, error } = await supabase.rpc('undo_commands', {
      p_scenario_id: scenarioId,
      p_target_ids: ids,
    });
    if (error || !data || (data as any[]).length === 0) {
      addMessage('Cannot undo — another player has moved since, or the action was already undone');
      await refreshUndoState();
      return null;
    }
    const rows = data as CommandLogRow[];

    // Optimistic revert (newest-first, mirroring the server); realtime confirms.
    // Stamp each reverted unit with its command's authoritative seq so the realtime
    // handler drops the stale pre-undo events (the undo "snaps back" bug).
    for (const entry of [...rows].reverse()) {
      await applyDeltas(parseSubSteps(entry.sub_steps), 'from', true, entry.seq);
    }

    // Authoritative: refetch every touched unit from the DB. Realtime can miss or
    // reorder events, leaving local state divergent (e.g. a hero still marked
    // attached after an undo) — and the NEXT command computed from that stale
    // local state would corrupt the DB. The DB is the only truth after an undo.
    if (refreshUnitsByIds) {
      await refreshUnitsByIds(touchedUnitIds(rows));
    }

    addMessage(rows.length > 1 ? `Undid: ${rows[0].description} — ${rows.length} items` : `Undid: ${rows[0].description}`);
    refreshUndoState();
    return rows;
  }, [scenarioId, addMessage, refreshUndoState, applyDeltas, touchedUnitIds, refreshUnitsByIds]);

  const redo = useCallback(async (): Promise<CommandLogRow[] | null> => {
    const fresh = await refreshUndoState();
    const ids = fresh?.redo?.ids;
    if (!ids || ids.length === 0) {
      addMessage('Nothing to redo right now');
      return null;
    }

    const { data, error } = await supabase.rpc('redo_commands', {
      p_scenario_id: scenarioId,
      p_target_ids: ids,
    });
    if (error || !data || (data as any[]).length === 0) {
      addMessage('Cannot redo — a new action has been made since, or the redo target is gone');
      await refreshUndoState();
      return null;
    }
    const rows = data as CommandLogRow[];

    // Optimistic re-apply (chronological); realtime confirms.
    for (const entry of rows) {
      await applyDeltas(parseSubSteps(entry.sub_steps), 'to', false, entry.seq);
    }

    // Authoritative refetch — same rationale as undo (local/DB divergence would
    // corrupt the next command computed from stale local state).
    if (refreshUnitsByIds) {
      await refreshUnitsByIds(touchedUnitIds(rows));
    }

    addMessage(rows.length > 1 ? `Redid: ${rows[0].description} — ${rows.length} items` : `Redid: ${rows[0].description}`);
    refreshUndoState();
    return rows;
  }, [scenarioId, addMessage, refreshUndoState, applyDeltas, touchedUnitIds, refreshUnitsByIds]);

  const canUndo = useCallback((): boolean => {
    return !!undoStateRef.current?.undo?.canUndo;
  }, []);

  const canRedo = useCallback((): boolean => {
    return !!undoStateRef.current?.redo?.canRedo;
  }, []);

  const peekUndoChainLength = useCallback((): number => {
    return undoStateRef.current?.undo?.count ?? 0;
  }, []);

  const moveUnitRecorded = useCallback(
    async (unit: Unit, targetHex: Hex, cost: number, maxMP: number, attachedHero?: Unit | null, heroMaxMP?: number, description?: string, options?: { chained?: boolean }): Promise<void> => {
      // Heroes convert actions at the prorated rate (5 actions = 1 full move);
      // units keep the "1 action = 1 full MP pool" economy.
      const { movementPointsAvailable, actionsAvailable } = unit.isHero
        ? applyHeroMoveCost(unit, cost, maxMP)
        : applyMoveCost(unit, cost, maxMP);
      const subSteps: SubStep[] = [
        {
          type: 'MOVE',
          description: description ?? `${unit.unitName} moved to (${targetHex.q}, ${targetHex.r})`,
          unitId: unit.id,
          changes: [
            { field: 'hex', from: { ...unit.hex }, to: { ...targetHex } },
            { field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: movementPointsAvailable },
            { field: 'actionsAvailable', from: unit.actionsAvailable, to: actionsAvailable },
          ],
        },
      ];

      // A host with an attached hero moves the combined unit: the hero shares the
      // move cost (its own MP/actions) and its hex follows the host.
      if (attachedHero && heroMaxMP) {
        const heroCost = attachedHero.isHero
          ? applyHeroMoveCost(attachedHero, cost, heroMaxMP)
          : applyMoveCost(attachedHero, cost, heroMaxMP);
        subSteps.push({
          type: 'MOVE',
          description: `${attachedHero.unitName} moved with ${unit.unitName}`,
          unitId: attachedHero.id,
          changes: [
            { field: 'hex', from: { ...attachedHero.hex }, to: { ...targetHex } },
            { field: 'movementPointsAvailable', from: attachedHero.movementPointsAvailable, to: heroCost.movementPointsAvailable },
            { field: 'actionsAvailable', from: attachedHero.actionsAvailable, to: heroCost.actionsAvailable },
          ],
        });
      }

      await execute('MOVE', subSteps, subSteps[0].description, options);
    },
    [execute],
  );

  const moveUnitFree = useCallback(
    async (unit: Unit, targetHex: Hex, attachedHero?: Unit | null): Promise<void> => {
      const subSteps: SubStep[] = [
        {
          type: 'MOVE',
          description: `${unit.unitName} moved freely to (${targetHex.q}, ${targetHex.r})`,
          unitId: unit.id,
          changes: [
            { field: 'hex', from: { ...unit.hex }, to: { ...targetHex } },
          ],
        },
      ];
      if (attachedHero) {
        subSteps.push({
          type: 'MOVE',
          description: `${attachedHero.unitName} moved with ${unit.unitName}`,
          unitId: attachedHero.id,
          changes: [
            { field: 'hex', from: { ...attachedHero.hex }, to: { ...targetHex } },
          ],
        });
      }
      await execute('MOVE', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const rotateUnit = useCallback(
    async (unit: Unit, direction: 'left' | 'right', maxMP: number, steps = 1): Promise<void> => {
      const delta = direction === 'left' ? -steps : steps;
      const newFacing = ((unit.facing + delta) % 6 + 6) % 6;
      const changes: { field: string; from: any; to: any }[] = [
        { field: 'facing', from: unit.facing, to: newFacing },
      ];
      // Movement only pays distance; turning pays its own directional cost —
      // 1 MP per 60° rotate, free for Heroes, Scattered (item 7), and free-move.
      const freeRotate = unit.isHero || freeMove || unit.currentFormation === 'Scattered';
      const isAboutTurn = steps === 3;

      // Mounted units in Close Order are unable to turn around (180° about-turn).
      if (isAboutTurn && (unit.mountId || unit.mountName) && unit.currentFormation === 'Close Order') {
        addMessage(`${unit.unitName} (mounted, Close Order) cannot about-turn — unable to turn around in close formation`);
        return;
      }

      if (!freeRotate) {
        // A 180° about-turn is a single maneuver with its own setting cost
        // (mounted units pay more); ordinary rotations cost 1 MP per 60°.
        const cost = isAboutTurn
          ? (unit.mountId || unit.mountName
              ? getSetting('about_turn_cost_mounted', 2)
              : getSetting('about_turn_cost_foot', 1))
          : 1;
        const { movementPointsAvailable, actionsAvailable } = applyMpSpend(unit, cost, maxMP);
        changes.push({ field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: movementPointsAvailable });
        if (actionsAvailable !== unit.actionsAvailable) {
          changes.push({ field: 'actionsAvailable', from: unit.actionsAvailable, to: actionsAvailable });
        }
      }
      let desc = `${unit.unitName} rotated ${direction}${steps > 1 ? ` ${steps * 60}°` : ''}`;
      // A 180° about-face also costs organization levels (special maneuver).
      if (isAboutTurn && !freeRotate) {
        const penalty = Math.max(0, getSetting('about_turn_org_penalty', 1));
        let current = unit.currentFormation;
        for (let i = 0; i < penalty; i++) {
          const lower = nextLowerFormation(current);
          if (!lower) break;
          current = lower;
        }
        if (current !== unit.currentFormation) {
          changes.push({ field: 'currentFormation', from: unit.currentFormation, to: current });
          desc = `${unit.unitName} about-faced (${unit.mountId || unit.mountName ? getSetting('about_turn_cost_mounted', 2) : getSetting('about_turn_cost_foot', 1)} MP, −${penalty} org)`;
        } else {
          desc = `${unit.unitName} about-faced`;
        }
      }
      const subSteps: SubStep[] = [
        {
          type: 'ROTATE',
          description: desc,
          unitId: unit.id,
          changes,
        },
      ];
      await execute('ROTATE', subSteps, desc);
    },
    [execute, freeMove, addMessage],
  );

  const changeFormation = useCallback(
    async (unit: Unit, formation: string, formationsMap: Record<string, Formation>): Promise<void> => {
      // Shield Wall requires a shield in hand — a two-handed weapon blocks it.
      if (formation === 'Shield Wall') {
        const activeWeapon = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0];
        if (activeWeapon?.isTwoHanded) {
          addMessage(`${unit.unitName} cannot form Shield Wall while wielding ${activeWeapon.name} (two-handed)`);
          return;
        }
      }
      const oldForm = formationsMap[unit.currentFormation];
      const newForm = formationsMap[formation];
      const oldMult = oldForm?.movement_multiplier ?? 1;
      const newMult = newForm?.movement_multiplier ?? 1;
      const oldEffectiveMax = computeEffectiveMovement(unit, oldMult);
      const newEffectiveMax = computeEffectiveMovement(unit, newMult);
      const { movementPointsAvailable: newAvailable, actionsAvailable: newActions } = applyFormationChange(
        unit,
        oldEffectiveMax,
        newEffectiveMax,
      );

      const changes: { field: string; from: any; to: any }[] = [
        { field: 'currentFormation', from: unit.currentFormation, to: formation },
      ];

      if (!unit.isHero && !freeMove) {
        changes.push({ field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: newAvailable });
        if (newActions !== unit.actionsAvailable) {
          changes.push({ field: 'actionsAvailable', from: unit.actionsAvailable, to: newActions });
        }
      }

      if (isUnitRouted(unit) && formation !== 'Routed') {
        const effectiveMorale = unit.baseMorale + unit.currentMoraleModifier + (newForm?.morale_modifier ?? 0);
        if (effectiveMorale <= 0) {
          addMessage(`${unit.unitName} cannot rally — effective morale ${effectiveMorale}`);
          return;
        }
        changes.push({ field: 'isRouting', from: true, to: false });
      }

      const subSteps: SubStep[] = [
        {
          type: 'FORMATION',
          description: `${unit.unitName} changed formation to ${formation}`,
          unitId: unit.id,
          changes,
        },
      ];
      await execute('FORMATION', subSteps, subSteps[0].description);
    },
    [execute, addMessage, freeMove],
  );

  const assignTeam = useCallback(
    async (unit: Unit, team: string): Promise<void> => {
      const subSteps: SubStep[] = [
        {
          type: 'TEAM',
          description: `${unit.unitName} assigned to ${team}`,
          unitId: unit.id,
          changes: [{ field: 'team', from: unit.team, to: team }],
        },
      ];
      await execute('TEAM', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const selectWeapon = useCallback(
    async (unit: Unit, weaponIndex: number): Promise<void> => {
      const weapons = parseWeapons(unit.weaponString || '');
      const nextWeapon = weapons[weaponIndex];
      if (!nextWeapon) return;

      // A two-handed weapon cannot be used while in Shield Wall.
      if (nextWeapon.isTwoHanded && unit.currentFormation === 'Shield Wall') {
        addMessage(`${unit.unitName} cannot wield ${nextWeapon.name} in Shield Wall — drop the formation first`);
        return;
      }

      // Shield is unusable while a two-handed weapon is active: effective AC = baseline - 2.
      const shieldPenalty = unit.isShielded && nextWeapon.isTwoHanded ? 2 : 0;
      const nextAc = (unit.baselineAc || 10) - shieldPenalty;
      const fromAc = unit.currentAc;

      const subSteps: SubStep[] = [
        {
          type: 'WEAPON_SELECT',
          description: `${unit.unitName} switches to ${nextWeapon.name}${shieldPenalty > 0 ? ' (drops shield, -2 AC)' : ''}`,
          unitId: unit.id,
          changes: [
            { field: 'activeWeaponIndex', from: unit.activeWeaponIndex ?? 0, to: weaponIndex },
            { field: 'currentAc', from: fromAc, to: nextAc },
          ],
        },
      ];
      await execute('WEAPON_SELECT', subSteps, subSteps[0].description);
    },
    [execute, addMessage],
  );

  const toggleHide = useCallback(
    async (unit: Unit): Promise<void> => {
      const newHidden = !unit.hidden;
      const subSteps: SubStep[] = [
        {
          type: 'HIDE',
          description: `${unit.unitName} ${newHidden ? 'hidden' : 'unhidden'}`,
          unitId: unit.id,
          changes: [{ field: 'hidden', from: unit.hidden, to: newHidden }],
        },
      ];
      await execute('TOGGLE_HIDE', subSteps, subSteps[0].description);
    },
    [execute],
  );

  /** GM-only: manually set a unit to rout (no un-rout). Undoable via the log. */
  const setRouting = useCallback(
    async (unit: Unit): Promise<void> => {
      if (isUnitRouted(unit)) return;
      const subSteps: SubStep[] = [
        {
          type: 'ROUT',
          description: `${unit.unitName} routed (GM)`,
          unitId: unit.id,
          changes: [
            { field: 'currentFormation', from: unit.currentFormation, to: 'Routed' },
          ],
        },
      ];
      await execute('ROUT', subSteps, `${unit.unitName} routed!`);
    },
    [execute],
  );

  const placeUnit = useCallback(
    async (unit: Unit): Promise<void> => {
      const subSteps: SubStep[] = [
        {
          type: 'PLACE',
          description: `Placed ${unit.unitName} at (${unit.hex.q}, ${unit.hex.r})`,
          unitId: unit.id,
          changes: [
            { field: 'isDeleted', from: true, to: false },
          ],
          payload: unit,
        },
      ];
      await execute('PLACE', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const attachHero = useCallback(
    async (hero: Unit, targetUnit: Unit, position: 'front' | 'back', heroMaxMP: number): Promise<void> => {
      const { movementPointsAvailable, actionsAvailable } = applyHeroMpSpend(hero, 1, heroMaxMP);
      const changes: { field: string; from: any; to: any }[] = [
        { field: 'attachedToUnitId', from: null, to: targetUnit.id },
        { field: 'attachedPosition', from: null, to: position },
        { field: 'hex', from: { ...hero.hex }, to: { ...targetUnit.hex } },
        { field: 'movementPointsAvailable', from: hero.movementPointsAvailable, to: movementPointsAvailable },
      ];
      if (actionsAvailable !== hero.actionsAvailable) {
        changes.push({ field: 'actionsAvailable', from: hero.actionsAvailable, to: actionsAvailable });
      }
      const subSteps: SubStep[] = [
        {
          type: 'ATTACH_HERO',
          description: `${hero.unitName} attached to ${targetUnit.unitName} (${position})`,
          unitId: hero.id,
          changes,
        },
      ];
      await execute('ATTACH_HERO', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const detachHero = useCallback(
    async (hero: Unit, heroMaxMP: number): Promise<void> => {
      const { movementPointsAvailable, actionsAvailable } = applyHeroMpSpend(hero, 1, heroMaxMP);
      const changes: { field: string; from: any; to: any }[] = [
        { field: 'attachedToUnitId', from: hero.attachedToUnitId, to: null },
        { field: 'movementPointsAvailable', from: hero.movementPointsAvailable, to: movementPointsAvailable },
      ];
      if (actionsAvailable !== hero.actionsAvailable) {
        changes.push({ field: 'actionsAvailable', from: hero.actionsAvailable, to: actionsAvailable });
      }
      const subSteps: SubStep[] = [
        {
          type: 'DETACH_HERO',
          description: `${hero.unitName} detached from unit`,
          unitId: hero.id,
          changes,
        },
      ];
      await execute('DETACH_HERO', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const swapHeroPosition = useCallback(
    async (hero: Unit, heroMaxMP: number): Promise<void> => {
      if (!hero.attachedToUnitId) return;
      const newPosition = hero.attachedPosition === 'back' ? 'front' : 'back';
      const changes: { field: string; from: any; to: any }[] = [
        { field: 'attachedPosition', from: hero.attachedPosition, to: newPosition },
      ];
      if (!freeMove) {
        const { movementPointsAvailable, actionsAvailable } = applyHeroMpSpend(hero, 1, heroMaxMP);
        changes.push({ field: 'movementPointsAvailable', from: hero.movementPointsAvailable, to: movementPointsAvailable });
        if (actionsAvailable !== hero.actionsAvailable) {
          changes.push({ field: 'actionsAvailable', from: hero.actionsAvailable, to: actionsAvailable });
        }
      }
      const subSteps: SubStep[] = [
        {
          type: 'SWAP_HERO_POSITION',
          description: `${hero.unitName} moved to ${newPosition}`,
          unitId: hero.id,
          changes,
        },
      ];
      await execute('SWAP_HERO_POSITION', subSteps, subSteps[0].description);
    },
    [execute, freeMove],
  );

  const charge = useCallback(
    async (unit: Unit): Promise<void> => {
      // Charge! only locks the unit into charging state. No MP/action is deducted
      // here — those are consumed normally during the subsequent charge move.
      const subSteps: SubStep[] = [
        {
          type: 'CHARGE',
          description: `${unit.unitName} starts a charge`,
          unitId: unit.id,
          changes: [
            { field: 'isCharging', from: false, to: true },
            { field: 'chargeDistance', from: 0, to: 0 },
          ],
        },
      ];
      await execute('CHARGE', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const endTurn = useCallback(
    async (args: {
      currentAlliance: AllianceGroup | null;
      alliances: Record<string, AllianceGroup>;
      units: Unit[];
      formationsMap: Record<string, Formation>;
      turnNumber: number;
      freeMove: boolean;
    }): Promise<{ next: AllianceGroup; wrapped: boolean; turnNumber: number; freeMoveEnded: boolean; ok: boolean }> => {
      const activeGroups = getActiveGroups(args.alliances);
      const { next, wrapped } = advanceTurn(args.currentAlliance, activeGroups);
      // Turn 0 = free play (null alliance). The first End Turn leaves free play and
      // begins Turn 1, which also counts as a turn boundary (turn_number + 1).
      const leavingFreePlay = args.currentAlliance === null;
      const newTurnNumber = (leavingFreePlay || wrapped) ? args.turnNumber + 1 : args.turnNumber;

      const changes: { field: string; from: any; to: any }[] = [
        { field: 'current_turn_alliance', from: args.currentAlliance ?? null, to: next },
        { field: 'turn_number', from: args.turnNumber, to: newTurnNumber },
      ];
      // Free move is a turn-0 convenience: it ends automatically once the first
      // real turn begins. The DM can still toggle it back on manually.
      if (leavingFreePlay) {
        changes.push({ field: 'free_move', from: args.freeMove, to: false });
      }

      const subSteps: SubStep[] = [
        {
          type: 'SCENARIO',
          description: `Turn advances — ${next} turn begins`,
          unitId: scenarioId,
          changes,
        },
      ];

      // Charge forfeit: units in the ending group that charged but never used their
      // free attack drop one organization level and clear their charge state.
      const endingTeams = new Set<string>();
      for (const [team, group] of Object.entries(args.alliances)) {
        if (group === args.currentAlliance) endingTeams.add(team);
      }

      for (const unit of args.units) {
        if (unit.isDeleted || !unit.isCharging || !endingTeams.has(unit.team)) continue;
        const lower = nextLowerFormation(unit.currentFormation);
        const changes: { field: string; from: any; to: any }[] = [
          { field: 'isCharging', from: true, to: false },
          { field: 'chargeDistance', from: unit.chargeDistance, to: 0 },
        ];
        if (lower) {
          changes.push({ field: 'currentFormation', from: unit.currentFormation, to: lower });
        }
        subSteps.push({
          type: 'CHARGE_END',
          description: `${unit.unitName} forfeited its charge — ${lower ? `dropped to ${lower}` : 'charge ended'}`,
          unitId: unit.id,
          changes,
        });
      }

      const activeTeams = new Set<string>();
      for (const [team, group] of Object.entries(args.alliances)) {
        if (group === next) activeTeams.add(team);
      }

      const turnStartMp = getSetting('turn_start_mp', 0);
      const actionsPerTurn = getSetting('actions_per_turn', 2);
      const heroActionsPerTurn = getSetting('hero_actions_per_turn', 5);
      for (const unit of args.units) {
        if (unit.isDeleted || !activeTeams.has(unit.team)) continue;
        // Heroes refresh to FULL MP + 5 actions; units refresh to 0 MP + 2 actions
        // (units materialize MP from actions when they move).
        const hero = unit.isHero;
        const mpTo = hero
          ? computeEffectiveMovement(unit, getFormationMultiplier(args.formationsMap, unit.currentFormation, 'movement_multiplier'))
          : turnStartMp;
        const actionsTo = hero ? heroActionsPerTurn : actionsPerTurn;
        const changes: { field: string; from: any; to: any }[] = [
          { field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: mpTo },
          { field: 'actionsAvailable', from: unit.actionsAvailable, to: actionsTo },
        ];
        if (!hero) {
          changes.push({ field: 'attacksUsed', from: unit.attacksUsed ?? 0, to: 0 });
        }
        changes.push({ field: 'archerReactionUsed', from: unit.archerReactionUsed ?? false, to: false });
        subSteps.push({
          type: 'END_TURN',
          description: `${unit.unitName} refreshed (${mpTo} MP, ${actionsTo} actions)`,
          unitId: unit.id,
          changes,
        });
      }

      const row = await execute('END_TURN', subSteps, `End Turn — ${next} turn begins`);
      return { next, wrapped, turnNumber: newTurnNumber, freeMoveEnded: leavingFreePlay, ok: !!row };
    },
    [execute, scenarioId],
  );

  return {
    execute,
    undo,
    redo,
    canUndo,
    canRedo,
    moveUnitRecorded,
    moveUnitFree,
    peekUndoChainLength,
    rotateUnit,
    changeFormation,
    selectWeapon,
    assignTeam,
    toggleHide,
    setRouting,
    placeUnit,
    attachHero,
    detachHero,
    swapHeroPosition,
    endTurn,
    charge,
    refreshUndoState,
    subscribeToCommandLog,
  };
}
