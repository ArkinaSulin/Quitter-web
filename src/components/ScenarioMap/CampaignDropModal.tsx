'use client';

// Deployment popup for a campaign ship family. Version selection + Full/Latest
// state + "make this a new campaign ship" (rule 8). Choosing "no" places a
// scenario copy in `ship_spelljammer` only.

import { useMemo, useState } from 'react';
import {
  campaignDisplayName,
  campaignNextNumeral,
  romanNumeral,
  type CampaignShip,
} from '@/packages/ships';

export interface CampaignDropChoice {
  versionId: string;
  full: boolean;
  makeCampaign: boolean;
  name: string;
}

export function CampaignDropModal({
  root,
  versions,
  slotTakenFor,
  onPlace,
  onCancel,
}: {
  root: CampaignShip;
  versions: CampaignShip[];
  /** Whether this scenario already holds a leaf version under that parent. */
  slotTakenFor: (versionId: string) => boolean;
  onPlace: (choice: CampaignDropChoice) => void;
  onCancel: () => void;
}) {
  const ordered = useMemo(
    () => [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [versions],
  );
  const [versionId, setVersionId] = useState(root.id);
  const [full, setFull] = useState(true);
  const [makeCampaign, setMakeCampaign] = useState(false);

  const version = ordered.find(row => row.id === versionId) ?? root;
  const slotOccupied = slotTakenFor(version.id);
  const nextNumeral = campaignNextNumeral(version, versions);
  const defaultName = version.name;
  const [name, setName] = useState(defaultName);
  const [nameTouched, setNameTouched] = useState(false);

  const effectiveName = nameTouched ? name : defaultName;

  return (
    <div className="fixed inset-0 z-[260] grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-600 bg-gray-800 p-3 text-sm text-white shadow-xl">
        <div className="mb-1 font-semibold text-amber-200">Place Campaign Ship</div>
        <p className="mb-2 text-[11px] text-gray-400">
          Pick a version and the state it starts in. “Full” restores hull and crew
          to 100%. “Latest” keeps the version’s last recorded damage.
        </p>

        <label className="mb-2 block text-[11px] text-gray-400">
          Version
          <select
            value={versionId}
            onChange={e => { setVersionId(e.target.value); setNameTouched(false); }}
            className="mt-0.5 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-white"
          >
            {ordered.map(row => (
              <option key={row.id} value={row.id}>
                {campaignDisplayName(row)} · HP {row.shipHp}/{row.shipHpMax}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-2 grid grid-cols-2 gap-2">
          {(['full', 'latest'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setFull(mode === 'full')}
              className={`rounded border px-2 py-1.5 text-left text-xs ${
                (mode === 'full') === full
                  ? 'border-amber-400 bg-amber-800/40 text-amber-100'
                  : 'border-gray-600 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="font-semibold">{mode === 'full' ? 'Full' : 'Latest'}</div>
              <div className="text-[10px] text-gray-400">
                {mode === 'full'
                  ? '100% hull and crew'
                  : `HP ${version.shipHp}/${version.shipHpMax}, current crew`}
              </div>
            </button>
          ))}
        </div>

        <label className="mb-2 flex items-start gap-2 rounded border border-gray-700 p-2 text-[11px] text-gray-300">
          <input
            type="checkbox"
            checked={makeCampaign}
            onChange={e => { setMakeCampaign(e.target.checked); setNameTouched(false); }}
            className="mt-0.5"
          />
          <span>
            Make this a new campaign ship in this scenario.
            {slotOccupied && (
              <span className="mt-1 block text-red-300">
                This scenario already has a campaign version of that ship. Evolve it
                in dry dock first.
              </span>
            )}
          </span>
        </label>

        {makeCampaign && (
          <label className="mb-2 block text-[11px] text-gray-400">
            Ship name
            <input
              value={effectiveName}
              onChange={e => { setName(e.target.value); setNameTouched(true); }}
              className="mt-0.5 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-white"
            />
            <span className="mt-0.5 block text-[10px] text-gray-500">
              This version will be “{version.name} {romanNumeral(nextNumeral)}”.
            </span>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={makeCampaign && slotOccupied}
            onClick={() => onPlace({
              versionId,
              full,
              makeCampaign,
              name: effectiveName,
            })}
            className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-200 hover:bg-amber-700/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Place
          </button>
        </div>
      </div>
    </div>
  );
}
