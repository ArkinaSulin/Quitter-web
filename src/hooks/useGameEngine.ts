'use client';

import { useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { computeEffectiveMovement } from '@/lib/unitStats';
import { useMessages } from '@/contexts/MessageContext';
import { GameEngine, ActionType, SubStep, CommandEntry } from '@/game/GameEngine';
import { getActiveGroups, advanceTurn } from '@/lib/turnState';

interface UseGameEngineProps {
  scenarioId: string;
  playerId: string;
  playerName: string;
  isGM: boolean;
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
  updateUnit,
  moveUnit,
  updateAlliance,
  updateScenarioField,
}: UseGameEngineProps) {
  const engineRef = useRef(new GameEngine());
  const { addMessage } = useMessages();

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

      addMessage(description);
      return entry;
    },
    [scenarioId, playerId, playerName, updateUnit, updateAlliance, updateScenarioField, addMessage],
  );

  const undo = useCallback(async (): Promise<CommandEntry[] | null> => {
    const chain = engineRef.current.undo(playerId, isGM);
    if (!chain || chain.length === 0) return null;

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

    const now = new Date().toISOString();
    for (const entry of chain) {
      const { error } = await supabase
        .from('command_log')
        .update({ deleted_at: now })
        .eq('id', entry.id);
      if (error) console.error('[CommandLog] Soft-delete failed:', error);
    }

    addMessage(`Undid: ${chain[0].description}${chain.length > 1 ? ` (+${chain.length - 1} more)` : ''}`);
    return chain;
  }, [playerId, isGM, updateUnit, updateAlliance, updateScenarioField, scenarioId, addMessage]);

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

    addMessage(`Redid: ${chain[0].description}${chain.length > 1 ? ` (+${chain.length - 1} more)` : ''}`);
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
    async (unit: Unit, targetHex: Hex): Promise<void> => {
      const subSteps: SubStep[] = [
        {
          type: 'MOVE',
          description: `${unit.unitName} moved to (${targetHex.q}, ${targetHex.r})`,
          unitId: unit.id,
          changes: [
            { field: 'hex', from: { ...unit.hex }, to: { ...targetHex } },
          ],
        },
      ];
      await execute('MOVE', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const rotateUnit = useCallback(
    async (unit: Unit, direction: 'left' | 'right'): Promise<void> => {
      const step = direction === 'left' ? -1 : 1;
      const newFacing = ((unit.facing + step) % 6 + 6) % 6;
      const subSteps: SubStep[] = [
        {
          type: 'ROTATE',
          description: `${unit.unitName} rotated ${direction}`,
          unitId: unit.id,
          changes: [{ field: 'facing', from: unit.facing, to: newFacing }],
        },
      ];
      await execute('ROTATE', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const changeFormation = useCallback(
    async (unit: Unit, formation: string, formationsMap: Record<string, Formation>): Promise<void> => {
      const oldForm = formationsMap[unit.currentFormation];
      const newForm = formationsMap[formation];
      const oldMult = oldForm?.movement_multiplier ?? 1;
      const newMult = newForm?.movement_multiplier ?? 1;
      const oldEffectiveMax = computeEffectiveMovement(unit, oldMult);
      const newEffectiveMax = computeEffectiveMovement(unit, newMult);
      const newAvailable = Math.min(
        newEffectiveMax,
        Math.round(unit.movementPointsAvailable / oldEffectiveMax * newEffectiveMax),
      );

      const changes: { field: string; from: any; to: any }[] = [
        { field: 'currentFormation', from: unit.currentFormation, to: formation },
        { field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: newAvailable },
      ];

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
    [execute, addMessage],
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
    async (templateName: string, unitId: string, hex: Hex): Promise<void> => {
      const subSteps: SubStep[] = [
        {
          type: 'PLACE',
          description: `Placed ${templateName} at (${hex.q}, ${hex.r})`,
          unitId,
          changes: [
            { field: 'isDeleted', from: true, to: false },
          ],
        },
      ];
      await execute('PLACE', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const attachHero = useCallback(
    async (hero: Unit, targetUnit: Unit, position: 'front' | 'back'): Promise<void> => {
      const subSteps: SubStep[] = [
        {
          type: 'ATTACH_HERO',
          description: `${hero.unitName} attached to ${targetUnit.unitName} (${position})`,
          unitId: hero.id,
          changes: [
            { field: 'attachedToUnitId', from: null, to: targetUnit.id },
            { field: 'attachedPosition', from: null, to: position },
            { field: 'hex', from: { ...hero.hex }, to: { ...targetUnit.hex } },
          ],
        },
      ];
      await execute('ATTACH_HERO', subSteps, subSteps[0].description);
    },
    [execute],
  );

  const detachHero = useCallback(
    async (hero: Unit): Promise<void> => {
      const subSteps: SubStep[] = [
        {
          type: 'DETACH_HERO',
          description: `${hero.unitName} detached from unit`,
          unitId: hero.id,
          changes: [
            { field: 'attachedToUnitId', from: hero.attachedToUnitId, to: null },
          ],
        },
      ];
      await execute('DETACH_HERO', subSteps, subSteps[0].description);
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
    }): Promise<{ next: AllianceGroup; wrapped: boolean }> => {
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

      const activeTeams = new Set<string>();
      for (const [team, group] of Object.entries(args.alliances)) {
        if (group === next) activeTeams.add(team);
      }

      for (const unit of args.units) {
        if (unit.isDeleted || !activeTeams.has(unit.team)) continue;
        const mult = args.formationsMap[unit.currentFormation]?.movement_multiplier ?? 1;
        const maxMP = computeEffectiveMovement(unit, mult);
        subSteps.push({
          type: 'END_TURN',
          description: `${unit.unitName} refreshed (${maxMP} MP, 2 actions)`,
          unitId: unit.id,
          changes: [
            { field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: maxMP },
            { field: 'actionsAvailable', from: unit.actionsAvailable, to: 2 },
          ],
        });
      }

      await execute('END_TURN', subSteps, `End Turn — ${next} turn begins`);
      return { next, wrapped };
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
    peekUndoChainLength,
    rotateUnit,
    changeFormation,
    assignTeam,
    toggleHide,
    placeUnit,
    attachHero,
    detachHero,
    endTurn,
  };
}
