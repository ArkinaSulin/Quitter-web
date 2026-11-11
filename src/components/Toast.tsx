// src/components/Toast.tsx
'use client';

import { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  duration?: number; // ms (ignored when persistent)
  /** Stay on screen until replaced by the next toast (no auto-dismiss). */
  persistent?: boolean;
  onClose?: () => void;
}

export default function Toast({ message, duration = 3000, persistent = false, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (persistent) return;
    const timer = setTimeout(() => {
      setVisible(false);
      if (onClose) onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, persistent, onClose]);

  if (!visible) return null;

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-gray-800 border border-yellow-400 text-white px-6 py-3 rounded-lg shadow-lg animate-fade-in">
      {message}
    </div>
  );
}