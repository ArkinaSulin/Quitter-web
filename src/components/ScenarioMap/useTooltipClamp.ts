'use client';

import { useRef, useLayoutEffect, useState } from 'react';

const MARGIN = 8;
const DEFAULT_OFFSET = 12;

export interface FloatingPositionOpts {
  /** Gap between the anchor and the panel (default 12). */
  offset?: number;
  /** When there isn't room below, place the panel ABOVE the anchor instead. */
  flip?: boolean;
}

/**
 * Position a floating panel (tooltip / menu) at an anchor, clamped inside the
 * BROWSER viewport (measured against `window.inner*`). The panel's real size is
 * measured after render — never a hard-coded estimate — so it can't be cropped
 * at the right/bottom edge. With `flip`, a panel that would overflow the bottom
 * is pushed ABOVE its anchor (standard menu behaviour).
 *
 * NOTE: `position: fixed` is only viewport-relative when no ancestor has
 * `transform`/`filter`/`backdrop-filter`. Render the consuming element through
 * `Floating` (a `document.body` portal) so the panel is always browser-bound.
 */
export function useFloatingPosition(x: number, y: number, opts: FloatingPositionOpts = {}) {
  const offset = opts.offset ?? DEFAULT_OFFSET;
  const flip = opts.flip ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + offset, top: y + offset });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const left = Math.max(MARGIN, Math.min(x + offset, window.innerWidth - w - MARGIN));
    let top = y + offset;
    if (flip && top + h > window.innerHeight - MARGIN) top = y - offset - h;
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));
    setPos({ left, top });
  }, [x, y, offset, flip]);

  return { ref, style: pos };
}

/**
 * Back-compat wrapper: measured clamp, no flip. Existing callers keep working;
 * new code should prefer `Floating`.
 */
export function useTooltipClamp(x: number, y: number) {
  return useFloatingPosition(x, y, { offset: DEFAULT_OFFSET, flip: false });
}
