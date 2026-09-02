// src/components/ScenarioMap/PlayerPanel.tsx
'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Participant, ScenarioRole } from '@/types/gameProtocol';
import { TEAMS, Team } from '@/components/TokenRenderer/tokenUtils';
import { TeamChip } from '@/components/TokenRenderer/TeamChip';

const ROLE_OPTIONS: ScenarioRole[] = ['Player', 'SuperPlayer', 'AssistGM'];

interface PlayerPanelProps {
  participants: Participant[];
  roomOpen: boolean;
  onSetRoomOpen: (open: boolean) => void;
  onSetParticipantTeam: (participantId: string, team: string | null) => void;
  onSetParticipantRole: (participantId: string, role: ScenarioRole) => void;
  onKickParticipant: (participantId: string) => void;
}

/** GM-only roster: assign teams/roles, kick players, open/close the room. */
export function PlayerPanel({
  participants,
  roomOpen,
  onSetRoomOpen,
  onSetParticipantTeam,
  onSetParticipantRole,
  onKickParticipant,
}: PlayerPanelProps) {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = Array.from(new Set(participants.map(p => p.userId)));
    if (ids.length === 0) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', ids)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, string> = {};
        for (const row of data) if (row.display_name) map[row.id] = row.display_name;
        setNames(prev => ({ ...prev, ...map }));
      });
    return () => { cancelled = true; };
  }, [participants]);

  const gm = participants.filter(p => p.role === 'GM');
  const players = participants.filter(p => p.role !== 'GM');

  return (
    <div className="space-y-3">
      {/* Room open/close toggle */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800/60 rounded-lg border border-gray-700">
        <div>
          <div className="text-sm text-white font-semibold">Scenario Room</div>
          <div className={`text-xs ${roomOpen ? 'text-emerald-400' : 'text-red-400'}`}>
            {roomOpen ? 'Open — new players can join' : 'Closed — no new players can join'}
          </div>
        </div>
        <button
          onClick={() => onSetRoomOpen(!roomOpen)}
          className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
            roomOpen
              ? 'bg-red-800 hover:bg-red-700 text-white'
              : 'bg-emerald-700 hover:bg-emerald-600 text-white'
          }`}
        >
          {roomOpen ? 'Close Room' : 'Open Room'}
        </button>
      </div>

      {/* Game Master (creator — fixed role, but may pick a team to play as a player) */}
      {gm.map(p => (
        <div key={p.id} className="px-3 py-2 bg-amber-900/20 border border-amber-700/40 rounded-lg space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-amber-300 font-semibold">Game Master</span>
            <span className="text-white text-sm truncate">{names[p.userId] || 'Unknown'}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-gray-400 shrink-0">Team (player mode)</label>
            <div className="flex flex-wrap gap-1 items-center justify-end">
              {(TEAMS as Team[]).map(team => (
                <TeamChip
                  key={team}
                  team={team}
                  selected={p.team === team}
                  onClick={t => onSetParticipantTeam(p.id, p.team === t ? null : t)}
                />
              ))}
            </div>
          </div>
          {!p.team && (
            <div className="text-[11px] text-amber-200/70">
              No team — the DM must pick a team before playing as a player.
            </div>
          )}
        </div>
      ))}

      {/* Player roster */}
      {players.length === 0 && (
        <div className="text-xs text-gray-500 italic px-1">No players joined yet.</div>
      )}
      {players.map(p => (
        <div key={p.id} className="px-3 py-2 bg-gray-800/60 rounded-lg border border-gray-700 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white text-sm truncate">{names[p.userId] || 'Unknown Player'}</span>
            <button
              onClick={() => {
                if (window.confirm(`Kick ${names[p.userId] || 'this player'} from the scenario?`)) {
                  onKickParticipant(p.id);
                }
              }}
              className="px-2 py-0.5 rounded bg-red-900/70 hover:bg-red-800 text-red-200 text-[11px]"
            >
              Kick
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-gray-400 shrink-0">Role</label>
            <select
              value={p.role}
              onChange={e => onSetParticipantRole(p.id, e.target.value as ScenarioRole)}
              className="flex-1 bg-gray-900 text-white text-xs rounded px-2 py-1 border border-gray-700"
            >
              {ROLE_OPTIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-gray-400 shrink-0">Team</label>
            <div className="flex flex-wrap gap-1 items-center justify-end">
              {(TEAMS as Team[]).map(team => (
                <TeamChip
                  key={team}
                  team={team}
                  selected={p.team === team}
                  onClick={t => onSetParticipantTeam(p.id, p.team === t ? null : t)}
                />
              ))}
            </div>
          </div>

          {!p.team && (
            <div className="text-[11px] text-gray-500">
              Unassigned — this player is read-only until assigned a team.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
