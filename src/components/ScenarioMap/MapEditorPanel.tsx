'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface MapBackgroundConfig {
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface MapEditorPanelProps {
  currentConfig: MapBackgroundConfig | null;
  onSave: (config: MapBackgroundConfig) => void;
}

interface MapImage {
  name: string;
  url: string;
}

export function MapEditorPanel({ currentConfig, onSave }: MapEditorPanelProps) {
  const [images, setImages] = useState<MapImage[]>([]);
  const [imageUrl, setImageUrl] = useState(currentConfig?.imageUrl || '');
  const [offsetX, setOffsetX] = useState(currentConfig?.offsetX || 0);
  const [offsetY, setOffsetY] = useState(currentConfig?.offsetY || 0);
  const [scale, setScale] = useState(currentConfig?.scale || 1);

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
    }
  }, [currentConfig]);

  const handleSave = useCallback(() => {
    if (!imageUrl) return;
    onSave({ imageUrl, offsetX, offsetY, scale });
  }, [imageUrl, offsetX, offsetY, scale, onSave]);

  return (
    <div className="h-full flex flex-col p-3 space-y-3">
      <div>
        <label className="text-xs text-gray-400 block mb-1">Background Image</label>
        <select
          value={imageUrl}
          onChange={e => setImageUrl(e.target.value)}
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
              onChange={e => setOffsetX(Number(e.target.value))}
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
              onChange={e => setOffsetY(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Scale: {scale.toFixed(2)}</label>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              value={scale}
              onChange={e => setScale(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </>
      )}

      <button
        onClick={handleSave}
        disabled={!imageUrl}
        className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-3 py-1.5 rounded transition-colors"
      >
        Save Background
      </button>
    </div>
  );
}

export type { MapBackgroundConfig };
