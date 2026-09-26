'use client';
// src/components/StructureEditor/StructurePreview.tsx
// Right-panel preview for the Structure Editor. Edge structures draw the segment
// with its battlement (crenellation) square-wave on the OUTSIDE face plus the
// inside/outside MP labels; hex structures draw a 7-hex board with the artwork and
// the entry / door / durability badges. A local Flip swaps which side is shown as
// outside (the real side is chosen per placement).
import React, { useState } from 'react';
import { StructureAnchor } from '@/types/structure';
import { battlementPath, battlementDepth, triangleWavePath } from '@/lib/structureDraw';

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];
const hexToPixel = (q: number, r: number, size: number) => ({
  x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
  y: size * 1.5 * r,
});

interface StructurePreviewProps {
  anchor: StructureAnchor;
  imageUrl: string;
  battlement: boolean;
  spikes: boolean;
  hexBorder: boolean;
  mpFootIn: number | null;
  mpFootOut: number | null;
  mpMountedIn: number | null;
  mpMountedOut: number | null;
  coverMelee: number;
  coverRanged: number;
  doorHp: number | null;
  maxHp: number;
  dt: number;
}

const mpLabel = (v: number | null): string => (v === null ? '—' : v < 0 ? 'block' : `${v}`);

export function StructurePreview({
  anchor, imageUrl, battlement, spikes, hexBorder,
  mpFootIn, mpFootOut, mpMountedIn, mpMountedOut, coverMelee, coverRanged, doorHp, maxHp, dt,
}: StructurePreviewProps) {
  const [flipped, setFlipped] = useState(false);
  const doorText = doorHp === null ? 'no door' : doorHp === 0 ? 'open (no gate)' : `door ${doorHp} HP`;

  if (anchor === 'hex') {
    const S = 28;
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
    return (
      <div className="space-y-2">
        <div className="relative rounded border border-gray-700 bg-gray-200" style={{ width: W, height: H }}>
          <svg width={W} height={H} className="absolute inset-0 block">
            {pts.map((p, i) => (
              <polygon
                key={i}
                points={hexPoints(toX(p.x), toY(p.y))}
                fill={i === 0 ? 'none' : 'rgba(0,0,0,0.03)'}
                stroke={i === 0 ? (hexBorder ? 'rgba(0,0,0,0.95)' : 'none') : 'rgba(0,0,0,0.25)'}
                strokeWidth={i === 0 ? 4 : 1}
              />
            ))}
          </svg>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="absolute pointer-events-none"
              style={{ left: centre.x, top: centre.y, height: 1.2 * S, width: 'auto', transform: 'translate(-50%,-50%)', opacity: 0.95 }}
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-[10px] text-gray-500">no image</span>
          )}
        </div>
        <p className="text-[11px] text-gray-400">Enter: foot {mpLabel(mpFootIn)} MP · mounted {mpLabel(mpMountedIn)} MP</p>
        <p className="text-[11px] text-gray-400">{doorText}</p>
        <p className="text-[11px] text-gray-500">HP {maxHp} · DT {dt}
          {(coverMelee || coverRanged) ? ` · cover AC m${coverMelee}/r${coverRanged}` : ''}</p>
      </div>
    );
  }

  // Edge preview.
  const W = 240;
  const H = 120;
  const y = H / 2;
  const x0 = 28;
  const x1 = W - 28;
  const outsideUp = !flipped;
  const outDir = { x: 0, y: outsideUp ? -1 : 1 };
  const tooth = battlementDepth(x1 - x0, 8);
  const decoration = spikes
    ? triangleWavePath({ x: x0, y }, { x: x1, y }, outDir, tooth, 8)
    : battlementPath({ x: x0, y }, { x: x1, y }, outDir, tooth, 8);
  // When flipped, the labels swap which physical side is "outside".
  const outFoot = flipped ? mpFootIn : mpFootOut;
  const outMounted = flipped ? mpMountedIn : mpMountedOut;
  const inFoot = flipped ? mpFootOut : mpFootIn;
  const inMounted = flipped ? mpMountedOut : mpMountedIn;
  return (
    <div className="space-y-2">
      <div className="relative rounded border border-gray-700 bg-gray-200" style={{ width: W, height: H }}>
        <svg width={W} height={H} className="absolute inset-0 block">
          <line x1={x0} y1={y} x2={x1} y2={y} stroke="rgba(0,0,0,0.95)" strokeWidth={7} strokeLinecap="round" />
          {(spikes || battlement) &&
            <path d={decoration} fill="none" stroke="rgba(0,0,0,0.95)" strokeWidth={2.5} strokeLinejoin="round" />}
        </svg>
        <span className="absolute left-1 top-0.5 text-[9px] uppercase tracking-wide text-amber-700">Outside</span>
        <span className="absolute left-1 bottom-0.5 text-[9px] uppercase tracking-wide text-sky-700">Inside</span>
        <span className="absolute right-1 top-0.5 text-[9px] text-gray-700">foot {mpLabel(outFoot)} · mtd {mpLabel(outMounted)}</span>
        <span className="absolute right-1 bottom-0.5 text-[9px] text-gray-700">foot {mpLabel(inFoot)} · mtd {mpLabel(inMounted)}</span>
      </div>
      {(battlement || spikes) && (
        <button
          type="button"
          onClick={() => setFlipped(f => !f)}
          className="px-2 py-1 rounded text-[11px] bg-gray-700 hover:bg-gray-600"
          title="Preview which side the battlement/stakes sit on; placement chooses the real side."
        >
          Flip preview
        </button>
      )}
      <p className="text-[11px] text-gray-400">{doorText}</p>
      <p className="text-[11px] text-gray-500">HP {maxHp} · DT {dt}
        {(coverMelee || coverRanged) ? ` · cover AC m${coverMelee}/r${coverRanged}` : ''}</p>
    </div>
  );
}
