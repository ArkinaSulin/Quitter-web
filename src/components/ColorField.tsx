'use client';
// src/components/ColorField.tsx
// Shared colour input: native colour swatch (OS palette / eyedropper), a hex
// code box, and quick preset swatches. Emits a hex string.
import React from 'react';

const PRESETS = [
  '#ffd54d', '#ff8a65', '#ff7043', '#e57373', '#f06292', '#ba68c8',
  '#9575cd', '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac',
  '#81c784', '#aed581', '#dce775', '#fff176', '#a1887f', '#9e9e9e',
  '#cccccc', '#ffffff',
];

interface ColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
  readOnly?: boolean;
  className?: string;
}

export function ColorField({ value, onChange, readOnly = false, className = '' }: ColorFieldProps) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#cccccc';
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="color"
        value={safe}
        disabled={readOnly}
        onChange={e => onChange(e.target.value)}
        title="Pick a colour"
        className="h-8 w-10 shrink-0 rounded border border-gray-600 bg-transparent cursor-pointer disabled:opacity-50"
      />
      <input
        type="text"
        value={value}
        disabled={readOnly}
        onChange={e => onChange(e.target.value)}
        placeholder="#rrggbb"
        className="w-24 bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none disabled:opacity-50"
      />
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(c => (
          <button
            key={c}
            type="button"
            disabled={readOnly}
            onClick={() => onChange(c)}
            title={c}
            style={{ backgroundColor: c }}
            className={`w-4 h-4 rounded-sm border ${value?.toLowerCase() === c ? 'border-white' : 'border-gray-600'} disabled:opacity-50`}
          />
        ))}
      </div>
    </div>
  );
}
