'use client';

import React from 'react';

interface PanelSectionProps {
  children: React.ReactNode;
}

export function PanelSection({ children }: PanelSectionProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-700 first:border-t-0">
      {children}
    </div>
  );
}
