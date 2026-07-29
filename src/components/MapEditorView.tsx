'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useHexGrid } from '@/hooks/useHexGrid';
import { useScenarios } from '@/hooks/useScenarios';

interface MapImage {
  name: string;
  url: string;
}

interface MapEditorViewProps {
  scenarioId: string;
  onClose: () => void;
}

const HEX_SIZE = 100;

export function MapEditorView({ scenarioId, onClose }: MapEditorViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { fetchScenarioMapData, updateScenarioMapData } = useScenarios();
  const [images, setImages] = useState<MapImage[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(1);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/map-images').then(r => r.json()).then(setImages).catch(() => {});
  }, []);

  useEffect(() => {
    fetchScenarioMapData(scenarioId).then(data => {
      if (data?.backgroundImageUrl) {
        setImageUrl(data.backgroundImageUrl);
        setOffsetX(data.bgOffsetX ?? 0);
        setOffsetY(data.bgOffsetY ?? 0);
        setScale(data.bgScale ?? 1);
      }
    });
  }, [scenarioId, fetchScenarioMapData]);

  const backgroundImage = imageUrl ? { url: imageUrl, offsetX, offsetY, scale } : null;

  const { handleMouseMove, handleMouseDown, handleMouseUp, handleRightClick } = useHexGrid({
    canvasRef,
    size: HEX_SIZE,
    gridRadius: 12,
    units: [],
    onUnitMove: () => {},
    backgroundImage,
  });

  const handleSave = useCallback(async () => {
    const ok = await updateScenarioMapData(scenarioId, {
      backgroundImageUrl: imageUrl,
      bgOffsetX: offsetX,
      bgOffsetY: offsetY,
      bgScale: scale,
    });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [scenarioId, imageUrl, offsetX, offsetY, scale, updateScenarioMapData]);

  const handleSelectImage = useCallback((url: string) => {
    setImageUrl(url);
    if (!url) {
      setOffsetX(0);
      setOffsetY(0);
      setScale(1);
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0d1a] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleRightClick}
      />

      <div className="absolute top-0 left-0 z-10 h-full w-72 bg-gray-900/95 backdrop-blur-sm border-r border-gray-700 p-4 flex flex-col gap-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-white text-sm font-semibold">Map Editor</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-sm px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
          >
            Back
          </button>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Background Image</label>
          <select
            value={imageUrl}
            onChange={e => handleSelectImage(e.target.value)}
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
                min={-1000}
                max={1000}
                value={offsetX}
                onChange={e => setOffsetX(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Offset Y: {offsetY.toFixed(0)}</label>
              <input
                type="range"
                min={-1000}
                max={1000}
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
                max={10}
                step={0.1}
                value={scale}
                onChange={e => setScale(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </>
        )}

        <div className="text-xs text-gray-500 leading-relaxed">
          Pan: middle-click + drag<br />
          Zoom: scroll wheel<br />
          Adjust sliders to align the image with the hex grid.
        </div>

        <button
          onClick={handleSave}
          disabled={!imageUrl}
          className={`w-full py-2 rounded text-sm font-medium transition ${
            saved
              ? 'bg-green-600 text-white'
              : 'bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 text-white'
          }`}
        >
          {saved ? 'Saved!' : 'Save Background'}
        </button>
      </div>
    </div>
  );
}
