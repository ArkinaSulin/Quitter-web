// src/components/ImagePickerModal.tsx
'use client';

// Shared "Select Unit Image" picker (mirrors UnitEditor's): race icons + uploaded
// user images (unit_images bucket) + upload + remove custom. Used by the template
// editor and the scenario DM stat editor.

import { useCallback, useEffect, useState } from 'react';
import NextImage from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { raceIconFromName } from '@/lib/imageUrls';

function resizeImage(file: File, maxWidth: number, maxHeight: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        if (ratio < 1) {
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to resize image'));
        }, 'image/png');
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadCustomImage(file: File, key: string): Promise<string | null> {
  try {
    const resizedBlob = await resizeImage(file, 256, 256);
    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `${key}_${Date.now()}.${fileExt}`;
    const { data, error } = await supabase.storage
      .from('unit_images')
      .upload(fileName, resizedBlob, {
        cacheControl: '3600',
        upsert: true,
      });
    if (error) throw error;
    const { data: urlData } = supabase.storage
      .from('unit_images')
      .getPublicUrl(fileName);
    return urlData.publicUrl;
  } catch (err) {
    console.error('Upload error:', err);
    return null;
  }
}

interface ImagePickerModalProps {
  /** Current custom image URL, to highlight / allow "Remove Custom". */
  current?: string | null;
  /** Storage key prefix for uploads (e.g. the unit id). */
  uploadKey?: string;
  onSelect: (url: string | null) => void;
  onClose: () => void;
}

export function ImagePickerModal({ current, uploadKey = 'temp', onSelect, onClose }: ImagePickerModalProps) {
  const [races, setRaces] = useState<{ id: string; name: string; icon_url: string | null }[]>([]);
  const [userImages, setUserImages] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadUserImages = useCallback(async () => {
    setLoadingImages(true);
    try {
      const urls: string[] = [];
      let offset = 0;
      const pageSize = 100;
      while (true) {
        const { data, error } = await supabase.storage
          .from('unit_images')
          .list('', { limit: pageSize, offset });
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const file of data) {
          if (file.name === '.emptyFolderPlaceholder') continue;
          const { data: urlData } = supabase.storage
            .from('unit_images')
            .getPublicUrl(file.name);
          urls.push(urlData.publicUrl);
        }
        if (data.length < pageSize) break;
        offset += data.length;
      }
      setUserImages(urls);
    } catch (err) {
      console.error('Failed to load user images:', err);
    } finally {
      setLoadingImages(false);
    }
  }, []);

  useEffect(() => {
    supabase.from('races').select('id, name, icon_url').then(({ data }) => {
      if (data) setRaces((data as { id: string; name: string; icon_url: string | null }[]));
    });
    loadUserImages();
  }, [loadUserImages]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadCustomImage(file, uploadKey);
      if (url) {
        onSelect(url);
        await loadUserImages();
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-[600px] max-h-[80vh] flex flex-col border border-gray-700">
        <h2 className="text-xl font-bold mb-4 text-white">Select Unit Image</h2>
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-4 gap-2 mb-4">
            {races.map(race => {
              const icon = raceIconFromName(race.name, race.icon_url);
              return icon && (
                <div
                  key={`race-${race.id}`}
                  onClick={() => onSelect(icon)}
                  className={`border-2 rounded p-1 cursor-pointer transition ${current === icon ? 'border-yellow-400' : 'border-gray-600 hover:border-yellow-400'}`}
                >
                  <NextImage
                    src={icon}
                    alt={race.name}
                    width={64}
                    height={64}
                    className="object-contain w-full h-auto"
                    unoptimized
                  />
                  <span className="text-xs text-gray-400 text-center block truncate">{race.name}</span>
                </div>
              );
            })}
            {loadingImages ? (
              <div className="col-span-4 text-center text-gray-400">Loading...</div>
            ) : (
              userImages.map((url, idx) => (
                <div
                  key={`user-${idx}`}
                  onClick={() => onSelect(url)}
                  className={`border-2 rounded p-1 cursor-pointer transition ${current === url ? 'border-yellow-400' : 'border-gray-600 hover:border-yellow-400'}`}
                >
                  <NextImage
                    src={url}
                    alt="User image"
                    width={64}
                    height={64}
                    className="object-contain w-full h-auto"
                    unoptimized
                  />
                </div>
              ))
            )}
            {userImages.length === 0 && !loadingImages && (
              <div className="col-span-4 text-center text-gray-500">No user images yet.</div>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition cursor-pointer">
              {uploading ? 'Uploading...' : 'Upload Image'}
              <input
                type="file"
                accept="image/*"
                onChange={handleUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
            <button
              onClick={() => onSelect(null)}
              className="px-4 py-2 bg-red-800 border-2 border-red-400 text-white rounded hover:bg-red-700 transition"
            >
              Remove Custom
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
