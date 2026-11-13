'use client';

// Tactical ship window (double-click a ship image). Non-modal floating panel:
// summary + compact deck + roster. Speed declaration lives in its own step-1
// panel (`SpeedDeclarationPanel`).

import { useEffect, useState } from 'react';
import { AllianceGroup, Unit } from '@/types/gameProtocol';
import { ShipRuntime, ShipBuild, componentById, deckOrderedCardKeys, ensureDeckSlot, findCardKeyForComponent, resolveShipWeaponDamage, weaponById, shipWeaponCards } from '@/packages/ships';
import type { ShipCardWeaponInfo } from '@/components/ShipRenderer/ShipComponentCard';
import { ShipLayout } from '@/components/ShipRenderer/ShipLayout';
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
  /** Assign a crew member to a card key, or null = reserve. */
  onAssignCrew: (crewId: string, station: string | null) => void;
  boardedHeroes: BoardedHero[];
  onFireWeapon: (cardKey: string) => void;
  canManageCrew: boolean;
  canFillHelm: boolean;
  onSetCrewTeam: (team: string | null) => void;
  onFillHelm: () => void;
  teamAlliances: Record<string, AllianceGroup>;
  onMoveHeroToken: (heroId: string, toCardKey: string, xPct: number, yPct: number) => void;
  onHeroDropToMap: (heroId: string, clientX: number, clientY: number) => void;
}

interface StationOption {
  key: string;
  name: string;
  crew: number;
}

function stationOptions(build: ShipBuild | undefined): StationOption[] {
  if (!build?.deckLayout) return [];
  const deck = build.components.find(c => c.name === 'Deck');
  const deckKey = deck ? `component:${deck.id || 'Deck'}` : 'component:Deck';
  const layout = ensureDeckSlot(build.deckLayout, deckKey);
  const out: StationOption[] = [];
  for (const key of deckOrderedCardKeys(layout)) {
    if (key.startsWith('component:')) {
      const c = componentById(build.components, key.slice('component:'.length));
      out.push({ key, name: c.name, crew: c.crew });
    } else if (key.startsWith('optional:')) {
      const id = key.slice('optional:'.length).split(':')[0];
      const c = build.components.find(x => x.id === id);
      if (c) out.push({ key, name: c.name, crew: c.crew });
    } else if (key.startsWith('weapon:')) {
      const rowId = key.slice('weapon:'.length).replace(/:\d+$/, '');
      const row = build.templateWeapons.find(w => w.id === rowId);
      const w = row ? weaponById(build.weaponsCatalog, row.weaponId) : undefined;
      out.push({ key, name: w?.name || 'Weapon', crew: w?.crew ?? 0 });
    }
  }
  return out;
}

export function ShipWindow({
  ship,
  readOnly,
  shipMode,
  shipStep,
  onClose,
  onAssignCrew,
  boardedHeroes,
  onFireWeapon,
  canManageCrew,
  canFillHelm,
  onSetCrewTeam,
  onFillHelm,
  teamAlliances,
  onMoveHeroToken,
  onHeroDropToMap,
}: ShipWindowProps) {
  const stats = ship.snapshot?.stats;
  const template = ship.snapshot?.template;
  const build = ship.snapshot?.build;

  const crewRows = template?.crews ?? [];
  const crewState = ship.crewState ?? {};
  const stations = stationOptions(build);
  const presentCrewByCard: Record<string, number> = {};
  for (const [key, entry] of Object.entries(ship.stations ?? {})) {
    const heroIds = new Set([...(entry.heroIds ?? []), ...(entry.heroId ? [entry.heroId] : [])]);
    presentCrewByCard[key] = (entry.crewIds?.length ?? 0) + heroIds.size;
  }
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
        name: crew?.name || 'Crew',
        isHero: false,
      });
    }
  }

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
      <div className="grid gap-3 p-3 lg:grid-cols-[210px_1fr]">
        <div className="space-y-3">
          <div className="rounded-lg border border-gray-700 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Tactical summary</div>
            {stats ? (
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between"><span className="text-gray-400">AC / DT</span><span>{stats.ac} / {stats.damageThreshold}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">HP</span><span>{ship.shipHp}/{ship.shipHpMax}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Mass</span><span>{stats.totalMass}t</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Atmo speed</span><span>{stats.atmosphericSpeed}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Accel</span><span>{stats.accel}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">MC</span><span>{stats.mcBands.map(b => `${b.speedMin}-${b.speedMax}:${b.mc}`).join(' · ')}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Crew</span><span>{crewRows.length}/{stats.crewCapacity}</span></div>
                {shipMode === 'wildspace' && (
                  <div className="flex justify-between"><span className="text-gray-400">Speed (step {shipStep})</span><span>{ship.declaredSpeed || ship.lastSpeed}</span></div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-gray-500">No frozen snapshot on this ship.</div>
            )}
          </div>

          <div className="rounded-lg border border-gray-700">
            <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-2 py-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Roster</span>
              {canManageCrew && (
                <div className="flex items-center gap-1">
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
            </div>
            <div className="max-h-[42vh] divide-y divide-gray-800 overflow-y-auto">
              {crewRows.length === 0 && <div className="p-2 text-[11px] text-gray-500">No crew on the roster.</div>}
              {crewRows.map(c => {
                const state = crewState[c.id];
                const hp = state?.hp ?? c.hp;
                const dead = state?.dead;
                const pct = c.hp > 0 ? hp / c.hp : 1;
                const dot = dead ? 'bg-gray-600' : pct < 0.5 ? 'bg-red-500' : pct < 1 ? 'bg-yellow-400' : 'bg-transparent';
                return (
                  <div key={c.id} className={`flex items-center gap-2 px-2 py-1 text-[11px] ${dead ? 'opacity-50' : ''}`}>
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    <span className="min-w-0 flex-1 truncate">{state?.leader ? '★ ' : ''}{c.name || 'Crew'}</span>
                    <span className="text-gray-400">L{c.level}</span>
                    <span className="text-gray-400">HP {hp}/{c.hp}</span>
                    {readOnly || !canManageCrew ? (
                      <span className="text-gray-500">{state?.station || 'reserve'}</span>
                    ) : (
                      <select
                        value={state?.station || ''}
                        onChange={e => onAssignCrew(c.id, e.target.value || null)}
                        className="max-w-[120px] rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-[10px]"
                      >
                        <option value="">Reserve</option>
                        {stations.map(s => (
                          <option key={s.key} value={s.key}>{s.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Ship layout</div>
          {build && stats ? (
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
              teamAlliances={teamAlliances}
              hideHeroTokens={hideHeroTokens}
              onHeroDrop={(heroId, _from, toCardKey, xPct, yPct) => onMoveHeroToken(heroId, toCardKey, xPct, yPct)}
              onHeroDropToMap={onHeroDropToMap}
            />
          ) : (
            <div className="rounded-lg border border-gray-700 p-3 text-[11px] text-gray-500">Layout unavailable.</div>
          )}

        </div>
      </div>
    </DraggablePanel>
  );
}
