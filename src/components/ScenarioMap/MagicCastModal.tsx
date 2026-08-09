// src/components/ScenarioMap/MagicCastModal.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SizeCategory, Formation } from '@/types/gameProtocol';
import { drawSpellCastToken, computeSpellCastLayout } from '@/components/TokenRenderer/drawToken';
import { MagicCastState, MagicCircle } from '@/hooks/useMagicCast';
import { SaveStat, SAVE_STATS } from '@/lib/weaponParser';

export const MAGIC_CANVAS_WIDTH = 400;
export const MAGIC_CANVAS_HEIGHT = 300;
/** Fraction of canvas width that equals one hex radius (tokenWidth/1.6). */
export const HEX_RADIUS_FRACTION = 1 / 1.6;
/**
 * Visual scale-down for the on-screen spell radius. Troops inside a token are
 * packed tighter than a real 50ft frontage, so a full-radius circle over-covers.
 * 0.75 = draw (and count) at 75% of the nominal feet-based radius.
 */
export const SPELL_RADIUS_SCALE = 0.70;

interface MagicCastModalProps {
  cast: MagicCastState;
  playerId: string;
  isGM: boolean;
  sizeCategories?: SizeCategory[];
  formationsMap?: Record<string, Formation>;
  onCancel: () => void;
  onPlaceCircle: (circle: MagicCircle, affectedCount: number) => void;
  onOverrideCount: (n: number) => void;
  onSetSave: (patch: { saveStat?: SaveStat; saveDC?: number; halfOnSave?: boolean }) => void;
  onRequestResolve: () => void;
}

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash >>> 0;
}

function Stepper({ value, onChange, disabled, min = 0, max = 999 }: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const repeatRef = useRef<{ delay: ReturnType<typeof setTimeout> | null; interval: ReturnType<typeof setInterval> | null }>({ delay: null, interval: null });

  const stopRepeat = useCallback(() => {
    if (repeatRef.current.delay !== null) { clearTimeout(repeatRef.current.delay); repeatRef.current.delay = null; }
    if (repeatRef.current.interval !== null) { clearInterval(repeatRef.current.interval); repeatRef.current.interval = null; }
  }, []);

  useEffect(() => () => stopRepeat(), [stopRepeat]);

  // Keep the draft in sync with the external (synced) value while not editing.
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const step = useCallback((delta: number) => {
    const current = valueRef.current;
    const next = Math.min(max, Math.max(min, current + delta));
    if (next !== current) onChange(next);
  }, [min, max, onChange]);

  const startRepeat = useCallback((e: React.PointerEvent, delta: number) => {
    if (disabled) return;
    e.preventDefault();
    stopRepeat();
    step(delta);
    repeatRef.current.delay = setTimeout(() => {
      repeatRef.current.interval = setInterval(() => step(delta), 90);
    }, 250);
  }, [disabled, stopRepeat, step]);

  const commitDraft = useCallback(() => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(valueRef.current));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== valueRef.current) onChange(clamped);
  }, [draft, min, max, onChange]);

  return (
    <span className={`inline-flex items-center gap-1 ${disabled ? 'opacity-50' : ''}`}>
      <button
        type="button"
        disabled={disabled}
        onPointerDown={(e) => startRepeat(e, -1)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm leading-none disabled:cursor-not-allowed select-none"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commitDraft(); }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            if (e.key === 'Escape') setDraft(String(valueRef.current));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-12 text-center text-white font-mono text-sm bg-gray-700 rounded py-1 px-1 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-yellow-400"
      />
      <button
        type="button"
        disabled={disabled}
        onPointerDown={(e) => startRepeat(e, 1)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm leading-none disabled:cursor-not-allowed select-none"
      >
        +
      </button>
    </span>
  );
}

export function MagicCastModal({
  cast,
  playerId,
  isGM,
  sizeCategories,
  formationsMap,
  onCancel,
  onPlaceCircle,
  onOverrideCount,
  onSetSave,
  onRequestResolve,
}: MagicCastModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const w = Math.min(500, window.innerWidth - 40);
    const h = Math.min(560, window.innerHeight - 40);
    return { x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 2) };
  });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [hover, setHover] = useState<MagicCircle | null>(null);

  const isCaster = playerId === cast.casterId;
  const canEdit = isCaster || isGM;
  const canPlace = isCaster && !cast.resolved;
  const radiusFraction = (cast.weapon.magicRadius || 0) / 25 * HEX_RADIUS_FRACTION * SPELL_RADIUS_SCALE;

  const seed = hashString(cast.id);

  // Re-draw the token + circle whenever relevant state changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, MAGIC_CANVAS_WIDTH, MAGIC_CANVAS_HEIGHT);
    drawSpellCastToken({
      snapshot: cast.snapshot,
      ctx,
      x: MAGIC_CANVAS_WIDTH / 2,
      y: MAGIC_CANVAS_HEIGHT / 2,
      width: MAGIC_CANVAS_WIDTH,
      height: MAGIC_CANVAS_HEIGHT,
      seed,
      sizeCategories,
      formationsMap,
    });

    // Spell radius circle — locked placement or the caster's live cursor preview.
    const circle = cast.circle || (canPlace ? hover : null);
    if (circle) {
      const px = circle.cx * MAGIC_CANVAS_WIDTH;
      const py = circle.cy * MAGIC_CANVAS_HEIGHT;
      const pr = circle.r * MAGIC_CANVAS_WIDTH;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
      ctx.fill();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }, [cast, hover, canPlace, seed, sizeCategories, formationsMap]);

  const countCovered = useCallback((cxPx: number, cyPx: number): number => {
    const { positions, dotRadius } = computeSpellCastLayout(cast.snapshot, MAGIC_CANVAS_WIDTH, MAGIC_CANVAS_HEIGHT, seed, sizeCategories, formationsMap);
    const rPx = radiusFraction * MAGIC_CANVAS_WIDTH;
    let count = 0;
    for (const p of positions) {
      if (p.isDead) continue;
      const dx = p.x - cxPx;
      const dy = p.y - cyPx;
      if (dx * dx + dy * dy <= rPx * rPx) count += 1;
    }
    return count;
  }, [cast.snapshot, seed, radiusFraction, sizeCategories, formationsMap]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canPlace || cast.resolved) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cxPx = (e.clientX - rect.left) * (MAGIC_CANVAS_WIDTH / rect.width);
    const cyPx = (e.clientY - rect.top) * (MAGIC_CANVAS_HEIGHT / rect.height);
    setHover({
      cx: cxPx / MAGIC_CANVAS_WIDTH,
      cy: cyPx / MAGIC_CANVAS_HEIGHT,
      r: radiusFraction,
    });
  }, [canPlace, cast.resolved, radiusFraction]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canPlace || cast.resolved) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cxPx = (e.clientX - rect.left) * (MAGIC_CANVAS_WIDTH / rect.width);
    const cyPx = (e.clientY - rect.top) * (MAGIC_CANVAS_HEIGHT / rect.height);
    const circle: MagicCircle = {
      cx: cxPx / MAGIC_CANVAS_WIDTH,
      cy: cyPx / MAGIC_CANVAS_HEIGHT,
      r: radiusFraction,
    };
    onPlaceCircle(circle, countCovered(cxPx, cyPx));
  }, [canPlace, cast.resolved, radiusFraction, countCovered, onPlaceCircle]);

  const handleCanvasLeave = useCallback(() => {
    setHover(null);
  }, []);

  // Window drag (local per client).
  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({ x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const okDisabled = !canEdit || cast.resolved || !cast.circle || cast.affectedCount <= 0;
  const savedCount = cast.result?.savedCount ?? 0;
  const failedCount = cast.result?.failedCount ?? 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
      <div
        className="absolute bg-gray-900 border border-yellow-600/60 rounded-xl shadow-2xl w-[500px] max-w-[92vw] pointer-events-auto select-none"
        style={{ left: pos.x, top: pos.y }}
      >
        {/* Title bar (draggable — position is local to each client) */}
        <div
          className="px-4 py-2 border-b border-gray-700 flex items-center justify-between cursor-move"
          onMouseDown={startDrag}
        >
          <div className="text-white text-sm font-semibold truncate">
            {cast.weapon.name} on {cast.targetUnitName || 'target'}
          </div>
          <div className="text-xs text-yellow-400 whitespace-nowrap ml-3">
            radius {cast.weapon.magicRadius}ft
          </div>
        </div>

        {/* Token + circle canvas */}
        <div className="p-4">
          <canvas
            ref={canvasRef}
            width={MAGIC_CANVAS_WIDTH}
            height={MAGIC_CANVAS_HEIGHT}
            className="w-full h-auto rounded bg-black/40 cursor-crosshair"
            onMouseMove={handleCanvasMouseMove}
            onClick={handleCanvasClick}
            onMouseLeave={handleCanvasLeave}
          />
        </div>

        {/* Affected count stepper */}
        <div className="px-4 pb-3 flex flex-col items-center gap-1">
          <div className="text-xs text-gray-400">Troops affected</div>
          <Stepper
            value={cast.affectedCount}
            onChange={(n) => onOverrideCount(n)}
            disabled={!canEdit || cast.resolved}
            min={0}
            max={cast.snapshot.maxTroopCount}
          />
        </div>

        {/* Save inputs (hidden for healing — healing isn't resisted) */}
        {cast.weapon.isHealing ? (
          <div className="px-4 pb-4 border-t border-gray-700 pt-3">
            <div className="text-xs text-emerald-300">Healing spell — restores HP to each affected troop, no save.</div>
          </div>
        ) : (
        <div className="px-4 pb-4 space-y-2 border-t border-gray-700 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Saving throw stat</span>
            <div className="flex gap-1">
              {SAVE_STATS.map(stat => {
                const active = cast.saveStat === stat;
                return (
                  <button
                    key={stat}
                    disabled={!canEdit || cast.resolved}
                    onClick={() => onSetSave({ saveStat: stat })}
                    title={`${stat} +${cast.targetStats[stat.toLowerCase() as keyof typeof cast.targetStats]}`}
                    className={`px-2 py-1 rounded text-xs font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed ${
                      active ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {stat}
                    <span className="ml-1 text-[10px] font-normal opacity-80">
                      {cast.targetStats[stat.toLowerCase() as keyof typeof cast.targetStats] >= 0 ? '+' : ''}
                      {cast.targetStats[stat.toLowerCase() as keyof typeof cast.targetStats]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Save DC</span>
            <Stepper
              value={cast.saveDC}
              onChange={(v) => onSetSave({ saveDC: v })}
              disabled={!canEdit || cast.resolved}
              min={0}
              max={50}
            />
          </div>
          <label className={`flex items-center gap-2 text-xs ${canEdit && !cast.resolved ? 'cursor-pointer' : 'opacity-70'}`}>
            <input
              type="checkbox"
              checked={cast.halfOnSave}
              disabled={!canEdit || cast.resolved}
              onChange={(e) => onSetSave({ halfOnSave: e.target.checked })}
              className="accent-yellow-400"
            />
            <span className="text-gray-300">
              {cast.halfOnSave ? '1/2 damage' : 'Negate'} on successful save
            </span>
          </label>
        </div>
        )}

        {/* Resolve result */}
        {cast.resolved && cast.result && (
          <div className="px-4 pb-3 border-t border-gray-700 pt-3">
            <div className="text-xs text-gray-400 space-y-0.5">
              <div>Base damage: <span className="text-white font-mono">{cast.result.baseDamage}</span></div>
              <div>Saved / failed: <span className="text-white font-mono">{savedCount} / {failedCount}</span></div>
              <div>Total damage: <span className="text-red-400 font-semibold">{cast.result.totalDamage}</span></div>
              <div>Troops killed: <span className="text-white font-mono">{cast.result.troopsKilled}</span></div>
              <div className="text-gray-500">{cast.result.description}</div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="px-4 pb-4 flex items-center justify-between gap-2 border-t border-gray-700 pt-3">
          <button
            onClick={onRequestResolve}
            disabled={okDisabled}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-sm"
          >
            {cast.resolved ? 'Resolved' : 'OK'}
          </button>
          {!cast.resolved && canEdit && (
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
            >
              Cancel
            </button>
          )}
          {cast.resolved && (
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
