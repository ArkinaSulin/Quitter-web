// src/hooks/useParticipants.ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Participant, ScenarioRole } from '@/types/gameProtocol';

const ROLE_ORDER: Record<string, number> = { GM: 0, AssistGM: 1, SuperPlayer: 2, Player: 3 };

function mapParticipant(row: any): Participant {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    userId: row.user_id,
    role: row.role || 'Player',
    team: row.team || null,
    joinedAt: row.joined_at,
  };
}

function byRole(a: Participant, b: Participant): number {
  return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.joinedAt.localeCompare(b.joinedAt);
}

/**
 * Live roster for a scenario: participant rows (team/role), the room open/closed
 * state, and kicked-self detection. GM writes (team/role/kick/room) are optimistic
 * upserts gated server-side by RLS.
 */
export function useParticipants(scenarioId: string, currentUserId?: string | null) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [roomOpen, setRoomOpen] = useState(true);
  const [kicked, setKicked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [parts, room] = await Promise.all([
        supabase.from('scenario_participants').select('*').eq('scenario_id', scenarioId),
        supabase.from('scenarios').select('room_open').eq('id', scenarioId).single(),
      ]);
      if (cancelled) return;
      if (parts.error) console.error('[Participants] Load error:', parts.error);
      if (parts.data) setParticipants((parts.data as any[]).map(mapParticipant).sort(byRole));
      if (room.data) setRoomOpen(room.data.room_open ?? true);
    })();

    const participantsChannel = supabase
      .channel(`participants:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scenario_participants', filter: `scenario_id=eq.${scenarioId}` },
        (payload: any) => {
          if (payload.eventType === 'DELETE') {
            setParticipants(prev => prev.filter(p => p.id !== payload.old.id));
            if (currentUserId && payload.old.user_id === currentUserId && !cancelled) {
              setKicked(true);
            }
            return;
          }
          const row = payload.new;
          if (payload.eventType === 'INSERT') {
            setParticipants(prev =>
              prev.some(p => p.id === row.id) ? prev : [...prev, mapParticipant(row)].sort(byRole),
            );
          } else if (payload.eventType === 'UPDATE') {
            setParticipants(prev => prev.map(p => (p.id === row.id ? mapParticipant(row) : p)));
          }
        },
      )
      .subscribe();

    const roomChannel = supabase
      .channel(`room-open:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'scenarios', filter: `id=eq.${scenarioId}` },
        (payload: any) => {
          if (payload.new.room_open !== undefined) setRoomOpen(payload.new.room_open);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(participantsChannel);
      supabase.removeChannel(roomChannel);
    };
  }, [scenarioId, currentUserId]);

  const myParticipant = participants.find(p => p.userId === currentUserId) || null;

  const setParticipantTeam = useCallback(async (participantId: string, team: string | null) => {
    setParticipants(prev => prev.map(p => (p.id === participantId ? { ...p, team } : p)));
    const { error } = await supabase.from('scenario_participants').update({ team }).eq('id', participantId);
    if (error) console.error('[Participants] Team update error:', error);
  }, []);

  const setParticipantRole = useCallback(async (participantId: string, role: ScenarioRole) => {
    setParticipants(prev => prev.map(p => (p.id === participantId ? { ...p, role } : p)));
    const { error } = await supabase.from('scenario_participants').update({ role }).eq('id', participantId);
    if (error) console.error('[Participants] Role update error:', error);
  }, []);

  const kickParticipant = useCallback(async (participantId: string) => {
    const { error } = await supabase.from('scenario_participants').delete().eq('id', participantId);
    if (error) console.error('[Participants] Kick error:', error);
    else setParticipants(prev => prev.filter(p => p.id !== participantId));
  }, []);

  const setRoomOpenState = useCallback(
    async (open: boolean) => {
      setRoomOpen(open);
      const { error } = await supabase.from('scenarios').update({ room_open: open }).eq('id', scenarioId);
      if (error) console.error('[Participants] Room toggle error:', error);
    },
    [scenarioId],
  );

  return {
    participants,
    roomOpen,
    myParticipant,
    kicked,
    setParticipantTeam,
    setParticipantRole,
    kickParticipant,
    setRoomOpen: setRoomOpenState,
  };
}
