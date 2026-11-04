// src/components/ScenarioMap/ShipSelector.tsx
'use client';

import React, { useState } from 'react';
import { ShipLibraryEntry, useShipTemplates } from '@/hooks/useShipTemplates';
import { ShipTemplateTooltip } from './ShipTemplateTooltip';

export function SailingShipIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M4 18h16l-2 3H6l-2-3z" />
      <path d="M12 3v15" />
      <path d="M12 4 6 11h6V4z" />
      <path d="M12 4l5 6h-5V4z" />
      <path d="M12 10l6 5h-6v-5z" />
    </svg>
  );
}

interface ShipSelectorProps {
  canViewLibrary: boolean;
  onShipDragStart: (entry: ShipLibraryEntry) => void;
}

export function ShipSelector({ canViewLibrary, onShipDragStart }: ShipSelectorProps) {
  const { ships, loading, error } = useShipTemplates();
  const [searchTerm, setSearchTerm] = useState('');
  const [hoveredShip, setHoveredShip] = useState<ShipLibraryEntry | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const search = searchTerm.toLowerCase();
  const filtered = ships.filter(entry =>
    entry.template.name.toLowerCase().includes(search) ||
    (entry.template.role || '').toLowerCase().includes(search)
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        Loading ships...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-400 text-sm p-4">
        {error}
      </div>
    );
  }

  if (!canViewLibrary) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm p-4 text-center">
        Ship library requires shipyard access.
      </div>
    );
  }

  if (ships.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm p-4 text-center">
        No ships found. Create them in Archfar's Shipyard.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1.5 flex-shrink-0">
        <input
          type="text"
          placeholder="Search ships..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {filtered.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-4">No ships match</div>
        ) : (
          filtered.map(entry => (
            <div
              key={entry.template.id}
              onMouseDown={(e) => { if (e.button === 0) onShipDragStart(entry); }}
              onMouseEnter={(e) => {
                setHoveredShip(entry);
                setTooltipPos({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => {
                if (hoveredShip?.template.id === entry.template.id) {
                  setTooltipPos({ x: e.clientX, y: e.clientY });
                }
              }}
              onMouseLeave={() => {
                setHoveredShip(null);
                setTooltipPos(null);
              }}
              className="bg-gray-700 hover:bg-gray-600 rounded p-2 cursor-grab active:cursor-grabbing transition select-none border border-gray-600"
            >
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 flex items-center justify-center rounded bg-gray-800 border border-gray-600 flex-shrink-0">
                  {entry.template.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.template.imageUrl}
                      alt=""
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-gray-400">
                      <SailingShipIcon size={20} />
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {entry.template.name}
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-2">
                    <span className="truncate">{entry.template.role || 'No role'}</span>
                    <span>•</span>
                    <span>{entry.template.totalMass}t</span>
                    <span>•</span>
                    <span>{(entry.stats?.buildCost ?? 0).toLocaleString()}gp</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {hoveredShip && tooltipPos && (
        <ShipTemplateTooltip entry={hoveredShip} x={tooltipPos.x} y={tooltipPos.y} />
      )}
    </div>
  );
}
