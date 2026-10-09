// src/components/ImagePickerModal.tsx
'use client';

// Shared "Select Unit Image" picker (mirrors UnitEditor's): race icons + uploaded
// user images (unit_images bucket) + upload + remove custom + delete-from-library.
// Used by the template editor and the scenario DM stat editor.

import { useCallback, useEffect, useState } from 'react';
import NextImage from 'next/image';
import { supabase } from '@/packages/infra/supabase';
import { raceIconFromName } from '@/packages/infra';

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

async function uploadCustomImage(file: File, key: string, bucket: string): Promise<string | null> {
  try {
    const resizedBlob = await resizeImage(file, 256, 256);
    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `${key}_${Date.now()}.${fileExt}`;
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, resizedBlob, {
        cacheControl: '3600',
        upsert: true,
      });
    if (error) throw error;
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);
    return urlData.publicUrl;
  } catch (err) {
    console.error('Upload error:', err);
    return null;
  }
}

/** Recover the object name from a public storage URL (last path segment). */
function storagePathFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/');
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return decodeURIComponent(url.split('/').pop() || '');
  }
}

interface ImagePickerModalProps {
  /** Current custom image URL, to highlight / allow "Remove Custom". */
  current?: string | null;
  /** Storage key prefix for uploads (e.g. the unit id). */
  uploadKey?: string;
  /** Supabase storage bucket to list/upload into (default unit_images). */
  bucket?: string;
  /** Modal heading. */
  title?: string;
  /** Offer the race icon grid (unit pickers do; effect pickers don't). */
  showRaces?: boolean;
  onSelect: (url: string | null) => void;
  onClose: () => void;
}

export function ImagePickerModal({
  current,
  uploadKey = 'temp',
  bucket = 'unit_images',
  title = 'Select Unit Image',
  showRaces = true,
  onSelect,
  onClose,
}: ImagePickerModalProps) {
  const [races, setRaces] = useState<{ id: string; name: string; icon_url: string | null }[]>([]);
  const [userImages, setUserImages] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadUserImages = useCallback(async () => {
    setLoadingImages(true);
    try {
      const urls: string[] = [];
      let offset = 0;
      const pageSize = 100;
      while (true) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .list('', { limit: pageSize, offset });
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const file of data) {
          if (file.name === '.emptyFolderPlaceholder') continue;
          const { data: urlData } = supabase.storage
            .from(bucket)
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
  }, [bucket]);

  useEffect(() => {
    if (showRaces) {
      supabase.from('unit_races').select('id, name, icon_url').then(({ data }) => {
        if (data) setRaces((data as { id: string; name: string; icon_url: string | null }[]));
      });
    }
    loadUserImages();
  }, [loadUserImages, showRaces]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadCustomImage(file, uploadKey, bucket);
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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase.storage.from(bucket).remove([storagePathFromUrl(pendingDelete)]);
      if (error) throw error;
      await loadUserImages();
      setPendingDelete(null);
      setDeleteMode(false);
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-[600px] max-h-[80vh] flex flex-col border border-gray-700">
        <h2 className="text-xl font-bold mb-4 text-white">{title}</h2>
        <div className="flex-1 overflow-y-auto">
          {deleteMode && (
            <div className="mb-3 flex items-center justify-between rounded border border-red-500/60 bg-red-900/30 px-3 py-2 text-xs text-red-200">
              <span>Click an uploaded image below to remove it from the library.</span>
              <button
                type="button"
                onClick={() => setDeleteMode(false)}
                className="ml-3 underline hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {showRaces && races.map(race => {
              const icon = raceIconFromName(race.name, race.icon_url);
              return icon && (
                <div
                  key={`race-${race.id}`}
                  onClick={() => { if (!deleteMode) onSelect(icon); }}
                  className={`border-2 rounded p-1 transition ${deleteMode ? 'border-gray-700 opacity-40' : `cursor-pointer ${current === icon ? 'border-yellow-400' : 'border-gray-600 hover:border-yellow-400'}`}`}
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
                  onClick={() => { if (deleteMode) setPendingDelete(url); else onSelect(url); }}
                  className={`border-2 rounded p-1 transition ${deleteMode ? 'cursor-pointer border-gray-600 hover:border-red-500 hover:opacity-80' : `cursor-pointer ${current === url ? 'border-yellow-400' : 'border-gray-600 hover:border-yellow-400'}`}`}
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
              Clear Image
            </button>
            <button
              onClick={() => setDeleteMode(true)}
              disabled={userImages.length === 0 || deleteMode}
              className="px-4 py-2 bg-red-900 border-2 border-red-500 text-white rounded hover:bg-red-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Remove Image
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

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]">
          <div className="bg-gray-800 p-6 rounded-lg w-80 border border-gray-700 text-center">
            <h3 className="text-lg font-bold mb-3 text-white">Remove this image?</h3>
            <NextImage
              src={pendingDelete}
              alt="Image to remove"
              width={160}
              height={160}
              className="object-contain mx-auto mb-4 max-h-40 w-auto"
              unoptimized
            />
            <p className="text-xs text-gray-400 mb-4">
              This deletes the image from the library for everyone and cannot be undone.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded disabled:opacity-50"
              >
                {deleting ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
