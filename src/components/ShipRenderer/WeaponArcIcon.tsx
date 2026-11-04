'use client';

import { WeaponArc } from '@/types/ship';
import { WEAPON_ARC_LABELS } from '@/packages/ships';

type Point = { x: number; y: number };

/** Angle in degrees, 0 = up, increasing clockwise. */
function polarPoint(cx: number, cy: number, r: number, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function sectorPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarPoint(cx, cy, r, startDeg);
  const end = polarPoint(cx, cy, r, endDeg);
  return `M ${cx} ${cy} L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 0 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

/** Clockwise span of each arc, 0 = up. */
const ARC_SPANS: Record<WeaponArc, [number, number]> = {
  bow: [-45, 45],
  starboard: [45, 135],
  stern: [135, 225],
  port: [225, 315],
};

const ARC_ORDER: WeaponArc[] = ['bow', 'starboard', 'stern', 'port'];

/** Display-only firing-arc dial for a weapon card. */
export function WeaponArcDial({ arcs }: { arcs?: WeaponArc[] }) {
  if (!arcs) return null;
  const active = new Set(arcs);
  const label = arcs.length === 0 ? 'No firing arc' : arcs.map(a => WEAPON_ARC_LABELS[a]).join(' · ');
  const separatorPath = [-45, 45, 135, 225]
    .map(deg => {
      const p = polarPoint(12, 12, 10, deg);
      return `M12 12 L${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" aria-label={label}>
      <title>{label}</title>
      <circle cx="12" cy="12" r="10" fill="#111827" stroke="#9ca3af" strokeWidth="1.4" />
      {ARC_ORDER.map(arc => {
        const [start, end] = ARC_SPANS[arc];
        return (
          <path
            key={arc}
            d={sectorPath(12, 12, 10, start, end)}
            fill={active.has(arc) ? '#f8fafc' : 'transparent'}
          />
        );
      })}
      <path d={separatorPath} stroke="#374151" strokeWidth="1" pointerEvents="none" />
    </svg>
  );
}

interface WeaponArcCompassProps {
  active: WeaponArc[];
  /** Active arcs that cannot be switched off (a frame's protected default). */
  locked?: WeaponArc[];
  onToggle: (arc: WeaponArc) => void;
}

/**
 * Circular firing-arc picker. Click a sector to toggle that arc on or off.
 */
export function WeaponArcCompass({ active, locked = [], onToggle }: WeaponArcCompassProps) {
  const activeSet = new Set(active);
  const lockedSet = new Set(locked);

  const fillClass = (arc: WeaponArc) => {
    const isActive = activeSet.has(arc);
    if (isActive && lockedSet.has(arc)) return 'fill-gray-200 opacity-50 cursor-not-allowed';
    return isActive
      ? 'fill-gray-200 hover:fill-red-200 cursor-pointer'
      : 'fill-gray-700 hover:fill-gray-600 cursor-pointer';
  };

  const textClass = (arc: WeaponArc) => {
    if (activeSet.has(arc)) return lockedSet.has(arc) ? 'fill-gray-700' : 'fill-gray-900';
    return 'fill-gray-200';
  };

  const separatorPath = [-45, 45, 135, 225]
    .map(deg => {
      const p = polarPoint(50, 50, 46, deg);
      return `M50 50 L${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
    })
    .join(' ');

  return (
    <div className="relative mx-auto my-1 h-40 w-40">
      <svg viewBox="0 0 100 100" className="h-full w-full" role="group" aria-label="Firing arc directions">
        <circle cx="50" cy="50" r="46" fill="#111827" stroke="#6b7280" strokeWidth="1.5" />
        {ARC_ORDER.map(arc => {
          const [start, end] = ARC_SPANS[arc];
          const isActive = activeSet.has(arc);
          const isLocked = isActive && lockedSet.has(arc);
          const label = `${WEAPON_ARC_LABELS[arc]}${isActive ? ' (on)' : ' (off)'}${isLocked ? ' — locked default' : ''}`;
          return (
            <path
              key={arc}
              d={sectorPath(50, 50, 46, start, end)}
              role="button"
              tabIndex={isLocked ? -1 : 0}
              aria-label={label}
              aria-pressed={isActive}
              aria-disabled={isLocked}
              onClick={() => {
                if (!isLocked) onToggle(arc);
              }}
              onKeyDown={event => {
                if (!isLocked && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onToggle(arc);
                }
              }}
              className={`${fillClass(arc)} focus:outline-none focus-visible:stroke-yellow-300 focus-visible:stroke-2`}
            >
              <title>{label}</title>
            </path>
          );
        })}
        <path d={separatorPath} stroke="#4b5563" strokeWidth="1" pointerEvents="none" />
        <text x="50" y="27" textAnchor="middle" fontSize="7.5" className={textClass('bow')} pointerEvents="none">
          ↑ Bow
        </text>
        <text x="50" y="79" textAnchor="middle" fontSize="7.5" className={textClass('stern')} pointerEvents="none">
          ↓ Stern
        </text>
        <text x="14" y="53" textAnchor="start" fontSize="7" className={textClass('port')} pointerEvents="none">
          ← Port
        </text>
        <text x="86" y="53" textAnchor="end" fontSize="7" className={textClass('starboard')} pointerEvents="none">
          Starboard →
        </text>
      </svg>
    </div>
  );
}
