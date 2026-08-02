'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface MapBackgroundConfig {
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
}

interface MapEditorPanelProps {
  currentConfig: MapBackgroundConfig | null;
  onSave: (config: MapBackgroundConfig) => void;
  onPreviewChange?: (config: Partial<MapBackgroundConfig>) => void;
}

interface MapImage {
  name: string;
  url: string;
}

export function MapEditorPanel({ currentConfig, onSave, onPreviewChange }: MapEditorPanelProps) {
  const [images, setImages] = useState<MapImage[]>([]);
  const [imageUrl, setImageUrl] = useState(currentConfig?.imageUrl || '');
  const [offsetX, setOffsetX] = useState(currentConfig?.offsetX || 0);
  const [offsetY, setOffsetY] = useState(currentConfig?.offsetY || 0);
  const [scale, setScale] = useState(currentConfig?.scale || 1);
  const [gridRadius, setGridRadius] = useState(currentConfig?.gridRadius ?? 12);

  useEffect(() => {
    fetch('/api/map-images')
      .then(r => r.json())
      .then(setImages)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (currentConfig) {
      setImageUrl(currentConfig.imageUrl);
      setOffsetX(currentConfig.offsetX);
      setOffsetY(currentConfig.offsetY);
      setScale(currentConfig.scale);
      setGridRadius(currentConfig.gridRadius ?? 12);
    }
  }, [currentConfig]);

  const handleRadiusChange = (value: number) => {
    const next = Math.max(3, Math.min(30, value));
    setGridRadius(next);
    onPreviewChange?.({ gridRadius: next });
  };

  const handleSave = useCallback(() => {
    if (!imageUrl && gridRadius === (currentConfig?.gridRadius ?? 12)) return;
    onSave({ imageUrl, offsetX, offsetY, scale, gridRadius });
  }, [imageUrl, offsetX, offsetY, scale, gridRadius, onSave, currentConfig]);

  return (
    <div className="h-full flex flex-col p-3 space-y-3">
      <div>
        <label className="text-xs text-gray-400 block mb-1">Grid Radius (rings of hex)</label>
        <input
          type="number"
          min={3}
          max={30}
          value={gridRadius}
          onChange={e => handleRadiusChange(parseInt(e.target.value) || 12)}
          className="w-full bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600"
        />
        <p className="text-xs text-gray-400 mt-1">How many rings of hexes the map shows (default 12).</p>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Background Image</label>
        <select
          value={imageUrl}
          onChange={e => {
            const next = e.target.value;
            setImageUrl(next);
            onPreviewChange?.({ imageUrl: next });
          }}
          className="w-full bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600"
        >
          <option value="">— None —</option>
          {images.map(img => (
            <option key={img.url} value={img.url}>{img.name}</option>
          ))}
        </select>
      </div>

      {imageUrl && (
        <>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Offset X: {offsetX.toFixed(0)}</label>
            <input
              type="range"
              min={-500}
              max={500}
              value={offsetX}
              onChange={e => {
                const next = Number(e.target.value);
                setOffsetX(next);
                onPreviewChange?.({ offsetX: next });
              }}
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Offset Y: {offsetY.toFixed(0)}</label>
            <input
              type="range"
              min={-500}
              max={500}
              value={offsetY}
              onChange={e => {
                const next = Number(e.target.value);
                setOffsetY(next);
                onPreviewChange?.({ offsetY: next });
              }}
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Scale: {scale.toFixed(2)}</label>
            <input
              type="range"
              min={0.1}
              max={10}
              step={0.05}
              value={scale}
              onChange={e => {
                const next = Number(e.target.value);
                setScale(next);
                onPreviewChange?.({ scale: next });
              }}
              className="w-full"
            />
          </div>
        </>
      )}

      <button
        onClick={handleSave}
        disabled={!imageUrl && gridRadius === (currentConfig?.gridRadius ?? 12)}
        className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-3 py-1.5 rounded transition-colors"
      >
        Save Map Settings
      </button>
    </div>
  );
}

export type { MapBackgroundConfig };
