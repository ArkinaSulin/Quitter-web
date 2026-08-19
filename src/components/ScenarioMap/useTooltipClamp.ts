'use client';

import { useRef, useLayoutEffect, useState } from 'react';

const MARGIN = 8;
const OFFSET = 12;

/**
 * Keep a tooltip inside the viewport. Measures the rendered element and clamps
 * its left/top so no part is cut off at the right or bottom edge; wide tooltips
 * should also wrap (max-width + whitespace-normal) so nothing is unreachable.
 */
export function useTooltipClamp(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + OFFSET, top: y + OFFSET });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth, offsetHeight } = el;
    setPos({
      left: Math.min(x + OFFSET, Math.max(MARGIN, window.innerWidth - offsetWidth - MARGIN)),
      top: Math.min(y + OFFSET, Math.max(MARGIN, window.innerHeight - offsetHeight - MARGIN)),
    });
  }, [x, y]);

  return { ref, style: pos };
}
