'use client';

import React, { useState, useEffect, useRef } from 'react';
import { PanelsContainer } from './PanelsContainer';
import { PanelSection } from './PanelSection';
import { UnitSelector } from './UnitSelector';
import { MessagesPanel } from './MessagesPanel';
import { AlliancePanel } from './AlliancePanel';
import { MapEditorPanel } from './MapEditorPanel';
import { PlayerPanel } from './PlayerPanel';
import { UnitTemplate, AllianceGroup, Participant, ScenarioRole } from '@/types/gameProtocol';

interface LeftPanelProps {
  scenarioId: string;
  playerId: string;
  onUnitDragStart: (template: UnitTemplate) => void;
  isGM: boolean;
  alliances: Record<string, AllianceGroup>;
  onMoveTeam: (team: string, targetGroup: AllianceGroup) => void;
  participants: Participant[];
  roomOpen: boolean;
  onSetRoomOpen: (open: boolean) => void;
  onSetParticipantTeam: (participantId: string, team: string | null) => void;
  onSetParticipantRole: (participantId: string, role: ScenarioRole) => void;
  onKickParticipant: (participantId: string) => void;
  backgroundConfig: { imageUrl: string; offsetX: number; offsetY: number; scale: number; gridRadius: number } | null;
  onSaveBackground: (config: { imageUrl: string; offsetX: number; offsetY: number; scale: number; gridRadius: number }) => void;
  onPreviewMapConfig: (config: Partial<{ imageUrl: string; offsetX: number; offsetY: number; scale: number; gridRadius: number }>) => void;
  side: 'left' | 'right';
  onToggleSide: () => void;
}

export function LeftPanel({ scenarioId, playerId, onUnitDragStart, isGM, alliances, onMoveTeam, participants, roomOpen, onSetRoomOpen, onSetParticipantTeam, onSetParticipantRole, onKickParticipant, backgroundConfig, onSaveBackground, onPreviewMapConfig, side, onToggleSide }: LeftPanelProps) {
  // Persist which tabs are open per scenario + user, so a rejoined session
  // restores the same panel layout.
  // Persist which tabs are open per scenario + user. The saved layout is restored
  // once the player id is known (auth settles after first render) — restoring at
  // mount with an empty id would read nothing and then overwrite the saved layout
  // under the real key. Persistence happens only on an explicit tab toggle.
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const userTouched = useRef(false);
  const savedStateRef = useRef<{ key: string; saved: Record<string, boolean> }>({ key: '', saved: {} });

  const togglePanel = (id: string) => {
    userTouched.current = true;
    setOpenPanels(prev => {
      const next = { ...prev, [id]: !prev[id] };
      if (playerId) {
        try {
          window.localStorage.setItem(`leftPanelOpen:${scenarioId}:${playerId}`, JSON.stringify(next));
        } catch {
          // ignore storage failures
        }
      }
      return next;
    });
  };

  const iconClasses = 'text-gray-400';

  interface PanelDef {
    id: string;
    label: string;
    icon: React.ReactNode;
    requiresGM: boolean;
    content: React.ReactNode;
  }

  const panels: PanelDef[] = [
    {
      id: 'map-editor',
      label: 'Map',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClasses}>
          <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
          <path d="M8 2v16" />
          <path d="M16 6v16" />
        </svg>
      ),
      requiresGM: true,
      content: <MapEditorPanel currentConfig={backgroundConfig} onSave={onSaveBackground} onPreviewChange={onPreviewMapConfig} />,
    },
    {
      id: 'players',
      label: 'Players',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClasses}>
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
      requiresGM: true,
      content: (
        <PlayerPanel
          participants={participants}
          roomOpen={roomOpen}
          onSetRoomOpen={onSetRoomOpen}
          onSetParticipantTeam={onSetParticipantTeam}
          onSetParticipantRole={onSetParticipantRole}
          onKickParticipant={onKickParticipant}
        />
      ),
    },
    {
      id: 'alliances',
      label: 'Alliances',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClasses}>
          <path d="m11 17 2 2a1 1 0 1 0 3-3" />
          <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
          <path d="m21 3 1 11h-2" />
          <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
          <path d="M3 4h8" />
        </svg>
      ),
      requiresGM: true,
      content: <AlliancePanel alliances={alliances} onMoveTeam={onMoveTeam} />,
    },
    {
      id: 'unit-selector',
      label: 'Unit Selector',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClasses}>
          <path d="M19 5 9 15" />
          <path d="M5 19 15 9" />
          <path d="M3 21l3-3" />
          <path d="M21 3l-3 3" />
        </svg>
      ),
      requiresGM: true,
      content: <UnitSelector scenarioId={scenarioId} onUnitDragStart={onUnitDragStart} />,
    },
    {
      id: 'messages',
      label: 'Messages',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClasses}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      requiresGM: false,
      content: <MessagesPanel />,
    },
  ];

  const visiblePanels = panels.filter(p => !p.requiresGM || isGM);

  // Restore the saved layout once the player id is known, re-merging whenever the
  // role resolves (isGM unlocks the GM tabs). The saved state is only ADDED to the
  // current open set — it never closes a tab the user opened.
  useEffect(() => {
    if (userTouched.current) return;
    if (!playerId) return;
    const key = `leftPanelOpen:${scenarioId}:${playerId}`;
    if (savedStateRef.current.key !== key) {
      let saved: Record<string, boolean> = {};
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) saved = JSON.parse(raw);
      } catch {
        // ignore malformed storage
      }
      savedStateRef.current = { key, saved };
    }
    const saved = savedStateRef.current.saved;
    setOpenPanels(prev => {
      if (Object.keys(saved).length > 0) {
        let changed = false;
        const next = { ...prev };
        for (const p of visiblePanels) {
          if (saved[p.id] && !next[p.id]) {
            next[p.id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      }
      const first = visiblePanels[0]?.id;
      if (first && !prev[first]) {
        return { ...prev, [first]: true };
      }
      return prev;
    });
  }, [isGM, visiblePanels, playerId, scenarioId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PanelsContainer
      defaultWidth={400}
      defaultHeight={typeof window !== 'undefined' ? Math.max(300, window.innerHeight - 100) : 500}
      side={side}
      onToggleSide={onToggleSide}
      tabs={visiblePanels.map(p => ({
        id: p.id,
        label: p.label,
        icon: p.icon,
        active: !!openPanels[p.id],
        onToggle: () => togglePanel(p.id),
      }))}
    >
      {visiblePanels.filter(p => openPanels[p.id]).map(p => (
        <PanelSection key={p.id}>{p.content}</PanelSection>
      ))}
    </PanelsContainer>
  );
}
