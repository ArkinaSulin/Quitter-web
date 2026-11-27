// src/components/ScenarioMap/ScenarioMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useHexGrid, hexToPixel, type TargetFilter } from '@/hooks/useHexGrid';
import { parseSubSteps, CommandLogRow, SubStep } from '@/packages/infra';
import { Hex, Unit, UnitTemplate, AllianceGroup, Formation, ScenarioRole, getOrganizationLevel, GroundEffect, EffectKind, hexDistance } from '@/types/gameProtocol';
import { routRetreatPath, type RoutPath } from '@/packages/morale';
import { findAttachedHero, heroRideMoveStep, heroDetachStep } from '@/packages/units';
import { applyMoveCost, applyHeroMoveCost, moveBudgetUnit, isLooseUnit, canAdoptFormation } from '@/packages/movement';
import { nextLowerFormation } from '@/packages/movement';
import { parseWeapons, damageDiceCount, withDamageDiceCount, warMachineTurnActionCost, classifyUnitShipAttack, unitShipAttackWeapon } from '@/packages/units';
import { canReactWithWeapon, resolveSpellDamage } from '@/packages/combat';
import { getFormations } from '@/packages/infra';
import { loadSettings, getSetting } from '@/packages/infra';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';
import { fetchUnitTemplates } from '@/hooks/useUnitTemplates';
import { useScenarios, DM_HEARTBEAT_INTERVAL_MS, DM_HEARTBEAT_STALE_MS, DM_HEARTBEAT_POLL_MS } from '@/hooks/useScenarios';
import { computeReachableMap } from '@/packages/movement';
import { getFormationChangeMpCost } from '@/packages/movement';
import { useGameEngine } from '@/hooks/useGameEngine';
import { useTeamAlliances } from '@/hooks/useTeamAlliances';
import { useMessageSync } from '@/hooks/useMessageSync';
import { useScenarioToast } from '@/hooks/useScenarioToast';
import { useSharedStats } from '@/hooks/useSharedStats';
import Toast from '@/components/Toast';
import { useProfile } from '@/hooks/useProfile';
import { useReplay } from '@/hooks/useReplay';
import { useParticipants } from '@/hooks/useParticipants';
import { useScenarioCapabilities } from '@/hooks/useScenarioCapabilities';
import { usePing } from '@/hooks/usePing';
import { canActOnUnit, canAdjustUnit, allTrueCapabilities } from '@/packages/world';
import { isUnitInteractable } from '@/packages/units';
import { LeftPanel } from './LeftPanel';
import { type ShipLibraryEntry } from '@/hooks/useShipTemplates';
import { useShips } from '@/hooks/useShips';
import { useCampaignShips } from '@/hooks/useCampaignShips';
import { DryDockWindow } from './DryDockWindow';
import { CampaignDropModal } from './CampaignDropModal';
import { FreePlacementModal, type FreePlacementRequest } from './FreePlacementModal';
import { FreePlacementAirModal, type FreePlacementAirRequest } from './FreePlacementAirModal';
import {
  shipRowFromParts,
  computeShipReachable,
  shipTurnDistance,
  declareSpeed,
  shipStepRemaining,
  shipRoundRemaining,
  shipRoundSpent,
  shipHasPilot,
  rebuildStepBudgetPreservingMoved,
  resolveShipWeaponDamage,
  ramDamageDice,
  shipWeaponCards,
  fireShipWeapon,
  shipAttackMode,
  pickShipComponent,
  shipHitCards,
  findCardKeyForComponent,
  findCardKeysForComponent,
  shipStationCards,
  shipStationStats,
  bestCheckBonus,
  cardCommandBonus,
  setCardCommandBonus,
  clearCardCommandBonus,
  shipCaptainHero,
  needsStationReplacement,
  effectiveShipStats,
  shipSailRudderManning,
  shipAtmospherePools,
  shipAtmosphereSpend,
  shipIsGrounded,
  shipMeleeThreat,
  type ShipReachEntry,  type ShipDerivedStats,
  shipHelmOwner,
  captaincyBonus,
  signedBonus,
  computeShipBuild,
  shipViewerAccess,
  shipCardFunctionHeroes,
  shipCommandHero,
  shipHeroesOnCard,
  shipCardCrewCount,
  canSpendCardStep,
  cardStepsRemaining,
  spendCardSteps,
  planShipWeaponAutoLoad,
  manualShipWeaponLoad,
  adjustStepBudget,
  SHIP_HULL_REPAIR_CAPACITY,
  shipHullCardKey,
  shipHullDestroyed,
  shipHullBoxes,
  shipDamagedCards,
  repairOneBox,
  repairHpCap,
  cargoManifestMass,
  cargoQuantity,
  computeCargoCapacity,
  consumeCargoQuantity,
  normalizeCargoManifest,
  minHpAfterDamage,
  pruneShipBoxState,
  pruneShipCrewState,
  pruneShipStations,
  shipCrewIds,
  type ShipRuntime,
  type CampaignShip,
  campaignBaseName,
  campaignDisplayName,
  campaignFamily,
  campaignFamilyOf,
  campaignNextNumeral,
  campaignSlotTaken,
  type ShipCardStepState,
  type ShipViewerAccess,
  survivingSailRudder,
  componentTonsForDamage,
  cappedComponentTons,
  packCargoBoxes,
  rollDestroyedCargoBoxes,
  removeCargoBoxes,
  cargoDamageSummary,
  mergeCargoItems,
  shipCardCrewTargets,
  pickDistinct,
  rollMaxTargets,
  formatShipAttackDetail,
  formatShipCheckDetail,
  formatShipDamageDetail,
  formatShipMaxTargetDetail,
} from '@/packages/ships';
import { ShipWindow } from './ShipWindow';
import { SpeedDeclarationPanel } from './SpeedDeclarationPanel';
import type { CrewDraft } from '@/components/ShipRenderer/CrewAdjustDialog';
import type { CargoManifestItem } from '@/types/ship';
import { shipImageHeightPx, shipImageOffsetPx } from '@/components/ShipRenderer/shipImageScale';
import { SailingShipIcon } from './ShipSelector';
import { AiPanel } from './AiPanel';
import { AiOverlayData } from './aiTypes';
import { isAiControllable } from '@/packages/ai';
import { ContextMenu } from './ContextMenu';
import { ShipContextMenu } from './ShipContextMenu';
import { TeamContextMenu } from './TeamContextMenu';
import { WeaponSelect } from './WeaponSelect';
import { MountTargetChoice } from './MountTargetChoice';
import { UnitTooltip } from './UnitTooltip';
import { ShipTooltip } from './ShipTooltip';
import { MapInfoTooltip } from './MapInfoTooltip';
import { ReplayOverlay } from './ReplayOverlay';
import { UnitEditorModal } from './UnitEditorModal';
import { PingLayer } from './PingLayer';
import { TEAM_COLORS, TEAMS, Team, alphaLabel } from '@/packages/units';
import { TeamChip } from '@/components/TokenRenderer/TeamChip';
import { isUnitRouted, areHexesAdjacent, setHeroMoraleBoostEnabled as setHeroMoraleBoostAmbient, setZocPursuitEnabled as setZocPursuitAmbient } from '@/packages/morale';
import { isHostile, allianceOf, sameAlliance, facingToward, HEX_DIRS, rollDamageDetailed } from '@/packages/primitives';
import { canRally } from '@/packages/morale';
import { computeVisibleHexes, computeFog, hexKey, DEFAULT_SIGHT_RADIUS, FOG_UNSEEN_GM_ALPHA, FOG_UNSEEN_PLAYER_ALPHA } from '@/packages/world';
import { supabase } from '@/packages/infra/supabase';
import { getFormationMultiplier, getFormationModifier, computeEffectiveMovement, getRowCapacity } from '@/packages/units';
import { computeAttackCount } from '@/packages/combat';
import { useMagicCast } from '@/hooks/useMagicCast';
import type { MagicCastState } from '@/hooks/useMagicCast';
import { MagicCastModal } from './MagicCastModal';
import { HEX_SIZE, TOKEN_WIDTH, TOKEN_HEIGHT, DEFAULT_GRID_RADIUS, MapBackgroundConfig, TerrainCosts, PlacedShip, computeOccupiedHexes, computeThreatHexes, makeCostOfHex, mpCostOverrides, isHexOnGrid, type ThreatShip } from '@/packages/world';
import { withdrawDestinations, canWithdraw, WITHDRAW_ACTION_COST, isRotationAffordable } from '@/packages/movement';
import { canReachStructure, canFly, parseClimbTo, isAirborne, flyMax, elevationOffset, hexDirection } from '@/packages/movement';
import { Walls, edgeRef, nearestEdge, isDestructibleWall, wallHp, type EdgeRef } from '@/packages/movement';
import { MapStructures, parseStructures, structuresToWalls, structureRangeBonus, structureZones, isHexStructureKey, canToggleStructureDoor, structureSurfaceAt, edgeShowsLadder, structureElevation, edgeKeysAroundHex, floatingUnits, structureDoorState, structureHasDoor, buildFreePlacementOptions, structureTemplatesWithSnapshots, type FreePlacementOption } from '@/packages/movement';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { getStructureTemplates } from '@/packages/infra';
import { wallAttackKind, resolveWallAttack, edgeHexes } from '@/packages/combat';
import { hexStructureAttackKind, resolveHexStructureAttack, isAttackableHexStructure, structureDoorMax } from '@/packages/combat';
import { formatStructureAttackRolls, formatStructureToHit, formatSpellRollLine, heroAuraBonus } from '@/packages/units';
import type { SaveStat } from '@/packages/units';
import { StructureEditModal, StructureInstancePatch } from '@/components/StructureEditModal';
import { unitAttackCap } from '@/packages/combat';
import { newEffectKey, rangeBonusAt, saveRollFlags, effectSaveBonus } from '@/packages/effects';
import { canWeaponAttack } from '@/packages/combat';
import { MapEntity } from '@/packages/world';
import { getActiveGroups, advanceTurn, advanceShipStep } from '@/packages/world';
import {
  beginNextWave,
  completedWaveForPhase,
  defaultHalloweenSiegeConfig,
  isHalloweenSiegeConfigValid,
  parseHalloweenSiegeConfig,
  planSiegeSpawn,
  shouldAnnounceWaveCompletion,
  siegePhaseForTurn,
  toggleNextWaveArm,
  type HalloweenSiegeConfig,
  type SiegePhase,
} from '@/packages/world';
import { HalloweenSiegeWindow } from './HalloweenSiegeWindow';
import { AddEffectModal } from './AddEffectModal';
import { EffectFormModal, EffectFormValue } from './EffectFormModal';
import { EffectCatalogTemplate, templateById } from '@/packages/effects';
import { EffectModifier, EffectTemplate as EffectLibraryTemplate, mapEffectRow, modifierAmount } from '@/packages/effects';
import { expandHexEffects, normalizeGroundEffectKinds } from '@/packages/effects';
import { routeUnit, fallSteps, detachOnDeath } from './routeUnit';
import { ScenarioStatsModal } from './ScenarioStatsModal';
import { parseDragPayload } from './EffectsPanel';
import { useCommandLogRows } from '@/hooks/useCommandLogRows';
import { buildFallen } from '@/packages/battle';
import { useCanvasDraw } from './useCanvasDraw';
import { useReactionActions } from './useReactionActions';
import { useMoveActions } from './useMoveActions';
import { useCastActions } from './useCastActions';
import { useCombatActions } from './useCombatActions';
import { computeOverlayMap } from './useOverlay';
import { TopBar } from './TopBar';
import { SoftEnforcementModals, type PendingWallAttack, type PendingRotate } from './SoftEnforcementModals';

interface ScenarioMapProps {
  scenarioId: string;
  /** Standalone replay session (Mode 1). When true, the map opens in replay mode. */
  replayMode?: boolean;
}

function DragGhost({ x, y, zoom, offsetX, offsetY }: { x: number; y: number; zoom: number; offsetX: number; offsetY: number }) {
  return (
    <div
      className="absolute pointer-events-none border-2 border-dashed border-yellow-400 rounded-full"
      style={{
        left: `${x * zoom + offsetX}px`,
        top: `${y * zoom + offsetY}px`,
        width: `${TOKEN_WIDTH * zoom}px`,
        height: `${TOKEN_HEIGHT * zoom}px`,
        transform: 'translate(-50%, -50%)',
        background: 'rgba(250,204,21,0.2)',
      }}
    />
  );
}

function ShipDragGhost({
  x,
  y,
  zoom,
  offsetX,
  offsetY,
  imageUrl,
  keelLength,
  imageOffsetY,
  name,
}: {
  x: number;
  y: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  imageUrl: string;
  keelLength: number;
  imageOffsetY: number;
  name: string;
}) {
  const height = shipImageHeightPx(keelLength, HEX_SIZE) * zoom;
  const imageOffset = shipImageOffsetPx(imageOffsetY, HEX_SIZE) * zoom;
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${x * zoom + offsetX}px`,
        top: `${y * zoom + offsetY}px`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="max-w-none opacity-75"
          style={{
            height: `${height}px`,
            width: 'auto',
            transform: `translateY(${-imageOffset}px)`,
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.9))',
          }}
        />
      ) : (
        <div className="flex flex-col items-center text-yellow-300/80">
          <SailingShipIcon size={Math.max(16, Math.min(48, height * 0.4))} />
          <span className="text-[10px] whitespace-nowrap">{name}</span>
        </div>
      )}
    </div>
  );
}

/** The drag-target filter a held modifier selects. Shift/1 â†’ structure,
 *  Space/2 â†’ ground, 3 â†’ air (first pressed wins). */
const FILTER_KIND: Record<string, Exclude<TargetFilter, null>> = {
  shift: 'structure',
  d1: 'structure',
  space: 'ground',
  d2: 'ground',
  d3: 'air',
};

/** A stable id for a filter-modifier keydown/keyup (aliases share the kind), or null. */
function filterKeyId(e: KeyboardEvent): string | null {
  if (e.key === 'Shift') return 'shift';
  if (e.code === 'Space') return 'space';
  if (e.code === 'Digit1' || e.key === '1') return 'd1';
  if (e.code === 'Digit2' || e.key === '2') return 'd2';
  if (e.code === 'Digit3' || e.key === '3') return 'd3';
  return null;
}

type DroppedEffect = {
  id?: string;
  name: string;
  color: string;
  imageUrl: string;
  imageScale: number;
  transparentBackground: boolean;
  layer: 'above' | 'below';
  scope: 'unit' | 'zone' | 'both';
  defaultDuration: number;
  permanent: boolean;
  modifiers: {
    kind: string;
    dice?: string;
    healing?: boolean;
    savingThrow?: 'Str' | 'Dex' | 'Con' | 'Int' | 'Wis' | 'Cha' | null;
    saveDC?: number | null;
    onSaveHalfOrNeg?: boolean;
    mode?: 'melee' | 'ranged';
    direction?: 'in' | 'out' | 'both';
  }[];
};

/** Build an editable form value from a dropped template. */
function formFromDrop(t: DroppedEffect, casterTeam: string): EffectFormValue {
  return {
    name: t.name,
    color: t.color,
    imageUrl: t.imageUrl,
    imageScale: t.imageScale ?? 100,
    transparentBackground: t.transparentBackground ?? false,
    layer: t.layer,
    duration: t.defaultDuration,
    elevation: (t as any).elevation ?? 0,
    casterTeam,
    scope: t.scope,
    permanent: t.permanent,
    modifiers: t.modifiers.map(m => ({
      kind: m.kind as EffectModifier['kind'],
      ...(m.dice ? { dice: m.dice } : {}),
      ...(m.healing ? { healing: true } : {}),
      ...(m.savingThrow ? { savingThrow: m.savingThrow } : {}),
      ...(m.saveDC != null ? { saveDC: m.saveDC } : {}),
      ...(m.onSaveHalfOrNeg !== undefined ? { onSaveHalfOrNeg: m.onSaveHalfOrNeg } : {}),
      ...(m.mode ? { mode: m.mode } : {}),
      ...(m.direction ? { direction: m.direction } : {}),
    })),
  };
}

/** Build an editable form value from a placed ground zone. */
function formFromZone(z: GroundEffect): EffectFormValue {
  return {
    name: z.name,
    color: z.color,
    imageUrl: z.imageUrl ?? '',
    imageScale: z.imageScale ?? 100,
    transparentBackground: z.transparentBackground ?? false,
    layer: z.layer ?? 'below',
    duration: z.turnsLeft,
    elevation: z.elevation ?? 0,
    casterTeam: z.casterTeam ?? '',
    permanent: !!z.permanent,
    modifiers: [{
      kind: z.kind as EffectModifier['kind'],
      ...(z.dice ? { dice: z.dice } : {}),
      ...(z.healing ? { healing: true } : {}),
      ...(z.savingThrow ? { savingThrow: z.savingThrow } : {}),
      ...(z.saveDC != null ? { saveDC: z.saveDC } : {}),
      ...(z.onSaveHalfOrNeg !== undefined ? { onSaveHalfOrNeg: z.onSaveHalfOrNeg } : {}),
      ...(z.mode ? { mode: z.mode } : {}),
      ...(z.direction ? { direction: z.direction } : {}),
    }],
  };
}

/** Build an editable form value from a placed unit effect. */
function formFromUnitEffect(e: import('@/types/gameProtocol').UnitEffect): EffectFormValue {
  return {
    name: e.name,
    color: e.color,
    imageUrl: e.imageUrl ?? '',
    imageScale: e.imageScale ?? 100,
    transparentBackground: e.transparentBackground ?? false,
    layer: e.layer ?? 'below',
    duration: Math.max(1, e.turnsLeft),
    elevation: (e as any).elevation ?? 0,
    casterTeam: e.casterTeam ?? '',
    permanent: !!e.permanent,
    modifiers: [{
      kind: e.kind as EffectModifier['kind'],
      ...(e.dice ? { dice: e.dice } : {}),
      ...(e.healing ? { healing: true } : {}),
      ...(e.savingThrow ? { savingThrow: e.savingThrow } : {}),
      ...(e.saveDC != null ? { saveDC: e.saveDC } : {}),
      ...(e.onSaveHalfOrNeg !== undefined ? { onSaveHalfOrNeg: e.onSaveHalfOrNeg } : {}),
      ...(e.mode ? { mode: e.mode } : {}),
      ...(e.direction ? { direction: e.direction } : {}),
    }],
  };
}

/** Free Move auto-disables after this long once explicitly turned ON mid-session. */
const FREE_MOVE_AUTO_OFF_MS = 60_000;

/** Best Helmsman actor on the ship's helm cards (higher of Wis or Int). */
function bestHelmActorBonus(
  ship: ShipRuntime,
  units: Unit[],
): { bonus: number; name: string } | null {
  return shipFunctionalCardKeys(ship, 'Helm')
    .map(key => bestShipActorBonus(ship, key, ['wis', 'int'], units))
    .filter((v): v is { bonus: number; name: string } => !!v)
    .sort((a, b) => b.bonus - a.bonus)[0] ?? null;
}

/** The two forward hexes a ship can ram into. */
function shipRamFrontHexes(ship: ShipRuntime): Hex[] {
  if (!ship.hex) return [];
  return [4, 5].map(delta => {
    const dir = HEX_DIRS[(ship.facing + delta) % 6];
    return {
      q: ship.hex!.q + dir.q,
      r: ship.hex!.r + dir.r,
      s: -(ship.hex!.q + dir.q) - (ship.hex!.r + dir.r),
    };
  });
}

/** Card keys for a component that still have at least one box (not destroyed). */
function shipFunctionalCardKeys(ship: ShipRuntime, name: string): string[] {
  const build = ship.snapshot?.build;
  if (!build) return [];
  const keys = findCardKeysForComponent(build, name);
  const hitCards = new Map(shipHitCards(build).map(c => [c.key, c.tons]));
  return keys.filter(key => {
    const tons = hitCards.get(key) ?? 0;
    const destroyed = Number(ship.boxState?.[key] ?? 0);
    return tons - destroyed > 0;
  });
}

function shipHelmOccupant(ship: ShipRuntime, units: Unit[], alliances: Record<string, AllianceGroup>): {
  hero: Unit | null;
  crewCount: number;
  team: string | null;
  alliance: AllianceGroup | null;
} {
  const owner = shipHelmOwner(ship, units);
  return {
    ...owner,
    alliance: owner.team ? allianceOf(owner.team, alliances) : null,
  };
}

function shipBridgeHero(ship: ShipRuntime, units: Unit[]): Unit | null {
  for (const key of shipFunctionalCardKeys(ship, 'Command bridge')) {
    const station = ship.stations?.[key];
    const heroId = station?.heroIds?.[0] ?? station?.heroId;
    const hero = heroId ? units.find(u => u.id === heroId && !u.isDeleted) ?? null : null;
    if (hero) return hero;
  }
  return null;
}

/** Ship colour/owner alliance: helm hero -> helm crew team -> none. */
function shipOwnerAlliance(ship: ShipRuntime, units: Unit[], alliances: Record<string, AllianceGroup>): AllianceGroup | null {
  return shipHelmOccupant(ship, units, alliances).alliance;
}

/** A hostile ship in one of the attacker's two forward hexes. */
function isHostileRamTarget(
  attacker: ShipRuntime,
  target: ShipRuntime,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
): boolean {
  if (!attacker.hex || !target.hex) return false;
  if (!shipRamFrontHexes(attacker).some(h => h.q === target.hex!.q && h.r === target.hex!.r)) return false;
  const targetAlliance = shipOwnerAlliance(target, units, alliances);
  return targetAlliance !== null && targetAlliance !== shipOwnerAlliance(attacker, units, alliances);
}

function hasHostileRamTarget(
  attacker: ShipRuntime,
  ships: ShipRuntime[],
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
): boolean {
  return ships.some(s =>
    s.id !== attacker.id && !s.isDeleted && isHostileRamTarget(attacker, s, units, alliances),
  );
}

/** Who may declare speed: helm hero -> same-alliance bridge hero -> null (DM). */
function shipControlTeam(ship: ShipRuntime, units: Unit[], alliances: Record<string, AllianceGroup>): string | null {
  const helm = shipHelmOccupant(ship, units, alliances);
  if (helm.hero?.team) return helm.hero.team;
  const bridge = shipBridgeHero(ship, units);
  if (bridge?.team && helm.alliance && allianceOf(bridge.team, alliances) === helm.alliance) {
    return bridge.team;
  }
  return null;
}

/** A player may move a ship when they control it during its alliance's turn. */
function canControlShip(
  ship: ShipRuntime,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  myTeam: string | null,
  isGM: boolean,
  currentTurnAlliance: AllianceGroup | null,
): boolean {
  if (isGM) return true;
  const controlTeam = shipControlTeam(ship, units, alliances);
  if (!controlTeam || !myTeam || controlTeam !== myTeam) return false;
  // Free play keeps the piloting rule but has no alliance turn/limits.
  if (currentTurnAlliance === null) return true;
  return shipOwnerAlliance(ship, units, alliances) === currentTurnAlliance;
}

/** A player may order a ship card action when their side holds the turn. */
function canActOnShipCard(
  actorTeam: string | null | undefined,
  alliances: Record<string, AllianceGroup>,
  currentTurnAlliance: AllianceGroup | null,
  isGM: boolean,
): boolean {
  if (isGM || currentTurnAlliance === null) return true;
  return !!actorTeam && allianceOf(actorTeam, alliances) === currentTurnAlliance;
}

function shipCardDestroyed(ship: ShipRuntime, cardKey: string): boolean {
  const build = ship.snapshot?.build;
  if (!build) return false;
  const card = shipHitCards(build).find(c => c.key === cardKey);
  const hullKey = shipHullCardKey(build);
  const tons = card?.tons ?? (cardKey === hullKey ? shipHullBoxes(build) : 0);
  if (tons <= 0) return false;
  return Number(ship.boxState?.[cardKey] ?? 0) >= tons;
}

/**
 * Clear the occupants of a destroyed station. Crew return to reserve; heroes
 * stay aboard with no station so the ship window falls back to Deck/Cargo.
 * Mutates the supplied next-state objects and returns the hero edit sub-steps.
 */
function clearDestroyedCardOccupants(
  ship: ShipRuntime,
  cardKey: string,
  units: Unit[],
  nextStations: ShipRuntime['stations'],
  nextCrewState: ShipRuntime['crewState'],
): SubStep[] {
  const station = nextStations[cardKey];
  if (!station) return [];
  for (const crewId of station.crewIds ?? []) {
    nextCrewState[crewId] = { ...(nextCrewState[crewId] ?? {}), station: null };
  }
  const heroIds = new Set([
    ...(station.heroIds ?? []),
    ...(station.heroId ? [station.heroId] : []),
  ]);
  const steps: SubStep[] = [];
  for (const heroId of Array.from(heroIds)) {
    const hero = units.find(u => u.id === heroId && !u.isDeleted);
    if (!hero) continue;
    steps.push({
      type: 'EDIT_UNIT',
      unitId: heroId,
      description: `${hero.unitName} left a destroyed station`,
      changes: [{ field: 'shipStationKey', from: hero.shipStationKey ?? null, to: null }],
    });
  }
  nextStations[cardKey] = {
    ...station,
    heroId: null,
    heroIds: [],
    crewIds: [],
    heroPositions: {},
  };
  return steps;
}

/** Hero capacity of a card: its crew requirement; Deck + Cargo are unlimited. */
function shipCardHeroCapacity(ship: ShipRuntime, cardKey: string): number {
  const build = ship.snapshot?.build;
  if (!build) return 1;
  if (shipCardDestroyed(ship, cardKey)) return 0;
  // Station cards (Helm/Bridge/Sail/Rudder/Weapon) shrink with box damage for
  // Sail/Rudder; use the same visible capacity the deck renders.
  const stationCard = shipStationCards(build, { boxState: ship.boxState }).find(c => c.key === cardKey);
  if (stationCard) return stationCard.crewRequired;
  const hullKey = shipHullCardKey(build);
  if (cardKey === hullKey) return SHIP_HULL_REPAIR_CAPACITY;
  const deckKey = shipComponentCardKey(ship, 'Deck');
  const cargoKey = shipComponentCardKey(ship, 'Cargo');
  if (cardKey === deckKey || cardKey === cargoKey) return Number.POSITIVE_INFINITY;

  const weapon = shipWeaponCards(build).find(c => c.key === cardKey);
  if (weapon) return Math.max(0, Math.ceil(weapon.crew));

  if (cardKey.startsWith('component:')) {
    const rawId = cardKey.slice('component:'.length);
    const perUnit = /:\d+$/.test(rawId);
    const id = rawId.replace(/:\d+$/, '');
    const component = build.components.find(c => c.id === id);
    if (!component) return 0;
    if (component.name === 'Sail') return perUnit ? 1 : Math.max(1, Math.floor(build.sails / 4));
    if (component.name === 'Rudder') return perUnit ? 1 : Math.max(1, Math.ceil(build.rudders / 2));
    // Helm and Command bridge cards use their own crew requirement. Multiplying
    // by the ship-wide count made a per-unit Helm card (one visible slot) accept
    // two occupants when the ship had two helms.
    return Math.max(0, Math.ceil(component.crew));
  }

  if (cardKey.startsWith('optional:')) {
    const parts = cardKey.slice('optional:'.length).split(':');
    const id = parts[0];
    const component = build.components.find(c => c.id === id);
    if (!component) return 0;
    const count = parts.length > 1 ? 1 : (build.templateComponents.find(r => r.componentId === id)?.count ?? 1);
    return Math.max(0, Math.ceil(component.crew * count));
  }

  return 1;
}

/** Card key for a built-in component name (Helm, Command bridge, Cargo...). */
function shipComponentCardKey(ship: ShipRuntime, name: string): string | null {
  return ship.snapshot?.build ? findCardKeyForComponent(ship.snapshot.build, name) : null;
}

/** Best Dex-based attack bonus among the PC/crew assigned to a weapon card. */
function shipWeaponBestAttacker(ship: ShipRuntime, cardKey: string, units: Unit[]): number | null {
  const best = bestShipActorBonus(ship, cardKey, 'dex', units);
  return best ? best.bonus : null;
}

/** Runtime ship label: base name + serial letter, matching the ship window title. */
function shipDisplayName(ship: Pick<ShipRuntime, 'name' | 'serialNumber'>): string {
  return `${ship.name}${ship.serialNumber > 0 ? ` ${alphaLabel(ship.serialNumber)}` : ''}`;
}

const SHIP_REGION_LABELS: Record<string, string> = {
  bow: 'Bow',
  port: 'Port',
  body: 'Body',
  starboard: 'Starboard',
  stern: 'Stern',
};

/**
 * Human station label for command/undo messages. Weapons include their deck
 * region when the same weapon name appears more than once; a region with
 * several identical weapons also shows an ordinal.
 */
function shipStationLabel(ship: ShipRuntime, cardKey: string): string {
  const build = ship.snapshot?.build;
  if (!build) return cardKey;
  const cards = shipStationCards(build, { boxState: ship.boxState });
  const card = cards.find(c => c.key === cardKey);
  if (!card) return cardKey;
  if (card.kind !== 'weapon') return card.name;
  const sameName = cards.filter(c => c.kind === 'weapon' && c.name === card.name);
  if (sameName.length <= 1) return card.name;
  const region = card.region ? (SHIP_REGION_LABELS[card.region] ?? card.region) : 'Unknown';
  const sameRegion = sameName.filter(c => c.region === card.region);
  const ordinal = sameRegion.findIndex(c => c.key === cardKey) + 1;
  return `${card.name} (${region}${sameRegion.length > 1 ? ` ${ordinal}` : ''})`;
}

type ShipCheckStat = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

function bestShipActorBonus(
  ship: ShipRuntime,
  cardKey: string,
  stat: ShipCheckStat | ShipCheckStat[],
  units: Unit[],
): { bonus: number; name: string } | null {
  const stats = Array.isArray(stat) ? stat : [stat];
  const station = ship.stations?.[cardKey];
  if (!station) return null;
  let best: { bonus: number; name: string } | null = null;
  for (const crewId of station.crewIds ?? []) {
    if (ship.crewState?.[crewId]?.dead) continue;
    const crew = ship.snapshot?.template?.crews?.find(c => c.id === crewId);
    if (!crew) continue;
    const bonus = bestCheckBonus(crew, stats, true);
    if (!best || bonus > best.bonus) best = { bonus, name: crew.name || 'Crew' };
  }
  const heroIds = new Set([
    ...(station.heroIds ?? []),
    ...(station.heroId ? [station.heroId] : []),
  ]);
  for (const heroId of Array.from(heroIds)) {
    const hero = units.find(u => u.id === heroId && !u.isDeleted);
    if (!hero) continue;
    const bonus = bestCheckBonus(hero, stats);
    if (!best || bonus > best.bonus) best = { bonus, name: hero.unitName };
  }
  return best;
}

/** Card-step gate for one card function use. `approvedNegative` bypasses a full ledger. */
function beginCardUse(
  ship: ShipRuntime,
  cardKey: string,
  turn: number,
  step: number,
  mode: 'atmosphere' | 'wildspace',
  approvedNegative: boolean,
): { next: ShipCardStepState; spent: boolean } | null {
  const canSpend = canSpendCardStep(ship.cardState, cardKey, turn, step, mode);
  if (!canSpend && !approvedNegative) return null;
  return {
    next: canSpend ? spendCardSteps(ship.cardState, cardKey, turn, step, mode) : (ship.cardState ?? {}),
    spent: canSpend,
  };
}

export function ScenarioMap({ scenarioId, replayMode = false }: ScenarioMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedHex, setSelectedHex] = useState<Hex | null>(null);
  const { units, loading, error, addUnitFromTemplate, deleteUnit, applyLocalUnit, refreshUnitsByIds, sizeCategories } = useSupabaseSync(scenarioId);
  const { getMyRole, updateScreenshot, fetchScenarios, currentUser, fetchScenarioMapData, updateScenarioField, updateScenarioMapData } = useScenarios();
  const { addMessage, addError } = useMessageSync(scenarioId);
  const { toast: scenarioToast, showToast, dismissToast } = useScenarioToast(scenarioId);
  const { sharedStats, shareStats, clearSharedStats } = useSharedStats(scenarioId);
  const [isGM, setIsGM] = useState(false);
  // DM can assume a player role (effective GM off, SuperPlayer caps) so they don't
  // accidentally make GM-only changes. Real isGM stays for End Turn / heartbeat /
  // replay. A team is required to enter player mode (blocking picker).
  const [gmAsPlayer, setGmAsPlayer] = useState(false);
  const [showGmTeamPick, setShowGmTeamPick] = useState(false);
  // Interactive/editorial GM privileges are off while playing as a player; real
  // isGM stays for End Turn / heartbeat / replay. Declared early (used by
  // useTeamAlliances and the permission gates below).
  const effectiveIsGM = isGM && !gmAsPlayer;
  const [dmGone, setDmGone] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [currentTurnAlliance, setCurrentTurnAlliance] = useState<AllianceGroup | null>(null);
  const [turnNumber, setTurnNumber] = useState(0);
  // Tracks which units had a weapon manually selected this turn (turn number per
  // unit id) â€” auto-return to the primary ranged weapon skips those for the rest
  // of the turn so it never overrides a deliberate choice.
  const weaponSelectedTurnRef = useRef<Record<string, number>>({});
  const [freeMove, setFreeMove] = useState(false);
  // Free Move auto-off: when the GM explicitly turns free move ON mid-session, a
  // countdown starts and the toggle flips itself back OFF after 1 minute (the
  // Turn-0 default free_move stays permanent â€” only an explicit toggle arms it).
  const [freeMoveRemaining, setFreeMoveRemaining] = useState<number | null>(null);
  const freeMoveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freeMoveTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isEndingTurn, setIsEndingTurn] = useState(false);
  // Defensive-archer reactions (opportunity fire), per-scenario GM toggle.
  const [archerReactionEnabled, setArcherReactionEnabled] = useState(false);
  const [mountedChargeEnabled, setMountedChargeEnabled] = useState(true);
  const [verboseCombat, setVerboseCombat] = useState(false);
  // Fog of war (per scenario): off by default; sight radius is the base each unit
  // reveals beyond its own hex (night vision raises it).
  const [fogOfWar, setFogOfWar] = useState(false);
  const [sightRadius, setSightRadius] = useState(DEFAULT_SIGHT_RADIUS);
  // AI Assist (GM tool): hands teams to a plotted (preview -> execute) enemy AI.
  const [aiAssistEnabled, setAiAssistEnabled] = useState(false);
  const [aiAssistPlayers, setAiAssistPlayers] = useState(false);
  // Hero morale boost (Commanding Presence / Heroic Inspiration) + heroic capacity.
  const [heroMoraleBoostEnabled, setHeroMoraleBoostEnabled] = useState(true);
  const [zocPursuitEnabled, setZocPursuitEnabled] = useState(true);
  // Spelljammer (DM-only): atmosphere vs wildspace, firing arcs, current step.
  const [shipMode, setShipMode] = useState<'atmosphere' | 'wildspace'>('atmosphere');
  const [shipFiringArcs, setShipFiringArcs] = useState(true);
  const [shipStep, setShipStep] = useState(1);
  // AI selection state lives here so canvas clicks can toggle per-unit opt-out.
  const [aiTeams, setAiTeams] = useState<string[]>([]);
  const [aiExcluded, setAiExcluded] = useState<Record<string, boolean>>({});
  const [aiBusy, setAiBusy] = useState(false);
  // Overlay (checkmarks + preview routes) pushed by the AI panel to the canvas.
  const [aiOverlay, setAiOverlay] = useState<AiOverlayData | null>(null);
  const [showScenarioSettings, setShowScenarioSettings] = useState(false);
  const [halloweenSiege, setHalloweenSiege] = useState<HalloweenSiegeConfig | null>(null);
  const [showHalloweenSiege, setShowHalloweenSiege] = useState(false);
  const siegeSpawnTurnRef = useRef<number | null>(null);
  // Client-only display pref (this device): label EVERY move-preview hex with its
  // leftover MP, not just the movement-border hexes. Persisted per browser.
  const [showAllMoveMp, setShowAllMoveMp] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('quitter.showAllMoveMp') === '1',
  );
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('quitter.showAllMoveMp', showAllMoveMp ? '1' : '0');
  }, [showAllMoveMp]);
  // Client-only drag-preview mode (this device): 'one' action per drag (default)
  // or 'all' remaining actions. Persisted per browser.
  const [movePreviewMode, setMovePreviewMode] = useState<'one' | 'all'>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('quitter.movePreviewMode') === 'all' ? 'all' : 'one',
  );
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('quitter.movePreviewMode', movePreviewMode);
  }, [movePreviewMode]);

  // AI opt-outs reset at each turn change â€” every alliance activation starts fresh.
  const aiLastTurnKeyRef = useRef('');
  useEffect(() => {
    const key = `${currentTurnAlliance ?? 'fp'}:${turnNumber}:${shipMode === 'wildspace' ? shipStep : 0}`;
    if (aiLastTurnKeyRef.current && aiLastTurnKeyRef.current !== key) setAiExcluded({});
    aiLastTurnKeyRef.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTurnAlliance, turnNumber, shipMode, shipStep]);

  // One per-unit AI opt-out toggle, shared by canvas token clicks and the AI
  // panel roster. Keyed by unit id, so stacked ground/air units stay independent.
  const toggleAiExcluded = useCallback((unitId: string) => {
    setAiExcluded(prev => {
      const next = { ...prev };
      if (next[unitId]) delete next[unitId];
      else next[unitId] = true;
      return next;
    });
  }, []);

  // Command-log rows â†’ corpse piles + battle statistics (derived, undo-safe).
  const commandRows = useCommandLogRows(scenarioId);
  const corpseCounts = useMemo(() => buildFallen(commandRows), [commandRows]);
  const [showStats, setShowStats] = useState(false);
  const [zoneMenu, setZoneMenu] = useState<{ hex: Hex; x: number; y: number } | null>(null);
  // Persistent per-hex effect editor (Shift + double-click) â€” Edit/Clone/Remove
  // per zone + "Remove all", staying open after each remove.
  const [hexEffectsModal, setHexEffectsModal] = useState<Hex | null>(null);
  const [backgroundConfig, setBackgroundConfig] = useState<MapBackgroundConfig | null>(null);
  // Edge walls authored/snapshotted (map_data.walls).
  const [walls, setWalls] = useState<Walls>({});
  // Placed structures (map_data.structures) â€” the source of truth; edge structures
  // are converted to `walls` for the runtime until the scenario is fully migrated.
  const [structures, setStructures] = useState<MapStructures>({});
  // Optimistic per-key apply for STRUCTURE commands (undo/redo/realtime).
  const setStructureLocal = useCallback((key: string, value: unknown | null) => {
    setStructures(prev => {
      const next = { ...prev };
      if (value === null || value === undefined) delete next[key];
      else next[key] = value as any;
      return next;
    });
  }, []);
  const [structureTemplateLibrary, setStructureTemplateLibrary] = useState<Record<string, StructureTemplate>>({});
  /**
   * Runtime template view: the shared library overlaid with each placed
   * structure's snapshot. Every rules/rendering consumer uses this, so a map is
   * self-contained even if a library template is later edited or deleted.
   */
  const structureTemplates = useMemo(
    () => structureTemplatesWithSnapshots(structures, structureTemplateLibrary),
    [structures, structureTemplateLibrary],
  );
  const [groundZones, setGroundZones] = useState<GroundEffect[]>([]);
  // Provenance of the snapshot currently loaded from a reusable map (maps.id).
  const [mapId, setMapId] = useState<string | null>(null);

  // Hex-structure modifiers are expanded into permanent ground zones so the ONE
  // ground-effect engine applies them (auras/range/ac/block_attacks/max_org_level_allowed/
  // entry/mp_cost). Edge structures stay on the edge path. Painted `groundZones`
  // remains the persisted/rendered list; `effectiveZones` is the engine view.
  const effectiveZones = useMemo(
    () => [...groundZones, ...structureZones(structures, structureTemplates)],
    [groundZones, structures, structureTemplates],
  );

  // Per-hex MP cost overrides from 'mp_cost' ("Terrain cost") ground zones â€”
  // a REPLACEMENT of the base 1 MP, highest wins (see `mpCostOverrides`). Uses
  // `effectiveZones` so a hex structure's own terrain-cost modifier counts too.
  // (Hex structure ENTRY MP is applied by `makeCostOfHex` directly.)
  const zoneMpCosts = useMemo(() => mpCostOverrides(effectiveZones), [effectiveZones]);
  // GM map-edit brushes: zone = template armed for placement (null = off).
  const [structurePaletteId, setStructurePaletteId] = useState<string | null>(null);
  const [selectedStructureKey, setSelectedStructureKey] = useState<string | null>(null);
  // Shift + double-click opens the instance editor for a placed structure.
  const [structureEditKey, setStructureEditKey] = useState<string | null>(null);
  const [zoneTemplate, setZoneTemplate] = useState<EffectCatalogTemplate | null>(null);
  // Temporary-effect modal target (context menu â†’ "Effectsâ€¦").
  const [effectMenuUnit, setEffectMenuUnit] = useState<Unit | null>(null);
  // Routed retreat: deterministic path (see `routRetreatPath`); the card is
  // informational â€” the owner only picks whether an attached hero moves along.
  const [retreatPick, setRetreatPick] = useState<{
    unit: Unit;
    attacker: Unit | null;
    path: RoutPath;
    hero: Unit | null;
  } | null>(null);
  const [retreatHeroChoice, setRetreatHeroChoice] = useState<'move' | 'stay'>('move');
  const [retreatHoverHex, setRetreatHoverHex] = useState<string | null>(null);
  const [retreatCardPos, setRetreatCardPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const retreatDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const routBusy = useRef(false);
  const routedHandled = useRef(new Set<string>());
  const routFlowRef = useRef<{ handle: (row: CommandLogRow) => Promise<void> } | null>(null);
  // Persist the docked side per scenario + user, like the open-tab state. Restore
  // only once the user id is known (auth settles after the first render), and only
  // persist on an explicit toggle â€” otherwise the default 'left' would overwrite a
  // saved 'right' during the pre-auth render.
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('left');
  const [topBarHeight, setTopBarHeight] = useState(56);
  const appliedSideKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser?.id) return;
    const key = `leftPanelSide:${scenarioId}:${currentUser.id}`;
    if (appliedSideKeyRef.current === key) return;
    appliedSideKeyRef.current = key;
    try {
      setPanelSide(window.localStorage.getItem(key) === 'right' ? 'right' : 'left');
    } catch {
      setPanelSide('left');
    }
  }, [scenarioId, currentUser?.id]);
  const togglePanelSide = () => {
    setPanelSide(s => {
      const next = s === 'left' ? 'right' : 'left';
      if (currentUser?.id) {
        try {
          window.localStorage.setItem(`leftPanelSide:${scenarioId}:${currentUser.id}`, next);
        } catch {
          // ignore storage failures
        }
      }
      return next;
    });
  };

  // Default dry-dock placement keeps the game left panel visible (Messages etc.).
  const dryDockInitial = useMemo(
    () => ({ x: panelSide === 'left' ? 424 : 24, y: 56 }),
    [panelSide],
  );
  const dryDockInitialSize = useMemo(() => {
    if (typeof window === 'undefined') return { w: 1280, h: 820 };
    return {
      w: Math.max(720, Math.min(1280, window.innerWidth - 456)),
      h: Math.max(520, Math.min(820, window.innerHeight - 96)),
    };
  }, []);
  const [formationsMap, setFormationsMap] = useState<Record<string, Formation>>({});

  const unitMaxMP = (unit: Unit) =>
    computeEffectiveMovement(unit, getFormationMultiplier(formationsMap, unit.currentFormation, 'movement_multiplier'));
  const [overlayMap, setOverlayMap] = useState<Record<string, string>>({});
  // Leftover-MP text on the boundary of the drag preview (see `computeOverlayMap`).
  const [overlayLabels, setOverlayLabels] = useState<Record<string, string>>({});
  // Free-placement level chooser (Unit Selector / Free Move / turn 0).
  const [freePlacement, setFreePlacement] = useState<FreePlacementRequest | null>(null);
  const [freePlacementAir, setFreePlacementAir] = useState<FreePlacementAirRequest | null>(null);
  // DM right-click on a boarded hero token in the ship window.
  const [shipHeroTeamMenu, setShipHeroTeamMenu] = useState<{ heroId: string; x: number; y: number } | null>(null);

  // Red flash on the target hex when an attack drop is out of range.
  const [rangeViolationHex, setRangeViolationHex] = useState<Hex | null>(null);
  const flashRangeViolation = useCallback((hex: Hex) => {
    setRangeViolationHex(hex);
    window.setTimeout(() => {
      setRangeViolationHex(prev => (prev && prev.q === hex.q && prev.r === hex.r && prev.s === hex.s ? null : prev));
    }, 1200);
  }, []);

  // Drag from panel
  const [isDraggingFromPanel, setIsDraggingFromPanel] = useState(false);
  const [draggingTemplate, setDraggingTemplate] = useState<UnitTemplate | null>(null);
  const [draggingShip, setDraggingShip] = useState<ShipLibraryEntry | null>(null);
  const [draggingCampaign, setDraggingCampaign] = useState<CampaignShip | null>(null);
  const [campaignDrop, setCampaignDrop] = useState<{ root: CampaignShip; hex: Hex } | null>(null);
  // Scenario ship instances live in `ship_spelljammer` (one row per placed ship).
  const { ships: shipRuntime, setShipLocal, refresh: refreshShips } = useShips(scenarioId);
  const campaignStore = useCampaignShips(scenarioId, currentUser?.id ?? null);
  const [scenarioName, setScenarioName] = useState('');

  useEffect(() => {
    void supabase
      .from('scenarios')
      .select('name')
      .eq('id', scenarioId)
      .single()
      .then(({ data }) => { if (data?.name) setScenarioName(data.name); });
  }, [scenarioId]);

  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [shipWindowId, setShipWindowId] = useState<string | null>(null);
  const [pendingShipElevation, setPendingShipElevation] = useState<{
    shipId: string;
    targetHex: Hex;
    currentElevation: number;
    elevation: number;
    min: number;
    max: number;
  } | null>(null);
  const [ghostHex, setGhostHex] = useState<Hex | null>(null);

  // Tooltip
  const [hoveredUnit, setHoveredUnit] = useState<Unit | null>(null);
  const [hoveredShip, setHoveredShip] = useState<{ ship: ShipRuntime; x: number; y: number } | null>(null);
  const [pendingShipDrop, setPendingShipDrop] = useState<{
    unit: Unit;
    ship: ShipRuntime;
    cost: number;
    maxMP: number;
    isFree: boolean;
    canBoard: boolean;
  } | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Context menu
  const [contextMenuUnit, setContextMenuUnit] = useState<Unit | null>(null);
  const [contextMenuShip, setContextMenuShip] = useState<ShipRuntime | null>(null);
  const [makeCampaignTarget, setmakeCampaignTarget] = useState<ShipRuntime | null>(null);
  const [makeCampaignName, setmakeCampaignName] = useState('');
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Left-click selected token (Q/E keyboard rotation targets this; persists until
  // an empty hex click or Escape clears it).
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);

  // The attached hero currently "in focus" (via the context-menu Switch to Hero).
  // While set, that hero is the grabbable entity at its host's hex.
  const [activeHeroId, setActiveHeroId] = useState<string | null>(null);

  // Attach position modal (canCast = the hero also holds a spell/heal weapon, so
  // offer "Cast spell" alongside Leader/Protected modes).
  const [attachModal, setAttachModal] = useState<{
    hero: Unit;
    target: Unit;
    canCast?: boolean;
  } | null>(null);

  const playerId = currentUser?.id || '';
  const { displayName, access } = useProfile(playerId || null);
  const playerName =
    displayName ||
    currentUser?.user_metadata?.full_name ||
    currentUser?.user_metadata?.name ||
    currentUser?.email ||
    'Unknown';

  const magicCast = useMagicCast(scenarioId);

  const replay = useReplay(scenarioId, { initialMode: replayMode ? 'replay' : 'play', playerId });
  const inReplay = replay.mode === 'replay';
  // A shared dry-dock session pauses the table: no map actions, End Turn or
  // hotkeys until the DM ends it. Local dismissal only hides the window.
  const dryDockSessionActive = shipRuntime.some(s => s.dryDockOpen && !!s.campaignId && !s.isDeleted);
  const controlsLocked = inReplay || dmGone || dryDockSessionActive;
  const replayCurrentTurnAlliance = replay.replayCurrentTurnAlliance;

  const { alliances, setAlliance, setAllianceLocal } = useTeamAlliances(scenarioId, effectiveIsGM);

  // Rendering bridge: the canvas still consumes the lightweight PlacedShip shape.
  const ships: PlacedShip[] = shipRuntime
    .filter(s => !!s.hex && !s.isDeleted)
    .map(s => {
      const stats = effectiveShipStats(s, units);
      const speedSpent = s.speedSpent ?? 0;
      const movementRemaining = stats
        ? shipMode === 'wildspace'
          ? shipRoundRemaining({ stepBudget: s.stepBudget, step: shipStep, speedSpent }, shipStep)
          : Math.max(0, Math.floor(stats.atmosphericSpeed) - speedSpent)
        : undefined;
      const speedThisTurn = stats
        ? shipMode === 'wildspace'
          ? (s.declaredRound === turnNumber ? s.declaredSpeed : (s.lastSpeed ?? 5))
          : stats.atmosphericSpeed
        : undefined;
      const turnDistance = stats && speedThisTurn != null
        ? shipTurnDistance(stats, speedThisTurn, shipMode, s.mcReduction ?? 0)
        : undefined;
      return {
        id: s.id,
        templateId: s.templateId || '',
        name: s.name,
        role: s.snapshot?.template?.role ?? null,
        imageUrl: s.imageUrl || s.snapshot?.template?.imageUrl || '',
        keelLength: s.keelLength,
        imageOffsetY: s.imageOffsetY,
        hex: s.hex!,
        alliance: shipOwnerAlliance(s, units, alliances),
        crewAlliance: s.crewTeam ? allianceOf(s.crewTeam, alliances) : null,
        hidden: s.hidden,
        facing: s.facing,
        movementRemaining,
        speedThisTurn,
        elevation: s.elevation ?? 0,
        airborne: shipMode === 'atmosphere' && (s.elevation ?? 0) > 0,
        turnsSinceFacing: s.turnsSinceFacing ?? 0,
        turnDistance,
      };
    });

  // Players cannot hit-test/click/drag a hidden ship; the DM keeps the full list
  // so hidden ships can be unhidden/rotated/deleted.
  const interactiveShips: PlacedShip[] = effectiveIsGM ? ships : ships.filter(s => !s.hidden);

  // Grounded claw ships for unit movement ZoC (threat ships are not units).
  const threatShips: ThreatShip[] = useMemo(() => shipRuntime
    .filter(s => !!s.hex && !s.isDeleted)
    .map(s => ({
      team: shipControlTeam(s, units, alliances),
      hex: s.hex!,
      elevation: Math.max(0, Math.round(s.elevation ?? 0)),
      surface: structureSurfaceAt(s.hex!, structures ?? {}, structureTemplates),
      hidden: s.hidden,
      threat: shipMeleeThreat(s),
    }))
    .filter(s => s.threat > 0), [shipRuntime, units, alliances, structures, structureTemplates]);

  const shipObstacles = useMemo(() => {
    const ground = new Set<string>();
    const air = new Set<string>();
    for (const ship of shipRuntime) {
      if (!ship.hex || ship.isDeleted) continue;
      if (ship.hidden && !effectiveIsGM) continue;
      const surface = structureSurfaceAt(ship.hex, structures ?? {}, structureTemplates);
      const key = `${ship.hex.q},${ship.hex.r}`;
      if ((ship.elevation ?? 0) <= surface) ground.add(key);
      else air.add(key);
    }
    return { ground, air };
  }, [shipRuntime, structures, structureTemplates, effectiveIsGM]);

  // Player management + role capabilities (feature: teams, roles, room, kick).
  const participantsSync = useParticipants(scenarioId, currentUser?.id);
  const { getRoleCapabilities } = useScenarioCapabilities();
  const myRole = participantsSync.myParticipant?.role ?? null;
  const myTeam = participantsSync.myParticipant?.team ?? null;
  // AI assist access: the scenario master switch, plus either the GM or (when
  // the GM allows it) a team-assigned player on the active side's turn. Replay
  // and DM-offline stay locked.
  const canUseAiAssist =
    aiAssistEnabled && !controlsLocked && (
      effectiveIsGM ||
      (aiAssistPlayers && !!myTeam && alliances[myTeam] === currentTurnAlliance)
    );
  // Assigned players (any role with a team) may paint effect zones; unassigned
  // spectators cannot. Terrain (MP-cost) painting stays GM-only.
  const canPaintZones = effectiveIsGM || !!myTeam;
  // Pings render in the pinger's team color; the DM (no team) pings white.
  const pingColor = myTeam ? TEAM_COLORS[myTeam as Team] : '#ffffff';
  const roleLabel =
    myRole === 'GM' ? 'DM'
    : myRole === 'AssistGM' ? 'Assist GM'
    : myRole === 'SuperPlayer' ? 'Super Player'
    : 'Player';

  // DM-as-player mode: interactive GM privileges drop to a full player (SuperPlayer
  // caps â€” control + adjust the DM's own alliance), while the real isGM stays for
  // End Turn, the heartbeat, replay and the label toggle.
  const effectiveRole = gmAsPlayer ? ('SuperPlayer' as ScenarioRole) : myRole;
  const headerRoleLabel = gmAsPlayer ? 'Player (DM)' : roleLabel;

  // Permission gates read from a ref so their identity stays stable across renders
  // (caps/team/alliances update live when the GM reassigns a player). Turn state is
  // folded in too: from turn 1 on, non-GM players may only act on the current
  // alliance group's units.
  const permRef = useRef({
    caps: allTrueCapabilities(),
    team: myTeam,
    alliances,
    currentTurnAlliance,
    freeMove,
    isGM,
    gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
  });
  permRef.current = {
    caps: getRoleCapabilities(effectiveRole),
    team: myTeam,
    alliances,
    currentTurnAlliance,
    freeMove,
    isGM: effectiveIsGM,
    gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
  };
  const canControlUnit = useCallback((unit: Unit): boolean => {
    const { caps, team, alliances: al, currentTurnAlliance: turn, freeMove: fm, isGM: gm, gridRadius: radius } = permRef.current;
    // Off-grid tokens are out of play for non-DM players; the DM can recover them.
    if (!gm && !isHexOnGrid(unit.hex, radius)) return false;
    // The GM (scenario creator) can always override any gate. From turn 1 on,
    // non-GM players may only act during their own alliance's turn, and only on
    // that alliance's units (see canActOnUnit).
    return canActOnUnit(caps, team, unit.team, al, turn, fm, gm);
  }, []);
  const canEditUnit = useCallback((unit: Unit): boolean => {
    const { caps, team, alliances: al } = permRef.current;
    return canAdjustUnit(caps, team, unit.team, al);
  }, []);

  // Reactions are opportunity fire â€” the archer's OWNER reacts even during the
  // opponent's turn, so ownership (same team) is enough; the turn gate does not
  // apply (canControlUnit would block the owner outside their own turn).
  const canReactToUnit = useCallback((unit: Unit): boolean => {
    return effectiveIsGM || unit.team === myTeam;
  }, [effectiveIsGM, myTeam]);

  // Toggle DM <-> player mode. Entering player mode requires a team; without one a
  // blocking team-picker opens (Cancel keeps the DM in DM mode).
  const togglePlayerMode = useCallback(() => {
    if (gmAsPlayer) {
      setGmAsPlayer(false);
      return;
    }
    if (!myTeam) {
      setShowGmTeamPick(true);
      return;
    }
    setGmAsPlayer(true);
  }, [gmAsPlayer, myTeam]);

  // Attention ping (feature #4).
  const { pings, pingAtHex } = usePing(scenarioId);

  // Double-click unit editor.
  const [editUnit, setEditUnit] = useState<Unit | null>(null);

  // Display state: live units/alliances in play mode, replay cursor state in replay mode.
  const displayUnits = inReplay ? replay.replayUnits : units;
  const displayAlliances = inReplay ? replay.replayAlliances : alliances;
  const displayTurnNumber = inReplay ? replay.replayTurnNumber : turnNumber;

  // Fog of war: which alliance's sight drives the reveal. A player sees their own
  // alliance; the DM (and replay) sees the current/acting alliance so the boundary
  // follows whoever acts â€” the DM/reviewer sees THROUGH it (translucent overlay).
  const fogGroup: AllianceGroup | null = (() => {
    if (!fogOfWar) return null;
    if (inReplay) return replayCurrentTurnAlliance;
    if (effectiveIsGM) return currentTurnAlliance;
    return myTeam ? displayAlliances[myTeam] || 'friendly' : null;
  })();
  const fog = useMemo(() => {
    if (!fogGroup) return null;
    return computeFog(displayUnits, fogGroup, displayAlliances, sightRadius);
  }, [fogGroup, displayUnits, displayAlliances, sightRadius]);
  const fogReveal = fog?.reveal ?? null;
  const fogDim = fog?.dim ?? null;
  const canSeeHex = useCallback((h: { q: number; r: number; s: number }): boolean => {
    if (!fogReveal) return true;
    return fogReveal.has(hexKey(h));
  }, [fogReveal]);

  // A unit may only attack a target its OWN side can currently see â€” even for the
  // DM's units. The DM sees through the fog (translucent overlay), but that is
  // viewer convenience, not the unit's sight: sight is the alliance group's reveal
  // of the target's hex, independent of who is watching.
  const canAttackInFog = useCallback((attacker: Unit, target: Unit): boolean => {
    if (!fogOfWar || attacker.isDeleted || target.isDeleted) return true;
    const group = displayAlliances[attacker.team] || 'friendly';
    return computeVisibleHexes(displayUnits, group, displayAlliances, sightRadius).has(hexKey(target.hex));
  }, [fogOfWar, displayUnits, displayAlliances, sightRadius]);

  // ---- GM map data (background + ground zones + structures + source map) ----
  // Whole-object writer: every save merges the CURRENT local state, so no writer
  // ever drops another layer. (Structures/ground effects also ride the command
  // log; this writer handles the non-undoable background/mapId fields.)
  const persistMapData = useCallback(async (next: {
    backgroundConfig?: MapBackgroundConfig | null;
    structures?: MapStructures;
    groundEffects?: GroundEffect[];
    mapId?: string | null;
  }) => {
    const bg = next.backgroundConfig !== undefined ? next.backgroundConfig : backgroundConfig;
    await updateScenarioMapData(scenarioId, {
      backgroundImageUrl: bg?.imageUrl ?? '',
      bgOffsetX: bg?.offsetX ?? 0,
      bgOffsetY: bg?.offsetY ?? 0,
      bgScale: bg?.scale ?? 1,
      gridRadius: bg?.gridRadius ?? DEFAULT_GRID_RADIUS,
      structures: next.structures !== undefined ? next.structures : structures,
      groundEffects: next.groundEffects !== undefined ? next.groundEffects : groundZones,
      mapId: next.mapId !== undefined ? next.mapId : mapId,
    });
  }, [scenarioId, updateScenarioMapData, backgroundConfig, structures, groundZones, mapId]);

  // Most-recently-applied `map_data` version (scenario.updated_at); the realtime
  // handler ignores an older snapshot so a reordered event can't re-add a deleted
  // structure (which previously left a "ghost" hex structure on screen).
  const lastMapDataAtRef = useRef<string>('');

  /** Authoritative re-read of `map_data.structures` (called after STRUCTURE commands
   *  so the client converges to the DB truth, like `refreshUnitsByIds` for units). */
  const refreshMapData = useCallback(async () => {
    const { data } = await supabase.from('scenarios').select('map_data, updated_at').eq('id', scenarioId).single();
    if (!data) return;
    if (data.updated_at) lastMapDataAtRef.current = data.updated_at as string;
    setStructures(parseStructures((data.map_data as any)?.structures));
  }, [scenarioId]);

  // Load the structure template library (palette + walls derivation).
  useEffect(() => {
    let cancelled = false;
    getStructureTemplates().then(t => { if (!cancelled) setStructureTemplateLibrary(t); });
    return () => { cancelled = true; };
  }, []);

  // Derive the runtime walls from edge structures (the scenario's source of truth).
  useEffect(() => {
    let cancelled = false;
    getStructureTemplates().then(library => {
      if (!cancelled) setWalls(structuresToWalls(structures, structureTemplatesWithSnapshots(structures, library)));
    });
    return () => { cancelled = true; };
  }, [structures]);

  /** Direction (0..5) of the hex edge nearest a screen point (wall brush). */
  function edgeDirAtClient(hex: Hex, clientX: number, clientY: number): number | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const world = { x: (clientX - rect.left - offsetX) / zoom, y: (clientY - rect.top - offsetY) / zoom };
    return nearestEdge(hex, world, HEX_SIZE).dir;
  }

  // Assign a reusable map: snapshot its image + terrain + structures into the
  // scenario copy. Edge structures are converted to the runtime `walls` so wall
  // movement/combat keeps working until the scenario is fully structure-native.
  const assignMap = useCallback(async (entity: MapEntity) => {
    const bg: MapBackgroundConfig = {
      imageUrl: entity.imageUrl,
      offsetX: entity.offsetX,
      offsetY: entity.offsetY,
      scale: entity.scale,
      gridRadius: entity.gridRadius,
    };
    // Expand authored per-hex effects into PERMANENT ground zones.
    let authoredZones: GroundEffect[] = [];
    if ((entity.hexEffects ?? []).length > 0) {
      const { data } = await supabase.from('map_effect_templates').select('*');
      const lib: Record<string, EffectLibraryTemplate> = {};
      for (const row of (data ?? []) as any[]) {
        const t = mapEffectRow(row);
        lib[t.id] = t;
      }
      authoredZones = expandHexEffects(entity.hexEffects, lib);
    }
    setBackgroundConfig(bg);
    setStructures(entity.structures ?? {});
    setGroundZones(authoredZones);
    setMapId(entity.id);
    await persistMapData({ backgroundConfig: bg, structures: entity.structures ?? {}, groundEffects: authoredZones, mapId: entity.id });
    addMessage(`Loaded map "${entity.name}" â€” snapshot copied to this scenario`);
  }, [persistMapData, addMessage]);

  const clearMap = useCallback(async () => {
    setBackgroundConfig(null);
    setStructures({});
    setGroundZones([]);
    setMapId(null);
    await persistMapData({ backgroundConfig: null, structures: {}, groundEffects: [], mapId: null });
    addMessage('Map cleared â€” plain board');
  }, [persistMapData, addMessage]);

  // Optimistic local update for SCENARIO sub-steps (turn tracking). Paints the
  // result on screen; the END_TURN RPC is the DB writer, realtime confirms.
  const setScenarioLocal = useCallback((fields: Record<string, any>) => {
    if ('current_turn_alliance' in fields) setCurrentTurnAlliance(fields.current_turn_alliance || null);
    if ('turn_number' in fields) setTurnNumber(fields.turn_number);
    if ('free_move' in fields) setFreeMove(fields.free_move);
    if ('archer_reaction_enabled' in fields) setArcherReactionEnabled(fields.archer_reaction_enabled);
    if ('mounted_charge_enabled' in fields) setMountedChargeEnabled(fields.mounted_charge_enabled ?? true);
    if ('verbose_combat' in fields) setVerboseCombat(fields.verbose_combat ?? false);
    if ('fog_of_war' in fields) setFogOfWar(!!fields.fog_of_war);
    if ('sight_radius' in fields) setSightRadius(fields.sight_radius ?? DEFAULT_SIGHT_RADIUS);
    if ('ai_assist_enabled' in fields) setAiAssistEnabled(!!fields.ai_assist_enabled);
    if ('ai_assist_players' in fields) setAiAssistPlayers(!!fields.ai_assist_players);
    if ('hero_morale_boost_enabled' in fields) setHeroMoraleBoostEnabled(fields.hero_morale_boost_enabled ?? true);
    if ('zoc_pursuit_enabled' in fields) setZocPursuitEnabled(fields.zoc_pursuit_enabled ?? true);
  }, []);

  // Mirror the scenario toggles into the pure libs' ambient flags.
  useEffect(() => {
    setHeroMoraleBoostAmbient(heroMoraleBoostEnabled);
  }, [heroMoraleBoostEnabled]);
  useEffect(() => {
    setZocPursuitAmbient(zocPursuitEnabled);
  }, [zocPursuitEnabled]);


  // Entry-zone troop-count prompt: the engine awaits this while resolving a move
  // that lands on an 'entry' zone.
  const [entryPrompt, setEntryPrompt] = useState<{ actor: Unit; zone: GroundEffect; resolve: (n: number) => void } | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const requestEntryTroops = useCallback(
    (actor: Unit, zone: GroundEffect) =>
      new Promise<number>(resolve => {
        setEntryCount(Math.max(0, actor.currentTroopCount ?? 0));
        setEntryPrompt({ actor, zone, resolve });
      }),
    [],
  );
  const resolveEntryPrompt = useCallback((n: number) => {
    setEntryPrompt(prev => {
      if (prev) prev.resolve(Math.max(0, Math.floor(n)));
      return null;
    });
  }, []);

  const {
      execute, moveUnitRecorded, moveUnitFree, rotateUnit, changeFormation, rallyUnit, selectWeapon, assignTeam, toggleHide, setRouting, placeUnit, attachHero, swapHeroPosition, elevateUnit, otherAction, endTurn, applyEffect, removeEffect, editEffect, applyZoneChange, charge, undo, canUndo, redo, canRedo, peekUndoChainLength, refreshUndoState, subscribeToCommandLog, syncZoneEffects,
  } = useGameEngine({
    scenarioId,
    playerId,
    playerName,
    isGM,
    freeMove,
    applyLocalUnit,
    refreshUnitsByIds,
    setAllianceLocal,
    setScenarioLocal,
    setZonesLocal: setGroundZones,
    setWallsLocal: setWalls,
    setStructureLocal,
    setShipLocal,
    refreshMapData,
    refreshShips,
    requestEntryTroops,
  });

  // Charge conversion needs the current formation pool and whether this is an
  // airborne swoop (fly pool) rather than a grounded charge (move pool).
  const chargeWithPool = useCallback((unit: Unit) => {
    const airborne = isAirborne(unit.elevation, structureSurfaceAt(unit.hex, structures, structureTemplates));
    return charge(unit, { airborne, maxMP: unitMaxMP(unit), flyMax: flyMax(unit) });
  }, [charge, structures, structureTemplates, formationsMap]);

  // Ship drag: spend the current pool (step budget / atmospheric FP) and write a
  // SHIP command (undo/replay/realtime all ride it).
  const handleShipMove = useCallback(async (shipId: string, targetHex: Hex, chosenElevation?: number) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship || !ship.hex) return;
    if (!canControlShip(ship, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance)) {
      addError('Only the helm heroâ€™s player, the captain of a same-alliance helm crew, or the DM can move this ship during its alliance turn.');
      return;
    }
    if (ship.dryDockOpen) { addError('This ship is in dry dock and cannot move.'); return; }
    // Dropping back on the origin is not a move: no command, message, or dice.
    if (targetHex.q === ship.hex.q && targetHex.r === ship.hex.r) return;
    const stats = effectiveShipStats(ship, units);
    if (!stats) { addError('This ship has no frozen template snapshot.'); return; }

    // Free Move / turn 0 free play: pick up and drop anywhere on the grid.
    // This is pure repositioning â€” no facing, speed, step or declaration change.
    if (freeMove || currentTurnAlliance === null) {
      if (!isHexOnGrid(targetHex, backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS)) {
        addError('That hex is off the grid.');
        return;
      }
      if (shipRuntime.some(s => s.id !== shipId && s.hex && !s.isDeleted && s.hex.q === targetHex.q && s.hex.r === targetHex.r)) {
        addError('Another ship is already on that hex.');
        return;
      }
      const currentElevation = ship.elevation ?? 0;
      const distance = hexDistance(ship.hex, targetHex);
      const minElevation = Math.max(0, currentElevation - distance * 10);
      const maxElevation = currentElevation + distance * 10;
      if (shipMode === 'atmosphere' && chosenElevation === undefined && distance > 0) {
        setPendingShipElevation({
          shipId,
          targetHex,
          currentElevation,
          elevation: currentElevation,
          min: minElevation,
          max: maxElevation,
        });
        return;
      }
      const nextElevation = shipMode === 'atmosphere'
        ? Math.max(minElevation, Math.min(maxElevation, Math.round(chosenElevation ?? currentElevation)))
        : currentElevation;
      const changes: { field: string; from: unknown; to: unknown }[] = [
        { field: 'hex', from: ship.hex, to: targetHex },
        ...(nextElevation !== currentElevation
          ? [{ field: 'elevation', from: currentElevation, to: nextElevation }]
          : []),
      ];
      await execute('MOVE', [{
        type: 'SHIP',
        unitId: shipId,
        description: `${shipDisplayName(ship)} placed`,
        changes,
      }], `${shipDisplayName(ship)} placed`, { localOnly: isGM });
      return;
    }

    if (shipMode === 'wildspace' && ship.declaredRound !== turnNumber) {
      addError(`Declare ${shipDisplayName(ship)}â€™s speed before moving.`);
      return;
    }
    const speedSpent = ship.speedSpent ?? 0;
    const startSurface = structureSurfaceAt(ship.hex!, structures ?? {}, structureTemplates);
    const startGrounded = shipIsGrounded(ship.elevation, startSurface);
    const pools = shipAtmospherePools(ship, stats);
    const pool = shipMode === 'wildspace'
      ? shipStepRemaining({ stepBudget: ship.stepBudget, step: shipStep, speedSpent }, shipStep)
      : Math.max(0, Math.floor(startGrounded ? pools.mpRemaining : pools.fpRemaining));
    if (shipMode === 'wildspace' && pool <= 0) {
      addError('No ship movement left this step.');
      return;
    }
    if (shipMode !== 'wildspace' && pools.mpRemaining <= 0 && pools.fpRemaining <= 0) {
      addError('No ship movement left this turn.');
      return;
    }
    const speedForMC = shipMode === 'wildspace'
      ? (ship.declaredRound === turnNumber ? ship.declaredSpeed : (ship.lastSpeed ?? 5))
      : (stats.atmosphericSpeed ?? 5);
    const airTurnDistance = shipTurnDistance(stats, speedForMC, shipMode, ship.mcReduction ?? 0);
    const groundTurnDistance = startGrounded && pools.mcZero ? 0 : airTurnDistance;
    const shipElevation = Math.max(0, Math.round(ship.elevation ?? 0));
    const blocked = (q: number, r: number) => {
      const inst = structures?.[`${q},${r}`];
      if (!inst) return false;
      return structureSurfaceAt({ q, r }, structures ?? {}, structureTemplates) > shipElevation;
    };
    const occupied = new Set<string>();
    for (const u of units) {
      if (!u.isDeleted && !u.attachedToUnitId) occupied.add(`${u.hex.q},${u.hex.r}`);
    }
    for (const s of shipRuntime) {
      if (s.id !== shipId && s.hex && !s.isDeleted) occupied.add(`${s.hex.q},${s.hex.r}`);
    }
    const start = { hex: ship.hex, facing: ship.facing, turnsSinceFacing: ship.turnsSinceFacing };
    const groundReach: Map<string, ShipReachEntry> = shipMode !== 'wildspace' && startGrounded && pools.mpRemaining > 0
      ? computeShipReachable(start, Math.floor(pools.mpRemaining), groundTurnDistance, { occupied, blocked })
      : new Map();
    const airReach: Map<string, ShipReachEntry> = shipMode !== 'wildspace' && pools.fpRemaining > 0
      ? computeShipReachable(start, Math.floor(pools.fpRemaining), airTurnDistance, { occupied, blocked })
      : new Map();
    let reach: Map<string, ShipReachEntry>;
    if (shipMode === 'wildspace') {
      reach = computeShipReachable(start, pool, airTurnDistance, { occupied, blocked });
    } else {
      reach = new Map();
      groundReach.forEach((v, k) => reach.set(k, v));
      airReach.forEach((v, k) => reach.set(k, v));
    }
    let entry: ShipReachEntry | undefined = reach.get(`${targetHex.q},${targetHex.r}`);
    if (!entry || !entry.endable) {
      addError(shipMode === 'wildspace'
        ? 'That hex is beyond this stepâ€™s legal movement; turn-potential previews are not moveable until a later step.'
        : 'That hex is not a legal ship destination.');
      return;
    }
    const currentElevation = ship.elevation ?? 0;
    const hexesMoved = Math.max(0, entry.path.length - 1);
    const minElevation = Math.max(0, currentElevation - hexesMoved * 10);
    const maxElevation = currentElevation + hexesMoved * 10;
    if (shipMode === 'atmosphere' && chosenElevation === undefined && hexesMoved > 0) {
      setPendingShipElevation({
        shipId,
        targetHex,
        currentElevation,
        elevation: currentElevation,
        min: minElevation,
        max: maxElevation,
      });
      return;
    }
    const nextElevation = shipMode === 'atmosphere'
      ? Math.max(minElevation, Math.min(maxElevation, Math.round(chosenElevation ?? currentElevation)))
      : currentElevation;
    let atmosphereMode: 'mp' | 'fp' = 'fp';
    if (shipMode === 'atmosphere') {
      const endSurface = structureSurfaceAt(targetHex, structures ?? {}, structureTemplates);
      const endGrounded = shipIsGrounded(nextElevation, endSurface);
      atmosphereMode = startGrounded && endGrounded ? 'mp' : 'fp';
      const modeEntry = atmosphereMode === 'mp'
        ? groundReach.get(`${targetHex.q},${targetHex.r}`)
        : airReach.get(`${targetHex.q},${targetHex.r}`);
      if (!modeEntry || !modeEntry.endable) {
        addError(atmosphereMode === 'mp'
          ? 'That ground move exceeds this ship’s MP.'
          : 'That flight exceeds this ship’s FP.');
        return;
      }
      entry = modeEntry;
    }

    // Floating cargo barrels: one Helm dodge per crate hex entered. A failed
    // dodge takes mass d speed damage and destroys every crate in that hex;
    // the crate is too small to stop the ship.
    const crateHexes = entry.path.slice(1)
      .map(h => ({
        hex: h,
        crates: groundZones.filter(z =>
          z.kind === 'cargo_debris' && z.q === h.q && z.r === h.r),
      }))
      .filter(x => x.crates.length > 0);
    let dodgeDamage = 0;
    let cratesDestroyed = 0;
    const destroyedCrateKeys = new Set<string>();
    const dodgeNotes: string[] = [];
    const helmKey = ship.snapshot?.build
      ? findCardKeyForComponent(ship.snapshot.build, 'Helm')
      : null;
    const dodgeCommandBonus = helmKey
      ? cardCommandBonus(ship.cardState, helmKey, turnNumber)
      : undefined;
    let dodgeCommandBonusUsed = false;
    for (const { hex, crates } of crateHexes) {
      const dodgeBonus = helmKey
        ? bestShipActorBonus(ship, helmKey, ['wis', 'int'], units)?.bonus ?? 0
        : 0;
      const pending = dodgeCommandBonusUsed ? 0 : (dodgeCommandBonus ?? 0);
      const roll = 1 + Math.floor(Math.random() * 20);
      const bonusLabel = dodgeBonus + pending;
      const dodgeDetail = `D20${signedBonus(bonusLabel)} vs DC 15: ${roll}`;
      const commandNote = pending !== 0 ? ` (command ${pending > 0 ? '+' : ''}${pending})` : '';
      if (roll + dodgeBonus + pending >= 15) {
        dodgeNotes.push(`dodged floating cargo at ${hex.q},${hex.r} (${dodgeDetail}${commandNote})`);
        if (pending !== 0) dodgeCommandBonusUsed = true;
        continue;
      }
      if (pending !== 0) dodgeCommandBonusUsed = true;
      const speed = shipMode === 'wildspace'
        ? (ship.declaredRound === turnNumber ? ship.declaredSpeed : (ship.lastSpeed ?? 5))
        : Math.floor(stats.atmosphericSpeed ?? 0);
      const massDice = Math.max(1, Math.floor(stats.performanceMass));
      const speedFaces = Math.max(1, speed);
      const damageRoll = rollDamageDetailed(`${massDice}d${speedFaces}`, Math.random);
      const hit = damageRoll.total;
      dodgeDamage += hit;
      cratesDestroyed += crates.reduce(
        (sum, z) => sum + Math.max(1, Number(z.barrelCount ?? 1)),
        0,
      );
      for (const crate of crates) destroyedCrateKeys.add(crate.key);
      dodgeNotes.push(`barrel collision at ${hex.q},${hex.r} (${dodgeDetail}${commandNote}); ${massDice}d${speedFaces}: ${damageRoll.faces.join(',')} = ${hit}`);
    }
    const zonesAfter = destroyedCrateKeys.size > 0
      ? groundZones.filter(z => !destroyedCrateKeys.has(z.key))
      : groundZones;
    const dodgeHp = dodgeDamage > 0
      ? (shipHullDestroyed(ship.snapshot, ship.boxState)
        ? 0
        : Math.max(0, (ship.shipHp || 0) - dodgeDamage))
      : ship.shipHp;

    const spentPools = shipMode === 'atmosphere'
      ? shipAtmosphereSpend(pools, atmosphereMode, entry.cost, Number(getSetting('ship_atmosphere_pool_ratio', 1)) || 1)
      : null;
    const moveChanges: { field: string; from: unknown; to: unknown }[] = [
      { field: 'hex', from: ship.hex, to: targetHex },
      { field: 'facing', from: ship.facing, to: entry.finalFacing },
      ...(spentPools
        ? [
            { field: 'mpSpent', from: ship.mpSpent ?? 0, to: spentPools.mpSpent },
            { field: 'fpSpent', from: ship.fpSpent ?? 0, to: spentPools.fpSpent },
          ]
        : [{ field: 'speedSpent', from: speedSpent, to: speedSpent + entry.cost }]),
      { field: 'turnsSinceFacing', from: ship.turnsSinceFacing ?? 0, to: entry.distanceSinceFacing },
      ...(nextElevation !== currentElevation
        ? [{ field: 'elevation', from: currentElevation, to: nextElevation }]
        : []),
      ...(dodgeDamage > 0
        ? [
            { field: 'shipHp', from: ship.shipHp, to: dodgeHp },
            {
              field: 'minHpAttained',
              from: ship.minHpAttained,
              to: minHpAfterDamage(ship.minHpAttained, dodgeHp),
            },
          ]
        : []),
      ...(dodgeCommandBonusUsed && helmKey
        ? [{
            field: 'cardState',
            from: ship.cardState ?? {},
            to: clearCardCommandBonus(ship.cardState, helmKey, turnNumber),
          }]
        : []),
    ];
    const moveSubSteps: SubStep[] = [{
      type: 'SHIP',
      unitId: shipId,
      description: `${shipDisplayName(ship)} moved`,
      changes: moveChanges,
    }];
    if (destroyedCrateKeys.size > 0) {
      moveSubSteps.push({
        type: 'ZONE',
        unitId: scenarioId,
        description: `${shipDisplayName(ship)}: floating cargo destroyed`,
        changes: [{ field: 'ground_effects', from: groundZones, to: zonesAfter }],
      });
    }
    const moveText = dodgeNotes.length > 0
      ? `${shipDisplayName(ship)} moved — ${dodgeNotes.join('; ')}${cratesDestroyed > 0 ? ` (${cratesDestroyed} barrel${cratesDestroyed === 1 ? '' : 's'} destroyed)` : ''}`
      : `${shipDisplayName(ship)} moved`;
    await execute('MOVE', moveSubSteps, moveText, { message: moveText });
  }, [shipRuntime, units, structures, shipMode, shipStep, turnNumber, freeMove, execute, addError, currentTurnAlliance, backgroundConfig, isGM, effectiveIsGM, myTeam, alliances, groundZones, scenarioId]);

  const handleDeclareShipSpeed = useCallback(async (shipId: string, args: {
    declaredSpeed: number;
    accelDelta: number;
    extraHexes: number;
  }) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    if (!canControlShip(ship, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance)) {
      addError('Only the helm heroâ€™s player, the captain of a same-alliance helm crew, or the DM can declare this shipâ€™s speed.');
      return;
    }
    const stats = effectiveShipStats(ship, units);
    const declared = declareSpeed({
      previousSpeed: ship.lastSpeed ?? 5,
      accelDelta: args.accelDelta,
      extraHexes: args.extraHexes,
      acceleration: stats?.accel ?? 0,
    });
    if (declared !== Math.floor(args.declaredSpeed)) {
      addError('Declared speed must be previous speed Â± acceleration Â± helmsman adjustment.');
      return;
    }
    const spent = ship.declaredRound === turnNumber
      ? shipRoundSpent(ship.declaredSpeed, ship, shipStep)
      : 0;
    if (declared < spent) {
      addError(`Cannot declare ${declared}: ${shipDisplayName(ship)} has already moved ${spent} hexes this turn (minimum ${spent}).`);
      return;
    }
    const budget = rebuildStepBudgetPreservingMoved({ newSpeed: declared, ship, step: shipStep });
    await execute('OTHER_ACTION', [{
      type: 'SHIP',
      unitId: shipId,
      description: `${shipDisplayName(ship)} declares speed ${declared}`,
      changes: [
        { field: 'declaredSpeed', from: ship.declaredSpeed, to: declared },
        { field: 'declaredRound', from: ship.declaredRound ?? 0, to: turnNumber },
        { field: 'stepBudget', from: ship.stepBudget, to: budget },
      ],
    }], `${shipDisplayName(ship)} declares speed ${declared}`);
  }, [shipRuntime, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance, execute, turnNumber, addError]);

  const handleRotateShip = useCallback(async (shipId: string, direction: 'left' | 'right') => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship || !ship.hex) return;
    if (!canControlShip(ship, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance)) {
      addError('Only the helm heroâ€™s player, the captain of a same-alliance helm crew, or the DM can turn this ship.');
      return;
    }
    if (ship.dryDockOpen) { addError('This ship is in dry dock and cannot turn.'); return; }
    const delta = direction === 'right' ? 1 : -1;
    const facing = ((ship.facing + delta) % 6 + 6) % 6;
    if (freeMove || currentTurnAlliance === null) {
      // Free Move/turn-0 rotation changes heading only â€” no movement spend,
      // no facing-distance counter reset.
      await execute('MOVE', [{
        type: 'SHIP',
        unitId: ship.id,
        description: `${shipDisplayName(ship)} turned ${direction}`,
        changes: [{ field: 'facing', from: ship.facing, to: facing }],
      }], `${shipDisplayName(ship)} turned ${direction}`);
      return;
    }
    const stats = effectiveShipStats(ship, units);
    if (!stats) return;
    if (shipMode === 'wildspace' && ship.declaredRound !== turnNumber) {
      addError(`Declare ${shipDisplayName(ship)}â€™s speed before turning.`);
      return;
    }
    const speedForMC = shipMode === 'wildspace'
      ? (ship.declaredRound === turnNumber ? ship.declaredSpeed : (ship.lastSpeed ?? 5))
      : (stats.atmosphericSpeed ?? 5);
    const startSurface = structureSurfaceAt(ship.hex!, structures ?? {}, structureTemplates);
    const grounded = shipIsGrounded(ship.elevation, startSurface);
    const pools = shipAtmospherePools(ship, stats);
    const airTurnDistance = shipTurnDistance(stats, speedForMC, shipMode, ship.mcReduction ?? 0);
    const turnDistance = shipMode === 'atmosphere' && grounded && pools.mcZero ? 0 : airTurnDistance;
    if (turnDistance > 0 && (ship.turnsSinceFacing ?? 0) < turnDistance) {
      addError(`Turn after travelling ${turnDistance} more hex${turnDistance === 1 ? '' : 'es'} (MC).`);
      return;
    }
    const speedSpent = ship.speedSpent ?? 0;
    const pool = shipMode === 'wildspace'
      ? shipStepRemaining({ stepBudget: ship.stepBudget, step: shipStep, speedSpent }, shipStep)
      : Math.max(0, Math.floor(grounded ? pools.mpRemaining : pools.fpRemaining));
    if (pool < 1) { addError('No ship movement left to turn.'); return; }
    const spentPools = shipMode === 'atmosphere'
      ? shipAtmosphereSpend(pools, grounded ? 'mp' : 'fp', 1, Number(getSetting('ship_atmosphere_pool_ratio', 1)) || 1)
      : null;
    await execute('MOVE', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)} turned ${direction}`,
      changes: [
        { field: 'facing', from: ship.facing, to: facing },
        ...(spentPools
          ? [
              { field: 'mpSpent', from: ship.mpSpent ?? 0, to: spentPools.mpSpent },
              { field: 'fpSpent', from: ship.fpSpent ?? 0, to: spentPools.fpSpent },
            ]
          : [{ field: 'speedSpent', from: speedSpent, to: speedSpent + 1 }]),
        { field: 'turnsSinceFacing', from: ship.turnsSinceFacing ?? 0, to: 0 },
      ],
    }], `${shipDisplayName(ship)} turned ${direction}`);
  }, [shipRuntime, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance, freeMove, shipMode, shipStep, turnNumber, execute, addError, structures, structureTemplates]);

  const handleToggleShipHidden = useCallback(async (shipId: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    if (!effectiveIsGM) { addError('Only the DM can hide or unhide a ship.'); return; }
    const next = !ship.hidden;
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)} ${next ? 'hidden' : 'revealed'}`,
      changes: [{ field: 'hidden', from: ship.hidden, to: next }],
    }], `${shipDisplayName(ship)} ${next ? 'hidden' : 'revealed'}`);
  }, [shipRuntime, effectiveIsGM, execute, addError]);

  const handleDeleteShip = useCallback(async (shipId: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    if (!effectiveIsGM) { addError('Only the DM can delete a ship.'); return; }
    const heroes = units.filter(u => !u.isDeleted && u.attachedToShipId === ship.id);
    if (heroes.length > 0) {
      addError(`Cannot delete ${shipDisplayName(ship)} â€” hero${heroes.length === 1 ? '' : 'es'} aboard: ${heroes.map(u => u.unitName).join(', ')}.`);
      return;
    }
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)} deleted`,
      changes: [{ field: 'isDeleted', from: ship.isDeleted, to: true }],
    }], `${shipDisplayName(ship)} deleted`);
  }, [shipRuntime, units, effectiveIsGM, execute, addError]);

  const handleMakeCampaignShip = useCallback(async (shipId: string, name: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    if (!effectiveIsGM) { addError('Only the DM can make a campaign ship.'); return; }
    if (ship.campaignId && ship.campaignCarrier) return;
    const shipName = name.trim() || ship.name;
    const campaignId = ship.campaignId
      ? await campaignStore.convert(shipId, shipName)
      : await campaignStore.declare(shipId, shipName);
    if (!campaignId) {
      addError(campaignStore.error || 'Could not create the campaign ship.');
      return;
    }
    await refreshShips();
    await campaignStore.reload();
    addMessage(ship.campaignId
      ? `${shipName} is now its own campaign version.`
      : `${shipName} is now a campaign ship.`);
  }, [shipRuntime, effectiveIsGM, addError, addMessage, refreshShips, campaignStore]);

  const handleOpenDryDock = useCallback(async (shipId: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    if (!effectiveIsGM) { addError('Only the DM can open a dry dock.'); return; }
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)} entered dry dock`,
      changes: [{ field: 'dryDockOpen', from: ship.dryDockOpen, to: true }],
    }], `${shipDisplayName(ship)} entered dry dock`);
  }, [shipRuntime, effectiveIsGM, execute, addError]);

  const handleCloseDryDock = useCallback(async (shipId: string, campaignId: string | null) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)} left dry dock`,
      changes: [{ field: 'dryDockOpen', from: ship.dryDockOpen, to: false }],
    }], `${shipDisplayName(ship)} left dry dock`);
    if (campaignId) await campaignStore.releaseEditor(campaignId, true);
  }, [shipRuntime, execute, campaignStore]);

  const handleBoardHero = useCallback(async (
    hero: Unit,
    shipId: string,
    cost = 0,
    maxMP = unitMaxMP(hero),
    isFree = freeMove,
    options?: { freePlacement?: boolean },
  ) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    if (!hero.isHero) { addError('Only heroes can board a ship.'); return; }
    if (hero.attachedToUnitId || hero.attachedToShipId) { addError('That hero is already attached.'); return; }
    if (!options?.freePlacement && (!ship.hex || !areHexesAdjacent(hero.hex, ship.hex))) {
      addError('Board from a hex adjacent to the ship.');
      return;
    }
    const maxSize = getSetting('hero_attach_max_size', 200);
    if ((hero.sizeCategory ?? 100) > maxSize) { addError('That hero is too large to board.'); return; }
    if (!options?.freePlacement && (hero.elevation ?? 0) !== (ship.elevation ?? 0)) {
      addError('Hero and ship must be at the same elevation.');
      return;
    }
    const spent = isFree ? null : applyHeroMoveCost(moveBudgetUnit(hero, 'ground'), cost, maxMP);
    // Boarded heroes default to the Deck; if it is destroyed, the Cargo hold.
    const deckKey = shipComponentCardKey(ship, 'Deck');
    const cargoKey = shipComponentCardKey(ship, 'Cargo');
    const station = deckKey && !shipCardDestroyed(ship, deckKey)
      ? deckKey
      : cargoKey && !shipCardDestroyed(ship, cargoKey)
        ? cargoKey
        : null;
    if (!station) { addError('No accessible deck or cargo space on this ship.'); return; }
    const nextStations: Record<string, { heroId?: string | null; heroIds?: string[]; crewIds?: string[] }> = { ...ship.stations };
    if (station) {
      const entry = nextStations[station] ?? {};
      nextStations[station] = { ...entry, heroIds: [...(entry.heroIds ?? []), hero.id] };
    }
    const changes: { field: string; from: unknown; to: unknown }[] = [
      { field: 'attachedToShipId', from: hero.attachedToShipId ?? null, to: shipId },
      { field: 'shipStationKey', from: hero.shipStationKey ?? null, to: station },
    ];
    if (spent) {
      changes.push({ field: 'movementPointsAvailable', from: hero.movementPointsAvailable, to: spent.movementPointsAvailable });
      changes.push({ field: 'actionsAvailable', from: hero.actionsAvailable, to: spent.actionsAvailable });
    }
    const subSteps = [
      {
        type: 'ATTACH_HERO' as const,
        unitId: hero.id,
        description: `${hero.unitName} boarded ${shipDisplayName(ship)}`,
        changes,
      },
      ...(station ? [{
        type: 'SHIP' as const,
        unitId: ship.id,
        description: `${shipDisplayName(ship)} station changed`,
        changes: [{ field: 'stations', from: ship.stations, to: nextStations }],
      }] : []),
    ];
    await execute('ATTACH_HERO', subSteps, `${hero.unitName} boarded ${shipDisplayName(ship)}`);
    setSelectedShipId(shipId);
    setShipWindowId(shipId);
  }, [shipRuntime, freeMove, unitMaxMP, execute, addError]);

  const onBoardShip = useCallback(async (
    unit: Unit,
    targetHex: Hex,
    cost: number,
    maxMP: number,
    isFree: boolean,
  ): Promise<boolean> => {
    if (!unit.isHero || unit.attachedToUnitId || unit.attachedToShipId) return false;
    const ship = shipRuntime.find(s =>
      !s.isDeleted && s.hex && s.hex.q === targetHex.q && s.hex.r === targetHex.r,
    );
    if (!ship || !ship.hex) return false;
    if (!areHexesAdjacent(unit.hex, ship.hex)) {
      addError('Board from a hex adjacent to the ship.');
      return true;
    }
    const unitAlliance = allianceOf(unit.team, alliances);
    const shipAlliance = shipOwnerAlliance(ship, units, alliances);
    if (shipAlliance !== null && unitAlliance !== shipAlliance) {
      const maxSize = getSetting('hero_attach_max_size', 200);
      const canBoard = (unit.sizeCategory ?? 100) <= maxSize
        && (unit.elevation ?? 0) === (ship.elevation ?? 0);
      setPendingShipDrop({ unit, ship, cost, maxMP, isFree, canBoard });
      return true;
    }
    const maxSize = getSetting('hero_attach_max_size', 200);
    if ((unit.sizeCategory ?? 100) > maxSize) {
      addError('That hero is too large to board.');
      return true;
    }
    if ((unit.elevation ?? 0) !== (ship.elevation ?? 0)) {
      addError('Hero and ship must be at the same elevation.');
      return true;
    }
    await handleBoardHero(unit, ship.id, cost, maxMP, isFree);
    return true;
  }, [shipRuntime, handleBoardHero, addError, units, alliances]);

  const resolvePendingShipAttack = useCallback(async () => {
    const pending = pendingShipDrop;
    if (!pending) return;
    setPendingShipDrop(null);
    const { unit, ship } = pending;
    if (!ship.hex) return;
    const weapon = unitShipAttackWeapon(parseWeapons(unit.weaponString), hexDistance(unit.hex, ship.hex));
    if (!weapon) { addError(`${unit.unitName} has no weapon that can reach ${ship.name}.`); return; }
    const cls = classifyUnitShipAttack(unit, weapon);
    const actionCost = weapon.freeAction ? 0 : 1;
    const actionSteps: SubStep[] = actionCost > 0
      ? [{
          type: 'OTHER_ACTION',
          unitId: unit.id,
          description: `${unit.unitName} spent an action attacking ${ship.name}`,
          changes: [{ field: 'actionsAvailable', from: unit.actionsAvailable, to: unit.actionsAvailable - actionCost }],
        }]
      : [];
    if (cls === 'personal') {
      const text = `${unit.unitName}'s personal weapons cannot damage ${shipDisplayName(ship)}.`;
      await execute('ATTACK', actionSteps, text, { message: text });
      return;
    }
    const ac = ship.snapshot?.stats?.ac ?? 10;
    const dt = ship.snapshot?.stats?.damageThreshold ?? 15;
    const autoHit = cls === 'magic-aoe';
    const attackCount = cls === 'siege' || cls === 'huge'
      ? Math.max(1, weapon.numberOfAttacks ?? 1)
      : 1;
    const attackRolls: number[] = [];
    let totalDamage = 0;
    let hitCount = 0;
    let penetrated = false;
    let lastDamage = 0;
    const boxState = { ...(ship.boxState ?? {}) };
    const crewState = { ...(ship.crewState ?? {}) };
    const stations = { ...(ship.stations ?? {}) };
    const extraSteps: SubStep[] = [];
    const detail: string[] = [];
    let nextSnapshot = ship.snapshot;
    let nextLoadedCargo = ship.loadedCargo ?? 0;
    let cargoChanged = false;
    let cargoLost = '';
    let nextGroundZones = groundZones;
    let cargoDebrisChanged = false;
    const componentHits = cls === 'siege' || cls === 'huge' || cls === 'magic-aoe';
    const cards = ship.snapshot?.build
      ? shipHitCards(ship.snapshot.build)
        .map(c => ({ ...c, tons: Math.max(0, c.tons - Number(boxState[c.key] ?? 0)) }))
        .filter(c => c.tons > 0)
      : [];
    const hitCrewOnCard = (cardKey: string, count: number, damage: number) => {
      const targets = shipCardCrewTargets(ship, units, cardKey);
      const picked = pickDistinct(targets, Math.min(count, targets.length), Math.random);
      if (picked.length === 0) return;
      const station = stations[cardKey];
      if (station) stations[cardKey] = { ...station, crewIds: [...(station.crewIds ?? [])] };
      const names: string[] = [];
      for (const target of picked) {
        names.push(target.name);
        if (target.kind === 'crew') {
          const hp = Math.max(0, target.hp - damage);
          crewState[target.id] = {
            ...(crewState[target.id] ?? { hp: target.hp }),
            hp,
            dead: hp <= 0,
            ...(hp <= 0 ? { station: null } : {}),
          };
          if (hp <= 0) {
            const s = stations[cardKey];
            if (s) s.crewIds = (s.crewIds ?? []).filter(id => id !== target.id);
          }
        } else {
          const hero = units.find(u => u.id === target.id);
          if (!hero) continue;
          const hp = Math.max(0, (hero.currentUnitHp ?? 1) - damage);
          extraSteps.push({
            type: 'DAMAGE',
            unitId: hero.id,
            description: `${hero.unitName} wounded aboard ${shipDisplayName(ship)}`,
            changes: [{ field: 'currentUnitHp', from: hero.currentUnitHp, to: hp }],
          });
        }
      }
      detail.push(`${names.length} crew hit (${names.join(', ')})`);
    };
    for (let i = 0; i < attackCount; i += 1) {
      const roll = 1 + Math.floor(Math.random() * 20);
      attackRolls.push(roll);
      const hit = autoHit || roll === 20 || (roll !== 1 && roll + weapon.attackBonus >= ac);
      if (!hit) continue;
      hitCount += 1;
      const damageRoll = rollDamageDetailed(weapon.damageDice, Math.random);
      lastDamage = damageRoll.total;
      if (damageRoll.total < dt) continue;
      penetrated = true;
      totalDamage += damageRoll.total;
      if (componentHits) {
        const card = pickShipComponent(cards.filter(c => c.tons > 0));
        if (card) {
          const destroyedBefore = Number(boxState[card.key] ?? 0);
          const tons = cappedComponentTons(card.tons, damageRoll.total);
          if (tons > 0) {
            boxState[card.key] = Number(boxState[card.key] ?? 0) + tons;
            card.tons -= tons;
            detail.push(`${tons} ${card.name} box${tons === 1 ? '' : 'es'} destroyed`);
          }
          if (cls === 'magic-aoe' && tons <= 0) {
            // AoE always affects a component even when the /10 ton roll is 0.
            boxState[card.key] = destroyedBefore + 1;
            detail.push(`1 ${card.name} box destroyed`);
          }
          if (card.name === 'Cargo' && ship.snapshot?.build) {
            const build = ship.snapshot.build;
            const manifest = normalizeCargoManifest(build.manifest ?? ship.snapshot.template.manifest ?? []);
            const capacity = computeCargoCapacity(build);
            const effectiveCapacity = Math.max(0, capacity - destroyedBefore);
            const boxes = packCargoBoxes(manifest, effectiveCapacity);
            const destroyedBoxes = rollDestroyedCargoBoxes(boxes, Math.max(1, tons), Math.random);
            const result = removeCargoBoxes(manifest, destroyedBoxes);
            const manifestMass = cargoManifestMass(result.items);
            const nextBuild = {
              ...build,
              manifest: result.items,
              performanceMass: Math.max(1, build.totalMass - capacity + manifestMass),
            };
            nextSnapshot = {
              ...ship.snapshot,
              template: { ...ship.snapshot.template, manifest: result.items },
              build: nextBuild,
              stats: computeShipBuild(nextBuild),
            };
            nextLoadedCargo = manifestMass;
            cargoLost = cargoDamageSummary(result.destroyedItems);
            cargoChanged = true;
            if (cargoLost) detail.push(`cargo lost: ${cargoLost}`);
            if (ship.hex && result.destroyedItems.length > 0) {
              const hex = ship.hex;
              const existing = groundZones.filter(z =>
                z.kind === 'cargo_debris' && z.q === hex.q && z.r === hex.r);
              const barrelCount = result.destroyedBoxes.filter(items => items.length > 0).length;
              const merged: GroundEffect = {
                key: existing[0]?.key ?? newEffectKey(),
                q: hex.q,
                r: hex.r,
                name: 'Floating cargo barrel',
                color: '#b45309',
                kind: 'cargo_debris',
                transparentBackground: true,
                layer: 'above',
                elevation: existing[0]?.elevation ?? (ship.elevation ?? 0),
                zIndex: existing[0]?.zIndex ?? 50,
                duration: 0,
                turnsLeft: 0,
                permanent: true,
                cargo: mergeCargoItems([
                  ...existing.flatMap(z => z.cargo ?? []),
                  ...result.destroyedItems,
                ]),
                barrelCount: existing.reduce((sum, z) => sum + Math.max(1, Number(z.barrelCount ?? 1)), 0)
                  + barrelCount,
                salvageFraction: 0.5,
              };
              nextGroundZones = [
                ...groundZones.filter(z => !(z.kind === 'cargo_debris' && z.q === hex.q && z.r === hex.r)),
                merged,
              ];
              cargoDebrisChanged = true;
              if (barrelCount > 0) detail.push(`${barrelCount} floating barrel${barrelCount === 1 ? '' : 's'}`);
            }
          }
          if (cls === 'magic-aoe') {
            const radius = weapon.magicDimension ?? 0;
            const crewCount = radius >= 20 ? 3 : radius <= 5 ? 1 : 2;
            hitCrewOnCard(card.key, crewCount, damageRoll.total);
          } else if (cls === 'siege' || cls === 'huge') {
            hitCrewOnCard(card.key, 1, damageRoll.total);
          }
        }
      }
    }
    const newHp = penetrated ? Math.max(0, ship.shipHp - totalDamage) : ship.shipHp;
    const text = penetrated
      ? `${unit.unitName} hit ${shipDisplayName(ship)} with ${weapon.name} for ${totalDamage}${detail.length > 0 ? ` — ${detail.join('; ')}` : ''}.`
      : hitCount > 0
        ? `${unit.unitName} hit ${shipDisplayName(ship)} with ${weapon.name}, but ${lastDamage} did not beat damage threshold ${dt}.`
        : `${unit.unitName} missed ${shipDisplayName(ship)} with ${weapon.name}.`;
    const verbose = [
      text,
      autoHit
        ? '(area spell auto-hit)'
        : attackRolls.map(r => `{D20${weapon.attackBonus >= 0 ? '+' : ''}${weapon.attackBonus} vs AC ${ac}: ${r}}`).join(' '),
      penetrated ? `${totalDamage} total damage vs DT ${dt}` : '',
    ].filter(Boolean).join('\n');
    const shipSteps: SubStep[] = penetrated
      ? [{
          type: 'SHIP',
          unitId: ship.id,
          description: `${shipDisplayName(ship)} took ${totalDamage}`,
          changes: [
            { field: 'shipHp', from: ship.shipHp, to: newHp },
            { field: 'minHpAttained', from: ship.minHpAttained, to: minHpAfterDamage(ship.minHpAttained, newHp) },
            ...(componentHits ? [{ field: 'boxState', from: ship.boxState ?? {}, to: boxState }] : []),
            ...(cargoChanged
              ? [
                  { field: 'snapshot', from: ship.snapshot, to: nextSnapshot },
                  { field: 'loadedCargo', from: ship.loadedCargo ?? 0, to: nextLoadedCargo },
                ]
              : []),
            ...(componentHits
              ? [
                  { field: 'crewState', from: ship.crewState ?? {}, to: crewState },
                  { field: 'stations', from: ship.stations ?? {}, to: stations },
                ]
              : []),
          ],
          payload: { killerUnitId: unit.id, victimLevel: 0 },
        }]
      : [];
    const zoneSteps: SubStep[] = cargoDebrisChanged
      ? [{
          type: 'ZONE',
          unitId: scenarioId,
          description: `${shipDisplayName(ship)}: floating cargo barrels`,
          changes: [{ field: 'ground_effects', from: groundZones, to: nextGroundZones }],
        }]
      : [];
    await execute('ATTACK', [...actionSteps, ...extraSteps, ...shipSteps, ...zoneSteps], text, { message: text, verboseMessage: verbose });
  }, [pendingShipDrop, execute, units, groundZones, scenarioId]);

  /** Non-hero drop on a ship: route to the ship-attack prompt when a weapon reaches. */
  const onAttackShip = useCallback(async (
    unit: Unit,
    targetHex: Hex,
    cost: number,
    maxMP: number,
    isFree: boolean,
  ): Promise<boolean> => {
    if (unit.isHero) return false;
    const ship = shipRuntime.find(s =>
      !s.isDeleted && s.hex && s.hex.q === targetHex.q && s.hex.r === targetHex.r,
    );
    if (!ship?.hex) return false;
    const weapons = parseWeapons(unit.weaponString);
    const weapon = unitShipAttackWeapon(weapons, hexDistance(unit.hex, ship.hex));
    if (!weapon) {
      addError(`${unit.unitName} has no weapon that can reach ${ship.name}.`);
      return true;
    }
    setPendingShipDrop({ unit, ship, cost, maxMP, isFree, canBoard: false });
    return true;
  }, [shipRuntime, addError]);

  /** Free-placement boarding: adjacency and same-elevation checks are waived. */
  const onBoardShipFree = useCallback(async (unit: Unit, shipId: string) => {
    await handleBoardHero(unit, shipId, 0, unitMaxMP(unit), true, { freePlacement: true });
  }, [handleBoardHero]);


  const handleMoveHeroToken = useCallback(async (heroId: string, toCardKey: string, xPct: number, yPct: number) => {
    const hero = units.find(u => u.id === heroId && !u.isDeleted);
    const shipId = hero?.attachedToShipId;
    const ship = shipId ? shipRuntime.find(s => s.id === shipId) : undefined;
    if (!hero || !ship) return;
    if (shipCardDestroyed(ship, toCardKey)) {
      addError('That card is destroyed and cannot be manned.');
      return;
    }
    if (!effectiveIsGM && hero.team !== myTeam) {
      addError('You can only move your own heroes.');
      return;
    }
    const fromKey = hero.shipStationKey ?? null;
    const nextStations: Record<string, {
      heroId?: string | null;
      heroIds?: string[];
      crewIds?: string[];
      heroPositions?: Record<string, { xPct: number; yPct: number }>;
    }> = {};
    for (const [key, entry] of Object.entries(ship.stations ?? {})) {
      nextStations[key] = {
        ...entry,
        heroIds: [...(entry.heroIds ?? [])],
        crewIds: [...(entry.crewIds ?? [])],
        heroPositions: { ...(entry.heroPositions ?? {}) },
      };
    }
    const nextCrewState = { ...(ship.crewState ?? {}) };
    const target = nextStations[toCardKey] ?? { heroIds: [], crewIds: [], heroPositions: {} };
    const targetHeroIds = new Set([...(target.heroIds ?? []), ...(target.heroId ? [target.heroId] : [])]);
    const capacity = shipCardHeroCapacity(ship, toCardKey);

    if (fromKey !== toCardKey) {
      // A stale reference to the incoming hero must not count against the target.
      targetHeroIds.delete(heroId);
      const targetCrew = [...(target.crewIds ?? [])];
      if (Number.isFinite(capacity)) {
        if (targetHeroIds.size + 1 > capacity) {
          addError('That card is full.');
          return;
        }
        // Remove enough crew to make room for the hero (also repairs legacy overfill).
        const maxCrew = Math.max(0, capacity - targetHeroIds.size - 1);
        while (targetCrew.length > maxCrew) {
          const lastCrew = targetCrew.pop()!;
          const templateCrew = ship.snapshot?.template?.crews?.find(c => c.id === lastCrew);
          nextCrewState[lastCrew] = {
            ...(nextCrewState[lastCrew] ?? { hp: templateCrew?.hp ?? 1 }),
            station: null,
          };
        }
      }
      target.crewIds = targetCrew;
      if (fromKey && nextStations[fromKey]) {
        const old = nextStations[fromKey];
        old.heroIds = (old.heroIds ?? []).filter(id => id !== heroId);
        if (old.heroPositions) delete old.heroPositions[heroId];
        if (old.heroId === heroId) old.heroId = null;
        // Auto-fill the vacated card with exactly one reserve crew, only when the
        // card has exactly one empty slot.
        const oldCapacity = shipCardHeroCapacity(ship, fromKey);
        const fromIsHull = !!ship.snapshot?.build && fromKey === shipHullCardKey(ship.snapshot.build);
        const oldOccupants =
          (old.heroIds?.length ?? 0) +
          (old.heroId ? 1 : 0) +
          (old.crewIds?.length ?? 0);
        if (fromIsHull || !needsStationReplacement(oldCapacity, oldOccupants)) {
          // no replacement
        } else {
          const assigned = new Set<string>();
          for (const entry of Object.values(nextStations)) {
            for (const id of entry.crewIds ?? []) assigned.add(id);
          }
          const reserve = (ship.snapshot?.template?.crews ?? []).find(c => {
            const st = nextCrewState[c.id];
            return !st?.dead && !st?.station && !assigned.has(c.id);
          });
          if (reserve) {
            old.crewIds = [...(old.crewIds ?? []), reserve.id];
            nextCrewState[reserve.id] = { ...(nextCrewState[reserve.id] ?? { hp: reserve.hp }), station: fromKey };
          }
        }
      }
      target.heroIds = Array.from(new Set([...(target.heroIds ?? []), heroId]));
      if (capacity === 1) target.heroId = heroId;
      target.heroPositions = { ...(target.heroPositions ?? {}), [heroId]: { xPct, yPct } };
      nextStations[toCardKey] = target;
    } else {
      target.heroPositions = { ...(target.heroPositions ?? {}), [heroId]: { xPct, yPct } };
      nextStations[toCardKey] = target;
    }

    const stationLabel = shipStationLabel(ship, toCardKey);
    const subSteps: SubStep[] = [
      ...(fromKey !== toCardKey ? [{
        type: 'ATTACH_HERO' as const,
        unitId: hero.id,
        description: `${hero.unitName} moved to ${stationLabel}`,
        changes: [{ field: 'shipStationKey', from: fromKey, to: toCardKey }],
      }] : []),
      {
        type: 'SHIP' as const,
        unitId: ship.id,
        description: `${shipDisplayName(ship)} hero moved`,
        changes: [
          { field: 'stations', from: ship.stations ?? {}, to: nextStations },
          { field: 'crewState', from: ship.crewState ?? {}, to: nextCrewState },
        ],
      },
    ];
    const moveDescription = fromKey !== toCardKey
      ? `${hero.unitName} moved to ${stationLabel} on ${shipDisplayName(ship)}`
      : `${hero.unitName} repositioned on ${stationLabel} on ${shipDisplayName(ship)}`;
    await execute('ATTACH_HERO', subSteps, moveDescription, { silent: true });
  }, [units, shipRuntime, execute, addError, effectiveIsGM, myTeam]);

  const handleDisembarkHero = useCallback(async (heroId: string, targetHex?: Hex) => {
    const hero = units.find(u => u.id === heroId && !u.isDeleted);
    const shipId = hero?.attachedToShipId;
    const ship = shipId ? shipRuntime.find(s => s.id === shipId) : undefined;
    if (!hero || !ship?.hex) return;
    if (!effectiveIsGM && hero.team !== myTeam) {
      addError('You can only disembark your own heroes.');
      return;
    }
    const radius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
    const occupied = computeOccupiedHexes(units, hero.id, ship.elevation ?? 0);
    const dest = targetHex ?? HEX_DIRS
      .map(d => ({ q: ship.hex!.q + d.q, r: ship.hex!.r + d.r, s: -ship.hex!.q - d.q - ship.hex!.r - d.r }))
      .find(h =>
        isHexOnGrid(h, radius) &&
        !occupied.has(`${h.q},${h.r}`) &&
        !shipRuntime.some(s => s.id !== ship.id && s.hex && !s.isDeleted && s.hex.q === h.q && s.hex.r === h.r),
      );
    if (!dest) { addError('No free adjacent hex to disembark.'); return; }
    if (!areHexesAdjacent(ship.hex, dest)) {
      addError('Disembark onto a hex next to the ship.');
      return;
    }
    if (!isHexOnGrid(dest, radius) || occupied.has(`${dest.q},${dest.r}`) ||
        shipRuntime.some(s => s.id !== ship.id && s.hex && !s.isDeleted && s.hex.q === dest.q && s.hex.r === dest.r)) {
      addError('That hex is not available for disembarking.');
      return;
    }
    const rawCost = makeCostOfHex(zoneMpCosts, walls, {
      structures,
      templates: structureTemplates,
      isMounted: false,
    })(dest.q, dest.r, ship.hex.q, ship.hex.r);
    if (rawCost < 0) { addError('That hex is blocked.'); return; }
    const spent = freeMove ? null : applyHeroMoveCost(moveBudgetUnit(hero, 'ground'), rawCost, unitMaxMP(hero));
    const nextStations: Record<string, { heroId?: string | null; heroIds?: string[]; crewIds?: string[]; heroPositions?: Record<string, { xPct: number; yPct: number }> }> = { ...ship.stations };
    for (const key of Object.keys(nextStations)) {
      const entry = nextStations[key] ?? {};
      const heroPositions = { ...(entry.heroPositions ?? {}) };
      delete heroPositions[heroId];
      nextStations[key] = {
        ...entry,
        heroId: entry.heroId === heroId ? null : entry.heroId,
        heroIds: (entry.heroIds ?? []).filter(id => id !== heroId),
        heroPositions,
      };
    }
    const changes: { field: string; from: unknown; to: unknown }[] = [
      { field: 'attachedToShipId', from: hero.attachedToShipId ?? null, to: null },
      { field: 'shipStationKey', from: hero.shipStationKey ?? null, to: null },
      { field: 'hex', from: hero.hex, to: dest },
    ];
    if (spent) {
      changes.push({ field: 'movementPointsAvailable', from: hero.movementPointsAvailable, to: spent.movementPointsAvailable });
      changes.push({ field: 'actionsAvailable', from: hero.actionsAvailable, to: spent.actionsAvailable });
    }
    await execute('DETACH_HERO', [
      {
        type: 'DETACH_HERO',
        unitId: hero.id,
        description: `${hero.unitName} disembarked`,
        changes,
      },
      {
        type: 'SHIP',
        unitId: ship.id,
        description: `${shipDisplayName(ship)} station changed`,
        changes: [{ field: 'stations', from: ship.stations, to: nextStations }],
      },
    ], `${hero.unitName} disembarked`);
  }, [units, shipRuntime, backgroundConfig, execute, addError, effectiveIsGM, myTeam, zoneMpCosts, walls, structures, structureTemplates, freeMove, unitMaxMP]);

  const handleFillStation = useCallback(async (shipId: string, cardKey: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const build = ship?.snapshot?.build;
    if (!ship || !build) return;
    if (shipCardDestroyed(ship, cardKey)) {
      addError('That card is destroyed and cannot be manned.');
      return;
    }
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only the captain, a helmsman (when no captain exists), or the DM can fill this station.');
      return;
    }
    const stationCard = shipStationCards(build, { boxState: ship.boxState }).find(c => c.key === cardKey);
    const capacity = stationCard ? stationCard.crewRequired : shipCardHeroCapacity(ship, cardKey);
    if (!Number.isFinite(capacity) || capacity <= 0) return;
    const station = ship.stations?.[cardKey] ?? {};
    const heroes = new Set([...(station.heroIds ?? []), ...(station.heroId ? [station.heroId] : [])]);
    const present = (station.crewIds?.length ?? 0) + heroes.size;
    const free = Math.max(0, capacity - present);
    if (free === 0) return;

    const assigned = new Set<string>();
    for (const entry of Object.values(ship.stations ?? {})) {
      for (const id of entry.crewIds ?? []) assigned.add(id);
    }
    for (const [id, state] of Object.entries(ship.crewState ?? {})) {
      if (state.station) assigned.add(id);
    }
    const reserve = (ship.snapshot?.template?.crews ?? [])
      .filter(c => !ship.crewState?.[c.id]?.dead && !assigned.has(c.id));
    if (reserve.length === 0) {
      addError('No reserve crew available.');
      return;
    }
    const stats = stationCard
      ? shipStationStats(stationCard.kind)
      : cardKey === shipHullCardKey(build) ? ['str' as const] : ['dex' as const];
    const chosen = [...reserve]
      .sort((a, b) => bestCheckBonus(b, stats, true) - bestCheckBonus(a, stats, true))
      .slice(0, free)
      .map(c => c.id);

    const nextCrewState = { ...(ship.crewState ?? {}) };
    for (const id of chosen) {
      const crew = reserve.find(c => c.id === id);
      nextCrewState[id] = { ...(nextCrewState[id] ?? { hp: crew?.hp ?? 1 }), station: cardKey };
    }
    const nextStations = {
      ...ship.stations,
      [cardKey]: { ...station, crewIds: [...(station.crewIds ?? []), ...chosen] },
    };
    const stationLabel = shipStationLabel(ship, cardKey);
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)}: filled ${stationLabel}`,
      changes: [
        { field: 'crewState', from: ship.crewState ?? {}, to: nextCrewState },
        { field: 'stations', from: ship.stations ?? {}, to: nextStations },
      ],
    }], `${shipDisplayName(ship)}: filled ${stationLabel}`, { silent: true });
  }, [shipRuntime, units, myTeam, effectiveIsGM, execute, addError]);

  const handleEmptyStation = useCallback(async (shipId: string, cardKey: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only the captain, a helmsman (when no captain exists), or the DM can empty this station.');
      return;
    }
    const station = ship.stations?.[cardKey] ?? {};
    const crewIds = station.crewIds ?? [];
    if (crewIds.length === 0) return;
    const nextStations = { ...ship.stations, [cardKey]: { ...station, crewIds: [] } };
    const nextCrewState = { ...(ship.crewState ?? {}) };
    for (const id of crewIds) {
      nextCrewState[id] = { ...(nextCrewState[id] ?? {}), station: null };
    }
    const stationLabel = shipStationLabel(ship, cardKey);
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)}: emptied ${stationLabel}`,
      changes: [
        { field: 'crewState', from: ship.crewState ?? {}, to: nextCrewState },
        { field: 'stations', from: ship.stations ?? {}, to: nextStations },
      ],
    }], `${shipDisplayName(ship)}: emptied ${stationLabel}`, { silent: true });
  }, [shipRuntime, units, myTeam, effectiveIsGM, execute, addError]);

  const handleUpdateManifest = useCallback(async (shipId: string, items: CargoManifestItem[]) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const snapshot = ship?.snapshot;
    if (!ship || !snapshot) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards) {
      addError('Only the captain, a helmsman (when no captain exists), or the DM can edit the cargo manifest.');
      return;
    }
    const manifest = normalizeCargoManifest(items);
    const capacity = computeCargoCapacity(snapshot.build);
    const manifestMass = cargoManifestMass(manifest);
    const build = {
      ...snapshot.build,
      manifest,
      performanceMass: Math.max(1, snapshot.build.totalMass - capacity + manifestMass),
    };
    const nextSnapshot = {
      ...snapshot,
      template: { ...snapshot.template, manifest },
      build,
      stats: computeShipBuild(build),
    };
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)}: cargo manifest updated`,
      changes: [
        { field: 'snapshot', from: snapshot, to: nextSnapshot },
        { field: 'loadedCargo', from: ship.loadedCargo ?? 0, to: manifestMass },
      ],
    }], `${shipDisplayName(ship)}: cargo manifest updated`);
  }, [shipRuntime, units, myTeam, effectiveIsGM, execute, addError]);

  const handleSetCrewTeam = useCallback(async (shipId: string, team: string | null) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards) {
      addError('Only the captain, a helmsman (when no captain exists), or the DM can set the crew team.');
      return;
    }
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)} crew assigned to ${team ?? 'no team'}`,
      changes: [{ field: 'crewTeam', from: ship.crewTeam ?? null, to: team }],
    }], `${shipDisplayName(ship)} crew assigned to ${team ?? 'no team'}`);
  }, [shipRuntime, units, myTeam, effectiveIsGM, execute, addError]);

  const logNegativeActions = useCallback(async (label: string, payers: Unit[]) => {
    if (payers.length === 0) return;
    const subSteps: SubStep[] = payers.map(hero => ({
      type: 'OTHER_ACTION',
      unitId: hero.id,
      description: `${hero.unitName} spent an extra action`,
      changes: [{ field: 'actionsAvailable', from: hero.actionsAvailable, to: hero.actionsAvailable - 1 }],
    }));
    await execute('OTHER_ACTION', subSteps, `${label}: extra action`);
  }, [execute]);

  const handleSailSpeed = useCallback(async (shipId: string, cardKey: string, delta: 1 | -1, approvedNegative = false) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only a player with a hero on the sail card, the captain, a helmsman (when no captain exists), or the DM can trim the sails.');
      return;
    }
    if (shipIsGrounded(ship.elevation, structureSurfaceAt(ship.hex!, structures ?? {}, structureTemplates))) {
      addError('Sails cannot be used while the ship is on the ground.');
      return;
    }
    if (turnNumber > 0 && ship.sailMaxStep === turnNumber) {
      addMessage('Sail maxing already succeeded this turn.');
      return;
    }
    const payers = shipCardFunctionHeroes(ship, units, cardKey);
    if (payers.length === 0) {
      addError('No hero on the card, captain, or helmsman to spend an action.');
      return;
    }
    const actor = bestShipActorBonus(ship, cardKey, 'con', units);
    if (!actor) { addError('No crew or hero is manning the sail.'); return; }
    const cardUse = beginCardUse(ship, cardKey, turnNumber, shipStep, shipMode, approvedNegative);
    if (!cardUse) { addError('No card steps left on that card this turn.'); return; }
    const commandBonus = cardCommandBonus(ship.cardState, cardKey, turnNumber);
    const commandNote = commandBonus != null
      ? ` (command ${commandBonus > 0 ? '+' : ''}${commandBonus})`
      : '';
    const speed = ship.declaredSpeed || ship.lastSpeed || 0;
    const dc = speed + 10;
    const roll = 1 + Math.floor(Math.random() * 20);
    const total = roll + actor.bonus + (commandBonus ?? 0);
    const success = total >= dc;
    const subSteps: SubStep[] = [];
    const changes: { field: string; from: unknown; to: unknown }[] = [];
    const stepBudget = success ? adjustStepBudget(ship.stepBudget, shipStep, delta) : null;
    const stepValue = stepBudget ? stepBudget[Math.max(0, Math.min(4, shipStep - 1))] : 0;
    const warning = success && stepValue > 13 ? ` Warning: step speed ${stepValue} exceeds 13.` : '';
    if (success && stepBudget) {
      changes.push({ field: 'stepBudget', from: ship.stepBudget, to: stepBudget });
      changes.push({ field: 'sailMaxStep', from: ship.sailMaxStep ?? 0, to: turnNumber });
    }
    const nextCardState = commandBonus != null
      ? clearCardCommandBonus(cardUse.next, cardKey, turnNumber)
      : cardUse.next;
    if (cardUse.spent || commandBonus != null) {
      changes.push({ field: 'cardState', from: ship.cardState ?? {}, to: nextCardState });
    }
    if (changes.length > 0) {
      subSteps.push({
        type: 'SHIP',
        unitId: ship.id,
        description: `${shipDisplayName(ship)}: Sail maxing ${success ? (delta > 0 ? '+1 speed' : '−1 speed') : 'failed'}`,
        changes,
      });
    }
    if (!approvedNegative) {
      for (const hero of payers) {
        subSteps.push({
          type: 'OTHER_ACTION',
          unitId: hero.id,
          description: `${hero.unitName} spent an action on the sails`,
          changes: [{ field: 'actionsAvailable', from: hero.actionsAvailable, to: hero.actionsAvailable - 1 }],
        });
      }
    }
    const summary = success
      ? `${shipDisplayName(ship)}: Sail maxing ${delta > 0 ? '+1 speed' : '−1 speed'} — ${actor.name} ${total} vs DC ${dc}, step speed ${delta > 0 ? '+1' : '−1'}.${warning}`
      : `${shipDisplayName(ship)}: Sail maxing failed — ${actor.name} ${total} vs DC ${dc} (1 card step spent).`;
    const verbose = `${shipDisplayName(ship)}: Sail maxing ${delta > 0 ? '+1 speed' : '−1 speed'} — ${actor.name}: ${formatShipCheckDetail([roll], actor.bonus + (commandBonus ?? 0), dc)}${commandNote} = ${total} ${success ? '(success)' : '(failed)'}`;
    await execute('SHIP', subSteps, `${shipDisplayName(ship)} sail check`, { message: summary, verboseMessage: verbose });
    if (approvedNegative) await logNegativeActions(`${shipDisplayName(ship)} sail check`, payers);
  }, [shipRuntime, units, myTeam, effectiveIsGM, shipStep, turnNumber, shipMode, execute, addError, addMessage, logNegativeActions, structures, structureTemplates]);

  const handleRudderTrim = useCallback(async (shipId: string, cardKey: string, approvedNegative = false) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only a player with a hero on the rudder card, the captain, a helmsman (when no captain exists), or the DM can trim the rudder.');
      return;
    }
    if (shipIsGrounded(ship.elevation, structureSurfaceAt(ship.hex!, structures ?? {}, structureTemplates))) {
      addError('Rudder trim cannot be used while the ship is on the ground.');
      return;
    }
    if (turnNumber > 0 && ship.sailTrimStep === turnNumber) {
      addMessage('Sail trimming already succeeded this turn.');
      return;
    }
    const payers = shipCardFunctionHeroes(ship, units, cardKey);
    if (payers.length === 0) {
      addError('No hero on the card, captain, or helmsman to spend an action.');
      return;
    }
    const actor = bestShipActorBonus(ship, cardKey, 'int', units);
    if (!actor) { addError('No crew or hero is manning the rudder.'); return; }
    const cardUse = beginCardUse(ship, cardKey, turnNumber, shipStep, shipMode, approvedNegative);
    if (!cardUse) { addError('No card steps left on that card this turn.'); return; }
    const commandBonus = cardCommandBonus(ship.cardState, cardKey, turnNumber);
    const commandNote = commandBonus != null
      ? ` (command ${commandBonus > 0 ? '+' : ''}${commandBonus})`
      : '';
    const stats = effectiveShipStats(ship, units);
    if (!stats) { addError('This ship has no stats.'); return; }
    const speed = shipMode === 'wildspace'
      ? (ship.declaredSpeed || ship.lastSpeed || 0)
      : (stats.atmosphericSpeed ?? 0);
    const mc = shipTurnDistance(stats, speed, shipMode, ship.mcReduction ?? 0);
    const dc = 20 - mc;
    const roll = 1 + Math.floor(Math.random() * 20);
    const total = roll + actor.bonus + (commandBonus ?? 0);
    const success = total >= dc;
    const subSteps: SubStep[] = [];
    const changes: { field: string; from: unknown; to: unknown }[] = [];
    if (success) {
      changes.push({ field: 'mcReduction', from: ship.mcReduction ?? 0, to: (ship.mcReduction ?? 0) + 1 });
      changes.push({ field: 'sailTrimStep', from: ship.sailTrimStep ?? 0, to: turnNumber });
    }
    const nextCardState = commandBonus != null
      ? clearCardCommandBonus(cardUse.next, cardKey, turnNumber)
      : cardUse.next;
    if (cardUse.spent || commandBonus != null) {
      changes.push({ field: 'cardState', from: ship.cardState ?? {}, to: nextCardState });
    }
    if (changes.length > 0) {
      subSteps.push({
        type: 'SHIP',
        unitId: ship.id,
        description: `${shipDisplayName(ship)}: Sail trimming ${success ? 'succeeded (MC −1)' : 'trim check failed'}`,
        changes,
      });
    }
    if (!approvedNegative) {
      for (const hero of payers) {
        subSteps.push({
          type: 'OTHER_ACTION',
          unitId: hero.id,
          description: `${hero.unitName} spent an action on the rudder`,
          changes: [{ field: 'actionsAvailable', from: hero.actionsAvailable, to: hero.actionsAvailable - 1 }],
        });
      }
    }
    const summary = success
      ? `${shipDisplayName(ship)}: Sail trimming — ${actor.name} ${total} vs DC ${dc}, MC reduced by 1 this turn.`
      : `${shipDisplayName(ship)}: Sail trimming failed — ${actor.name} ${total} vs DC ${dc} (1 card step spent).`;
    const verbose = `${shipDisplayName(ship)}: Sail trimming — ${actor.name}: ${formatShipCheckDetail([roll], actor.bonus + (commandBonus ?? 0), dc)}${commandNote} = ${total} ${success
      ? '(success — MC reduced by 1 this turn)'
      : '(trim check failed)'}`;
    await execute('SHIP', subSteps, `${shipDisplayName(ship)} sail trim check`, { message: summary, verboseMessage: verbose });
    if (approvedNegative) await logNegativeActions(`${shipDisplayName(ship)} sail trim check`, payers);
  }, [shipRuntime, units, myTeam, effectiveIsGM, shipStep, turnNumber, shipMode, execute, addError, addMessage, logNegativeActions, structures, structureTemplates]);

  const handleRepair = useCallback(async (shipId: string, cardKey: string, targetCardKey?: string | null, approvedNegative = false) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const snapshot = ship?.snapshot;
    if (!ship) return;
    if (!snapshot) { addError('No cargo manifest on this ship.'); return; }
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only a player with a hero on the hull card, the captain, a helmsman (when no captain exists), or the DM can repair.');
      return;
    }
    if (shipHullDestroyed(snapshot, ship.boxState)) {
      addError('The hull is destroyed; the ship cannot be repaired.');
      return;
    }
    const station = ship.stations?.[cardKey];
    const heroIds = new Set([
      ...(station?.heroIds ?? []),
      ...(station?.heroId ? [station.heroId] : []),
    ]);
    const livingCrew = (station?.crewIds ?? []).filter(id => !ship.crewState?.[id]?.dead).length;
    const livingHeroIds = Array.from(heroIds).filter(id => {
      const hero = units.find(u => u.id === id && !u.isDeleted);
      return !!hero && (hero.currentUnitHp ?? 1) > 0;
    });
    if (livingCrew + livingHeroIds.length < SHIP_HULL_REPAIR_CAPACITY) {
      addError(`Repair needs ${SHIP_HULL_REPAIR_CAPACITY} heroes or crew on the hull card.`);
      return;
    }
    const manifest = normalizeCargoManifest(snapshot.template?.manifest);
    if (cargoQuantity(manifest, 'ship_repair_kit') < 1) {
      addError('No ship repair kit in cargo.');
      return;
    }
    const actor = bestShipActorBonus(ship, cardKey, 'str', units);
    if (!actor) { addError('No crew or hero is manning the hull.'); return; }
    const cardUse = beginCardUse(ship, cardKey, turnNumber, shipStep, shipMode, approvedNegative);
    if (!cardUse) { addError('No card steps left on that card this turn.'); return; }
    const build = snapshot.build;
    const boxState = { ...(ship.boxState ?? {}) };
    const damaged = shipDamagedCards(build, boxState);
    if (damaged.length > 0 && !targetCardKey) {
      addError('Choose a damaged card to restore one ton.');
      return;
    }
    if (targetCardKey && !damaged.some(card => card.key === targetCardKey)) {
      addError('That card has no damaged ton to repair.');
      return;
    }
    const damageTarget = targetCardKey ?? null;
    const commandBonus = damageTarget
      ? cardCommandBonus(ship.cardState, cardKey, turnNumber)
      : undefined;
    const commandNote = commandBonus != null
      ? ` (command ${commandBonus > 0 ? '+' : ''}${commandBonus})`
      : '';
    const componentRoll = damageTarget ? 1 + Math.floor(Math.random() * 20) : null;
    const componentTotal = componentRoll != null
      ? componentRoll + actor.bonus + (commandBonus ?? 0)
      : null;
    const componentSuccess = componentRoll == null || (componentTotal ?? 0) >= 15;
    const nextBox = damageTarget && componentSuccess ? repairOneBox(boxState, damageTarget) : boxState;
    const boxRestored = !!damageTarget && componentSuccess;

    const hpRoll = rollDamageDetailed('4d8', Math.random);
    const cap = repairHpCap(ship.shipHpMax || 0);
    const amount = hpRoll.total + actor.bonus;
    const newHp = Math.min(cap, (ship.shipHp || 0) + amount);
    const hpGain = Math.max(0, newHp - (ship.shipHp || 0));
    if (hpGain <= 0 && !boxRestored) { addError('Nothing to repair.'); return; }

    const nextManifest = consumeCargoQuantity(manifest, 'ship_repair_kit', 1);
    const manifestMass = cargoManifestMass(nextManifest);
    const nextBuild = {
      ...build,
      manifest: nextManifest,
      performanceMass: Math.max(1, build.totalMass - computeCargoCapacity(build) + manifestMass),
    };
    const nextSnapshot = {
      ...snapshot,
      template: { ...snapshot.template, manifest: nextManifest },
      build: nextBuild,
      stats: computeShipBuild(nextBuild),
    };
    const restoredName = damageTarget
      ? shipHitCards(build).find(card => card.key === damageTarget)?.name ?? 'equipment'
      : null;
    const detail = [
      hpGain > 0 ? `+${hpGain} HP` : null,
      boxRestored ? `restored 1 ton of ${restoredName}` : null,
      damageTarget && !componentSuccess ? 'component repair check failed' : null,
    ].filter(Boolean).join(' and ');
    const summary = `${shipDisplayName(ship)}: Repair — ${detail} (-1 repair kit)`;
    const hpDice = hpRoll.faces.length > 0
      ? `{4d8: ${hpRoll.faces.join(',')}} ${signedBonus(actor.bonus)}`
      : signedBonus(actor.bonus);
    const verboseParts = [`${shipDisplayName(ship)} repaired +${hpGain} HP ${hpDice}`];
    if (damageTarget && componentRoll != null) {
      verboseParts.push(
        `component repair check ${formatShipCheckDetail([componentRoll], actor.bonus + (commandBonus ?? 0), 15)}${commandNote} ${componentSuccess
          ? `restored 1 ton of ${restoredName}`
          : 'component repair check failed'}`,
      );
    }
    const verbose = `${verboseParts.join(' and ')} (-1 repair kit)`;
    const nextCardState = commandBonus != null
      ? clearCardCommandBonus(cardUse.next, cardKey, turnNumber)
      : cardUse.next;
    const subSteps: SubStep[] = [{
      type: 'SHIP',
      unitId: ship.id,
      description: summary,
      changes: [
        { field: 'shipHp', from: ship.shipHp, to: newHp },
        { field: 'boxState', from: ship.boxState ?? {}, to: nextBox },
        { field: 'snapshot', from: snapshot, to: nextSnapshot },
        { field: 'loadedCargo', from: ship.loadedCargo ?? 0, to: manifestMass },
        ...(cardUse.spent || commandBonus != null
          ? [{ field: 'cardState', from: ship.cardState ?? {}, to: nextCardState }]
          : []),
      ],
    }];
    // No hero on the hull card: the captain (or helmsman when no captain
    // exists) pays the action instead.
    const payers = shipCardFunctionHeroes(ship, units, cardKey);
    if (!approvedNegative) {
      for (const hero of payers) {
        subSteps.push({
          type: 'OTHER_ACTION',
          unitId: hero.id,
          description: `${hero.unitName} spent an action repairing ${shipDisplayName(ship)}`,
          changes: [{ field: 'actionsAvailable', from: hero.actionsAvailable, to: hero.actionsAvailable - 1 }],
        });
      }
    }
    await execute('SHIP', subSteps, summary, { verboseMessage: verbose });
    if (approvedNegative) await logNegativeActions(summary, payers);
  }, [shipRuntime, units, myTeam, effectiveIsGM, shipStep, turnNumber, shipMode, execute, addError, logNegativeActions]);

  /**
   * Intelligence captaincy: the captain (a hero on a fully crewed Bridge) awards
   * a pending `Int + PB - 5` bonus to one card. It costs one Bridge card step
   * (5 per turn in atmosphere, one per step in wildspace) and one captain action.
   * The bonus may be negative and applies to that card's next d20 card roll.
   */
  const handleAwardCommandBonus = useCallback(async (shipId: string, targetCardKey: string, approvedNegative = false) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const snapshot = ship?.snapshot;
    if (!ship || !snapshot) return;
    const captain = shipCaptainHero(ship, units);
    if (!captain || !captain.shipStationKey) {
      addError('Only a captain on a fully crewed Command bridge can award a command bonus.');
      return;
    }
    if (!effectiveIsGM && (!myTeam || captain.team !== myTeam)) {
      addError('Only the captain’s player or the DM can award a command bonus.');
      return;
    }
    if (targetCardKey === captain.shipStationKey) {
      addError('The captain cannot award a bonus to the bridge card itself.');
      return;
    }
    if (cardCommandBonus(ship.cardState, targetCardKey, turnNumber) !== undefined) {
      addError('That card already has a pending command bonus.');
      return;
    }
    if (!approvedNegative && (captain.actionsAvailable ?? 0) < 1) {
      addError('The captain has no action available to award a command bonus.');
      return;
    }
    const cardUse = beginCardUse(ship, captain.shipStationKey, turnNumber, shipStep, shipMode, approvedNegative);
    if (!cardUse) { addError('No Bridge card steps left this turn.'); return; }
    const bonus = captaincyBonus(captain);
    const nextCardState = setCardCommandBonus(
      cardUse.next,
      targetCardKey,
      turnNumber,
      shipStep,
      bonus,
    );
    const targetLabel = shipStationLabel(ship, targetCardKey);
    const text = `${shipDisplayName(ship)}: command bonus ${bonus > 0 ? '+' : ''}${bonus} awarded to ${targetLabel}`;
    const subSteps: SubStep[] = [{
      type: 'SHIP',
      unitId: ship.id,
      description: text,
      changes: [{ field: 'cardState', from: ship.cardState ?? {}, to: nextCardState }],
    }];
    if (!approvedNegative) {
      subSteps.push({
        type: 'OTHER_ACTION',
        unitId: captain.id,
        description: `${captain.unitName} spent an action awarding a command bonus`,
        changes: [{ field: 'actionsAvailable', from: captain.actionsAvailable, to: captain.actionsAvailable - 1 }],
      });
    }
    await execute('SHIP', subSteps, text, { message: text });
    if (approvedNegative) await logNegativeActions(text, [captain]);
  }, [shipRuntime, units, effectiveIsGM, myTeam, turnNumber, shipStep, shipMode, execute, addError, logNegativeActions]);

  const applyCrewAdjust = useCallback(async (
    shipId: string,
    args: { ids: string[]; draft: CrewDraft; count: number },
  ) => {
    if (!effectiveIsGM) { addError('Only the DM can edit the crew roster.'); return; }
    const ship = shipRuntime.find(s => s.id === shipId);
    const snapshot = ship?.snapshot;
    if (!ship || !snapshot) return;
    const templateCrews = [...(snapshot.template.crews ?? [])];
    const group = new Set(args.ids);
    const kept = templateCrews.filter(c => group.has(c.id));
    const others = templateCrews.filter(c => !group.has(c.id));
    const targetCount = Math.max(0, Math.floor(args.count));
    const makeCrew = (base?: { id?: string; name?: string | null }) => ({
      id: base?.id ?? crypto.randomUUID(),
      name: (args.draft.name.trim() || base?.name || `Crew Level ${args.draft.level}`),
      level: args.draft.level,
      hp: args.draft.hp,
      str: args.draft.str,
      dex: args.draft.dex,
      con: args.draft.con,
      int: args.draft.int,
      wis: args.draft.wis,
      cha: args.draft.cha,
      cost: args.draft.cost,
    });
    const updated = kept.slice(0, targetCount).map(c => makeCrew(c));
    const added = Array.from({ length: Math.max(0, targetCount - kept.length) }, () => makeCrew());
    const removedIds = kept.slice(targetCount).map(c => c.id);
    const nextCrews = [...others, ...updated, ...added];
    const nextCrewState = { ...(ship.crewState ?? {}) };
    for (const c of [...updated, ...added]) nextCrewState[c.id] = { ...(nextCrewState[c.id] ?? {}), hp: c.hp };
    for (const id of removedIds) delete nextCrewState[id];
    const nextStations: Record<string, any> = { ...(ship.stations ?? {}) };
    for (const [key, entry] of Object.entries(nextStations)) {
      const crewIds = (entry?.crewIds ?? []).filter((id: string) => !removedIds.includes(id));
      nextStations[key] = { ...entry, crewIds };
    }
    const build = { ...snapshot.build, crews: nextCrews };
    const nextSnapshot = {
      ...snapshot,
      template: { ...snapshot.template, crews: nextCrews },
      build,
      stats: computeShipBuild(build),
    };
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)} crew roster adjusted`,
      changes: [
        { field: 'snapshot', from: snapshot, to: nextSnapshot },
        { field: 'crewState', from: ship.crewState ?? {}, to: nextCrewState },
        { field: 'stations', from: ship.stations ?? {}, to: nextStations },
      ],
    }], `${shipDisplayName(ship)} crew roster adjusted`, { localOnly: true });
  }, [shipRuntime, effectiveIsGM, execute, addError]);

  const handleReviveCrew = useCallback(async (shipId: string, crewIds: string[], hp: number) => {
    if (!effectiveIsGM) { addError('Only the DM can revive crew.'); return; }
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    const nextCrewState = { ...(ship.crewState ?? {}) };
    for (const crewId of crewIds) {
      const crew = ship.snapshot?.template?.crews?.find(c => c.id === crewId);
      const nextHp = Math.max(1, Math.min(crew?.hp ?? 1, Math.floor(hp)));
      nextCrewState[crewId] = { ...(nextCrewState[crewId] ?? {}), dead: false, hp: nextHp };
    }
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `Crew revived`,
      changes: [{ field: 'crewState', from: ship.crewState ?? {}, to: nextCrewState }],
    }], `Crew revived on ${shipDisplayName(ship)}`, { localOnly: true });
  }, [shipRuntime, effectiveIsGM, execute, addError]);

  const handleDiscardCrew = useCallback(async (shipId: string, crewIds: string[]) => {
    if (!effectiveIsGM) { addError('Only the DM can discard crew.'); return; }
    const ship = shipRuntime.find(s => s.id === shipId);
    const snapshot = ship?.snapshot;
    if (!ship || !snapshot) return;
    const discarding = new Set(crewIds);
    const nextCrews = (snapshot.template.crews ?? []).filter(c => !discarding.has(c.id));
    const nextCrewState = { ...(ship.crewState ?? {}) };
    for (const crewId of Array.from(discarding)) delete nextCrewState[crewId];
    const nextStations: Record<string, any> = { ...(ship.stations ?? {}) };
    for (const [key, entry] of Object.entries(nextStations)) {
      nextStations[key] = {
        ...entry,
        crewIds: (entry?.crewIds ?? []).filter((id: string) => !discarding.has(id)),
      };
    }
    const build = { ...snapshot.build, crews: nextCrews };
    const nextSnapshot = {
      ...snapshot,
      template: { ...snapshot.template, crews: nextCrews },
      build,
      stats: computeShipBuild(build),
    };
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `Crew discarded`,
      changes: [
        { field: 'snapshot', from: snapshot, to: nextSnapshot },
        { field: 'crewState', from: ship.crewState ?? {}, to: nextCrewState },
        { field: 'stations', from: ship.stations ?? {}, to: nextStations },
      ],
    }], `Crew discarded from ${shipDisplayName(ship)}`, { localOnly: true });
  }, [shipRuntime, effectiveIsGM, execute, addError]);

  const handleAutoAssignCrew = useCallback(async (shipId: string, enabledKeys: string[]) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const build = ship?.snapshot?.build;
    if (!ship || !build) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards) {
      addError('Only the captain, a helmsman (when no captain exists), or the DM can manage crew.');
      return;
    }
    const nextCrewState = { ...(ship.crewState ?? {}) };
    const nextStations: Record<string, any> = {};
    for (const [key, entry] of Object.entries(ship.stations ?? {})) {
      nextStations[key] = { ...entry, crewIds: [...(entry.crewIds ?? [])] };
    }
    const assigned = new Set<string>();
    for (const entry of Object.values(nextStations)) {
      for (const id of entry.crewIds ?? []) assigned.add(id);
    }
    for (const [id, state] of Object.entries(nextCrewState)) {
      if (state.station) assigned.add(id);
    }
    const templateCrews = ship.snapshot?.template?.crews ?? [];
    const templateById = new Map(templateCrews.map(c => [c.id, c]));
    const reserve = templateCrews
      .filter(c => !nextCrewState[c.id]?.dead && !assigned.has(c.id));
    const enabled = new Set(enabledKeys);
    const cards = shipStationCards(build, { boxState: ship.boxState })
      .filter(card => !shipCardDestroyed(ship, card.key));

    const takeBest = (stats: ShipCheckStat[]): string | null => {
      let bestIdx = -1;
      let bestBonus = -Infinity;
      for (let i = 0; i < reserve.length; i += 1) {
        const bonus = bestCheckBonus(reserve[i], stats, true);
        if (bonus > bestBonus) { bestBonus = bonus; bestIdx = i; }
      }
      if (bestIdx < 0) return null;
      return reserve.splice(bestIdx, 1)[0].id;
    };
    const presentOn = (key: string): number => {
      const entry = nextStations[key];
      const heroes = new Set([...(entry?.heroIds ?? []), ...(entry?.heroId ? [entry.heroId] : [])]);
      return (entry?.crewIds?.length ?? 0) + heroes.size;
    };
    const fillCard = (card: { key: string; crewRequired: number }, stats: ShipCheckStat[], maxSlots = Infinity): number => {
      const empty = Math.max(0, card.crewRequired - presentOn(card.key));
      const take = Math.min(empty, maxSlots, reserve.length);
      if (take <= 0) return 0;
      const entry = nextStations[card.key] ?? {};
      const crewIds = [...(entry.crewIds ?? [])];
      for (let i = 0; i < take; i += 1) {
        const id = takeBest(stats);
        if (!id) break;
        crewIds.push(id);
        nextCrewState[id] = { ...(nextCrewState[id] ?? { hp: templateById.get(id)?.hp ?? 1 }), station: card.key };
      }
      nextStations[card.key] = { ...entry, crewIds };
      return take;
    };
    const fillKinds = (kind: string, stats: ShipCheckStat[]) => {
      for (const card of cards) {
        if (card.kind === kind && enabled.has(card.key)) fillCard(card, stats);
      }
    };

    fillKinds('helm', ['wis', 'int']);
    fillKinds('bridge', ['int']);

    // Sail + rudder share one crew pool: one crew mans 4 sails or 2 rudders.
    // Fill up to the combined requirement, preferring an empty side, then rudder.
    const sailCards = cards.filter(card =>
      card.kind === 'sail' && enabled.has(card.key) && card.crewRequired > 0);
    const rudderCards = cards.filter(card =>
      card.kind === 'rudder' && enabled.has(card.key) && card.crewRequired > 0);
    const surviving = survivingSailRudder(build, ship.boxState);
    const sailNeed = surviving.sails > 0 ? Math.max(1, Math.ceil(surviving.sails / 4)) : 0;
    const rudderNeed = surviving.rudders > 0 ? Math.max(1, Math.ceil(surviving.rudders / 2)) : 0;
    const combinedNeed = (surviving.sails > 0 || surviving.rudders > 0)
      ? Math.max(1, Math.ceil((surviving.sails + surviving.rudders * 2) / 4))
      : 0;
    let presentSail = sailCards.reduce((sum, card) => sum + presentOn(card.key), 0);
    let presentRudder = rudderCards.reduce((sum, card) => sum + presentOn(card.key), 0);
    let remaining = Math.max(0, combinedNeed - presentSail - presentRudder);

    const addOne = (card: { key: string; kind: string }): boolean => {
      if (presentOn(card.key) >= (cards.find(c => c.key === card.key)?.crewRequired ?? 0)) return false;
      const id = takeBest(shipStationStats(card.kind as Parameters<typeof shipStationStats>[0]));
      if (!id) return false;
      const entry = nextStations[card.key] ?? {};
      nextStations[card.key] = { ...entry, crewIds: [...(entry.crewIds ?? []), id] };
      nextCrewState[id] = { ...(nextCrewState[id] ?? { hp: templateById.get(id)?.hp ?? 1 }), station: card.key };
      return true;
    };

    while (remaining > 0) {
      const sailEmpty = presentSail === 0;
      const rudderEmpty = presentRudder === 0;
      let card = (sailEmpty && sailNeed > 0)
        ? sailCards.find(c => presentOn(c.key) < c.crewRequired)
        : undefined;
      if (!card && rudderEmpty && rudderNeed > 0) {
        card = rudderCards.find(c => presentOn(c.key) < c.crewRequired);
      }
      if (!card) card = rudderCards.find(c => presentOn(c.key) < c.crewRequired);
      if (!card) card = sailCards.find(c => presentOn(c.key) < c.crewRequired);
      if (!card || !addOne(card)) break;
      if (card.kind === 'sail') presentSail += 1;
      else presentRudder += 1;
      remaining -= 1;
    }

    // Left-side guns first: if the target is off the port side and crew are
    // short, manning the port battery lets those guns bear while the starboard
    // battery stays uncrewed. Then the best gunner goes to each enabled weapon's
    // first slot before any second slots, so every manned weapon can use its
    // best-crew check.
    const regionRank: Record<string, number> = { port: 0, bow: 1, body: 2, stern: 3, starboard: 4 };
    const weapons = cards
      .filter(card => card.kind === 'weapon' && enabled.has(card.key))
      .sort((a, b) => (regionRank[a.region ?? ''] ?? 99) - (regionRank[b.region ?? ''] ?? 99));
    for (const card of weapons) fillCard(card, ['dex'], 1);
    for (const card of weapons) fillCard(card, ['dex']);
    // Any remaining enabled vacancies outside the shared sail/rudder pool.
    for (const card of cards) {
      if (card.kind === 'sail' || card.kind === 'rudder') continue;
      if (enabled.has(card.key)) fillCard(card, shipStationStats(card.kind));
    }

    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)}: auto-assigned crew`,
      changes: [
        { field: 'crewState', from: ship.crewState ?? {}, to: nextCrewState },
        { field: 'stations', from: ship.stations ?? {}, to: nextStations },
      ],
    }], `${shipDisplayName(ship)}: auto-assigned crew`);
  }, [shipRuntime, units, myTeam, effectiveIsGM, execute, addError]);

  const handleClearCrew = useCallback(async (shipId: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards) {
      addError('Only the captain, a helmsman (when no captain exists), or the DM can manage crew.');
      return;
    }
    const nextStations: Record<string, any> = {};
    for (const [key, entry] of Object.entries(ship.stations ?? {})) {
      nextStations[key] = { ...entry, crewIds: [] };
    }
    const nextCrewState = { ...(ship.crewState ?? {}) };
    for (const id of Object.keys(nextCrewState)) {
      nextCrewState[id] = { ...(nextCrewState[id] ?? {}), station: null };
    }
    for (const crew of ship.snapshot?.template?.crews ?? []) {
      nextCrewState[crew.id] = { ...(nextCrewState[crew.id] ?? { hp: crew.hp }), station: null };
    }
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)}: crew cleared from stations`,
      changes: [
        { field: 'crewState', from: ship.crewState ?? {}, to: nextCrewState },
        { field: 'stations', from: ship.stations ?? {}, to: nextStations },
      ],
    }], `${shipDisplayName(ship)}: crew cleared from stations`);
  }, [shipRuntime, units, myTeam, effectiveIsGM, execute, addError]);

  const [shipFireMode, setShipFireMode] = useState<{ shipId: string; cardKey: string; approvedNegative: boolean } | null>(null);
  const [shipRamMode, setShipRamMode] = useState<{ shipId: string; cardKey: string } | null>(null);

  const beginShipRam = useCallback((shipId: string, cardKey: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    if (!ship?.hex || !ship.snapshot) return;
    if (!canControlShip(ship, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance)) {
      addError('Only the shipâ€™s helmsman or controller can ram.');
      return;
    }
    if (!bestHelmActorBonus(ship, units)) {
      addError('No crew or hero is manning the helm.');
      return;
    }
    const payer = shipCommandHero(ship, units);
    if (!payer || (payer.actionsAvailable ?? 0) < 1) {
      addError('No helm or bridge hero has an action available to ram.');
      return;
    }
    const cardUse = beginCardUse(ship, cardKey, turnNumber, shipStep, shipMode, false);
    if (!cardUse) { addError('No card steps left on that card this turn.'); return; }
    if (!hasHostileRamTarget(ship, shipRuntime, units, alliances)) {
      addError('No hostile ship in the two forward hexes.');
      return;
    }
    setShipFireMode(null);
    setShipRamMode({ shipId, cardKey });
    addMessage(`Select a hostile ship in ${shipDisplayName(ship)}'s forward hexes to ram.`);
  }, [shipRuntime, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance, turnNumber, shipStep, shipMode, addError, addMessage]);

  const resolveShipRam = useCallback(async (shipId: string, cardKey: string, targetShipId: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const target = shipRuntime.find(s => s.id === targetShipId && !s.isDeleted);
    setShipRamMode(null);
    if (!ship?.hex || !ship.snapshot || !target?.hex) return;
    if (!canControlShip(ship, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance)) {
      addError('Only the shipâ€™s helmsman or controller can ram.');
      return;
    }
    if (!isHostileRamTarget(ship, target, units, alliances)) {
      addError('That ship is not a hostile target in the two forward hexes.');
      return;
    }
    const actor = bestHelmActorBonus(ship, units);
    if (!actor) { addError('No crew or hero is manning the helm.'); return; }
    const payer = shipCommandHero(ship, units);
    if (!payer || (payer.actionsAvailable ?? 0) < 1) {
      addError('No helm or bridge hero has an action available to ram.');
      return;
    }
    const cardUse = beginCardUse(ship, cardKey, turnNumber, shipStep, shipMode, false);
    if (!cardUse) { addError('No card steps left on that card this turn.'); return; }
    const targetHelm = shipFunctionalCardKeys(target, 'Helm')
      .map(key => bestShipActorBonus(target, key, ['wis', 'int'], units))
      .filter((v): v is { bonus: number; name: string } => !!v)
      .sort((a, b) => b.bonus - a.bonus)[0];
    const dc = (targetHelm?.bonus ?? 0) + 8;
    const commandBonus = cardCommandBonus(ship.cardState, cardKey, turnNumber);
    const commandNote = commandBonus != null
      ? ` (command ${commandBonus > 0 ? '+' : ''}${commandBonus})`
      : '';
    const nextCardState = commandBonus != null
      ? clearCardCommandBonus(cardUse.next, cardKey, turnNumber)
      : cardUse.next;
    const roll = 1 + Math.floor(Math.random() * 20);
    const total = roll + actor.bonus + (commandBonus ?? 0);
    const hit = total >= dc;
    const dir = facingToward(ship.hex, target.hex!);
    const attackerStats = effectiveShipStats(ship, units);
    const attackerMass = attackerStats?.performanceMass ?? ship.snapshot.stats?.performanceMass ?? ship.snapshot.stats?.totalMass ?? 0;
    const ramDice = ramDamageDice(attackerMass, ship.turnsSinceFacing ?? 0);
    const ramRoll = rollDamageDetailed(ramDice.dice, Math.random);
    const baseRoll = ramRoll.total;
    const ramComponent = ship.snapshot.build.components.find(c => c.isRam);
    const hasRam = !!ramComponent;
    const piercing = !!ramComponent && /piercing/i.test(ramComponent.name);
    const targetDamage = hasRam ? baseRoll : Math.floor(baseRoll / 2);
    const selfDamage = Math.floor(baseRoll / 2);

    const applyShipDamage = (victim: ShipRuntime, amount: number) => {
      const boxState = { ...(victim.boxState ?? {}) };
      const cards = victim.snapshot?.build
        ? shipHitCards(victim.snapshot.build)
            .map(c => ({ ...c, tons: Math.max(0, c.tons - Number(boxState[c.key] ?? 0)) }))
            .filter(c => c.tons > 0)
        : [];
      const card = pickShipComponent(cards);
      let destroyedKey: string | null = null;
      if (card) {
        boxState[card.key] = Number(boxState[card.key] ?? 0) + 1;
        if (card.tons <= 1) destroyedKey = card.key;
      }
      const hp = shipHullDestroyed(victim.snapshot, boxState)
        ? 0
        : Math.max(0, (victim.shipHp || 0) - amount);
      return { boxState, hp, destroyedKey };
    };

    const clearDestroyed = (victim: ShipRuntime, destroyedKey: string | null) => {
      if (!destroyedKey) return;
      const nextStations = { ...(victim.stations ?? {}) };
      const nextCrewState = { ...(victim.crewState ?? {}) };
      const heroSteps = clearDestroyedCardOccupants(
        victim,
        destroyedKey,
        units,
        nextStations,
        nextCrewState,
      );
      subSteps.push({
        type: 'SHIP',
        unitId: victim.id,
        description: `${shipDisplayName(victim)}: destroyed station cleared`,
        changes: [
          { field: 'crewState', from: victim.crewState ?? {}, to: nextCrewState },
          { field: 'stations', from: victim.stations ?? {}, to: nextStations },
        ],
      });
      subSteps.push(...heroSteps);
    };

    const subSteps: SubStep[] = [{
      type: 'OTHER_ACTION',
      unitId: payer.id,
      description: `${payer.unitName} spent an action ramming`,
      changes: [{ field: 'actionsAvailable', from: payer.actionsAvailable, to: payer.actionsAvailable - 1 }],
    }];
    if (hit) {
      const t = applyShipDamage(target, targetDamage);
      const a = applyShipDamage(ship, selfDamage);
      clearDestroyed(target, t.destroyedKey);
      clearDestroyed(ship, a.destroyedKey);
      const dest = (h: Hex) => {
        const dirHex = HEX_DIRS[dir];
        return { q: h.q + dirHex.q, r: h.r + dirHex.r, s: -h.q - dirHex.q - h.r - dirHex.r };
      };
      const occupied = new Set(shipRuntime.filter(s => s.id !== ship.id && s.id !== target.id && s.hex).map(s => `${s.hex!.q},${s.hex!.r}`));
      const targetDest = dest(target.hex!);
      const attackerDest = dest(ship.hex);
      const targetShift = !occupied.has(`${targetDest.q},${targetDest.r}`);
      const attackerShift = piercing && !occupied.has(`${attackerDest.q},${attackerDest.r}`);
      const tStats = target.snapshot?.stats;
      const stoppedChanges: { field: string; from: unknown; to: unknown }[] = shipMode === 'wildspace'
        ? [
            { field: 'declaredSpeed', from: target.declaredSpeed, to: 0 },
            { field: 'lastSpeed', from: target.lastSpeed, to: 0 },
            { field: 'stepBudget', from: target.stepBudget ?? [0, 0, 0, 0, 0], to: [0, 0, 0, 0, 0] },
          ]
        : [
            {
              field: 'speedSpent',
              from: target.speedSpent ?? 0,
              to: Math.max(target.speedSpent ?? 0, tStats?.atmosphericSpeed ?? 0),
            },
          ];
      subSteps.push({
        type: 'SHIP', unitId: target.id, description: `${target.name} rammed for ${targetDamage}`,
        changes: [
          { field: 'shipHp', from: target.shipHp, to: t.hp },
          {
            field: 'minHpAttained',
            from: target.minHpAttained,
            to: minHpAfterDamage(target.minHpAttained, t.hp),
          },
          { field: 'boxState', from: target.boxState ?? {}, to: t.boxState },
          ...stoppedChanges,
          ...(targetShift ? [{ field: 'hex', from: target.hex, to: targetDest }] : []),
        ],
      });
      subSteps.push({
        type: 'SHIP', unitId: ship.id, description: `${shipDisplayName(ship)} ram damage ${selfDamage}`,
        changes: [
          { field: 'shipHp', from: ship.shipHp, to: a.hp },
          {
            field: 'minHpAttained',
            from: ship.minHpAttained,
            to: minHpAfterDamage(ship.minHpAttained, a.hp),
          },
          { field: 'boxState', from: ship.boxState ?? {}, to: a.boxState },
          { field: 'speedSpent', from: ship.speedSpent ?? 0, to: (ship.stepBudget ?? [])[shipStep - 1] ?? 0 },
          ...(cardUse.spent || commandBonus != null
            ? [{ field: 'cardState', from: ship.cardState ?? {}, to: nextCardState }]
            : []),
          ...(attackerShift ? [{ field: 'hex', from: ship.hex, to: attackerDest }] : []),
        ],
      });
    } else {
      subSteps.push({
        type: 'SHIP', unitId: ship.id, description: `${shipDisplayName(ship)} ram missed`,
        changes: [
          ...(cardUse.spent || commandBonus != null
            ? [{ field: 'cardState', from: ship.cardState ?? {}, to: nextCardState }]
            : []),
        ],
      });
    }
    const ramText = hit
      ? `${shipDisplayName(ship)} rammed ${shipDisplayName(target)} for ${targetDamage}, self ${selfDamage}`
      : `${shipDisplayName(ship)} ram missed ${shipDisplayName(target)}`;
    const ramVerbose = `${shipDisplayName(ship)} ram ${hit ? 'hit' : 'missed'} ${shipDisplayName(target)}: ram contest ${formatShipCheckDetail([roll], actor.bonus + (commandBonus ?? 0), dc)}${commandNote}${hit ? `; ${ramDice.dice}: ${ramRoll.faces.join(',')} = ${baseRoll}; target ${targetDamage}, self ${selfDamage}` : ''}`;
    await execute('ATTACK', subSteps, `${shipDisplayName(ship)} ram`, { message: ramText, verboseMessage: ramVerbose });
  }, [shipRuntime, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance, execute, addError, turnNumber, shipStep, shipMode]);

  const tryShipRam = useCallback((hex: Hex): boolean => {
    if (!shipRamMode) return false;
    const target = shipRuntime.find(s =>
      s.id !== shipRamMode.shipId && !s.isDeleted && s.hex &&
      s.hex.q === hex.q && s.hex.r === hex.r,
    );
    if (!target) {
      addError('No ship in that hex to ram.');
      setShipRamMode(null);
      return true;
    }
    void resolveShipRam(shipRamMode.shipId, shipRamMode.cardKey, target.id);
    return true;
  }, [shipRamMode, shipRuntime, resolveShipRam, addError]);

  const shipWindow = shipWindowId ? shipRuntime.find(s => s.id === shipWindowId && !s.isDeleted) ?? null : null;
  const activeDryDockShip = shipRuntime.find(s => s.dryDockOpen && !!s.campaignId && !s.isDeleted) ?? null;
  // No local hide state: the window stays open while the session is active.
  const dryDockShip = activeDryDockShip;
  const dryDockCampaign = dryDockShip
    ? campaignStore.ships.find(p => p.id === dryDockShip.campaignId) ?? null
    : null;
  // The DM owns the dry dock: take the editor lease automatically when it is free.
  const dryDockCampaignId = dryDockCampaign?.id ?? null;
  const dryDockEditorId = dryDockCampaign?.editorUserId ?? null;
  const acquireCampaignEditor = campaignStore.acquireEditor;
  useEffect(() => {
    if (!effectiveIsGM || !dryDockCampaignId || dryDockEditorId) return;
    void acquireCampaignEditor(dryDockCampaignId);
  }, [effectiveIsGM, dryDockCampaignId, dryDockEditorId, acquireCampaignEditor]);
  const shipWindowReadOnly = inReplay || controlsLocked;
  const shipWindowAccess: ShipViewerAccess | null = shipWindow
    ? shipViewerAccess(shipWindow, units, myTeam, effectiveIsGM)
    : null;
  const shipWindowCanManageCrew = !!shipWindowAccess?.manageAllCards;
  // Intelligence captaincy: only the captain's player (or the DM) may award.
  const shipCommandCaptain = shipWindow ? shipCaptainHero(shipWindow, units) : null;
  const shipCommandBonusValue = shipCommandCaptain
    ? captaincyBonus(shipCommandCaptain)
    : 0;
  const shipCanAwardCommandBonus = !!shipWindow && !shipWindowReadOnly && !!shipCommandCaptain
    && (effectiveIsGM || (!!myTeam && shipCommandCaptain.team === myTeam));
  // Weapon buttons disable outside the viewer's alliance turn; handlers below
  // still enforce the paying actor's side.
  const shipWeaponActionsAllowed = effectiveIsGM || currentTurnAlliance === null
    || (!!myTeam && allianceOf(myTeam, alliances) === currentTurnAlliance);
  const shipCanRam = !!shipWindow && !controlsLocked
    && canControlShip(shipWindow, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance);
  const shipRamTargetAvailable = !!shipWindow
    && hasHostileRamTarget(shipWindow, shipRuntime, units, alliances);
  const shipCanEditSpeed = !!shipWindow && !shipWindowReadOnly && shipMode === 'wildspace'
    && canControlShip(shipWindow, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance);

  // Step-1 speed declaration. Helm hero -> same-alliance Bridge hero -> DM.
  // Ships have no intrinsic alliance; the helm occupant defines the owner.
  const [speedPanelShipId, setSpeedPanelShipId] = useState<string | null>(null);
  const [speedPanelPinned, setSpeedPanelPinned] = useState(false);
  const [speedDismissedKey, setSpeedDismissedKey] = useState<string | null>(null);
  useEffect(() => {
    if (speedPanelPinned) {
      const pinned = speedPanelShipId
        ? shipRuntime.find(s => s.id === speedPanelShipId && !s.isDeleted)
        : null;
      if (!pinned) {
        setSpeedPanelPinned(false);
        setSpeedPanelShipId(null);
      }
      return;
    }
    if (shipMode !== 'wildspace' || currentTurnAlliance === null || shipStep !== 1 || turnNumber < 1) {
      setSpeedPanelShipId(null);
      return;
    }
    const candidate = shipRuntime.find(s => {
      if (s.isDeleted || !s.hex || s.shipHp <= 0) return false;
      if (s.hidden && !effectiveIsGM) return false;
      if (shipHullDestroyed(s.snapshot, s.boxState)) return false;
      if (!shipHasPilot(s, units)) return false;
      if (s.declaredRound === turnNumber || speedDismissedKey === `${s.id}:${turnNumber}`) return false;
      return canControlShip(s, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance);
    });
    setSpeedPanelShipId(candidate?.id ?? null);
  }, [shipMode, currentTurnAlliance, shipStep, turnNumber, shipRuntime, alliances, effectiveIsGM, speedDismissedKey, units, myTeam, speedPanelPinned, speedPanelShipId]);

  const speedPanelShip = speedPanelShipId ? shipRuntime.find(s => s.id === speedPanelShipId) ?? null : null;
  const speedPanelSpent = speedPanelShip && speedPanelShip.declaredRound === turnNumber
    ? shipRoundSpent(speedPanelShip.declaredSpeed, speedPanelShip, shipStep)
    : 0;
  const openSpeedPanel = useCallback((shipId: string) => {
    setSpeedDismissedKey(null);
    setSpeedPanelPinned(true);
    setSpeedPanelShipId(shipId);
  }, []);
  const closeSpeedPanel = useCallback(() => {
    if (speedPanelShipId) setSpeedDismissedKey(`${speedPanelShipId}:${turnNumber}`);
    setSpeedPanelPinned(false);
    setSpeedPanelShipId(null);
  }, [speedPanelShipId, turnNumber]);

  // A hidden ship drops out of player interaction entirely. The DM keeps the
  // window/menu (so it can be revealed again).
  useEffect(() => {
    if (effectiveIsGM) return;
    if (shipWindowId) {
      const ship = shipRuntime.find(s => s.id === shipWindowId);
      if (!ship || ship.isDeleted || ship.hidden) setShipWindowId(null);
    }
    if (speedPanelShipId) {
      const ship = shipRuntime.find(s => s.id === speedPanelShipId);
      if (!ship || ship.isDeleted || ship.hidden) setSpeedPanelShipId(null);
    }
  }, [shipRuntime, shipWindowId, speedPanelShipId, effectiveIsGM]);

  const handleFireWeapon = useCallback((shipId: string, cardKey: string, approvedNegative = false) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const card = ship?.snapshot?.build ? shipWeaponCards(ship.snapshot.build).find(c => c.key === cardKey) : undefined;
    if (!ship || !card) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only a hero on the weapon card, the captain, a helmsman (when no captain exists), or the DM can fire this weapon.');
      return;
    }
    const reload = ship.reload?.[cardKey] ?? { progress: 0, armed: false };
    if (!reload.armed && card.weapon.reloadSteps !== 0) {
      addError('That weapon is not loaded yet.');
      return;
    }
    const cardUse = beginCardUse(ship, cardKey, turnNumber, shipStep, shipMode, approvedNegative);
    if (!cardUse) {
      addError('No card steps left on that card this turn.');
      return;
    }
    if (shipCardCrewCount(ship, units, cardKey) <= 0) {
      addError('No crew is manning that weapon.');
      return;
    }
    const payers = shipCardFunctionHeroes(ship, units, cardKey);
    if (payers.length === 0) {
      addError('No hero on the card, captain, or helmsman to fire the weapon.');
      return;
    }
    if (!canActOnShipCard(payers[0]?.team ?? myTeam, alliances, currentTurnAlliance, effectiveIsGM)) {
      addError('You can only load or fire ship weapons during your allianceâ€™s turn.');
      return;
    }
    setShipRamMode(null);
    setShipFireMode({ shipId, cardKey, approvedNegative });
    addMessage(`Select a target for ${shipDisplayName(ship)}'s ${card.weapon.name}.`);
  }, [shipRuntime, units, myTeam, effectiveIsGM, turnNumber, shipStep, shipMode, alliances, currentTurnAlliance, addMessage, addError]);

  const handleWeaponLoad = useCallback(async (shipId: string, cardKey: string, approvedNegative = false) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const build = ship?.snapshot?.build;
    if (!ship || !build) return;
    const card = shipWeaponCards(build).find(c => c.key === cardKey);
    if (!card) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only a hero on the weapon card, the captain, a helmsman (when no captain exists), or the DM can load this weapon.');
      return;
    }
    const heroes = shipHeroesOnCard(ship, units, cardKey);
    if (heroes.length === 0) {
      addError('Crew auto-load this weapon; a hero is needed to order a manual load.');
      return;
    }
    if (!canActOnShipCard(heroes[0]?.team ?? myTeam, alliances, currentTurnAlliance, effectiveIsGM)) {
      addError('You can only load or fire ship weapons during your allianceâ€™s turn.');
      return;
    }
    if (shipCardCrewCount(ship, units, cardKey) < Math.ceil(card.weapon.crew)) {
      addError('The weapon needs its full crew to load.');
      return;
    }
    const reload = ship.reload?.[cardKey] ?? { progress: 0, armed: false };
    if (reload.armed || card.weapon.reloadSteps === 0) {
      addError('That weapon is already loaded.');
      return;
    }
    const cardUse = beginCardUse(ship, cardKey, turnNumber, shipStep, shipMode, approvedNegative);
    if (!cardUse) {
      addError('No card steps left on that card this turn.');
      return;
    }
    const nextReload = manualShipWeaponLoad(reload, card.weapon.reloadSteps);
    const subSteps: SubStep[] = [{
      type: 'SHIP',
      unitId: ship.id,
      description: `${shipDisplayName(ship)} loaded ${card.weapon.name}`,
      changes: [
        { field: 'reload', from: ship.reload ?? {}, to: { ...(ship.reload ?? {}), [cardKey]: nextReload } },
        ...(cardUse.spent ? [{ field: 'cardState', from: ship.cardState ?? {}, to: cardUse.next }] : []),
      ],
    }];
    if (!approvedNegative) {
      for (const hero of heroes) {
        subSteps.push({
          type: 'OTHER_ACTION',
          unitId: hero.id,
          description: `${hero.unitName} spent an action loading ${card.weapon.name}`,
          changes: [{ field: 'actionsAvailable', from: hero.actionsAvailable, to: hero.actionsAvailable - 1 }],
        });
      }
    }
    const text = `${shipDisplayName(ship)} loaded ${card.weapon.name} (${nextReload.progress}/${card.weapon.reloadSteps}${nextReload.armed ? ', armed' : ''})`;
    await execute('SHIP', subSteps, text, { message: text });
    if (approvedNegative) await logNegativeActions(text, heroes);
  }, [shipRuntime, units, myTeam, effectiveIsGM, shipStep, turnNumber, shipMode, alliances, currentTurnAlliance, execute, addError, logNegativeActions]);

  const handleWeaponAutoLoad = useCallback(async (shipId: string, cardKey: string) => {
    const ship = shipRuntime.find(s => s.id === shipId);
    const build = ship?.snapshot?.build;
    if (!ship || !build) return;
    const card = shipWeaponCards(build).find(c => c.key === cardKey);
    if (!card) return;
    const access = shipViewerAccess(ship, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only a hero on the weapon card, the captain, a helmsman (when no captain exists), or the DM can order the crew to load.');
      return;
    }
    if (shipHeroesOnCard(ship, units, cardKey).length > 0) {
      addError('A hero is on the card; order a manual load instead.');
      return;
    }
    const actorTeam = shipCardFunctionHeroes(ship, units, cardKey)[0]?.team ?? myTeam;
    if (!canActOnShipCard(actorTeam, alliances, currentTurnAlliance, effectiveIsGM)) {
      addError('You can only load or fire ship weapons during your allianceâ€™s turn.');
      return;
    }
    if (shipMode !== 'atmosphere') {
      addError('In wildspace the crew load automatically at the start of each step.');
      return;
    }
    if (shipCardCrewCount(ship, units, cardKey) < Math.ceil(card.weapon.crew)) {
      addError('The weapon needs its full crew to load.');
      return;
    }
    const reload = ship.reload?.[cardKey] ?? { progress: 0, armed: false };
    const plan = planShipWeaponAutoLoad(reload, {
      reloadSteps: card.weapon.reloadSteps,
      mode: 'atmosphere',
      hasHero: false,
      fullCrew: true,
      cardStepsRemaining: cardStepsRemaining(ship.cardState, cardKey, turnNumber),
    });
    if (plan.loads <= 0) {
      addMessage(`${card.weapon.name} has no card steps left this turn.`);
      return;
    }
    const nextCardState = spendCardSteps(ship.cardState, cardKey, turnNumber, shipStep, shipMode, plan.loads);
    const text = `${shipDisplayName(ship)} crew loaded ${card.weapon.name} (${plan.state.progress}/${card.weapon.reloadSteps}${plan.state.armed ? ', armed' : ''})`;
    await execute('SHIP', [{
      type: 'SHIP',
      unitId: ship.id,
      description: text,
      changes: [
        { field: 'reload', from: ship.reload ?? {}, to: { ...(ship.reload ?? {}), [cardKey]: plan.state } },
        { field: 'cardState', from: ship.cardState ?? {}, to: nextCardState },
      ],
    }], text, { message: text });
  }, [shipRuntime, units, myTeam, effectiveIsGM, shipMode, turnNumber, shipStep, alliances, currentTurnAlliance, execute, addError, addMessage]);

  const resolveShipShot = useCallback(async (shipId: string, cardKey: string, targetHex: Hex, approvedNegative = false) => {
    const attacker = shipRuntime.find(s => s.id === shipId && !s.isDeleted);
    const stats = attacker ? effectiveShipStats(attacker, units) : null;
    const build = attacker?.snapshot?.build;
    if (!attacker?.hex || !stats || !build) return;
    const card = shipWeaponCards(build).find(c => c.key === cardKey);
    if (!card) return;
    const access = shipViewerAccess(attacker, units, myTeam, effectiveIsGM);
    if (!access.manageAllCards && !access.manageableCardKeys.includes(cardKey)) {
      addError('Only a hero on the weapon card, the captain, a helmsman (when no captain exists), or the DM can fire this weapon.');
      setShipFireMode(null);
      return;
    }
    const reload = attacker.reload?.[cardKey] ?? { progress: 0, armed: false };
    if (!reload.armed && card.weapon.reloadSteps !== 0) {
      addError('That weapon is not loaded yet.');
      setShipFireMode(null);
      return;
    }
    const payers = shipCardFunctionHeroes(attacker, units, cardKey);
    if (payers.length === 0) {
      addError('No hero on the card, captain, or helmsman to fire the weapon.');
      setShipFireMode(null);
      return;
    }
    const actorTeam = payers[0]?.team ?? myTeam;
    if (!canActOnShipCard(actorTeam, alliances, currentTurnAlliance, effectiveIsGM)) {
      addError('You can only load or fire ship weapons during your allianceâ€™s turn.');
      setShipFireMode(null);
      return;
    }
    const cardUse = beginCardUse(attacker, cardKey, turnNumber, shipStep, shipMode, approvedNegative);
    if (!cardUse) {
      addError('No card steps left on that card this turn.');
      setShipFireMode(null);
      return;
    }
    const targetShip = shipRuntime.find(s =>
      s.id !== shipId && !s.isDeleted && s.hex && s.hex.q === targetHex.q && s.hex.r === targetHex.r,
    );
    const targetUnit = units.find(u =>
      !u.isDeleted &&
      !u.attachedToUnitId &&
      !u.attachedToShipId &&
      u.hex.q === targetHex.q &&
      u.hex.r === targetHex.r,
    );
    if (!targetShip && !targetUnit) {
      addError('No target on that hex.');
      setShipFireMode(null);
      return;
    }
    // Weapon control is separate from ship control: hostility follows the firing
    // actor's side, while the target ship's side is its helmsman's. A DM (no
    // team) or an ownerless target is not treated as allied.
    const shooterAlliance = effectiveIsGM
      ? null
      : (actorTeam ? allianceOf(actorTeam, alliances) : null);
    const targetShipAlliance = targetShip ? shipOwnerAlliance(targetShip, units, alliances) : null;
    if (
      targetShip &&
      shooterAlliance !== null &&
      targetShipAlliance !== null &&
      shooterAlliance === targetShipAlliance
    ) {
      addError('Cannot fire on an allied ship.');
      setShipFireMode(null);
      return;
    }
    if (targetUnit && shooterAlliance !== null && allianceOf(targetUnit.team, alliances) === shooterAlliance) {
      addError('Cannot fire on an allied unit.');
      setShipFireMode(null);
      return;
    }
    const mode = shipAttackMode(
      hexDistance(attacker.hex, targetHex),
      card.weapon,
      card.arcs,
      attacker.hex,
      attacker.facing,
      targetHex,
      shipFiringArcs,
    );
    if (mode.mode === 'none') {
      addError(mode.reason);
      setShipFireMode(null);
      return;
    }
    const bonus = shipWeaponBestAttacker(attacker, cardKey, units);
    if (bonus == null) {
      addError('No PC or crew is manning that weapon.');
      setShipFireMode(null);
      return;
    }
    const commandBonus = cardCommandBonus(attacker.cardState, cardKey, turnNumber);
    const attackBonus = bonus + (commandBonus ?? 0);
    const commandNote = commandBonus != null
      ? ` (command ${commandBonus > 0 ? '+' : ''}${commandBonus})`
      : '';
    const nextCardState = commandBonus != null
      ? clearCardCommandBonus(cardUse.next, cardKey, turnNumber)
      : cardUse.next;
    // Pick the struck component before the attack roll. Card AC/DT are the
    // higher of the ship value and the catalog value, so the targeted card can
    // raise the defence (e.g. a metal-cased helm on a wooden ship).
    let targetHitCard: ReturnType<typeof pickShipComponent> = null;
    let targetBoxState: Record<string, unknown> = {};
    if (targetShip) {
      targetBoxState = { ...(targetShip.boxState ?? {}) };
      if (targetShip.snapshot?.build) {
        const cards = shipHitCards(targetShip.snapshot.build)
          .map(c => ({ ...c, tons: Math.max(0, c.tons - Number(targetBoxState[c.key] ?? 0)) }))
          .filter(c => c.tons > 0);
        targetHitCard = pickShipComponent(cards);
      }
    }
    const targetAc = targetShip
      ? Math.max(targetShip.snapshot?.stats?.ac ?? 10, targetHitCard?.ac ?? 10)
      : (targetUnit?.currentAc ?? 10);
    const targetShipDt = targetShip
      ? Math.max(targetShip.snapshot?.stats?.damageThreshold ?? 15, targetHitCard?.dt ?? 15)
      : 0;
    const firstRoll = 1 + Math.floor(Math.random() * 20);
    const secondRoll = mode.mode === 'disadvantage'
      ? 1 + Math.floor(Math.random() * 20)
      : null;
    const attackRolls = secondRoll == null ? [firstRoll] : [firstRoll, secondRoll];
    const roll = secondRoll == null ? firstRoll : Math.min(firstRoll, secondRoll);
    const hit = roll !== 1 && (roll === 20 || roll + attackBonus >= targetAc);
    const dice = resolveShipWeaponDamage(card.weapon);
    // Area ship weapons: a hit on a unit token opens the shared magic window so
    // the blast shape/rotation, affected troops and saves can be placed.
    if (targetUnit && card.weapon.magicDimension > 0 && hit) {
      magicCast.openCast({
        casterId: playerId,
        casterName: shipDisplayName(attacker),
        casterUnitId: attacker.id,
        targetUnitId: targetUnit.id,
        targetUnitName: targetUnit.unitName,
        weapon: {
          name: card.weapon.name,
          attackBonus: 0,
          damageDice: dice,
          isHealing: false,
          range: card.weapon.range,
          maxRange: card.weapon.maxRange,
          magicDimension: card.weapon.magicDimension,
          shape: card.weapon.shape,
          reach: false,
          noRetaliation: true,
          freeAction: true,
          isTwoHanded: false,
          numberOfAttacks: 1,
          onSaveHalfOrNeg: card.weapon.onSaveHalfOrNeg,
          savingThrow: card.weapon.savingThrow as SaveStat,
          saveDC: card.weapon.saveDC,
        },
        snapshot: {
          team: targetUnit.team,
          currentFormation: targetUnit.currentFormation,
          currentTroopCount: targetUnit.currentTroopCount,
          maxTroopCount: targetUnit.maxTroopCount,
          sizeCategory: targetUnit.sizeCategory,
          visualScale: targetUnit.visualScale,
          mountId: targetUnit.mountId,
          flySpeed: targetUnit.flySpeed ?? 0,
        },
        targetStats: {
          str: targetUnit.strSav ?? 0,
          dex: targetUnit.dexSav ?? 0,
          con: targetUnit.conSav ?? 0,
          int: targetUnit.intSav ?? 0,
          wis: targetUnit.wisSav ?? 0,
          cha: targetUnit.chaSav ?? 0,
        },
        maxMarkers: 1,
        shipShot: {
          shipId,
          cardKey,
          approvedNegative,
          attackRolls,
          attackBonus,
          targetAc,
          disadvantage: mode.mode === 'disadvantage',
        },
      });
      addMessage(`${shipDisplayName(attacker)} hit ${targetUnit.unitName} with ${card.weapon.name} — place the ${card.weapon.magicDimension}ft blast.`);
      setShipFireMode(null);
      return;
    }
    const damageRoll = hit ? rollDamageDetailed(dice, Math.random) : null;
    const damage = damageRoll?.total ?? 0;
    const reloadAfter = fireShipWeapon();

    const subSteps: SubStep[] = [{
      type: 'SHIP',
      unitId: attacker.id,
      description: `${shipDisplayName(attacker)} fired ${card.weapon.name}`,
      changes: [
        {
          field: 'reload',
          from: attacker.reload ?? {},
          to: { ...(attacker.reload ?? {}), [cardKey]: reloadAfter },
        },
        ...(cardUse.spent || commandBonus != null
          ? [{ field: 'cardState', from: attacker.cardState ?? {}, to: nextCardState }]
          : []),
      ],
    }];
    if (!approvedNegative) {
      for (const hero of payers) {
        subSteps.push({
          type: 'OTHER_ACTION',
          unitId: hero.id,
          description: `${hero.unitName} spent an action firing ${card.weapon.name}`,
          changes: [{ field: 'actionsAvailable', from: hero.actionsAvailable, to: hero.actionsAvailable - 1 }],
        });
      }
    }

    let shipDeflected = false;
    let damageDetails = '';
    const verboseExtra: string[] = [];
    if (hit && targetShip) {
      const penetrated = damage >= targetShipDt;
      shipDeflected = !penetrated;
      if (penetrated) {
        const nextBox = { ...targetBoxState };
        const componentTons = targetHitCard
          ? cappedComponentTons(targetHitCard.tons, damage)
          : 0;
        if (targetHitCard && componentTons > 0) {
          nextBox[targetHitCard.key] = Number(nextBox[targetHitCard.key] ?? 0) + componentTons;
        }
        const cardDestroyed = !!targetHitCard && componentTons >= targetHitCard.tons;

        // Crew targets are independent of component tons: one 1..maxTargets
        // roll, capped by the living occupants on the struck card.
        let nextCrewState = { ...(targetShip.crewState ?? {}) };
        let nextStations = { ...(targetShip.stations ?? {}) };
        const crewHitNames: string[] = [];
        const crewKills: string[] = [];
        const crewSteps: SubStep[] = [];
        let crewTargetRoll: number | null = null;
        let crewTargetAvailable = 0;
        if (targetHitCard) {
          const targets = shipCardCrewTargets(targetShip, units, targetHitCard.key);
          crewTargetAvailable = targets.length;
          if (targets.length > 0) {
            crewTargetRoll = rollMaxTargets(card.weapon.maxTargets, Math.random);
            const count = Math.min(crewTargetRoll, targets.length);
            const picked = pickDistinct(targets, count, Math.random);
          if (picked.length > 0) {
            const station = nextStations[targetHitCard.key];
            if (station) {
              nextStations[targetHitCard.key] = { ...station, crewIds: [...(station.crewIds ?? [])] };
            }
            for (const target of picked) {
              crewHitNames.push(target.name);
              if (target.kind === 'crew') {
                const hp = Math.max(0, target.hp - damage);
                nextCrewState[target.id] = {
                  ...(nextCrewState[target.id] ?? { hp: target.hp }),
                  hp,
                  dead: hp <= 0,
                  ...(hp <= 0 ? { station: null } : {}),
                };
                if (hp <= 0) {
                  crewKills.push(target.name);
                  const s = nextStations[targetHitCard.key];
                  if (s) s.crewIds = (s.crewIds ?? []).filter(id => id !== target.id);
                }
              } else {
                const hero = units.find(u => u.id === target.id);
                if (!hero) continue;
                const hp = Math.max(0, (hero.currentUnitHp ?? 1) - damage);
                if (hp <= 0) crewKills.push(target.name);
                crewSteps.push({
                  type: 'DAMAGE',
                  unitId: hero.id,
                  description: `${hero.unitName} wounded aboard ${shipDisplayName(targetShip)}`,
                  changes: [{ field: 'currentUnitHp', from: hero.currentUnitHp, to: hp }],
                });
              }
            }
          }
        }
        }

        if (cardDestroyed && targetHitCard) {
          crewSteps.push(...clearDestroyedCardOccupants(
            targetShip,
            targetHitCard.key,
            units,
            nextStations,
            nextCrewState,
          ));
        }

        // Cargo: effective capacity is the hold minus every destroyed Cargo
        // card box (cumulative across hits). Each cargo ton rolls one box from
        // the shrinking pool.
        let nextSnapshot = targetShip.snapshot;
        let nextLoadedCargo = targetShip.loadedCargo ?? 0;
        let cargoLost = '';
        let cargoDebrisChanged = false;
        let addedBarrels = 0;
        let nextGroundZones = groundZones;
        if (
          targetHitCard?.name === 'Cargo'
          && componentTons > 0
          && targetShip.snapshot?.build
        ) {
          const build = targetShip.snapshot.build;
          const manifest = normalizeCargoManifest(build.manifest ?? targetShip.snapshot.template.manifest ?? []);
          const capacity = computeCargoCapacity(build);
          const destroyedBefore = Number(targetBoxState[targetHitCard.key] ?? 0);
          const effectiveCapacity = Math.max(0, capacity - destroyedBefore);
          const boxes = packCargoBoxes(manifest, effectiveCapacity);
          const destroyedBoxes = rollDestroyedCargoBoxes(boxes, componentTons, Math.random);
          const result = removeCargoBoxes(manifest, destroyedBoxes);
          const manifestMass = cargoManifestMass(result.items);
          const nextBuild = {
            ...build,
            manifest: result.items,
            performanceMass: Math.max(1, build.totalMass - capacity + manifestMass),
          };
          nextSnapshot = {
            ...targetShip.snapshot,
            template: { ...targetShip.snapshot.template, manifest: result.items },
            build: nextBuild,
            stats: computeShipBuild(nextBuild),
          };
          nextLoadedCargo = manifestMass;
          cargoLost = cargoDamageSummary(result.destroyedItems);
          const destroyedWithCargo = result.destroyedBoxes.filter(items => items.length > 0);
          addedBarrels = destroyedWithCargo.length;
          if (targetShip.hex && result.destroyedItems.length > 0) {
            const hex = targetShip.hex;
            const existing = groundZones.filter(z =>
              z.kind === 'cargo_debris' && z.q === hex.q && z.r === hex.r);
            const merged: GroundEffect = {
              key: existing[0]?.key ?? newEffectKey(),
              q: hex.q,
              r: hex.r,
              name: 'Floating cargo barrel',
              color: '#b45309',
              kind: 'cargo_debris',
              transparentBackground: true,
              layer: 'above',
              elevation: existing[0]?.elevation ?? (targetShip.elevation ?? 0),
              zIndex: existing[0]?.zIndex ?? 50,
              duration: 0,
              turnsLeft: 0,
              permanent: true,
              cargo: mergeCargoItems([
                ...existing.flatMap(z => z.cargo ?? []),
                ...result.destroyedItems,
              ]),
              barrelCount: existing.reduce((sum, z) => sum + Math.max(1, Number(z.barrelCount ?? 1)), 0)
                + addedBarrels,
              salvageFraction: 0.5,
            };
            nextGroundZones = [
              ...groundZones.filter(z => !(z.kind === 'cargo_debris' && z.q === hex.q && z.r === hex.r)),
              merged,
            ];
            cargoDebrisChanged = true;
          }
        }

        const newHp = shipHullDestroyed(targetShip.snapshot, nextBox)
          ? 0
          : Math.max(0, targetShip.shipHp - damage);
        const changes: { field: string; from: unknown; to: unknown }[] = [
          { field: 'shipHp', from: targetShip.shipHp, to: newHp },
          {
            field: 'minHpAttained',
            from: targetShip.minHpAttained,
            to: minHpAfterDamage(targetShip.minHpAttained, newHp),
          },
          { field: 'boxState', from: targetShip.boxState ?? {}, to: nextBox },
        ];
        if (crewHitNames.length > 0 || cardDestroyed) {
          changes.push(
            { field: 'crewState', from: targetShip.crewState ?? {}, to: nextCrewState },
            { field: 'stations', from: targetShip.stations ?? {}, to: nextStations },
          );
        }
        if (nextSnapshot !== targetShip.snapshot) {
          changes.push(
            { field: 'snapshot', from: targetShip.snapshot, to: nextSnapshot },
            { field: 'loadedCargo', from: targetShip.loadedCargo ?? 0, to: nextLoadedCargo },
          );
        }
        subSteps.push({
          type: 'SHIP',
          unitId: targetShip.id,
          description: `${shipDisplayName(targetShip)} took ${damage}${targetHitCard ? ` (${targetHitCard.name})` : ''}`,
          changes,
          payload: { killerUnitId: attacker.id, victimLevel: 0 },
        });
        subSteps.push(...crewSteps);
        if (cargoDebrisChanged) {
          subSteps.push({
            type: 'ZONE',
            unitId: scenarioId,
            description: `${shipDisplayName(targetShip)}: floating cargo barrels`,
            changes: [{
              field: 'ground_effects',
              from: groundZones,
              to: nextGroundZones,
            }],
          });
        }

        const details: string[] = [];
        if (componentTons > 0 && targetHitCard) {
          details.push(`${componentTons} ${targetHitCard.name} box${componentTons === 1 ? '' : 'es'} destroyed`);
        }
        if (cardDestroyed && targetHitCard) {
          details.push(`${targetHitCard.name} card destroyed — crew and heroes removed`);
        }
        if (crewHitNames.length > 0) {
          details.push(`${crewHitNames.length} crew hit${crewKills.length > 0 ? ` (${crewKills.join(', ')} killed)` : ''}`);
        }
        if (cargoLost) details.push(`cargo lost: ${cargoLost}`);
        if (addedBarrels > 0) {
          details.push(`${addedBarrels} floating barrel${addedBarrels === 1 ? '' : 's'}`);
        }
        damageDetails = details.length > 0 ? ` — ${details.join('; ')}` : '';
        if (componentTons > 0 && targetHitCard) {
          verboseExtra.push(`${componentTons} ${targetHitCard.name} box${componentTons === 1 ? '' : 'es'} destroyed;`);
        }
        if (cardDestroyed && targetHitCard) {
          verboseExtra.push(`${targetHitCard.name} card destroyed - crew and heroes removed;`);
        }
        if (crewTargetRoll != null) {
          const hitNames = crewHitNames.length > 0 ? ` (${crewHitNames.join(', ')})` : '';
          const killed = crewKills.length > 0 ? ` ${crewKills.length} killed` : '';
          verboseExtra.push(`${formatShipMaxTargetDetail(card.weapon.maxTargets, crewTargetRoll, crewHitNames.length, crewTargetAvailable)}${hitNames}${killed}`);
        }
        if (cargoLost) verboseExtra.push(`cargo lost: ${cargoLost}`);
        if (addedBarrels > 0) {
          verboseExtra.push(`floating barrels: ${addedBarrels}`);
        }
      }
    } else if (hit && targetUnit) {
      const newHp = Math.max(0, targetUnit.currentUnitHp - damage);
      const troops = Math.ceil(newHp / Math.max(1, targetUnit.troopHp));
      subSteps.push({
        type: 'DAMAGE',
        unitId: targetUnit.id,
        description: `${targetUnit.unitName} took ${damage}`,
        changes: [
          { field: 'currentUnitHp', from: targetUnit.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: targetUnit.currentTroopCount, to: troops },
        ],
        payload: { killerUnitId: attacker.id, victimLevel: targetUnit.level },
      });
    }

    const targetName = targetShip
      ? shipDisplayName(targetShip)
      : (targetUnit?.unitName ?? 'target');
    const hitComponent = targetShip && hit
      ? ` (${targetHitCard?.name ?? 'no component'})`
      : '';
    const text = hit
      ? targetShip && shipDeflected
        ? `${shipDisplayName(attacker)} hit ${targetName} with ${card.weapon.name} for ${damage}${hitComponent} deflected, no damage`
        : `${shipDisplayName(attacker)} hit ${targetName} with ${card.weapon.name} for ${damage}${hitComponent}${damageDetails}`
      : `${shipDisplayName(attacker)} missed ${targetName} with ${card.weapon.name}`;
    const verboseHeader = hit && targetShip
      ? shipDeflected
        ? `${shipDisplayName(attacker)} hit ${targetName} with ${card.weapon.name} hit ${targetHitCard?.name ?? 'no component'} - deflected`
        : `${shipDisplayName(attacker)} hit ${targetName} with ${card.weapon.name} hit ${targetHitCard?.name ?? 'no component'}`
      : text;
    const verboseLines = [
      verboseHeader,
      formatShipAttackDetail(
        attackRolls,
        attackBonus,
        targetAc,
        mode.mode === 'disadvantage',
      ),
    ];
    if (commandBonus != null) {
      verboseLines.push(`command bonus ${commandBonus > 0 ? '+' : ''}${commandBonus}`);
    }
    if (hit && damageRoll) {
      verboseLines.push(formatShipDamageDetail(dice, damageRoll.faces, damageRoll.total));
      if (targetShip && shipDeflected) {
        verboseLines.push(`deflected by damage threshold ${targetShipDt}`);
      }
      verboseLines.push(...verboseExtra);
    } else if (!hit) {
      verboseLines.push('outcome: miss');
    }
    const verbose = verboseLines.join('\n');
    await execute('ATTACK', subSteps, text, { message: text, verboseMessage: verbose });
    if (approvedNegative) await logNegativeActions(text, payers);
    setShipFireMode(null);
  }, [shipRuntime, units, myTeam, effectiveIsGM, turnNumber, shipStep, shipMode, shipFiringArcs, alliances, currentTurnAlliance, execute, addError, logNegativeActions, groundZones, scenarioId]);

  /** Resolve a ship area window (shared magic channel) through the ship flow. */
  const resolveShipAreaCast = useCallback(async (cast: MagicCastState) => {
    const shot = cast.shipShot;
    if (!shot) return;
    const attacker = shipRuntime.find(s => s.id === shot.shipId && !s.isDeleted);
    const target = units.find(u => u.id === cast.targetUnitId && !u.isDeleted);
    const build = attacker?.snapshot?.build;
    if (!attacker || !target || !build) {
      addError('Ship or target is no longer on the map — area shot cancelled.');
      magicCast.cancelCast();
      return;
    }
    const card = shipWeaponCards(build).find(c => c.key === shot.cardKey);
    if (!card) {
      addError('That weapon card is gone — area shot cancelled.');
      magicCast.cancelCast();
      return;
    }
    const marker = cast.markers[0];
    const affected = marker?.affectedCount ?? 0;
    if (affected <= 0) {
      addError('Place the blast over at least one troop.');
      return;
    }
    const cardUse = beginCardUse(attacker, shot.cardKey, turnNumber, shipStep, shipMode, shot.approvedNegative);
    if (!cardUse) {
      addError('No card steps left on that card this turn.');
      magicCast.cancelCast();
      return;
    }
    const noSave = cast.saveStat === 'none';
    const flags = saveRollFlags(target);
    const saveMode: 'advantage' | 'disadvantage' | 'normal' = flags.advantage && !flags.disadvantage
      ? 'advantage'
      : flags.disadvantage && !flags.advantage ? 'disadvantage' : 'normal';
    const saveBonus = (noSave ? 0 : (cast.targetStats[cast.saveStat.toLowerCase() as keyof typeof cast.targetStats] ?? 0))
      + effectSaveBonus(target)
      + heroAuraBonus(target, units, alliances).save;
    const damageDice = resolveShipWeaponDamage(card.weapon);
    const result = resolveSpellDamage({
      damageDice,
      saveBonus,
      saveDC: cast.saveDC,
      halfOnSave: cast.halfOnSave,
      noSave,
      affectedCount: affected,
      troopHp: target.troopHp,
      saveMode,
      rng: Math.random,
    });
    const newHp = Math.max(0, target.currentUnitHp - result.totalDamage);
    const newTroops = Math.max(0, Math.ceil(newHp / Math.max(1, target.troopHp)));
    const troopsKilled = Math.max(0, target.currentTroopCount - newTroops);
    const payers = shipCardFunctionHeroes(attacker, units, shot.cardKey);
    const pendingBonus = cardCommandBonus(attacker.cardState, shot.cardKey, turnNumber);
    const nextCardState = pendingBonus != null
      ? clearCardCommandBonus(cardUse.next, shot.cardKey, turnNumber)
      : cardUse.next;
    const subSteps: SubStep[] = [{
      type: 'SHIP',
      unitId: attacker.id,
      description: `${shipDisplayName(attacker)} fired ${card.weapon.name}`,
      changes: [
        {
          field: 'reload',
          from: attacker.reload ?? {},
          to: { ...(attacker.reload ?? {}), [shot.cardKey]: fireShipWeapon() },
        },
        ...(cardUse.spent || pendingBonus != null
          ? [{ field: 'cardState', from: attacker.cardState ?? {}, to: nextCardState }]
          : []),
      ],
    }];
    if (!shot.approvedNegative) {
      for (const hero of payers) {
        subSteps.push({
          type: 'OTHER_ACTION',
          unitId: hero.id,
          description: `${hero.unitName} spent an action firing ${card.weapon.name}`,
          changes: [{ field: 'actionsAvailable', from: hero.actionsAvailable, to: hero.actionsAvailable - 1 }],
        });
      }
    }
    subSteps.push({
      type: 'DAMAGE',
      unitId: target.id,
      description: `${target.unitName} took ${result.totalDamage} from ${card.weapon.name}`,
      changes: [
        { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
        { field: 'currentTroopCount', from: target.currentTroopCount, to: newTroops },
      ],
      payload: { killerUnitId: attacker.id, victimLevel: target.level },
    });
    const desc = `${shipDisplayName(attacker)} hit ${target.unitName} with ${card.weapon.name} — 1 blast, ${affected} troop${affected === 1 ? '' : 's'} caught, ${result.totalDamage} damage (${troopsKilled} killed)`;
    const verbose = [
      desc,
      formatShipAttackDetail(
        shot.attackRolls,
        shot.attackBonus,
        shot.targetAc,
        shot.disadvantage,
      ),
      formatSpellRollLine(result, cast.saveDC),
    ].join('\n');
    await execute('ATTACK', subSteps, desc, { message: desc, verboseMessage: verbose });
    if (shot.approvedNegative) await logNegativeActions(desc, payers);
    magicCast.sendResolve({
      baseDamage: result.baseDamage,
      totalDamage: result.totalDamage,
      troopsKilled,
      newHp,
      savedCount: result.perTroop.filter(t => t.success).length,
      failedCount: result.perTroop.filter(t => !t.success).length,
      description: desc,
    });
  }, [shipRuntime, units, alliances, magicCast, turnNumber, shipStep, shipMode, execute, addError, logNegativeActions]);

  const tryShipFire = useCallback((hex: Hex): boolean => {
    if (!shipFireMode) return false;
    void resolveShipShot(shipFireMode.shipId, shipFireMode.cardKey, hex, shipFireMode.approvedNegative);
    return true;
  }, [shipFireMode, resolveShipShot]);

  // Player door toggle: command-logged (undo/realtime ride the STRUCTURE sub-step).
  const toggleStructureDoor = useCallback(async (key: string, open: boolean) => {
    const inst = structures[key];
    if (!inst) return;
    const t = structureTemplates[inst.templateId];
    const to = { ...inst, open };
    const label = `${t?.name ?? 'Structure'} ${open ? 'opened' : 'closed'}`;
    await execute('STRUCTURE', [{
      type: 'STRUCTURE',
      description: label,
      unitId: scenarioId,
      changes: [{ field: 'structures', key, from: inst, to }],
    }], label);
  }, [structures, structureTemplates, execute, scenarioId]);

  // ---- Structure brush (GM live edit) ----
  // Structure placement/removal/edit ride the STRUCTURE command (server merges
  // { key, from, to } into scenarios.map_data.structures), so they are undoable
  // and appear in replay. A null `to` deletes the key; null `from` places it.
  const structureCommand = useCallback(async (key: string, from: StructureInstance | null, to: StructureInstance | null, description: string) => {
    return execute('STRUCTURE', [{
      type: 'STRUCTURE',
      description,
      unitId: scenarioId,
      changes: [{ field: 'structures', key, from, to }],
    }], description);
  }, [execute, scenarioId]);

  const placeStructureCommand = useCallback(async (key: string, inst: StructureInstance) => {
    const t = structureTemplates[inst.templateId];
    await structureCommand(key, null, inst, `${t?.name ?? 'Structure'} placed at ${key}`);
  }, [structureTemplates, structureCommand]);

  const editStructureCommand = useCallback(async (key: string, next: StructureInstance, description = 'Structure updated') => {
    const from = structures[key];
    if (!from) return;
    await structureCommand(key, from, next, description);
  }, [structures, structureCommand]);

  const removeStructureCommand = useCallback(async (key: string) => {
    const from = structures[key];
    if (!from) return;
    const t = structureTemplates[from.templateId];
    await structureCommand(key, from, null, `${t?.name ?? 'Structure'} removed at ${key}`);
  }, [structures, structureTemplates, structureCommand]);

  const paintStructureEdge = useCallback(async (q: number, r: number, dir: number) => {
    if (!structurePaletteId) return;
    const ref = edgeRef(q, r, dir);
    const existing = structures[ref.key];
    if (!existing) {
      const snapshot = structureTemplateLibrary[structurePaletteId];
      await placeStructureCommand(ref.key, { templateId: structurePaletteId, ...(snapshot ? { template: snapshot } : {}) });
      setSelectedStructureKey(ref.key);
      return;
    }
    if (selectedStructureKey === ref.key) {
      const t = structureTemplates[existing.templateId];
      if (edgeShowsLadder(existing, t)) {
        // Stairs edge: flip only the ladder's lean (the wall face stays as placed).
        const effSide = existing.ladderSide
          ?? (structureSurfaceAt({ q: ref.bq, r: ref.br }, structures, structureTemplates)
              >= structureSurfaceAt({ q: ref.aq, r: ref.ar }, structures, structureTemplates) ? 'b' : 'a');
        await editStructureCommand(ref.key, { ...existing, ladderSide: effSide === 'a' ? 'b' : 'a' }, 'Stairs direction flipped');
        return;
      }
      const outside = (existing.outside ?? 'a') === 'a' ? 'b' : 'a';
      await editStructureCommand(ref.key, { ...existing, outside }, 'Battlement side flipped');
      return;
    }
    setSelectedStructureKey(ref.key);
  }, [structures, structurePaletteId, selectedStructureKey, placeStructureCommand, editStructureCommand]);

  const paintStructureHex = useCallback(async (q: number, r: number) => {
    if (!structurePaletteId) return;
    const key = `${q},${r}`;
    if (!structures[key]) {
      const snapshot = structureTemplateLibrary[structurePaletteId];
      await placeStructureCommand(key, { templateId: structurePaletteId, ...(snapshot ? { template: snapshot } : {}) });
    }
    setSelectedStructureKey(key);
  }, [structures, structurePaletteId, structureTemplateLibrary, placeStructureCommand]);

  const clearStructureKey = useCallback(async (key: string) => {
    if (!structures[key]) return;
    setSelectedStructureKey(sel => (sel === key ? null : sel));
    await removeStructureCommand(key);
  }, [structures, removeStructureCommand]);

  const patchScenarioStructure = useCallback(async (patch: { hp?: number; doorHp?: number; outside?: 'a' | 'b'; open?: boolean; modifiers?: any[] }) => {
    if (!selectedStructureKey) return;
    const inst = structures[selectedStructureKey];
    if (!inst) return;
    const next: StructureInstance = { ...inst };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (next as any)[k];
      else (next as any)[k] = v;
    }
    await editStructureCommand(selectedStructureKey, next);
  }, [structures, selectedStructureKey, editStructureCommand]);

  // Edit any placed structure instance by key (Shift + double-click modal).
  const patchStructureAt = useCallback(async (key: string, patch: StructureInstancePatch) => {
    const inst = structures[key];
    if (!inst) return;
    const next: StructureInstance = { ...inst };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (next as any)[k];
      else (next as any)[k] = v;
    }
    await editStructureCommand(key, next);
  }, [structures, editStructureCommand]);

  // "Other Actionâ€¦" (hero roleplay): spend 1 action; the table resolves it by
  // hand. Zero actions -> the standard soft-enforcement confirm.
  const [otherActionHero, setOtherActionHero] = useState<Unit | null>(null);
  const handleOtherAction = useCallback((hero: Unit) => {
    if (freeMove || (hero.actionsAvailable ?? 0) >= 1) void otherAction(hero);
    else setOtherActionHero(hero);
  }, [freeMove, otherAction]);
  const confirmOtherAction = useCallback(async () => {
    const hero = otherActionHero;
    setOtherActionHero(null);
    if (!hero || controlsLocked) return;
    await otherAction(hero);
    addError(`${hero.unitName} used an Other Action with no actions left â€” over budget`);
  }, [otherActionHero, controlsLocked, otherAction, addError]);

  // Keep the engine's zone list in sync so landing on an 'entry' zone deals damage.
  useEffect(() => {
    syncZoneEffects(effectiveZones);
  }, [effectiveZones, syncZoneEffects]);

  const {
    reactionOffers,
    setReactionOffers,
    reactionMode,
    setReactionMode,
    pendingReactionChoice,
    setPendingReactionChoice,
    requestReactionAttack,
    confirmReactionChoice,
    cancelReactionChoice,
    reactionFormationPicker,
    setReactionFormationPicker,
    bowBlinkOn,
    offerReactionsFor,
    pruneReactionOffers,
    handleReactionMove,
    performReactionFormation,
    endReaction,
  } = useReactionActions({
    units,
    displayUnits,
    displayAlliances,
    alliances,
    formationsMap,
    sizeCategories,
    archerReactionEnabled,
    freeMove,
    execute,
    addMessage,
    addError,
    unitMaxMP,
    flashRangeViolation,
    canAttackTarget: canAttackInFog,
    terrainCosts: zoneMpCosts,
    walls,
    structures,
    structureTemplates,
    groundZones: effectiveZones,
    threatShips,
    shipObstacles,
    magicCast,
    playerId,
    playerName,
    gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
  });

  // A reaction that opened the spell window ends the locked reaction session once
  // the cast resolves.
  useEffect(() => {
    const c = magicCast.cast;
    if (reactionMode && c?.reaction && c.resolved) endReaction();
  }, [magicCast.cast, reactionMode, endReaction]);

  // Wall edge under the pointer while dragging a unit (drag-to-attack hint).
  const [hoveredWallEdge, setHoveredWallEdge] = useState<EdgeRef | null>(null);
  // Hex structure under the pointer while Shift-dragging a unit (overlay hint).
  const [hoveredStructureHex, setHoveredStructureHex] = useState<Hex | null>(null);
  /** Ground attacker vs a garrison on a higher structure top: Climb & attack / Attack. */
  const [pendingClimbAttack, setPendingClimbAttack] = useState<{ attackerId: string; targetId: string; garrison: string } | null>(null);
  // Target-filter modes (first pressed wins, read live): Shift/1 â†’ structure
  // (only structures targetable, all unit tokens hidden), Space/2 â†’ ground (only
  // elevation-0 units), 3 â†’ air (only elevation>0 units, aerial offset cancelled).
  const [heldFilterIds, setHeldFilterIds] = useState<string[]>([]);
  const targetFilter: TargetFilter = heldFilterIds.length ? FILTER_KIND[heldFilterIds[0]] : null;
  // Hex/edge info-hover (structure + effect tooltip), from useHexGrid.
  const [infoHover, setInfoHover] = useState<{ kind: 'hex' | 'edge'; hex?: Hex; edge?: EdgeRef; x: number; y: number } | null>(null);

  // --- Tooltip lifecycle (design rule) --------------------------------------
  // A tooltip shows ONLY on idle hover. Any key press, pointer-down, drag or
  // opened modal dismisses it â€” it must never linger over a drag or another
  // window. EXCEPTION: the target-filter modifiers (Shift/Space/1/2/3) do NOT
  // dismiss, since they gate hovering and their per-mode tooltip must show.
  // `dismissTooltips` is the single clear used by every suppression point
  // (mouse-leave, modals, and the global key/pointer listeners).
  const dismissTooltips = useCallback(() => {
    setHoveredUnit(null);
    setTooltipPos(null);
    setInfoHover(null);
  }, []);
  const dismissUnitTooltip = useCallback(() => {
    setHoveredUnit(null);
    setTooltipPos(null);
  }, []);

  useEffect(() => {
    // The target-filter modifiers (Shift/Space/1/2/3) must NOT dismiss â€” they gate
    // hovering/aiming, so their per-mode tooltip has to stay/again show; every
    // other key press (and pointer-down) drops the tooltip.
    const onKeyDown = (e: KeyboardEvent) => { if (!filterKeyId(e)) dismissTooltips(); };
    const onPointerDown = () => dismissTooltips();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [dismissTooltips]);

  // Target-filter modifiers: Shift / 1 â†’ structure, Space / 2 â†’ ground, 3 â†’ air.
  // Held keys keep a press-ordered id list (FIRST pressed wins); ignored while
  // typing in a text field; blur clears everything.
  useEffect(() => {
    const typing = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      const id = filterKeyId(e);
      if (!id || typing(e.target)) return;
      if (e.code === 'Space') e.preventDefault();
      setHeldFilterIds(prev => (prev.includes(id) ? prev : [...prev, id]));
    };
    const up = (e: KeyboardEvent) => {
      const id = filterKeyId(e);
      if (!id) return;
      setHeldFilterIds(prev => prev.filter(k => k !== id));
    };
    const blur = () => setHeldFilterIds([]);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // AI assist overlay comes straight from the panel (route + marks).
  const mergedAiOverlay = aiOverlay;

  // The currently dragged unit id, exposed to `useCanvasDraw` (called before
  // `useHexGrid` owns the state) so its token stays visible in every filter mode.
  const draggedUnitIdRef = useRef<string | null>(null);
  const { customDraw, captureAndUploadScreenshot } = useCanvasDraw({
    canvasRef,
    units,
    displayUnits,
    displayAlliances,
    displayTurnNumber,
    isGM: effectiveIsGM,
    fogReveal,
    fogDim,
    fogUnseenAlpha: fogReveal
      ? inReplay || effectiveIsGM
        ? FOG_UNSEEN_GM_ALPHA
        : FOG_UNSEEN_PLAYER_ALPHA
      : null,
    formationsMap,
    sizeCategories,
    activeHeroId,
    reactionOffers,
    reactionMode,
    bowBlinkOn,
    canReactToUnit,
    alliances,
    backgroundConfig,
    walls,
    structures,
    templates: structureTemplates,
    ships,
    // Highlight the edge under the cursor in structure mode (the Shift + double-click
    // edit target), alongside the drag-to-attack cap.
    hoveredWallEdge: hoveredWallEdge ?? (targetFilter === 'structure' && infoHover?.kind === 'edge' ? infoHover.edge ?? null : null),
    hoveredStructureHex,
    targetFilter,
    keepVisibleUnitIdRef: draggedUnitIdRef,
    groundZones,
    mpZones: effectiveZones,
    scenarioId,
    updateScreenshot,
    corpseCounts,
    aiOverlay: mergedAiOverlay,
    aiHoveredUnitId: hoveredUnit?.id ?? null,
    overlayLabels,
  });

  // Parting-shot resolver is owned by useCombatActions (declared later); this ref
  // bridges the hook-order cycle â€” useMoveActions reads it at move time.
  const pursuitsRef = useRef<((mover: Unit, originHex: Hex, destHex: Hex) => Promise<void>) | null>(null);

  const openFreePlacement = useCallback((request: Omit<FreePlacementRequest, 'onCancel'>) => {
    setFreePlacement({ ...request, onCancel: () => setFreePlacement(null) });
  }, []);

  /** Resolve every valid free-placement home at a hex for a mover/template. */
  const buildFreePlacementOptionsFor = useCallback((args: {
    hex: Hex;
    isHero: boolean;
    canFly: boolean;
    team: string;
    excludeUnitId?: string;
    allowAnyUnit?: boolean;
    mountId?: string | null;
    mountName?: string | null;
    sizeCategory?: number;
  }): FreePlacementOption[] => {
    const key = `${args.hex.q},${args.hex.r}`;
    const inst = structures?.[key];
    const template = inst ? structureTemplates?.[inst.templateId] : undefined;
    const hasStructure = !!inst && !!template && template.anchor === 'hex';
    const structureTop = hasStructure
      ? structureSurfaceAt(args.hex, structures, structureTemplates)
      : 0;
    const doorOpenOrBroken = hasStructure && !!template && structureHasDoor(template)
      && structureDoorState(inst!, template!).openOrBroken;
    const groundFree = !computeOccupiedHexes(units, args.excludeUnitId, 0).has(key);
    const topFree = !computeOccupiedHexes(units, args.excludeUnitId, 1).has(key);
    const occupants = units
      .filter(u =>
        isUnitInteractable(u) && u.id !== args.excludeUnitId
        && u.hex.q === args.hex.q && u.hex.r === args.hex.r && u.hex.s === args.hex.s)
      .map(u => {
        const riderExists = units.some(h => h.attachedToUnitId === u.id && !h.isDeleted);
        return {
          id: u.id,
          name: u.unitName,
          team: u.team,
          elevation: u.elevation ?? 0,
          friendly: sameAlliance(args.team, u.team, alliances),
          canRide: u.isHero
            && !args.mountId && !args.mountName
            && !u.mountId && !u.mountName
            && (u.sizeCategory || 100) > (args.sizeCategory || 100)
            && !riderExists,
        };
      });
    const ships = args.isHero
      ? shipRuntime
        .filter(s => !s.isDeleted && !!s.hex && s.hex.q === args.hex.q && s.hex.r === args.hex.r)
        .filter(s => {
          const deckKey = shipComponentCardKey(s, 'Deck');
          const cargoKey = shipComponentCardKey(s, 'Cargo');
          return !!((deckKey && !shipCardDestroyed(s, deckKey))
            || (cargoKey && !shipCardDestroyed(s, cargoKey)));
        })
        .filter(() => (args.sizeCategory ?? 100) <= getSetting('hero_attach_max_size', 200))
        .map(s => ({ id: s.id, name: s.name }))
      : [];
    return buildFreePlacementOptions({
      isHero: args.isHero,
      canFly: args.canFly,
      hasStructure,
      structureTop,
      doorOpenOrBroken,
      groundFree,
      topFree,
      ships,
      occupants,
      allowAnyUnit: !!args.allowAnyUnit,
    });
  }, [structures, structureTemplates, units, shipRuntime, alliances]);

  const {
    pendingMove,
    setPendingMove,
    pendingDescent,
    confirmDescentClimb,
    confirmDescentDrop,
    performDescentDrop,
    cancelDescent,
    pendingFormation,
    setPendingFormation,
    pendingHeroAttachConversion,
    setPendingHeroAttachConversion,
    pendingAttachOverBudget,
    setPendingAttachOverBudget,
    pendingElevation,
    setPendingElevation,
    confirmElevation,
    beginFlyerDrop,
    cancelElevation,
    pendingLeaveHero,
    confirmLeaveHero,
    cancelLeaveHero,
    pendingHeroFall,
    confirmHeroFall,
    cancelHeroFall,
    pendingStructureAction,
    setPendingStructureAction,
    confirmStructureAction,
    confirmClimbOver,
    performClimbOver,
    maybeAutoReturnToRanged,
    completeMove,
    handleUnitMove,
    handleClimbMove,
    handleChangeFormation,
    handleMoveTeam,
    handleAttachHero,
    handleSwapHeroPosition,
    performWithdraw,
  } = useMoveActions({
    units,
    displayUnits,
    displayAlliances,
    alliances,
    formationsMap,
    freeMove,
    archerReactionEnabled,
    movePreviewMode,
    turnNumber,
    execute,
    addMessage,
    addError,
    unitMaxMP,
    moveUnitRecorded,
    moveUnitFree,
    changeFormation,
    attachHero,
    swapHeroPosition,
    offerReactionsFor,
    pruneReactionOffers,
    weaponSelectedTurnRef,
    setActiveHeroId,
    terrainCosts: zoneMpCosts,
    walls,
    structures,
    structureTemplates,
    groundZones: effectiveZones,
    threatShips,
    shipObstacles,
    pursuitsRef,
    onBoardShip,
    onAttackShip,
    onBoardShipFree,
    buildFreePlacementOptions: buildFreePlacementOptionsFor,
    requestFreePlacement: openFreePlacement,
  });

  /** Insert a Unit Selector token at the chosen free-placement level/host. */
  const placeUnitFromSelector = useCallback(async (
    template: UnitTemplate,
    hex: Hex,
    option: FreePlacementOption,
  ) => {
    const place = async (elevation: number, team = 'black') => {
      const unit = await addUnitFromTemplate(template, hex, team, elevation);
      if (!unit) {
        addMessage(`Failed to place ${template.unitName}`);
        return null;
      }
      await placeUnit(unit);
      return unit;
    };

    if (option.kind === 'board' && option.shipId) {
      const unit = await place(0);
      if (unit) await handleBoardHero(unit, option.shipId, 0, unitMaxMP(unit), true, { freePlacement: true });
      return;
    }

    if ((option.kind === 'attach' || option.kind === 'ride') && option.hostId) {
      const host = units.find(u => u.id === option.hostId && !u.isDeleted);
      if (!host) { addMessage('That host unit is no longer on the map.'); return; }
      // Keep the selector team; the DM can right-click the attached hero to
      // assign a team (host menu or ship-window token).
      const unit = await place(host.elevation ?? 0);
      if (unit) {
        await attachHero(unit, host, option.position ?? 'back', unitMaxMP(unit), 1, true);
        addMessage(`${unit.unitName} ${option.kind === 'ride' ? 'rides' : 'attaches to'} ${host.unitName}`);
      }
      return;
    }

    if (option.kind === 'air') {
      const structureTop = structureSurfaceAt(hex, structures, structureTemplates);
      setFreePlacementAir({
        title: `Air placement â€” ${template.unitName}`,
        min: structureTop > 0 ? structureTop : 0,
        max: Math.max(200, structureTop + 100),
        defaultValue: Math.max(10, structureTop),
        onConfirm: async elevation => {
          setFreePlacementAir(null);
          await place(elevation);
        },
        onCancel: () => setFreePlacementAir(null),
      });
      return;
    }

    await place(option.elevation ?? 0);
  }, [addUnitFromTemplate, placeUnit, addMessage, handleBoardHero, unitMaxMP, units, attachHero, structures, structureTemplates]);

  // ---- Withdraw (drag one hex into a rear hex; always warns the action cost) ----
  const [withdrawConfirm, setWithdrawConfirm] = useState<{ unit: Unit; dest: Hex } | null>(null);



  // Number of damage rolls a structure attack lands, mirroring unit combat:
  // eligible attackers (row capacity Ã— capacity multiplier, capped by troops) Ã—
  // weapon attacks, plus a front-attached hero's own volley. DT gates each roll.
  const structureAttackCount = useCallback((attacker: Unit, weaponAttacks: number, warMachine = false): number => {
    const capMult = getFormationMultiplier(formationsMap, attacker.currentFormation, 'attack_capacity_multiplier');
    const rowCap = getRowCapacity(sizeCategories, attacker.sizeCategory);
    let count = computeAttackCount(attacker, rowCap, capMult, 0, false, Math.max(1, weaponAttacks || 1), warMachine);
    const hero = findAttachedHero(attacker, units);
    if (hero) {
      const hw = parseWeapons(hero.weaponString || '')[hero.activeWeaponIndex ?? 0];
      if (hw) count += Math.max(1, hw.numberOfAttacks || 1);
    }
    return Math.max(1, count);
  }, [formationsMap, units, alliances, sizeCategories]);

  // ---- Barrier attacks (drag a unit onto a destructible wall edge) ----
  // No to-hit roll: reaching the edge is the hit; the wall's DT gates the blow.
  // Costs 1 action and counts toward the attack cap (soft-enforced).
  const [pendingWallAttack, setPendingWallAttack] = useState<PendingWallAttack | null>(null);
  const performWallAttack = useCallback(async (attacker: Unit, ref: EdgeRef, force = false) => {
    const wall = walls[ref.key];
    const inst = structures[ref.key];
    if (!wall || !inst || !isDestructibleWall(wall)) {
      addMessage(`${attacker.unitName} has no barrier to attack there`);
      return;
    }
    // Structures stand 10 ft tall â€” a flyer more than 10 ft away vertically can't reach.
    if (!canReachStructure(attacker.elevation)) {
      addMessage(`${attacker.unitName} cannot reach that barrier â€” wrong elevation`);
      return;
    }
    const weapon = parseWeapons(attacker.weaponString || '')[attacker.activeWeaponIndex ?? 0];
    const kind = wallAttackKind(attacker, ref, weapon, formationsMap[attacker.currentFormation]);
    if (!weapon || !kind) {
      addMessage(`${attacker.unitName} cannot reach or face that barrier`);
      return;
    }
    if (weapon.warMachine && attacker.currentFormation === 'Scattered') {
      addMessage(`${attacker.unitName} (Scattered) cannot fire ${weapon.name} â€” the war machine has lost its facing`);
      return;
    }
    const cap = unitAttackCap();
    const overCap = (attacker.attacksUsed ?? 0) >= cap;
    const overBudget = (attacker.actionsAvailable ?? 0) < 1;
    const [ha, hb] = edgeHexes(ref);
    const label = `(${ha.q}, ${ha.r}) â‡„ (${hb.q}, ${hb.r})`;
    if ((overCap || overBudget) && !force) {
      setPendingWallAttack({ attacker, ref, label, overCap, overBudget });
      return;
    }
    if (overBudget) addError(`${attacker.unitName} attacked a barrier with no actions left â€” over budget`);
    if (overCap) addError(`${attacker.unitName} attacked past the ${cap}-attack cap (${(attacker.attacksUsed ?? 0) + 1}/${cap})`);

    const attacks = structureAttackCount(attacker, weapon.numberOfAttacks ?? 1, weapon.warMachine ?? false);
    const attackBonus = weapon.attackBonus + getFormationModifier(formationsMap, attacker.currentFormation, 'attack_modifier');
    const result = resolveWallAttack(wall, weapon, Math.random, attacks, attackBonus);
    const to = result.destroyed
      ? null
      : { ...inst, hp: result.wall.hp, ...(result.doorHpAfter !== undefined ? { doorHp: result.doorHpAfter } : {}) };

    const doorNote = result.doorHpAfter !== undefined && result.doorHpAfter > 0 ? ` (door ${result.doorHpAfter}/${wall.doorMax ?? 0})` : '';
    // Chronological: [attacked â†’ to-hit â†’ damage past DT] Â· [outcome].
    const attackPlain = `${attacker.unitName} attacked the barrier at ${label} â†’ ${result.hits}/${attacks} hit â†’ ${result.applied} past DT`;
    const attackVerbose = `${attacker.unitName} attacked the barrier at ${label} â†’ ${formatStructureToHit(result.toHit, attackBonus, wall.ac ?? 10)} Â· ${formatStructureAttackRolls(result.rolls, wall.dt ?? 0, weapon.damageDice)}`;
    const outcome = result.hits === 0
      ? `all attacks missed (AC ${wall.ac ?? 10})`
      : result.deflected
        ? `the blow is shrugged off (DT ${wall.dt ?? 0})`
        : result.destroyed
          ? 'destroyed'
          : `${wallHp(result.wall)}/${wall.maxHp} HP left${doorNote}`;
    const message = [attackPlain, outcome].join(' Â· ');
    const verbose = [attackVerbose, outcome].join(' Â· ');
    await execute('ATTACK', [
      {
        type: 'ATTACK',
        description: `${attacker.unitName} attacked the barrier at ${label} (${kind})`,
        unitId: attacker.id,
        changes: [
          { field: 'actionsAvailable', from: attacker.actionsAvailable, to: attacker.actionsAvailable - 1 },
          { field: 'attacksUsed', from: attacker.attacksUsed ?? 0, to: (attacker.attacksUsed ?? 0) + 1 },
        ],
      },
      {
        type: 'STRUCTURE',
        description: result.destroyed ? `Barrier at ${label} destroyed` : `Barrier at ${label} damaged`,
        unitId: scenarioId,
        changes: [{ field: 'structures', key: ref.key, from: inst, to }],
      },
    ], `${attacker.unitName} attacked the barrier at ${label}`, { message, verboseMessage: verbose });
  }, [walls, structures, execute, addError, addMessage, scenarioId, structureAttackCount, formationsMap]);

  // Drag-gate handed to useHexGrid: only a wall edge the dragged unit can reach
  // is hinted as an attack target (overlay highlight).
  const canAttackWallEdge = useCallback((unitId: string, edge: EdgeRef): boolean => {
    const unit = units.find(u => u.id === unitId);
    if (!unit || !canControlUnit(unit)) return false;
    if (!canReachStructure(unit.elevation)) return false;
    const wall = walls[edge.key];
    if (!wall || !isDestructibleWall(wall)) return false;
    const weapon = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0];
    return !!weapon && wallAttackKind(unit, edge, weapon, formationsMap[unit.currentFormation]) !== null;
  }, [units, walls, canControlUnit, formationsMap]);

  // Identity gate for the Shift-drop router: a destructible wall edge EXISTS here
  // (no reach/range/vertical check â€” the attack command reports "cannot reach").
  const canAttemptWallEdge = useCallback((unitId: string, edge: EdgeRef): boolean => {
    const unit = units.find(u => u.id === unitId);
    if (!unit || !canControlUnit(unit)) return false;
    const wall = walls[edge.key];
    return !!wall && isDestructibleWall(wall);
  }, [units, walls, canControlUnit]);

  // ---- Hex structure attacks (drag a unit onto a gate/tower hex) ----
  const performStructureAttack = useCallback(async (attacker: Unit, hex: Hex, force = false) => {
    const key = `${hex.q},${hex.r}`;
    const inst = structures[key];
    const template = inst ? structureTemplates[inst.templateId] : undefined;
    if (!inst || !template || !isAttackableHexStructure(template, inst)) {
      addMessage(`${attacker.unitName} has no structure to attack there`);
      return;
    }
    // Structures stand 10 ft tall â€” a flyer more than 10 ft away vertically can't reach.
    if (!canReachStructure(attacker.elevation)) {
      addMessage(`${attacker.unitName} cannot reach that structure â€” wrong elevation`);
      return;
    }
    const weapon = parseWeapons(attacker.weaponString || '')[attacker.activeWeaponIndex ?? 0];
    const kind = hexStructureAttackKind(attacker, hex, weapon, formationsMap[attacker.currentFormation]);
    if (!weapon || !kind) {
      addMessage(`${attacker.unitName} cannot reach or face that structure`);
      return;
    }
    if (weapon.warMachine && attacker.currentFormation === 'Scattered') {
      addMessage(`${attacker.unitName} (Scattered) cannot fire ${weapon.name} â€” the war machine has lost its facing`);
      return;
    }
    const cap = unitAttackCap();
    const overCap = (attacker.attacksUsed ?? 0) >= cap;
    const overBudget = (attacker.actionsAvailable ?? 0) < 1;
    const label = `(${hex.q}, ${hex.r})`;
    if ((overCap || overBudget) && !force) {
      setPendingWallAttack({ attacker, hex, label, overCap, overBudget });
      return;
    }
    if (overBudget) addError(`${attacker.unitName} attacked a structure with no actions left â€” over budget`);
    if (overCap) addError(`${attacker.unitName} attacked past the ${cap}-attack cap (${(attacker.attacksUsed ?? 0) + 1}/${cap})`);

    const attacks = structureAttackCount(attacker, weapon.numberOfAttacks ?? 1, weapon.warMachine ?? false);
    const attackBonus = weapon.attackBonus + getFormationModifier(formationsMap, attacker.currentFormation, 'attack_modifier');
    const result = resolveHexStructureAttack(template, inst, weapon, Math.random, attacks, attackBonus);
    // A destroyed structure (0 HP) is REMOVED from the map (hex and edge alike).
    const to = result.destroyed ? null : { ...inst, hp: result.hpAfter, doorHp: result.doorHpAfter };

    const subSteps: SubStep[] = [
      {
        type: 'ATTACK',
        description: `${attacker.unitName} attacked the structure at ${label} (${kind})`,
        unitId: attacker.id,
        changes: [
          { field: 'actionsAvailable', from: attacker.actionsAvailable, to: attacker.actionsAvailable - 1 },
          { field: 'attacksUsed', from: attacker.attacksUsed ?? 0, to: (attacker.attacksUsed ?? 0) + 1 },
        ],
      },
      {
        type: 'STRUCTURE',
        description: result.destroyed ? `Structure at ${label} destroyed` : `Structure at ${label} damaged`,
        unitId: scenarioId,
        changes: [{ field: 'structures', key, from: inst, to }],
      },
    ];

    // Collapse: units standing on the (now gone) top â€” and their riders â€” fall.
    // The falls ride the SAME command (ELEVATE + per-troop DAMAGE per unit).
    const fallNotes: string[] = [];
    const deadHosts: { host: Unit; newHp: number }[] = [];
    if (result.destroyed) {
      // Clear the whole asset: a destroyed HEX structure also erases every edge
      // structure on its 6 edges (same command, one undo).
      if (isHexStructureKey(key)) {
        for (const ekey of edgeKeysAroundHex(hex.q, hex.r)) {
          const edgeInst = structures[ekey];
          if (!edgeInst) continue;
          subSteps.push({
            type: 'STRUCTURE',
            description: `Edge structure at ${ekey} cleared with ${label}`,
            unitId: scenarioId,
            changes: [{ field: 'structures', key: ekey, from: edgeInst, to: null }],
          });
        }
      }
      const top = structureElevation(template, inst);
      const onTop = units.filter(u =>
        !u.isDeleted && !u.attachedToUnitId &&
        u.hex.q === hex.q && u.hex.r === hex.r &&
        (u.elevation ?? 0) > 0 && (u.elevation ?? 0) <= top);
      const handled = new Set<string>();
      for (const host of onTop) {
        let hostNewHp: number | null = null;
        if (!handled.has(host.id)) {
          handled.add(host.id);
          const f = fallSteps(host, 0);
          if (f.steps.length > 0) { subSteps.push(...f.steps); fallNotes.push(f.note); hostNewHp = f.newHp; }
        }
        const riders = units.filter(h => h.attachedToUnitId === host.id && !h.isDeleted);
        for (const hero of riders) {
          if (handled.has(hero.id)) continue;
          handled.add(hero.id);
          const f = fallSteps(hero, 0);
          if (f.steps.length > 0) { subSteps.push(...f.steps); fallNotes.push(f.note); }
        }
        // Host annihilated by the collapse â†’ its riders auto-detach (already fell).
        if (hostNewHp !== null && hostNewHp <= 0) {
          for (const hero of riders) {
            subSteps.push(heroDetachStep(hero, `${hero.unitName} detaches â€” ${host.unitName} was crushed`));
            fallNotes.push(`${hero.unitName} detached`);
          }
          deadHosts.push({ host, newHp: hostNewHp });
        }
      }
    }

    const doorNow = result.doorHpAfter;
    // Chronological: [attacked â†’ to-hit â†’ damage past DT] Â· [outcome] Â· [falls].
    const attackPlain = `${attacker.unitName} attacked the structure at ${label} â†’ ${result.hits}/${attacks} hit â†’ ${result.applied} past DT`;
    const attackVerbose = `${attacker.unitName} attacked the structure at ${label} â†’ ${formatStructureToHit(result.toHit, attackBonus, template.ac ?? 10)} Â· ${formatStructureAttackRolls(result.rolls, template.dt ?? 0, weapon.damageDice)}`;
    const outcome = result.hits === 0
      ? `all attacks missed (AC ${template.ac ?? 10})`
      : result.deflected
        ? `the blow is shrugged off (DT ${template.dt})`
        : result.destroyed
          ? 'destroyed'
          : result.hitDoor
            ? `door ${doorNow}/${structureDoorMax(template)} HP left`
            : `${result.hpAfter}/${template.maxHp} HP left`;
    const message = [attackPlain, outcome, ...fallNotes].join(' Â· ');
    const verbose = [attackVerbose, outcome, ...fallNotes].join(' Â· ');
    await execute('ATTACK', subSteps, `${attacker.unitName} attacked the structure at ${label}`, { message, verboseMessage: verbose });

    // A host annihilated by the fall routes through the standard death flow. Pass an
    // empty roster so the rider isn't detached twice (already handled above).
    for (const { host, newHp } of deadHosts) {
      await routeUnit(execute, { ...host, currentUnitHp: newHp }, 'crushed by the collapsing structure', true, attacker.id, 0, []);
    }
  }, [structures, structureTemplates, units, execute, addError, addMessage, scenarioId, structureAttackCount, formationsMap]);

  // Identity gate for the Shift-drop router: an attackable structure EXISTS on
  // this hex (no reach/range/vertical check â€” the attack reports "cannot reach").
  const canAttemptStructure = useCallback((unitId: string, hex: Hex): boolean => {
    const unit = units.find(u => u.id === unitId);
    if (!unit || !canControlUnit(unit)) return false;
    const inst = structures[`${hex.q},${hex.r}`];
    const template = inst ? structureTemplates[inst.templateId] : undefined;
    return !!inst && !!template && isAttackableHexStructure(template, inst);
  }, [units, structures, structureTemplates, canControlUnit]);

  // ---- Temporary-effect apply/remove handlers (opened from the context menu) ----
  const teamOptions = Object.keys(alliances).length > 0 ? Object.keys(alliances) : TEAMS;

  const handleRemoveUnitEffect = useCallback((key: string) => {
    const target = units.find(u => u.id === effectMenuUnit?.id) ?? effectMenuUnit;
    if (!target) return;
    void removeEffect(target, key);
  }, [units, effectMenuUnit, removeEffect]);

  // ---- Effects tab: drag & drop an effect onto the board ----
  // One editable pre-apply form (no radius; zones land on the dropped hex only).
  const [effectDrop, setEffectDrop] = useState<{ unit: Unit | null; hex: Hex; form: EffectFormValue } | null>(null);
  // Instance edit (placed ground zone or a unit's own effect).
  const [effectEdit, setEffectEdit] = useState<
    | { target: 'zone'; key: string; form: EffectFormValue }
    | { target: 'unit'; unit: Unit; key: string; form: EffectFormValue }
    | null
  >(null);
  // Armed clone: the next left-click places a copy of this zone.
  const [cloneZone, setCloneZone] = useState<GroundEffect | null>(null);

  const UNIT_KINDS = ['ac', 'morale', 'movement', 'dot', 'hp_borrow', 'range', 'advantage', 'disadvantage', 'grant_advantage', 'grant_disadvantage', 'save_advantage', 'save_disadvantage'];
  const ZONE_KINDS = ['ac', 'morale', 'dot', 'entry', 'mp_cost', 'max_org_level_allowed', 'range', 'advantage', 'disadvantage', 'grant_advantage', 'grant_disadvantage', 'save_advantage', 'save_disadvantage', 'forced_stop'];

  const applyUnitDrop = async (d: { unit: Unit; form: EffectFormValue }) => {
    if (d.form.scope === 'zone') {
      addMessage(`${d.form.name} is hex-only â€” drop it on the map (hold Shift to place under a unit)`);
      return;
    }
    for (const m of d.form.modifiers) {
      if (!UNIT_KINDS.includes(m.kind)) {
        addMessage(`${d.form.name}: '${m.kind}' is not unit-applicable â€” skipped`);
        continue;
      }
      if (m.kind === 'hp_borrow' && modifierAmount(m.dice) <= 0) {
        addMessage(`${d.form.name}: enter a borrowed HP amount to Sleep the unit`);
        continue;
      }
      await applyEffect(d.unit, {
        name: d.form.name,
        color: d.form.color,
        ...(d.form.imageUrl ? { imageUrl: d.form.imageUrl } : {}),
        imageScale: d.form.imageScale,
        transparentBackground: d.form.transparentBackground,
        layer: d.form.layer,
        kind: m.kind,
        ...(m.dice ? { dice: m.dice } : {}),
        ...(m.healing ? { healing: true } : {}),
        ...(m.savingThrow ? { savingThrow: m.savingThrow } : {}),
        ...(m.saveDC != null ? { saveDC: m.saveDC } : {}),
        ...(m.onSaveHalfOrNeg !== undefined ? { onSaveHalfOrNeg: m.onSaveHalfOrNeg } : {}),
        ...(m.mode ? { mode: m.mode } : {}),
        ...(m.direction ? { direction: m.direction } : {}),
        ...(d.form.permanent ? { permanent: true } : {}),
        casterTeam: d.form.casterTeam || null,
      }, d.form.duration, playerId);
    }
  };

  const applyZoneDrop = async (d: { hex: Hex; form: EffectFormValue }) => {
    if (d.form.scope === 'unit') {
      addMessage(`${d.form.name} is unit-only â€” drop it on a unit`);
      return;
    }
    const next = [...groundZones];
    for (const m of d.form.modifiers) {
      if (!ZONE_KINDS.includes(m.kind)) {
        addMessage(`${d.form.name}: '${m.kind}' is not zone-applicable â€” skipped`);
        continue;
      }
      next.push({
        key: newEffectKey(),
        q: d.hex.q,
        r: d.hex.r,
        name: d.form.name,
        color: d.form.color,
        ...(d.form.imageUrl ? { imageUrl: d.form.imageUrl } : {}),
        imageScale: d.form.imageScale,
        transparentBackground: d.form.transparentBackground,
        layer: d.form.layer,
        elevation: d.form.elevation,
        kind: m.kind as GroundEffect['kind'],
        dice: m.dice,
        healing: m.healing,
        savingThrow: m.savingThrow,
        saveDC: m.saveDC,
        onSaveHalfOrNeg: m.onSaveHalfOrNeg,
        mode: m.mode,
        direction: m.direction,
        zIndex: next.length,
        duration: d.form.duration,
        turnsLeft: d.form.duration,
        ...(d.form.permanent ? { permanent: true } : {}),
        casterUnitId: null,
        casterTeam: d.form.casterTeam || null,
        casterPlayerId: playerId,
      });
    }
    // Nothing actually placed (every modifier was skipped) â€” don't log a "Placed".
    if (next.length === groundZones.length) return;
    await applyZoneChange(groundZones, next, `Placed ${d.form.name} at (${d.hex.q}, ${d.hex.r}) (${d.form.duration} turns)`);
  };

  const confirmEffectDrop = async () => {
    const d = effectDrop;
    setEffectDrop(null);
    if (!d) return;
    if (d.unit) await applyUnitDrop({ unit: d.unit, form: d.form });
    else await applyZoneDrop({ hex: d.hex, form: d.form });
  };

  // Unit context "Effectsâ€¦" actions (library template â†’ shared apply paths).
  const handleApplyUnitForm = (form: EffectFormValue) => {
    if (!effectMenuUnit) return;
    void applyUnitDrop({ unit: effectMenuUnit, form });
    setEffectMenuUnit(null);
  };
  const handlePlaceZoneForm = (form: EffectFormValue) => {
    if (!effectMenuUnit) return;
    void applyZoneDrop({ hex: effectMenuUnit.hex, form });
    setEffectMenuUnit(null);
  };

  const saveZoneEdit = async (key: string, form: EffectFormValue) => {
    const z = groundZones.find(g => g.key === key);
    if (!z) return;
    const m = form.modifiers[0] ?? { kind: z.kind, dice: z.dice };
    const updated: GroundEffect = {
      ...z,
      name: form.name,
      color: form.color,
      imageUrl: form.imageUrl,
      imageScale: form.imageScale,
      transparentBackground: form.transparentBackground,
      layer: form.layer,
      elevation: form.elevation,
      kind: (m.kind as GroundEffect['kind']) ?? z.kind,
      dice: m.dice,
      healing: m.healing,
      savingThrow: m.savingThrow,
      saveDC: m.saveDC,
      onSaveHalfOrNeg: m.onSaveHalfOrNeg,
      mode: m.mode,
      direction: m.direction,
      duration: form.duration,
      turnsLeft: Math.min(form.duration, z.turnsLeft),
      casterTeam: form.casterTeam || null,
    };
    const next = groundZones.map(g => (g.key === key ? updated : g));
    await applyZoneChange(groundZones, next, `Effect ${form.name} updated`);
  };

  const saveUnitEffectEdit = async (unit: Unit, key: string, form: EffectFormValue) => {
    const m = form.modifiers[0];
    if (!m) return;
    const orig = (unit.effects ?? []).find(e => e.key === key);
    await editEffect(unit, key, {
      name: form.name,
      color: form.color,
      imageUrl: form.imageUrl,
      imageScale: form.imageScale,
      transparentBackground: form.transparentBackground,
      layer: form.layer,
      kind: m.kind as EffectKind,
      ...(m.dice ? { dice: m.dice } : {}),
      ...(m.healing ? { healing: true } : {}),
      ...(m.savingThrow ? { savingThrow: m.savingThrow } : {}),
      ...(m.saveDC != null ? { saveDC: m.saveDC } : {}),
      ...(m.onSaveHalfOrNeg !== undefined ? { onSaveHalfOrNeg: m.onSaveHalfOrNeg } : {}),
      ...(m.mode ? { mode: m.mode } : {}),
      ...(m.direction ? { direction: m.direction } : {}),
      ...(form.permanent ? { permanent: true } : {}),
      casterUnitId: orig?.casterUnitId ?? null,
      casterTeam: form.casterTeam || null,
    }, form.duration);
  };

  const confirmEffectEdit = async () => {
    const d = effectEdit;
    setEffectEdit(null);
    if (!d) return;
    if (d.target === 'zone') await saveZoneEdit(d.key, d.form);
    else await saveUnitEffectEdit(d.unit, d.key, d.form);
  };

  const placeClone = async (hex: Hex) => {
    const src = cloneZone;
    setCloneZone(null);
    if (!src) return;
    const clone: GroundEffect = {
      ...src,
      key: newEffectKey(),
      q: hex.q,
      r: hex.r,
      turnsLeft: src.duration,
      zIndex: groundZones.length,
    };
    const next = [...groundZones, clone];
    await applyZoneChange(groundZones, next, `Cloned ${src.name} to (${hex.q}, ${hex.r})`);
  };

  /** If a clone is armed, place it on `hex` and consume the click. */
  const handleCloneClick = (hex: Hex): boolean => {
    if (!cloneZone || !canPaintZones) return false;
    void placeClone(hex);
    return true;
  };

  // Esc cancels an armed clone.
  useEffect(() => {
    if (!cloneZone) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCloneZone(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cloneZone]);


  // ---- "Effects at hex" menu: reorder (Move up/down) and Drop Effect ----
  const canManageZone = (z: GroundEffect) => effectiveIsGM || z.casterPlayerId === playerId;

  const dropZone = async (key: string) => {
    const z = groundZones.find(g => g.key === key);
    if (!z || !canManageZone(z)) return;
    const next = groundZones.filter(g => g.key !== key);
    await applyZoneChange(groundZones, next, `Dropped effect ${z.name}`);
  };

  /** Drop every zone on one hex the viewer may manage (GM = all), as one undoable ZONE command. */
  const dropAllZonesAt = async (hex: Hex) => {
    const kept = groundZones.filter(z => !(z.q === hex.q && z.r === hex.r && canManageZone(z)));
    if (kept.length === groundZones.length) return;
    await applyZoneChange(groundZones, kept, `Cleared all effects at (${hex.q}, ${hex.r})`);
  };

  // GM/assigned-player zone brush: click toggles the armed template's zone on a
  // hex (log-backed so it is undoable).
  const placeOrToggleZone = useCallback(async (q: number, r: number) => {
    if (!zoneTemplate) return;
    const existing = groundZones.find(z => z.q === q && z.r === r && z.name === zoneTemplate.name);
    if (existing) {
      const next = groundZones.filter(z => !(z.q === q && z.r === r && z.name === zoneTemplate.name));
      await applyZoneChange(groundZones, next, `Cleared ${zoneTemplate.name} at (${q}, ${r})`);
      return;
    }
    const duration = Math.max(1, zoneTemplate.defaultDuration);
    const zone: GroundEffect = {
      key: newEffectKey(),
      q,
      r,
      name: zoneTemplate.name,
      color: zoneTemplate.color,
      kind: zoneTemplate.kind,
      ...(zoneTemplate.defaultDelta ? { dice: String(zoneTemplate.defaultDelta) } : {}),
      ...(zoneTemplate.healing ? { healing: true } : {}),
      duration,
      turnsLeft: duration,
      casterUnitId: null,
      casterTeam: myTeam ?? null,
      casterPlayerId: playerId,
    };
    const next = [...groundZones, zone];
    await applyZoneChange(groundZones, next, `${zoneTemplate.name} ground effect placed at (${q}, ${r})`);
  }, [zoneTemplate, groundZones, applyZoneChange, myTeam, playerId]);

  const handleEffectDrop = async (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (controlsLocked || !canPaintZones) return;
    const t = parseDragPayload(e.dataTransfer.getData('application/json'));
    if (!t) return;
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (!hex) return;
    const unit = getUnitAt(hex);
    const form = formFromDrop(t as DroppedEffect, currentTurnAlliance ?? 'friendly');
    const unitAlive = !!unit && (unit.currentUnitHp ?? 0) > 0;
    // Scope-aware routing: hex-only effects place a zone (reject on a unit unless
    // Shift is held to see the map beneath); unit-only effects need a unit.
    if (t.scope === 'zone') {
      if (unitAlive && !e.shiftKey) {
        addMessage(`${t.name} is hex-only â€” hold Shift to place it on the map under ${unit.unitName}`);
        return;
      }
      setEffectDrop({ unit: null, hex, form });
      return;
    }
    if (t.scope === 'unit' && !unitAlive) {
      addMessage(`${t.name} is unit-only â€” drop it on a unit`);
      return;
    }
    if (unitAlive) {
      setEffectDrop({ unit, hex, form });
    } else {
      setEffectDrop({ unit: null, hex, form });
    }
  };

  const siegeEnemyTeams = useMemo(
    () => TEAMS.filter(team => allianceOf(team, alliances) === 'enemy'),
    [alliances],
  );

  const performEndTurn = useCallback(async () => {
    if (isEndingTurn) return;
    // Block End Turn while any non-flying unit/hero is left floating (e.g. a hero
    // pulled off a flying mount, or a unit orphaned by a removed structure) â€” the DM
    // must ground it (context menu: Drop / Lower to ground).
    const floaters = floatingUnits(units, structures, structureTemplates);
    if (floaters.length > 0) {
      addError(`Cannot end turn â€” resolve floating unit(s) first: ${floaters.map(u => u.unitName).join(', ')}`);
      return;
    }
    // Wildspace: a piloted ship with movement left (or an undeclared speed)
    // must be resolved before the step can pass. Atmosphere is free to spend
    // none/part/all, and free play has no movement gate.
    if (shipMode === 'wildspace' && currentTurnAlliance !== null) {
      const blockers: string[] = [];
      for (const ship of shipRuntime) {
        if (ship.isDeleted || ship.shipHp <= 0 || shipHullDestroyed(ship.snapshot, ship.boxState)) continue;
        if (!shipHasPilot(ship, units)) continue;
        if (shipOwnerAlliance(ship, units, alliances) !== currentTurnAlliance) continue;
        const speed = ship.declaredRound === turnNumber
          ? ship.declaredSpeed
          : (ship.lastSpeed ?? 5);
        if (speed <= 0) continue;
        if (ship.declaredRound !== turnNumber) {
          blockers.push(`${shipDisplayName(ship)} (declare speed)`);
          continue;
        }
        const remaining = shipStepRemaining(
          { stepBudget: ship.stepBudget, step: shipStep, speedSpent: ship.speedSpent ?? 0 },
          shipStep,
        );
        if (remaining > 0) blockers.push(`${shipDisplayName(ship)} (${remaining} MP left)`);
      }
      if (blockers.length > 0) {
        addError(`Cannot end step â€” finish ship movement first: ${blockers.join(', ')}`);
        return;
      }
    }
    if (halloweenSiege?.enabled && halloweenSiege.waveStartTurns.some(start => start != null)) {
      const phase = siegePhaseForTurn(halloweenSiege, currentTurnAlliance === null ? turnNumber + 1 : turnNumber);
      if (phase.kind !== 'complete') {
        if (siegeEnemyTeams.length === 0) {
          addError('Halloween Siege: assign at least one team to the Enemy alliance before ending the turn.');
          return;
        }
        const { next: nextAlliance, wrapped: allianceWrapped } = advanceTurn(currentTurnAlliance, getActiveGroups(alliances));
        const willWrap = shipMode === 'wildspace'
          ? advanceShipStep(shipStep, allianceWrapped, currentTurnAlliance === null).wrapped
          : allianceWrapped;
        const upcomingTurnNumber = (currentTurnAlliance === null || willWrap) ? turnNumber + 1 : turnNumber;
        if (nextAlliance === 'enemy') {
          const upcomingPhase = siegePhaseForTurn(halloweenSiege, upcomingTurnNumber);
          if (upcomingPhase.kind === 'wave' && !isHalloweenSiegeConfigValid(halloweenSiege)) {
            addError('Halloween Siege: the wave configuration is invalid â€” open the minigame and save a valid setup.');
            return;
          }
        }
      }
    }
    setIsEndingTurn(true);
    try {
      const { next, wrapped, turnNumber: newTurnNumber, shipStep: newShipStep, freeMoveEnded, ok, zonesAfter } = await endTurn({
        currentAlliance: currentTurnAlliance,
        alliances,
        units,
        formationsMap,
        turnNumber,
        freeMove,
        shipMode,
        shipStep,
        ships: shipRuntime,
        zones: effectiveZones,
        structures,
        structureTemplates,
      });
      // Only advance the client's turn state when the server actually committed â€”
      // otherwise the UI shows a turn that never happened (and units never reset).
      if (!ok) {
        console.warn('[EndTurn] server rejected the END_TURN command', { currentTurnAlliance, next });
        return;
      }
      setCurrentTurnAlliance(next);
      if (wrapped || freeMoveEnded) setTurnNumber(newTurnNumber);
      setShipStep(newShipStep);
      // Turn 0 free play ends when the first real turn begins.
      if (freeMoveEnded) setFreeMove(false);
      // Ground zones ticked/expired inside the END_TURN command (ZONE sub-step),
      // so undo restores them and no separate map_data write is needed.
      setGroundZones(zonesAfter);
      // Authoritative convergence: re-read the scenario turn fields so a missed
      // realtime event can't leave the header on the previous alliance.
      const { data: turnRow } = await supabase
        .from('scenarios')
        .select('current_turn_alliance, turn_number, free_move, ship_step')
        .eq('id', scenarioId)
        .single();
      if (turnRow) {
        setCurrentTurnAlliance(turnRow.current_turn_alliance || null);
        setTurnNumber(turnRow.turn_number || 0);
        if (turnRow.ship_step !== undefined) setShipStep(Math.min(5, Math.max(1, Number(turnRow.ship_step) || 1)));
        if (turnRow.free_move !== undefined) setFreeMove(!!turnRow.free_move);
      }
      // Reactions are once-per-turn â€” clear all markers at the turn boundary.
      setReactionOffers(new Map());
      setReactionMode(null);
      setReactionFormationPicker(null);
    } finally {
      setIsEndingTurn(false);
    }
  }, [endTurn, currentTurnAlliance, alliances, units, formationsMap, turnNumber, freeMove, isEndingTurn, effectiveZones, persistMapData, scenarioId, structures, structureTemplates, addError, halloweenSiege, siegeEnemyTeams, shipMode, shipStep, shipRuntime]);

  const handleEndTurn = useCallback(async () => {
    if (isEndingTurn) return;
    await performEndTurn();
  }, [isEndingTurn, performEndTurn]);

  const saveHalloweenSiege = useCallback(async (next: HalloweenSiegeConfig | null): Promise<boolean> => {
    setHalloweenSiege(next);
    const ok = await updateScenarioField(scenarioId, { halloween_siege: next });
    if (!ok) addError('Failed to save Halloween Siege settings.');
    return ok;
  }, [scenarioId, updateScenarioField, addError]);

  const handleSaveHalloweenSiege = useCallback((next: HalloweenSiegeConfig) => {
    void saveHalloweenSiege(next).then(ok => {
      if (ok) setShowHalloweenSiege(false);
    });
  }, [saveHalloweenSiege]);

  const handleToggleHalloweenSiege = useCallback(async (enabled: boolean) => {
    const base = halloweenSiege ?? defaultHalloweenSiegeConfig();
    const next = { ...base, enabled };
    const ok = await saveHalloweenSiege(next);
    if (ok && enabled && (!isHalloweenSiegeConfigValid(next) || !next.waveStartTurns.some(start => start != null))) {
      setShowHalloweenSiege(true);
    }
  }, [halloweenSiege, saveHalloweenSiege]);

  const siegeStatus = useMemo<SiegePhase | null>(() => {
    if (!halloweenSiege?.enabled) return null;
    if (!halloweenSiege.waveStartTurns.some(start => start != null)) return null;
    if (currentTurnAlliance == null || replayMode || inReplay) return null;
    const phase = siegePhaseForTurn(halloweenSiege, turnNumber);
    return phase.kind === 'wave' || phase.kind === 'break' ? phase : null;
  }, [halloweenSiege, currentTurnAlliance, turnNumber, replayMode, inReplay]);

  const siegeSettingsLabel = useMemo(() => {
    if (!halloweenSiege?.enabled) return 'Off';
    if (!halloweenSiege.waveStartTurns.some(start => start != null)) return 'Configure and save to arm';
    if (currentTurnAlliance == null) return 'Armed â€” starts on the first Enemy turn';
    const phase = siegePhaseForTurn(halloweenSiege, turnNumber);
    if (phase.kind === 'before') return 'Armed â€” waiting for the first Enemy turn';
    if (phase.kind === 'complete') return 'Siege complete';
    if (phase.kind === 'break') {
      return halloweenSiege.nextWaveStartTurn != null
        ? `Break â€” Wave ${phase.waveNumber} armed for the next Enemy turn`
        : `Break â€” Wave ${phase.waveNumber} ready`;
    }
    return `Wave ${phase.waveNumber} â€” turn ${phase.turnInWave}/${phase.turnsPerWave}`;
  }, [halloweenSiege, currentTurnAlliance, turnNumber]);

  const canToggleNextWave = !!(
    effectiveIsGM &&
    !replayMode &&
    !inReplay &&
    halloweenSiege?.enabled &&
    siegeStatus?.kind === 'break'
  );
  const nextWaveArmed = halloweenSiege?.nextWaveStartTurn != null;

  const handleToggleNextSiegeWave = useCallback(() => {
    if (!effectiveIsGM || !halloweenSiege?.enabled || siegeStatus?.kind !== 'break') return;
    const arming = halloweenSiege.nextWaveStartTurn == null;
    if (arming && siegeEnemyTeams.length === 0) {
      addError('Halloween Siege: assign at least one team to the Enemy alliance before starting the next wave.');
      return;
    }
    const next = toggleNextWaveArm(halloweenSiege, currentTurnAlliance, turnNumber);
    void saveHalloweenSiege(next).then(ok => {
      if (!ok) return;
      addMessage(
        arming
          ? `Halloween Siege â€” Wave ${siegeStatus.waveNumber} armed for the next Enemy turn.`
          : `Halloween Siege â€” Wave ${siegeStatus.waveNumber} start cancelled.`,
      );
    });
  }, [effectiveIsGM, halloweenSiege, siegeStatus, siegeEnemyTeams, currentTurnAlliance, turnNumber, saveHalloweenSiege, addError, addMessage]);

  const spawnHalloweenWave = useCallback(async (
    config: HalloweenSiegeConfig,
    phase: Extract<SiegePhase, { kind: 'wave' }>,
  ) => {
    const wave = config.waves[phase.waveIndex];
    if (!wave) return;
    const enemyTeams = TEAMS.filter(team => allianceOf(team, alliances) === 'enemy');
    if (enemyTeams.length === 0) {
      addError('Halloween Siege: no team is assigned to the Enemy alliance â€” assign one in the Alliances tab.');
      return;
    }

    try {
      const templates = await fetchUnitTemplates();
      const byId = new Map(templates.map(template => [template.id, template]));
      const entries = wave.entries.filter(entry => {
        const template = byId.get(entry.templateId);
        return !!template && !template.isHero && entry.percent > 0;
      });
      const plan = planSiegeSpawn({
        wave: { ...wave, entries },
        enemyTeams,
        gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
        occupied: computeOccupiedHexes(units, undefined, 0),
      });
      if (plan.length === 0) {
        addError(`Halloween Siege â€” Wave ${phase.waveNumber}: no free rim hex or valid monster template.`);
        return;
      }

      let spawned = 0;
      const teamCounts: Record<string, number> = {};
      for (const row of plan) {
        const template = byId.get(row.templateId);
        if (!template) continue;
        const unit = await addUnitFromTemplate(template, row.hex, row.team);
        if (!unit) continue;
        await placeUnit(unit);
        spawned += 1;
        teamCounts[row.team] = (teamCounts[row.team] ?? 0) + 1;
      }

      if (spawned === 0) {
        addError(`Halloween Siege â€” Wave ${phase.waveNumber}: failed to spawn any monsters.`);
        return;
      }

      const split = Object.entries(teamCounts).map(([team, count]) => `${team} ${count}`).join(' Â· ');
      addMessage(
        `Halloween Siege â€” Wave ${phase.waveNumber}: ${spawned} monster${spawned === 1 ? '' : 's'} spawned${split ? ` (${split})` : ''}.`,
      );
      if (spawned < wave.count) {
        addError(`Halloween Siege â€” Wave ${phase.waveNumber}: only ${spawned}/${wave.count} monsters could be placed.`);
      }
    } catch (err) {
      console.error('[HalloweenSiege] spawn failed', err);
      addError(`Halloween Siege â€” Wave ${phase.waveNumber}: spawn failed.`);
    }
  }, [alliances, backgroundConfig, units, addUnitFromTemplate, placeUnit, addMessage, addError]);

  useEffect(() => {
    if (!effectiveIsGM || replayMode || inReplay) return;
    const config = halloweenSiege;
    if (!config?.enabled) return;
    if (currentTurnAlliance !== 'enemy') return;

    const phase = siegePhaseForTurn(config, turnNumber);
    const spawnDue = phase.kind === 'wave' && config.lastSpawnedTurn !== turnNumber;
    const shouldStart = phase.kind === 'break'
      && config.nextWaveStartTurn != null
      && turnNumber >= config.nextWaveStartTurn;
    if ((spawnDue || shouldStart) && siegeSpawnTurnRef.current === turnNumber) return;

    const hasUnroutedEnemy = units.some(unit =>
      !unit.isDeleted &&
      (unit.currentUnitHp ?? 0) > 0 &&
      !isUnitRouted(unit) &&
      allianceOf(unit.team, alliances) === 'enemy',
    );
    const completedWave = completedWaveForPhase(config, phase, config.lastSpawnedTurn);
    const shouldAnnounce = !spawnDue
      && shouldAnnounceWaveCompletion(config, completedWave)
      && !hasUnroutedEnemy;

    if (!spawnDue && !shouldStart && !shouldAnnounce) return;

    let nextConfig = config;
    let spawnPhase: Extract<SiegePhase, { kind: 'wave' }> | null = null;

    if (shouldAnnounce && completedWave != null) {
      nextConfig = { ...nextConfig, announcedWave: completedWave, announcedWaveTurn: turnNumber };
    }
    if (shouldStart) {
      const started = beginNextWave(nextConfig, turnNumber);
      if (started) {
        nextConfig = { ...started.config, lastSpawnedTurn: turnNumber };
        spawnPhase = {
          kind: 'wave',
          waveIndex: started.waveIndex,
          waveNumber: started.waveIndex + 1,
          turnInWave: 1,
          turnsPerWave: Math.max(1, Math.floor(nextConfig.turnsPerWave) || 1),
        };
      }
    } else if (spawnDue && phase.kind === 'wave') {
      nextConfig = { ...nextConfig, lastSpawnedTurn: turnNumber };
      spawnPhase = phase;
    }

    if (!shouldAnnounce && !spawnPhase) return;
    if (spawnPhase) siegeSpawnTurnRef.current = turnNumber;

    void saveHalloweenSiege(nextConfig).then(ok => {
      if (!ok) {
        if (spawnPhase && siegeSpawnTurnRef.current === turnNumber) siegeSpawnTurnRef.current = null;
        return;
      }
      if (shouldAnnounce && completedWave != null) {
        showToast(`Congratulations! You completed wave ${completedWave}.`);
      }
      if (spawnPhase) {
        void spawnHalloweenWave(nextConfig, spawnPhase).finally(() => {
          if (siegeSpawnTurnRef.current === turnNumber) siegeSpawnTurnRef.current = null;
        });
      }
    });
  }, [effectiveIsGM, replayMode, inReplay, halloweenSiege, currentTurnAlliance, turnNumber, units, alliances, saveHalloweenSiege, spawnHalloweenWave, showToast]);

  const clearFreeMoveTimer = useCallback(() => {
    if (freeMoveTimeoutRef.current) { clearTimeout(freeMoveTimeoutRef.current); freeMoveTimeoutRef.current = null; }
    if (freeMoveTickRef.current) { clearInterval(freeMoveTickRef.current); freeMoveTickRef.current = null; }
    setFreeMoveRemaining(null);
  }, []);

  // Whenever free move flips off (manual toggle, auto-off, or End Turn) clear the
  // countdown. Unmount cleanup clears both timers too.
  useEffect(() => {
    if (!freeMove) clearFreeMoveTimer();
  }, [freeMove, clearFreeMoveTimer]);
  useEffect(() => () => clearFreeMoveTimer(), [clearFreeMoveTimer]);

  const handleToggleFreeMove = useCallback(async () => {
    if (!effectiveIsGM) return;
    const next = !freeMove;
    if (next) {
      // Arming the countdown on an explicit ON (the Turn-0 default is untouched).
      clearFreeMoveTimer();
      const endsAt = Date.now() + FREE_MOVE_AUTO_OFF_MS;
      const tick = () => setFreeMoveRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
      tick();
      freeMoveTickRef.current = setInterval(tick, 500);
      freeMoveTimeoutRef.current = setTimeout(() => {
        clearFreeMoveTimer();
        setFreeMove(false);
        void updateScenarioField(scenarioId, { free_move: false });
        addMessage(`Free Move auto-disabled after ${FREE_MOVE_AUTO_OFF_MS / 1000}s`);
      }, FREE_MOVE_AUTO_OFF_MS);
    } else {
      clearFreeMoveTimer();
    }
    setFreeMove(next);
    await updateScenarioField(scenarioId, { free_move: next });
    addMessage(`Free Move ${next ? 'enabled' : 'disabled'} â€” ${next ? 'all moves are free' : 'normal movement restored'}`);
  }, [effectiveIsGM, freeMove, scenarioId, updateScenarioField, addMessage, clearFreeMoveTimer]);

  const handleSaveBackground = useCallback((config: MapBackgroundConfig) => {
    setBackgroundConfig(config);
    void persistMapData({ backgroundConfig: config });
  }, [persistMapData]);

  const handlePreviewMapConfig = useCallback((config: Partial<MapBackgroundConfig>) => {
    setBackgroundConfig(prev => ({
      imageUrl: prev?.imageUrl ?? '',
      offsetX: prev?.offsetX ?? 0,
      offsetY: prev?.offsetY ?? 0,
      scale: prev?.scale ?? 1,
      gridRadius: prev?.gridRadius ?? DEFAULT_GRID_RADIUS,
      ...config,
    }));
  }, []);

  // Shared reaction-offer source: every client derives offers from the command
  // log (the move is a logged MOVE command), so the archer's OWNER sees the bow
  // even though the mover is on another client. Runs on INSERT and UPDATE (undo
  // sets deleted_at / redo clears it), prunes markers that became invalid, clears
  // a consumed archer's marker everywhere, and resets everything on END_TURN.
  const offerRef = useRef(offerReactionsFor);
  offerRef.current = offerReactionsFor;
  const unitsRef = useRef(units);
  unitsRef.current = units;
  // Per-unit last MOVE origin, kept from the live command stream so a rout can flee
  // the attacker's actual incoming direction even when the attack carried no explicit
  // launch hex (a hover/charge-move + attack): the atomic swoop's prepended MOVE and
  // an earlier hover MOVE both land here.
  const lastMoveFromRef = useRef(new Map<string, Hex>());
  const handleCommandLogEventRef = useRef((row: CommandLogRow) => {});
  handleCommandLogEventRef.current = (row) => {
    const steps = parseSubSteps(row.sub_steps);
    if (row.deleted_at == null) {
      for (const step of steps) {
        if (step.type !== 'MOVE' || !step.unitId) continue;
        const hc = step.changes.find(c => c.field === 'hex');
        if (hc && hc.from && typeof hc.from === 'object') lastMoveFromRef.current.set(step.unitId, hc.from as Hex);
      }
    }
    if (row.action_type === 'ROUT') {
      // Routed-retreat + pursuit orchestration (owner modal when multiple options).
      void routFlowRef.current?.handle(row);
      return;
    }
    if (row.action_type === 'END_TURN') {
      setReactionOffers(new Map());
      setReactionMode(null);
      setReactionFormationPicker(null);
    } else {
      for (const step of steps) {
        if (step.type !== 'MOVE') continue;
        // Only live rows re-offer (INSERT and redo; an undone move is skipped).
        if (row.deleted_at != null) continue;
        const hexChange = step.changes.find(c => c.field === 'hex');
        if (!hexChange || typeof hexChange.to !== 'object' || hexChange.to === null) continue;
        const mover = unitsRef.current.find(u => u.id === step.unitId);
        if (!mover) continue;
        // Use the logged end hex as the mover's position (authoritative, and not
        // racy with the units realtime stream). NO immediate prune here: the local
        // `units` may not have the mover's new hex yet, and a stale-position prune
        // would delete a just-created valid offer (the 4-hex-vs-range boundary bug).
        // Re-validation happens via the useEffect below once `units` lands.
        offerRef.current({ ...mover, hex: hexChange.to as Hex });
      }
    }

    // Authoritative convergence on EVERY client: refetch the units this command
    // wrote so the DB's final state always wins. The per-change server writes emit
    // multiple realtime events per unit with the SAME command_seq, and the client's
    // stale-guard drops all but the first â€” leaving non-actors (e.g. the DM) on an
    // intermediate state (stale formation / archerReactionUsed â†’ bow still shown).
    // This is the same refetch the executing client does in execute() and undo/redo.
    const touched: string[] = [];
    for (const step of steps) {
      if (step.unitId && step.type !== 'ALLIANCE' && step.type !== 'SCENARIO') touched.push(step.unitId);
    }
    if (touched.length > 0) refreshUnitsByIds(Array.from(new Set(touched)));
  };

  useEffect(() => {
    const handler = (payload: any) => handleCommandLogEventRef.current(payload.new as CommandLogRow);
    const channel = supabase
      .channel(`command-reactions:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scenario_command_log', filter: `scenario_id=eq.${scenarioId}` },
        handler,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'scenario_command_log', filter: `scenario_id=eq.${scenarioId}` },
        handler,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scenarioId]);


  const {
    pendingAttack,
    setPendingAttack,
    pendingAttackCap,
    setPendingAttackCap,
    pendingChargeAttack,
    setPendingChargeAttack,
    pendingChargeThrough,
    setPendingChargeThrough,
    pendingWeaponSwitch,
    confirmWeaponSwitch,
    cancelWeaponSwitch,
    pendingMountTarget,
    confirmMountTarget,
    cancelMountTarget,
    pendingAttackChoice,
    setPendingAttackChoice,
    offerAttackChoice,
    confirmAttackChoice,
    cancelAttackChoice,
    performAttack,
    performChargeEnd,
    finishChargeAfterAttack,
    performPursuits,
    handleAttackRequest,
    planSwoopDrop,
    performSwoopDrop,
    performClimbAttack,
  } = useCombatActions({
    units,
    alliances,
    formationsMap,
    sizeCategories,
    walls,
    structures,
    structureTemplates,
    execute,
    addMessage,
    addError,
    unitMaxMP,
    maybeAutoReturnToRanged,
    canControlUnit,
    flashRangeViolation,
    magicCast,
    playerId,
    playerName,
    setAttachModal,
    elevateUnit,
    canAttackTarget: canAttackInFog,
    groundZones: effectiveZones,
    freeMove,
    archerReactionEnabled,
    gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
  });
  pursuitsRef.current = performPursuits;

  // ---- Routed retreat + pursuit orchestration (deterministic path) ----
  const applyRoutedFlow = useCallback(async (routed: Unit, path: RoutPath, attacker?: Unit | null, heroChoice: 'move' | 'stay' = 'move') => {
    if (routBusy.current) { console.warn('[RoutFlow] busy â€” skipped', routed.unitName); return; }
    routBusy.current = true;
    setRetreatPick(null);
    setRetreatHoverHex(null);
    console.info('[RoutFlow] begin', routed.unitName, path.dest ? 'move' : 'none');
    try {
      const cur = unitsRef.current;
      const start = cur.find(u => u.id === routed.id);
      if (!start || start.isDeleted) { console.warn('[RoutFlow] unit gone', routed.id); return; }
      const vacated = { ...start.hex };
      const sim = cur.map(u => ({ ...u }));
      let live = sim.find(u => u.id === routed.id)!;

      const throughAll: string[] = [];
      let finalDest: Hex | null = null;
      let blockedReason = path.reason;

      // Re-evaluate after every hop. The pure path may pass through friendlies to
      // reach an empty hex, but if a new empty opens up after one push-through we
      // stop there instead of executing the old precomputed tail.
      for (let hop = 0; hop < 64; hop++) {
        let stepPath: RoutPath;
        try {
          stepPath = routRetreatPath({
            routed: live,
            units: sim,
            alliances,
            formationsMap,
            structures,
            templates: structureTemplates,
            terrainCosts: zoneMpCosts,
            walls,
            allowPassThrough: throughAll.length === 0,
            attacker,
            attackerFrom: null,
            gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
          });
        } catch (err) {
          console.error('[RoutFlow] step error:', err);
          break;
        }
        blockedReason = stepPath.reason ?? blockedReason;
        if (!stepPath.dest) break;
        if (stepPath.through.length === 0) {
          finalDest = stepPath.dest;
          break;
        }
        const hopHex = stepPath.path[0];
        const throughId = stepPath.through[0];
        if (!hopHex || !throughId) break;
        const through = sim.find(u => u.id === throughId);
        const subSteps: SubStep[] = [{
          type: 'MOVE',
          description: `${live.unitName} routs through ${through?.unitName ?? 'a friendly unit'}`,
          unitId: live.id,
          changes: [{ field: 'hex', from: live.hex, to: hopHex }],
        }];
        if (through && stepPath.scatters.includes(throughId)) {
          subSteps.push({
            type: 'FORMATION',
            description: `${through.unitName} disrupted by the rout â€” Scattered`,
            unitId: through.id,
            changes: [{ field: 'currentFormation', from: through.currentFormation, to: 'Scattered' }],
          });
          through.currentFormation = 'Scattered';
        }
        await execute('MOVE', subSteps, `${live.unitName} routs!`, { chained: true });
        live.hex = hopHex;
        throughAll.push(throughId);
      }

      const didMove = !!finalDest || throughAll.length > 0;
      if (finalDest) {
        const dest = finalDest;
        if (throughAll.length > 0) {
          const names = throughAll.map(id => cur.find(u => u.id === id)?.unitName ?? 'a friendly unit').join(', ');
          addMessage(`${live.unitName} routs through ${names} to (${dest.q}, ${dest.r}).`);
        }
        const subSteps: SubStep[] = [{
          type: 'MOVE',
          description: `${live.unitName} routs to (${dest.q}, ${dest.r})`,
          unitId: live.id,
          changes: [{ field: 'hex', from: live.hex, to: dest }],
        }];
        const hero = findAttachedHero(live, cur);
        if (hero) {
          if (heroChoice === 'stay') {
            subSteps.push(heroDetachStep(hero, `${hero.unitName} stays behind as ${live.unitName} routs`));
          } else {
            subSteps.push(heroRideMoveStep(hero, dest, `${hero.unitName} routs with ${live.unitName}`));
          }
        }
        await execute('MOVE', subSteps, `${live.unitName} routs!`, { chained: true });
        live.hex = dest;
        addMessage(`${live.unitName} routed to (${dest.q}, ${dest.r})`);
      } else {
        addMessage(`${live.unitName} has nowhere to retreat: ${blockedReason ?? 'no legal hex'}. It stands, routed.`);
        addMessage(`${live.unitName} cannot move â€” it will face a FREE pursue attack if an enemy is in reach.`);
      }

      // Pursuit: leaving the kill zone is resolved by performPursuits. The router
      // is already Routed (no scatter); a rout-through makes the pursuer strike
      // the friendly that let it pass; the roll preference prefers `attacker`.
      // A router with no legal retreat (`!didMove`) is CORNERED â€” every eligible
      // ZoC unit strikes it in place.
      await performPursuits(live, vacated, didMove ? live.hex : vacated, {
        attacker: attacker ?? null,
        cornered: !didMove,
        throughUnitId: throughAll[0] ?? undefined,
        deferRouting: true,
      });
    } finally {
      routBusy.current = false;
      console.info('[RoutFlow] done');
    }
  }, [unitsRef, alliances, formationsMap, zoneMpCosts, walls, execute, addMessage, performPursuits, verboseCombat]);

  const handleRoutRow = useCallback(async (row: CommandLogRow) => {
    if (row.deleted_at != null) return;
    if (routedHandled.current.has(row.id)) return;
    const steps = parseSubSteps(row.sub_steps);
    const rStep = steps.find(s => s.type === 'ROUT');
    if (!rStep || !rStep.unitId) return;
    console.info('[RoutFlow] ROUT row', row.id, rStep.unitId);
    const routed = unitsRef.current.find(u => u.id === rStep.unitId);
    if (!routed || routed.isDeleted || routed.isHero || (routed.currentUnitHp ?? 1) <= 0) {
      console.warn('[RoutFlow] skip routed guard', routed?.isDeleted, routed?.currentUnitHp);
      return;
    }
    if (routBusy.current || retreatPick) { console.warn('[RoutFlow] busy/pick open'); return; }
    routedHandled.current.add(row.id);
    // Who caused the rout (attacker/caster/archer) so the pursuer prefers them.
    const causePayload = rStep.payload as { cause?: string; causeFrom?: { q: number; r: number; s: number } } | undefined;
    const causeId = causePayload?.cause;
    const attacker = causeId ? unitsRef.current.find(u => u.id === causeId && !u.isDeleted) ?? null : null;
    // A swoop lands the attacker on the victim's hex; its launch hex is the real
    // "incoming direction" the rout flees away from. Fall back to the attacker's
    // last MOVE origin (a hover/charge-move approach) when the payload has none.
    const attackerFrom = causePayload?.causeFrom ?? (causeId ? lastMoveFromRef.current.get(causeId) ?? null : null);
    // Which client orchestrates: the routed unit's owner; the DM fills in when no
    // non-GM participant controls the team.
    const ownerPeers = participantsSync.participants.filter(p => p.role !== 'GM' && p.team === routed.team);
    const isOwner = !effectiveIsGM && myTeam === routed.team;
    const dmActs = effectiveIsGM && ownerPeers.length === 0;
    if (!isOwner && !dmActs) { console.warn('[RoutFlow] not owner/dm', myTeam, routed.team, ownerPeers.length); return; }
    let pathOut: RoutPath = { dest: null, scatters: [], through: [], path: [], reason: 'no legal hex' };
    try {
      pathOut = routRetreatPath({
        routed,
        units: unitsRef.current,
        alliances,
        formationsMap,
        structures,
        templates: structureTemplates,
        terrainCosts: zoneMpCosts,
        walls,
        attacker,
        attackerFrom,
        gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
      });
      console.info('[RoutFlow] path', pathOut.dest, pathOut.through.length, pathOut.scatters.length);
    } catch (err) {
      console.error('[RoutFlow] path error:', err);
    }
    if (typeof window !== 'undefined') {
      setRetreatCardPos({ x: Math.max(8, Math.round((window.innerWidth - 480) / 2)), y: Math.max(8, Math.round((window.innerHeight - 320) / 2)) });
    }
    setRetreatHoverHex(null);
    setRetreatHeroChoice('move');
    setRetreatPick({ unit: routed, attacker, path: pathOut, hero: findAttachedHero(routed, unitsRef.current) });
  }, [unitsRef, alliances, formationsMap, structures, structureTemplates, backgroundConfig, participantsSync.participants, myTeam, effectiveIsGM, retreatPick, applyRoutedFlow]);
  routFlowRef.current = { handle: handleRoutRow };

  // Local-window rout event (dispatched by routeUnit on the acting client): open
  // the retreat modal immediately instead of waiting on realtime.
  useEffect(() => {
    const onLocalRout = (e: Event) => {
      const d = (e as CustomEvent<{ unitId: string; causeId?: string | null; causeFrom?: { q: number; r: number; s: number } | null }>).detail;
      if (!d?.unitId) return;
      const pseudo: CommandLogRow = {
        id: `local-rout-${d.unitId}`,
        scenario_id: scenarioId,
        player_id: playerId,
        player_name: '',
        action_type: 'ROUT',
        description: 'local rout',
        sub_steps: [{ type: 'ROUT', description: 'local rout', unitId: d.unitId, changes: [], payload: (d.causeId || d.causeFrom) ? { ...(d.causeId ? { cause: d.causeId } : {}), ...(d.causeFrom ? { causeFrom: d.causeFrom } : {}) } : undefined }],
        chained: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
        seq: 0,
      };
      void routFlowRef.current?.handle(pseudo);
    };
    window.addEventListener('quitter:rout', onLocalRout);
    return () => window.removeEventListener('quitter:rout', onLocalRout);
  }, [scenarioId, playerId]);

  const onRetreatDragStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    retreatDragRef.current = { dx: e.clientX - retreatCardPos.x, dy: e.clientY - retreatCardPos.y };
  };
  const onRetreatDragMove = (e: React.PointerEvent) => {
    if (!retreatDragRef.current) return;
    setRetreatCardPos({ x: e.clientX - retreatDragRef.current.dx, y: e.clientY - retreatDragRef.current.dy });
  };
  const onRetreatDragEnd = () => { retreatDragRef.current = null; };


  const {
    pendingCastOverBudget,
    setPendingCastOverBudget,
    handleResolveCast,
    requestResolveCast,
  } = useCastActions({
    magicCast,
    units,
    alliances,
    formationsMap,
    isGM: effectiveIsGM,
    playerId,
    execute,
    addError,
    resolveShipAreaCast,
  });

  const {
    handleMouseMove,
    handleMouseLeave,
    handleMouseDown,
    handleMouseUp,
    handleRightClick,
    hoveredHex,
    draggingUnitId,
    draggingShipId,
    getShipAtScreen,
    offsetX,
    offsetY,
    zoom,
    getHexFromScreen,
    getUnitAt,
    getUnitAtScreen,
    getWallEdgeAt,
    centerMap,
    centerOn,
    panBy,
  } = useHexGrid({
    canvasRef,
    size: HEX_SIZE,
    gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
    units: displayUnits,
    ships: interactiveShips,
    onShipMove: controlsLocked ? () => {} : handleShipMove,
    onShipRightClick: (grabbable, clientX, clientY) => {
      if (controlsLocked) return;
      if (shipFireMode || shipRamMode) { setShipFireMode(null); setShipRamMode(null); return; }
      const ship = shipRuntime.find(s => s.id === grabbable.id);
      if (!ship) return;
      if (!effectiveIsGM && !canControlShip(ship, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance)) return;
      const estW = 200;
      const estH = 220;
      const px = Math.max(8, Math.min(clientX, (typeof window !== 'undefined' ? window.innerWidth : 0) - estW - 8));
      const py = Math.max(8, Math.min(clientY, (typeof window !== 'undefined' ? window.innerHeight : 0) - estH - 8));
      setContextMenuUnit(null);
      setContextMenuShip(ship);
      setContextMenuPos({ x: px, y: py });
    },
    onShipClick: (ship, clientX, clientY) => {
      if (controlsLocked) return;
      if (tryShipRam(ship.hex)) return;
      if (tryShipFire(ship.hex)) return;
      const live = shipRuntime.find(s => s.id === ship.id);
      if (live && shipMode === 'wildspace' && live.declaredRound !== turnNumber
          && canControlShip(live, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance)) {
        openSpeedPanel(live.id);
      }
      setSelectedShipId(ship.id);
      setSelectedHex(null);
      setSelectedUnit(null);
      void clientX; void clientY;
    },
    canGrabShip: grabbable => {
      if (controlsLocked) return false;
      const ship = shipRuntime.find(s => s.id === grabbable.id);
      return !!ship && canControlShip(ship, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance);
    },
    onUnitMove: controlsLocked
      ? () => {}
      : reactionMode
        ? (unitId, targetHex) => { if (unitId === reactionMode.archer.id) handleReactionMove(unitId, targetHex); }
        : (unitId, targetHex) => {
            const u = units.find(x => x.id === unitId);
            if (!u || !canControlUnit(u)) return;
            // Withdraw is disabled while airborne: a drop onto a would-be withdraw
            // hex reports the error instead of moving.
            if (isAirborne(u.elevation, structureSurfaceAt(u.hex, structures, structureTemplates)) && !freeMove && canWithdraw(u) && !u.isCharging) {
              const occupied = computeOccupiedHexes(units, unitId);
              const threatHexes = computeThreatHexes(units, unitId, alliances, formationsMap, structures, structureTemplates, threatShips);
              const dests = withdrawDestinations(u, occupied, threatHexes);
              if (dests.some(hx => hx.q === targetHex.q && hx.r === targetHex.r)) {
                addError('Cannot withdraw during flight.');
                return;
              }
            }
            // A drag one hex into a rear hex is a WITHDRAW (2 actions, no face
            // change, no scatter/pursue) â€” not a normal move. Confirm the cost.
            // Under free-move there is no cost, so it is just a free move.
            if (!freeMove && canWithdraw(u) && !u.isCharging) {
              const occupied = computeOccupiedHexes(units, unitId);
              const threatHexes = computeThreatHexes(units, unitId, alliances, formationsMap, structures, structureTemplates, threatShips);
              const dests = withdrawDestinations(u, occupied, threatHexes);
              if (dests.some(hx => hx.q === targetHex.q && hx.r === targetHex.r)) {
                setWithdrawConfirm({ unit: u, dest: targetHex });
                return;
              }
            }
            handleUnitMove(unitId, targetHex);
          },
    onHexClick: (hex, _unit, clientX, clientY) => {
      // A ship ram/weapon is armed for targeting: this click is the target.
      if (tryShipRam(hex)) return;
      if (tryShipFire(hex)) return;
      // Locked reaction mode: only Esc ends it; clicks are inert.
      if (reactionMode) return;
      // A clone is armed: this click places it (consumes the click).
      if (handleCloneClick(hex)) return;
      // GM structure brush: place (or select) a structure on the nearest edge / hex.
      if (effectiveIsGM && structurePaletteId && clientX !== undefined && clientY !== undefined) {
        const anchor = structureTemplates[structurePaletteId]?.anchor;
        if (anchor === 'edge') {
          const dir = edgeDirAtClient(hex, clientX, clientY);
          if (dir !== null) void paintStructureEdge(hex.q, hex.r, dir);
        } else if (anchor === 'hex') {
          void paintStructureHex(hex.q, hex.r);
        }
        return;
      }
      // Effect zones: GM or any assigned player may paint.
      if (zoneTemplate && canPaintZones) { void placeOrToggleZone(hex.q, hex.r); return; }
      setSelectedHex(hex);
      setSelectedUnit(null);
    },
    onUnitClick: (unit, _clientX, _clientY) => {
      if (controlsLocked || reactionMode) return;
      if (tryShipRam(unit.hex)) return;
      if (tryShipFire(unit.hex)) return;
      if (handleCloneClick(unit.hex)) return;
      setSelectedUnit(unit);
      // Clicking an archer's reaction button arms that archer's reaction mode.
      if (!unit.isDeleted && !unit.archerReactionUsed && reactionOffers.has(unit.id) && canReactToUnit(unit)) {
        setReactionMode({ archer: unit, moverId: reactionOffers.get(unit.id)! });
        return;
      }
      // A front- or back-attached hero reacts from its host's click when the host
      // itself has no offer (its bow is drawn on the hero's sub-token). A back
      // hero only has an offer when the mover is in its host's rear cone.
      const reactingHero = units.find(u =>
        u.attachedToUnitId === unit.id && (u.attachedPosition === 'front' || u.attachedPosition === 'back') && !u.isDeleted &&
        !u.archerReactionUsed && reactionOffers.has(u.id) && canReactToUnit(u));
      if (reactingHero) {
        setReactionMode({ archer: reactingHero, moverId: reactionOffers.get(reactingHero.id)! });
        return;
      }
      // AI assist: a plain click on an AI-eligible token toggles its opt-out
      // (âœ“ included <-> grey "skipped" badge). Clicks are ignored mid-Execute.
      if (canUseAiAssist && !aiBusy) {
        const aiHostedBy = new Set<string>();
        for (const u of units) if (u.attachedToUnitId && !u.isDeleted) aiHostedBy.add(u.attachedToUnitId);
        if (
          !unit.isDeleted &&
          isAiControllable(unit, { alliances, teams: aiTeams, activeAlliance: currentTurnAlliance, gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS }, aiHostedBy)
        ) {
          toggleAiExcluded(unit.id);
        }
      }
    },
    onHexRightClick: (hex, unit, clientX, clientY) => {
      if (controlsLocked) return;
      if (shipFireMode || shipRamMode) { setShipFireMode(null); setShipRamMode(null); return; }
      if (cloneZone) { setCloneZone(null); return; }
      // GM structure brush: right-click removes the nearest structure.
      if (effectiveIsGM && structurePaletteId) {
        const anchor = structureTemplates[structurePaletteId]?.anchor;
        if (anchor === 'edge') {
          const dir = edgeDirAtClient(hex, clientX, clientY);
          if (dir !== null) void clearStructureKey(edgeRef(hex.q, hex.r, dir).key);
        } else if (anchor === 'hex') {
          void clearStructureKey(`${hex.q},${hex.r}`);
        }
        return;
      }
      if (reactionMode) {
        // Locked: only the reacting archer's right-click changes formation.
        if (unit && unit.id === reactionMode.archer.id) {
          setReactionFormationPicker(unit);
        }
        return;
      }
      if (unit && !unit.isDeleted && (effectiveIsGM || ((!unit.hidden && canControlUnit(unit)) && canSeeHex(unit.hex)))) {
        setContextMenuShip(null);
        setContextMenuUnit(unit);
        // Keep the menu on-screen (tooltip-style clamp).
        const estW = 260;
        const estH = 460;
        const px = Math.max(8, Math.min(clientX, (typeof window !== 'undefined' ? window.innerWidth : 0) - estW - 8));
        const py = Math.max(8, Math.min(clientY, (typeof window !== 'undefined' ? window.innerHeight : 0) - estH - 8));
        setContextMenuPos({ x: px, y: py });
        return;
      }
      // Empty hex with ground-effect zones â†’ "Effects at hex" menu.
      if (hex && groundZones.some(z => z.q === hex.q && z.r === hex.r)) {
        const px = Math.max(8, Math.min(clientX, (typeof window !== 'undefined' ? window.innerWidth : 0) - 240));
        const py = Math.max(8, Math.min(clientY, (typeof window !== 'undefined' ? window.innerHeight : 0) - 260));
        setZoneMenu({ hex, x: px, y: py });
      }
    },
    onUnitHover: (unit, screenX, screenY) => {
      if (retreatPick) return; // suppress tooltips while the rout modal is open
      if (unit.isDeleted || (unit.hidden && !effectiveIsGM)) return;
      if (!effectiveIsGM && !canSeeHex(unit.hex)) return;
      setHoveredShip(null);
      setHoveredUnit(unit);
      setTooltipPos({ x: screenX, y: screenY });
    },
    onUnitLeave: () => {
      dismissUnitTooltip();
    },
    onShipHover: (grabbable, screenX, screenY) => {
      if (retreatPick) return;
      const ship = shipRuntime.find(s => s.id === grabbable.id && !s.isDeleted);
      if (!ship?.hex) return;
      if (ship.hidden && !effectiveIsGM) return;
      if (!effectiveIsGM && !canSeeHex(ship.hex)) return;
      setHoveredUnit(null);
      setHoveredShip({ ship, x: screenX, y: screenY });
    },
    onShipLeave: () => setHoveredShip(null),
    onAttack: controlsLocked ? undefined : (attackerId, targetId) => {
      if (reactionMode) { requestReactionAttack(attackerId, targetId); return; }
      const attacker = units.find(u => u.id === attackerId);
      const target = units.find(u => u.id === targetId);
      // A CLIMBING unit dropped on its target occupant, while still below the wall
      // top, continues climbing (it only stops at the top). At/above the top it
      // falls through to a normal attack (gated to the wall top in combat).
      if (attacker && target && attacker.climbTo) {
        const t = parseClimbTo(attacker.climbTo);
        if (t && target.hex.q === t.q && target.hex.r === t.r) {
          const topSurf = structureSurfaceAt(target.hex, structures, structureTemplates);
          if ((attacker.elevation ?? 0) < topSurf) { void handleUnitMove(attackerId, target.hex); return; }
        }
      }
      // A fly-capable unit dropped on a GROUND-occupied hex opens the unified flyer
      // modal (Move / Swoop attack / Range attack) when the hex is a legal fly
      // destination. An air-occupied hex is not a destination â†’ plain attack.
      if (attacker && target && canFly(attacker) && (target.elevation ?? 0) <= 0) {
        const hostile = isHostile(attacker.team, target.team, alliances);
        const hostileVisible = hostile && canAttackInFog(attacker, target);
        const canSwoop = hostileVisible && !!planSwoopDrop(attackerId, targetId);
        if ((hostileVisible || !hostile) && beginFlyerDrop(attacker, target, { canSwoop, isHostile: hostileVisible })) return;
      }
      // Ground attacker vs a garrison on a HIGHER structure top: offer Climb & attack
      // (melee after scaling the wall) or attack from the ground (ranged).
      if (attacker && target && !attacker.climbTo && !canFly(attacker) && !attacker.mountId && !attacker.mountName
          && isHostile(attacker.team, target.team, alliances)
          && areHexesAdjacent(attacker.hex, target.hex)) {
        const top = structureSurfaceAt(target.hex, structures, structureTemplates);
        if (top > (attacker.elevation ?? 0) && (target.elevation ?? 0) >= top) {
          setPendingClimbAttack({ attackerId, targetId, garrison: target.unitName });
          return;
        }
      }
      // Ground / airborne drop: offer the combined weapon + mount/rider picker
      // when there is a real choice (>1 weapon can attack, or the target rides a
      // rider); otherwise attack directly.
      if (offerAttackChoice(attackerId, targetId)) return;
      void handleAttackRequest(attackerId, targetId);
    },
    walls,
    canAttackWallEdge: (unitId, edge) => (reactionMode ? false : canAttackWallEdge(unitId, edge)),
    canAttemptWallEdge: (unitId, edge) => (reactionMode ? false : canAttemptWallEdge(unitId, edge)),
    onAttackWall: (unitId, edge) => {
      const unit = units.find(u => u.id === unitId);
      if (unit) void performWallAttack(unit, edge);
    },
    canAttemptStructure: (unitId, hex) => (reactionMode ? false : canAttemptStructure(unitId, hex)),
    onAttackStructure: (unitId, hex) => {
      const unit = units.find(u => u.id === unitId);
      if (unit) void performStructureAttack(unit, hex);
    },
    onHoverWallEdge: setHoveredWallEdge,
    onHoverStructureHex: setHoveredStructureHex,
    targetFilter,
    onHexHover: (hex, x, y) => setInfoHover({ kind: 'hex', hex, x, y }),
    onEdgeHover: (edge, x, y) => setInfoHover({ kind: 'edge', edge, x, y }),
    onHexLeave: () => setInfoHover(null),
    onEdgeLeave: () => setInfoHover(null),
    canGrabUnit: (unit) => (reactionMode ? unit.id === reactionMode.archer.id : canControlUnit(unit)),
    onGrabUnit: (unit) => { if (unit.attachedToUnitId) setActiveHeroId(unit.id); },
    onPing: (hex) => pingAtHex(hex, playerName, pingColor),
    activeHeroId,
    customDraw,
    autoCenter: isInitialLoad,
    backgroundImage: backgroundConfig ? { url: backgroundConfig.imageUrl, offsetX: backgroundConfig.offsetX, offsetY: backgroundConfig.offsetY, scale: backgroundConfig.scale } : null,
    overlayMap,
    readOnly: controlsLocked,
  });
  // Keep the dragged unit visible in every filter mode (read by useCanvasDraw).
  draggedUnitIdRef.current = draggingUnitId;

  const handleHeroDropToMap = useCallback((heroId: string, clientX: number, clientY: number) => {
    const hero = units.find(u => u.id === heroId && !u.isDeleted);
    const shipId = hero?.attachedToShipId;
    const ship = shipId ? shipRuntime.find(s => s.id === shipId) : undefined;
    if (!hero || !ship?.hex) return;
    const hex = getHexFromScreen(clientX, clientY);
    if (!hex) return;
    void handleDisembarkHero(heroId, hex);
  }, [units, shipRuntime, getHexFromScreen, handleDisembarkHero]);

  // When the rout modal opens: center the map on the routed unit and clear hover
  // so the tooltip never covers it.
  useEffect(() => {
    if (retreatPick) {
      dismissTooltips();
      setRetreatHoverHex(null);
      centerOn(retreatPick.unit.hex);
    }
  }, [retreatPick, centerOn, dismissTooltips]);

  // Any modal/dialog opened over the canvas must hide the hover tooltips so they
  // never cover (or float above) the dialog. The canvas has no reliable leave
  // event while an overlay is under the cursor, so clear on the open edge too.
  // Rotate / about-turn soft gate: a rotate costs 1 MP (2 for a mounted
  // about-turn, plus an org drop); when the unit has neither the pool nor a
  // convertible action, confirm first (MP/actions may go negative). Free
  // rotations (Scattered/Routed/free-move) never prompt.
  const [pendingRotate, setPendingRotate] = useState<PendingRotate | null>(null);
  const requestRotate = useCallback((unit: Unit, direction: 'left' | 'right', steps: number) => {
    const surface = structureSurfaceAt(unit.hex, structures, structureTemplates);
    const freeRotate = unit.isHero || freeMove || unit.currentFormation === 'Scattered' || isUnitRouted(unit);
    // A mounted Close-Order about-turn is blocked â€” let rotateUnit report it.
    if (steps === 3 && (unit.mountId || unit.mountName) && unit.currentFormation === 'Close Order') {
      void rotateUnit(unit, direction, unitMaxMP(unit), steps, surface);
      return;
    }
    // War machine in Open Order: each 60Â° step costs 2 actions (no MP).
    const wmActionCost = warMachineTurnActionCost(unit, steps);
    if (wmActionCost != null) {
      if ((unit.actionsAvailable ?? 0) >= wmActionCost) {
        void rotateUnit(unit, direction, unitMaxMP(unit), steps, surface);
      } else {
        setPendingRotate({ unit, direction, steps, cost: wmActionCost, poolLabel: 'actions', kind: 'actions' });
      }
      return;
    }
    const fly = isAirborne(unit.elevation, surface) && canFly(unit);
    const pool = fly ? (unit.flySpeedAvailable ?? 0) : unit.movementPointsAvailable;
    const cost = steps === 3
      ? (unit.mountId || unit.mountName ? getSetting('about_turn_cost_mounted', 2) : getSetting('about_turn_cost_foot', 1))
      : 1;
    if (isRotationAffordable(pool, unit.actionsAvailable ?? 0, cost, freeRotate)) {
      void rotateUnit(unit, direction, unitMaxMP(unit), steps, surface);
    } else {
      setPendingRotate({ unit, direction, steps, cost, poolLabel: fly ? 'FP' : 'MP' });
    }
  }, [structures, structureTemplates, freeMove, rotateUnit, unitMaxMP]);

  const anyModalOpen = !!(
    contextMenuUnit || withdrawConfirm || effectMenuUnit || retreatPick ||
    reactionFormationPicker || showScenarioSettings || showHalloweenSiege || attachModal ||
    pendingMountTarget || pendingAttackChoice || pendingReactionChoice || freePlacement || freePlacementAir || pendingElevation || pendingHeroFall ||
    pendingStructureAction || pendingClimbAttack ||
    pendingLeaveHero || showGmTeamPick || magicCast.cast || editUnit || effectDrop ||
    effectEdit || entryPrompt || zoneMenu || hexEffectsModal || showStats || sharedStats ||
    otherActionHero || structureEditKey ||
    pendingDescent ||
    pendingMove || pendingAttack || pendingAttackCap || pendingHeroAttachConversion ||
    pendingAttachOverBudget ||
    pendingFormation || pendingCastOverBudget || pendingChargeAttack ||
    pendingRotate ||
    pendingChargeThrough || pendingWeaponSwitch || pendingWallAttack
  );
  useEffect(() => {
    if (anyModalOpen) dismissTooltips();
  }, [anyModalOpen, dismissTooltips]);

  // The aim facing for a loose (facing-less) charger's single front wedge â€” from
  // its hex toward the cursor hex. Recomputed only when the aim crosses a 60Â°
  // sector, so the heavier overlay below recomputes only then.
  const chargeAimFacing = useMemo(() => {
    if (!draggingUnitId || !hoveredHex) return null;
    const u = units.find(x => x.id === draggingUnitId);
    if (!u || !u.isCharging || !isLooseUnit(u, formationsMap[u.currentFormation])) return null;
    if (u.hex.q === hoveredHex.q && u.hex.r === hoveredHex.r) return null;
    return facingToward(u.hex, hoveredHex);
  }, [draggingUnitId, hoveredHex, units, formationsMap]);

  // The drag-ghost target follows the MOUSE-OVER HITBOX: an offset token when the
  // cursor sits on one, else the hovered hex (a ground unit / structure / empty hex
  // all resolve to the hex centre). Suppressed for structure/edge drops, which use
  // their own yellow highlight instead (one indicator per drop).
  const dragGhostPos = useMemo<{ x: number; y: number } | null>(() => {
    if (!draggingUnitId || !hoveredHex) return null;
    if (hoveredStructureHex || hoveredWallEdge) return null;
    const dragged = units.find(u => u.id === draggingUnitId);
    if (!dragged) return null;
    if (dragged.hex.q === hoveredHex.q && dragged.hex.r === hoveredHex.r) return null;
    if (hoveredUnit && !hoveredUnit.isDeleted) {
      const climb = parseClimbTo(hoveredUnit.climbTo);
      const off = elevationOffset(hoveredUnit.elevation, HEX_SIZE, canFly(hoveredUnit) && !climb, climb ? hexDirection(hoveredUnit.hex, climb, HEX_SIZE) : undefined);
      const p = hexToPixel(hoveredUnit.hex, HEX_SIZE);
      return { x: p.x + off.dx, y: p.y + off.dy };
    }
    const p = hexToPixel(hoveredHex, HEX_SIZE);
    return { x: p.x, y: p.y };
  }, [draggingUnitId, hoveredHex, hoveredUnit, hoveredStructureHex, hoveredWallEdge, units]);

  // Drag-overlay highlight (reachable hexes, threat zones, range/reaction rings,
  // and the routed-retreat option being hovered in the picker).
  useEffect(() => {
    if (shipFireMode) {
      const ship = shipRuntime.find(s => s.id === shipFireMode.shipId);
      const build = ship?.snapshot?.build;
      const card = build
        ? shipWeaponCards(build).find(c => c.key === shipFireMode.cardKey)
        : undefined;
      if (ship?.hex && card) {
        const radius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
        const fills: Record<string, string> = {};
        for (let q = -radius; q <= radius; q += 1) {
          for (let r = -radius; r <= radius; r += 1) {
            const hex = { q, r, s: -q - r };
            if (!isHexOnGrid(hex, radius)) continue;
            const mode = shipAttackMode(
              hexDistance(ship.hex, hex),
              card.weapon,
              card.arcs,
              ship.hex,
              ship.facing,
              hex,
              shipFiringArcs,
            );
            if (mode.mode === 'normal') fills[`${q},${r}`] = 'rgba(255,255,255,0.22)';
            else if (mode.mode === 'disadvantage') fills[`${q},${r}`] = 'rgba(255,170,60,0.35)';
          }
        }
        setOverlayMap(fills);
        setOverlayLabels({});
        return;
      }
    }
    if (draggingShipId) {
      const ship = shipRuntime.find(s => s.id === draggingShipId);
      if (freeMove || currentTurnAlliance === null) {
        // Free Move / turn 0: show the whole grid as droppable.
        const radius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
        const freeFills: Record<string, string> = {};
        for (let q = -radius; q <= radius; q += 1) {
          for (let r = -radius; r <= radius; r += 1) {
            const s = -q - r;
            const hex = { q, r, s };
            if (isHexOnGrid(hex, radius)) freeFills[`${q},${r}`] = 'rgba(255,255,255,0.16)';
          }
        }
        setOverlayMap(freeFills);
        setOverlayLabels({});
        return;
      }
      if (ship?.hex && ship.snapshot?.stats) {
        const stats = effectiveShipStats(ship, units) ?? ship.snapshot.stats;
        const speedSpent = ship.speedSpent ?? 0;
        const startSurface = structureSurfaceAt(ship.hex!, structures ?? {}, structureTemplates);
        const startGrounded = shipIsGrounded(ship.elevation, startSurface);
        const pools = shipAtmospherePools(ship, stats);
        const legalPool = shipMode === 'wildspace'
          ? shipStepRemaining({ stepBudget: ship.stepBudget, step: shipStep, speedSpent }, shipStep)
          : Math.max(0, Math.floor(startGrounded ? pools.mpRemaining : pools.fpRemaining));
        const speedForMC = shipMode === 'wildspace'
          ? (ship.declaredRound === turnNumber ? ship.declaredSpeed : (ship.lastSpeed ?? 5))
          : (stats.atmosphericSpeed ?? 5);
        const airTurnDistance = shipTurnDistance(stats, speedForMC, shipMode, ship.mcReduction ?? 0);
        const groundTurnDistance = startGrounded && pools.mcZero ? 0 : airTurnDistance;
        const shipElevation = Math.max(0, Math.round(ship.elevation ?? 0));
        const blocked = (q: number, r: number) => {
          const inst = structures?.[`${q},${r}`];
          if (!inst) return false;
          return structureSurfaceAt({ q, r }, structures ?? {}, structureTemplates) > shipElevation;
        };
        const occupied = new Set<string>();
        for (const u of units) {
          if (!u.isDeleted && !u.attachedToUnitId) occupied.add(`${u.hex.q},${u.hex.r}`);
        }
        for (const s of shipRuntime) {
          if (s.id !== ship.id && s.hex && !s.isDeleted) occupied.add(`${s.hex.q},${s.hex.r}`);
        }
        const start = { hex: ship.hex, facing: ship.facing, turnsSinceFacing: ship.turnsSinceFacing };
        const opts = { occupied, blocked };
        let legal: Map<string, ShipReachEntry>;
        if (shipMode === 'wildspace') {
          legal = computeShipReachable(start, legalPool, airTurnDistance, opts);
        } else {
          legal = new Map();
          computeShipReachable(start, Math.floor(pools.mpRemaining), groundTurnDistance, opts).forEach((v, k) => legal.set(k, v));
          computeShipReachable(start, Math.floor(pools.fpRemaining), airTurnDistance, opts).forEach((v, k) => legal.set(k, v));
        }
        const shipFills: Record<string, string> = {};
        const shipLabels: Record<string, string> = {};
        if (shipMode === 'wildspace') {
          // Potential = this step's remainder + every later step in the turn.
          const future = (ship.stepBudget ?? [])
            .slice(shipStep)
            .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
          const potentialPool = legalPool + future;
          if (potentialPool > legalPool) {
            const potential = computeShipReachable(start, potentialPool, airTurnDistance, opts);
            for (const [key, entry] of Array.from(potential.entries())) {
              if (entry.cost === 0 || legal.has(key)) continue;
              shipFills[key] = 'rgba(90, 170, 255, 0.22)';
              shipLabels[key] = `~${Math.max(0, potentialPool - entry.cost)}`;
            }
          }
        }
        for (const [key, entry] of Array.from(legal.entries())) {
          if (entry.cost === 0) continue;
          shipFills[key] = entry.endable ? 'rgba(255,255,255,0.32)' : 'rgba(255,170,60,0.4)';
          shipLabels[key] = shipMode === 'wildspace'
            ? String(Math.max(0, legalPool - entry.cost))
            : `${startGrounded ? 'M' : 'F'}${Math.max(0, Math.floor((startGrounded ? pools.mpRemaining : pools.fpRemaining) - entry.cost))}`;
        }
        setOverlayMap(shipFills);
        setOverlayLabels(shipLabels);
        return;
      }
    }
    const { fills, labels } = computeOverlayMap({ reactionMode, draggingUnitId, hoveredUnit, units, alliances, formationsMap, freeMove, backgroundConfig, rangeViolationHex, terrainCosts: zoneMpCosts, walls, structures, templates: structureTemplates, zones: effectiveZones, threatShips, shipObstacles, chargeFacing: chargeAimFacing, reactiveArchery: archerReactionEnabled, showAllMoveMp, movePreviewMode });
    if (retreatHoverHex) fills[retreatHoverHex] = 'rgba(255, 220, 90, 0.55)';
    setOverlayMap(fills);
    setOverlayLabels(labels);
  }, [reactionMode, draggingUnitId, draggingShipId, shipRuntime, shipMode, shipStep, turnNumber, currentTurnAlliance, hoveredUnit, units, alliances, formationsMap, freeMove, backgroundConfig, rangeViolationHex, zoneMpCosts, walls, structures, structureTemplates, effectiveZones, threatShips, shipObstacles, hoveredWallEdge, retreatHoverHex, chargeAimFacing, archerReactionEnabled, showAllMoveMp, movePreviewMode, shipFireMode, shipFiringArcs]);

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

  // Fetch what's undoable/redoable from the server (derived from the command
  // log alone â€” no client-side stack), and refresh it when the log changes.
  useEffect(() => {
    if (loading) return;
    refreshUndoState();
    const unsubscribe = subscribeToCommandLog();
    return unsubscribe;
  }, [loading, scenarioId, refreshUndoState, subscribeToCommandLog]);

  // ---- Drag from panel ----
  const handleUnitDragStart = useCallback((template: UnitTemplate) => {
    if (controlsLocked) {
      if (dryDockSessionActive) addError('The table is paused while the dry dock is open.');
      return;
    }
    setDraggingTemplate(template);
    setIsDraggingFromPanel(true);
  }, [controlsLocked, dryDockSessionActive, addError]);

  const handleShipDragStart = useCallback((entry: ShipLibraryEntry) => {
    if (controlsLocked) {
      if (dryDockSessionActive) addError('The table is paused while the dry dock is open.');
      return;
    }
    setDraggingCampaign(null);
    setDraggingShip(entry);
  }, [controlsLocked, dryDockSessionActive, addError]);

  const handleCampaignDragStart = useCallback((root: CampaignShip) => {
    if (controlsLocked) {
      if (dryDockSessionActive) addError('The table is paused while the dry dock is open.');
      return;
    }
    setDraggingShip(null);
    setDraggingCampaign(root);
  }, [controlsLocked, dryDockSessionActive, addError]);

  useEffect(() => {
    const activeEntry = draggingShip;
    const campaignRoot = draggingCampaign;
    if (!activeEntry && !campaignRoot) return;
    const onMouseMove = (e: MouseEvent) => {
      if (canvasRef.current) {
        setGhostHex(getHexFromScreen(e.clientX, e.clientY));
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (window.getSelection) window.getSelection()?.removeAllRanges();
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const inCanvas =
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (inCanvas) {
          const hex = getHexFromScreen(e.clientX, e.clientY);
          if (hex) {
            if (campaignRoot) {
              setCampaignDrop({ root: campaignRoot, hex });
            } else if (activeEntry) {
              const displayName = activeEntry.template.name;
              if (ships.some(ship => ship.hex.q === hex.q && ship.hex.r === hex.r)) {
                addMessage(`Can't place ${displayName}: a ship is already on that hex`);
              } else if (!activeEntry.build || !activeEntry.stats) {
                addMessage(`Can't place ${displayName}: the ship build could not be resolved`);
              } else {
                const id = crypto.randomUUID();
                const runtimeManifest = activeEntry.template.manifest;
                const template = activeEntry.template;
                const build = {
                  ...activeEntry.build,
                  manifest: runtimeManifest,
                  performanceMass: Math.max(
                    1,
                    activeEntry.build.totalMass - computeCargoCapacity(activeEntry.build) + cargoManifestMass(runtimeManifest),
                  ),
                };
                const stats = computeShipBuild(build);
                void (async () => {
                  const { data: serialData } = await supabase.rpc('next_scenario_serial', { p_scenario_id: scenarioId });
                  // Atmosphere ships enter airborne; never start embedded in a
                  // structure, so use at least the structure top.
                  const shipElevation = shipMode === 'atmosphere'
                    ? Math.max(10, structureSurfaceAt(hex, structures, structureTemplates))
                    : 0;
                  const row = shipRowFromParts({
                    id,
                    scenarioId,
                    template,
                    build,
                    stats,
                    hex,
                    serialNumber: Number(serialData) || 0,
                    elevation: shipElevation,
                  });
                  await execute(
                    'PLACE',
                    [{
                      type: 'SHIP',
                      unitId: id,
                      description: `Placed ship "${displayName}"`,
                      changes: [{ field: 'row', from: null, to: row }],
                    }],
                    `Placed ship "${displayName}"`,
                  );
                })();
              }
            }
          }
        }
      }
      setDraggingShip(null);
      setDraggingCampaign(null);
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
  }, [draggingShip, draggingCampaign, ships, scenarioId, execute, addMessage, getHexFromScreen, shipMode, structures, structureTemplates]);

  /**
   * Place a campaign version on the map. `makeCampaign` adds a new campaign row
   * in the same command (a CAMPAIGN sub-step), so undo removes it again while it
   * is still an orphan.
   */
  const placeCampaignShip = useCallback(async (args: {
    root: CampaignShip;
    version: CampaignShip;
    hex: Hex;
    full: boolean;
    makeCampaign: boolean;
    name: string;
  }) => {
    const { root, version, hex, full, makeCampaign } = args;
    const entrySnapshot = version.snapshot;
    if (!entrySnapshot) { addError('This campaign version has no design snapshot.'); return; }
    if (ships.some(ship => ship.hex.q === hex.q && ship.hex.r === hex.r)) {
      addMessage(`Can't place ${campaignBaseName(version)}: a ship is already on that hex`);
      return;
    }
    if (makeCampaign && campaignSlotTaken(campaignStore.ships, version.id, scenarioId)) {
      addError('This scenario already has a campaign version of that ship; evolve it first.');
      return;
    }

    const runtimeManifest = normalizeCargoManifest(
      full || version.cargo.length === 0 ? entrySnapshot.template.manifest : version.cargo,
    );
    const template = { ...entrySnapshot.template, manifest: runtimeManifest };
    const build = {
      ...entrySnapshot.build,
      manifest: runtimeManifest,
      performanceMass: Math.max(
        1,
        entrySnapshot.build.totalMass - computeCargoCapacity(entrySnapshot.build) + cargoManifestMass(runtimeManifest),
      ),
    };
    const stats = computeShipBuild(build);
    const id = crypto.randomUUID();
    const { data: serialData } = await supabase.rpc('next_scenario_serial', { p_scenario_id: scenarioId });
    const serialNumber = Number(serialData) || 0;
    const shipElevation = shipMode === 'atmosphere'
      ? Math.max(10, structureSurfaceAt(hex, structures, structureTemplates))
      : 0;

    const shipHpMax = Math.max(1, full ? Math.round(stats.shipHp) : version.shipHpMax);
    const shipHp = full ? shipHpMax : Math.min(version.shipHp, shipHpMax);
    const minHpAttained = full ? shipHpMax : Math.min(version.minHpAttained, shipHp);

    let campaignId = version.id;
    let campaignCarrier = false;
    const subSteps: SubStep[] = [];
    let displayName = campaignBaseName(version);

    if (makeCampaign) {
      const numeral = campaignNextNumeral(version, campaignStore.ships);
      const baseName = (args.name.trim() || version.name);
      const newCampaignId = crypto.randomUUID();
      const scenarioLabel = scenarioName ?? '';
      const row = {
        id: newCampaignId,
        ownerId: currentUser?.id ?? null,
        parentId: version.id,
        name: baseName,
        numeral,
        scenarioId,
        scenarioLabel,
        templateId: template.id,
        serialNumber,
        shipHp,
        shipHpMax,
        minHpAttained,
        damage: full ? {} : version.damage,
        crewState: full ? {} : version.crewState,
        cargo: runtimeManifest,
        snapshot: { template, build, stats },
        occupiesSlot: true,
      };
      subSteps.push({
        type: 'CAMPAIGN',
        unitId: newCampaignId,
        description: `Campaign ship "${campaignDisplayName({ ...version, name: baseName, numeral })}"`,
        changes: [{ field: 'row', from: null, to: row }],
      });
      campaignId = newCampaignId;
      campaignCarrier = true;
      displayName = campaignBaseName({ name: baseName, numeral });
    }

    const row = shipRowFromParts({
      id,
      scenarioId,
      template,
      build,
      stats,
      hex,
      name: displayName,
      serialNumber,
      campaignId,
      campaignCarrier,
      shipHp,
      shipHpMax,
      minHpAttained,
      elevation: shipElevation,
      damage: full ? {} : version.damage,
      crewState: full ? {} : version.crewState,
    });
    subSteps.push({
      type: 'SHIP',
      unitId: id,
      description: `Placed ship "${displayName}"`,
      changes: [{ field: 'row', from: null, to: row }],
    });

    setCampaignDrop(null);
    await execute(
      'PLACE',
      subSteps,
      `Placed ship "${displayName}" (${campaignDisplayName(version)}, ${full ? 'Full' : 'Latest'})`,
    );
    await campaignStore.reload();
  }, [ships, scenarioId, shipMode, structures, structureTemplates, addMessage, addError, execute, campaignStore, currentUser, scenarioName]);

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
            const options = buildFreePlacementOptionsFor({
              hex,
              isHero: !!draggingTemplate.isHero,
              canFly: (draggingTemplate.flySpeed ?? 0) > 0,
              team: 'black',
              allowAnyUnit: true,
              mountId: draggingTemplate.mountId,
              mountName: draggingTemplate.mountName,
              sizeCategory: draggingTemplate.sizeCategory,
            });
            if (options.length === 0) {
              addMessage(`Can't place ${draggingTemplate.unitName}: no free level at that hex`);
            } else if (options.length === 1) {
              await placeUnitFromSelector(draggingTemplate, hex, options[0]);
            } else {
              openFreePlacement({
                title: `Place ${draggingTemplate.unitName}`,
                subtitle: `(${hex.q}, ${hex.r})`,
                options,
                onChoose: option => placeUnitFromSelector(draggingTemplate, hex, option),
              });
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
  }, [isDraggingFromPanel, draggingTemplate, addMessage, getHexFromScreen, buildFreePlacementOptionsFor, placeUnitFromSelector, openFreePlacement]);

  // Screenshot is captured in goToLobby (button).
  // beforeunload is unreliable for async â€” not used.
  const goToLobby = async () => {
    if (isGM) {
      await captureAndUploadScreenshot();
      await fetchScenarios();
    }
    localStorage.removeItem('currentScenarioId');
    window.location.reload();
  };

  // Double-click a unit you can edit opens the floating editor.
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (controlsLocked || reactionMode || shipFireMode || shipRamMode) return;
    // Shift + double-click (map-inspect mode) edits a placed structure instance:
    // the DM always; a player only for a door they control (unit on the door hex).
    // With no structure (or alongside one) it edits the hex's ground effects.
    if (e.shiftKey) {
      const hex = getHexFromScreen(e.clientX, e.clientY);
      if (hex) {
        // Prefer a nearby EDGE structure first (the SAME order as the tooltip), so the
        // wall wins inside the shared hit band; fall back to the clicked hex's structure.
        const edge = getWallEdgeAt(e.clientX, e.clientY);
        let key: string | null = edge && structures[edge.key] ? edge.key : null;
        if (!key) {
          const hexKey = `${hex.q},${hex.r}`;
          if (structures[hexKey]) key = hexKey;
        }
        if (key && structureTemplates[structures[key].templateId]) {
          if (isGM || canToggleStructureDoor(key, structures, structureTemplates, units, isGM, canControlUnit)) {
            setStructureEditKey(key);
            return;
          }
        }
        // No (editable) structure: edit the hex's ground effects instead.
        if (groundZones.some(z => z.q === hex.q && z.r === hex.r)) {
          setHexEffectsModal(hex);
          return;
        }
      }
    }
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (!hex) return;
    // Point-based hit test â€” the SAME resolver as hover (elevation/attachment
    // offset aware), so a double-click opens the unit under the cursor even when
    // its token is drawn off its logical hex centre.
    const unit = getUnitAtScreen(e.clientX, e.clientY);
    if (!unit) {
      const ship = getShipAtScreen(e.clientX, e.clientY);
      if (ship) {
        setSelectedShipId(ship.id);
        setShipWindowId(ship.id);
        return;
      }
      return;
    }
    if (unit.hidden && !effectiveIsGM) return;
    if (effectiveIsGM || canEditUnit(unit)) setEditUnit(unit);
  }, [controlsLocked, reactionMode, shipFireMode, shipRamMode, getHexFromScreen, getUnitAtScreen, getShipAtScreen, getWallEdgeAt, effectiveIsGM, canEditUnit, structures, structureTemplates, units, isGM, canControlUnit, groundZones]);

  // Editor Save â†’ one chained command entry, one sub-step per changed field.
  const handleEditorSave = useCallback(async (changes: { field: string; from: any; to: any }[], description: string) => {
    if (!editUnit) return;
    const subSteps = changes.map(c => ({
      type: 'EDIT_UNIT' as const,
      description,
      unitId: editUnit.id,
      changes: [c],
    }));
    // Surface a failed write instead of silently leaving the editor thinking it saved.
    const row = await execute('EDIT_UNIT', subSteps, description, { chained: true });
    if (!row) {
      addError(`Unit edit failed â€” ${description}. Nothing was saved.`);
      return;
    }
  }, [editUnit, execute, addError]);

  // A kicked player is booted back to the Lobby.
  const kicked = participantsSync.kicked;
  useEffect(() => {
    if (!kicked) return;
    const t = setTimeout(() => { goToLobby(); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kicked]);

  // ---- Role detection + DM heartbeat (reliable disconnect lock/recovery) ----
  useEffect(() => {
    let cancelled = false;
    const pollRef = { current: 0 as any };
    let beatTimer: any = null;

    const check = async () => {
      if (cancelled) return;
      const { data } = await supabase
        .from('scenarios')
        .select('dm_heartbeat_at')
        .eq('id', scenarioId)
        .single();
      if (cancelled) return;
      const beat = data?.dm_heartbeat_at ? new Date(data.dm_heartbeat_at).getTime() : null;
      // Lock immediately when the heartbeat stops: one missed 5s beat (~7s) is
      // enough â€” no 20s reconnect grace for things to happen in.
      const stale = beat !== null && Date.now() - beat > DM_HEARTBEAT_STALE_MS;
      setDmGone(stale);
    };

    getMyRole(scenarioId).then(role => {
      if (cancelled) return;
      const gm = role === 'GM';
      setIsGM(gm);

      // Reader (everyone, incl. the GM): poll dm_heartbeat_at and lock when the
      // beat is stale. A fresh beat automatically unlocks â€” players can sit in
      // the scenario and wait for the DM; no refresh needed. Null = no beat yet
      // (treat as online; the join gate already required the DM online).
      check();
      pollRef.current = setInterval(check, DM_HEARTBEAT_POLL_MS);

      // Writer (GM only, NOT gated by controlsLocked â€” otherwise a disconnected
      // GM could never recover): keep dm_heartbeat_at fresh while in the map.
      if (gm && !replayMode) {
        const beat = () => {
          supabase.rpc('heartbeat_dm', { p_scenario_id: scenarioId })
            .then(({ error }) => { if (error) console.error('[heartbeat_dm] Failed:', error.message); });
        };
        beat();
        beatTimer = setInterval(beat, DM_HEARTBEAT_INTERVAL_MS);
      }
    });

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (beatTimer) clearInterval(beatTimer);
    };
  }, [scenarioId, getMyRole, replayMode]);

  // ---- Load formations lookup (session-cached) ----
  useEffect(() => {
    let cancelled = false;
    getFormations().then(map => {
      if (!cancelled) setFormationsMap(map);
    });
    return () => { cancelled = true; };
  }, []);

  // ---- Load tunable settings into the module cache (combat reads these) ----
  useEffect(() => {
    loadSettings();
  }, []);

  // ---- Load map background config + painted overlays ----
  useEffect(() => {
    fetchScenarioMapData(scenarioId).then(data => {
      setBackgroundConfig({
        imageUrl: data?.backgroundImageUrl ?? '',
        offsetX: data?.bgOffsetX ?? 0,
        offsetY: data?.bgOffsetY ?? 0,
        scale: data?.bgScale ?? 1,
        gridRadius: data?.gridRadius ?? DEFAULT_GRID_RADIUS,
      });
      setStructures(parseStructures(data?.structures));
      setGroundZones(normalizeGroundEffectKinds(Array.isArray(data?.groundEffects) ? data.groundEffects : []));
  
      setMapId(data?.mapId ?? null);
    });
  }, [scenarioId, fetchScenarioMapData]);

  // ---- Load & track turn state ----
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('scenarios')
      .select('current_turn_alliance, turn_number, free_move, archer_reaction_enabled, mounted_charge_enabled, verbose_combat, fog_of_war, sight_radius, ai_assist_enabled, ai_assist_players, hero_morale_boost_enabled, zoc_pursuit_enabled, halloween_siege, ship_mode, ship_firing_arcs, ship_step')
      .eq('id', scenarioId)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const loadedTurn = data.turn_number || 0;
        setCurrentTurnAlliance(data.current_turn_alliance || null);
        setTurnNumber(loadedTurn);
        // Free move is a permanent default only in Turn 0 free play. A leftover ON
        // from a mid-game quick session resets OFF when the scenario is (re)opened
        // so it can't persist indefinitely; persisted so every client agrees (a
        // realtime full-row update would otherwise resurrect it).
        if (!replayMode && loadedTurn > 0 && (data.free_move ?? false)) {
          setFreeMove(false);
          void updateScenarioField(scenarioId, { free_move: false });
        } else {
          setFreeMove(data.free_move ?? false);
        }
        setArcherReactionEnabled(data.archer_reaction_enabled ?? false);
        setMountedChargeEnabled(data.mounted_charge_enabled ?? true);
        setVerboseCombat(data.verbose_combat ?? false);
        setFogOfWar(data.fog_of_war ?? false);
        setSightRadius(data.sight_radius ?? DEFAULT_SIGHT_RADIUS);
        setAiAssistEnabled(data.ai_assist_enabled ?? false);
        setAiAssistPlayers(data.ai_assist_players ?? false);
        setHeroMoraleBoostEnabled(data.hero_morale_boost_enabled ?? true);
        setZocPursuitEnabled(data.zoc_pursuit_enabled ?? true);
        setShipMode(data.ship_mode === 'wildspace' ? 'wildspace' : 'atmosphere');
        setShipFiringArcs(data.ship_firing_arcs ?? true);
        setShipStep(Math.min(5, Math.max(1, Number(data.ship_step) || 1)));
        setHalloweenSiege(parseHalloweenSiegeConfig(data.halloween_siege));
      });
    return () => { cancelled = true; };
  }, [scenarioId, replayMode, updateScenarioField]);

  useEffect(() => {
    const channel = supabase
      .channel(`scenario_turn:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'scenarios', filter: `id=eq.${scenarioId}` },
        (payload: any) => {
          const row = payload.new as Record<string, any>;
          if (row.current_turn_alliance !== undefined) {
            setCurrentTurnAlliance(row.current_turn_alliance || null);
          }
          if (row.turn_number !== undefined) {
            setTurnNumber(row.turn_number || 0);
          }
          if (row.free_move !== undefined) {
            setFreeMove(row.free_move);
          }
          if (row.archer_reaction_enabled !== undefined) {
            setArcherReactionEnabled(row.archer_reaction_enabled);
          }
          if (row.mounted_charge_enabled !== undefined) {
            setMountedChargeEnabled(row.mounted_charge_enabled ?? true);
          }
          if (row.verbose_combat !== undefined) {
            setVerboseCombat(row.verbose_combat ?? false);
          }
          if (row.fog_of_war !== undefined) {
            setFogOfWar(row.fog_of_war ?? false);
          }
          if (row.sight_radius !== undefined) {
            setSightRadius(row.sight_radius ?? DEFAULT_SIGHT_RADIUS);
          }
          if (row.ai_assist_enabled !== undefined) {
            setAiAssistEnabled(!!row.ai_assist_enabled);
          }
          if (row.ai_assist_players !== undefined) {
            setAiAssistPlayers(!!row.ai_assist_players);
          }
          if (row.hero_morale_boost_enabled !== undefined) {
            setHeroMoraleBoostEnabled(row.hero_morale_boost_enabled ?? true);
          }
          if (row.zoc_pursuit_enabled !== undefined) {
            setZocPursuitEnabled(row.zoc_pursuit_enabled ?? true);
          }
          if (row.ship_mode !== undefined) {
            setShipMode(row.ship_mode === 'wildspace' ? 'wildspace' : 'atmosphere');
          }
          if (row.ship_firing_arcs !== undefined) {
            setShipFiringArcs(row.ship_firing_arcs ?? true);
          }
          if (row.ship_step !== undefined) {
            setShipStep(Math.min(5, Math.max(1, Number(row.ship_step) || 1)));
          }
          if (row.halloween_siege !== undefined) {
            setHalloweenSiege(parseHalloweenSiegeConfig(row.halloween_siege));
          }
          if (row.map_data !== undefined) {
            // Ignore a reordered/pre-delete snapshot (older than what we last applied)
            // so a deleted structure can't be re-added as a ghost.
            const at = row.updated_at as string | undefined;
            const stale = !!at && !!lastMapDataAtRef.current && at < lastMapDataAtRef.current;
            if (!stale) {
              if (at) lastMapDataAtRef.current = at;
              const md = row.map_data || {};
              if (md.structures !== undefined) setStructures(parseStructures(md.structures));
              if (md.groundEffects !== undefined) setGroundZones(normalizeGroundEffectKinds(Array.isArray(md.groundEffects) ? md.groundEffects : []));
              if (md.mapId !== undefined) setMapId(md.mapId ?? null);
              if (md.backgroundImageUrl !== undefined) {
                setBackgroundConfig({
                  imageUrl: md.backgroundImageUrl ?? '',
                  offsetX: md.bgOffsetX ?? 0,
                  offsetY: md.bgOffsetY ?? 0,
                  scale: md.bgScale ?? 1,
                  gridRadius: md.gridRadius ?? DEFAULT_GRID_RADIUS,
                });
              }
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scenarioId]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (controlsLocked) return;
      // Esc ends the locked reaction mode (or closes the formation picker) â€” as
      // if nothing happened; the reaction marker stays. Also clears the token
      // selection.
      if (e.key === 'Escape') {
        setSelectedUnit(null);
        if (shipFireMode || shipRamMode) {
          setShipFireMode(null);
          setShipRamMode(null);
          return;
        }
        if (zoneTemplate || structurePaletteId) {
          setZoneTemplate(null);
          setStructurePaletteId(null);
          return;
        }
        if (reactionMode || reactionFormationPicker) {
          setReactionMode(null);
          setReactionFormationPicker(null);
          return;
        }
      }
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E') {
        // Rotate the selected token (left-click) â€” fall back to the right-clicked
        // context-menu unit for backward compatibility. Resolve to the live unit.
        const source = selectedUnit ?? contextMenuUnit;
        const live = source ? (units.find(u => u.id === source.id && !u.isDeleted) ?? source) : null;
        if (live && !live.isHero && !live.isCharging && canControlUnit(live)) {
          requestRotate(live, e.key.toLowerCase() === 'q' ? 'left' : 'right', 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controlsLocked, undo, redo, contextMenuUnit, selectedUnit, units, requestRotate, canControlUnit, reactionMode, reactionFormationPicker, zoneTemplate, structurePaletteId, shipFireMode, shipRamMode]);

  // ---- WASD map panning (always active â€” not gated by controlsLocked) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const step = getSetting('map_pan_step', 6);
      const k = e.key.toLowerCase();
      if (k === 'w') { e.preventDefault(); panBy(0, step); }
      else if (k === 'a') { e.preventDefault(); panBy(step, 0); }
      else if (k === 's') { e.preventDefault(); panBy(0, -step); }
      else if (k === 'd') { e.preventDefault(); panBy(-step, 0); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panBy]);

  // Soft-enforcement prompts: fully-bound confirm handlers (clear state +
  // controlsLocked guard + act). The modals render from the pending states.
  const softActions = {
    confirmMove: () => { const pm = pendingMove!; setPendingMove(null); if (controlsLocked) return; if (pm.climb) { void handleClimbMove(pm.unit, pm.targetHex, pm.climb.originSurface, true); return; } const surface = structureSurfaceAt(pm.unit.hex, structures, structureTemplates); const targetSurface = structureSurfaceAt(pm.targetHex, structures, structureTemplates); const airborne = isAirborne(pm.unit.elevation, surface); const max = airborne ? (pm.unit.flySpeed ?? 0) : (pm.breakToFormation ? computeEffectiveMovement(pm.unit, getFormationMultiplier(formationsMap, pm.breakToFormation, 'movement_multiplier')) : unitMaxMP(pm.unit)); const descendElev = !airborne && targetSurface <= surface ? targetSurface : undefined; completeMove(pm.unit, pm.targetHex, pm.cost, true, max, pm.attachedHero, pm.attachedHero ? unitMaxMP(pm.attachedHero) : undefined, pm.breakToFormation, descendElev, surface); },
    confirmAttack: () => { const pa = pendingAttack!; setPendingAttack(null); if (controlsLocked) return; if (pa.bombard) { void handleAttackRequest(pa.attacker.id, pa.target.id, { forceAction: true }); return; } performAttack(pa.attacker, pa.target, true, { mainTarget: pa.mainTarget, damageDice: pa.damageDice }); },
    confirmAttackCap: async () => {
      const pa = pendingAttackCap!;
      setPendingAttackCap(null);
      if (controlsLocked) return;
      if (pa.bombard) { await handleAttackRequest(pa.attacker.id, pa.target.id, { forceAction: true }); return; }
      if (pa.isCharging) {
        const result = await performAttack(pa.attacker, pa.target, true, { isCharging: true, mainTarget: pa.mainTarget, damageDice: pa.damageDice });
        if (!result) return; // attack aborted (no weapon / AGR fail)
        await finishChargeAfterAttack(pa.attacker, pa.target, result);
      } else {
        await performAttack(pa.attacker, pa.target, true, { mainTarget: pa.mainTarget, damageDice: pa.damageDice });
      }
    },
    confirmHeroAttachConversion: async () => {
      const phc = pendingHeroAttachConversion!;
      setPendingHeroAttachConversion(null);
      if (controlsLocked) return;
      await attachHero(phc.hero, phc.target, phc.position, unitMaxMP(phc.hero), phc.cost);
      addMessage(`${phc.hero.unitName} attached to ${phc.target.unitName} (${phc.position})`);
    },
    confirmAttachOverBudget: async () => {
      const pa = pendingAttachOverBudget!;
      setPendingAttachOverBudget(null);
      if (controlsLocked) return;
      addError(`${pa.hero.unitName} attached over budget â€” could not afford the ${pa.cost} MP entry cost`);
      await attachHero(pa.hero, pa.target, pa.position, unitMaxMP(pa.hero), pa.cost);
    },
    confirmFormation: async () => {
      const pf = pendingFormation!;
      setPendingFormation(null);
      if (!controlsLocked) {
        addError(`${pf.unit.unitName} changed formation over budget â€” ${getFormationChangeMpCost(pf.mode === 'fly' ? flyMax(pf.unit) : unitMaxMP(pf.unit))} ${pf.mode === 'fly' ? 'FP' : 'MP'} needed, ${pf.unit.actionsAvailable} action(s) left`);
        await changeFormation(pf.unit, pf.formation, formationsMap, structureSurfaceAt(pf.unit.hex, structures, structureTemplates));
      }
    },
    confirmCast: () => { setPendingCastOverBudget(false); if (!controlsLocked) handleResolveCast(true); },
    confirmRotate: () => {
      const pr = pendingRotate!;
      setPendingRotate(null);
      if (controlsLocked) return;
      addError(pr.kind === 'actions'
        ? `${pr.unit.unitName} turned its war machine over budget â€” going negative on actions`
        : `${pr.unit.unitName} rotated with no ${pr.poolLabel}/actions left â€” going negative`);
      void rotateUnit(pr.unit, pr.direction, unitMaxMP(pr.unit), pr.steps, structureSurfaceAt(pr.unit.hex, structures, structureTemplates));
    },
    confirmChargeAttack: async () => {
      const pca = pendingChargeAttack!;
      setPendingChargeAttack(null);
      if (controlsLocked) return;
      await performAttack(pca.attacker, pca.target, false, { mainTarget: pca.mainTarget, damageDice: pca.damageDice });
      await performChargeEnd(pca.attacker, true);
    },
    confirmChargeThrough: async () => {
      const pct = pendingChargeThrough!;
      setPendingChargeThrough(null);
      if (controlsLocked) return;
      // The charge-over MOVE chains onto the CHARGE_END (which chains onto the
      // ATTACK), so undo reverts charge attack + overrun as one atomic action.
      await performChargeEnd(pct.attacker, true);
      await moveUnitRecorded(
        pct.attacker,
        pct.landHex,
        2,
        unitMaxMP(pct.attacker),
        pct.attachedHero,
        pct.attachedHero ? unitMaxMP(pct.attachedHero) : undefined,
        `${pct.attacker.unitName} charged over ${pct.target.unitName} and landed at (${pct.landHex.q}, ${pct.landHex.r})`,
        { chained: true },
      );
    },
    declineChargeThrough: async () => {
      const pct = pendingChargeThrough!;
      setPendingChargeThrough(null);
      if (!controlsLocked) await performChargeEnd(pct.attacker, true);
    },
    confirmWeaponSwitch: () => {
      if (controlsLocked) {
        cancelWeaponSwitch();
        return;
      }
      confirmWeaponSwitch();
    },
    confirmWallAttack: async () => {
      const p = pendingWallAttack!;
      setPendingWallAttack(null);
      if (controlsLocked) return;
      const unit = units.find(u => u.id === p.attacker.id) ?? p.attacker;
      if (p.ref) await performWallAttack(unit, p.ref, true);
      else if (p.hex) await performStructureAttack(unit, p.hex, true);
    },
  };
  const softCancels = {
    move: () => setPendingMove(null),
    attack: () => setPendingAttack(null),
    attackCap: () => setPendingAttackCap(null),
    heroAttachConversion: () => setPendingHeroAttachConversion(null),
    attachOverBudget: () => setPendingAttachOverBudget(null),
    formation: () => setPendingFormation(null),
    rotate: () => setPendingRotate(null),
    castOverBudget: () => setPendingCastOverBudget(false),
    chargeAttack: () => setPendingChargeAttack(null),
    weaponSwitch: () => cancelWeaponSwitch(),
    wallAttack: () => setPendingWallAttack(null),
  };

  const aiPanelNode =
    canUseAiAssist ? (
      <AiPanel
        scenarioId={scenarioId}
        units={units}
        alliances={alliances}
        formationsMap={formationsMap}
        aiTeams={aiTeams}
        onSetAiTeams={setAiTeams}
        aiExcluded={aiExcluded}
        onToggleAiExcluded={toggleAiExcluded}
        currentTurnAlliance={currentTurnAlliance}
        fogOfWarEnabled={fogOfWar}
        sightRadius={sightRadius}
        terrainCosts={zoneMpCosts}
        walls={walls}
        structures={structures}
        structureTemplates={structureTemplates}
        groundZones={effectiveZones}
        gridRadius={backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS}
        archerReactionEnabled={archerReactionEnabled}
        chargeEnabled={mountedChargeEnabled}
        unitMaxMP={unitMaxMP}
        performMove={(unit, targetHex, cost, overBudget, maxMP, elevation) => completeMove(unit, targetHex, cost, overBudget, maxMP, undefined, undefined, undefined, elevation)}
        performAttack={(attacker, target, overBudget, options) => performAttack(attacker, target, overBudget, options)}
        rotateUnit={(unit, dir, maxMP) => rotateUnit(unit, dir, maxMP)}
        changeFormation={(unit, formation, fm) => changeFormation(unit, formation, fm)}
        charge={(unit) => chargeWithPool(unit)}
        performChargeEnd={(unit, dropOrg) => performChargeEnd(unit, dropOrg)}
        performSwoopDrop={(attackerId, targetId) => performSwoopDrop(attackerId, targetId)}
        performClimbAttack={(attackerId, targetId) => performClimbAttack(attackerId, targetId)}
        handleClimbMove={(unit, targetHex, originSurface) => handleClimbMove(unit, targetHex, originSurface)}
        performClimbOver={(unitId, farHex, descent) => performClimbOver(unitId, farHex, descent)}
        performDescentDrop={(unit, targetHex, feet) => performDescentDrop(unit, targetHex, feet)}
        selectWeapon={(unit, index) => selectWeapon(unit, index)}
        undo={undo}
        onOverlayChange={setAiOverlay}
        onBusyChange={setAiBusy}
        addMessage={addMessage}
        addError={addError}
      />
    ) : null;

  if (loading) return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading scenario...</div>;
  if (error) return <div className="w-full h-screen bg-[#0d0d1a] text-red-500 flex items-center justify-center">Error: {error}</div>;

  return (
    <div className="relative w-full h-screen bg-[#0d0d1a] overflow-hidden select-none">
      {/* Top Bar */}
      <TopBar
        roleLabel={headerRoleLabel}
        myTeam={myTeam}
        controlsLocked={controlsLocked}
        undo={undo}
        canUndo={canUndo}
        redo={redo}
        canRedo={canRedo}
        peekUndoChainLength={peekUndoChainLength}
        displayTurnNumber={displayTurnNumber}
        shipMode={shipMode}
        shipStep={shipStep}
        isGM={isGM}
        gmAsPlayer={gmAsPlayer}
        onTogglePlayerMode={isGM ? togglePlayerMode : undefined}
        currentTurnAlliance={currentTurnAlliance}
        alliances={alliances}
        handleEndTurn={handleEndTurn}
        isEndingTurn={isEndingTurn}
        handleToggleFreeMove={handleToggleFreeMove}
        freeMove={freeMove}
        freeMoveRemaining={freeMoveRemaining}
        onOpenSettings={() => setShowScenarioSettings(true)}
        replayMode={replayMode}
        inReplay={inReplay}
        onEnterReplay={() => replay.setMode('replay')}
        onBackToPlay={() => replay.setMode('play')}
        goToLobby={goToLobby}
        showStats={(isGM && !inReplay && !replayMode) || inReplay || replayMode}
        onOpenStats={() => setShowStats(true)}
        halloweenSiegeStatus={siegeStatus}
        canToggleNextWave={canToggleNextWave}
        nextWaveArmed={nextWaveArmed}
        onToggleNextWave={handleToggleNextSiegeWave}
        onHeightChange={setTopBarHeight}
      />

      {scenarioToast && (
        <Toast
          key={scenarioToast.id}
          message={scenarioToast.text}
          onClose={() => dismissToast(scenarioToast.id)}
        />
      )}

      {/* Floating Left Panel â€” hidden only in replay or when the DM is gone.
          A dry-dock pause keeps the panel (Messages/participants) usable. */}
      {!(inReplay || dmGone) && (
        <div
          className={`absolute z-10 ${panelSide === 'left' ? 'left-2' : 'right-2'}`}
          style={{ top: topBarHeight + 8 }}
        >
          <LeftPanel
            scenarioId={scenarioId}
            playerId={playerId}
            onUnitDragStart={handleUnitDragStart}
            onShipDragStart={handleShipDragStart}
            onCampaignDragStart={handleCampaignDragStart}
            canViewShipLibrary={access.canViewShipEditor}
            isGM={effectiveIsGM}
            alliances={alliances}
            onMoveTeam={handleMoveTeam}
            participants={participantsSync.participants}
            roomOpen={participantsSync.roomOpen}
            onSetRoomOpen={participantsSync.setRoomOpen}
            onSetParticipantTeam={participantsSync.setParticipantTeam}
            onSetParticipantRole={participantsSync.setParticipantRole}
            onKickParticipant={participantsSync.kickParticipant}
            backgroundConfig={backgroundConfig}
            onSaveBackground={handleSaveBackground}
            onPreviewMapConfig={handlePreviewMapConfig}
            currentMapId={mapId}
            onAssignMap={(entity) => void assignMap(entity)}
            onClearMap={() => void clearMap()}
            structureTemplates={structureTemplateLibrary}
            structurePaletteId={structurePaletteId}
            onSetStructurePaletteId={(id) => { setStructurePaletteId(id); }}
            structures={structures}
            selectedStructureKey={selectedStructureKey}
            onPatchStructure={(patch) => void patchScenarioStructure(patch)}
            onRemoveStructure={(key) => void clearStructureKey(key)}
          zoneTemplateId={zoneTemplate?.id ?? null}
          onSetZoneTemplateId={(id) => setZoneTemplate(id ? (templateById(id) ?? null) : null)}
          canUseEffects={effectiveIsGM || !!myTeam}
          side={panelSide}
            onToggleSide={togglePanelSide}
            aiPanelContent={aiPanelNode ?? undefined}
            verboseCombat={verboseCombat}
          />
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className={`w-full h-full block ${shipFireMode || shipRamMode ? 'ship-target-cursor' : 'cursor-default'}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      onContextMenu={handleRightClick}
      onDragOver={e => e.preventDefault()}
      onDrop={(e) => void handleEffectDrop(e)}
    />

      {/* In-map overlays/modals â€” dimmed to 0 while the rout card is up so the
          retreat hexes on the canvas stay visible (auto-restores when it clears). */}
      <div style={retreatPick ? { opacity: 0, pointerEvents: 'none' } : undefined}>
      {/* Attention pings (feature #4) */}
      <PingLayer pings={pings} zoom={zoom} offsetX={offsetX} offsetY={offsetY} hexSize={HEX_SIZE} />

      {/* Ghost previews */}
      {isDraggingFromPanel && ghostHex && (
        <DragGhost x={hexToPixel(ghostHex, HEX_SIZE).x} y={hexToPixel(ghostHex, HEX_SIZE).y} zoom={zoom} offsetX={offsetX} offsetY={offsetY} />
      )}
      {(draggingShip || draggingCampaign) && ghostHex && (() => {
        const entry = draggingShip;
        const previewSnapshot = draggingCampaign?.snapshot ?? null;
        const imageTemplate = entry?.template ?? previewSnapshot?.template ?? null;
        if (!imageTemplate) return null;
        return (
          <ShipDragGhost
            x={hexToPixel(ghostHex, HEX_SIZE).x}
            y={hexToPixel(ghostHex, HEX_SIZE).y}
            zoom={zoom}
            offsetX={offsetX}
            offsetY={offsetY}
            imageUrl={imageTemplate.imageUrl}
            keelLength={imageTemplate.keelLength}
            imageOffsetY={imageTemplate.imageOffsetY}
            name={draggingCampaign
              ? campaignBaseName(draggingCampaign)
              : imageTemplate.name}
          />
        );
      })()}
      {dragGhostPos && (
        <DragGhost x={dragGhostPos.x} y={dragGhostPos.y} zoom={zoom} offsetX={offsetX} offsetY={offsetY} />
      )}

      {/* Tooltip (hidden while dragging a unit â€” the drag overlay needs the
          hovered target, but the tooltip would block the drag). */}
      {hoveredUnit && tooltipPos && !draggingUnitId && (() => {
        const companion =
          displayUnits.find(u => u.attachedToUnitId === hoveredUnit.id && !u.isDeleted) ??
          (hoveredUnit.attachedToUnitId
            ? displayUnits.find(u => u.id === hoveredUnit.attachedToUnitId && !u.isDeleted)
            : undefined);
        return (
          <UnitTooltip
            unit={hoveredUnit}
            x={tooltipPos.x}
            y={tooltipPos.y}
            companion={companion}
            units={displayUnits}
            alliances={displayAlliances}
            formation={formationsMap[hoveredUnit.currentFormation] ?? null}
            companionFormation={companion ? (formationsMap[companion.currentFormation] ?? null) : undefined}
            zones={effectiveZones}
          />
        );
      })()}

      {/* Ship hover summary (hidden while the ship is being dragged). */}
      {hoveredShip && !draggingShipId && (
        <ShipTooltip
          ship={hoveredShip.ship}
          stats={effectiveShipStats(hoveredShip.ship, units)}
          mode={shipMode}
          turnNumber={turnNumber}
          x={hoveredShip.x}
          y={hoveredShip.y}
        />
      )}

      {/* Hex/edge info tooltip (structures + effects). */}
      {infoHover && (
        <MapInfoTooltip
          kind={infoHover.kind}
          hex={infoHover.hex}
          edge={infoHover.edge}
          x={infoHover.x}
          y={infoHover.y}
          structures={structures}
          templates={structureTemplates}
          zones={groundZones}
          sideBySide={targetFilter === 'structure'}
        />
      )}

      {/* Context Menu */}
      {campaignDrop && (
        <CampaignDropModal
          root={campaignDrop.root}
          versions={campaignFamily(campaignDrop.root.id, campaignStore.ships)}
          slotTakenFor={versionId => campaignSlotTaken(campaignStore.ships, versionId, scenarioId)}
          onPlace={choice => {
            const version = campaignStore.ships.find(row => row.id === choice.versionId) ?? campaignDrop.root;
            void placeCampaignShip({
              root: campaignDrop.root,
              version,
              hex: campaignDrop.hex,
              full: choice.full,
              makeCampaign: choice.makeCampaign,
              name: choice.name,
            });
          }}
          onCancel={() => setCampaignDrop(null)}
        />
      )}
      {makeCampaignTarget && (
        <div
          className="fixed inset-0 z-[260] grid place-items-center bg-black/60 p-4"
          onMouseDown={() => setmakeCampaignTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-gray-600 bg-gray-800 p-3 shadow-xl"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="mb-1 text-sm font-semibold text-amber-200">
              {makeCampaignTarget.campaignId ? 'Convert to Campaign Ship' : 'Make Campaign Ship'}
            </div>
            <p className="mb-2 text-[11px] text-gray-300">
              {makeCampaignTarget.campaignId
                ? 'This scenario copy becomes its own campaign version, parented to the version it copied. It can only be converted when this scenario has no other active version of that ship.'
                : 'The DM becomes the owner of this campaign ship. The name below is the family name; each refit adds a numbered version.'}
            </p>
            <label className="mb-2 block text-[11px] text-gray-400">
              Ship name
              <input
                type="text"
                value={makeCampaignName}
                onChange={e => setmakeCampaignName(e.target.value)}
                autoFocus
                className="mt-0.5 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-white"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setmakeCampaignTarget(null)}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = makeCampaignTarget;
                  setmakeCampaignTarget(null);
                  void handleMakeCampaignShip(target.id, makeCampaignName);
                }}
                className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-200 hover:bg-amber-700/30"
              >
                {makeCampaignTarget.campaignId ? 'Convert' : 'Make Campaign Ship'}
              </button>
            </div>
          </div>
        </div>
      )}
      {contextMenuShip && contextMenuPos && (
        <ShipContextMenu
          ship={contextMenuShip}
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          canManage={effectiveIsGM}
          canRotate={canControlShip(contextMenuShip, units, alliances, myTeam, effectiveIsGM, currentTurnAlliance)}
          onRotate={direction => void handleRotateShip(contextMenuShip.id, direction)}
          onToggleHide={() => void handleToggleShipHidden(contextMenuShip.id)}
          onDelete={() => void handleDeleteShip(contextMenuShip.id)}
          onMakeCampaignShip={effectiveIsGM && !(contextMenuShip.campaignId && contextMenuShip.campaignCarrier)
            ? () => {
              setmakeCampaignTarget(contextMenuShip);
              setmakeCampaignName(contextMenuShip.name);
            }
            : undefined}
          onDryDock={effectiveIsGM && contextMenuShip.campaignId && contextMenuShip.campaignCarrier
            ? () => void handleOpenDryDock(contextMenuShip.id)
            : undefined}
          onClose={() => { setContextMenuShip(null); setContextMenuPos(null); }}
        />
      )}
      {contextMenuUnit && contextMenuPos && (() => {
        const rallyCheck = canRally(contextMenuUnit, units, alliances, formationsMap);
        const attachedHero = contextMenuUnit.attachedToUnitId
          ? undefined
          : units.find(u => u.attachedToUnitId === contextMenuUnit.id && !u.isDeleted);
        return (
        <ContextMenu
          unit={contextMenuUnit}
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          isGM={effectiveIsGM}
          selectedWeapon={contextMenuUnit.activeWeaponIndex ?? 0}
          formationsMap={formationsMap}
          attachedHero={attachedHero}
          hostUnit={contextMenuUnit.attachedToUnitId ? units.find(u => u.id === contextMenuUnit.attachedToUnitId) : undefined}
          onSwitchToHero={(hero) => { setContextMenuUnit(hero); setActiveHeroId(hero.id); }}
          onSwitchToUnit={(host) => { setContextMenuUnit(host); setActiveHeroId(null); }}
          onOtherAction={(hero) => handleOtherAction(hero)}
          onClose={() => { setContextMenuUnit(null); setContextMenuPos(null); }}
          onRotate={(dir) => requestRotate(contextMenuUnit, dir, 1)}
          onRotate180={() => requestRotate(contextMenuUnit, 'left', 3)}
          freeMove={freeMove}
          onChangeFormation={(formation) => handleChangeFormation(contextMenuUnit, formation)}
          onCharge={() => chargeWithPool(contextMenuUnit)}
          chargeEnabled={mountedChargeEnabled}
          isAirborne={!contextMenuUnit.attachedToUnitId && isAirborne(contextMenuUnit.elevation, structureSurfaceAt(contextMenuUnit.hex, structures, structureTemplates))}
          onSwapHeroPosition={(hero) => handleSwapHeroPosition(hero)}
          onSelectWeapon={(idx) => { weaponSelectedTurnRef.current[contextMenuUnit.id] = turnNumber; selectWeapon(contextMenuUnit, idx); }}
          onAssignTeam={(team) => assignTeam(contextMenuUnit, team)}
          onAssignHeroTeam={attachedHero ? (team) => assignTeam(attachedHero, team) : undefined}
          onToggleHide={() => toggleHide(contextMenuUnit)}
          onSetRouting={() => setRouting(contextMenuUnit)}
          canRally={rallyCheck.ok}
          rallyReason={rallyCheck.reason}
          onRally={() => rallyUnit(contextMenuUnit)}
          canDropToGround={!contextMenuUnit.attachedToUnitId && !canFly(contextMenuUnit) && (contextMenuUnit.elevation ?? 0) > structureSurfaceAt(contextMenuUnit.hex, structures, structureTemplates)}
          onDropToGround={async () => {
            const f = fallSteps(contextMenuUnit, 0);
            if (f.steps.length > 0) await execute('ELEVATE', f.steps, f.note || `${contextMenuUnit.unitName} drops to the ground`);
          }}
          canLowerToGround={effectiveIsGM && !contextMenuUnit.attachedToUnitId && !canFly(contextMenuUnit) && (contextMenuUnit.elevation ?? 0) > structureSurfaceAt(contextMenuUnit.hex, structures, structureTemplates)}
          onLowerToGround={effectiveIsGM ? async () => {
            const surface = structureSurfaceAt(contextMenuUnit.hex, structures, structureTemplates);
            if ((contextMenuUnit.elevation ?? 0) > surface) {
              await execute('ELEVATE', [{
                type: 'ELEVATE',
                description: `${contextMenuUnit.unitName} lowered to the ground`,
                unitId: contextMenuUnit.id,
                changes: [{ field: 'elevation', from: contextMenuUnit.elevation ?? 0, to: surface }],
              }], `${contextMenuUnit.unitName} lowered to the ground`);
            }
          } : undefined}
          onDeleteUnit={async () => {
            const host = contextMenuUnit;
            const surface = structureSurfaceAt(host.hex, structures, structureTemplates);
            const lost = detachOnDeath(host, units, surface);
            const subSteps: SubStep[] = [
              {
                type: 'DELETE',
                description: `Removed ${host.unitName} from play`,
                unitId: host.id,
                changes: [{ field: 'isDeleted', from: false, to: true }],
              },
              ...lost.steps,
            ];
            await execute('DELETE', subSteps, lost.notes.length ? `Removed ${host.unitName} Â· ${lost.notes.join(' Â· ')}` : `Removed ${host.unitName}`);
          }}
          onAttachHero={(heroId, targetUnitId) => {
            const hero = units.find(u => u.id === heroId);
            const target = units.find(u => u.id === targetUnitId);
            if (hero && target) setAttachModal({ hero, target });
          }}
          units={units}
        />
        );
      })()}

      {/* Withdraw confirm: always warn the action cost before applying. */}
      {withdrawConfirm && (() => {
        const over = !freeMove && withdrawConfirm.unit.actionsAvailable < WITHDRAW_ACTION_COST;
        return (
          <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/50" onContextMenu={e => e.preventDefault()}>
            <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-4 w-80 text-white space-y-2">
              <p className={`text-sm font-semibold ${over ? 'text-red-300' : 'text-amber-300'}`}>Withdraw to ({withdrawConfirm.dest.q}, {withdrawConfirm.dest.r})</p>
              <p className="text-xs text-gray-300">
                {withdrawConfirm.unit.unitName} steps one hex straight back, keeping facing,{' '}
                {freeMove ? 'free (free-move).' : `costing ${WITHDRAW_ACTION_COST} actions.`}{' '}
                It never scatters and never provokes a pursue.
              </p>
              {over && (
                <p className="text-xs text-red-300">
                  Only {withdrawConfirm.unit.actionsAvailable} action(s) left â€” it will go {WITHDRAW_ACTION_COST - withdrawConfirm.unit.actionsAvailable} over budget.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { const c = withdrawConfirm; setWithdrawConfirm(null); if (c) void performWithdraw(c.unit, c.dest, over); }}
                  className={`flex-1 px-3 py-1.5 rounded border text-sm ${over ? 'bg-red-900 border-red-600 hover:bg-red-800' : 'bg-amber-800 border-amber-600 hover:bg-amber-700'}`}
                >
                  Withdraw
                </button>
                <button onClick={() => setWithdrawConfirm(null)} className="flex-1 px-3 py-1.5 rounded bg-gray-800 border border-gray-600 hover:bg-gray-700 text-sm">Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add / remove temporary effects (context menu â†’ Effectsâ€¦) */}
      {effectMenuUnit && (() => {
        const liveUnit = units.find(u => u.id === effectMenuUnit.id) ?? effectMenuUnit;
        return (
          <AddEffectModal
            unit={liveUnit}
            teamOptions={teamOptions}
            canPlaceZone={effectiveIsGM}
            onApplyForm={handleApplyUnitForm}
            onRemove={handleRemoveUnitEffect}
            onPlaceZoneForm={handlePlaceZoneForm}
            onEditEffect={e => setEffectEdit({ target: 'unit', unit: liveUnit, key: e.key, form: formFromUnitEffect(e) })}
            zones={groundZones.filter(z => z.q === liveUnit.hex.q && z.r === liveUnit.hex.r)}
            onEditZone={z => setEffectEdit({ target: 'zone', key: z.key, form: formFromZone(z) })}
            onCloneZone={z => setCloneZone(z)}
            onDropZone={z => void dropZone(z.key)}
            onClose={() => setEffectMenuUnit(null)}
          />
        );
      })()}
      </div>

      {/* Routed retreat card â€” informational: the rout destination is chosen by
          the deterministic rout algorithm; the owner only confirms (and picks
          whether an attached hero rides along). Draggable. */}
      {retreatPick && (
        <div className="absolute inset-0 z-[260] bg-black/10">
          <div
            className="absolute bg-gray-900 border border-amber-700 rounded-xl shadow-2xl p-4 w-[440px] text-white space-y-3"
            style={{ left: retreatCardPos.x, top: retreatCardPos.y }}
          >
            <div
              className="cursor-move select-none flex items-center justify-between"
              onPointerDown={onRetreatDragStart}
              onPointerMove={onRetreatDragMove}
              onPointerUp={onRetreatDragEnd}
              onPointerLeave={onRetreatDragEnd}
            >
              <p className="font-semibold text-amber-300">{retreatPick.unit.unitName} is routing</p>
              <span className="text-[10px] text-gray-500">drag to move</span>
            </div>

            {retreatPick.path.dest ? (
              <div className="space-y-1">
                <p className="text-sm text-yellow-200">
                  Routes to ({retreatPick.path.dest.q}, {retreatPick.path.dest.r}).
                </p>
                {retreatPick.path.through.length > 0 && (
                  <p className="text-xs text-gray-400">
                    Pushes through {retreatPick.path.through.length} friendly unit(s){retreatPick.path.scatters.length > 0 ? `, disrupting ${retreatPick.path.scatters.length} Open Order unit(s) to Scattered` : ''}.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-red-300">
                  {retreatPick.unit.unitName} has nowhere to retreat: {retreatPick.path.reason ?? 'no legal hex'}. It stands, routed.
                </p>
                <p className="text-sm text-yellow-200">
                  It cannot move â€” it will face a <b>FREE pursue attack</b> from the routing enemy (no MP/action; cannot be declined).
                </p>
              </div>
            )}

            {retreatPick.hero && retreatPick.path.dest && (
              <div className="rounded bg-gray-800 border border-gray-700 p-2 space-y-1.5">
                <p className="text-xs text-gray-300">
                  Attached hero: <span className="text-amber-300 font-semibold">{retreatPick.hero.unitName}</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setRetreatHeroChoice('move')}
                    className={`flex-1 px-2 py-1.5 rounded text-xs ${retreatHeroChoice === 'move' ? 'bg-amber-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                  >
                    Move together
                  </button>
                  <button
                    onClick={() => setRetreatHeroChoice('stay')}
                    className={`flex-1 px-2 py-1.5 rounded text-xs ${retreatHeroChoice === 'stay' ? 'bg-amber-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                  >
                    Stay behind
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400">
              {retreatPick.path.dest
                ? 'A hostile that can reach may pursue this rout automatically â€” you cannot decline the pursuit or its attack.'
                : 'It will be struck in place by any enemy that can reach it (a free melee attack you cannot decline).'}
            </p>

            <button
              onClick={() => void applyRoutedFlow(retreatPick.unit, retreatPick.path, retreatPick.attacker, retreatHeroChoice)}
              className="w-full bg-amber-700 hover:bg-amber-600 rounded px-3 py-1.5 text-sm"
            >
              {retreatPick.path.dest ? `Continue â€” rout to (${retreatPick.path.dest.q}, ${retreatPick.path.dest.r})` : 'Continue (stand â€” FREE pursue attack)'}
            </button>
          </div>
        </div>
      )}

      {/* Everything below is also dimmed during a rout (modals/menus). */}
      <div style={retreatPick ? { opacity: 0, pointerEvents: 'none' } : undefined}>
      {/* Replay overlay â€” distinct frame + playback controls */}
      {inReplay && (
        <ReplayOverlay
          step={replay.cursor}
          totalSteps={replay.steps.length}
          playing={replay.playing}
          speed={replay.speed}
          controllerName={replay.controllerId === playerId ? 'You' : replay.controllerId ? 'Another player' : null}
          turnOneIndex={replay.turnOneIndex}
          onSeek={replay.seek}
          onPlay={replay.play}
          onPause={replay.pause}
          onStepFwd={replay.stepFwd}
          onStepBack={replay.stepBack}
          onSpeedChange={replay.setSpeed}
        />
      )}

      {/* DM gone banner â€” controls disabled, map stays viewable. Shows for the GM
          too (a disconnected GM may not realize they dropped; the lock keeps them
          from mutating local state). Suppressed during replay: live controls are
          locked by replay mode anyway. */}
      {dmGone && !inReplay && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[200] px-4 py-1.5 bg-red-900/90 border border-red-500 rounded shadow-lg">
          <span className="text-red-200 font-semibold text-sm">
            {isGM ? 'Connection lost â€” reconnectingâ€¦' : 'GM is offline â€” controls disabled until they return'}
          </span>
        </div>
      )}

      {/* Soft-enforcement prompts (over-budget / cap / conversion confirms) */}
      <SoftEnforcementModals
        pending={{
          move: pendingMove,
          attack: pendingAttack,
          attackCap: pendingAttackCap,
          heroAttachConversion: pendingHeroAttachConversion,
          attachOverBudget: pendingAttachOverBudget,
          formation: pendingFormation,
          rotate: pendingRotate,
          castOverBudget: pendingCastOverBudget,
          chargeAttack: pendingChargeAttack,
          chargeThrough: pendingChargeThrough,
          weaponSwitch: pendingWeaponSwitch,
          wallAttack: pendingWallAttack,
        }}
        actions={softActions}
        cancels={softCancels}
        unitMaxMP={unitMaxMP}
      />

      {/* Reaction toolbar: shown while a reaction session is locked. A reaction
          may combine a full move and a formation change, in either order, then
          End (or Escape) closes it. A reaction shot closes it immediately. */}
      {reactionMode && !reactionFormationPicker && (() => {
        const mover = units.find(u => u.id === reactionMode.moverId);
        return (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 rounded-xl border border-amber-700 bg-gray-900/95 px-4 py-2 shadow-2xl">
            <span className="text-amber-300 text-sm font-semibold">{reactionMode.archer.unitName} â€” reaction</span>
            <span className="hidden sm:inline text-[11px] text-gray-400">Drag onto the unit that moved to shoot it Â· right-click to change formation</span>
            {mover && (
              <button
                className="bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded-lg text-xs font-semibold"
                onClick={() => requestReactionAttack(reactionMode.archer.id, reactionMode.moverId)}
              >
                Fire at {mover.unitName}
              </button>
            )}
            <button
              className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded-lg text-xs font-semibold"
              onClick={endReaction}
            >
              End reaction
            </button>
          </div>
        );
      })()}

      {/* Reaction: formation picker (reached by right-clicking the acting archer
          in locked reaction mode). Follows the same formation-change limits as
          the context menu: only formations in the unit's availability, at most
          one org level above the current one (waived under free move), and no
          Shield Wall with a two-handed weapon. Clicking a formation applies AND
          closes the modal. */}
      {reactionFormationPicker && (() => {
        const archer = reactionFormationPicker;
        const activeWeaponIsTwoHanded = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0]?.isTwoHanded || false;
        const available = archer.formationAvailability && archer.formationAvailability.length > 0
          ? archer.formationAvailability
          : ['Open Order', 'Close Order', 'Phalanx', 'Shield Wall', 'Scattered'];
        const options = Object.values(formationsMap)
          .map(f => f.name)
          .filter(name => name !== 'Routed' && available.includes(name))
          .sort((a, b) => getOrganizationLevel(b) - getOrganizationLevel(a) || a.localeCompare(b))
          .map(name => ({
            name,
            disabled: !canAdoptFormation(archer.currentFormation, name, freeMove) || (name === 'Shield Wall' && (activeWeaponIsTwoHanded || !archer.isShielded)),
          }));
        return (
          <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
            <div className="bg-gray-900 border border-amber-700 rounded-xl shadow-2xl p-6 min-w-[260px]">
              <p className="text-white text-sm mb-3 text-center font-semibold">Change formation â€” {archer.unitName}</p>
              <div className="flex flex-col gap-1.5">
                {options.map(({ name, disabled }) => (
                  <button
                    key={name}
                    disabled={disabled}
                    className={`px-3 py-1.5 rounded text-sm ${disabled ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-gray-800 hover:bg-gray-700 text-white'}`}
                    onClick={() => { performReactionFormation(archer, name); setReactionFormationPicker(null); }}
                  >
                    {name}
                  </button>
                ))}
                {options.length === 0 && (
                  <p className="text-[11px] text-gray-500 text-center">No formations available</p>
                )}
              </div>
              <button
                className="mt-3 w-full bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setReactionFormationPicker(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {/* Scenario Settings: player-local display (This device) + grouped GM toggles */}
      {showScenarioSettings && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[380px] max-h-[85vh] overflow-y-auto">
            <p className="text-white text-sm mb-4 text-center font-semibold">Scenario Settings</p>
            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 border-b-2 border-gray-600 pb-1">This device</div>
            <div className="pl-6">
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={showAllMoveMp}
                onChange={(e) => setShowAllMoveMp(e.target.checked)}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Show MP on every move hex</span>
                <span className="block text-gray-400 text-[11px]">
                  Label every reachable preview hex with the MP you'd have left â€” including turn-required and
                  withdraw hexes. This device only.
                </span>
              </span>
            </label>
            <div className="mb-3">
              <span className="font-medium text-amber-300 text-sm">Move preview</span>
              <div className="flex flex-col gap-1 mt-1 text-sm text-gray-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="movePreviewMode" checked={movePreviewMode === 'one'} onChange={() => setMovePreviewMode('one')} className="h-3.5 w-3.5 accent-amber-400" />
                  <span>One action per drag <span className="text-gray-400 text-[11px]">(drag again for the next action)</span></span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="movePreviewMode" checked={movePreviewMode === 'all'} onChange={() => setMovePreviewMode('all')} className="h-3.5 w-3.5 accent-amber-400" />
                  <span>All actions per drag <span className="text-gray-400 text-[11px]">(bands dim as more actions are spent)</span></span>
                </label>
              </div>
            </div>
            </div>
            {effectiveIsGM && (<>
            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mt-5 mb-2 border-b-2 border-gray-600 pb-1">Combat &amp; reactions</div>
            <div className="pl-6">
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={archerReactionEnabled}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { archer_reaction_enabled: e.target.checked });
                  if (!e.target.checked) setReactionOffers(new Map());
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Reactive archery</span>
                <span className="block text-gray-400 text-[11px]">
                  When a unit ends a move within an eligible hostile archer's weapon range, that archer's owner may
                  shoot, move up to 50%, or change formation (once per turn each). While ON, entering a kill zone also
                  requires stopping next to it first.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mountedChargeEnabled}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { mounted_charge_enabled: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Charge and Swoop</span>
                <span className="block text-gray-400 text-[11px]">
                  When on, charge-capable units (and heroes) may use Charge! and airborne flyers may use Swoop!.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={zocPursuitEnabled}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { zoc_pursuit_enabled: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Zone-of-control pursuit</span>
                <span className="block text-gray-400 text-[11px]">
                  Leaving a hostile kill zone scatters a formed unit and provokes an aggression-gated pursue. OFF: no scatter, no pursue, no opportunity attack; entering a kill zone still spends MP.
                </span>
              </span>
            </label>
            </div>

            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mt-5 mb-2 border-b-2 border-gray-600 pb-1">Heroes</div>
            <div className="pl-6">
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={heroMoraleBoostEnabled}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { hero_morale_boost_enabled: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Hero morale and combat boost</span>
                <span className="block text-gray-400 text-[11px]">
                  Heroes grant Commanding Presence to allies within 7 hexes, upgraded to Heroic Inspiration after attacking, and add heroic attack capacity while leading or inspired.
                </span>
              </span>
            </label>
            </div>

            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mt-5 mb-2 border-b-2 border-gray-600 pb-1">Visibility</div>
            <div className="pl-6">
            <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={fogOfWar}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { fog_of_war: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400"
              />
              <span className="font-medium text-amber-300">Fog of war</span>
            </label>
            <div className="pl-12 mt-1">
              <label className="flex items-center gap-2 text-gray-400 text-xs cursor-text">
                Sight radius
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={sightRadius}
                  onChange={async (e) => {
                    const v = Math.max(1, Math.min(9, parseInt(e.target.value) || 2));
                    setSightRadius(v);
                    await updateScenarioField(scenarioId, { sight_radius: v });
                  }}
                  className="w-14 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700"
                />
              </label>
              <p className="text-gray-500 text-[11px] mt-1">
                Each alliance sees only within sight of its own units; the DM sees through the darkened boundary.
                Sight radius is armed even while fog is off.
              </p>
            </div>
            </div>

            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mt-5 mb-2 border-b-2 border-gray-600 pb-1">Assist &amp; logs</div>
            <div className="pl-6">
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={aiAssistEnabled}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { ai_assist_enabled: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">AI assist</span>
                <span className="block text-gray-400 text-[11px]">
                  Shows the AI tab: hand teams to a plotted enemy AI (preview, then execute move by move). The GM stays in control of every action.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={aiAssistPlayers}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { ai_assist_players: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Allow players to use AI assist</span>
                <span className="block text-gray-400 text-[11px]">
                  Lets non-GM participants open the AI tab during their side's turn. The GM still owns these settings.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={verboseCombat}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { verbose_combat: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Verbose combat</span>
                <span className="block text-gray-400 text-[11px]">
                  When on, combat descriptions print every dice roll (sorted) so the damage
                  formulas can be verified from the raw faces.
                </span>
              </span>
            </label>
            </div>

            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mt-5 mb-2 border-b-2 border-gray-600 pb-1">Spelljammer</div>
            <div className="pl-6">
            <div className="mb-2">
              <span className="text-sm font-medium text-amber-300">Ship mode</span>
              <div className="flex flex-col gap-1 mt-1 text-sm text-gray-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="shipMode"
                    checked={shipMode === 'wildspace'}
                    onChange={async () => { setShipMode('wildspace'); await updateScenarioField(scenarioId, { ship_mode: 'wildspace' }); }}
                    className="h-3.5 w-3.5 accent-amber-400"
                  />
                  <span>Wildspace <span className="text-gray-400 text-[11px]">(speed declaration, 5 steps, no elevation)</span></span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="shipMode"
                    checked={shipMode === 'atmosphere'}
                    onChange={async () => { setShipMode('atmosphere'); await updateScenarioField(scenarioId, { ship_mode: 'atmosphere' }); }}
                    className="h-3.5 w-3.5 accent-amber-400"
                  />
                  <span>Atmosphere <span className="text-gray-400 text-[11px]">(atmospheric speed as flying points, normal turns)</span></span>
                </label>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={shipFiringArcs}
                onChange={async (e) => {
                  setShipFiringArcs(e.target.checked);
                  await updateScenarioField(scenarioId, { ship_firing_arcs: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Use firing arcs</span>
                <span className="block text-gray-400 text-[11px]">
                  When off, every ship weapon except the ram fires 360Â°.
                </span>
              </span>
            </label>
            </div>

            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mt-5 mb-2 border-b-2 border-gray-600 pb-1">Minigames</div>
            <div className="pl-6">
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={halloweenSiege?.enabled ?? false}
                onChange={async (e) => {
                  await handleToggleHalloweenSiege(e.target.checked);
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Halloween Siege</span>
                <span className="block text-gray-400 text-[11px]">
                  Wave-based monster assault: spawns weighted monster waves at the grid rim on Enemy turns. The DM starts each next wave from the top-bar banner.
                </span>
              </span>
            </label>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setShowHalloweenSiege(true)}
                className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded text-xs"
              >
                Configure Halloween Siegeâ€¦
              </button>
              <span className="text-[11px] text-gray-400">{siegeSettingsLabel}</span>
            </div>
            {halloweenSiege?.enabled && siegeEnemyTeams.length === 0 && (
              <p className="text-amber-300 text-[11px] mt-1">
                Assign at least one team to the Enemy alliance in Alliances â€” End Turn is blocked until then.
              </p>
            )}
            </div>
            </>)}
            <div className="flex justify-end">
              <button
                onClick={() => setShowScenarioSettings(false)}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showHalloweenSiege && (
        <HalloweenSiegeWindow
          config={halloweenSiege}
          currentTurnAlliance={currentTurnAlliance}
          turnNumber={turnNumber}
          enemyTeams={siegeEnemyTeams}
          onSave={handleSaveHalloweenSiege}
          onClose={() => setShowHalloweenSiege(false)}
        />
      )}

      {/* Attach Position Modal */}
      {attachModal && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[340px] max-w-[92vw]">
            <p className="text-white text-sm mb-1 text-center">
              {attachModal.hero.unitName} â†’ {attachModal.target.unitName}
            </p>
            <p className="text-gray-400 text-xs mb-4 text-center">Choose how the hero rides this unit.</p>
            <div className="flex flex-col gap-2">
              {attachModal.canCast && (
                <button
                  className="bg-purple-700 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm"
                  onClick={() => { handleAttackRequest(attachModal.hero.id, attachModal.target.id, { forceCast: true }); setAttachModal(null); }}
                >
                  Cast spell
                </button>
              )}
              {attachModal.target.isHero ? (
                <button
                  className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm text-left"
                  onClick={() => { handleAttachHero(attachModal.hero.id, attachModal.target.id, 'rider'); setAttachModal(null); }}
                >
                  <span className="font-semibold">Ride (mount)</span>
                  <span className="block text-[11px] font-normal text-amber-100/80 leading-snug">
                    The hero mounts a larger hero. Incoming volleys are split between mount and rider by the attacker's chosen main target (70% / 30%).
                  </span>
                </button>
              ) : (
                <>
                  <button
                    className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm text-left"
                    onClick={() => { handleAttachHero(attachModal.hero.id, attachModal.target.id, 'front'); setAttachModal(null); }}
                  >
                    <span className="font-semibold">Leader mode (Front)</span>
                    <span className="block text-[11px] font-normal text-blue-100/80 leading-snug">
                      <b>Can:</b> join every attack the host makes (its own weapon, one action) and steady the troops (host attacks ignore AGR). <b>Cannot:</b> avoid danger â€” it is in the open.
                    </span>
                  </button>
                  <button
                    className="bg-teal-700 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm text-left"
                    onClick={() => { handleAttachHero(attachModal.hero.id, attachModal.target.id, 'back'); setAttachModal(null); }}
                  >
                    <span className="font-semibold">Protected mode (rear)</span>
                    <span className="block text-[11px] font-normal text-teal-100/80 leading-snug">
                      <b>Can:</b> attack and reaction-fire into the host's rear cone. <b>Cannot:</b> join the host's attacks, threaten forward, or escape harm â€” frontal/flank melee misses it, but 10% of ranged fire and 30% of attacks into the rear still reach it.
                    </span>
                  </button>
                </>
              )}
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

      {/* Mount target modal â€” pick the main target of a mounted pair */}
      {pendingMountTarget && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[280px]">
            <p className="text-white text-sm mb-4 text-center">
              Attack {pendingMountTarget.target.unitName} (mounted pair)
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => confirmMountTarget(true)}
              >
                Attack {pendingMountTarget.target.unitName} (mount)
              </button>
              <button
                className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => confirmMountTarget(false)}
              >
                Attack {pendingMountTarget.rider.unitName} (rider)
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={cancelMountTarget}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ground attack picker â€” a hostile drop-attack where >1 weapon can reach (or
          the target carries a rider) offers the combined weapon + main-target choice
          before attacking. */}
      {pendingAttackChoice && (() => {
        const p = pendingAttackChoice;
        const weapons = parseWeapons(p.attacker.weaponString || '');
        const rangeBonus = rangeBonusAt(p.attacker, groundZones);
        const showWeapons = weapons.filter(w => canWeaponAttack(w, p.attacker, p.target, rangeBonus, structures, structureTemplates)).length > 1;
        return (
          <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[320px] space-y-4">
              <p className="text-white text-sm text-center">Attack {p.target.unitName}</p>
              {showWeapons && (
                <WeaponSelect
                  attacker={p.attacker}
                  target={p.target}
                  weapons={weapons}
                  value={p.weaponIndex}
                  rangeBonus={rangeBonus}
                  diceCount={p.damageDiceCount}
                  onDiceCountChange={n => setPendingAttackChoice({ ...p, damageDiceCount: n })}
                  onChange={i => setPendingAttackChoice({ ...p, weaponIndex: i, damageDiceCount: damageDiceCount(weapons[i]?.damageDice ?? '') })}
                />
              )}
              {p.rider && (
                <MountTargetChoice
                  target={p.target}
                  rider={p.rider}
                  value={p.mainTarget}
                  onChange={v => setPendingAttackChoice({ ...p, mainTarget: v })}
                />
              )}
              <div className="flex justify-end gap-2">
                <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm" onClick={cancelAttackChoice}>Cancel</button>
                <button className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm" onClick={confirmAttackChoice}>Attack</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Reaction attack picker â€” a reaction drop/â€œFireâ€ where >1 ranged weapon
          reaches the mover offers the weapon + upcast-damage choice. The target is
          always the mover; confirm fires the reaction. */}
      {pendingReactionChoice && (() => {
        const p = pendingReactionChoice;
        const weapons = parseWeapons(p.archer.weaponString || '');
        const rangeBonus = rangeBonusAt(p.archer, groundZones);
        return (
          <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[320px] space-y-4">
              <p className="text-white text-sm text-center">Reaction shot at {p.mover.unitName}</p>
              <WeaponSelect
                attacker={p.archer}
                target={p.mover}
                weapons={weapons}
                value={p.weaponIndex}
                rangeBonus={rangeBonus}
                diceCount={p.damageDiceCount}
                onDiceCountChange={n => setPendingReactionChoice({ ...p, damageDiceCount: n })}
                onChange={i => setPendingReactionChoice({ ...p, weaponIndex: i, damageDiceCount: damageDiceCount(weapons[i]?.damageDice ?? '') })}
                isUsable={w => canReactWithWeapon(p.archer, p.mover, w, rangeBonus, formationsMap[p.archer.currentFormation] ?? null)}
              />
              <div className="flex justify-end gap-2">
                <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm" onClick={cancelReactionChoice}>Cancel</button>
                <button className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm" onClick={confirmReactionChoice}>Fire</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Descent drop â€” a grounded unit stepping off an adjacent lower surface
          chooses Climb down (pay MP; hang midway if short) / Drop (fall damage) /
          Cancel. Mounted units cannot climb down. */}
      {pendingDescent && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[340px] max-w-[90vw]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Drop off the structure?</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              {pendingDescent.unit.unitName} is {pendingDescent.feet} ft up ({Math.floor(pendingDescent.feet / 10)}d6 fall).
              {!pendingDescent.canClimb
                ? ' Mounted â€” cannot climb down; drop to take the fall damage.'
                : pendingDescent.noDrop
                  ? ' Climb down (free move).'
                  : ` Climb down for ${Math.round(pendingDescent.feet / 10) * pendingDescent.perStep} MP (may hang midway), or drop and take the fall damage.`}
            </p>
            <div className="flex flex-col gap-2">
              {pendingDescent.canClimb && (
                <button className="px-4 py-2 bg-green-800 hover:bg-green-700 text-white rounded-lg text-sm" onClick={() => void confirmDescentClimb()}>
                  {pendingDescent.noDrop ? 'Climb down (free)' : `Climb down (${Math.round(pendingDescent.feet / 10) * pendingDescent.perStep} MP)`}
                </button>
              )}
              {!pendingDescent.noDrop && (
                <button className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm" onClick={() => void confirmDescentDrop()}>
                  Drop ({Math.floor(pendingDescent.feet / 10)}d6)
                </button>
              )}
              <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm" onClick={cancelDescent}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Structure action â€” a drop onto a wall/structure with more than one legal
          intent: Climb onto the top, or Pass through the (open) door at ground. */}
      {pendingStructureAction && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[320px] max-w-[90vw]">
            <p className="text-white text-sm mb-1 text-center font-semibold">
              {pendingStructureAction.structureName ?? 'Structure'} â€” choose an action
            </p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              {pendingStructureAction.unit.unitName} at ({pendingStructureAction.targetHex.q}, {pendingStructureAction.targetHex.r}).
            </p>
            <div className="flex flex-col gap-2">
              {pendingStructureAction.actions.includes('climb') && (
                pendingStructureAction.edge ? (
                  <>
                    <button className="px-4 py-2 bg-green-800 hover:bg-green-700 text-white rounded-lg text-sm" onClick={() => void confirmClimbOver('drop')}>
                      Climb over &amp; drop (fall damage)
                    </button>
                    <button className="px-4 py-2 bg-emerald-800 hover:bg-emerald-700 text-white rounded-lg text-sm" onClick={() => void confirmClimbOver('climb')}>
                      Climb over &amp; climb down
                    </button>
                  </>
                ) : (
                  <button className="px-4 py-2 bg-green-800 hover:bg-green-700 text-white rounded-lg text-sm" onClick={() => void confirmStructureAction('climb')}>
                    Climb onto the top
                  </button>
                )
              )}
              {pendingStructureAction.actions.includes('pass') && (
                <button className="px-4 py-2 bg-blue-800 hover:bg-blue-700 text-white rounded-lg text-sm" onClick={() => void confirmStructureAction('pass')}>
                  Pass through the door (ground)
                </button>
              )}
              <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm" onClick={() => setPendingStructureAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Climb-attack â€” a ground attacker vs a garrison on a higher structure top. */}
      {pendingClimbAttack && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[320px] max-w-[90vw]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Climb the wall to attack?</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              {pendingClimbAttack.garrison} holds the top. Scale the wall and melee, or attack from the ground.
            </p>
            <div className="flex flex-col gap-2">
              <button className="px-4 py-2 bg-green-800 hover:bg-green-700 text-white rounded-lg text-sm" onClick={() => { const p = pendingClimbAttack; setPendingClimbAttack(null); if (p) void performClimbAttack(p.attackerId, p.targetId); }}>
                Climb &amp; attack
              </button>
              <button className="px-4 py-2 bg-blue-800 hover:bg-blue-700 text-white rounded-lg text-sm" onClick={() => { const p = pendingClimbAttack; setPendingClimbAttack(null); if (p) void handleAttackRequest(p.attackerId, p.targetId); }}>
                Attack from the ground
              </button>
              <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm" onClick={() => setPendingClimbAttack(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {freePlacement && <FreePlacementModal request={freePlacement} />}
      {freePlacementAir && <FreePlacementAirModal request={freePlacementAir} />}

      {/* Flyer drop - a flyable unit chooses its destination elevation. On an
          occupied hex it also offers Swoop (swooping flyer) / Range attack. */}
      {pendingElevation && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[320px]">
            <p className="text-white text-sm mb-1 text-center">
              {pendingElevation.unit.unitName}{pendingElevation.occupant ? ` â†’ ${pendingElevation.occupant.unitName}` : ''} â€” elevation (ft)
            </p>
            {pendingElevation.occupant && (
              <p className="text-gray-400 text-xs mb-3 text-center">
                Hover above {pendingElevation.occupant.unitName}'s hex (min {pendingElevation.range.min} ft) or choose an action.
              </p>
            )}
            <input
              type="range"
              min={pendingElevation.range.min}
              max={pendingElevation.range.max}
              step={10}
              value={pendingElevation.range.defaultValue}
              onChange={e => setPendingElevation({ ...pendingElevation, range: { ...pendingElevation.range, defaultValue: Number(e.target.value) } })}
              className="w-full accent-amber-400"
            />
            <div className="flex justify-between text-[11px] text-gray-400 mt-1">
              <span>{pendingElevation.range.min} ft</span>
              <span className="text-yellow-300">{pendingElevation.range.defaultValue} ft</span>
              <span>{pendingElevation.range.max} ft</span>
            </div>
            {pendingElevation.canSwoop && (pendingElevation.unit.attacksUsed ?? 0) >= unitAttackCap() && (
              <p className="text-red-400 text-xs mt-2 text-center">
                Past the {unitAttackCap()}-attack cap ({pendingElevation.unit.attacksUsed}/{unitAttackCap()}).
              </p>
            )}
            <div className="flex flex-col gap-2 mt-4">
              <button
                className="bg-green-800 border-2 border-yellow-400 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700"
                onClick={() => confirmElevation(pendingElevation.range.defaultValue)}
              >
                Move
              </button>
              {pendingElevation.canSwoop && pendingElevation.occupant && (
                <button
                  className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
                  onClick={() => { const p = pendingElevation; setPendingElevation(null); if (!controlsLocked && p.occupant) void performSwoopDrop(p.unit.id, p.occupant.id); }}
                >
                  Swoop attack (move + free melee)
                </button>
              )}
              {pendingElevation.isHostile && pendingElevation.occupant && (() => {
                const p = pendingElevation;
                const occ = p.occupant!;
                const weapons = parseWeapons(p.unit.weaponString || '');
                const rangeBonus = rangeBonusAt(p.unit, groundZones);
                const rider = units.find(u => u.attachedToUnitId === occ.id && !u.isDeleted && u.attachedPosition === 'rider') ?? null;
                // Melee reach is same-elevation adjacency OR same-hex Â±10 ft; a
                // weapon that can't reach from the CURRENT hex greys the Attack button.
                const canReach = !!weapons[p.weaponIndex] && canWeaponAttack(weapons[p.weaponIndex], p.unit, occ, rangeBonus, structures, structureTemplates);
                return (
                  <>
                    <WeaponSelect
                      attacker={p.unit}
                      target={occ}
                      weapons={weapons}
                      value={p.weaponIndex}
                      rangeBonus={rangeBonus}
                      diceCount={p.damageDiceCount}
                      onDiceCountChange={n => setPendingElevation({ ...p, damageDiceCount: n })}
                      onChange={i => setPendingElevation({ ...p, weaponIndex: i, damageDiceCount: damageDiceCount(weapons[i]?.damageDice ?? '') })}
                    />
                    {rider && (
                      <MountTargetChoice
                        target={occ}
                        rider={rider}
                        value={p.mainTarget}
                        onChange={v => setPendingElevation({ ...p, mainTarget: v })}
                      />
                    )}
                    <button
                      disabled={!canReach}
                      title={canReach ? undefined : 'Weapon out of reach from this hex'}
                      className={`px-4 py-2 rounded-lg text-sm ${canReach ? 'bg-amber-700 hover:bg-amber-600 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                      onClick={() => { if (!canReach) return; setPendingElevation(null); if (!controlsLocked) void handleAttackRequest(p.unit.id, occ.id, { weaponIndex: p.weaponIndex, ...(weapons[p.weaponIndex] ? { damageDice: withDamageDiceCount(weapons[p.weaponIndex].damageDice, p.damageDiceCount) } : {}), ...(rider ? { mainTarget: p.mainTarget } : {}) }); }}
                    >
                      Attack{weapons[p.weaponIndex] ? ` with ${weapons[p.weaponIndex].name}` : ''}
                    </button>
                  </>
                );
              })()}
              <button className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm" onClick={cancelElevation}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Ship move â€” atmosphere altitude choice (free, 10 ft per hex moved). */}
      {pendingShipElevation && (() => {
        const p = pendingShipElevation;
        const ship = shipRuntime.find(s => s.id === p.shipId);
        if (!ship) return null;
        return (
          <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[320px]">
              <p className="text-white text-sm mb-1 text-center">
                {ship.name} â€” altitude (ft) Â· {p.currentElevation} â†’ {p.elevation}
              </p>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={10}
                value={p.elevation}
                onChange={e => setPendingShipElevation({ ...p, elevation: Number(e.target.value) })}
                className="w-full accent-amber-400"
              />
              <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                <span>{p.min} ft</span>
                <span className="text-yellow-300">{p.elevation} ft</span>
                <span>{p.max} ft</span>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  className="flex-1 bg-green-800 border-2 border-yellow-400 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700"
                  onClick={() => {
                    setPendingShipElevation(null);
                    void handleShipMove(p.shipId, p.targetHex, p.elevation);
                  }}
                >
                  Move
                </button>
                <button
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm"
                  onClick={() => setPendingShipElevation(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Fall â€” a non-flying hero detaching from an airborne host drops } */}
      {pendingHeroFall && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[320px]">
            <p className="text-white text-sm mb-1 text-center">
              {pendingHeroFall.hero.unitName} can't fly â€” dismounting from {pendingHeroFall.elevation} ft.
            </p>
            <p className="text-gray-400 text-xs mb-3 text-center">
              Falls {Math.max(0, Math.floor(pendingHeroFall.elevation / 10))}d6 falling damage to the hex below.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded" onClick={cancelHeroFall}>Cancel</button>
              <button className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded" onClick={() => void confirmHeroFall()}>Fall</button>
            </div>
          </div>
        </div>
      )}

      {/* Leave hero behind â€” a non-flying attached hero too large to carry */}
      {pendingLeaveHero && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[300px]">
            <p className="text-white text-sm mb-3 text-center">
              {pendingLeaveHero.hero.unitName} can't fly and is too large for {pendingLeaveHero.unit.unitName} to carry. Leave it behind?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded" onClick={cancelLeaveHero}>Cancel</button>
              <button className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded" onClick={() => void confirmLeaveHero()}>Leave behind</button>
            </div>
          </div>
        </div>
      )}

      {/* DM -> player mode team picker (blocking until a team is chosen or cancelled) */}
      {showGmTeamPick && participantsSync.myParticipant && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-amber-700 rounded-xl shadow-2xl p-6 min-w-[340px]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Choose your team to play as a player</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              As a player you'll control the alliance your team belongs to (Super Player
              privileges). You can change team later from the Players tab in DM mode.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mb-3">
              {(TEAMS as Team[]).map(team => (
                <TeamChip
                  key={team}
                  team={team}
                  selected={myTeam === team}
                  onClick={async (t) => {
                    const mp = participantsSync.myParticipant;
                    if (mp) await participantsSync.setParticipantTeam(mp.id, t);
                    setShowGmTeamPick(false);
                    setGmAsPlayer(true);
                  }}
                />
              ))}
            </div>
            <div className="text-[11px] text-gray-500 text-center mb-4">
              {TEAMS.map(team => `${team} â†’ ${allianceOf(team, alliances)}`).join(' Â· ')}
            </div>
            <div className="flex justify-center">
              <button
                onClick={() => setShowGmTeamPick(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
              >
                Cancel â€” stay DM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Magic cast targeting window (realtime-synced) */}
      {magicCast.cast && (
        <MagicCastModal
          cast={magicCast.cast}
          playerId={playerId}
          isGM={effectiveIsGM}
          sizeCategories={sizeCategories}
          formationsMap={formationsMap}
          onCancel={magicCast.cancelCast}
          onPlaceMarker={magicCast.placeMarker}
          onClearMarkers={magicCast.clearMarkers}
          onRotate={magicCast.rotateArea}
          onOverrideMarkerCount={magicCast.overrideMarkerCount}
          onSetSave={magicCast.setSave}
          onRequestResolve={requestResolveCast}
        />
      )}

      {/* Double-click unit editor */}
      {editUnit && (
        <UnitEditorModal
          unit={editUnit}
          formationsMap={formationsMap}
          units={units}
          alliances={alliances}
          onClose={() => setEditUnit(null)}
          onSave={handleEditorSave}
          onEditEffect={e => setEffectEdit({ target: 'unit', unit: editUnit, key: e.key, form: formFromUnitEffect(e) })}
          onRemoveEffect={key => void removeEffect(editUnit, key)}
        />
      )}

      {dryDockShip && dryDockCampaign && (
        <DryDockWindow
          ship={dryDockShip}
          campaign={dryDockCampaign}
          versions={campaignFamilyOf(dryDockCampaign, campaignStore.ships)}
          participants={participantsSync.participants.map(p => ({
            userId: p.userId,
            name: p.userId === currentUser?.id ? 'You' : p.userId.slice(0, 6),
          }))}
          currentUserId={currentUser?.id ?? null}
          isGM={effectiveIsGM}
          onEndSession={() => void handleCloseDryDock(dryDockShip.id, dryDockCampaign.id)}
          initial={dryDockInitial}
          initialSize={dryDockInitialSize}
          onAcquire={async () => { await campaignStore.acquireEditor(dryDockCampaign.id); }}
          onHeartbeat={async () => { await campaignStore.heartbeatEditor(dryDockCampaign.id); }}
          onReleaseEditor={async force => { await campaignStore.releaseEditor(dryDockCampaign.id, force); }}
          onSave={async args => {
            const afterStats = args.snapshot.stats;
            const shipHpMax = Math.max(1, Math.round(afterStats.shipHp));
            const crewIds = shipCrewIds(args.snapshot.template);
            const stationCardKeys = new Set(
              shipStationCards(args.snapshot.build).map(card => card.key),
            );
            const crewState = pruneShipCrewState(dryDockShip.crewState, crewIds);
            const stations = pruneShipStations(dryDockShip.stations, crewIds, stationCardKeys);
            const hitCardKeys = new Set(shipHitCards(args.snapshot.build).map(card => card.key));
            const nextBoxState = pruneShipBoxState(dryDockShip.boxState, hitCardKeys);
            // A plain Save keeps the family name; renaming is an explicit
            // manager/version action.
            const displayName = campaignBaseName(dryDockCampaign);
            const subSteps: SubStep[] = [{
              type: 'SHIP',
              unitId: dryDockShip.id,
              description: `${displayName} refitted in dry dock`,
              changes: [
                { field: 'name', from: dryDockShip.name, to: displayName },
                { field: 'snapshot', from: dryDockShip.snapshot, to: args.snapshot },
                { field: 'shipHpMax', from: dryDockShip.shipHpMax, to: shipHpMax },
                { field: 'shipHp', from: dryDockShip.shipHp, to: shipHpMax },
                { field: 'minHpAttained', from: dryDockShip.minHpAttained, to: shipHpMax },
                { field: 'boxState', from: dryDockShip.boxState ?? {}, to: nextBoxState },
                { field: 'crewState', from: dryDockShip.crewState ?? {}, to: crewState },
                { field: 'stations', from: dryDockShip.stations ?? {}, to: stations },
                { field: 'loadedCargo', from: dryDockShip.loadedCargo ?? 0, to: cargoManifestMass(args.cargo) },
                { field: 'imageUrl', from: dryDockShip.imageUrl, to: args.snapshot.template.imageUrl },
                { field: 'keelLength', from: dryDockShip.keelLength, to: args.snapshot.template.keelLength },
                { field: 'imageOffsetY', from: dryDockShip.imageOffsetY, to: args.snapshot.template.imageOffsetY },
              ],
            }];
            for (const hero of units.filter(unit => !unit.isDeleted && unit.attachedToShipId === dryDockShip.id)) {
              if (hero.shipStationKey && !stationCardKeys.has(hero.shipStationKey)) {
                subSteps.push({
                  type: 'EDIT_UNIT',
                  unitId: hero.id,
                  description: `${hero.unitName} left a removed station`,
                  changes: [{ field: 'shipStationKey', from: hero.shipStationKey, to: null }],
                });
              }
            }
            await execute('SHIP', subSteps, `${displayName} refitted in dry dock`);
            addMessage(`${displayName} saved in dry dock.`);
            return true;
          }}
          onSaveAsNewVersion={async args => {
            const afterStats = args.snapshot.stats;
            const shipHpMax = Math.max(1, Math.round(afterStats.shipHp));
            const crewIds = shipCrewIds(args.snapshot.template);
            const stationCardKeys = new Set(
              shipStationCards(args.snapshot.build).map(card => card.key),
            );
            const crewState = pruneShipCrewState(dryDockShip.crewState, crewIds);
            const stations = pruneShipStations(dryDockShip.stations, crewIds, stationCardKeys);
            const hitCardKeys = new Set(shipHitCards(args.snapshot.build).map(card => card.key));
            const nextBoxState = pruneShipBoxState(dryDockShip.boxState, hitCardKeys);
            const created = await campaignStore.fork({
              shipId: dryDockShip.id,
              name: args.name,
              resetNumeral: args.resetNumeral,
              snapshot: args.snapshot,
              shipHp: shipHpMax,
              shipHpMax,
              minHpAttained: shipHpMax,
              boxState: nextBoxState,
              crewState,
              cargo: args.cargo,
            });
            if (!created) {
              addError(campaignStore.error || 'Could not create the new campaign version.');
              return false;
            }
            // Deck data that the fork does not carry.
            await supabase
              .from('ship_spelljammer')
              .update({
                stations,
                loaded_cargo: cargoManifestMass(args.cargo),
                image_url: args.snapshot.template.imageUrl,
                keel_length: args.snapshot.template.keelLength,
                image_offset_y: args.snapshot.template.imageOffsetY,
              })
              .eq('id', dryDockShip.id);
            const removedHeroSteps: SubStep[] = [];
            for (const hero of units.filter(unit => !unit.isDeleted && unit.attachedToShipId === dryDockShip.id)) {
              if (hero.shipStationKey && !stationCardKeys.has(hero.shipStationKey)) {
                removedHeroSteps.push({
                  type: 'EDIT_UNIT',
                  unitId: hero.id,
                  description: `${hero.unitName} left a removed station`,
                  changes: [{ field: 'shipStationKey', from: hero.shipStationKey, to: null }],
                });
              }
            }
            if (removedHeroSteps.length > 0) {
              await execute('EDIT_UNIT', removedHeroSteps, 'Stations cleared after refit');
            }
            await refreshShips();
            const numeral = args.resetNumeral
              ? 1
              : campaignNextNumeral(dryDockCampaign, campaignStore.ships);
            addMessage(`${campaignBaseName({ name: args.name, numeral })} is now the active campaign version.`);
            return true;
          }}
        />
      )}
      {pendingShipDrop && (
        <div className="fixed inset-0 z-[270] grid place-items-center bg-black/60 p-4" onMouseDown={() => setPendingShipDrop(null)}>
          <div className="w-full max-w-sm rounded-lg border border-gray-600 bg-gray-800 p-3 shadow-xl" onMouseDown={e => e.stopPropagation()}>
            <div className="mb-1 text-sm font-semibold text-amber-200">
              {pendingShipDrop.unit.unitName} → {shipDisplayName(pendingShipDrop.ship)}
            </div>
            <p className="mb-2 text-[11px] text-gray-400">
              {pendingShipDrop.canBoard
                ? 'Board the ship or attack it?'
                : 'Attack the ship with the equipped weapon?'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPendingShipDrop(null)} className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700">Cancel</button>
              {pendingShipDrop.canBoard && (
                <button
                  type="button"
                  onClick={() => {
                    const pending = pendingShipDrop;
                    setPendingShipDrop(null);
                    void handleBoardHero(pending.unit, pending.ship.id, pending.cost, pending.maxMP, pending.isFree);
                  }}
                  className="rounded border border-sky-600 px-2 py-1 text-xs text-sky-200 hover:bg-sky-900/40"
                >
                  Board
                </button>
              )}
              <button type="button" onClick={() => void resolvePendingShipAttack()} className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-200 hover:bg-amber-700/30">Attack</button>
            </div>
          </div>
        </div>
      )}

      {shipWindow && (
        <ShipWindow
          ship={shipWindow}
          runtimeStats={effectiveShipStats(shipWindow, units)}
          manning={shipSailRudderManning(shipWindow, units)}
          readOnly={shipWindowReadOnly}
          shipMode={shipMode}
          shipStep={shipStep}
          turnNumber={turnNumber}
          grounded={shipIsGrounded(shipWindow.elevation, structureSurfaceAt(shipWindow.hex!, structures ?? {}, structureTemplates))}
          weaponActionsAllowed={shipWeaponActionsAllowed}
          canRam={shipCanRam}
          ramTargetAvailable={shipRamTargetAvailable}
          canEditSpeed={shipCanEditSpeed}
          onOpenSpeedPanel={() => openSpeedPanel(shipWindow.id)}
          onClose={() => setShipWindowId(null)}
            boardedHeroes={units
            .filter(u => !u.isDeleted && u.attachedToShipId === shipWindow.id)
            .map(u => {
              const stationKey = u.shipStationKey ?? null;
              const pos = stationKey ? shipWindow.stations?.[stationKey]?.heroPositions?.[u.id] : undefined;
              return {
                id: u.id,
                name: u.unitName,
                shipStationKey: stationKey,
                team: u.team,
                unit: u,
                xPct: pos?.xPct,
                yPct: pos?.yPct,
              };
            })}
          onFireWeapon={(cardKey, approvedNegative) => handleFireWeapon(shipWindow.id, cardKey, approvedNegative)}
          onLoadWeapon={(cardKey, approvedNegative) => void handleWeaponLoad(shipWindow.id, cardKey, approvedNegative)}
          onAutoLoadWeapon={cardKey => void handleWeaponAutoLoad(shipWindow.id, cardKey)}
          canManageCrew={shipWindowCanManageCrew}
          canAwardCommandBonus={shipCanAwardCommandBonus}
          commandBonusValue={shipCommandBonusValue}
          onAwardCommandBonus={(cardKey, approvedNegative) => void handleAwardCommandBonus(shipWindow.id, cardKey, approvedNegative)}
          onSetCrewTeam={team => void handleSetCrewTeam(shipWindow.id, team)}
          teamAlliances={alliances}
          onMoveHeroToken={(heroId, toCardKey, xPct, yPct) => void handleMoveHeroToken(heroId, toCardKey, xPct, yPct)}
          onHeroDropToMap={(heroId, x, y) => handleHeroDropToMap(heroId, x, y)}
          onHeroContextMenu={effectiveIsGM
            ? (heroId, x, y) => setShipHeroTeamMenu({ heroId, x, y })
            : undefined}
          onSailSpeed={(cardKey, delta, approvedNegative) => void handleSailSpeed(shipWindow.id, cardKey, delta, approvedNegative)}
          onRudderTrim={(cardKey, approvedNegative) => void handleRudderTrim(shipWindow.id, cardKey, approvedNegative)}
          onRepair={(cardKey, targetKey, approvedNegative) => void handleRepair(shipWindow.id, cardKey, targetKey, approvedNegative)}
          onRam={cardKey => beginShipRam(shipWindow.id, cardKey)}
          canEditRoster={effectiveIsGM}
          onAdjustCrew={args => void applyCrewAdjust(shipWindow.id, args)}
        onReviveCrew={(ids, hp) => void handleReviveCrew(shipWindow.id, ids, hp)}
        onDiscardCrew={ids => void handleDiscardCrew(shipWindow.id, ids)}
        onAutoAssignCrew={keys => void handleAutoAssignCrew(shipWindow.id, keys)}
        onClearCrew={() => void handleClearCrew(shipWindow.id)}
        onUpdateManifest={items => void handleUpdateManifest(shipWindow.id, items)}
        onFillStation={cardKey => void handleFillStation(shipWindow.id, cardKey)}
        onEmptyStation={cardKey => void handleEmptyStation(shipWindow.id, cardKey)}
        revealAllCards={!!shipWindowAccess?.revealAllCards}
        visibleCardKeys={shipWindowAccess?.visibleCardKeys ?? []}
        manageableCardKeys={shipWindowAccess?.manageableCardKeys ?? []}
        />
      )}

      {shipHeroTeamMenu && (() => {
        const hero = units.find(u => u.id === shipHeroTeamMenu.heroId && !u.isDeleted);
        if (!hero) return null;
        return (
          <TeamContextMenu
            x={shipHeroTeamMenu.x}
            y={shipHeroTeamMenu.y}
            title={`Assign ${hero.unitName} team:`}
            onAssign={team => { void assignTeam(hero, team); }}
            onClose={() => setShipHeroTeamMenu(null)}
          />
        );
      })()}

      {speedPanelShip && (
        <SpeedDeclarationPanel
          ship={speedPanelShip}
          stats={effectiveShipStats(speedPanelShip, units)}
          spentThisTurn={speedPanelSpent}
          minDeclaredSpeed={speedPanelSpent}
          onClose={() => {
            // Closing without a choice declares the previous speed only when
            // this round has no declaration yet. A re-opened panel must not
            // overwrite an existing declaration.
            if (speedPanelShip.declaredRound !== turnNumber) {
              void handleDeclareShipSpeed(speedPanelShip.id, {
                declaredSpeed: speedPanelShip.lastSpeed ?? 5,
                accelDelta: 0,
                extraHexes: 0,
              });
            }
            closeSpeedPanel();
          }}
          onDeclare={args => void handleDeclareShipSpeed(speedPanelShip.id, args)}
        />
      )}

      {/* Effects drop: editable pre-apply form (single hex, no radius) */}
      {effectDrop && (
        <EffectFormModal
          title={effectDrop.unit
            ? `Apply "${effectDrop.form.name}" to ${effectDrop.unit.unitName}`
            : `Place "${effectDrop.form.name}" at (${effectDrop.hex.q}, ${effectDrop.hex.r})`}
          value={effectDrop.form}
          onChange={form => setEffectDrop({ ...effectDrop, form })}
          teamOptions={teamOptions}
          confirmLabel={effectDrop.unit ? 'Apply' : 'Place'}
          onConfirm={() => void confirmEffectDrop()}
          onCancel={() => setEffectDrop(null)}
        />
      )}

      {/* Placed-effect edit (ground zone or a unit's own effect) */}
      {effectEdit && (
        <EffectFormModal
          title={effectEdit.target === 'zone' ? 'Edit effect' : `Edit ${effectEdit.unit.unitName}'s effect`}
          value={effectEdit.form}
          onChange={form => setEffectEdit({ ...effectEdit, form })}
          teamOptions={teamOptions}
          allowMultipleModifiers={false}
          confirmLabel="Save"
          onConfirm={() => void confirmEffectEdit()}
          onCancel={() => setEffectEdit(null)}
        />
      )}

      {/* Clone armed: click a hex to place a copy */}
      {cloneZone && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[200] bg-amber-900/90 border border-amber-500 text-amber-100 text-xs px-3 py-1.5 rounded shadow-lg">
          Click a hex to clone <b>{cloneZone.name}</b> Â· Esc / right-click to cancel
        </div>
      )}

      {/* Entry-zone troop-count prompt */}
      {entryPrompt && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/50">
          <div className="bg-gray-900 border border-red-700 rounded-xl p-5 w-[380px]">
            <p className="text-white font-semibold mb-1">
              {entryPrompt.actor.unitName} enters {entryPrompt.zone.name}
            </p>
            <p className="text-xs text-gray-400 mb-3">
              How many troops are caught? The ones behind stop at the boundary (0 = none).
              Each takes {entryPrompt.zone.dice ?? ''}{entryPrompt.zone.healing ? ' healing' : ' damage'} (capped at troop HP).
            </p>
            <input
              autoFocus
              type="number"
              min={0}
              max={entryPrompt.actor.currentTroopCount}
              value={entryCount}
              onChange={e => setEntryCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              onKeyDown={e => { if (e.key === 'Enter') resolveEntryPrompt(entryCount); }}
              className="w-24 bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={() => resolveEntryPrompt(0)}>
                None
              </button>
              <button className="px-3 py-1.5 rounded bg-red-800 hover:bg-red-700 text-white text-sm" onClick={() => resolveEntryPrompt(entryCount)}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Effects at hex" menu: quick reorder + drop (stays open); full edit is Shift + double-click */}
      {zoneMenu && (() => {
        const zones = groundZones
          .filter(z => z.q === zoneMenu.hex.q && z.r === zoneMenu.hex.r)
          .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
        if (zones.length === 0) return null;
        return (
          <div className="absolute inset-0 z-[240]" onMouseDown={() => setZoneMenu(null)}>
            <div
              className="absolute bg-gray-900 border border-gray-700 rounded shadow-xl py-1 w-64 text-sm text-white"
              style={{ left: zoneMenu.x, top: zoneMenu.y }}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="px-3 py-1 text-[11px] text-gray-400 flex items-center justify-between">
                <span>Effects at ({zoneMenu.hex.q}, {zoneMenu.hex.r})</span>
              </div>
              {zones.map(z => (
                <div key={z.key} className="px-2 py-1 border-t border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: z.color }} />
                    <span className="flex-1 text-yellow-200">
                      {z.kind === 'cargo_debris' ? 'Floating cargo' : z.name}
                    </span>
                    {canManageZone(z) && (
                      <button
                        className="px-1.5 py-0.5 text-[11px] rounded bg-red-900/60 hover:bg-red-800"
                        onClick={() => void dropZone(z.key)}
                      >
                        Drop Effect
                      </button>
                    )}
                  </div>
                  <div className="pl-4 text-[10px] text-gray-400">
                    {z.kind === 'cargo_debris'
                      ? (z.cargo?.length ? `50% of ${cargoDamageSummary(z.cargo)}` : 'empty')
                      : `${z.dice ?? ''}${z.healing ? ' heal' : ''}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Persistent hex-effects editor (Shift + double-click): Edit / Clone / Remove + Remove all */}
      {hexEffectsModal && (() => {
        const zones = groundZones
          .filter(z => z.q === hexEffectsModal.q && z.r === hexEffectsModal.r)
          .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
        if (zones.length === 0) return null;
        return (
          <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/50" onMouseDown={() => setHexEffectsModal(null)}>
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-5 w-[420px] text-white space-y-2" onMouseDown={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-yellow-300">Effects at ({hexEffectsModal.q}, {hexEffectsModal.r})</p>
                <button className="text-gray-400 hover:text-white" onClick={() => setHexEffectsModal(null)}>âœ•</button>
              </div>
              {zones.map(z => (
                <div key={z.key} className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5">
                  <span className="inline-block w-3 h-3 rounded-full flex-none" style={{ background: z.color }} />
                  <span className="flex-1 min-w-0 truncate">{z.kind === 'cargo_debris' ? 'Floating cargo' : z.name}</span>
                  <span className="text-[11px] text-gray-400 flex-none">
                    {z.kind === 'cargo_debris'
                      ? (z.cargo?.length ? `50% of ${cargoDamageSummary(z.cargo)}` : 'empty')
                      : `${z.dice ?? ''}${z.healing ? ' heal' : ''}`}
                  </span>
                  <span className="flex items-center gap-1 flex-none">
                    {canManageZone(z) && (
                      z.kind === 'cargo_debris' ? (
                        <button className="px-1.5 py-0.5 text-[11px] rounded bg-red-900/60 hover:bg-red-800" onClick={() => void dropZone(z.key)}>Remove</button>
                      ) : (
                        <>
                          <button className="px-1.5 py-0.5 text-[11px] rounded bg-gray-700 hover:bg-gray-600" onClick={() => setEffectEdit({ target: 'zone', key: z.key, form: formFromZone(z) })}>Edit</button>
                          <button className="px-1.5 py-0.5 text-[11px] rounded bg-gray-700 hover:bg-gray-600" onClick={() => setCloneZone(z)}>Clone</button>
                          <button className="px-1.5 py-0.5 text-[11px] rounded bg-red-900/60 hover:bg-red-800" onClick={() => void dropZone(z.key)}>Remove</button>
                        </>
                      )
                    )}
                  </span>
                </div>
              ))}
              {effectiveIsGM && (
                <button
                  className="w-full px-3 py-1.5 rounded text-sm bg-red-900/70 hover:bg-red-800 text-red-200"
                  onClick={() => void dropAllZonesAt(hexEffectsModal)}
                >
                  Remove all effects on this hex
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Scenario Statistics (DM in live play; anyone in replay) */}
      {(showStats || sharedStats) && (
        <ScenarioStatsModal
          rows={commandRows}
          units={units}
          ships={shipRuntime}
          alliances={alliances}
          stats={sharedStats ?? undefined}
          onClose={() => {
            setShowStats(false);
            clearSharedStats();
          }}
          onShare={stats => {
            shareStats(stats);
            setShowStats(false);
          }}
        />
      )}

      {/* Other Action over-budget confirm */}
      {otherActionHero && (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/40" onMouseDown={() => setOtherActionHero(null)}>
          <div className="bg-gray-900 border border-amber-700 rounded-xl p-5 max-w-sm" onMouseDown={e => e.stopPropagation()}>
            <p className="text-white font-semibold mb-2">Other Action â€” no actions left</p>
            <p className="text-sm text-gray-300 mb-4">
              {otherActionHero.unitName} has no actions left. Spend the action anyway (goes over budget)?
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={() => setOtherActionHero(null)}>
                Cancel
              </button>
              <button className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-sm" onClick={() => void confirmOtherAction()}>
                Spend anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kicked â€” boot to Lobby */}
      {kicked && (
        <div className="absolute inset-0 z-[400] flex flex-col items-center justify-center bg-black/80">
          <div className="text-white text-xl font-semibold mb-2">You were removed from this scenario</div>
          <div className="text-gray-400 text-sm mb-4">Returning to the Lobbyâ€¦</div>
          <button
            onClick={goToLobby}
            className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm"
          >
            Back to Lobby
          </button>
        </div>
      )}

      {/* Debug Panel */}
      <div className="absolute bottom-4 right-4 bg-black/60 text-white px-4 py-2 rounded-lg text-sm font-mono space-y-1 pointer-events-none">
        <div>Hover: {hoveredHex ? `${hoveredHex.q}, ${hoveredHex.r}` : 'â€”'}</div>
        <div>Selected: {selectedHex ? `${selectedHex.q}, ${selectedHex.r}` : 'â€”'}</div>
        <div>Dragging: {draggingUnitId || (isDraggingFromPanel ? 'from panel' : 'â€”')}</div>
        <div className="text-green-400 text-xs">Realtime active</div>
        <div className="text-gray-400 text-xs">Units: {units.length}</div>
        <div className="text-gray-500 text-xs">Scenario: {scenarioId.slice(0, 8)}â€¦</div>
        {isGM && <div className="text-yellow-400 text-xs">{gmAsPlayer ? 'DM â†’ Player mode' : 'DM'}</div>}
      </div>

      {structureEditKey && structures[structureEditKey] && structureTemplates[structures[structureEditKey].templateId] && (() => {
        const editInst = structures[structureEditKey];
        const editHex = isHexStructureKey(structureEditKey)
          ? (() => { const [q, r] = structureEditKey.split(',').map(Number); return { q, r, s: -q - r } as Hex; })()
          : null;
        const editHasZones = !!editHex && groundZones.some(z => z.q === editHex.q && z.r === editHex.r);
        return (
          <StructureEditModal
            template={structureTemplates[editInst.templateId]}
            instance={editInst}
            restricted={!isGM}
            onSave={(patch) => void patchStructureAt(structureEditKey, patch)}
            onToggleDoor={(open) => void toggleStructureDoor(structureEditKey, open)}
            onRemove={isGM ? () => { void removeStructureCommand(structureEditKey); setStructureEditKey(null); } : undefined}
            onEditEffects={isGM && editHasZones && editHex ? () => { setHexEffectsModal(editHex); setStructureEditKey(null); } : undefined}
            onClose={() => setStructureEditKey(null)}
          />
        );
      })()}
      </div>
    </div>
  );
}
