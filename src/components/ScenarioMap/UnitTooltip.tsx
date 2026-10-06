'use client';

import React from 'react';
import { Unit, AllianceGroup, Formation, GroundEffect } from '@/types/gameProtocol';
import { computeEffectiveMoraleModifier, exertedThreatRating, calcWounds, calcIsolation, calcEnemyThreats, isUnitRouted, calcMoraleBoostInfo, isHeroMoraleBoostEnabled, HERO_HALF_THREAT_MAX_SIZE } from '@/lib/unitMorale';
import { computeEffectiveMovement, computeEffectiveAttackBonus, getShieldPenalty, effectiveAc as effectiveAcFor } from '@/lib/unitStats';
import { parseWeapons } from '@/lib/weaponParser';
import { heroMovePerAction } from '@/lib/moveCost';
import { unitAttackCap } from '@/lib/attackCap';
import { getSetting } from '@/lib/settingsCache';
import { isAttackRollEffect, hasPendingZoneEffect } from '@/lib/unitEffects';
import { modifierAmount } from '@/lib/effectTemplates';
import { Floating } from './Floating';

interface UnitTooltipProps {
  unit: Unit;
  x: number;
  y: number;
  companion?: Unit;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formation?: Formation | null;
  companionFormation?: Formation | null | undefined;
  /** Engine zone view (painted zones + hex-structure zones) for underfoot cover AC. */
  zones?: GroundEffect[] | null;
}

function fmtAcDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return String(delta);
  return '';
}

function heroColumn(hero: Unit, units: Unit[], alliances: Record<string, AllianceGroup>, formation: Formation | null | undefined, zones?: GroundEffect[] | null) {
  return (
    <>
      <div className="font-bold text-yellow-400 mb-1">{hero.unitName} (Hero)</div>
      {unitInfo(hero, units, alliances, false, formation, zones)}
      {hero.attachedPosition === 'front' && (
        <div className="text-yellow-400 text-xs mt-0.5">Front hero — host attacks ignore AGR</div>
      )}
    </>
  );
}

function unitInfo(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>, showTroops: boolean, formation: Formation | null | undefined, zones?: GroundEffect[] | null) {
  const formationMod = formation ?? null;
  const formationMovMult = formationMod?.movement_multiplier ?? 1;
  const formationAtkMod = formationMod?.attack_modifier ?? 0;
  const formationMorMod = formationMod?.morale_modifier ?? 0;

  const effectiveMoraleModifier = unit.currentMoraleModifier + computeEffectiveMoraleModifier(unit, units, alliances, formationMod);
  const wounds = calcWounds(unit);
  const isolated = calcIsolation(unit, units, alliances);
  const enemyThreats = calcEnemyThreats(unit, units, alliances, formationMod);
  const heroBoost = isHeroMoraleBoostEnabled() ? calcMoraleBoostInfo(unit, units, alliances) : null;
  const heroAura = unit.isHero ? (unit.moraleBoost ?? 0) + (unit.heroicInspirationActive ? 1 : 0) : 0;
  const threatRating = exertedThreatRating(unit);
  const morTotal = unit.baseMorale + effectiveMoraleModifier;
  const acMelee = effectiveAcFor(unit, formationMod, 'front', false);
  const acRanged = effectiveAcFor(unit, formationMod, 'front', true);
  const acRear = effectiveAcFor(unit, formationMod, 'rear', false);
  const shieldInfo = getShieldPenalty(unit);
  const shieldPenalty = shieldInfo.penalty;
  const effectiveMaxMovement = computeEffectiveMovement(unit, formationMovMult);
  const flyable = (unit.flySpeed ?? 0) > 0;
  const moveSuffix = <>{unit.isHero ? ` (${heroMovePerAction(effectiveMaxMovement)} MP/action)` : ''}{showTroops && formationMovMult !== 1 ? ` (base ${unit.movementPoints} × ${formationMovMult})` : ''}</>;

  const weapons = parseWeapons(unit.weaponString || '');
  const activeWeapon = weapons[unit.activeWeaponIndex ?? 0];
  const shieldDropped = shieldPenalty > 0;
  const acBase = (unit.baselineAc || 10) - shieldPenalty;
  const pendingZone = hasPendingZoneEffect(unit, zones);

  return (
    <>
      <div className="font-bold mb-1">
        <span className="capitalize text-gray-400">{unit.team}</span> {unit.unitName}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <span className="text-gray-400">Race:</span><span>{unit.raceName}</span>
        <span className="text-gray-400">Level:</span><span>{unit.level}</span>
        {weapons.length > 0 && (
          <div className="col-span-2">
            <span className="text-gray-400">Weapons:</span>
            <div className="ml-2 text-gray-300">
              {weapons.map((w, i) => {
                const effectiveAtk = computeEffectiveAttackBonus(w.attackBonus, formationAtkMod);
                return (
                  <div key={i}>
                    {w.name}{w.isTwoHanded && <span className="text-red-400 ml-1" title="Two-handed (no shield, no Shield Wall)">[2H]</span>} (+{showTroops && formationAtkMod !== 0 ? `${effectiveAtk} atk [base +${w.attackBonus}, formation +${formationAtkMod}]` : `${effectiveAtk} atk`}, {w.damageDice}{w.isHealing ? '(h)' : ''}{w.numberOfAttacks > 1 ? `, ${w.numberOfAttacks} att` : ''})
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <span className="text-gray-400">Attacks/rnd:</span><span>{activeWeapon?.numberOfAttacks ?? 1}</span>
        {showTroops && (
          <>
                  <span className="text-gray-400" title="Aggressiveness: the unit's will to attack. It rolls a d10; roll ≤ AGR to attack.">Aggressiveness:</span><span>{unit.aggressiveness}</span>
          </>
        )}
        {(showTroops || unit.ignoreMoraleChecks) && (
                unit.ignoreMoraleChecks
                  ? <><span className="text-gray-400" title="Morale: will to keep fighting; fearless units never rout.">Morale:</span><span className="text-yellow-400">fearless</span></>
                  : <><span className="text-gray-400" title="Morale: will to keep fighting. At 0 or below after an attack the unit routs.">Morale:</span><span className="text-yellow-400">{morTotal} = {unit.baseMorale} {effectiveMoraleModifier >= 0 ? '+ ' : '- '}{Math.abs(effectiveMoraleModifier)}{formationMorMod !== 0 ? ` (incl. formation ${formationMorMod >= 0 ? '+' : ''}${formationMorMod})` : ''}</span></>
        )}
        <span className="text-gray-400" title="Threat this unit exerts on others (force strength of its kill zone / 360° reach).">Threat:</span><span>{isUnitRouted(unit) ? `0 routed, was ${threatRating.toFixed(2)}` : `${threatRating.toFixed(2)}${unit.isHero && (unit.sizeCategory ?? 0) <= HERO_HALF_THREAT_MAX_SIZE ? ' (halved - hero ≤ Large)' : ''}`}</span>
      </div>

      <div className="border-t border-gray-600 my-1.5" />

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {showTroops && (
          <>
            <span className="text-gray-400">Troops:</span><span>{unit.currentTroopCount}/{unit.maxTroopCount}</span>
          </>
        )}
        <span className="text-gray-400" title="Hit Points (HP): unit health. Non-hero damage is spread across troops.">HP:</span><span>{unit.currentUnitHp}/{unit.maxUnitHp}</span>
        {flyable ? (
          <>
            <span className="text-gray-400" title="Ground movement points (MP): how far it can move on the ground; one action converts to a full pool.">Ground Move:</span>
            <span>{Math.floor(unit.movementPointsAvailable)}/{effectiveMaxMovement}{moveSuffix}</span>
            <span className="text-gray-400" title="Fly movement points (FP): how far it can move while airborne; one action converts to a full pool.">Fly Move:</span>
            <span>{Math.floor(unit.flySpeedAvailable ?? 0)}/{unit.flySpeed ?? 0}</span>
          </>
        ) : (
          <>
            <span className="text-gray-400" title="Movement points (MP): how far it can move now; one action converts to a full pool.">Move:</span>
            <span>{Math.floor(unit.movementPointsAvailable)}/{effectiveMaxMovement}{moveSuffix}</span>
          </>
        )}
        <span className="text-gray-400" title="Actions: what significant deeds cost. Attacking takes 1; units start each turn with 2, heroes 5.">Actions:</span><span className={unit.actionsAvailable <= 0 ? 'text-red-400' : ''}>{unit.actionsAvailable}/{unit.isHero ? getSetting('hero_actions_per_turn', 5) : getSetting('actions_per_turn', 2)} <span className="text-gray-500">{unit.isHero ? '(convert to MP)' : '(1 = full move)'}</span></span>
        {typeof unit.attacksUsed === 'number' && (
          <span className="text-gray-400" title="Attacks used this turn toward the 5-attack cap (attacks + retaliations).">Attacks used:</span>
        )}
        {typeof unit.attacksUsed === 'number' && (
          <span className={unit.attacksUsed >= unitAttackCap() ? 'text-red-400' : ''}>{unit.attacksUsed}/{unitAttackCap()} <span className="text-gray-500">(attacks + retaliations)</span></span>
        )}
        <span className="text-gray-400" title="Armor Class (AC): a d20 attack roll + bonuses must equal or beat this to hit. Cover (formation, structure, wall) never stacks — the best wins; unit effects (e.g. Haste) add on top. Formation cover does NOT apply from the REAR; the shield is 360°.">AC:</span><span>{acMelee === acRanged && acRanged === acRear ? `AC: ${acMelee}` : `melee${fmtAcDelta(acMelee - acBase)}: ${acMelee}, [Range${fmtAcDelta(acRanged - acBase)}: ${acRanged}]. [rear${fmtAcDelta(acRear - acBase)}: ${acRear}]`}</span>
        {pendingZone && (
          <span className="col-span-2 text-[10px] text-yellow-400">Hex effect will apply at end of turn</span>
        )}
        {(unit.effects ?? []).length > 0 && (
          <>
            <span className="col-span-2 mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">Effects</span>
            {(unit.effects ?? []).map(e => (
              <span key={e.key} className="col-span-2 flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: e.color }} />
          <span className={isAttackRollEffect(e.kind) ? (e.kind === 'advantage' || e.kind === 'grant_advantage' ? 'text-green-400' : 'text-red-400') : e.kind === 'dot' ? 'text-orange-400' : modifierAmount(e.dice) < 0 ? 'text-red-400' : 'text-green-400'}>{e.name}</span>
          <span className="text-gray-500">{e.zoneHex ? 'zone' : isAttackRollEffect(e.kind) ? 'attack roll' : e.kind === 'dot' ? `${Math.abs(modifierAmount(e.dice))}/tick` : `${e.dice ?? ''}`} · {e.turnsLeft} turn{e.turnsLeft === 1 ? '' : 's'}</span>
              </span>
            ))}
          </>
        )}
      </div>

      <div className="border-t border-gray-600 my-1.5" />

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <span className="text-gray-400">Shielded:</span><span>{shieldDropped ? <span className="text-red-400">Yes (dropped — {shieldInfo.reason === 'routing' ? 'routing' : 'two-handed'})</span> : (unit.isShielded ? 'Yes' : 'No')}</span>
        {heroAura > 0 && (
          <>
            <span className="text-gray-400" title="Hero aura: same-alliance units within 7 hexes gain Commanding Presence (Heroic Inspiration after the hero attacks).">Aura:</span>
            <span className="text-green-400">{unit.heroicInspirationActive ? `Heroic Inspiration +${heroAura}` : `Commanding Presence +${heroAura}`}</span>
          </>
        )}
        {showTroops && (
          <><span className="text-gray-400">Formation:</span><span className="capitalize">{unit.currentFormation}{formationMod ? ` (org lv ${unit.organizationLevel})` : ''}</span></>
        )}
        {!showTroops && (
          <><span className="text-gray-400">Mounted:</span><span>{unit.mountName ? 'Yes' : 'No'}</span></>
        )}
        <span className="text-gray-400">Can Charge:</span><span>{unit.isCharging ? <span className="text-yellow-400">Yes (charging)</span> : unit.canCharge ? 'Yes' : 'No'}</span>
      </div>

      {showTroops && (
        <div className="border-t border-gray-600 my-1.5" />
      )}

      {showTroops && !unit.ignoreMoraleChecks && (
        <div className="text-xs">
          <div className="text-gray-500 mb-0.5 text-[10px] uppercase tracking-wide">Morale factors</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span className="text-gray-400">wounds</span>
            <span className={wounds < 0 ? 'text-red-400' : 'text-green-400'}>{wounds >= 0 ? '0' : String(wounds)}</span>
            <span className="text-gray-400">isolation</span>
            <span className={isolated ? 'text-red-400' : 'text-green-400'}>{isolated ? '-1' : '0'}</span>
            <span className="text-gray-400">threat</span>
            <span className={enemyThreats.totalSum > 0 ? 'text-red-400' : 'text-green-400'}>
              {enemyThreats.totalSum > 0
                ? `-${enemyThreats.total} = (${enemyThreats.totalSum} threat) / ${enemyThreats.myThreat}`
                : '0'}
            </span>
            {formationMorMod !== 0 && (
              <>
                <span className="text-gray-400">formation</span>
                <span className={formationMorMod > 0 ? 'text-green-400' : 'text-red-400'}>{formationMorMod >= 0 ? '+' : ''}{formationMorMod}</span>
              </>
            )}
            {heroBoost && (
              <>
                <span className="text-gray-400">{heroBoost.inspired ? 'Heroic Inspiration' : 'Commanding Presence'}</span>
                <span className="text-green-400">+{heroBoost.value}</span>
              </>
            )}
          </div>
        </div>
      )}

      {!showTroops && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs mt-1">
          <span className="text-gray-400">Equip:</span><span>{unit.equipCostGp}gp</span>
        </div>
      )}
    </>
  );
}

export function UnitTooltip({ unit, x, y, companion, units, alliances, formation, companionFormation, zones }: UnitTooltipProps) {
  return (
    <Floating x={x} y={y} z={50} className={`bg-black/90 border border-gray-600 rounded shadow-xl p-3 text-xs text-white ${companion ? 'max-w-[min(820px,calc(100vw-16px))]' : 'max-w-[min(420px,calc(100vw-16px))]'}`}>
      {companion ? (
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            {unit.isHero && heroColumn(unit, units, alliances, formation, zones)}
            {!unit.isHero && unitInfo(unit, units, alliances, true, formation, zones)}
          </div>
          <div className="w-px bg-gray-600 flex-none" />
          <div className="flex-1 min-w-0">
            {companion.isHero ? heroColumn(companion, units, alliances, companionFormation, zones) : unitInfo(companion, units, alliances, true, companionFormation, zones)}
          </div>
        </div>
      ) : (
        unitInfo(unit, units, alliances, !unit.isHero, formation, zones)
      )}
    </Floating>
  );
}
