'use client';

import React, { useRef, useEffect } from 'react';
import { useMessages } from '@/contexts/MessageContext';

export function MessagesPanel() {
  const { messages } = useMessages();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="h-full overflow-y-auto p-2 space-y-1 text-sm font-mono overscroll-contain scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent select-none">
      {messages.length === 0 && (
        <div className="text-gray-500 italic select-none">No messages yet</div>
      )}
      {messages.map((msg, idx) => (
        <div
          key={idx}
          className={`border-b border-gray-800 pb-1 select-none ${msg.tone === 'error' ? 'text-red-400 font-bold' : 'text-gray-300'}`}
        >
          {msg.text}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
