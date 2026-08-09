'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // List directly from storage (same pattern as unit_images) so the list is always
  // fresh — no Next.js API route to cache. Paginates past storage's 100-item default.
  const loadImages = useCallback(async () => {
    try {
      const all: MapImage[] = [];
      let offset = 0;
      const pageSize = 100;
      while (true) {
        const { data, error } = await supabase.storage
          .from('map_images')
          .list('', { limit: pageSize, offset });
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const f of data) {
          if (f.name === '.emptyFolderPlaceholder') continue;
          const { data: urlData } = supabase.storage
            .from('map_images')
            .getPublicUrl(f.name);
          all.push({ name: f.name, url: urlData.publicUrl });
        }
        if (data.length < pageSize) break;
        offset += data.length;
      }
      setImages(all);
    } catch (err) {
      console.error('Failed to load map images:', err);
    }
  }, []);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  useEffect(() => {
    if (currentConfig) {
      setImageUrl(currentConfig.imageUrl);
      setOffsetX(currentConfig.offsetX);
      setOffsetY(currentConfig.offsetY);
      setScale(currentConfig.scale);
      setGridRadius(currentConfig.gridRadius ?? 12);
    }
  }, [currentConfig]);

  const handleUploadFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fileExt = (file.name.split('.').pop() || 'png').toLowerCase();
      const fileName = `map_${Date.now()}.${fileExt}`;
      const { error } = await supabase.storage
        .from('map_images')
        .upload(fileName, file, { cacheControl: '3600', upsert: false });
      if (error) throw error;
      const { data: urlData } = supabase.storage
        .from('map_images')
        .getPublicUrl(fileName);
      setImageUrl(urlData.publicUrl);
      onPreviewChange?.({ imageUrl: urlData.publicUrl });
      // Persist immediately so the map keeps the image after leaving the lobby.
      onSave({ imageUrl: urlData.publicUrl, offsetX, offsetY, scale, gridRadius });
      loadImages();
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

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
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto mb-2">
            <button
              onClick={() => {
                setImageUrl('');
                onPreviewChange?.({ imageUrl: '' });
              }}
              className={`flex flex-col items-center justify-center aspect-video rounded border text-xs transition-colors ${
                imageUrl === ''
                  ? 'border-yellow-400 bg-yellow-500/10 text-yellow-300'
                  : 'border-gray-600 bg-gray-800 text-gray-400 hover:border-gray-500'
              }`}
              title="No background image"
            >
              None
            </button>
            {images.map(img => (
              <button
                key={img.url}
                onClick={() => {
                  setImageUrl(img.url);
                  onPreviewChange?.({ imageUrl: img.url });
                }}
                className={`flex flex-col items-center overflow-hidden rounded border text-[10px] transition-colors ${
                  imageUrl === img.url
                    ? 'border-yellow-400 bg-yellow-500/10 text-yellow-300'
                    : 'border-gray-600 bg-gray-800 text-gray-400 hover:border-gray-500'
                }`}
                title={img.name}
              >
                <img src={img.url} alt={img.name} className="w-full aspect-video object-cover" loading="lazy" />
                <span className="w-full truncate px-1 py-0.5">{img.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs px-3 py-1.5 rounded transition-colors"
          >
            {uploading ? 'Uploading...' : 'Upload Image'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.webp"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleUploadFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {uploadError && <p className="text-xs text-red-400 mt-1">{uploadError}</p>}
      </div>

      {imageUrl && (
        <>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Current Map</label>
            <img src={imageUrl} alt="Current map" className="w-full rounded border border-gray-600" />
          </div>
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
