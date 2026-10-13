'use client';
// src/components/ScenarioMap/useCastActions.ts
// Area-spell resolution: the resolve request (with the over-budget soft gate)
// and the damage/heal application through the command engine, incl. the
// post-cast morale/rout check. Owns the pendingCastOverBudget state.
import { useCallback, useState } from 'react';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { resolveSpellDamage } from '@/packages/combat';
import { saveRollFlags, effectSaveBonus } from '@/packages/effects';
import { computeEffectiveMoraleModifier, shouldRout } from '@/packages/morale';
import { allianceOf } from '@/packages/primitives';
import { SubStep, UnitChange } from '@/packages/infra';
import { formatSpellRollLine } from '@/packages/units';
import { heroAuraBonus } from '@/packages/units';
import { useMagicCast } from '@/hooks/useMagicCast';
import { ExecuteFn, routeUnit } from './routeUnit';

interface CastActionsDeps {
  magicCast: ReturnType<typeof useMagicCast>;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  isGM: boolean;
  playerId: string;
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
    execute,
    addError,
  } = deps;

  // Over-budget spell resolve (soft enforcement): caster has no actions left.
  const [pendingCastOverBudget, setPendingCastOverBudget] = useState(false);

  // Resolve an area spell: roll weapon damage + per-troop saving throws, apply the
  // damage through the command engine (undoable), then run morale/rout like combat.
  const handleResolveCast = useCallback(async (overBudget: boolean) => {
    const cast = magicCast.cast;
    if (!cast || cast.resolved || cast.markers.length === 0) return;
    if (!isGM && playerId !== cast.casterId) return;

    const totalAffected = cast.markers.reduce((a, m) => a + m.affectedCount, 0);
    if (totalAffected <= 0) return;

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

    // Hard alliance gate (defense in depth — handleAttackRequest gates cast-open):
    // healing may only affect the SAME alliance, damage only a DIFFERENT alliance.
    const casterGroup = allianceOf(caster.team, alliances);
    const targetGroup = allianceOf(target.team, alliances);
    if (cast.weapon.isHealing ? casterGroup !== targetGroup : casterGroup === targetGroup) {
      addError(`${caster.unitName} cannot ${cast.weapon.isHealing ? 'heal' : 'target'} ${target.unitName} — ${cast.weapon.isHealing ? 'different' : 'same'} alliance`);
      magicCast.cancelCast();
      return;
    }

    // Area healing: each affected troop recovers HP (capped at troopHp), applied
    // to the unit up to maxUnitHp. No save, no morale/rout cascade.
    if (cast.weapon.isHealing) {
      const healResult = resolveSpellDamage({
        damageDice: cast.weapon.damageDice,
        saveBonus: 0,
        saveDC: 0,
        halfOnSave: true,
        isHealing: true,
        affectedCount: totalAffected,
        troopHp: target.troopHp,
        rng: Math.random,
      });
      const newHp = Math.min(target.maxUnitHp, target.currentUnitHp + healResult.totalDamage);
      const newTroops = Math.min(target.maxTroopCount, Math.ceil(newHp / target.troopHp));
      const troopsRecovered = newTroops - target.currentTroopCount;

      const healSteps: SubStep[] = [];
      const healCasterChanges: UnitChange[] = [];
      if (!cast.weapon.freeAction) healCasterChanges.push({ field: 'actionsAvailable', from: caster.actionsAvailable, to: caster.actionsAvailable - 1 });
      if (cast.reaction) {
        healCasterChanges.push({ field: 'archerReactionUsed', from: caster.archerReactionUsed ?? false, to: true });
        healCasterChanges.push({ field: 'attacksUsed', from: caster.attacksUsed ?? 0, to: (caster.attacksUsed ?? 0) + 1 });
      }
      if (healCasterChanges.length > 0) {
        healSteps.push({
          type: 'CAST',
          description: `${caster.unitName} ${cast.reaction ? 'reacted with' : 'spent an action casting'} ${cast.weapon.name}`,
          unitId: caster.id,
          changes: healCasterChanges,
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
      const healDesc = `${caster.unitName} casts ${cast.weapon.name} on ${target.unitName} — base ${healResult.baseDamage}, ${totalAffected} troop(s) affected — ${healResult.totalDamage} total healing${troopsRecovered > 0 ? ` (${troopsRecovered} troop(s) recovered)` : ''}`;
      const healMsg = `${healDesc} ${formatSpellRollLine(healResult, 0)}`;
      await execute('HEAL', healSteps, healDesc, { verboseMessage: healMsg });
      magicCast.sendResolve({ baseDamage: healResult.baseDamage, totalDamage: healResult.totalDamage, troopsKilled: 0, newHp, savedCount: 0, failedCount: 0, description: healDesc });
      return;
    }

    const noSave = cast.saveStat === 'none';
    const flags = saveRollFlags(target);
    const saveMode: 'advantage' | 'disadvantage' | 'normal' = flags.advantage && !flags.disadvantage ? 'advantage' : flags.disadvantage && !flags.advantage ? 'disadvantage' : 'normal';
    const saveBonus = (noSave ? 0 : (cast.targetStats[cast.saveStat.toLowerCase() as keyof typeof cast.targetStats] ?? 0))
      + effectSaveBonus(target)
      + heroAuraBonus(target, units, alliances).save;
    // One resolve per AoE marker (a war machine places one per hit); the damage
    // from every marker sums into a single applied blow.
    const results = cast.markers.map(mk => resolveSpellDamage({
      damageDice: cast.weapon.damageDice,
      saveBonus,
      saveDC: cast.saveDC,
      halfOnSave: cast.halfOnSave,
      noSave,
      affectedCount: mk.affectedCount,
      troopHp: target.troopHp,
      saveMode,
      rng: Math.random,
    }));
    const totalDamage = results.reduce((a, r) => a + r.totalDamage, 0);
    const baseDamage = results[0]?.baseDamage ?? 0;
    const savedCount = results.reduce((a, r) => a + r.perTroop.filter(t => t.success).length, 0);
    const failedCount = results.reduce((a, r) => a + r.perTroop.length, 0) - savedCount;

    const newHp = Math.max(0, target.currentUnitHp - totalDamage);
    const newTroops = Math.ceil(newHp / target.troopHp);
    const troopsKilled = target.currentTroopCount - newTroops;

    const subSteps: SubStep[] = [];
    const casterChanges: UnitChange[] = [];
    if (!cast.weapon.freeAction) casterChanges.push({ field: 'actionsAvailable', from: caster.actionsAvailable, to: caster.actionsAvailable - 1 });
    if (cast.reaction) {
      casterChanges.push({ field: 'archerReactionUsed', from: caster.archerReactionUsed ?? false, to: true });
      casterChanges.push({ field: 'attacksUsed', from: caster.attacksUsed ?? 0, to: (caster.attacksUsed ?? 0) + 1 });
    }
    if (casterChanges.length > 0) {
      subSteps.push({
        type: 'CAST',
        description: `${caster.unitName} ${cast.reaction ? 'reacted with' : 'spent an action casting'} ${cast.weapon.name}`,
        unitId: caster.id,
        changes: casterChanges,
      });
    }
    if (totalDamage > 0) {
      subSteps.push({
        type: 'DAMAGE',
        description: `${target.unitName} took ${totalDamage} damage from ${cast.weapon.name}`,
        unitId: target.id,
        changes: [
          { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: target.currentTroopCount, to: newTroops },
        ],
        payload: { killerUnitId: caster.id, victimLevel: target.level },
      });
    }

    const markerNote = cast.markers.length > 1 ? `${cast.markers.length} markers, ` : '';
    const saveNote = noSave ? ' (no save)' : `, ${savedCount} saved, ${failedCount} failed`;
    const verb = cast.weapon.warMachine ? `fires ${cast.weapon.name} at` : `casts ${cast.weapon.name} on`;
    const desc = `${caster.unitName} ${verb} ${target.unitName} — base ${baseDamage}, ${markerNote}${totalAffected} troop(s) affected${saveNote} — ${totalDamage} total damage (${troopsKilled} troop(s))`;
    const msg = `${desc} ${results.map(r => formatSpellRollLine(r, cast.saveDC)).join(' · ')}`;

    await execute('CAST', subSteps, desc, { verboseMessage: msg });

    // Morale check for the target — a spell that breaks morale routs (only an
    // attack can rout; no cascade to nearby units).
    const targetKilled = newHp <= 0;
    const modUnit = { ...target, currentUnitHp: newHp };
    const effMod = modUnit.currentMoraleModifier + computeEffectiveMoraleModifier(modUnit, units, alliances, formationsMap[target.currentFormation] ?? null);
    const targetRouted = !targetKilled && shouldRout(modUnit, units, alliances, formationsMap[target.currentFormation] ?? null);

    if (targetRouted || targetKilled) {
      await routeUnit(execute, target, targetKilled ? 'destroyed by magic' : `morale ${modUnit.baseMorale + effMod} after magic`, targetKilled, caster.id, 0, units);
    }

    magicCast.sendResolve({
      baseDamage,
      totalDamage,
      troopsKilled,
      newHp,
      savedCount,
      failedCount,
      description: desc,
    });
  }, [magicCast, units, alliances, formationsMap, isGM, playerId, execute, addError]);

  const requestResolveCast = useCallback(() => {
    const cast = magicCast.cast;
    if (!cast || cast.resolved || cast.markers.length === 0) return;
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
