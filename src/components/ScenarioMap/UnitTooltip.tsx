'use client';

import React from 'react';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { computeEffectiveMoraleModifier } from '@/lib/unitMorale';
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

const HEX_DIRS = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

function threatFromLevel(level: number): number {
  if (level >= 20) return 5;
  if (level >= 16) return 4;
  if (level >= 11) return 3;
  if (level >= 5) return 2;
  return 1;
}

function calcWounds(unit: Unit): number {
  const pctLost = 1 - unit.currentUnitHp / unit.maxUnitHp;
  return -Math.floor(pctLost * 10);
}

function calcIsolation(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>): boolean {
  const unitAlliance = alliances[unit.team] || 'friendly';
  const adjHexes = HEX_DIRS.map(d => ({ q: unit.hex.q + d.q, r: unit.hex.r + d.r, s: unit.hex.s + d.s }));
  return !units.some(u =>
    !u.isDeleted &&
    u.id !== unit.id &&
    (alliances[u.team] || 'friendly') === unitAlliance &&
    adjHexes.some(h => h.q === u.hex.q && h.r === u.hex.r)
  );
}

function calcEnemyThreats(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>): { frontSide: number; rear: number } {
  const unitAlliance = alliances[unit.team] || 'friendly';
  const frontDirs = [(unit.facing + 4) % 6, (unit.facing + 5) % 6];
  const sideDirs = [unit.facing % 6, (unit.facing + 3) % 6];
  const rearDirs = [(unit.facing + 1) % 6, (unit.facing + 2) % 6];

  let frontSide = 0;
  let rear = 0;

  for (const other of units) {
    if (other.isDeleted || other.id === unit.id) continue;
    const otherAlliance = alliances[other.team] || 'friendly';
    if (otherAlliance === unitAlliance) continue;

    const dq = other.hex.q - unit.hex.q;
    const dr = other.hex.r - unit.hex.r;
    const ds = other.hex.s - unit.hex.s;
    const dirIdx = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr && d.s === ds);
    if (dirIdx === -1) continue;

    const threat = threatFromLevel(other.level);
    if (frontDirs.includes(dirIdx) || sideDirs.includes(dirIdx)) {
      frontSide += threat;
    } else if (rearDirs.includes(dirIdx)) {
      rear += threat + 1;
    }
  }

  return { frontSide, rear };
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
  const totalThreat = threatFromLevel(unit.level);
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
        {showTroops && (
          <><span className="text-gray-400">MOR:</span><span className="text-yellow-400">{morTotal} = {unit.baseMorale} {effectiveMoraleModifier >= 0 ? '+ ' : '- '}{Math.abs(effectiveMoraleModifier)}{formationMorMod !== 0 ? ` (incl. formation ${formationMorMod >= 0 ? '+' : ''}${formationMorMod})` : ''}</span></>
        )}
        <span className="text-gray-400">Threat:</span><span>{totalThreat}</span>
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

      {showTroops && (
        <div className="text-xs">
          <div className="text-gray-500 mb-0.5 text-[10px] uppercase tracking-wide">Morale factors</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span className="text-gray-400">wounds</span>
            <span className={wounds < 0 ? 'text-red-400' : 'text-green-400'}>{wounds >= 0 ? '0' : String(wounds)}</span>
            <span className="text-gray-400">isolation</span>
            <span className={isolated ? 'text-red-400' : 'text-green-400'}>{isolated ? '-1' : '0'}</span>
            <span className="text-gray-400">enemies</span>
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
