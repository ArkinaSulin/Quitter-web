'use client';

import React, { useState } from 'react';
import { AllianceGroup, ALLIANCE_COLORS } from '@/types/gameProtocol';
import { TEAMS, TEAM_COLORS, getDotColor } from '@/components/TokenRenderer/tokenUtils';

interface AlliancePanelProps {
  alliances: Record<string, AllianceGroup>;
  onMoveTeam: (team: string, targetGroup: AllianceGroup) => void;
  onClose?: () => void;
}

const GROUP_ORDER: AllianceGroup[] = ['friendly', 'enemy', 'neutral'];
const GROUP_LABELS: Record<AllianceGroup, string> = {
  friendly: 'Friendly',
  enemy: 'Enemy',
  neutral: 'Neutral',
};

export function AlliancePanel({ alliances, onMoveTeam, onClose }: AlliancePanelProps) {
  const [dragOverGroup, setDragOverGroup] = useState<AllianceGroup | null>(null);

  return (
    <div className="h-full flex flex-col p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-white text-sm font-semibold">Team Alliances</span>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">✕</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {GROUP_ORDER.map(group => {
          const teamsInGroup = TEAMS.filter(t => (alliances[t] || 'friendly') === group);
          const isOver = dragOverGroup === group;
          return (
            <div
              key={group}
              className={`rounded-lg p-2 border transition-colors ${isOver ? 'ring-2 ring-white' : ''}`}
              style={{
                borderColor: ALLIANCE_COLORS[group],
                backgroundColor: isOver ? ALLIANCE_COLORS[group] + '40' : ALLIANCE_COLORS[group] + '20',
              }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDragEnter={() => setDragOverGroup(group)}
              onDragLeave={() => setDragOverGroup(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverGroup(null);
                const team = e.dataTransfer.getData('text/plain');
                if (team && (alliances[team] || 'friendly') !== group) {
                  onMoveTeam(team, group);
                }
              }}
            >
              <div className="text-xs font-semibold mb-1" style={{ color: ALLIANCE_COLORS[group] }}>
                {GROUP_LABELS[group]}
              </div>
              <div className="flex flex-wrap gap-1 min-h-[24px]">
                {teamsInGroup.map(team => (
                  <span
                    key={team}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', team)}
                    className="inline-block px-2 py-0.5 rounded text-xs font-medium capitalize cursor-grab active:cursor-grabbing hover:opacity-80 transition-opacity select-none"
                    style={{
                      backgroundColor: TEAM_COLORS[team],
                      color: getDotColor(team),
                    }}
                  >
                    {team}
                  </span>
                ))}
                {teamsInGroup.length === 0 && (
                  <span className="text-xs text-gray-500 italic">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-gray-500 flex-shrink-0">
        Drag a team between groups
      </div>
    </div>
  );
}
