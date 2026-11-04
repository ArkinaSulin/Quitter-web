'use client';

// 7-hex dark-space preview for the Ship Editor image section. The ship image
// keeps its natural aspect ratio and is scaled by the authored keel length.
// Positive vertical offset moves the image up from the centre hex.

import { HEX_DIRS } from '@/packages/primitives';
import { shipImageHeightPx, shipImageOffsetPx } from './shipImageScale';

const HEX_RADIUS_PX = 28;

const hexToPixel = (q: number, r: number, size: number) => ({
  x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
  y: size * 1.5 * r,
});

function hexPoints(cx: number, cy: number, size: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    return `${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`;
  }).join(' ');
}

export function ShipImagePreview({
  imageUrl,
  keelLength,
  imageOffsetY,
}: {
  imageUrl: string;
  keelLength: number;
  imageOffsetY: number;
}) {
  const dirs = [{ q: 0, r: 0 }, ...HEX_DIRS];
  const points = dirs.map(d => hexToPixel(d.q, d.r, HEX_RADIUS_PX));
  const pad = 6;
  const minX = Math.min(...points.map(p => p.x)) - HEX_RADIUS_PX * Math.cos(Math.PI / 6);
  const maxX = Math.max(...points.map(p => p.x)) + HEX_RADIUS_PX * Math.cos(Math.PI / 6);
  const minY = Math.min(...points.map(p => p.y)) - HEX_RADIUS_PX;
  const maxY = Math.max(...points.map(p => p.y)) + HEX_RADIUS_PX;
  const width = Math.round(maxX - minX + pad * 2);
  const height = Math.round(maxY - minY + pad * 2);
  const toX = (x: number) => x - minX + pad;
  const toY = (y: number) => y - minY + pad;
  const centre = { x: toX(0), y: toY(0) };
  const imageHeight = shipImageHeightPx(keelLength, HEX_RADIUS_PX);
  const offsetPx = shipImageOffsetPx(imageOffsetY, HEX_RADIUS_PX);

  // Fixed deterministic stars so the field never flickers between renders.
  const stars = Array.from({ length: 26 }, (_, i) => ({
    x: (i * 67 + 13) % width,
    y: (i * 41 + 19) % height,
    r: i % 5 === 0 ? 1.2 : i % 3 === 0 ? 0.9 : 0.6,
    opacity: i % 4 === 0 ? 0.75 : 0.4,
  }));

  return (
    <div className="space-y-1">
      <div
        className="relative overflow-visible rounded-xl border border-gray-700 bg-[#02030a]"
        style={{ width, height }}
      >
        <svg width={width} height={height} className="absolute inset-0 block">
          {stars.map((star, i) => (
            <circle
              key={i}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill="#e2e8f0"
              opacity={star.opacity}
            />
          ))}
          {points.map((point, i) => (
            <polygon
              key={i}
              points={hexPoints(toX(point.x), toY(point.y), HEX_RADIUS_PX)}
              fill={i === 0 ? 'rgba(10, 14, 26, 0.55)' : 'rgba(10, 14, 26, 0.78)'}
              stroke={i === 0 ? 'rgba(250, 204, 21, 0.55)' : 'rgba(148, 163, 184, 0.22)'}
              strokeWidth={i === 0 ? 2 : 1}
            />
          ))}
        </svg>

        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="pointer-events-none absolute max-w-none"
            style={{
              left: centre.x,
              top: centre.y - offsetPx,
              height: imageHeight,
              width: 'auto',
              transform: 'translate(-50%, -50%)',
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.9))',
            }}
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[10px] text-gray-500">
            No ship image
          </span>
        )}
      </div>
      <p className="text-[9px] text-gray-600">7 hexes · 50 ft radius · positive offset moves up</p>
    </div>
  );
}
