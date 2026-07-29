'use client';

import React from 'react';

interface PanelSectionProps {
  label: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function PanelSection({ label, icon, expanded, onToggle, children }: PanelSectionProps) {
  return (
    <div className={`flex flex-col min-h-0 ${expanded ? 'flex-1' : 'flex-none'}`}>
      {expanded ? (
        <>
          <div
            className="flex items-center justify-between px-3 py-2 bg-gray-800 cursor-pointer hover:bg-gray-700 select-none flex-shrink-0 border-b border-gray-700"
            onClick={onToggle}
          >
            <span className="text-sm font-medium text-white">▼ {label}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {children}
          </div>
        </>
      ) : (
        <button
          onClick={onToggle}
          className="w-10 h-10 bg-gray-800 hover:bg-gray-700 text-center text-xs text-gray-400 hover:text-white transition-colors flex items-center justify-center border-b border-gray-700"
          title={label}
        >
          {icon}
        </button>
      )}
    </div>
  );
}
