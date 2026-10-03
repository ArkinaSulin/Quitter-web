'use client';
// src/components/ScenarioMap/Floating.tsx
//
// The ONE floating-layer primitive for the scenario UI: tooltips and small
// pop-up menus (context menu, message menu, effect/structure/unit-template
// tooltips). It PORTALS to document.body and positions with `position: fixed`,
// so it is always bound to the BROWSER viewport — never clipped or re-anchored
// by a panel's `overflow-hidden` or `backdrop-blur` (which creates a containing
// block for fixed descendants). Sizing is measured, never estimated, and `flip`
// pushes a panel above its anchor when there is no room below.
//
// Follow this for any future left-panel tab tooltip/pop-up: callers only supply
// the visual `className` and content; this owns portal + clamp + flip + z-index.
import React, { forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPosition } from './useTooltipClamp';

interface FloatingProps {
  /** Anchor X (viewport/client coords). */
  x: number;
  /** Anchor Y (viewport/client coords). */
  y: number;
  /** Gap between anchor and panel (default 12). */
  offset?: number;
  /** Push above the anchor when there isn't room below. */
  flip?: boolean;
  /** Stacking order (relative to body). */
  z?: number;
  /** Interactive menus receive pointer events; tooltips do not. */
  interactive?: boolean;
  /** Visual styles (background/border/padding/width…). `fixed`/pointer-events/z are owned here. */
  className?: string;
  children: React.ReactNode;
}

export const Floating = forwardRef<HTMLDivElement, FloatingProps>(function Floating(
  { x, y, offset = 12, flip = false, z = 50, interactive = false, className = '', children },
  forwardedRef,
) {
  const { ref, style } = useFloatingPosition(x, y, { offset, flip });

  if (typeof document === 'undefined') return null;

  const setRefs = (node: HTMLDivElement | null) => {
    (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  return createPortal(
    <div
      ref={setRefs}
      className={`fixed ${interactive ? 'pointer-events-auto' : 'pointer-events-none'} ${className}`}
      style={{ ...style, zIndex: z }}
    >
      {children}
    </div>,
    document.body,
  );
});
