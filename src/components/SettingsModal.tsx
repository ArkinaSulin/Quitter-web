// src/components/SettingsModal.tsx
'use client';

// Admin-only editor for the game-wide `admin_game_settings` table. Each value is
// edited as JSON text (validated + parsed on save); after saving the in-memory
// settings cache is invalidated and reloaded so running clients pick up new
// values. Rows are shown in logical groups with a friendly label + a hint
// (description + example) tooltip; unknown keys fall through to an "Other" group.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import { invalidateSettingsCache, loadSettings } from '@/packages/infra';

interface SettingsRow {
  key: string;
  value: unknown;
  description: string | null;
}

/** A labelled setting in a group; `hint` is the tooltip (description + example). */
interface SettingField {
  key: string;
  label: string;
  hint: string;
}

interface SettingGroup {
  title: string;
  fields: SettingField[];
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    title: 'Turn start & actions',
    fields: [
      { key: 'actions_per_turn', label: 'Unit actions per turn', hint: 'Actions a non-hero unit starts each turn with (default 2). 1 action = one full move pool.' },
      { key: 'turn_start_mp', label: 'Unit turn-start MP', hint: 'Materialised MP a non-hero unit starts each turn with (default 0). Units convert actions into full MP pools as they move. Heroes instead start at their full effective MP (this hex/formation max) — not covered by this value.' },
      { key: 'hero_actions_per_turn', label: 'Hero actions per turn', hint: 'Actions a hero starts each turn with (default 5). Each converted action grants maxMP / 5 MP; heroes also start with full effective MP.' },
    ],
  },
  {
    title: 'Combat',
    fields: [
      { key: 'unit_attack_cap', label: 'Unit attack cap', hint: 'Max attacks + retaliations a non-hero unit may make per turn (default 5). Soft: past the cap the game pauses for a confirm and logs a red message.' },
      { key: 'charge_full_distance', label: 'Full-charge distance', hint: 'Hexes a charge must travel to count as a FULL charge and grant the free double-damage attack (default 2). Shorter charges are premature (paid attack).' },
    ],
  },
  {
    title: 'Movement & turning',
    fields: [
      { key: 'formation_change_cost_per_step', label: 'Formation change cost', hint: "Fraction of the unit's current effective MP pool charged per formation change (default 0.5 = 50%). Never more than one action, never below 1 MP." },
      { key: 'about_turn_cost_foot', label: 'About-turn MP (foot)', hint: 'MP for a 180° about-turn by foot units (default 1). Free for Hero / Scattered / free-move.' },
      { key: 'about_turn_cost_mounted', label: 'About-turn MP (mounted)', hint: 'MP for a 180° about-turn by mounted units (default 2). Mounted Close Order cannot about-turn at all.' },
      { key: 'about_turn_org_penalty', label: 'About-turn org penalty', hint: 'Organization levels lost on a 180° about-turn (default 1).' },
      { key: 'map_pan_step', label: 'Map pan step (px)', hint: 'Screen pixels the map pans per WASD keypress (default 6).' },
    ],
  },
  {
    title: 'Heroes',
    fields: [
      { key: 'hero_attack_split', label: 'Front-hero attack split', hint: "Fraction of a strike's attacks directed at a front-attached (Leader) hero (default 0.3 = 30%). The rest hit the host unit. Rear attacks on a back-attached hero use this too." },
      { key: 'protected_hero_range_split', label: 'Protected-hero ranged split', hint: "Fraction of a RANGED strike's attacks directed at a back-attached (Protected) hero (default 0.1 = 10%). Frontal/flank melee can't reach it; rear melee uses hero_attack_split." },
      { key: 'mount_main_attack_split', label: 'Mounted-pair main-target split', hint: 'Fraction of a volley aimed at the chosen MAIN target of a mounted pair (rider vs mount) (default 0.7 = 70%); the other takes the remainder (30%).' },
      { key: 'unit_melee_hero_cap', label: 'Melee-vs-hero troop cap', hint: "Fraction of a unit's troops able to strike a LOCAL hero in MELEE, or to retaliate against a hero attacker (default 0.5 = 50%). Ranged attacks against heroes are uncapped." },
      { key: 'hero_attach_max_size', label: 'Max hero size can attach', hint: 'Largest size_category a hero may attach to (default 200 = Large).' },
      { key: 'heroic_capacity_multiplier', label: 'Heroic capacity bonus', hint: "Flat BONUS added to a unit's attack-capacity multiplier while a same-alliance hero is Leading (front-attached) or Inspired within 7 hexes (default 1). Example: 1 turns a ×1 formation into ×2 attack capacity (roughly double attacks). Heroes never gain it, and multiple heroes don't stack." },
    ],
  },
  {
    title: 'Threat & morale',
    fields: [
      { key: 'threat_increment_level', label: 'Threat by level (bands)', hint: 'Threat rating contributed by a unit level, as bands [{min,value}] evaluated highest-min first.' },
      { key: 'threat_increment_troop_count', label: 'Threat by troop count (bands)', hint: 'Threat rating contributed by the current troop count, as bands [{min,value}] evaluated highest-min first.' },
      { key: 'charging_threat_multiplier', label: 'Charging threat multiplier', hint: 'Threat-rating multiplier while a unit is charging (default 2).' },
      { key: 'wounds_morale_factor', label: 'Wounds morale factor', hint: "Morale penalty from wounds = −floor((1 − hp%) × factor) (default 10)." },
      { key: 'isolation_penalty', label: 'Isolation morale penalty', hint: 'Morale penalty when a unit is isolated (no friendly within range) (default 1).' },
    ],
  },
  {
    title: 'Formations & size',
    fields: [
      { key: 'row_capacity_by_size', label: 'Row capacity by size (bands)', hint: 'Fallback attack rows by size_category (the size_categories table takes precedence), as bands [{min,value}] highest-min first.' },
    ],
  },
];

const FIELD_BY_KEY = new Map<string, SettingField>();
for (const g of SETTING_GROUPS) for (const f of g.fields) FIELD_BY_KEY.set(f.key, f);

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
      .from('admin_game_settings')
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
          .from('admin_game_settings')
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

  const rowByKey = new Map(rows.map(r => [r.key, r]));

  const renderRow = (key: string, label: string, hint: string | null, keyIsLabel = false) => {
    const r = rowByKey.get(key);
    if (!r) return null;
    return (
      <div key={key} className="bg-gray-900/50 border border-gray-700 rounded p-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-yellow-300" title={hint ?? undefined}>
            {label}
            {hint && <span className="text-gray-500 ml-1 cursor-help" title={hint}>ⓘ</span>}
          </span>
          {!keyIsLabel && <span className="text-[10px] text-gray-500 font-mono">{key}</span>}
        </div>
        <input
          type="text"
          value={drafts[r.key] ?? ''}
          onChange={e => setDraft(r.key, e.target.value)}
          className="w-full mt-1 bg-gray-800 text-white text-sm font-mono rounded px-2 py-1 border border-gray-700 focus:border-amber-400"
          spellCheck={false}
        />
      </div>
    );
  };

  const groupedKeys = new Set(FIELD_BY_KEY.keys());
  const otherRows = rows.filter(r => !groupedKeys.has(r.key));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-[680px] border border-gray-700 max-h-[85vh] flex flex-col">
        <h2 className="text-xl font-bold mb-1 text-white">Game Settings</h2>
        <p className="text-xs text-gray-500 mb-4">Values are game-wide and applied immediately (JSON format). Hover a label for details.</p>

        {error && (
          <p className="text-red-400 text-sm bg-red-900/30 border border-red-700 rounded p-2 mb-3">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {SETTING_GROUPS.map(group => {
            const rowsInGroup = group.fields
              .map(f => [f, rowByKey.get(f.key)] as const)
              .filter(([, r]) => r);
            if (rowsInGroup.length === 0) return null;
            return (
              <section key={group.title}>
                <h3 className="text-[11px] uppercase tracking-wide text-gray-500 mb-1 border-b border-gray-700 pb-0.5">{group.title}</h3>
                <div className="space-y-2">
                  {group.fields.map(f => renderRow(f.key, f.label, f.hint))}
                </div>
              </section>
            );
          })}
          {otherRows.length > 0 && (
            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-gray-500 mb-1 border-b border-gray-700 pb-0.5">Other</h3>
              <div className="space-y-2">
                {otherRows.map(r => renderRow(r.key, r.key, r.description, true))}
              </div>
            </section>
          )}
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
