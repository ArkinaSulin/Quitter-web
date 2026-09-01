'use client';
// src/components/ScenarioMap/useCastActions.ts
// Area-spell resolution: the resolve request (with the over-budget soft gate)
// and the damage/heal application through the command engine, incl. the
// post-cast morale/rout check. Owns the pendingCastOverBudget state.
import { useCallback, useState } from 'react';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { resolveSpellDamage } from '@/lib/spellDamage';
import { computeEffectiveMoraleModifier, shouldRout } from '@/lib/unitMorale';
import { SubStep } from '@/lib/commandLog';
import { formatSaveRolls, formatSpellBaseFaces } from '@/lib/verboseCombat';
import { useMagicCast } from '@/hooks/useMagicCast';
import { ExecuteFn, routeUnit } from './routeUnit';

interface CastActionsDeps {
  magicCast: ReturnType<typeof useMagicCast>;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  isGM: boolean;
  playerId: string;
  verboseCombat: boolean;
  execute: ExecuteFn;
  addError: (msg: string) => void;
}

export function useCastActions(deps: CastActionsDeps) {
  const {
    magicCast,
    units,
    alliances,
    formationsMap,
    isGM,
    playerId,
    verboseCombat,
    execute,
    addError,
  } = deps;

  // Over-budget spell resolve (soft enforcement): caster has no actions left.
  const [pendingCastOverBudget, setPendingCastOverBudget] = useState(false);

  // Resolve an area spell: roll weapon damage + per-troop saving throws, apply the
  // damage through the command engine (undoable), then run morale/rout like combat.
  const handleResolveCast = useCallback(async (overBudget: boolean) => {
    const cast = magicCast.cast;
    if (!cast || cast.resolved || !cast.circle || cast.affectedCount <= 0) return;
    if (!isGM && playerId !== cast.casterId) return;

    const target = units.find(u => u.id === cast.targetUnitId);
    const caster = units.find(u => u.id === cast.casterUnitId);
    if (!target || !caster) {
      addError('Spell target or caster is no longer on the map — cast cancelled');
      magicCast.cancelCast();
      return;
    }

    if (overBudget) {
      addError(`${caster.unitName} cast with no actions left — over budget`);
    }

    // Area healing: each affected troop recovers HP (capped at troopHp), applied
    // to the unit up to maxUnitHp. No save, no morale/rout cascade. Healing may
    // only target units of the caster's OWN alliance (any team within it).
    if (cast.weapon.isHealing) {
      const casterAlliance = alliances[caster.team] || 'friendly';
      const targetAlliance = alliances[target.team] || 'friendly';
      if (casterAlliance !== targetAlliance) {
        addError(`${caster.unitName} can only heal units of their own alliance`);
        magicCast.cancelCast();
        return;
      }
      const healResult = resolveSpellDamage({
        damageDice: cast.weapon.damageDice,
        saveBonus: 0,
        saveDC: 0,
        halfOnSave: true,
        isHealing: true,
        affectedCount: cast.affectedCount,
        troopHp: target.troopHp,
        rng: Math.random,
      });
      const newHp = Math.min(target.maxUnitHp, target.currentUnitHp + healResult.totalDamage);
      const newTroops = Math.min(target.maxTroopCount, Math.ceil(newHp / target.troopHp));
      const troopsRecovered = newTroops - target.currentTroopCount;

      const healSteps: SubStep[] = [];
      if (!cast.weapon.freeAction) {
        healSteps.push({
          type: 'CAST',
          description: `${caster.unitName} spent an action casting ${cast.weapon.name}`,
          unitId: caster.id,
          changes: [{ field: 'actionsAvailable', from: caster.actionsAvailable, to: caster.actionsAvailable - 1 }],
        });
      }
      if (healResult.totalDamage > 0) {
        healSteps.push({
          type: 'HEAL',
          description: `${target.unitName} healed ${healResult.totalDamage} HP by ${cast.weapon.name}`,
          unitId: target.id,
          changes: [
            { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
            { field: 'currentTroopCount', from: target.currentTroopCount, to: newTroops },
          ],
        });
      }
      const healFaces = verboseCombat && healResult.baseFaces.length > 0 ? ` {${cast.weapon.damageDice}: ${[...healResult.baseFaces].sort((a, b) => a - b).join(',')}}` : '';
      const healDesc = `${caster.unitName} casts ${cast.weapon.name} on ${target.unitName} — base ${healResult.baseDamage}, ${cast.affectedCount} troop(s) affected — ${healResult.totalDamage} total healing${troopsRecovered > 0 ? ` (${troopsRecovered} troop(s) recovered)` : ''}`;
      const healMsg = healFaces
        ? `${caster.unitName} casts ${cast.weapon.name} on ${target.unitName} — base ${healResult.baseDamage}${healFaces}, ${cast.affectedCount} troop(s) affected — ${healResult.totalDamage} total healing${troopsRecovered > 0 ? ` (${troopsRecovered} troop(s) recovered)` : ''}`
        : healDesc;
      await execute('HEAL', healSteps, healDesc, healMsg !== healDesc ? { message: healMsg } : undefined);
      magicCast.sendResolve({ baseDamage: healResult.baseDamage, totalDamage: healResult.totalDamage, troopsKilled: 0, newHp, savedCount: 0, failedCount: 0, description: healDesc });
      return;
    }

    const result = resolveSpellDamage({
      damageDice: cast.weapon.damageDice,
      saveBonus: cast.targetStats[cast.saveStat.toLowerCase() as keyof typeof cast.targetStats] ?? 0,
      saveDC: cast.saveDC,
      halfOnSave: cast.halfOnSave,
      affectedCount: cast.affectedCount,
      troopHp: target.troopHp,
      rng: Math.random,
    });

    const newHp = Math.max(0, target.currentUnitHp - result.totalDamage);
    const newTroops = Math.ceil(newHp / target.troopHp);
    const troopsKilled = target.currentTroopCount - newTroops;

    const subSteps: SubStep[] = [];
    if (!cast.weapon.freeAction) {
      subSteps.push({
        type: 'CAST',
        description: `${caster.unitName} spent an action casting ${cast.weapon.name}`,
        unitId: caster.id,
        changes: [{ field: 'actionsAvailable', from: caster.actionsAvailable, to: caster.actionsAvailable - 1 }],
      });
    }
    if (result.totalDamage > 0) {
      subSteps.push({
        type: 'DAMAGE',
        description: `${target.unitName} took ${result.totalDamage} damage from ${cast.weapon.name}`,
        unitId: target.id,
        changes: [
          { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: target.currentTroopCount, to: newTroops },
        ],
      });
    }

    const savedCount = result.perTroop.filter(t => t.success).length;
    const failedCount = result.perTroop.length - savedCount;
    const desc = `${caster.unitName} casts ${cast.weapon.name} on ${target.unitName} — base ${result.baseDamage}, ${cast.affectedCount} troop(s) affected, ${savedCount} saved, ${failedCount} failed — ${result.totalDamage} total damage (${troopsKilled} troop(s))`;
    const castVerbose = verboseCombat
      ? ` ${formatSpellBaseFaces(result, cast.weapon.damageDice)} ${formatSaveRolls(result, cast.targetStats[cast.saveStat.toLowerCase() as keyof typeof cast.targetStats] ?? 0, cast.saveDC)}`
      : '';
    const msg = castVerbose
      ? `${caster.unitName} casts ${cast.weapon.name} on ${target.unitName} — base ${result.baseDamage} ${formatSpellBaseFaces(result, cast.weapon.damageDice)}, ${cast.affectedCount} troop(s) affected, ${savedCount} saved, ${failedCount} failed ${formatSaveRolls(result, cast.targetStats[cast.saveStat.toLowerCase() as keyof typeof cast.targetStats] ?? 0, cast.saveDC)} — ${result.totalDamage} total damage (${troopsKilled} troop(s))`
      : desc;

    await execute('CAST', subSteps, desc, msg !== desc ? { message: msg } : undefined);

    // Morale check for the target — a spell that breaks morale routs (only an
    // attack can rout; no cascade to nearby units).
    const targetKilled = newHp <= 0;
    const modUnit = { ...target, currentUnitHp: newHp };
    const effMod = modUnit.currentMoraleModifier + computeEffectiveMoraleModifier(modUnit, units, alliances, formationsMap[target.currentFormation] ?? null);
    const targetRouted = !targetKilled && shouldRout(modUnit, units, alliances, formationsMap[target.currentFormation] ?? null);

    if (targetRouted || targetKilled) {
      await routeUnit(execute, target, targetKilled ? 'destroyed by magic' : `morale ${modUnit.baseMorale + effMod} after magic`, targetKilled);
    }

    magicCast.sendResolve({
      baseDamage: result.baseDamage,
      totalDamage: result.totalDamage,
      troopsKilled,
      newHp,
      savedCount,
      failedCount,
      description: desc,
    });
  }, [magicCast, units, alliances, formationsMap, isGM, playerId, execute, addError, verboseCombat]);

  const requestResolveCast = useCallback(() => {
    const cast = magicCast.cast;
    if (!cast || cast.resolved || !cast.circle || cast.affectedCount <= 0) return;
    if (!isGM && playerId !== cast.casterId) return;
    const caster = units.find(u => u.id === cast.casterUnitId);
    if (caster && caster.actionsAvailable < 1 && !cast.weapon.freeAction) {
      setPendingCastOverBudget(true);
      return;
    }
    handleResolveCast(false);
  }, [magicCast, units, isGM, playerId, handleResolveCast]);

  return { pendingCastOverBudget, setPendingCastOverBudget, handleResolveCast, requestResolveCast };
}
