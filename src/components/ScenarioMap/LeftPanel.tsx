'use client';

import React, { useState } from 'react';
import { PanelsContainer } from './PanelsContainer';
import { PanelSection } from './PanelSection';
import { UnitSelector } from './UnitSelector';
import { MessagesPanel } from './MessagesPanel';
import { AlliancePanel } from './AlliancePanel';
import { UnitTemplate, AllianceGroup } from '@/types/gameProtocol';

interface LeftPanelProps {
  scenarioId: string;
  onUnitDragStart: (template: UnitTemplate) => void;
  isGM: boolean;
  alliances: Record<string, AllianceGroup>;
  onMoveTeam: (team: string, targetGroup: AllianceGroup) => void;
}

export function LeftPanel({ scenarioId, onUnitDragStart, isGM, alliances, onMoveTeam }: LeftPanelProps) {
  const [panelState, setPanelState] = useState<Record<string, boolean>>({
    alliances: true,
    'unit-selector': true,
    messages: true,
  });

  const togglePanel = (id: string) => {
    setPanelState(prev => ({ ...prev, [id]: !prev[id] }));
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
      id: 'alliances',
      label: 'Alliances',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClasses}>
          <path d="M2 12h3l1.5-2 1.5 2 1.5-2 1.5 2 1.5-2 1.5 2 1.5-2 1.5 2h3" />
          <path d="M5.5 12v4" />
          <path d="M18.5 12v4" />
        </svg>
      ),
      requiresGM: true,
      content: <AlliancePanel alliances={alliances} onMoveTeam={onMoveTeam} />,
    },
    {
      id: 'unit-selector',
      label: 'Unit Selector',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClasses}>
          <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
          <path d="M13.5 16.5L6 9l3-3 7.5 7.5" />
          <path d="M12 12l-3-3" />
          <path d="M16.5 17.5L21 13" />
        </svg>
      ),
      requiresGM: true,
      content: <UnitSelector scenarioId={scenarioId} onUnitDragStart={onUnitDragStart} />,
    },
    {
      id: 'messages',
      label: 'Messages',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClasses}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      requiresGM: false,
      content: <MessagesPanel />,
    },
  ];

  const visiblePanels = panels.filter(p => !p.requiresGM || isGM);
  const allCollapsed = visiblePanels.every(p => !panelState[p.id]);

  return (
    <PanelsContainer defaultWidth={320} defaultHeight={500} allCollapsed={allCollapsed}>
      {visiblePanels.map(panel => (
        <PanelSection
          key={panel.id}
          label={panel.label}
          icon={panel.icon}
          expanded={panelState[panel.id]}
          onToggle={() => togglePanel(panel.id)}
        >
          {panel.content}
        </PanelSection>
      ))}
    </PanelsContainer>
  );
}
