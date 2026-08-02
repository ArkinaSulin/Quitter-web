'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface TabDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onToggle: () => void;
}

interface PanelsContainerProps {
  tabs: TabDef[];
  children: React.ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  side?: 'left' | 'right';
  onToggleSide?: () => void;
}

export function PanelsContainer({
  tabs,
  children,
  defaultWidth = 320,
  defaultHeight = 500,
  minWidth = 200,
  minHeight = 200,
  side = 'left',
  onToggleSide,
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

    const widthSign = side === 'right' ? -1 : 1;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - startPos.current.x;
      const dy = ev.clientY - startPos.current.y;
      let newWidth = startSize.current.width;
      let newHeight = startSize.current.height;

      if (resizing.current === 'right' || resizing.current === 'corner') {
        newWidth = Math.max(minWidth, startSize.current.width + dx * widthSign);
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
  }, [size, minWidth, minHeight, maxHeight, side]);

  const allCollapsed = tabs.every(t => !t.active);
  const autoSize = allCollapsed ? 'auto' : undefined;

  return (
    <div
      className="bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-2xl overflow-hidden select-none relative flex flex-col"
      style={{ width: autoSize ?? size.width, height: autoSize ?? size.height, minWidth: allCollapsed ? undefined : minWidth }}
    >
      {/* Tab bar */}
      <div className="flex items-stretch border-b border-gray-700 bg-gray-800 flex-none">
        {onToggleSide && side === 'right' && (
          <button
            onClick={onToggleSide}
            title="Dock panel on the left"
            className="px-3 py-1.5 flex items-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border-r border-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
              <path d="M15.5 5.5 7 12l8.5 6.5V5.5z" />
            </svg>
          </button>
        )}
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={tab.onToggle}
            title={tab.label}
            className={`px-2.5 py-2 flex items-center text-xs transition-colors border-r border-gray-700 last:border-r-0 ${
              tab.active
                ? 'bg-gray-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {tab.icon}
          </button>
        ))}
        {onToggleSide && side === 'left' && (
          <button
            onClick={onToggleSide}
            title="Dock panel on the right"
            className="px-3 py-1.5 flex items-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border-l border-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
              <path d="M8.5 5.5 17 12l-8.5 6.5V5.5z" />
            </svg>
          </button>
        )}
      </div>

      {!allCollapsed && (
        <div className="flex flex-col flex-1 min-h-0">
          {children}
        </div>
      )}

      {/* Width edge resize handle */}
      {!allCollapsed && (
        <div
          className={`absolute top-0 w-1.5 h-full cursor-col-resize hover:bg-yellow-400/50 active:bg-yellow-400/70 transition-colors ${side === 'left' ? 'right-0' : 'left-0'}`}
          onMouseDown={handleMouseDown('right')}
        />
      )}
      {/* Bottom edge resize handle */}
      {!allCollapsed && (
        <div
          className="absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize hover:bg-yellow-400/50 active:bg-yellow-400/70 transition-colors"
          onMouseDown={handleMouseDown('bottom')}
        />
      )}
      {/* Bottom corner resize handle */}
      {!allCollapsed && (
        <div
          className={`absolute bottom-0 w-3 h-3 ${side === 'left' ? 'right-0 cursor-nwse-resize' : 'left-0 cursor-nesw-resize'} z-10`}
          onMouseDown={handleMouseDown('corner')}
          style={{
            background: `linear-gradient(${side === 'left' ? '135deg' : '225deg'}, transparent 50%, rgba(250,204,21,0.5) 50%)`,
          }}
        />
      )}
    </div>
  );
}
