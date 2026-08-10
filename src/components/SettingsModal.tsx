// src/components/SettingsModal.tsx
'use client';

// Admin-only editor for the game-wide `settings` table. Each value is edited as
// JSON text (validated + parsed on save); after saving the in-memory settings
// cache is invalidated and reloaded so running clients pick up new values.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { invalidateSettingsCache, loadSettings } from '@/lib/settingsCache';

interface SettingsRow {
  key: string;
  value: unknown;
  description: string | null;
}

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [rows, setRows] = useState<SettingsRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from('settings')
      .select('key, value, description')
      .order('key')
      .then(({ data }) => {
        const list = (data ?? []) as SettingsRow[];
        setRows(list);
        const init: Record<string, string> = {};
        for (const r of list) init[r.key] = JSON.stringify(r.value);
        setDrafts(init);
      });
  }, []);

  const setDraft = useCallback((key: string, text: string) => {
    setDrafts(d => ({ ...d, [key]: text }));
  }, []);

  const handleSave = async () => {
    setError(null);
    const parsed: Record<string, unknown> = {};
    for (const r of rows) {
      const text = (drafts[r.key] ?? '').trim();
      try {
        parsed[r.key] = text === '' ? null : JSON.parse(text);
      } catch {
        setError(`"${r.key}" is not valid JSON: ${text}`);
        return;
      }
    }
    setSaving(true);
    try {
      for (const r of rows) {
        const { error } = await supabase
          .from('settings')
          .update({ value: parsed[r.key] })
          .eq('key', r.key);
        if (error) throw error;
      }
      invalidateSettingsCache();
      await loadSettings();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to save settings');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-[680px] border border-gray-700 max-h-[85vh] flex flex-col">
        <h2 className="text-xl font-bold mb-1 text-white">Game Settings</h2>
        <p className="text-xs text-gray-500 mb-4">Values are game-wide and applied immediately (JSON format).</p>

        {error && (
          <p className="text-red-400 text-sm bg-red-900/30 border border-red-700 rounded p-2 mb-3">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {rows.map(r => (
            <div key={r.key} className="bg-gray-900/50 border border-gray-700 rounded p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-yellow-300 font-mono">{r.key}</span>
                <span className="text-[11px] text-gray-500 text-right">{r.description ?? ''}</span>
              </div>
              <input
                type="text"
                value={drafts[r.key] ?? ''}
                onChange={e => setDraft(r.key, e.target.value)}
                className="w-full mt-1 bg-gray-800 text-white text-sm font-mono rounded px-2 py-1 border border-gray-700 focus:border-amber-400"
                spellCheck={false}
              />
            </div>
          ))}
          {rows.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No settings.</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-gray-700 pt-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
