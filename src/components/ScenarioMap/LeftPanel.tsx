// src/components/ScenarioMap/LeftPanel.tsx
'use client';

import React, { useState } from 'react';
import { UnitSelector } from './UnitSelector';
import { MessagesPanel } from './MessagesPanel';
import { UnitTemplate } from '@/types/gameProtocol';

interface LeftPanelProps {
  scenarioId: string;
  onPlaceUnit: (template: UnitTemplate, hex: { q: number; r: number; s: number }) => void;
}

export function LeftPanel({ scenarioId, onPlaceUnit }: LeftPanelProps) {
  const [unitSelectorExpanded, setUnitSelectorExpanded] = useState(true);
  const [messagesExpanded, setMessagesExpanded] = useState(true);

  const handleDragStart = (template: UnitTemplate) => {
    window.dispatchEvent(new CustomEvent('unitDragStart', { detail: { template } }));
  };

  const isCollapsed = !unitSelectorExpanded && !messagesExpanded;

  return (
    <div
      className={`bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-2xl transition-all duration-200 overflow-hidden select-none ${
        isCollapsed ? 'w-12' : 'w-80'
      }`}
    >
      <div className="flex flex-col max-h-[calc(100vh-80px)]">
        {/* Unit Selector Section */}
        <div
          className={`flex flex-col min-h-0 border-b border-gray-700 ${
            unitSelectorExpanded ? 'flex-1' : 'flex-none'
          }`}
        >
          <div
            className="flex items-center justify-between px-3 py-2 bg-gray-800 cursor-pointer hover:bg-gray-700 select-none"
            onClick={() => setUnitSelectorExpanded(!unitSelectorExpanded)}
          >
            <span className="text-sm font-medium text-white">
              {unitSelectorExpanded ? '▼' : '▶'} Unit Selector
            </span>
            {isCollapsed && <span className="text-xs text-gray-400">📋</span>}
          </div>
          {unitSelectorExpanded && (
            <div className="flex-1 overflow-hidden">
              <UnitSelector scenarioId={scenarioId} onDragStart={handleDragStart} />
            </div>
          )}
        </div>

        {/* Messages Section */}
        <div
          className={`flex flex-col min-h-0 ${
            messagesExpanded ? 'flex-1' : 'flex-none'
          }`}
        >
          <div
            className="flex items-center justify-between px-3 py-2 bg-gray-800 cursor-pointer hover:bg-gray-700 select-none"
            onClick={() => setMessagesExpanded(!messagesExpanded)}
          >
            <span className="text-sm font-medium text-white">
              {messagesExpanded ? '▼' : '▶'} Messages
            </span>
            {isCollapsed && <span className="text-xs text-gray-400">💬</span>}
          </div>
          {messagesExpanded && (
            <div className="flex-1 overflow-hidden">
              <MessagesPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}