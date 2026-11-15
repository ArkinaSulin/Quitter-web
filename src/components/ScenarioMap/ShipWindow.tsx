'use client';

// Tactical ship window (double-click a ship image). Non-modal floating panel:
// summary + compact deck + roster. Speed declaration lives in its own step-1
// panel (`SpeedDeclarationPanel`).

import { useEffect, useState } from 'react';
import { AllianceGroup, Unit } from '@/types/gameProtocol';
import {
  ShipRuntime,
  ShipBuild,
  componentById,
  deckOrderedCardKeys,
  ensureDeckSlot,
  findCardKeyForComponent,
  findCardKeysForComponent,
  resolveShipWeaponDamage,
  shipStationCards,
  shipStationStat,
  shipStationCheckLabel,
  crewCheckBonus,
  heroCheckBonus,
  type CheckStat,
  shipWeaponCards,
} from '@/packages/ships';
import type { ShipCardAction, ShipCardWeaponInfo } from '@/components/ShipRenderer/ShipComponentCard';
import { ShipLayout } from '@/components/ShipRenderer/ShipLayout';
import { CrewRoster } from '@/components/ShipRenderer/CrewRoster';
import type { CrewDraft } from '@/components/ShipRenderer/CrewAdjustDialog';
import { DraggablePanel } from '@/components/shared/DraggablePanel';
import { TEAMS, TEAM_COLORS, type Team } from '@/packages/units';

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
  onClose: () => void;
  boardedHeroes: BoardedHero[];
  onFireWeapon: (cardKey: string) => void;
  canManageCrew: boolean;
  canFillHelm: boolean;
  onSetCrewTeam: (team: string | null) => void;
  onFillHelm: () => void;
  teamAlliances: Record<string, AllianceGroup>;
  onMoveHeroToken: (heroId: string, toCardKey: string, xPct: number, yPct: number) => void;
  onHeroDropToMap: (heroId: string, clientX: number, clientY: number) => void;
  onSailSpeed: (cardKey: string, delta: 1 | -1) => void;
  onRudderTrim: (cardKey: string) => void;
  onRepair: (cardKey: string) => void;
  onRam: (cardKey: string) => void;
  canEditRoster: boolean;
  onAdjustCrew: (args: { ids: string[]; draft: CrewDraft; count: number }) => void;
  onReviveCrew: (ids: string[], hp: number) => void;
  onDiscardCrew: (ids: string[]) => void;
  onAutoAssignCrew: (enabledKeys: string[]) => void;
  onClearCrew: () => void;
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
  onClose,
  boardedHeroes,
  onFireWeapon,
  canManageCrew,
  canFillHelm,
  onSetCrewTeam,
  onFillHelm,
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
}: ShipWindowProps) {
  const stats = ship.snapshot?.stats;
  const template = ship.snapshot?.template;
  const build = ship.snapshot?.build;

  const crewRows = template?.crews ?? [];
  const crewState = ship.crewState ?? {};
  const livingCrew = crewRows.filter(c => !crewState[c.id]?.dead).length;
  const stationCards = build ? shipStationCards(build) : [];
  const stations = stationCards.map(card => ({ key: card.key, name: card.name, crew: card.crewRequired }));
  const [autoArmed, setAutoArmed] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState<Record<string, boolean>>({});
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
  const crewQuartersKey = build ? findCardKeyForComponent(build, 'Crew quarters') : null;
  const deckCardKey = build ? findCardKeyForComponent(build, 'Deck') : null;
  const heroesByCard: Record<string, BoardedHero[]> = {};
  for (const h of boardedHeroes) {
    const key = h.shipStationKey || deckCardKey || crewQuartersKey;
    if (!key) continue;
    (heroesByCard[key] ??= []).push(h);
  }

  const occupantsByCard: Record<string, { id: string; name: string; isHero: boolean }[]> = {};
  for (const h of boardedHeroes) {
    const key = h.shipStationKey || deckCardKey || crewQuartersKey;
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
    !h.shipStationKey || h.shipStationKey === deckCardKey || h.shipStationKey === crewQuartersKey,
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
    { label: 'Helmsmanship', stat: 'wis' },
    { label: 'Bridge', stat: 'int' },
    { label: 'Rudder', stat: 'int' },
    { label: 'Sail speed', stat: 'con' },
    { label: 'Weapon', stat: 'dex' },
    { label: 'Repair', stat: 'str' },
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
  for (const card of weaponCards) {
    const reload = ship.reload?.[card.key];
    const armed = !!reload?.armed || card.weapon.reloadSteps === 0;
    const present = presentCrewByCard[card.key] ?? 0;
    const destroyed = Number((ship.boxState as Record<string, number> | undefined)?.[card.key] ?? 0);
    const remaining = Math.max(0, card.tons - destroyed);
    weaponInfoByCard[card.key] = {
      damage: resolveShipWeaponDamage(card.weapon, stats?.totalMass ?? 0),
      reloadLabel: armed ? 'Armed' : `load ${reload?.progress ?? 0}/${card.weapon.reloadSteps}`,
      armed,
      canFire: !readOnly && armed && remaining > 0 && present >= Math.ceil(card.weapon.crew),
      onFire: () => onFireWeapon(card.key),
    };
  }

  const cardActions: Record<string, ShipCardAction[]> = {};
  if (build?.deckLayout) {
    const deck = build.components.find(c => c.name === 'Deck');
    const deckKeyForLayout = deck ? `component:${deck.id || 'Deck'}` : 'component:Deck';
    for (const key of deckOrderedCardKeys(ensureDeckSlot(build.deckLayout, deckKeyForLayout))) {
      if (!key.startsWith('component:')) continue;
      const id = key.slice('component:'.length).replace(/:\d+$/, '');
      const component = componentById(build.components, id);
      const present = presentCrewByCard[key] ?? 0;
      const canUse = !readOnly && present > 0;
      if (component.name === 'Sail') {
        cardActions[key] = [
          { label: 'Speed +', enabled: canUse, onClick: () => onSailSpeed(key, 1) },
          { label: 'Speed −', enabled: canUse, onClick: () => onSailSpeed(key, -1) },
        ];
      } else if (component.name === 'Rudder') {
        cardActions[key] = [
          { label: 'Trim MC', enabled: canUse, onClick: () => onRudderTrim(key) },
        ];
      } else if (component.name === 'Hull') {
        cardActions[key] = [
          { label: 'Repair', enabled: !readOnly && present >= 3, onClick: () => onRepair(key) },
        ];
      } else if (component.name === 'Helm') {
        cardActions[key] = [
          { label: 'Ram', enabled: canUse, onClick: () => onRam(key) },
        ];
      } else if (component.name === 'Command bridge' || component.name === 'Bridge') {
        cardActions[key] = [
          { label: 'Bridge', enabled: bridgeFull, title: bridgeFull ? 'Bridge fully crewed' : 'Bridge needs its full crew complement', onClick: () => {} },
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
    <DraggablePanel
      title={ship.name}
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
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Tactical summary</div>
            {stats ? (
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between"><span className="text-gray-400">AC / DT</span><span>{stats.ac} / {stats.damageThreshold}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">HP</span><span>{ship.shipHp}/{ship.shipHpMax}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Mass</span><span>{stats.totalMass}t</span></div>
                <div className="flex justify-between pl-3 text-[10px]"><span className="text-gray-500">Current</span><span className="text-gray-300">{stats.performanceMass}t</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Atmo speed</span><span>{stats.atmosphericSpeed}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Accel</span><span>{stats.accel}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">MC</span><span>{stats.mcBands.map(b => `${b.speedMin}-${b.speedMax}:${b.mc}`).join(' / ')}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Crew</span><span>{livingCrew} / {stats.crewCapacity}</span></div>
                <div className="flex justify-between pl-3 text-[10px]"><span className="text-gray-500">Min</span><span className="text-gray-300">{stats.minCrew}</span></div>
                <div className="flex justify-between pl-3 text-[10px]"><span className="text-gray-500">Full</span><span className="text-gray-300">{stats.fullCrew}</span></div>
                {shipMode === 'wildspace' && (
                  <div className="flex justify-between"><span className="text-gray-400">Speed (step {shipStep})</span><span>{ship.declaredSpeed || ship.lastSpeed}</span></div>
                )}
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
                <button
                  onClick={onFillHelm}
                  className="rounded border border-amber-600 px-1.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-700/30"
                >
                  Fill Helm
                </button>
                {TEAMS.map(team => (
                  <button
                    key={team}
                    title={team}
                    onClick={() => onSetCrewTeam(team)}
                    className={`h-3.5 w-3.5 rounded-full border ${ship.crewTeam === team ? 'border-white' : 'border-gray-600'}`}
                    style={{ backgroundColor: TEAM_COLORS[team as Team] }}
                  />
                ))}
                <button
                  onClick={() => onSetCrewTeam(null)}
                  title="No team"
                  className={`h-3.5 w-3.5 rounded-full border border-gray-600 bg-gray-800 ${ship.crewTeam == null ? 'ring-1 ring-white' : ''}`}
                />
              </div>
            )}
            <CrewRoster
              crews={crewRows}
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
              presentCrewByCard={presentCrewByCard}
              occupantsByCard={occupantsByCard}
              weaponInfoByCard={weaponInfoByCard}
              cardActions={cardActions}
              teamAlliances={teamAlliances}
              hideHeroTokens={hideHeroTokens}
              cardToggles={autoArmed ? autoEnabled : undefined}
              onToggleCard={autoArmed ? toggleCard : undefined}
              cardChecks={cardChecks}
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
  );
}
