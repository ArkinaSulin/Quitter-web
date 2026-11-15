'use client';

import { useRef, useState } from 'react';
import { ShipCrew } from '@/types/ship';
import { CREW_SKILL_BONUS, crewCheckBonus, proficiencyBonus } from '@/packages/ships';
import { BoundedTooltip } from '@/components/shared/BoundedTooltip';
import { CrewAdjustDialog, CrewDraft, defaultCrewDraft } from './CrewAdjustDialog';

export interface CrewRosterState {
  hp: number;
  dead?: boolean;
  station?: string | null;
  leader?: boolean;
}

export interface CrewRosterProps {
  crews: ShipCrew[];
  crewState?: Record<string, CrewRosterState>;
  stations?: { key: string; name: string; crew: number }[];
  canEdit: boolean;
  readOnly?: boolean;
  autoArmed?: boolean;
  canAuto?: boolean;
  onAuto?: () => void;
  onClear?: () => void;
  onAdjust: (args: { ids: string[]; draft: CrewDraft; count: number }) => void;
  onRevive?: (ids: string[], hp: number) => void;
  onDiscard?: (ids: string[]) => void;
}

interface CrewGroup {
  key: string;
  ids: string[];
  crew: ShipCrew;
  count: number;
  dead: boolean;
  station: string | null | 'mixed';
  displayName: string;
}

const AUTO_NAME = /^crew level \d+$/i;

function displayNameOf(crew: ShipCrew): string {
  const name = crew.name?.trim();
  if (!name || AUTO_NAME.test(name)) return 'Crew';
  return name;
}

function groupKeyOf(crew: ShipCrew): string {
  return [
    displayNameOf(crew),
    crew.level,
    crew.str,
    crew.dex,
    crew.con,
    crew.int,
    crew.wis,
    crew.cha,
    crew.cost,
  ].join('|');
}

function draftOf(crew: ShipCrew, count: number): CrewDraft {
  return {
    count,
    name: displayNameOf(crew) === 'Crew' ? '' : (crew.name ?? ''),
    level: crew.level,
    hp: crew.hp,
    str: crew.str,
    dex: crew.dex,
    con: crew.con,
    int: crew.int,
    wis: crew.wis,
    cha: crew.cha,
    cost: crew.cost,
  };
}

export function CrewRoster({
  crews,
  crewState,
  stations,
  canEdit,
  readOnly,
  autoArmed = false,
  canAuto = false,
  onAuto,
  onClear,
  onAdjust,
  onRevive,
  onDiscard,
}: CrewRosterProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dialog, setDialog] = useState<{ ids: string[]; crew?: ShipCrew; count: number; allowRemove: boolean } | null>(null);
  const [revive, setRevive] = useState<{ ids: string[]; crew: ShipCrew } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; group: CrewGroup } | null>(null);

  const buildGroups = (dead: boolean): CrewGroup[] => {
    const map = new Map<string, CrewGroup>();
    for (const crew of crews) {
      if (!!crewState?.[crew.id]?.dead !== dead) continue;
      const key = groupKeyOf(crew);
      const station = crewState?.[crew.id]?.station ?? null;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          ids: [crew.id],
          crew,
          count: 1,
          dead,
          station,
          displayName: displayNameOf(crew),
        });
      } else {
        existing.ids.push(crew.id);
        existing.count += 1;
        if (existing.station !== station) existing.station = 'mixed';
      }
    }
    return Array.from(map.values());
  };

  const aliveGroups = buildGroups(false);
  const deadGroups = buildGroups(true);

  const openAdjust = (group: CrewGroup) => {
    if (!canEdit) return;
    setDialog({
      ids: group.ids,
      crew: group.crew,
      count: group.count,
      allowRemove: true,
    });
  };
  const openAdd = () => {
    if (!canEdit) return;
    setDialog({ ids: [], count: 1, allowRemove: false });
  };

  const stationName = (key: string) => stations?.find(s => s.key === key)?.name ?? key;
  const rowClass = 'flex items-center gap-2 px-2 py-1 text-[11px]';
  const grid = 'grid grid-cols-[minmax(0,1fr)_26px_14px_26px]';
  const deadGrid = 'grid grid-cols-[minmax(0,1fr)_26px_14px_84px]';

  const tooltipFor = (group: CrewGroup) => {
    const crew = group.crew;
    const station = group.station === 'mixed'
      ? 'Mixed stations'
      : group.station
        ? stationName(group.station)
        : group.dead ? 'Dead' : 'Reserve';
    return (
      <div className="space-y-0.5">
        <div className="text-[11px] font-semibold text-amber-200">
          {group.displayName}{group.count > 1 ? ` x${group.count}` : ''}
          <span className="ml-1 font-normal text-gray-400">Level {crew.level}</span>
        </div>
        {group.dead ? (
          <div className="text-red-300">Dead (0/{crew.hp} HP)</div>
        ) : (
          <div className="text-gray-400">HP {crewState?.[group.ids[0]]?.hp ?? crew.hp}/{crew.hp} - {station}</div>
        )}
        <div className="text-gray-300">STR {crew.str} DEX {crew.dex} CON {crew.con} INT {crew.int} WIS {crew.wis} CHA {crew.cha}</div>
        <div className="text-gray-400">Proficiency +{proficiencyBonus(crew.level)} - CrewSkill +{CREW_SKILL_BONUS}</div>
        <div className="grid grid-cols-2 gap-x-3 text-gray-300">
          <span>Weapon: +{crewCheckBonus(crew, 'dex')}</span>
          <span>Helm: +{crewCheckBonus(crew, 'wis')}</span>
          <span>Sail speed: +{crewCheckBonus(crew, 'con')}</span>
          <span>Sail trim: +{crewCheckBonus(crew, 'int')}</span>
          <span>Repair: +{crewCheckBonus(crew, 'str')}</span>
          <span className="text-gray-500">{crew.cost} Gp/week</span>
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef} className="rounded-lg border border-gray-700">
      <div className="border-b border-gray-800 px-2 py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Roster</span>
          <div className="flex items-center gap-1">
            {canAuto && onAuto && (
              <button
                type="button"
                onClick={onAuto}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                  autoArmed
                    ? 'border-amber-300 bg-amber-600/50 text-amber-50'
                    : 'border-amber-600 text-amber-200 hover:bg-amber-700/30'
                }`}
              >
                {autoArmed ? 'Fill' : 'Auto'}
              </button>
            )}
            {canAuto && onClear && (
              <button
                type="button"
                onClick={onClear}
                className="rounded border border-gray-600 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-gray-800"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className={`mt-0.5 ${grid} gap-1 text-[9px] uppercase tracking-wide text-gray-500`}>
          <span>Name</span><span>Level</span><span /><span />
        </div>
      </div>

      <div className="max-h-[42vh] divide-y divide-gray-800 overflow-y-auto">
        {aliveGroups.length === 0 && <div className="p-2 text-[11px] text-gray-500">No living crew.</div>}

        {aliveGroups.map(group => (
          <div
            key={group.key}
            className={`${rowClass} ${grid}`}
            onMouseEnter={e => setHover({ x: e.clientX, y: e.clientY, group })}
            onMouseLeave={() => setHover(null)}
          >
            <span className="truncate text-gray-200">
              {group.displayName}{group.count > 1 ? ` x${group.count}` : ''}
            </span>
            <span className="text-gray-400">{group.crew.level}</span>
            <span />
            {canEdit ? (
              <button
                type="button"
                onClick={() => openAdjust(group)}
                className="rounded border border-amber-600 px-0.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-700/30"
              >
                +/-
              </button>
            ) : <span />}
          </div>
        ))}

        {deadGroups.length > 0 && (
          <div className="bg-red-950/30 px-2 py-1 text-[9px] uppercase tracking-wide text-red-300">Dead crew</div>
        )}
        {deadGroups.map(group => (
          <div
            key={group.key}
            className={`${rowClass} ${deadGrid} bg-red-950/20`}
            onMouseEnter={e => setHover({ x: e.clientX, y: e.clientY, group })}
            onMouseLeave={() => setHover(null)}
          >
            <span className="truncate text-gray-400">
              {group.displayName}{group.count > 1 ? ` x${group.count}` : ''}
            </span>
            <span className="text-gray-500">{group.crew.level}</span>
            <span title="Dead" className="text-red-300">&#9760;</span>
            <span className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setRevive({ ids: group.ids, crew: group.crew })}
                className="rounded border border-emerald-600 px-1 py-0.5 text-[10px] text-emerald-300"
              >
                Revive
              </button>
              <button
                type="button"
                onClick={() => onDiscard?.(group.ids)}
                className="rounded border border-red-600 px-1 py-0.5 text-[10px] text-red-300"
              >
                Discard
              </button>
            </span>
          </div>
        ))}

        {canEdit && (
          <button
            type="button"
            onClick={openAdd}
            className="flex w-full items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-emerald-300 hover:bg-gray-800"
          >
            + Add crew
          </button>
        )}
      </div>

      {hover && (
        <BoundedTooltip boundsRef={rootRef} x={hover.x} y={hover.y} width={230}>
          {tooltipFor(hover.group)}
        </BoundedTooltip>
      )}

      {dialog && (
        <CrewAdjustDialog
          draft={dialog.crew ? draftOf(dialog.crew, dialog.count) : defaultCrewDraft()}
          allowRemove={dialog.allowRemove}
          onCancel={() => setDialog(null)}
          onSave={draft => {
            onAdjust({ ids: dialog.ids, draft, count: draft.count });
            setDialog(null);
          }}
        />
      )}

      {revive && (
        <ReviveDialog
          title={`Revive ${revive.crew.name || 'Crew'}${revive.ids.length > 1 ? ` x${revive.ids.length}` : ''}`}
          maxHp={revive.crew.hp}
          onCancel={() => setRevive(null)}
          onRevive={hp => {
            onRevive?.(revive.ids, hp);
            setRevive(null);
          }}
        />
      )}
    </div>
  );
}

function ReviveDialog({
  title,
  maxHp,
  onCancel,
  onRevive,
}: {
  title: string;
  maxHp: number;
  onCancel: () => void;
  onRevive: (hp: number) => void;
}) {
  const [hp, setHp] = useState(maxHp);
  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70" onMouseDown={onCancel}>
      <div className="w-64 rounded-lg border border-gray-600 bg-gray-900 p-3" onMouseDown={e => e.stopPropagation()}>
        <div className="mb-2 text-xs text-gray-200">{title}</div>
        <label className="flex items-center gap-2 text-[11px] text-gray-400">
          HP
          <input
            type="number"
            min={1}
            max={maxHp}
            value={hp}
            onChange={e => setHp(Math.max(1, Math.min(maxHp, parseInt(e.target.value) || 1)))}
            className="w-20 rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-xs text-gray-100"
          />
          <button onClick={() => setHp(maxHp)} className="rounded border border-gray-600 px-1 py-0.5 text-[10px] text-gray-300">Full</button>
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-300">Cancel</button>
          <button
            onClick={() => onRevive(hp)}
            className="rounded border border-emerald-600 bg-emerald-800/40 px-2 py-0.5 text-xs text-emerald-200"
          >
            Revive
          </button>
        </div>
      </div>
    </div>
  );
}
