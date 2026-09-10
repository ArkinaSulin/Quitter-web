// src/components/WeaponEditorModal.tsx
'use client';

// Shared single-weapon editor used by UnitEditor (template) and the scenario DM
// stat editor (UnitEditorModal). Owns the weapon state and the weapon-library
// search/pre-fill; calls onSave(weapon) with the completed Weapon.
//
// The form body is the SAME `WeaponFields` the Weapon Editor page uses, so both
// surfaces always stay in sync.

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Weapon, blankWeapon, validateWeapon } from '@/lib/weaponParser';
import { LibraryWeapon, mapWeaponRow } from '@/lib/weaponMappers';
import { WeaponFields } from '@/components/WeaponEditor/WeaponFields';

interface WeaponEditorModalProps {
  /** The weapon being edited, or null for a fresh Add. */
  initial: Weapon | null;
  title: string;
  onSave: (weapon: Weapon) => void;
  onClose: () => void;
}

function normalize(w: Weapon): Weapon {
  return {
    ...w,
    name: w.name.trim(),
    damageDice: w.damageDice.trim(),
    range: Math.max(1, w.range || 1),
    maxRange: Math.max(w.maxRange || w.range, w.range),
    numberOfAttacks: Math.max(1, w.numberOfAttacks || 1),
  };
}

export function WeaponEditorModal({ initial, title, onSave, onClose }: WeaponEditorModalProps) {
  const [weapon, setWeapon] = useState<Weapon>(initial ?? blankWeapon());
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [library, setLibrary] = useState<LibraryWeapon[]>([]);
  const [libraryError, setLibraryError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('weapons')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLibraryError(`Failed to load weapon library: ${error.message}`);
          return;
        }
        setLibrary((data ?? []).map(mapWeaponRow));
      });
    return () => { cancelled = true; };
  }, []);

  const handleSave = () => {
    const err = validateWeapon(weapon);
    if (err) { setError(err); return; }
    onSave(normalize(weapon));
  };

  const suggestions = library.filter(w => w.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-[800px] max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col">
        <h2 className="text-xl font-bold mb-4 text-white">{title}</h2>
        <div className="flex flex-1 overflow-hidden gap-6">
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            <WeaponFields value={weapon} onChange={setWeapon} error={error} />
            <div className="flex justify-end gap-2 pt-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={handleSave}
              >
                {initial ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
          <div className="w-1/2 border-l border-gray-700 pl-4 flex flex-col">
            <label className="block text-sm text-gray-300 mb-2">Weapon Library</label>
            <input
              type="text"
              placeholder="Search weapons..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400 mb-2"
            />
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {libraryError ? (
                <div className="text-sm text-red-400 text-center py-4">{libraryError}</div>
              ) : suggestions.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-4">No weapons in library.</div>
              ) : (
                suggestions.map((lib) => (
                  <button
                    key={lib.id}
                    onClick={() => { setWeapon(mapWeaponRow(lib)); setError(''); }}
                    className="w-full text-left px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 transition text-sm flex items-center justify-between"
                  >
                    <span className="truncate">{lib.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{lib.damageDice}</span>
                  </button>
                ))
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">Click a weapon to populate the form, then modify as needed.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
