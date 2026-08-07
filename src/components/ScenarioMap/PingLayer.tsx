// src/components/ScenarioMap/PingLayer.tsx
'use client';

import { Ping } from '@/hooks/usePing';
import { hexToPixel } from '@/hooks/useHexGrid';

const DEFAULT_PING_COLOR = '#ffffff';
const RING_SIZES = [60, 90, 120];

export function PingLayer({
  pings,
  zoom,
  offsetX,
  offsetY,
  hexSize,
}: {
  pings: Ping[];
  zoom: number;
  offsetX: number;
  offsetY: number;
  hexSize: number;
}) {
  if (pings.length === 0) return null;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
      {pings.map(ping => {
        const pos = hexToPixel(ping.hex, hexSize);
        const cx = pos.x * zoom + offsetX;
        const cy = pos.y * zoom + offsetY;
        const color = ping.color || DEFAULT_PING_COLOR;
        return (
          <div key={ping.id} className="absolute" style={{ left: cx, top: cy }}>
            {RING_SIZES.map((size, i) => (
              <div
                key={i}
                className="ping-ring"
                style={{ borderColor: color, width: size, height: size, animationDelay: `${i * 0.15}s` }}
              />
            ))}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ width: 8, height: 8, backgroundColor: color }}
            />
            <div
              className="absolute left-0 top-0 -translate-x-1/2 mt-3 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white whitespace-nowrap border"
              style={{ borderColor: color }}
            >
              {ping.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
