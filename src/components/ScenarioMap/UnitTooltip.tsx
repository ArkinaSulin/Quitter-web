'use client';

import React from 'react';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { computeEffectiveMoraleModifier, computeThreatRating, calcWounds, calcIsolation, calcEnemyThreats } from '@/lib/unitMorale';
import { computeEffectiveAc, computeEffectiveMovement, computeEffectiveAttackBonus } from '@/lib/unitStats';
import { parseWeapons } from '@/lib/weaponParser';

interface UnitTooltipProps {
  unit: Unit;
  x: number;
  y: number;
  attachedHero?: Unit;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formation?: Formation | null;
  attachedHeroFormation?: Formation | null | undefined;
}

function unitInfo(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>, showTroops: boolean, formation: Formation | null | undefined) {
  const formationMod = formation ?? null;
  const formationAcMod = formationMod?.ac_modifier ?? 0;
  const formationMovMult = formationMod?.movement_multiplier ?? 1;
  const formationAtkMod = formationMod?.attack_modifier ?? 0;
  const formationMorMod = formationMod?.morale_modifier ?? 0;

  const effectiveMoraleModifier = unit.currentMoraleModifier + computeEffectiveMoraleModifier(unit, units, alliances, formationMorMod);
  const wounds = calcWounds(unit);
  const isolated = calcIsolation(unit, units, alliances);
  const enemyThreats = calcEnemyThreats(unit, units, alliances);
  const threatRating = computeThreatRating(unit);
  const morTotal = unit.baseMorale + effectiveMoraleModifier;
  const effectiveAc = computeEffectiveAc(unit, formationAcMod);
  const effectiveMaxMovement = computeEffectiveMovement(unit, formationMovMult);

  const weapons = parseWeapons(unit.weaponString || '');

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
                    {w.name} (+{showTroops && formationAtkMod !== 0 ? `${effectiveAtk} atk [base +${w.attackBonus}, formation +${formationAtkMod}]` : `${effectiveAtk} atk`}, {w.damageDice})
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <span className="text-gray-400">Attacks/rnd:</span><span>{unit.numberOfAttacks}</span>
        {showTroops && (
          <>
            <span className="text-gray-400">AGR:</span><span>{unit.aggressiveness}</span>
          </>
        )}
        {(showTroops || unit.ignoreMoraleChecks) && (
          unit.ignoreMoraleChecks
            ? <><span className="text-gray-400">MOR:</span><span className="text-yellow-400">fearless</span></>
            : <><span className="text-gray-400">MOR:</span><span className="text-yellow-400">{morTotal} = {unit.baseMorale} {effectiveMoraleModifier >= 0 ? '+ ' : '- '}{Math.abs(effectiveMoraleModifier)}{formationMorMod !== 0 ? ` (incl. formation ${formationMorMod >= 0 ? '+' : ''}${formationMorMod})` : ''}</span></>
        )}
        <span className="text-gray-400">Threat:</span><span>{threatRating.toFixed(2)}</span>
      </div>

      <div className="border-t border-gray-600 my-1.5" />

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {showTroops && (
          <>
            <span className="text-gray-400">Troops:</span><span>{unit.currentTroopCount}/{unit.maxTroopCount}</span>
          </>
        )}
        <span className="text-gray-400">HP:</span><span>{unit.currentUnitHp}/{unit.maxUnitHp}</span>
        <span className="text-gray-400">Move:</span><span>{unit.movementPointsAvailable}/{effectiveMaxMovement}{showTroops && formationMovMult !== 1 ? ` (base ${unit.movementPoints} × ${formationMovMult})` : ''}</span>
        <span className="text-gray-400">AC:</span><span>{showTroops ? `${effectiveAc} = ${unit.baselineAc}${formationAcMod !== 0 ? ` + ${formationAcMod} (formation)` : ''}${formationAcMod >= 0 ? ' +0' : ''}` : effectiveAc}</span>
      </div>

      <div className="border-t border-gray-600 my-1.5" />

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <span className="text-gray-400">Shielded:</span><span>{unit.isShielded ? 'Yes' : 'No'}</span>
        {showTroops && (
          <><span className="text-gray-400">Formation:</span><span className="capitalize">{unit.currentFormation}{formationMod ? ` (org lv ${unit.organizationLevel})` : ''}</span></>
        )}
        {!showTroops && (
          <><span className="text-gray-400">Mounted:</span><span>{unit.mountName ? 'Yes' : 'No'}</span></>
        )}
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
            <span className={enemyThreats.frontSide + enemyThreats.rear > 0 ? 'text-red-400' : 'text-green-400'}>
              {enemyThreats.frontSide + enemyThreats.rear > 0
                ? `-${enemyThreats.frontSide + enemyThreats.rear} (front/side: ${enemyThreats.frontSide}, rear: ${enemyThreats.rear})`
                : '0'}
            </span>
            {formationMorMod !== 0 && (
              <>
                <span className="text-gray-400">formation</span>
                <span className={formationMorMod > 0 ? 'text-green-400' : 'text-red-400'}>{formationMorMod >= 0 ? '+' : ''}{formationMorMod}</span>
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

export function UnitTooltip({ unit, x, y, attachedHero, units, alliances, formation, attachedHeroFormation }: UnitTooltipProps) {
  return (
    <div
      className="absolute z-50 pointer-events-none bg-black/90 border border-gray-600 rounded shadow-xl p-3 text-xs text-white whitespace-nowrap"
      style={{ left: x + 12, top: y + 12 }}
    >
      {attachedHero && (
        <>
          <div className="font-bold text-yellow-400 mb-1">{attachedHero.unitName} (Hero)</div>
          {unitInfo(attachedHero, units, alliances, false, attachedHeroFormation)}
          <div className="border-t border-gray-600 my-1.5" />
        </>
      )}
      {unitInfo(unit, units, alliances, !unit.isHero, formation)}
    </div>
  );
}
