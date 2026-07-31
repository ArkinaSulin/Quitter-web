// src/components/ScenarioMap/ScenarioMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useHexGrid, hexToPixel } from '@/hooks/useHexGrid';
import { Hex, Unit, UnitTemplate, hexDistance, AllianceGroup, Formation } from '@/types/gameProtocol';
import { parseWeapons } from '@/lib/weaponParser';
import { resolveCombatSequence, computeRowCapacity, determineCombatPosition, isInFrontArc } from '@/lib/unitCombat';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';
import { useScenarios } from '@/hooks/useScenarios';
import { useMessages } from '@/contexts/MessageContext';
import { useGameEngine } from '@/hooks/useGameEngine';
import { useTeamAlliances } from '@/hooks/useTeamAlliances';
import { LeftPanel } from './LeftPanel';
import { ContextMenu } from './ContextMenu';
import { UnitTooltip } from './UnitTooltip';
import { drawToken, loadImage } from '@/components/TokenRenderer/drawToken';
import { computeEffectiveMoraleModifier, computeThreatRating } from '@/lib/unitMorale';
import { supabase } from '@/lib/supabaseClient';
import { getFormationModifier, getFormationMultiplier, getRowCapacity, getVisualDotsPerRow, computeEffectiveMovement } from '@/lib/unitStats';

interface ScenarioMapProps {
  scenarioId: string;
}

const HEX_SIZE = 100;
const TOKEN_WIDTH = HEX_SIZE * 1.6;
const TOKEN_HEIGHT = TOKEN_WIDTH * 0.75;

function DragGhost({ hex, zoom, offsetX, offsetY }: { hex: Hex; zoom: number; offsetX: number; offsetY: number }) {
  return (
    <div
      className="absolute pointer-events-none border-2 border-dashed border-yellow-400 rounded-full"
      style={{
        left: `${(hexToPixel(hex, HEX_SIZE).x * zoom + offsetX)}px`,
        top: `${(hexToPixel(hex, HEX_SIZE).y * zoom + offsetY)}px`,
        width: `${TOKEN_WIDTH * zoom}px`,
        height: `${TOKEN_HEIGHT * zoom}px`,
        transform: 'translate(-50%, -50%)',
        background: 'rgba(255,255,0,0.2)',
      }}
    />
  );
}

export function ScenarioMap({ scenarioId }: ScenarioMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedHex, setSelectedHex] = useState<Hex | null>(null);
  const { units, moveUnit, loading, error, addUnitFromTemplate, deleteUnit, updateUnit, sizeCategories } = useSupabaseSync(scenarioId);
  const { getMyRole, updateScreenshot, unsubscribeFromPresence, subscribeToPresence, fetchScenarios, currentUser, fetchScenarioMapData, updateScenarioField } = useScenarios();
  const { addMessage } = useMessages();
  const [isGM, setIsGM] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [currentTurnAlliance, setCurrentTurnAlliance] = useState<AllianceGroup | null>(null);
  const [turnNumber, setTurnNumber] = useState(0);
  const [backgroundConfig, setBackgroundConfig] = useState<{ imageUrl: string; offsetX: number; offsetY: number; scale: number } | null>(null);
  const [formationsMap, setFormationsMap] = useState<Record<string, Formation>>({});
  const [overlayMap, setOverlayMap] = useState<Record<string, string>>({});

  // Drag from panel
  const [isDraggingFromPanel, setIsDraggingFromPanel] = useState(false);
  const [draggingTemplate, setDraggingTemplate] = useState<UnitTemplate | null>(null);
  const [ghostHex, setGhostHex] = useState<Hex | null>(null);

  // Tooltip
  const [hoveredUnit, setHoveredUnit] = useState<Unit | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Context menu
  const [contextMenuUnit, setContextMenuUnit] = useState<Unit | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Attach position modal
  const [attachModal, setAttachModal] = useState<{
    hero: Unit;
    target: Unit;
  } | null>(null);

  const playerId = currentUser?.id || '';
  const playerName =
    currentUser?.user_metadata?.full_name ||
    currentUser?.user_metadata?.name ||
    currentUser?.email ||
    'Unknown';

  const { alliances, setAlliance } = useTeamAlliances(scenarioId, isGM);


  const {
    execute, moveUnitRecorded, rotateUnit, changeFormation, assignTeam, toggleHide, placeUnit, attachHero, detachHero, endTurn, undo, canUndo, redo, canRedo, peekUndoChainLength,
  } = useGameEngine({
    scenarioId,
    playerId,
    playerName,
    isGM,
    updateUnit,
    moveUnit,
    updateAlliance: setAlliance,
    updateScenarioField,
  });

  const handleEndTurn = useCallback(async () => {
    const { next, wrapped } = await endTurn({
      currentAlliance: currentTurnAlliance,
      alliances,
      units,
      formationsMap,
      turnNumber,
    });
    setCurrentTurnAlliance(next);
    if (wrapped) setTurnNumber(t => t + 1);
  }, [endTurn, currentTurnAlliance, alliances, units, formationsMap, turnNumber]);

  const handleUnitMove = useCallback(async (unitId: string, targetHex: Hex) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    await moveUnitRecorded(unit, targetHex);

    const updatedUnits = units.map(u =>
      u.id === unit.id ? { ...u, hex: { ...targetHex } } : u
    );

    const candidates = new Set<string>([unit.id]);
    for (const u of units) {
      if (u.isDeleted || u.ignoreMoraleChecks || u.isRouting) continue;
      if (u.id !== unit.id && hexDistance(u.hex, targetHex) === 1) {
        candidates.add(u.id);
      }
    }

    for (const id of Array.from(candidates)) {
      const c = updatedUnits.find(u => u.id === id);
      if (!c) continue;
      const formationMorMod = getFormationModifier(formationsMap, c.currentFormation, 'morale_modifier');
      const effectiveMod = c.currentMoraleModifier + computeEffectiveMoraleModifier(c, updatedUnits, alliances, formationMorMod);
      if (c.baseMorale + effectiveMod <= 0) {
        const name = id === unit.id ? unit.unitName : c.unitName;
        await execute('ROUT', [
          {
            type: 'ROUT',
            description: `${name} routed (morale ${c.baseMorale + effectiveMod})`,
            unitId: c.id,
            changes: [
              { field: 'isRouting', from: false, to: true },
              { field: 'currentFormation', from: c.currentFormation, to: 'Routed' },
            ],
          },
        ], `${name} routed`, { chained: true });
      }
    }
  }, [units, moveUnitRecorded, alliances, formationsMap, execute]);

  const handleMoveTeam = useCallback(async (team: string, targetGroup: AllianceGroup) => {
    const currentGroup = alliances[team] || 'friendly';
    if (currentGroup === targetGroup) return;
    await execute('ALLIANCE', [{
      type: 'ALLIANCE',
      description: `Changed ${team} team to ${targetGroup}`,
      unitId: team,
      changes: [{ field: 'alliance_group', from: currentGroup, to: targetGroup }],
    }], `${team} → ${targetGroup}`);
  }, [alliances, execute]);

  const handleAttachHero = useCallback(async (heroId: string, targetUnitId: string, position: 'front' | 'back') => {
    const hero = units.find(u => u.id === heroId);
    const target = units.find(u => u.id === targetUnitId);
    if (!hero || !target) return;
    if (hero.team !== target.team) {
      addMessage(`Can't attach: ${hero.unitName} and ${target.unitName} are on different teams`);
      return;
    }
    if (units.some(u => u.attachedToUnitId === targetUnitId && !u.isDeleted)) {
      addMessage(`${target.unitName} already has a hero attached`);
      return;
    }
    await attachHero(hero, target, position);
    addMessage(`${hero.unitName} attached to ${target.unitName} (${position})`);
  }, [units, attachHero, addMessage]);

  const handleDetachHero = useCallback(async (heroId: string) => {
    const hero = units.find(u => u.id === heroId);
    if (!hero || !hero.attachedToUnitId) return;

    const parentUnit = units.find(u => u.id === hero.attachedToUnitId);
    const changes: { field: string; from: any; to: any }[] = [
      { field: 'attachedToUnitId', from: hero.attachedToUnitId, to: null },
    ];

    if (parentUnit) {
      const directions = [
        { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
        { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
      ];
      const adjacentHexes = directions.map(dir => ({
        q: parentUnit.hex.q + dir.q, r: parentUnit.hex.r + dir.r,
        s: -parentUnit.hex.q - parentUnit.hex.r - dir.q - dir.r,
      }));
      const occupiedHexes = new Set(
        units.filter(u => !u.isDeleted && u.id !== heroId).map(u => `${u.hex.q},${u.hex.r}`)
      );
      const freeHex = adjacentHexes.find(h => !occupiedHexes.has(`${h.q},${h.r}`));
      if (freeHex) {
        changes.push({ field: 'hex', from: { ...hero.hex }, to: { ...freeHex } });
      }
    }

    await execute('DETACH_HERO', [{
      type: 'DETACH_HERO',
      description: `${hero.unitName} detached`,
      unitId: hero.id,
      changes,
    }], `${hero.unitName} detached`);
    addMessage(`${hero.unitName} detached`);
  }, [units, execute, addMessage]);

  // Custom draw function that uses drawToken
  const customDraw = useCallback(async (ctx: CanvasRenderingContext2D, width: number, height: number, currentZoom: number, offsetX: number, offsetY: number) => {
    const tokenWidth = TOKEN_WIDTH * currentZoom;
    const tokenHeight = TOKEN_HEIGHT * currentZoom;

    function getAttachedHeroPos(unitHex: { q: number; r: number; s: number }, facing: number, attachedPosition: 'front' | 'back' | null) {
      const pos = hexToPixel(unitHex, HEX_SIZE);
      const vertexIndex = attachedPosition === 'back' ? (facing + 2) % 6 : (facing + 5) % 6;
      const angle = (60 * vertexIndex - 30) * Math.PI / 180;
      return {
        x: pos.x + HEX_SIZE * 0.75 * Math.cos(angle),
        y: pos.y + HEX_SIZE * 0.75 * Math.sin(angle),
      };
    }

    for (const unit of units) {
      if (unit.isDeleted || unit.attachedToUnitId) continue;
      if (unit.hidden) {
        if (!isGM) continue;
        ctx.save();
        ctx.globalAlpha = 0.3;
      }
      const formationMoraleMod = getFormationModifier(formationsMap, unit.currentFormation, 'morale_modifier');
      const pos = hexToPixel(unit.hex, HEX_SIZE);
      const cx = pos.x * currentZoom + offsetX;
      const cy = pos.y * currentZoom + offsetY;
      const unitMoraleMod = unit.currentMoraleModifier + computeEffectiveMoraleModifier(unit, units, alliances, formationMoraleMod);
      try {
        await drawToken({
          unit: { ...unit, currentMoraleModifier: unitMoraleMod },
          ctx,
          x: cx,
          y: cy,
          width: tokenWidth,
          height: tokenHeight,
          zoom: currentZoom,
          showDetails: true,
          turnNumber: turnNumber,
          teamAlliances: alliances,
          formationsMap,
          sizeCategories,
        });
      } catch (err) {
        console.error('drawToken error:', err);
      }
      if (unit.hidden) ctx.restore();

      const attachedHero = units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted);
      if (attachedHero) {
        const heroPos = getAttachedHeroPos(unit.hex, unit.facing, attachedHero.attachedPosition);
        const heroCx = heroPos.x * currentZoom + offsetX;
        const heroCy = heroPos.y * currentZoom + offsetY;
        const heroFormationMoraleMod = getFormationModifier(formationsMap, attachedHero.currentFormation, 'morale_modifier');
        const heroMoraleMod = attachedHero.currentMoraleModifier + computeEffectiveMoraleModifier(attachedHero, units, alliances, heroFormationMoraleMod);
        try {
          await drawToken({
            unit: { ...attachedHero, currentMoraleModifier: heroMoraleMod },
            ctx,
            x: heroCx,
            y: heroCy,
            width: tokenWidth,
            height: tokenHeight,
            zoom: currentZoom,
            showDetails: true,
            turnNumber: turnNumber,
            teamAlliances: alliances,
            isAttached: true,
            formationsMap,
            sizeCategories,
          });
        } catch (err) {
          console.error('drawToken error (attached hero):', err);
        }
      }
    }
  }, [units, turnNumber, alliances, isGM, formationsMap, sizeCategories]);

  const HEX_DIRS = [
    { q: 1, r: 0, s: -1 },
    { q: 0, r: 1, s: -1 },
    { q: -1, r: 1, s: 0 },
    { q: -1, r: 0, s: 1 },
    { q: 0, r: -1, s: 1 },
    { q: 1, r: -1, s: 0 },
  ];

  function getOverlayForUnit(unit: Unit): Record<string, string> {
    const result: Record<string, string> = {};
    if (unit.isHero || unit.isRouting || unit.currentFormation === 'Scattered') return result;
    for (const dir of HEX_DIRS) {
      const nq = unit.hex.q + dir.q;
      const nr = unit.hex.r + dir.r;
      const key = `${nq},${nr}`;
      const pos = determineCombatPosition({ q: nq, r: nr, s: -nq - nr }, unit.hex, unit.facing);
      if (pos === 'front') {
        result[key] = 'rgba(255, 100, 100, 0.5)';
      }
    }
    return result;
  }

  const {
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleRightClick,
    hoveredHex,
    draggingUnitId,
    offsetX,
    offsetY,
    zoom,
    getHexFromScreen,
    getUnitAt,
    centerMap,
  } = useHexGrid({
    canvasRef,
    size: HEX_SIZE,
    gridRadius: 12,
    units: units,
    onUnitMove: handleUnitMove,
    onHexClick: (hex) => setSelectedHex(hex),
    onHexRightClick: (hex, unit, clientX, clientY) => {
      if (unit && !unit.isDeleted && (isGM || !unit.hidden)) {
        setContextMenuUnit(unit);
        setContextMenuPos({ x: clientX, y: clientY });
      }
    },
    onUnitHover: (unit, screenX, screenY) => {
      if (unit.isDeleted || (unit.hidden && !isGM)) return;
      setHoveredUnit(unit);
      setTooltipPos({ x: screenX, y: screenY });
    },
    onUnitLeave: () => {
      setHoveredUnit(null);
      setTooltipPos(null);
    },
    onAttack: async (attackerId, targetId) => {
      const attacker = units.find(u => u.id === attackerId);
      const target = units.find(u => u.id === targetId);
      if (!attacker || !target) return;

      const targetHasHero = units.some(u => u.attachedToUnitId === targetId && !u.isDeleted);
      const canAttach = attacker.isHero && (attacker.sizeCategory || 100) <= 200 && !target.isHero && !target.attachedToUnitId && !target.isDeleted && !targetHasHero && attacker.team === target.team;
      if (canAttach) {
        setAttachModal({ hero: attacker, target });
        return;
      }

      const attackerGroup = alliances[attacker.team] || 'friendly';
      const targetGroup = alliances[target.team] || 'friendly';
      if (attackerGroup === targetGroup && attackerGroup === 'friendly') {
        addMessage(`${attacker.unitName} cannot attack ${target.unitName}: same alliance`);
        return;
      }

      const attackerWeapons = parseWeapons(attacker.weaponString || '');
      const weapon = attackerWeapons[0];
      if (!weapon) {
        addMessage(`${attacker.unitName} has no weapon to attack with`);
        return;
      }

      const dist = hexDistance(attacker.hex, target.hex);
      if (weapon.range <= 1 && dist > 1) {
        addMessage(`WARNING: ${weapon.name} is melee (range ${weapon.range}), but target is ${dist} hexes away`);
        return;
      }

      const defenderWeapons = parseWeapons(target.weaponString || '');
      const defWeapon = defenderWeapons[0] || null;

      // Front-arc validation for melee attackers
      if (weapon.range <= 1) {
        if (attacker.isRouting) {
          addMessage(`${attacker.unitName} (Routed) cannot initiate attacks`);
          return;
        }
        if (attacker.currentFormation === 'Scattered') {
          addMessage(`${attacker.unitName} (Scattered) cannot initiate melee`);
          return;
        }
        if (!attacker.isHero && !isInFrontArc(attacker.hex, attacker.facing, target.hex)) {
          addMessage(`${attacker.unitName} cannot attack ${target.unitName}: target not in front arc`);
          return;
        }
      }

      const formationAtkMod = getFormationModifier(formationsMap, attacker.currentFormation, 'attack_modifier');
      const attackCapMult = getFormationMultiplier(formationsMap, attacker.currentFormation, 'attack_capacity_multiplier');
      const defAttackCapMult = getFormationMultiplier(formationsMap, target.currentFormation, 'attack_capacity_multiplier');
      const attackerRowCap = getRowCapacity(sizeCategories, attacker.sizeCategory);
      const defenderRowCap = getRowCapacity(sizeCategories, target.sizeCategory);
      const defenderVisualDpr = getVisualDotsPerRow(formationsMap, defenderRowCap, target.currentFormation);
      const isRanged = weapon.range > 1;
      const isRear = determineCombatPosition(attacker.hex, target.hex, target.facing) === 'rear';
      const attachedDefenderHero = (() => {
        const hero = units.find(u => u.attachedToUnitId === target.id && !u.isDeleted);
        if (!hero) return null;
        return { currentAc: hero.currentAc, troopHp: hero.troopHp };
      })();
      const attachedAttackerHero = (() => {
        const hero = units.find(u => u.attachedToUnitId === attacker.id && !u.isDeleted);
        if (!hero) return null;
        return { currentAc: hero.currentAc, troopHp: hero.troopHp };
      })();

      const outcome = resolveCombatSequence(
        attacker,
        target,
        { attackBonus: weapon.attackBonus, damageDice: weapon.damageDice, is_reach: weapon.reach },
        defWeapon ? { attackBonus: defWeapon.attackBonus, damageDice: defWeapon.damageDice, is_reach: defWeapon.reach } : null,
        formationAtkMod,
        attackCapMult,
        defAttackCapMult,
        attackerRowCap,
        defenderRowCap,
        defenderVisualDpr,
        isRanged,
        isRear,
        attachedDefenderHero,
        attachedAttackerHero,
        Math.random,
      );

      const subSteps: { type: any; description: string; unitId: string; changes: { field: string; from: any; to: any }[] }[] = [];

      if (!outcome.aggrPassed) {
        const threatPenalty = Math.max(0, Math.round(computeThreatRating(target) / computeThreatRating(attacker)) - 1);
        addMessage(`${attacker.unitName} AGR check (AGR ${attacker.aggressiveness}${threatPenalty > 0 ? ` - ${threatPenalty} threat` : ''} → need ≤${attacker.aggressiveness - threatPenalty}, rolled ${outcome.aggrRoll}) — failed, no attack`);
        return;
      }

      // Damage direction depends on who struck first
      const damageToDefender = outcome.strikerFirst === 'attacker' ? outcome.firstStrikeDamage : outcome.retaliationDamage;
      const damageToAttacker = outcome.strikerFirst === 'defender' ? outcome.firstStrikeDamage : outcome.retaliationDamage;

      // Apply damage to defender (target)
      const newDefenderHp = Math.max(0, target.currentUnitHp - damageToDefender);
      const newDefenderTroops = Math.ceil(newDefenderHp / target.troopHp);
      const defenderTroopsKilled = target.currentTroopCount - newDefenderTroops;
      if (damageToDefender > 0) {
        subSteps.push({
          type: 'DAMAGE',
          description: `${target.unitName} took ${damageToDefender} damage`,
          unitId: target.id,
          changes: [
            { field: 'currentUnitHp', from: target.currentUnitHp, to: newDefenderHp },
            { field: 'currentTroopCount', from: target.currentTroopCount, to: newDefenderTroops },
          ],
        });
      }

      // Apply damage to attacker
      const newAttackerHp = Math.max(0, attacker.currentUnitHp - damageToAttacker);
      const newAttackerTroops = Math.ceil(newAttackerHp / attacker.troopHp);
      const attackerTroopsKilled = attacker.currentTroopCount - newAttackerTroops;
      if (damageToAttacker > 0) {
        subSteps.push({
          type: 'DAMAGE',
          description: `${attacker.unitName} took ${damageToAttacker} damage`,
          unitId: attacker.id,
          changes: [
            { field: 'currentUnitHp', from: attacker.currentUnitHp, to: newAttackerHp },
            { field: 'currentTroopCount', from: attacker.currentTroopCount, to: newAttackerTroops },
          ],
        });
      }

      // Build description
      const firstStriker = outcome.strikerFirst === 'attacker' ? attacker : target;
      const firstStrikerHits = outcome.firstStrikeAttacks.filter(a => a.isHit).length;
      let desc = `${attacker.unitName} attacks ${target.unitName} with ${weapon.name}`;
      desc += ` — ${firstStriker.unitName} strikes first — ${outcome.firstStrikeAttacks.length} attacks, ${firstStrikerHits} hits, ${outcome.firstStrikeDamage} damage (${outcome.strikerFirst === 'attacker' ? defenderTroopsKilled : attackerTroopsKilled} troops)`;

      // Hero damage from first strike (hero on whoever received the first strike)
      if (outcome.firstStrikeHeroDamage > 0) {
        const heroHostId = outcome.strikerFirst === 'attacker' ? target.id : attacker.id;
        const heroUnit = units.find(u => u.attachedToUnitId === heroHostId && !u.isDeleted);
        if (heroUnit) {
          const newHeroHp = Math.max(0, heroUnit.currentUnitHp - outcome.firstStrikeHeroDamage);
          const newHeroTroops = Math.ceil(newHeroHp / heroUnit.troopHp);
          const heroTroopsKilled = heroUnit.currentTroopCount - newHeroTroops;
          subSteps.push({
            type: 'DAMAGE',
            description: `${heroUnit.unitName} took ${outcome.firstStrikeHeroDamage} damage (attached hero)`,
            unitId: heroUnit.id,
            changes: [
              { field: 'currentUnitHp', from: heroUnit.currentUnitHp, to: newHeroHp },
              { field: 'currentTroopCount', from: heroUnit.currentTroopCount, to: newHeroTroops },
            ],
          });
          desc += `. ${heroUnit.unitName} (hero) took ${outcome.firstStrikeHeroDamage} damage (${heroTroopsKilled} troops)`;
        }
      }

      // Retaliation
      let attackerRouted = false;
      let defenderRouted = false;
      let attMoraleBreak = 0;
      let defMoraleBreak = 0;

      if (outcome.retaliationDamage > 0) {
        const retaliator = outcome.strikerFirst === 'attacker' ? target : attacker;
        const retaliatorHits = outcome.retaliationAttacks.filter(a => a.isHit).length;
        desc += `. ${retaliator.unitName} retaliates — ${outcome.retaliationAttacks.length} attacks, ${retaliatorHits} hits, ${outcome.retaliationDamage} damage (${outcome.strikerFirst === 'attacker' ? attackerTroopsKilled : defenderTroopsKilled} troops)`;

        // Hero damage from retaliation (hero on whoever received the retaliation)
        if (outcome.retaliationHeroDamage > 0) {
          const heroHostId = outcome.strikerFirst === 'attacker' ? attacker.id : target.id;
          const heroUnit = units.find(u => u.attachedToUnitId === heroHostId && !u.isDeleted);
          if (heroUnit) {
            const newHeroHp = Math.max(0, heroUnit.currentUnitHp - outcome.retaliationHeroDamage);
            const newHeroTroops = Math.ceil(newHeroHp / heroUnit.troopHp);
            const heroTroopsKilled = heroUnit.currentTroopCount - newHeroTroops;
            subSteps.push({
              type: 'DAMAGE',
              description: `${heroUnit.unitName} took ${outcome.retaliationHeroDamage} retaliation damage (attached hero)`,
              unitId: heroUnit.id,
              changes: [
                { field: 'currentUnitHp', from: heroUnit.currentUnitHp, to: newHeroHp },
                { field: 'currentTroopCount', from: heroUnit.currentTroopCount, to: newHeroTroops },
              ],
            });
            desc += `. ${heroUnit.unitName} (hero) took ${outcome.retaliationHeroDamage} retaliation damage (${heroTroopsKilled} troops)`;
          }
        }

        // Morale check for attacker after retaliation
        const attackerFormationMorMod = getFormationModifier(formationsMap, attacker.currentFormation, 'morale_modifier');
        const attModUnit = { ...attacker, currentUnitHp: newAttackerHp };
        attMoraleBreak = attModUnit.baseMorale + attModUnit.currentMoraleModifier + computeEffectiveMoraleModifier(attModUnit, units, alliances, attackerFormationMorMod);
        attackerRouted = !attModUnit.ignoreMoraleChecks && !attModUnit.isRouting && (attMoraleBreak <= 0);
      }

      // Morale check for defender
      const defenderFormationMorMod = getFormationModifier(formationsMap, target.currentFormation, 'morale_modifier');
      const defModUnit = { ...target, currentUnitHp: newDefenderHp };
      const defEffectiveMod = defModUnit.currentMoraleModifier + computeEffectiveMoraleModifier(defModUnit, units, alliances, defenderFormationMorMod);
      defenderRouted = !defModUnit.ignoreMoraleChecks && !defModUnit.isRouting && (defModUnit.baseMorale + defEffectiveMod <= 0);

      await execute('ATTACK', subSteps, desc);

      async function routeUnit(unit: Unit, reason: string): Promise<void> {
        const name = unit.unitName;
        await execute('ROUT', [{
          type: 'ROUT',
          description: `${name} routed (${reason})`,
          unitId: unit.id,
          changes: [
            { field: 'isRouting', from: false, to: true },
            { field: 'currentFormation', from: unit.currentFormation, to: 'Routed' },
          ],
        }], `${name} routed`, { chained: true });
      }

      if (defenderRouted) {
        await routeUnit(target, `morale ${defModUnit.baseMorale + defEffectiveMod} after combat`);
        addMessage(`${target.unitName} routed!`);

        for (const u of units) {
          if (u.id === attacker.id || u.id === target.id || u.isDeleted || u.ignoreMoraleChecks || u.isRouting) continue;
          if (hexDistance(u.hex, target.hex) === 1) {
            const formationMorMod = getFormationModifier(formationsMap, u.currentFormation, 'morale_modifier');
            const effectiveMod = u.currentMoraleModifier + computeEffectiveMoraleModifier(u, units, alliances, formationMorMod);
            if (u.baseMorale + effectiveMod <= 0) {
              await routeUnit(u, `morale ${u.baseMorale + effectiveMod} near fleeing ${target.unitName}`);
              addMessage(`${u.unitName} also routed!`);
            }
          }
        }
      }

      if (attackerRouted) {
        await routeUnit(attacker, `morale ${attMoraleBreak} after retaliation`);
        addMessage(`${attacker.unitName} routed!`);

        for (const u of units) {
          if (u.id === attacker.id || u.id === target.id || u.isDeleted || u.ignoreMoraleChecks || u.isRouting) continue;
          if (hexDistance(u.hex, attacker.hex) === 1) {
            const formationMorMod = getFormationModifier(formationsMap, u.currentFormation, 'morale_modifier');
            const effectiveMod = u.currentMoraleModifier + computeEffectiveMoraleModifier(u, units, alliances, formationMorMod);
            if (u.baseMorale + effectiveMod <= 0) {
              await routeUnit(u, `morale ${u.baseMorale + effectiveMod} near fleeing ${attacker.unitName}`);
              addMessage(`${u.unitName} also routed!`);
            }
          }
        }
      }
    },
    customDraw,
    autoCenter: isInitialLoad,
    backgroundImage: backgroundConfig ? { url: backgroundConfig.imageUrl, offsetX: backgroundConfig.offsetX, offsetY: backgroundConfig.offsetY, scale: backgroundConfig.scale } : null,
    overlayMap,
  });

  // Compute overlay map from hover or drag
  function getReachableHexes(
    unit: Unit,
    maxMP: number,
    occupied: Set<string>,
    threatHexes: Set<string>,
  ): Set<string> {
    const reachable = new Set<string>();

    if (unit.isRouting || unit.currentFormation === 'Scattered') {
      const visited = new Set<string>();
      const queue: { q: number; r: number; dist: number }[] = [];
      queue.push({ q: unit.hex.q, r: unit.hex.r, dist: 0 });
      visited.add(`${unit.hex.q},${unit.hex.r}`);

      while (queue.length > 0) {
        const { q, r, dist } = queue.shift()!;
        if (dist > 0) reachable.add(`${q},${r}`);
        if (dist >= maxMP) continue;
        for (const dir of HEX_DIRS) {
          const nq = q + dir.q;
          const nr = r + dir.r;
          const key = `${nq},${nr}`;
          if (visited.has(key) || occupied.has(key)) continue;
          visited.add(key);
          if (threatHexes.has(key)) {
            reachable.add(key);
          } else {
            queue.push({ q: nq, r: nr, dist: dist + 1 });
          }
        }
      }
    } else {
      const visited = new Set<string>();
      const queue: { q: number; r: number; facing: number; mpUsed: number }[] = [];
      queue.push({ q: unit.hex.q, r: unit.hex.r, facing: unit.facing, mpUsed: 0 });
      visited.add(`${unit.hex.q},${unit.hex.r},${unit.facing}`);

      while (queue.length > 0) {
        const { q, r, facing, mpUsed } = queue.shift()!;
        if (mpUsed >= maxMP) continue;

        const frontDirs = [(facing + 4) % 6, (facing + 5) % 6];
        for (const dirIdx of frontDirs) {
          const dir = HEX_DIRS[dirIdx];
          const nq = q + dir.q;
          const nr = r + dir.r;
          const key = `${nq},${nr}`;
          if (occupied.has(key)) continue;
          const stateKey = `${nq},${nr},${facing}`;
          if (visited.has(stateKey)) continue;
          visited.add(stateKey);
          reachable.add(key);
          if (!threatHexes.has(key)) {
            queue.push({ q: nq, r: nr, facing, mpUsed: mpUsed + 1 });
          }
        }

        for (const newFacing of [(facing + 5) % 6, (facing + 1) % 6]) {
          const stateKey = `${q},${r},${newFacing}`;
          if (visited.has(stateKey)) continue;
          visited.add(stateKey);
          queue.push({ q, r, facing: newFacing, mpUsed: mpUsed + 1 });
        }
      }
    }

    return reachable;
  }

  useEffect(() => {
    if (draggingUnitId) {
      const draggedUnit = units.find(u => u.id === draggingUnitId);
      if (!draggedUnit) { setOverlayMap({}); return; }
      const draggedGroup = alliances[draggedUnit.team] || 'friendly';
      const occupied = new Set(units.filter(u => !u.isDeleted && !u.attachedToUnitId).map(u => `${u.hex.q},${u.hex.r}`));

      // Red threat hexes: front arcs of opposite units
      const threatHexes = new Set<string>();
      for (const unit of units) {
        if (unit.isDeleted || unit.id === draggingUnitId || unit.attachedToUnitId || unit.isHero || unit.isRouting) continue;
        const unitGroup = alliances[unit.team] || 'friendly';
        if (unitGroup === draggedGroup) continue;
        for (const dir of HEX_DIRS) {
          const nq = unit.hex.q + dir.q;
          const nr = unit.hex.r + dir.r;
          const key = `${nq},${nr}`;
          if (occupied.has(key)) continue;
          const pos = determineCombatPosition({ q: nq, r: nr, s: -nq - nr }, unit.hex, unit.facing);
          if (pos === 'front') threatHexes.add(key);
        }
      }

      // White reachable hexes for the dragged unit
      const movementMult = getFormationMultiplier(formationsMap, draggedUnit.currentFormation, 'movement_multiplier');
      const maxMP = computeEffectiveMovement(draggedUnit, movementMult);
      const whiteHexes = getReachableHexes(draggedUnit, maxMP, occupied, threatHexes);

      const combined: Record<string, string> = {};
      for (const key of Array.from(whiteHexes)) combined[key] = 'rgba(255, 255, 255, 0.5)';
      for (const key of Array.from(threatHexes)) combined[key] = 'rgba(255, 100, 100, 0.5)';

      setOverlayMap(combined);
    } else if (hoveredUnit) {
      setOverlayMap(getOverlayForUnit(hoveredUnit));
    } else {
      setOverlayMap({});
    }
  }, [draggingUnitId, hoveredUnit, units, alliances, formationsMap]);

  // Center map on initial load
  useEffect(() => {
    if (isInitialLoad && !loading && canvasRef.current) {
      const timer = setTimeout(() => {
        centerMap();
        setIsInitialLoad(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isInitialLoad, loading, canvasRef, centerMap]);

  // ---- Drag from panel ----
  const handleUnitDragStart = useCallback((template: UnitTemplate) => {
    setDraggingTemplate(template);
    setIsDraggingFromPanel(true);
  }, []);

  useEffect(() => {
    if (!isDraggingFromPanel || !draggingTemplate) return;
    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      if (canvasRef.current) {
        const hex = getHexFromScreen(e.clientX, e.clientY);
        setGhostHex(hex);
      }
    };
    const onMouseUp = async (e: MouseEvent) => {
      if (window.getSelection) {
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      }
      if (canvasRef.current && draggingTemplate) {
        const rect = canvasRef.current.getBoundingClientRect();
        const inCanvas =
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (inCanvas) {
          const hex = getHexFromScreen(e.clientX, e.clientY);
          if (hex) {
            const existing = getUnitAt(hex);
            if (existing) {
              addMessage(`Can't place ${draggingTemplate.unitName}: hex occupied by ${existing.unitName}`);
              return;
            }
            const unitId = await addUnitFromTemplate(draggingTemplate, hex, 'black');
            if (unitId) {
              await placeUnit(draggingTemplate.unitName, unitId, hex);
            } else {
              addMessage(`Failed to place ${draggingTemplate.unitName}`);
            }
          }
        }
      }
      setIsDraggingFromPanel(false);
      setDraggingTemplate(null);
      setGhostHex(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDraggingFromPanel, draggingTemplate, addUnitFromTemplate, addMessage, getHexFromScreen, getUnitAt]);

  // ---- Screenshot capture ----
  const captureAndUploadScreenshot = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('[Screenshot] Canvas not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[Screenshot] Context not found');
      return;
    }

    try {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const displayWidth = rect.width;
      const displayHeight = rect.height;

      // Calculate bounds (units or full grid)
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      if (units.length > 0) {
        for (const unit of units) {
          const pos = hexToPixel(unit.hex, HEX_SIZE);
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x);
          maxY = Math.max(maxY, pos.y);
        }
        const padding = Math.max((maxX - minX) * 0.2, 100);
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
      } else {
        const gridRadius = 8;
        const hexes: Hex[] = [];
        for (let q = -gridRadius; q <= gridRadius; q++) {
          for (let r = -gridRadius; r <= gridRadius; r++) {
            const s = -q - r;
            if (Math.abs(s) <= gridRadius) hexes.push({ q, r, s });
          }
        }
        for (const hex of hexes) {
          const pos = hexToPixel(hex, HEX_SIZE);
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x);
          maxY = Math.max(maxY, pos.y);
        }
        const padding = 100;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
      }

      const worldWidth = maxX - minX;
      const worldHeight = maxY - minY;
      const zoomX = displayWidth / worldWidth;
      const zoomY = displayHeight / worldHeight;
      const fitZoom = Math.min(zoomX, zoomY, 2);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const fitOffsetX = displayWidth / 2 - centerX * fitZoom;
      const fitOffsetY = displayHeight / 2 - centerY * fitZoom;

      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, displayWidth, displayHeight);

      // Draw background image in screenshot
      if (backgroundConfig) {
        try {
          const bgImg = await loadImage(backgroundConfig.imageUrl);
          const imgW = bgImg.naturalWidth * backgroundConfig.scale * fitZoom;
          const imgH = bgImg.naturalHeight * backgroundConfig.scale * fitZoom;
          const imgX = backgroundConfig.offsetX * fitZoom + fitOffsetX - imgW / 2;
          const imgY = backgroundConfig.offsetY * fitZoom + fitOffsetY - imgH / 2;
          ctx.drawImage(bgImg, imgX, imgY, imgW, imgH);
        } catch {
          // background image failed to load, skip
        }
      }

      // Draw hex grid
      const gridRadius = 8;
      const hexes: Hex[] = [];
      for (let q = -gridRadius; q <= gridRadius; q++) {
        for (let r = -gridRadius; r <= gridRadius; r++) {
          const s = -q - r;
          if (Math.abs(s) <= gridRadius) hexes.push({ q, r, s });
        }
      }

      const drawHex = (hex: Hex) => {
        const pos = hexToPixel(hex, HEX_SIZE);
        const cx = pos.x * fitZoom + fitOffsetX;
        const cy = pos.y * fitZoom + fitOffsetY;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 180 * (60 * i - 30);
          const px = cx + HEX_SIZE * fitZoom * Math.cos(angle);
          const py = cy + HEX_SIZE * fitZoom * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fill();
        ctx.strokeStyle = '#2a2a4a';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      };

      for (const hex of hexes) drawHex(hex);

      // Preload token images so all draws are synchronous
      const imageUrls = new Set<string>();
      for (const unit of units) {
        if (unit.isDeleted) continue;
        if (unit.raceIconUrl) imageUrls.add(unit.raceIconUrl);
        if (unit.unitTypeIconUrl) imageUrls.add(unit.unitTypeIconUrl);
        if (unit.customImageUrl) imageUrls.add(unit.customImageUrl);
      }
      await Promise.all(Array.from(imageUrls).map(url => loadImage(url).catch(() => {})));

      // Draw units using drawToken
      const tokenWidth = TOKEN_WIDTH * fitZoom;
      const tokenHeight = TOKEN_HEIGHT * fitZoom;

      const getScreenshotHeroPos = (unitHex: { q: number; r: number; s: number }, facing: number) => {
        const pos = hexToPixel(unitHex, HEX_SIZE);
        const frontVertexIndex = (facing + 5) % 6;
        const angle = (60 * frontVertexIndex - 30) * Math.PI / 180;
        return {
          x: pos.x + HEX_SIZE * 0.75 * Math.cos(angle),
          y: pos.y + HEX_SIZE * 0.75 * Math.sin(angle),
        };
      };

      for (const unit of units) {
        if (unit.isDeleted || unit.attachedToUnitId) continue;
        if (unit.hidden) {
          ctx.save();
          ctx.globalAlpha = 0.3;
        }
        const pos = hexToPixel(unit.hex, HEX_SIZE);
        const cx = pos.x * fitZoom + fitOffsetX;
        const cy = pos.y * fitZoom + fitOffsetY;

        try {
          await drawToken({
            unit,
            ctx,
            x: cx,
            y: cy,
            width: tokenWidth,
            height: tokenHeight,
            zoom: fitZoom,
            showDetails: true,
            teamAlliances: alliances,
          });
        } catch (err) {
          console.error(`[Screenshot] Error drawing token ${unit.id}:`, err);
        }
        if (unit.hidden) ctx.restore();

        const attachedHero = units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted);
        if (attachedHero) {
          const heroPos = getScreenshotHeroPos(unit.hex, unit.facing);
          const heroCx = heroPos.x * fitZoom + fitOffsetX;
          const heroCy = heroPos.y * fitZoom + fitOffsetY;
          try {
            await drawToken({
              unit: attachedHero,
              ctx,
              x: heroCx,
              y: heroCy,
              width: tokenWidth,
              height: tokenHeight,
              zoom: fitZoom,
              showDetails: true,
              teamAlliances: alliances,
              isAttached: true,
            });
          } catch (err) {
            console.error(`[Screenshot] Error drawing attached hero ${attachedHero.id}:`, err);
          }
        }
      }

      const dataUrl = canvas.toDataURL('image/png');
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      const fileName = `scenario_${scenarioId}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      await updateScreenshot(scenarioId, file);
      console.log('[Screenshot] Uploaded successfully:', fileName);

      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      ctx.scale(dpr, dpr);
    } catch (err) {
      console.error('[Screenshot] Error:', err);
    }
  }, [canvasRef, units, scenarioId, updateScreenshot, isGM, backgroundConfig]);

  // Screenshot is captured in goToLobby (button).
  // beforeunload is unreliable for async — not used.
  const goToLobby = async () => {
    if (isGM) {
      await captureAndUploadScreenshot();
      await fetchScenarios();
    }
    unsubscribeFromPresence(scenarioId);
    localStorage.removeItem('currentScenarioId');
    window.location.reload();
  };

  // ---- Role detection ----
  useEffect(() => {
    getMyRole(scenarioId).then(role => {
      const gm = role === 'GM';
      setIsGM(gm);
      if (gm) subscribeToPresence(scenarioId, () => {});
    });
  }, [scenarioId, getMyRole, subscribeToPresence]);

  // ---- Load formations lookup ----
  useEffect(() => {
    supabase.from('formations').select('*').then(({ data }) => {
      if (data) {
        const map: Record<string, Formation> = {};
        for (const f of data) map[f.name] = f;
        setFormationsMap(map);
      }
    });
  }, []);

  // ---- Load map background config ----
  useEffect(() => {
    fetchScenarioMapData(scenarioId).then(data => {
      if (data?.backgroundImageUrl) {
        setBackgroundConfig({
          imageUrl: data.backgroundImageUrl,
          offsetX: data.bgOffsetX ?? 0,
          offsetY: data.bgOffsetY ?? 0,
          scale: data.bgScale ?? 1,
        });
      }
    });
  }, [scenarioId, fetchScenarioMapData]);

  // ---- Load & track turn state ----
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('scenarios')
      .select('current_turn_alliance, turn_number')
      .eq('id', scenarioId)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setCurrentTurnAlliance(data.current_turn_alliance || null);
        setTurnNumber(data.turn_number || 0);
      });
    return () => { cancelled = true; };
  }, [scenarioId]);

  useEffect(() => {
    const channel = supabase
      .channel(`scenario_turn:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'scenarios', filter: `id=eq.${scenarioId}` },
        (payload: any) => {
          const row = payload.new;
          if (row.current_turn_alliance !== undefined) {
            setCurrentTurnAlliance(row.current_turn_alliance || null);
          }
          if (row.turn_number !== undefined) {
            setTurnNumber(row.turn_number || 0);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scenarioId]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.key === 'q' || e.key === 'Q') && contextMenuUnit && !contextMenuUnit.isHero) {
        rotateUnit(contextMenuUnit, 'left');
      } else if ((e.key === 'e' || e.key === 'E') && contextMenuUnit && !contextMenuUnit.isHero) {
        rotateUnit(contextMenuUnit, 'right');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, contextMenuUnit, rotateUnit]);

  if (loading) return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading scenario...</div>;
  if (error) return <div className="w-full h-screen bg-[#0d0d1a] text-red-500 flex items-center justify-center">Error: {error}</div>;

  return (
    <div className="relative w-full h-screen bg-[#0d0d1a] overflow-hidden select-none">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2 bg-black/40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="text-white text-lg font-semibold">
            Scenario Map - {isGM ? 'DM' : 'Player'}
          </span>
          <span className="text-white text-sm font-mono">Turn {turnNumber}</span>
          <button
            onClick={undo}
            disabled={!canUndo()}
            className={`px-3 py-1 rounded shadow-lg text-sm ${
              canUndo()
                ? 'bg-amber-700 hover:bg-amber-600 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {`Undo${peekUndoChainLength() > 1 ? ` (${peekUndoChainLength()})` : ''}`}
          </button>
          <button
            onClick={handleEndTurn}
            className={`px-3 py-1 rounded shadow-lg text-sm ${
              currentTurnAlliance === 'enemy'
                ? 'bg-[#D55E00] hover:bg-[#c74f00] text-white'
                : currentTurnAlliance === 'neutral'
                  ? 'bg-[#E0E0E0] hover:bg-[#d0d0d0] text-black'
                  : 'bg-[#0072B2] hover:bg-[#00619c] text-white'
            }`}
          >
            {`End Turn (${currentTurnAlliance ?? 'friendly'})`}
          </button>
        </div>
        <button onClick={goToLobby} className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded shadow-lg text-sm">
          Exit Session
        </button>
      </div>

      {/* Floating Left Panel */}
      <div className="absolute top-14 left-2 z-10">
        <LeftPanel
          scenarioId={scenarioId}
          onUnitDragStart={handleUnitDragStart}
          isGM={isGM}
          alliances={alliances}
          onMoveTeam={handleMoveTeam}
        />
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-default"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleRightClick}
      />

      {/* Ghost previews */}
      {isDraggingFromPanel && ghostHex && (
        <DragGhost hex={ghostHex} zoom={zoom} offsetX={offsetX} offsetY={offsetY} />
      )}
      {draggingUnitId && hoveredHex && units.some(
        u => u.id === draggingUnitId && (u.hex.q !== hoveredHex.q || u.hex.r !== hoveredHex.r)
      ) && (
        <DragGhost hex={hoveredHex} zoom={zoom} offsetX={offsetX} offsetY={offsetY} />
      )}

      {/* Tooltip */}
      {hoveredUnit && tooltipPos && (
        <UnitTooltip
          unit={hoveredUnit}
          x={tooltipPos.x}
          y={tooltipPos.y}
          attachedHero={units.find(u => u.attachedToUnitId === hoveredUnit.id && !u.isDeleted) || undefined}
          units={units}
          alliances={alliances}
          formation={formationsMap[hoveredUnit.currentFormation] ?? null}
          attachedHeroFormation={(() => {
            const hero = units.find(u => u.attachedToUnitId === hoveredUnit.id && !u.isDeleted);
            return hero ? (formationsMap[hero.currentFormation] ?? null) : undefined;
          })()}
        />
      )}

      {/* Context Menu */}
      {contextMenuUnit && contextMenuPos && (
        <ContextMenu
          unit={contextMenuUnit}
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          isGM={isGM}
          onClose={() => { setContextMenuUnit(null); setContextMenuPos(null); }}
          onRotate={(dir) => rotateUnit(contextMenuUnit, dir)}
          onChangeFormation={(formation) => changeFormation(contextMenuUnit, formation, formationsMap)}
          onSelectWeapon={(idx) => addMessage(`Selected weapon ${idx} for ${contextMenuUnit.unitName}`)}
          onAssignTeam={(team) => assignTeam(contextMenuUnit, team)}
          onToggleHide={() => toggleHide(contextMenuUnit)}
          onDeleteUnit={async () => {
            await execute('DELETE', [{
              type: 'DELETE',
              description: `Removed ${contextMenuUnit.unitName} from play`,
              unitId: contextMenuUnit.id,
              changes: [{ field: 'isDeleted', from: false, to: true }],
            }], `Removed ${contextMenuUnit.unitName}`);
          }}
          onAttachHero={(heroId, targetUnitId) => {
            const hero = units.find(u => u.id === heroId);
            const target = units.find(u => u.id === targetUnitId);
            if (hero && target) setAttachModal({ hero, target });
          }}
          onDetachHero={(heroId) => handleDetachHero(heroId)}
          units={units}
        />
      )}

      {/* Attach Position Modal */}
      {attachModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[280px]">
            <p className="text-white text-sm mb-4 text-center">
              {attachModal.hero.unitName} → {attachModal.target.unitName}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => { handleAttachHero(attachModal.hero.id, attachModal.target.id, 'front'); setAttachModal(null); }}
              >
                Leader mode (Front)
              </button>
              <button
                className="bg-teal-700 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => { handleAttachHero(attachModal.hero.id, attachModal.target.id, 'back'); setAttachModal(null); }}
              >
                Protected mode (rear)
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setAttachModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Panel */}
      <div className="absolute bottom-4 right-4 bg-black/60 text-white px-4 py-2 rounded-lg text-sm font-mono space-y-1 pointer-events-none">
        <div>Hover: {hoveredHex ? `${hoveredHex.q}, ${hoveredHex.r}` : '—'}</div>
        <div>Selected: {selectedHex ? `${selectedHex.q}, ${selectedHex.r}` : '—'}</div>
        <div>Dragging: {draggingUnitId || (isDraggingFromPanel ? 'from panel' : '—')}</div>
        <div className="text-green-400 text-xs">Realtime active</div>
        <div className="text-gray-400 text-xs">Units: {units.length}</div>
        <div className="text-gray-500 text-xs">Scenario: {scenarioId.slice(0, 8)}…</div>
        {isGM && <div className="text-yellow-400 text-xs">DM</div>}
      </div>
    </div>
  );
}