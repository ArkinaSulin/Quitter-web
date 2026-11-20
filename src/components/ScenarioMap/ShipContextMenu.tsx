'use client';

// Right-click menu for a placed ship. Mirrors the unit ContextMenu: rotate for
// the control team/DM, hide/delete for the DM.

import { useEffect, useRef } from 'react';
import type { ShipRuntime } from '@/packages/ships';
import { Floating } from './Floating';

export interface ShipContextMenuProps {
  ship: ShipRuntime;
  x: number;
  y: number;
  canManage: boolean;
  canRotate: boolean;
  onRotate: (direction: 'left' | 'right') => void;
  onToggleHide: () => void;
  onDelete: () => void;
  onDryDock?: () => void;
  onMakePlayerShip?: () => void;
  onClose: () => void;
}

export function ShipContextMenu({
  ship,
  x,
  y,
  canManage,
  canRotate,
  onRotate,
  onToggleHide,
  onDelete,
  onDryDock,
  onMakePlayerShip,
  onClose,
}: ShipContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <Floating
      ref={menuRef}
      x={x}
      y={y}
      z={50}
      interactive
      className="bg-gray-900 border border-gray-700 rounded shadow-xl py-1 min-w-[190px] text-sm text-white"
    >
      <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-gray-400">
        {ship.name}
      </div>
      <div
        className={`px-3 py-1 ${canRotate ? 'hover:bg-gray-700 cursor-pointer' : 'text-gray-600 cursor-not-allowed'}`}
        onClick={() => { if (canRotate) { onRotate('left'); onClose(); } }}
      >
        Rotate Left (1 MP)
      </div>
      <div
        className={`px-3 py-1 ${canRotate ? 'hover:bg-gray-700 cursor-pointer' : 'text-gray-600 cursor-not-allowed'}`}
        onClick={() => { if (canRotate) { onRotate('right'); onClose(); } }}
      >
        Rotate Right (1 MP)
      </div>
      {canManage && (
        <>
          <div
            className="px-3 py-1 hover:bg-gray-700 cursor-pointer"
            onClick={() => { onToggleHide(); onClose(); }}
          >
            {ship.hidden ? 'Unhide' : 'Hide'}
          </div>
          <div
            className="px-3 py-1 hover:bg-red-900/60 cursor-pointer text-red-300"
            onClick={() => {
              if (confirm(`Delete ship "${ship.name}"?`)) {
                onDelete();
                onClose();
              }
            }}
          >
            Delete Ship
          </div>
          {(onMakePlayerShip || onDryDock) && (
            <>
              <div className="border-t border-gray-700 my-1" />
              {onMakePlayerShip && (
                <div
                  className="px-3 py-1 hover:bg-gray-700 cursor-pointer"
                  onClick={() => { onMakePlayerShip(); onClose(); }}
                >
                  Make Player Ship
                </div>
              )}
              {onDryDock && (
                <div
                  className="px-3 py-1 hover:bg-gray-700 cursor-pointer"
                  onClick={() => { onDryDock(); onClose(); }}
                >
                  Dry Dock
                </div>
              )}
            </>
          )}
        </>
      )}
    </Floating>
  );
}
