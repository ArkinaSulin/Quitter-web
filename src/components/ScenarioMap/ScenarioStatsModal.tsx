'use client';
// src/components/ScenarioMap/ScenarioStatsModal.tsx
// Scenario battle statistics (derived from the command log + live units).
// GM sees it in live play; any player sees it in replay. "Share" posts a
// plain-text summary to the room's Messages channel (hidden units revealed
// fully).
//
// Rows are grouped by alliance (Friendly → Enemy → Neutral) with an alliance
// summary line, then by team (color chip) — empty teams and an empty Neutral
// alliance are hidden.
import { Fragment, useMemo } from 'react';
import { Unit, AllianceGroup, ALLIANCE_COLORS } from '@/types/gameProtocol';
import { CommandLogRow } from '@/lib/commandLog';
import { buildStats, formatStatsText } from '@/lib/battleStats';
import { TEAM_COLORS } from '@/components/TokenRenderer/tokenUtils';

interface Props {
  rows: CommandLogRow[];
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  onClose: () => void;
  onShare: (text: string) => void;
}

const btn = 'px-3 py-1.5 rounded text-sm font-semibold transition-colors';

const ALLIANCE_LABEL: Record<AllianceGroup, string> = {
  friendly: 'Friendly Alliance',
  enemy: 'Enemy Alliance',
  neutral: 'Neutral Alliance',
};

export function ScenarioStatsModal({ rows, units, alliances, onClose, onShare }: Props) {
  const stats = useMemo(() => buildStats(rows, units, alliances), [rows, units, alliances]);

  const num = 'py-1 pr-2 text-right tabular-nums';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-5 min-w-[680px] max-w-[920px] max-h-[80vh] flex flex-col"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-white text-sm font-semibold">Scenario Statistics</p>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xs">
            Close
          </button>
        </div>
        <div className="overflow-y-auto flex-1 text-xs text-gray-200">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="py-1 pr-2">Unit</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2 text-right">Troops</th>
                <th className="py-1 pr-2 text-right">Lv</th>
                <th className="py-1 pr-2 text-right">Troop lost</th>
                <th className="py-1 pr-2 text-right">Levels lost</th>
                <th className="py-1 pr-2 text-right">Kills</th>
                <th className="py-1 text-right">Kill levels</th>
              </tr>
            </thead>
            <tbody>
              {stats.alliances.map(a => (
                <Fragment key={a.alliance}>
                  <tr className="border-b border-gray-700" style={{ backgroundColor: ALLIANCE_COLORS[a.alliance] + '22' }}>
                    <td className="py-1 pr-2 font-semibold" style={{ color: ALLIANCE_COLORS[a.alliance] }}>
                      {ALLIANCE_LABEL[a.alliance]}
                    </td>
                    <td className="py-1 pr-2 text-gray-300">
                      {a.deployed} deployed · {a.survived} survived
                    </td>
                    <td className={`${num} font-semibold`}>{a.totalTroops}</td>
                    <td className={`${num} font-semibold`}>{a.totalLevels}</td>
                    <td className={`${num} font-semibold`}>{a.totalTroopLost}</td>
                    <td className={`${num} font-semibold`}>{a.totalLevelsLost}</td>
                    <td className={`${num} font-semibold`}>{a.totalKills}</td>
                    <td className={`${num} font-semibold`}>{a.totalKillLevels}</td>
                  </tr>
                  {a.teams.map(t => (
                    <Fragment key={t.team}>
                      <tr className="border-b border-gray-800">
                        <td colSpan={8} className="py-1 pr-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: TEAM_COLORS[t.team as keyof typeof TEAM_COLORS] ?? '#666' }} />
                            <span className="capitalize text-gray-300 font-medium">{t.team}</span>
                          </span>
                        </td>
                      </tr>
                      {t.rows.map(r => (
                        <tr key={r.unitId} className="border-b border-gray-800">
                          <td className="py-1 pr-2 pl-4">
                            {r.isHero ? '★ ' : ''}
                            {r.unitName}
                            {r.hidden ? <span className="text-gray-500"> (hidden)</span> : null}
                          </td>
                          <td className="py-1 pr-2">
                            <span
                              className={
                                r.status === 'Killed' ? 'text-red-400' : r.status === 'Routed' ? 'text-amber-300' : 'text-emerald-300'
                              }
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className={num}>{r.introTroopCount}</td>
                          <td className={num}>{r.level}</td>
                          <td className={num}>{r.troopLost}</td>
                          <td className={num}>{r.levelsLost}</td>
                          <td className={num}>{r.kills}</td>
                          <td className={num}>{r.killLevels}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button
            className={`${btn} bg-sky-700 hover:bg-sky-600 text-white`}
            onClick={() => onShare(formatStatsText(stats))}
            title="Post the summary to everyone's Messages log"
          >
            Share to all players
          </button>
          <button className={`${btn} bg-gray-700 hover:bg-gray-600 text-white`} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
