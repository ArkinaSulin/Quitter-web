// src/components/TokenRenderer/TeamChip.tsx
'use client';

import { TEAM_COLORS, TEAM_SHAPES, Team, getDotColor } from './tokenUtils';

export function TeamShape({ shape, color, size = 10 }: { shape: string; color: string; size?: number }) {
  const common = { fill: color } as const;
  switch (shape) {
    case 'circle':
      return <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" {...common} /></svg>;
    case 'triangle':
      return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M12 2 L22 20 H2 Z" {...common} /></svg>;
    case 'star':
      return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M12 2 L14.5 9 H22 L16 13.5 L18.5 21 L12 16.5 L5.5 21 L8 13.5 L2 9 H9.5 Z" {...common} /></svg>;
    case 'square':
      return <svg width={size} height={size} viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" {...common} /></svg>;
    case 'diamond':
      return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M12 2 L22 12 L12 22 L2 12 Z" {...common} /></svg>;
    case 'cross':
      return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M9 2 H15 V9 H22 V15 H15 V22 H9 V15 H2 V9 H9 Z" {...common} /></svg>;
    default:
      return null;
  }
}

/** A colored chip showing the team's color background + shape glyph (like the hero token). */
export function TeamChip({
  team,
  selected = false,
  onClick,
}: {
  team: Team;
  selected?: boolean;
  onClick?: (team: Team) => void;
}) {
  const bg = TEAM_COLORS[team];
  const fg = getDotColor(team);
  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(team) : undefined}
      title={team}
      className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-colors ${
        onClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
      } ${selected ? 'ring-2 ring-white' : ''}`}
      style={{ backgroundColor: bg, borderColor: selected ? '#fff' : 'rgba(255,255,255,0.25)' }}
    >
      <TeamShape shape={TEAM_SHAPES[team]} color={fg} size={12} />
    </button>
  );
}
