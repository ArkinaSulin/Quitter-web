'use client';

import { useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Unit, Hex, AllianceGroup, Formation, getOrganizationLevel } from '@/types/gameProtocol';
import { computeEffectiveMovement } from '@/lib/unitStats';
import { applyFormationChange } from '@/lib/formationCost';
import { nextLowerFormation } from '@/lib/formationCost';
import { applyMoveCost, applyMpSpend } from '@/lib/moveCost';
import { getSetting } from '@/lib/settingsCache';
import { parseWeapons } from '@/lib/weaponParser';
import { useMessageSync } from '@/hooks/useMessageSync';
import { GameEngine, ActionType, SubStep, CommandEntry } from '@/game/GameEngine';
import { getActiveGroups, advanceTurn } from '@/lib/turnState';
import { buildStackFromLog, rowToEntry, CommandLogRow } from '@/lib/commandHistory';

interface UseGameEngineProps {
  scenarioId: string;
  playerId: string;
  playerName: string;
  isGM: boolean;
  freeMove: boolean;
  updateUnit: (unitId: string, updates: Partial<Unit>) => Promise<boolean>;
  moveUnit: (unitId: string, targetHex: Hex) => Promise<boolean>;
  updateAlliance?: (team: string, group: AllianceGroup) => Promise<void>;
  updateScenarioField?: (scenarioId: string, fields: Record<string, any>) => Promise<boolean>;
}

export function useGameEngine({
  scenarioId,
  playerId,
  playerName,
  isGM,
  freeMove,
  updateUnit,
  moveUnit,
  updateAlliance,
  updateScenarioField,
}: UseGameEngineProps) {
  const engineRef = useRef(new GameEngine());
  const { addMessage, addError } = useMessageSync(scenarioId);

  const execute = useCallback(
    async (
      actionType: ActionType,
      subSteps: SubStep[],
      description: string,
      options?: { chained?: boolean },
    ): Promise<CommandEntry | null> => {
      const isChained = options?.chained ?? false;
      const entry = engineRef.current.execute(
        actionType,
        subSteps,
        description,
        playerId,
        playerName,
        scenarioId,
        { chained: isChained },
      );

      for (const step of subSteps) {
        if (step.type === 'ALLIANCE' && updateAlliance) {
          for (const change of step.changes) {
            await updateAlliance(step.unitId, change.to);
          }
        } else if (step.type === 'SCENARIO' && updateScenarioField) {
          const update: any = {};
          for (const change of step.changes) {
            update[change.field] = change.to;
          }
          if (Object.keys(update).length > 0) {
            await updateScenarioField(scenarioId, update);
          }
        } else {
          const update: any = {};
          for (const change of step.changes) {
            update[change.field] = change.to;
          }
          if (Object.keys(update).length > 0) {
            await updateUnit(step.unitId, update);
          }
        }
      }

      const { error } = await supabase.from('command_log').insert({
        id: entry.id,
        scenario_id: scenarioId,
        player_id: playerId,
        player_name: playerName,
        action_type: actionType,
        description,
        sub_steps: JSON.stringify(subSteps),
        chained: isChained,
        created_at: new Date(entry.timestamp).toISOString(),
      });
      if (error) console.error('[CommandLog] Insert failed:', error);

      // Unit edits (incl. by players editing their own unit) are flagged to everyone.
      if (actionType === 'EDIT_UNIT') addError(description);
      else addMessage(description);
      return entry;
    },
    [scenarioId, playerId, playerName, updateUnit, updateAlliance, updateScenarioField, addMessage, addError],
  );

  const hydrateFromLog = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase
      .from('command_log')
      .select('id, scenario_id, player_id, player_name, action_type, description, sub_steps, chained, created_at')
      .eq('scenario_id', scenarioId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[CommandLog] Hydrate failed:', error);
      return;
    }
    engineRef.current.loadStack(buildStackFromLog((data ?? []) as CommandLogRow[]));
  }, [scenarioId]);

  const subscribeToCommandLog = useCallback((): (() => void) => {
    const channel = supabase
      .channel(`command-log-${scenarioId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'command_log',
          filter: `scenario_id=eq.${scenarioId}`,
        },
        payload => {
          engineRef.current.pushExternal(rowToEntry(payload.new as CommandLogRow));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'command_log',
          filter: `scenario_id=eq.${scenarioId}`,
        },
        payload => {
          const row = payload.new as CommandLogRow;
          if (row.deleted_at) {
            // A remote undo soft-deleted this command — drop it from our stack.
            engineRef.current.removeEntry(row.id);
          } else {
            // A remote redo undeleted it — re-add.
            engineRef.current.undeleteEntry(rowToEntry(row));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scenarioId]);

  const undo = useCallback(async (): Promise<CommandEntry[] | null> => {
    // Pop locally first (permission checked against the local top chain).
    const chain = engineRef.current.undo(playerId, isGM);
    if (!chain || chain.length === 0) return null;

    // Server-authoritative: only the live global top chain (owned by the caller
    // or a GM) may be undone. The DB recomputes the top from the log, so a stale
    // client stack cannot undo a move another player made after it.
    const { data, error } = await supabase.rpc('undo_commands', {
      p_scenario_id: scenarioId,
      p_target_ids: chain.map(e => e.id),
    });
    if (error || !data || (data as any[]).length === 0) {
      // Rejected — reconcile the local stack with the true history.
      await hydrateFromLog();
      addMessage('Cannot undo — another player has moved since, or the action was already undone');
      return null;
    }

    for (const entry of chain) {
      for (const step of entry.subSteps) {
        if (step.type === 'ALLIANCE' && updateAlliance) {
          for (const change of step.changes) {
            await updateAlliance(step.unitId, change.from);
          }
        } else if (step.type === 'SCENARIO' && updateScenarioField) {
          const update: any = {};
          for (const change of step.changes) {
            update[change.field] = change.from;
          }
          if (Object.keys(update).length > 0) {
            await updateScenarioField(scenarioId, update);
          }
        } else {
          const update: any = {};
          for (const change of step.changes) {
            update[change.field] = change.from;
          }
          if (Object.keys(update).length > 0) {
            await updateUnit(step.unitId, update);
          }
        }
      }
    }

    addMessage(chain.length > 1 ? `Undid: ${chain[0].description} — ${chain.length} items` : `Undid: ${chain[0].description}`);
    return chain;
  }, [playerId, isGM, updateUnit, updateAlliance, updateScenarioField, scenarioId, addMessage, hydrateFromLog]);

  const redo = useCallback(async (): Promise<CommandEntry[] | null> => {
    const chain = engineRef.current.redo(playerId, isGM);
    if (!chain || chain.length === 0) return null;

    for (const entry of chain) {
      for (const step of entry.subSteps) {
        if (step.type === 'ALLIANCE' && updateAlliance) {
          for (const change of step.changes) {
            await updateAlliance(step.unitId, change.to);
          }
        } else if (step.type === 'SCENARIO' && updateScenarioField) {
          const update: any = {};
          for (const change of step.changes) {
            update[change.field] = change.to;
          }
          if (Object.keys(update).length > 0) {
            await updateScenarioField(scenarioId, update);
          }
        } else {
          const update: any = {};
          for (const change of step.changes) {
            update[change.field] = change.to;
          }
          if (Object.keys(update).length > 0) {
            await updateUnit(step.unitId, update);
          }
        }
      }
    }

    for (const entry of chain) {
      const { error } = await supabase
        .from('command_log')
        .update({ deleted_at: null })
        .eq('id', entry.id);
      if (error) console.error('[CommandLog] Undelete failed:', error);
    }

    addMessage(chain.length > 1 ? `Redid: ${chain[0].description} — ${chain.length} items` : `Redid: ${chain[0].description}`);
    return chain;
  }, [playerId, isGM, updateUnit, updateAlliance, updateScenarioField, scenarioId, addMessage]);

  const canUndo = useCallback((): boolean => {
    return engineRef.current.canUndo(playerId, isGM);
  }, [playerId, isGM]);

  const canRedo = useCallback((): boolean => {
    return engineRef.current.canRedo(playerId, isGM);
  }, [playerId, isGM]);

  const peekUndo = useCallback((): CommandEntry | null => {
    return engineRef.current.peekUndo(playerId, isGM);
  }, [playerId, isGM]);

  const peekRedo = useCallback((): CommandEntry | null => {
    return engineRef.current.peekRedo(playerId, isGM);
  }, [playerId, isGM]);

  const peekUndoChainLength = useCallback((): number => {
    return engineRef.current.peekUndoChainLength(playerId, isGM);
  }, [playerId, isGM]);

  const moveUnitRecorded = useCallback(
    async (unit: Unit, targetHex: Hex, cost: number, maxMP: number, attachedHero?: Unit | null, heroMaxMP?: number, description?: string): Promise<void> => {
      const { movementPointsAvailable, actionsAvailable } = applyMoveCost(unit, cost, maxMP);
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
        const heroCost = applyMoveCost(attachedHero, cost, heroMaxMP);
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

      await execute('MOVE', subSteps, subSteps[0].description);
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
    async (unit: Unit, direction: 'left' | 'right', maxMP: number): Promise<void> => {
      const step = direction === 'left' ? -1 : 1;
      const newFacing = ((unit.facing + step) % 6 + 6) % 6;
      const changes: { field: string; from: any; to: any }[] = [
        { field: 'facing', from: unit.facing, to: newFacing },
      ];
      if (!unit.isHero && !freeMove) {
        const { movementPointsAvailable, actionsAvailable } = applyMpSpend(unit, 1, maxMP);
        changes.push({ field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: movementPointsAvailable });
        if (actionsAvailable !== unit.actionsAvailable) {
          changes.push({ field: 'actionsAvailable', from: unit.actionsAvailable, to: actionsAvailable });
        }
      }
      const subSteps: SubStep[] = [
        {
          type: 'ROTATE',
          description: `${unit.unitName} rotated ${direction}`,
          unitId: unit.id,
          changes,
        },
      ];
      await execute('ROTATE', subSteps, subSteps[0].description);
    },
    [execute, freeMove],
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
      const steps = Math.abs(getOrganizationLevel(unit.currentFormation) - getOrganizationLevel(formation));
      const { movementPointsAvailable: newAvailable, actionsAvailable: newActions } = applyFormationChange(
        unit,
        steps,
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

      if (unit.isRouting && formation !== 'Routed') {
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
      const { movementPointsAvailable, actionsAvailable } = applyMpSpend(hero, 1, heroMaxMP);
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
      const { movementPointsAvailable, actionsAvailable } = applyMpSpend(hero, 1, heroMaxMP);
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
        const { movementPointsAvailable, actionsAvailable } = applyMpSpend(hero, 1, heroMaxMP);
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
    }): Promise<{ next: AllianceGroup; wrapped: boolean; turnNumber: number }> => {
      const activeGroups = getActiveGroups(args.alliances);
      const { next, wrapped } = advanceTurn(args.currentAlliance, activeGroups);
      const newTurnNumber = wrapped ? args.turnNumber + 1 : args.turnNumber;

      const subSteps: SubStep[] = [
        {
          type: 'SCENARIO',
          description: `Turn advances — ${next} turn begins`,
          unitId: scenarioId,
          changes: [
            { field: 'current_turn_alliance', from: args.currentAlliance ?? null, to: next },
            { field: 'turn_number', from: args.turnNumber, to: newTurnNumber },
          ],
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
      for (const unit of args.units) {
        if (unit.isDeleted || !activeTeams.has(unit.team)) continue;
        subSteps.push({
          type: 'END_TURN',
          description: `${unit.unitName} refreshed (${turnStartMp} MP, ${actionsPerTurn} actions)`,
          unitId: unit.id,
          changes: [
            { field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: turnStartMp },
            { field: 'actionsAvailable', from: unit.actionsAvailable, to: actionsPerTurn },
          ],
        });
      }

      await execute('END_TURN', subSteps, `End Turn — ${next} turn begins`);
      return { next, wrapped, turnNumber: newTurnNumber };
    },
    [execute, scenarioId],
  );

  return {
    execute,
    undo,
    redo,
    canUndo,
    canRedo,
    peekUndo,
    peekRedo,
    moveUnitRecorded,
    moveUnitFree,
    peekUndoChainLength,
    rotateUnit,
    changeFormation,
    selectWeapon,
    assignTeam,
    toggleHide,
    placeUnit,
    attachHero,
    detachHero,
    swapHeroPosition,
    endTurn,
    charge,
    hydrateFromLog,
    subscribeToCommandLog,
  };
}
