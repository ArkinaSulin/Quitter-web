'use client';
// src/components/EffectEditor/EffectHexPreview.tsx
// A 7-hex preview (centre + 6 neighbours) with the effect artwork drawn over the
// centre hex at the same relative size the map uses: image height = 1.2 hex-radii
// × imageScale%. Lets the author size the image against real hexes.
import React from 'react';

// Axial geometry (kept local so the editor doesn't pull in map/combat modules).
const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];
const hexToPixel = (q: number, r: number, size: number) => ({
  x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
  y: size * 1.5 * r,
});

interface EffectHexPreviewProps {
  imageUrl: string;
  imageScale: number;
  color: string;
  layer: 'above' | 'below';
  /** Skip the centre-hex tint (only the artwork shows). */
  transparentBackground?: boolean;
}

export function EffectHexPreview({ imageUrl, imageScale, color, layer, transparentBackground = false }: EffectHexPreviewProps) {
  const S = 28; // preview hex radius (px)
  const dirs = [{ q: 0, r: 0 }, ...HEX_DIRS];
  const pts = dirs.map(d => hexToPixel(d.q, d.r, S));
  const pad = 4;
  const minX = Math.min(...pts.map(p => p.x)) - S * Math.cos(Math.PI / 6);
  const maxX = Math.max(...pts.map(p => p.x)) + S * Math.cos(Math.PI / 6);
  const minY = Math.min(...pts.map(p => p.y)) - S;
  const maxY = Math.max(...pts.map(p => p.y)) + S;
  const W = Math.round(maxX - minX + pad * 2);
  const H = Math.round(maxY - minY + pad * 2);
  const toX = (x: number) => x - minX + pad;
  const toY = (y: number) => y - minY + pad;

  const hexPoints = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = ((60 * i - 30) * Math.PI) / 180;
      return `${cx + S * Math.cos(a)},${cy + S * Math.sin(a)}`;
    }).join(' ');

  const centre = { x: toX(0), y: toY(0) };
  const imgH = 1.2 * S * (Math.max(1, imageScale) / 100);
  const tint = transparentBackground
    ? 'rgba(255,255,255,0.03)'
    : (/^#[0-9a-fA-F]{6}$/.test(color) ? `${color}40` : 'rgba(255,255,255,0.08)');

  return (
    <div className="relative rounded border border-gray-700 bg-gray-900" style={{ width: W, height: H }}>
      <svg width={W} height={H} className="absolute inset-0 block">
        {pts.map((p, i) => (
          <polygon
            key={i}
            points={hexPoints(toX(p.x), toY(p.y))}
            fill={i === 0 ? tint : 'rgba(255,255,255,0.03)'}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1}
          />
        ))}
      </svg>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="absolute pointer-events-none"
          style={{ left: centre.x, top: centre.y, height: imgH, width: 'auto', transform: 'translate(-50%,-50%)', opacity: 0.95 }}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-[10px] text-gray-500">no image</span>
      )}
      <span className="absolute bottom-0.5 right-1 text-[9px] text-gray-500">
        {imageScale}% · {layer === 'above' ? 'above' : 'below'}
      </span>
    </div>
  );
}
