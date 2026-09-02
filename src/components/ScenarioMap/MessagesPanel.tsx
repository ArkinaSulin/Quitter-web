'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useMessages } from '@/contexts/MessageContext';

/** Copy text to the system clipboard (navigator.clipboard with a fallback for
 *  non-secure contexts — the messages panel is select-none, so the context menu
 *  is the copy path). */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    // ignore — best effort only
  }
  document.body.removeChild(ta);
}

interface MenuState {
  x: number;
  y: number;
  /** Index of the right-clicked message, or null when right-clicking empty space. */
  messageIndex: number | null;
}

const MENU_WIDTH = 130;
const MENU_HEIGHT = 80;

export function MessagesPanel() {
  const { messages } = useMessages();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    // block:'nearest' scrolls only the messages' own overflow container — a plain
    // scrollIntoView() would also scroll the window/document, dragging the whole
    // map view up by an amount proportional to the message's position.
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const closeMenu = useCallback(() => setMenu(null), []);

  // Dismiss the context menu on Escape, click/pointer outside it, window blur, or
  // a scroll/resize that would leave it floating over the wrong spot.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof HTMLElement && !e.target.closest('[data-msg-menu]')) closeMenu();
    };
    const onClose = () => closeMenu();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('blur', onClose);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [menu, closeMenu]);

  const openMenu = (e: React.MouseEvent, messageIndex: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, messageIndex });
  };

  const copyAll = () => copyText(messages.map(m => m.text).join('\n'));

  return (
    <div
      className="h-full overflow-y-auto p-2 space-y-1 text-sm font-mono overscroll-contain scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent select-none"
      onContextMenu={(e) => openMenu(e, null)}
    >
      {messages.length === 0 && (
        <div className="text-gray-500 italic select-none">No messages yet</div>
      )}
      {messages.map((msg, idx) => (
        <div
          key={idx}
          onContextMenu={(e) => openMenu(e, idx)}
          className={`border-b border-gray-800 pb-1 select-none ${msg.tone === 'error' ? 'text-red-400 font-bold' : 'text-gray-300'}`}
        >
          {msg.text}
        </div>
      ))}
      <div ref={bottomRef} />

      {menu && createPortal(
        <div
          data-msg-menu
          className="fixed z-[100] bg-gray-800 border border-gray-600 rounded shadow-lg py-1"
          style={{
            left: Math.min(menu.x, window.innerWidth - MENU_WIDTH),
            top: Math.min(menu.y, window.innerHeight - MENU_HEIGHT),
            width: MENU_WIDTH,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.messageIndex !== null && messages[menu.messageIndex] && (
            <button
              onClick={() => { copyText(messages[menu.messageIndex!].text); closeMenu(); }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700"
            >
              Copy
            </button>
          )}
          <button
            onClick={() => { copyAll(); closeMenu(); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700"
          >
            Copy all
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
