'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface PanelsContainerProps {
  children: React.ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  allCollapsed?: boolean;
}

export function PanelsContainer({
  children,
  defaultWidth = 320,
  defaultHeight = 600,
  minWidth = 200,
  minHeight = 200,
  allCollapsed = false,
}: PanelsContainerProps) {
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
  const resizing = useRef<null | 'right' | 'bottom' | 'corner'>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: 0, height: 0 });
  const [maxHeight, setMaxHeight] = useState(window.innerHeight - 100);

  useEffect(() => {
    const onResize = () => setMaxHeight(window.innerHeight - 100);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleMouseDown = useCallback((edge: 'right' | 'bottom' | 'corner') => (e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = edge;
    startPos.current = { x: e.clientX, y: e.clientY };
    startSize.current = { width: size.width, height: size.height };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - startPos.current.x;
      const dy = ev.clientY - startPos.current.y;
      let newWidth = startSize.current.width;
      let newHeight = startSize.current.height;

      if (resizing.current === 'right' || resizing.current === 'corner') {
        newWidth = Math.max(minWidth, startSize.current.width + dx);
      }
      if (resizing.current === 'bottom' || resizing.current === 'corner') {
        newHeight = Math.max(minHeight, Math.min(maxHeight, startSize.current.height + dy));
      }

      setSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      resizing.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [size, minWidth, minHeight, maxHeight]);

  const autoSize = allCollapsed ? 'auto' : undefined;

  return (
    <div
      className="bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-2xl overflow-hidden select-none relative"
      style={{ width: autoSize ?? size.width, height: autoSize ?? size.height, minWidth: allCollapsed ? undefined : minWidth }}
    >
      <div className="flex flex-col h-full">
        {children}
      </div>

      {/* Right edge resize handle */}
      <div
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-yellow-400/50 active:bg-yellow-400/70 transition-colors"
        onMouseDown={handleMouseDown('right')}
      />
      {/* Bottom edge resize handle */}
      <div
        className="absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize hover:bg-yellow-400/50 active:bg-yellow-400/70 transition-colors"
        onMouseDown={handleMouseDown('bottom')}
      />
      {/* Bottom-right corner resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-10"
        onMouseDown={handleMouseDown('corner')}
        style={{
          background: 'linear-gradient(135deg, transparent 50%, rgba(250,204,21,0.5) 50%)',
        }}
      />
    </div>
  );
}
