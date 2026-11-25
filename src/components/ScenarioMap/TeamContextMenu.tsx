'use client';

// Team-only context menu for a hero boarded on a ship. It mirrors the normal
// scenario-map ContextMenu shell (same surface, rows, Escape/outside close) so
// the right-click feels consistent, but only offers Assign Team.

import { useEffect, useRef } from 'react';
import { TEAMS, type Team } from '@/packages/units';
import { Floating } from './Floating';

export function TeamContextMenu({
  x,
  y,
  title,
  onAssign,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  onAssign: (team: Team) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <Floating
      ref={menuRef}
      x={x}
      y={y}
      z={250}
      interactive
      className="bg-gray-900 border border-gray-700 rounded shadow-xl py-1 min-w-[180px] max-h-[calc(100vh-16px)] overflow-y-auto text-sm text-white"
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400">
        {title}
      </div>
      {TEAMS.map((team: Team) => (
        <div
          key={team}
          className="px-3 py-1 hover:bg-gray-700 cursor-pointer capitalize"
          onClick={() => {
            onAssign(team);
            onClose();
          }}
        >
          {team}
        </div>
      ))}
    </Floating>
  );
}
