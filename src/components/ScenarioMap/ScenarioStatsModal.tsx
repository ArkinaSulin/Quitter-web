'use client';
// src/components/ScenarioMap/ScenarioStatsModal.tsx
// Scenario battle statistics (derived from the command log + live units).
// GM sees it in live play; any player sees it in replay. "Share" posts a
// plain-text summary to the room's Messages channel (hidden units revealed
// fully).
import { useMemo } from 'react';
import { Unit, AllianceGroup, ALLIANCE_COLORS } from '@/types/gameProtocol';
import { CommandLogRow } from '@/lib/commandLog';
import { buildStats, formatStatsText } from '@/lib/battleStats';

interface Props {
  rows: CommandLogRow[];
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  onClose: () => void;
  onShare: (text: string) => void;
}

const btn = 'px-3 py-1.5 rounded text-sm font-semibold transition-colors';

export function ScenarioStatsModal({ rows, units, alliances, onClose, onShare }: Props) {
  const stats = useMemo(() => buildStats(rows, units, alliances), [rows, units, alliances]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-5 min-w-[560px] max-w-[820px] max-h-[80vh] flex flex-col"
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
                <th className="py-1 pr-2">Lv</th>
                <th className="py-1 pr-2 text-right">Troops (now / T1 / max)</th>
                <th className="py-1 pr-2 text-right">Kills</th>
                <th className="py-1 text-right">Hostile lv</th>
              </tr>
            </thead>
            <tbody>
              {stats.rows.map(r => (
                <tr key={r.unitId} className="border-b border-gray-800">
                  <td className="py-1 pr-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: ALLIANCE_COLORS[r.alliance] }}
                    />
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
                  <td className="py-1 pr-2">{r.level}</td>
                  <td className="py-1 pr-2 text-right">
                    {r.currentTroopCount} / {r.turn1TroopCount} / {r.maxTroopCount}
                  </td>
                  <td className="py-1 pr-2 text-right">{r.kills}</td>
                  <td className="py-1 text-right">{r.hostileLevels}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-gray-400">
            Totals: {stats.totals.kills} enemy troops killed · {stats.totals.hostileLevels} hostile levels
          </p>
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
