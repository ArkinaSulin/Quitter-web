'use client';

// Non-modal draggable panel (portal + fixed + viewport clamp). The page stays
// interactive underneath — used by the ship window and PC cast/action panels.
// Optional bottom-right resize handle with a persisted size.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DraggablePanelProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  initial?: { x: number; y: number };
  z?: number;
  /** Show a bottom-right resize handle. */
  resizable?: boolean;
  /** localStorage key for the resized dimensions. */
  persistKey?: string;
  minWidth?: number;
  minHeight?: number;
}

export function DraggablePanel({
  title,
  subtitle,
  onClose,
  children,
  className = 'w-[520px]',
  initial,
  z = 120,
  resizable = false,
  persistKey,
  minWidth = 420,
  minHeight = 320,
}: DraggablePanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const clampPos = useCallback((p: { x: number; y: number }) => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 520;
    const h = el?.offsetHeight ?? 400;
    const maxX = Math.max(8, window.innerWidth - w - 8);
    const maxY = Math.max(8, window.innerHeight - h - 8);
    return { x: Math.max(8, Math.min(maxX, p.x)), y: Math.max(8, Math.min(maxY, p.y)) };
  }, []);

  useEffect(() => {
    if (pos !== null) return;
    const start = initial ?? { x: window.innerWidth - 560, y: 72 };
    setPos(clampPos(start));
  }, [pos, initial, clampPos]);

  useEffect(() => {
    if (!resizable || size !== null) return;
    let stored: { w: number; h: number } | null = null;
    if (persistKey) {
      try {
        const raw = window.localStorage.getItem(persistKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { w?: number; h?: number };
          if (Number.isFinite(parsed.w) && Number.isFinite(parsed.h)) {
            stored = { w: Math.max(minWidth, Number(parsed.w)), h: Math.max(minHeight, Number(parsed.h)) };
          }
        }
      } catch {
        stored = null;
      }
    }
    setSize(stored ?? { w: minWidth, h: minHeight });
  }, [resizable, persistKey, minWidth, minHeight, size]);

  useLayoutEffect(() => {
    if (pos === null) return;
    setPos(p => (p ? clampPos(p) : p));
    const onResize = () => setPos(p => (p ? clampPos(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampPos, size]);

  const startDrag = (e: React.MouseEvent) => {
    if (!pos) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos(clampPos({ x: ev.clientX - d.dx, y: ev.clientY - d.dy }));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startResize = (e: React.MouseEvent) => {
    if (!pos || !size) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    const move = (ev: MouseEvent) => {
      const maxW = Math.max(minWidth, window.innerWidth - pos.x - 8);
      const maxH = Math.max(minHeight, window.innerHeight - pos.y - 8);
      setSize({
        w: Math.max(minWidth, Math.min(maxW, start.w + ev.clientX - start.x)),
        h: Math.max(minHeight, Math.min(maxH, start.h + ev.clientY - start.y)),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setSize(current => {
        if (current && persistKey) {
          try { window.localStorage.setItem(persistKey, JSON.stringify(current)); } catch { /* ignore */ }
        }
        return current;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (typeof document === 'undefined' || pos === null) return null;

  const effectiveSize = resizable ? (size ?? { w: minWidth, h: minHeight }) : null;

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed ${resizable ? 'max-w-[96vw]' : `${className} max-h-[82vh]`} overflow-hidden rounded-xl border border-gray-600 bg-gray-900 shadow-2xl text-gray-200 pointer-events-auto flex flex-col`}
      style={{
        left: pos.x,
        top: pos.y,
        zIndex: z,
        ...(effectiveSize ? { width: effectiveSize.w, height: effectiveSize.h, maxHeight: 'none' } : {}),
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div
        className="flex shrink-0 cursor-move items-center justify-between gap-3 border-b border-gray-700 bg-gray-900/95 px-3 py-2 select-none"
        onMouseDown={startDrag}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-amber-300">{title}</div>
          {subtitle && <div className="truncate text-[11px] text-gray-400">{subtitle}</div>}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            onMouseDown={e => e.stopPropagation()}
            className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800"
          >
            Close
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {resizable && (
        <div
          onMouseDown={startResize}
          title="Resize"
          className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
        >
          <div className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-amber-400/80" />
        </div>
      )}
    </div>,
    document.body,
  );
}
