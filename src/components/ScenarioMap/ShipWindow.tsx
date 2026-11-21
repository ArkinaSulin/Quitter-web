'use client';

// Tactical ship window (double-click a ship image). Non-modal floating panel:
// summary + compact deck + roster. Speed declaration lives in its own step-1
// panel (`SpeedDeclarationPanel`).

import { useEffect, useRef, useState } from 'react';
import { AllianceGroup, Unit } from '@/types/gameProtocol';
import type { CargoManifestItem } from '@/types/ship';
import {
  ShipRuntime,
  ShipBuild,
  componentById,
  deckOrderedCardKeys,
  ensureDeckSlot,
  findCardKeyForComponent,
  findCardKeysForComponent,
  resolveShipWeaponDamage,
  SHIP_HULL_REPAIR_CAPACITY,
  shipCardFunctionHeroes,
  shipHeroesOnCard,
  shipCardCrewCount,
  shipCommandHero,
  canSpendCardStep,
  cardStepsRemaining,
  effectiveMCForSpeed,
  shipHullCardKey,
  shipHullDestroyed,
  shipDamagedCards,
  shipHasRepairableDamage,
  shipStationCards,
  type ShipHitCard,
  shipStationStat,
  shipStationCheckLabel,
  crewCheckBonus,
  heroCheckBonus,
  computeCargoCapacity,
  cargoQuantity,
  supplyDays,
  type CheckStat,
  shipWeaponCards,
} from '@/packages/ships';
import type { ShipCardFunction, ShipCardWeaponInfo } from '@/components/ShipRenderer/ShipComponentCard';
import { ShipLayout } from '@/components/ShipRenderer/ShipLayout';
import { CrewRoster } from '@/components/ShipRenderer/CrewRoster';
import { CargoManifest } from '@/components/ShipRenderer/CargoManifest';
import type { CrewDraft } from '@/components/ShipRenderer/CrewAdjustDialog';
import { DraggablePanel } from '@/components/shared/DraggablePanel';
import { Floating } from './Floating';
import { alphaLabel, TEAMS, TEAM_COLORS, type Team } from '@/packages/units';

export interface BoardedHero {
  id: string;
  name: string;
  shipStationKey: string | null;
  team: string | null;
  unit: Unit;
  xPct?: number;
  yPct?: number;
}

export interface ShipWindowProps {
  ship: ShipRuntime;
  readOnly: boolean;
  shipMode: 'atmosphere' | 'wildspace';
  shipStep: number;
  turnNumber: number;
  /** False when the viewer's alliance does not hold the current turn. */
  weaponActionsAllowed: boolean;
  /** True when the viewer controls this ship (helmsman/captain/DM). */
  canRam: boolean;
  /** True when a hostile ship is in the two forward hexes. */
  ramTargetAvailable: boolean;
  /** DM/controller may open the speed declaration panel from the summary. */
  canEditSpeed: boolean;
  onOpenSpeedPanel: () => void;
  onClose: () => void;
  boardedHeroes: BoardedHero[];
  onFireWeapon: (cardKey: string, approvedNegative?: boolean) => void;
  onLoadWeapon: (cardKey: string, approvedNegative?: boolean) => void;
  onAutoLoadWeapon: (cardKey: string) => void;
  canManageCrew: boolean;
  onSetCrewTeam: (team: string | null) => void;
  teamAlliances: Record<string, AllianceGroup>;
  onMoveHeroToken: (heroId: string, toCardKey: string, xPct: number, yPct: number) => void;
  onHeroDropToMap: (heroId: string, clientX: number, clientY: number) => void;
  onSailSpeed: (cardKey: string, delta: 1 | -1, approvedNegative?: boolean) => void;
  onRudderTrim: (cardKey: string, approvedNegative?: boolean) => void;
  onRepair: (cardKey: string, targetCardKey?: string | null, approvedNegative?: boolean) => void;
  onRam: (cardKey: string) => void;
  canEditRoster: boolean;
  onAdjustCrew: (args: { ids: string[]; draft: CrewDraft; count: number }) => void;
  onReviveCrew: (ids: string[], hp: number) => void;
  onDiscardCrew: (ids: string[]) => void;
  onAutoAssignCrew: (enabledKeys: string[]) => void;
  onClearCrew: () => void;
  onUpdateManifest: (items: CargoManifestItem[]) => void;
  onFillStation: (cardKey: string) => void;
  onEmptyStation: (cardKey: string) => void;
  revealAllCards: boolean;
  visibleCardKeys: string[];
  manageableCardKeys: string[];
}

function crewDisplayName(crew: { name?: string | null } | undefined): string {
  const name = crew?.name?.trim();
  if (!name || /^crew level \d+$/i.test(name)) return 'Crew';
  return name;
}

export function ShipWindow({
  ship,
  readOnly,
  shipMode,
  shipStep,
  turnNumber,
  weaponActionsAllowed,
  canRam,
  ramTargetAvailable,
  canEditSpeed,
  onOpenSpeedPanel,
  onClose,
  boardedHeroes,
  onFireWeapon,
  onLoadWeapon,
  onAutoLoadWeapon,
  canManageCrew,
  onSetCrewTeam,
  teamAlliances,
  onMoveHeroToken,
  onHeroDropToMap,
  onSailSpeed,
  onRudderTrim,
  onRepair,
  onRam,
  canEditRoster,
  onAdjustCrew,
  onReviveCrew,
  onDiscardCrew,
  onAutoAssignCrew,
  onClearCrew,
  onUpdateManifest,
  onFillStation,
  onEmptyStation,
  revealAllCards,
  visibleCardKeys,
  manageableCardKeys,
}: ShipWindowProps) {
  const stats = ship.snapshot?.stats;
  const template = ship.snapshot?.template;
  const build = ship.snapshot?.build;
  const boardedUnits = boardedHeroes.map(h => h.unit);

  const crewRows = template?.crews ?? [];
  const manifest = template?.manifest ?? [];
  const cargoCapacity = build ? computeCargoCapacity(build) : 0;
  const hasRepairKit = cargoQuantity(manifest, 'ship_repair_kit') >= 1;
  const crewState = ship.crewState ?? {};
  // Roster shows only reserve crew: anyone on a station is already drawn on its card.
  const assignedCrewIds = new Set<string>();
  for (const entry of Object.values(ship.stations ?? {})) {
    for (const id of entry.crewIds ?? []) assignedCrewIds.add(id);
  }
  for (const [id, state] of Object.entries(crewState)) {
    if (state.station) assignedCrewIds.add(id);
  }
  const availableCrew = crewRows.filter(c => !assignedCrewIds.has(c.id));
  const livingCrew = crewRows.filter(c => !crewState[c.id]?.dead).length;
  const livingHeroes = boardedHeroes.filter(h => (h.unit.currentUnitHp ?? 1) > 0).length;
  const foodWaterDays = supplyDays(manifest, livingCrew + livingHeroes);
  const stationCards = build ? shipStationCards(build) : [];
  const stations = stationCards.map(card => ({ key: card.key, name: card.name, crew: card.crewRequired }));
  // Runtime-only card-step ledger: one digit per deck card (0..5 left this turn).
  // Helm is excluded: its Dodge placeholder spends no card steps.
  const cardStepsByCard: Record<string, number> = {};
  if (build?.deckLayout) {
    const helmKeys = new Set(findCardKeysForComponent(build, 'Helm'));
    for (const key of deckOrderedCardKeys(build.deckLayout)) {
      if (helmKeys.has(key)) continue;
      cardStepsByCard[key] = cardStepsRemaining(ship.cardState, key, turnNumber);
    }
  }
  const [autoArmed, setAutoArmed] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState<Record<string, boolean>>({});
  const [cardMenu, setCardMenu] = useState<{
    x: number;
    y: number;
    cardKey: string;
    capacity: number;
  } | null>(null);
  const cardMenuRef = useRef<HTMLDivElement | null>(null);
  const [repairModal, setRepairModal] = useState<{
    cardKey: string;
    damaged: ShipHitCard[];
    needsActionApproval: boolean;
    noCardSteps?: boolean;
  } | null>(null);
  const [repairTarget, setRepairTarget] = useState<string | null>(null);
  const [cardActionConfirm, setCardActionConfirm] = useState<{
    kind: 'sail' | 'rudder' | 'weapon-load' | 'weapon-fire';
    cardKey: string;
    delta?: 1 | -1;
    names: string[];
    noCardSteps?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!cardMenu) return;
    const close = (event: MouseEvent) => {
      if (cardMenuRef.current?.contains(event.target as Node)) return;
      setCardMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCardMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [cardMenu]);

  const canManageCard = (cardKey: string) =>
    canManageCrew || manageableCardKeys.includes(cardKey);
  const presentCrewByCard: Record<string, number> = {};
  for (const [key, entry] of Object.entries(ship.stations ?? {})) {
    const heroIds = new Set([...(entry.heroIds ?? []), ...(entry.heroId ? [entry.heroId] : [])]);
    presentCrewByCard[key] = (entry.crewIds?.length ?? 0) + heroIds.size;
  }
  const eligibleCards = stationCards.filter(
    card => card.crewRequired > (presentCrewByCard[card.key] ?? 0),
  );
  const eligibleKeys = eligibleCards.map(card => card.key);

  const bridgeCards = stationCards.filter(card => card.kind === 'bridge');
  const bridgeCapacity = bridgeCards.reduce((sum, card) => sum + card.crewRequired, 0);
  const bridgePresent = bridgeCards.reduce((sum, card) => sum + (presentCrewByCard[card.key] ?? 0), 0);
  const bridgeFull = bridgeCapacity > 0 && bridgePresent >= bridgeCapacity;

  const weaponCards = build ? shipWeaponCards(build) : [];
  const helmCardKey = build ? findCardKeyForComponent(build, 'Helm') : null;
  const helmStation = helmCardKey ? ship.stations?.[helmCardKey] : undefined;
  const helmHero = helmStation?.heroId ? boardedHeroes.find(h => h.id === helmStation.heroId) : undefined;
  const helmCrewCount = helmStation?.crewIds?.length ?? 0;
  const helmLabel = helmHero
    ? helmHero.name
    : helmCrewCount > 0
      ? `${helmCrewCount} crew${ship.crewTeam ? ` (${ship.crewTeam})` : ''}`
      : 'unmanned';
  const cargoCardKey = build ? findCardKeyForComponent(build, 'Cargo') : null;
  const deckCardKey = build ? findCardKeyForComponent(build, 'Deck') : null;
  const hullCardKey = build ? shipHullCardKey(build) : null;
  const hullDestroyed = shipHullDestroyed(ship.snapshot, ship.boxState);
  const canRepairHull = !!hullCardKey
    && (canManageCrew || manageableCardKeys.includes(hullCardKey));
  const repairableHull = shipHasRepairableDamage(ship.snapshot, ship.boxState, ship.shipHp, ship.shipHpMax);
  const hullStation = hullCardKey ? ship.stations?.[hullCardKey] : undefined;
  const hullLivingCrew = (hullStation?.crewIds ?? []).filter(id => !crewState[id]?.dead).length;
  const hullLivingHeroes = boardedHeroes.filter(
    h => h.shipStationKey === hullCardKey && (h.unit.currentUnitHp ?? 1) > 0,
  ).length;
  const hullPresent = hullLivingCrew + hullLivingHeroes;
  // Repair costs one action from every hull hero; with no hull hero the captain
  // (or helmsman when no captain exists) pays instead.
  const hullActionHeroes = (hullCardKey ? shipCardFunctionHeroes(ship, boardedUnits, hullCardKey) : [])
    .map(unit => ({ name: unit.unitName, unit }));
  const needsRepairActionApproval = hullActionHeroes.some(h => (h.unit.actionsAvailable ?? 0) < 1);
  const heroesByCard: Record<string, BoardedHero[]> = {};
  for (const h of boardedHeroes) {
    const key = h.shipStationKey || deckCardKey || cargoCardKey;
    if (!key) continue;
    (heroesByCard[key] ??= []).push(h);
  }

  const occupantsByCard: Record<string, { id: string; name: string; isHero: boolean }[]> = {};
  for (const h of boardedHeroes) {
    const key = h.shipStationKey || deckCardKey || cargoCardKey;
    if (!key) continue;
    (occupantsByCard[key] ??= []).push({ id: h.id, name: h.name, isHero: true });
  }
  for (const [key, entry] of Object.entries(ship.stations ?? {})) {
    for (const crewId of entry.crewIds ?? []) {
      const crew = template?.crews?.find(c => c.id === crewId);
      (occupantsByCard[key] ??= []).push({
        id: crewId,
        name: crewDisplayName(crew),
        isHero: false,
      });
    }
  }

  const heroIdsOnCard = (key: string): string[] => {
    const station = ship.stations?.[key];
    return [...(station?.heroIds ?? []), ...(station?.heroId ? [station.heroId] : [])];
  };
  const bestOnCard = (key: string, stat: CheckStat): { label: string; bonus: number; name: string } | null => {
    const station = ship.stations?.[key];
    if (!station) return null;
    let best: { bonus: number; name: string } | null = null;
    for (const crewId of station.crewIds ?? []) {
      if (crewState[crewId]?.dead) continue;
      const crew = crewRows.find(c => c.id === crewId);
      if (!crew) continue;
      const bonus = crewCheckBonus(crew, stat);
      if (!best || bonus > best.bonus) best = { bonus, name: crewDisplayName(crew) };
    }
    for (const heroId of heroIdsOnCard(key)) {
      const hero = boardedHeroes.find(h => h.id === heroId);
      if (!hero) continue;
      const bonus = heroCheckBonus(hero.unit, stat);
      if (!best || bonus > best.bonus) best = { bonus, name: hero.name };
    }
    return best ? { ...best, label: shipStationCheckLabel('weapon') } : null;
  };

  const cardChecks: Record<string, { label: string; bonus: number; name: string }> = {};
  for (const card of stationCards) {
    const best = bestOnCard(card.key, shipStationStat(card.kind));
    if (best) cardChecks[card.key] = { ...best, label: shipStationCheckLabel(card.kind) };
  }
  if (build) {
    const hullKey = findCardKeyForComponent(build, 'Hull');
    const best = hullKey ? bestOnCard(hullKey, 'str') : null;
    if (hullKey && best) cardChecks[hullKey] = { ...best, label: 'Repair' };
  }

  const availableHeroes = boardedHeroes.filter(h =>
    !h.shipStationKey || h.shipStationKey === deckCardKey || h.shipStationKey === cargoCardKey,
  );
  const leaderFor = (stat: CheckStat): { name: string; bonus: number } | null => {
    let best: { name: string; bonus: number } | null = null;
    for (const crew of crewRows) {
      if (crewState[crew.id]?.dead) continue;
      const bonus = crewCheckBonus(crew, stat);
      if (!best || bonus > best.bonus) best = { name: crewDisplayName(crew), bonus };
    }
    for (const hero of availableHeroes) {
      const bonus = heroCheckBonus(hero.unit, stat);
      if (!best || bonus > best.bonus) best = { name: hero.name, bonus };
    }
    return best;
  };
  const skillRows: { label: string; stat: CheckStat }[] = [
    { label: 'Helmsmanship (Helm)', stat: 'wis' },
    { label: 'Captaincy (Bridge)', stat: 'int' },
    { label: 'Sail Trimming (Rudder)', stat: 'int' },
    { label: 'Sail maxing (Sail)', stat: 'con' },
    { label: 'Weapon handling', stat: 'dex' },
    { label: 'Repair (Hull)', stat: 'str' },
  ];

  const toggleCard = (key: string) => {
    setAutoEnabled(enabled => ({ ...enabled, [key]: enabled[key] === false }));
  };
  const onAutoClick = () => {
    if (!autoArmed) {
      const next: Record<string, boolean> = {};
      for (const key of eligibleKeys) next[key] = true;
      setAutoEnabled(next);
      setAutoArmed(true);
      return;
    }
    onAutoAssignCrew(Object.keys(autoEnabled).filter(key => autoEnabled[key]));
    setAutoArmed(false);
    setAutoEnabled({});
  };
  const onClearClick = () => {
    onClearCrew();
    setAutoArmed(false);
    setAutoEnabled({});
  };

  const weaponInfoByCard: Record<string, ShipCardWeaponInfo> = {};
  const commandHero = build ? shipCommandHero(ship, boardedUnits) : null;
  for (const card of weaponCards) {
    const reload = ship.reload?.[card.key] ?? { progress: 0, armed: false };
    const armed = !!reload.armed || card.weapon.reloadSteps === 0;
    const destroyed = Number((ship.boxState as Record<string, number> | undefined)?.[card.key] ?? 0);
    const remainingTons = Math.max(0, card.tons - destroyed);
    const heroes = shipHeroesOnCard(ship, boardedUnits, card.key);
    const crewCount = shipCardCrewCount(ship, boardedUnits, card.key);
    const fullCrew = crewCount >= Math.ceil(card.weapon.crew);
    const stepsAvailable = canSpendCardStep(ship.cardState, card.key, turnNumber, shipStep, shipMode);
    const authorized = canManageCrew || manageableCardKeys.includes(card.key);
    const firePayers = heroes.length > 0 ? heroes : commandHero ? [commandHero] : [];
    const actionPayers = heroes.length > 0 ? heroes : armed && commandHero ? [commandHero] : [];
    const zeroActionNames = actionPayers
      .filter(hero => (hero.actionsAvailable ?? 0) < 1)
      .map(hero => hero.unitName);
    const label = armed ? 'Fire' : heroes.length > 0 ? 'Load' : 'Auto';
    const canUse = !readOnly && authorized && weaponActionsAllowed && remainingTons > 0
      && (armed
        ? crewCount > 0 && firePayers.length > 0 && (stepsAvailable || firePayers.length > 0)
        : heroes.length > 0
          ? fullCrew && (stepsAvailable || actionPayers.length > 0)
          : shipMode === 'atmosphere' && fullCrew && stepsAvailable);
    const title = canUse
      ? undefined
      : readOnly
        ? 'Read only.'
        : !weaponActionsAllowed
          ? 'Not your alliance’s turn.'
          : !authorized
            ? 'Only a hero on the card, the captain, a helmsman (when no captain exists), or the DM can operate this weapon.'
            : remainingTons <= 0
            ? 'This weapon is destroyed.'
            : !stepsAvailable && actionPayers.length === 0
              ? 'No card steps left on that card this turn.'
              : armed
                ? 'A hero on the card, captain, or helmsman plus at least one crew member is needed to fire.'
                : heroes.length > 0
                  ? 'The weapon needs its full crew to load.'
                  : shipMode === 'atmosphere'
                    ? 'The weapon needs its full crew to load.'
                    : 'In wildspace the crew load automatically at the start of each step.';
    const requestUse = () => {
      const needsApproval = actionPayers.length > 0 && (!stepsAvailable || zeroActionNames.length > 0);
      if (needsApproval) {
        setCardActionConfirm({
          kind: armed ? 'weapon-fire' : 'weapon-load',
          cardKey: card.key,
          names: zeroActionNames,
          noCardSteps: !stepsAvailable,
        });
        return;
      }
      if (armed) onFireWeapon(card.key);
      else if (heroes.length > 0) onLoadWeapon(card.key);
      else onAutoLoadWeapon(card.key);
    };
    weaponInfoByCard[card.key] = {
      damage: resolveShipWeaponDamage(card.weapon, stats?.totalMass ?? 0),
      reloadLabel: armed ? 'Armed' : `load ${reload.progress ?? 0}/${card.weapon.reloadSteps}`,
      armed,
      label,
      canUse,
      title,
      onUse: requestUse,
    };
  }

  const cardFunctions: Record<string, ShipCardFunction[]> = {};
  if (build?.deckLayout) {
    const deck = build.components.find(c => c.name === 'Deck');
    const deckKeyForLayout = deck ? `component:${deck.id || 'Deck'}` : 'component:Deck';
    for (const key of deckOrderedCardKeys(ensureDeckSlot(build.deckLayout, deckKeyForLayout))) {
      if (!key.startsWith('component:')) continue;
      const id = key.slice('component:'.length).replace(/:\d+$/, '');
      const component = componentById(build.components, id);
      const present = presentCrewByCard[key] ?? 0;
      const canUse = !readOnly && present > 0;
      const authorized = canManageCrew || manageableCardKeys.includes(key);
      const stepsAvailable = canSpendCardStep(ship.cardState, key, turnNumber, shipStep, shipMode);
      const payers = shipCardFunctionHeroes(ship, boardedUnits, key);
      const zeroActionNames = payers
        .filter(hero => (hero.actionsAvailable ?? 0) < 1)
        .map(hero => hero.unitName);
      const needsApproval = payers.length > 0 && (!stepsAvailable || zeroActionNames.length > 0);
      const shipActionNeedsCardStepTitle = !readOnly && authorized && present > 0
        && payers.length === 0 && !stepsAvailable
        ? 'No card steps left on that card this turn.'
        : undefined;
      const requestSail = (delta: 1 | -1) => {
        if (needsApproval) {
          setCardActionConfirm({
            kind: 'sail',
            cardKey: key,
            delta,
            names: zeroActionNames,
            noCardSteps: !stepsAvailable,
          });
          return;
        }
        onSailSpeed(key, delta);
      };
      const requestRudder = () => {
        if (needsApproval) {
          setCardActionConfirm({
            kind: 'rudder',
            cardKey: key,
            names: zeroActionNames,
            noCardSteps: !stepsAvailable,
          });
          return;
        }
        onRudderTrim(key);
      };
      const shipActionTitle = (locked: boolean, lockLabel: string): string | undefined => {
        if (readOnly) return undefined;
        if (!authorized) return 'Only a hero on the card, the captain, a helmsman (when no captain exists), or the DM can work this card.';
        if (present <= 0) return 'No crew on this card.';
        if (locked) return lockLabel;
        if (payers.length === 0) return 'No hero on the card, captain, or helmsman to spend an action.';
        return shipActionNeedsCardStepTitle;
      };
      if (component.name === 'Sail') {
        const title = shipActionTitle(ship.sailMaxStep === shipStep, 'Sail maxing already succeeded this turn.');
        cardFunctions[key] = [
          { label: 'Speed +', enabled: canUse && !title, title, onClick: () => requestSail(1) },
          { label: 'Speed −', enabled: canUse && !title, title, onClick: () => requestSail(-1) },
        ];
      } else if (component.name === 'Rudder') {
        const title = shipActionTitle(ship.sailTrimStep === shipStep, 'Sail trimming already succeeded this turn.');
        cardFunctions[key] = [
          {
            label: 'Trim MC',
            enabled: canUse && !title,
            title,
            onClick: requestRudder,
          },
        ];
      } else if (component.name === 'Hull') {
        const repairTitle = hullDestroyed
          ? 'The hull is destroyed; the ship cannot be repaired.'
          : !hasRepairKit
            ? 'No Ship repair kit in cargo'
            : hullPresent < SHIP_HULL_REPAIR_CAPACITY
              ? `Needs ${SHIP_HULL_REPAIR_CAPACITY} heroes or crew on the hull card`
              : !canRepairHull
                ? 'Only a hero on the hull card, the captain, a helmsman (when no captain exists), or the DM can repair.'
                : !repairableHull
                  ? 'Nothing to repair (HP at 80% cap and no damaged equipment).'
                  : shipActionNeedsCardStepTitle;
        cardFunctions[key] = [
          {
            label: 'Repair',
            enabled: !readOnly && !repairTitle,
            title: repairTitle,
            onClick: () => {
              if (!build) return;
              const damaged = shipDamagedCards(build, ship.boxState);
              const needsActionApproval = needsRepairActionApproval;
              if (damaged.length === 0 && !needsActionApproval && stepsAvailable) {
                onRepair(key, null);
                return;
              }
              setRepairTarget(damaged[0]?.key ?? null);
              setRepairModal({
                cardKey: key,
                damaged,
                needsActionApproval,
                noCardSteps: !stepsAvailable,
              });
            },
          },
        ];
      } else if (component.isRam) {
        const ramPayerReady = (commandHero?.actionsAvailable ?? 0) >= 1;
        const ramTitle = readOnly
          ? undefined
          : !canRam
            ? 'Only the ship’s helmsman or controller can ram.'
            : !ramPayerReady
              ? 'No helm or bridge hero has an action available.'
              : !ramTargetAvailable
                ? 'No hostile ship in the two forward hexes.'
                : !stepsAvailable
                  ? 'No card steps left on that card this turn.'
                  : undefined;
        cardFunctions[key] = [
          {
            label: 'Ram',
            enabled: !readOnly && canRam && ramPayerReady && ramTargetAvailable && stepsAvailable,
            title: ramTitle,
            onClick: () => onRam(key),
          },
        ];
      } else if (component.name === 'Helm') {
        cardFunctions[key] = [
          {
            label: 'Dodge',
            enabled: false,
            title: 'Dodge is not implemented yet.',
            onClick: () => {},
          },
        ];
      } else if (component.name === 'Command bridge' || component.name === 'Bridge') {
        cardFunctions[key] = [
          { label: 'Command bonus', enabled: bridgeFull, title: bridgeFull ? 'Bridge fully crewed' : 'Bridge needs its full crew complement', onClick: () => {} },
        ];
      }
    }
  }

  const [hideHeroTokens, setHideHeroTokens] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === '1') setHideHeroTokens(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === '1') setHideHeroTokens(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return (
    <>
    <DraggablePanel
      title={`${ship.name}${ship.serialNumber > 0 ? ` ${alphaLabel(ship.serialNumber)}` : ''}`}
      subtitle={`${template?.role || 'No role'}${readOnly ? ' · read only' : ''} · Helm: ${helmLabel}`}
      onClose={onClose}
      className="max-w-[96vw]"
      resizable
      persistKey="quitter.shipWindow.size"
      minWidth={560}
      minHeight={420}
    >
      <div className="grid h-full min-h-0 gap-3 p-3 lg:grid-cols-[210px_1fr]">
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="rounded-lg border border-gray-700 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Ship summary</div>
            {stats ? (
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between"><span className="text-gray-400">AC / DT</span><span>{stats.ac} / {stats.damageThreshold}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">HP</span><span>{ship.shipHp}/{ship.shipHpMax}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Mass</span><span>{stats.totalMass}t</span></div>
                <div className="flex justify-between pl-3 text-[10px]"><span className="text-gray-500">Current</span><span className="text-gray-300">{stats.performanceMass}t</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Crew</span><span>{livingCrew}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Food &amp; water</span><span className={foodWaterDays === 0 ? 'text-red-300' : foodWaterDays != null && foodWaterDays <= 7 ? 'text-amber-300' : 'text-gray-200'}>{foodWaterDays == null ? '—' : `${foodWaterDays} days`}</span></div>
                <div className="flex justify-between pl-3 text-[10px]"><span className="text-gray-500">Min</span><span className="text-gray-300">{stats.minCrew}</span></div>
                <div className="flex justify-between pl-3 text-[10px]"><span className="text-gray-500">Full</span><span className="text-gray-300">{stats.fullCrew}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Acceleration</span><span>{Math.max(0, Math.floor(stats.accel))}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">MC</span><span>{shipMode === 'atmosphere'
                  ? (() => {
                      const mc = effectiveMCForSpeed(stats, stats.atmosphericSpeed);
                      return Number.isFinite(mc) ? mc : '—';
                    })()
                  : stats.mcBands.map((b, i) => {
                      const band = i === stats.mcBands.length - 1 ? `${b.speedMin}+` : `${b.speedMin}-${b.speedMax}`;
                      const value = Number.isFinite(b.mc) ? `(${Math.ceil(b.mc)})` : '—';
                      return `${band}: ${value}`;
                    }).join(' / ')}</span></div>
                {shipMode === 'atmosphere' ? (
                  <div className="flex justify-between"><span className="text-gray-400">Speed</span><span>{stats.atmosphericSpeed}</span></div>
                ) : (() => {
                  const declared = ship.declaredRound === turnNumber;
                  const label = declared ? ship.declaredSpeed : 'Not declared';
                  const title = declared
                    ? `Declared speed ${ship.declaredSpeed} (previous ${ship.lastSpeed})`
                    : `Not declared this round (previous ${ship.lastSpeed}). Click to declare.`;
                  return (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Speed (step {shipStep})</span>
                      {canEditSpeed ? (
                        <button
                          type="button"
                          onClick={onOpenSpeedPanel}
                          title={title}
                          className="underline decoration-dotted underline-offset-2 text-amber-300 hover:text-amber-200"
                        >
                          {label}
                        </button>
                      ) : (
                        <span title={title}>{label}</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="text-[11px] text-gray-500">No frozen snapshot on this ship.</div>
            )}
          </div>

          <div className="rounded-lg border border-gray-700 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Best in ship skill</div>
            <div className="space-y-0.5 text-[11px]">
              {skillRows.map(row => {
                const best = leaderFor(row.stat);
                return (
                  <div key={row.label} className="flex justify-between gap-2">
                    <span className="text-gray-400">{row.label}</span>
                    <span className="truncate text-right text-gray-200">
                      {best ? <>{best.name} <span className="text-gray-500">+{best.bonus}</span></> : <span className="text-gray-500">-</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-gray-700 p-1">
            {canManageCrew && (
              <div className="mb-1 flex items-center justify-end gap-1">
                {TEAMS.map(team => (
                  <button
                    key={team}
                    title={team}
                    onClick={() => onSetCrewTeam(team)}
                    className={`h-3.5 w-3.5 rounded-full border ${ship.crewTeam === team ? 'border-white' : 'border-gray-600'}`}
                    style={{ backgroundColor: TEAM_COLORS[team as Team] }}
                  />
                ))}
              </div>
            )}
            <CrewRoster
              crews={availableCrew}
              crewState={crewState as any}
              stations={stations}
              canEdit={canEditRoster}
              readOnly={readOnly}
              autoArmed={autoArmed}
              canAuto={canManageCrew && !readOnly}
              onAuto={onAutoClick}
              onClear={onClearClick}
              onAdjust={onAdjustCrew}
              onRevive={onReviveCrew}
              onDiscard={onDiscardCrew}
            />
          </div>

          <CargoManifest
            items={manifest}
            capacity={cargoCapacity}
            canEdit={canManageCrew && !readOnly}
            foodWaterDays={foodWaterDays}
            people={livingCrew + livingHeroes}
            onChange={onUpdateManifest}
          />

        </div>

        <div className="flex min-h-0 flex-col">
          <div className="shrink-0 text-[10px] uppercase tracking-wide text-gray-500">Ship layout</div>
          {build && stats ? (
            <div className="min-h-0 flex-1">
            <ShipLayout
              build={build}
              stats={stats}
              readOnly
              hideEmpty
              heroesByCard={heroesByCard}
              boxState={ship.boxState as Record<string, number>}
              cardStepsByCard={cardStepsByCard}
              presentCrewByCard={presentCrewByCard}
              occupantsByCard={occupantsByCard}
              weaponInfoByCard={weaponInfoByCard}
              cardFunctions={cardFunctions}
              teamAlliances={teamAlliances}
              hideHeroTokens={hideHeroTokens}
              cardToggles={autoArmed ? autoEnabled : undefined}
              onToggleCard={autoArmed ? toggleCard : undefined}
              cardChecks={cardChecks}
              revealAllCards={revealAllCards}
              visibleCardKeys={visibleCardKeys}
              onSlotContextMenu={(event, _region, _index, card) => {
                event.preventDefault();
                if (!card?.cardKey || (card.crewRequired ?? 0) <= 0) return;
                if (!canManageCard(card.cardKey)) return;
                setCardMenu({
                  x: event.clientX,
                  y: event.clientY,
                  cardKey: card.cardKey,
                  capacity: card.crewRequired,
                });
              }}
              onHeroDrop={(heroId, _from, toCardKey, xPct, yPct) => onMoveHeroToken(heroId, toCardKey, xPct, yPct)}
              onHeroDropToMap={onHeroDropToMap}
            />
            </div>
          ) : (
            <div className="rounded-lg border border-gray-700 p-3 text-[11px] text-gray-500">Layout unavailable.</div>
          )}

        </div>
      </div>
    </DraggablePanel>
    {cardMenu && (() => {
      const key = cardMenu.cardKey;
      const crewHere = ship.stations?.[key]?.crewIds?.length ?? 0;
      const present = presentCrewByCard[key] ?? 0;
      const canFill = present < cardMenu.capacity && availableCrew.length > 0;
      const canEmpty = crewHere > 0;
      return (
        <Floating
          ref={cardMenuRef}
          x={cardMenu.x}
          y={cardMenu.y}
          interactive
          z={250}
          className="w-44 rounded border border-gray-600 bg-gray-800 p-1 shadow-xl"
        >
          <button
            type="button"
            disabled={!canFill}
            onClick={() => { setCardMenu(null); onFillStation(key); }}
            className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Fill station
          </button>
          <button
            type="button"
            disabled={!canEmpty}
            onClick={() => { setCardMenu(null); onEmptyStation(key); }}
            className="w-full text-left px-2 py-1.5 text-xs rounded text-red-300 hover:bg-red-900/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Empty station
          </button>
        </Floating>
      );
    })()}
    {cardActionConfirm && (
      <div
        className="fixed inset-0 z-[260] grid place-items-center bg-black/60 p-4"
        onMouseDown={() => setCardActionConfirm(null)}
      >
        <div
          className="w-full max-w-sm rounded-lg border border-gray-600 bg-gray-800 p-3 shadow-xl"
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="mb-1 text-sm font-semibold text-amber-200">
            {cardActionConfirm.kind === 'sail'
              ? 'Trim the sails'
              : cardActionConfirm.kind === 'rudder'
                ? 'Trim the rudder'
                : cardActionConfirm.kind === 'weapon-fire'
                  ? 'Fire the weapon'
                  : 'Load the weapon'}
          </div>
          <p className="mb-2 rounded border border-amber-600/60 bg-amber-900/30 px-2 py-1 text-[11px] text-amber-200">
            {cardActionConfirm.noCardSteps
              ? 'No card steps left on that card this turn. Approve to spend a negative hero action and use the card function anyway.'
              : `${cardActionConfirm.names.join(', ')} ${cardActionConfirm.names.length === 1 ? 'has' : 'have'} no actions left. Approve to spend an action and go negative.`}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCardActionConfirm(null)}
              className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const confirm = cardActionConfirm;
                setCardActionConfirm(null);
                if (confirm.kind === 'sail') onSailSpeed(confirm.cardKey, confirm.delta ?? 1, true);
                else if (confirm.kind === 'rudder') onRudderTrim(confirm.cardKey, true);
                else if (confirm.kind === 'weapon-fire') onFireWeapon(confirm.cardKey, true);
                else onLoadWeapon(confirm.cardKey, true);
              }}
              className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-200 hover:bg-amber-700/30"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    )}
    {repairModal && (() => {
      const zeroHeroes = hullActionHeroes.filter(h => (h.unit.actionsAvailable ?? 0) < 1);
      return (
        <div
          className="fixed inset-0 z-[260] grid place-items-center bg-black/60 p-4"
          onMouseDown={() => setRepairModal(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gray-600 bg-gray-800 p-3 shadow-xl"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="mb-1 text-sm font-semibold text-amber-200">Repair {ship.name}</div>
            <p className="mb-2 text-[11px] text-gray-400">
              One repair kit restores 4d8 + best repair bonus HP (up to 80% max) and one ton of damaged equipment.
            </p>
            {repairModal.damaged.length > 0 ? (
              <>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Restore one damaged ton</div>
                <div className="mb-2 max-h-48 space-y-1 overflow-y-auto">
                  {repairModal.damaged.map(card => {
                    const destroyed = Number((ship.boxState as Record<string, number> | undefined)?.[card.key] ?? 0);
                    return (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => setRepairTarget(card.key)}
                        className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left text-xs ${
                          repairTarget === card.key
                            ? 'border-amber-500 bg-amber-900/30 text-amber-100'
                            : 'border-gray-600 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <span className="font-medium">{card.name}</span>
                        <span className="text-gray-400">{destroyed}/{card.tons}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="mb-2 text-[11px] text-gray-400">No damaged equipment; this repair heals hull HP only.</p>
            )}
            {(repairModal.needsActionApproval || repairModal.noCardSteps) && (
              <p className="mb-2 rounded border border-amber-600/60 bg-amber-900/30 px-2 py-1 text-[11px] text-amber-200">
                {repairModal.noCardSteps
                  ? 'No card steps left on the hull this turn. Approve to spend a negative hero action and repair anyway.'
                  : `${zeroHeroes.map(h => h.name).join(', ')} ${zeroHeroes.length === 1 ? 'has' : 'have'} no actions left. Approve to repair and let the action go negative.`}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRepairModal(null)}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={repairModal.damaged.length > 0 && !repairTarget}
                onClick={() => {
                  const modal = repairModal;
                  setRepairModal(null);
                  onRepair(modal.cardKey, repairTarget, !!(modal.needsActionApproval || modal.noCardSteps));
                }}
                className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-200 hover:bg-amber-700/30 disabled:opacity-40"
              >
                Repair
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    </>
  );
}
