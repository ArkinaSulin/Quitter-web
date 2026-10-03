'use client';

import { useRef, useLayoutEffect, useState } from 'react';

const MARGIN = 8;
const DEFAULT_OFFSET = 12;

export interface FloatingPositionOpts {
  /** Gap between the anchor and the panel (default 12). */
  offset?: number;
}

/**
 * Position a floating panel (tooltip / menu) at an anchor, clamped inside the
 * BROWSER viewport (measured against `window.inner*`). The panel's real size is
 * measured after render — never a hard-coded estimate — so it can't be cropped
 * at the right/bottom edge.
 *
 * The SINGLE positioning rule (shared by every tooltip and menu): open at
 * `anchor + offset`, and slide up/left ONLY as far as needed so the panel's
 * bottom/right edge stays inside the viewport (`innerHeight/Width − size − 8`).
 * It never flips above the anchor.
 *
 * NOTE: `position: fixed` is only viewport-relative when no ancestor has
 * `transform`/`filter`/`backdrop-filter`. Render the consuming element through
 * `Floating` (a `document.body` portal) so the panel is always browser-bound.
 */
export function useFloatingPosition(x: number, y: number, opts: FloatingPositionOpts = {}) {
  const offset = opts.offset ?? DEFAULT_OFFSET;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + offset, top: y + offset });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    setPos({
      left: Math.max(MARGIN, Math.min(x + offset, window.innerWidth - w - MARGIN)),
      top: Math.max(MARGIN, Math.min(y + offset, window.innerHeight - h - MARGIN)),
    });
  }, [x, y, offset]);

  return { ref, style: pos };
}

/**
 * Back-compat wrapper: measured clamp at the default offset. Existing callers
 * keep working; new code should prefer `Floating`.
 */
export function useTooltipClamp(x: number, y: number) {
  return useFloatingPosition(x, y, { offset: DEFAULT_OFFSET });
}
