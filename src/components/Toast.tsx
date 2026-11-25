// src/components/Toast.tsx
'use client';

// Scenario toast. Bottom-centre of the map so it never covers the top bar, and
// always dismissible with its close button (no auto-hide timer).

import { useState } from 'react';

interface ToastProps {
  message: string;
  onClose?: () => void;
}

export default function Toast({ message, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const close = () => {
    setVisible(false);
    onClose?.();
  };

  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[200] w-max max-w-[min(560px,calc(100vw-2rem))] -translate-x-1/2">
      <div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-yellow-400 bg-gray-800/95 px-4 py-2.5 text-sm text-white shadow-lg">
        <span className="min-w-0 whitespace-pre-line break-words">{message}</span>
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss message"
          title="Dismiss"
          className="shrink-0 rounded border border-gray-600 px-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          ×
        </button>
      </div>
    </div>
  );
}
