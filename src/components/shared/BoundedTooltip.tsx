'use client';

// Viewport-fixed tooltip constrained to a bounds element (the ship layout or
// roster). Prefers below-right of the pointer, flips left then above, and never
// spills outside the region. Natural size is preserved (no stretching).

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface BoundedTooltipProps {
  boundsRef: React.RefObject<HTMLElement | null>;
  x: number;
  y: number;
  children: React.ReactNode;
  offset?: number;
  /** Fixed width in px. Prevents content-driven tooltip jitter. */
  width?: number;
}

export function BoundedTooltip({ boundsRef, x, y, children, offset = 12, width: fixedWidth }: BoundedTooltipProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [bounds, setBounds] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  useLayoutEffect(() => {
    const el = boundsRef.current;
    setBounds(el ? el.getBoundingClientRect() : null);
  }, [boundsRef, x, y]);

  if (typeof document === 'undefined') return null;

  const fallback = { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 };
  const area = bounds ?? fallback;
  const maxW = Math.max(80, area.right - area.left - 8);
  const width = fixedWidth ? Math.min(fixedWidth, maxW) : Math.min(size.w, maxW);
  const height = size.h;

  let left = x + offset;
  let top = y + offset;
  if (left + width > area.right - 4) left = x - width - offset;
  if (top + height > area.bottom - 4) top = y - height - offset;
  left = Math.max(area.left + 4, Math.min(area.right - width - 4, left));
  top = Math.max(area.top + 4, Math.min(area.bottom - height - 4, top));

  return createPortal(
    <div
      ref={contentRef}
      className="pointer-events-none fixed z-[300] max-w-[280px] rounded-lg border border-gray-600 bg-gray-900/95 px-2 py-1.5 text-[10px] leading-snug text-gray-200 shadow-2xl"
      style={{ left, top, width: fixedWidth ? width : (size.w > maxW ? maxW : undefined) }}
    >
      {children}
    </div>,
    document.body,
  );
}
