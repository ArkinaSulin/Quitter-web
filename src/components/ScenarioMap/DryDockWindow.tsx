'use client';

// Dry-dock refit/repair window for a persistent player ship. One participant
// holds the editor lease at a time; Save updates the working ship, writes a
// version and restores full HP.

import { useEffect, useMemo, useState } from 'react';
import type { PlayerShip, PlayerShipVersion } from '@/packages/ships';
import { alphaLabel } from '@/packages/units';
import { DraggablePanel } from '@/components/shared/DraggablePanel';

export interface DryDockParticipant {
  userId: string;
  name: string;
}

export interface DryDockSaveArgs {
  name: string;
  missingHp: number;
  repairCost: number;
}

export function DryDockWindow({
  playerShip,
  versions,
  participants,
  currentUserId,
  isGM,
  missingHp,
  onClose,
  onAcquire,
  onHeartbeat,
  onReleaseEditor,
  onSave,
}: {
  playerShip: PlayerShip;
  versions: PlayerShipVersion[];
  participants: DryDockParticipant[];
  currentUserId: string | null;
  isGM: boolean;
  missingHp: number;
  onClose: () => void;
  onAcquire: () => Promise<void>;
  onHeartbeat: () => Promise<void>;
  onReleaseEditor: (force: boolean) => Promise<void>;
  onSave: (args: DryDockSaveArgs) => Promise<boolean>;
}) {
  const [name, setName] = useState(playerShip.name);
  const [saving, setSaving] = useState(false);
  const editorId = playerShip.editorUserId;
  const isEditor = !!currentUserId && editorId === currentUserId;
  const editorName = useMemo(
    () => participants.find(p => p.userId === editorId)?.name || (editorId ? 'Unknown player' : ''),
    [participants, editorId],
  );
  const repairCost = Math.max(0, missingHp) * 100;

  useEffect(() => {
    setName(playerShip.name);
  }, [playerShip.id, playerShip.name]);

  useEffect(() => {
    if (!isEditor) return;
    const timer = setInterval(() => { void onHeartbeat(); }, 5000);
    return () => clearInterval(timer);
  }, [isEditor, onHeartbeat]);

  const save = async () => {
    if (!isEditor || saving) return;
    setSaving(true);
    try {
      await onSave({ name, missingHp, repairCost });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DraggablePanel
      title={`Dry dock — ${playerShip.name} ${alphaLabel(playerShip.serialNumber)}`}
      subtitle={`Persistent player ship · HP ${playerShip.shipHp}/${playerShip.shipHpMax}`}
      onClose={() => { if (isGM) onClose(); }}
      className="w-[520px] max-w-[94vw]"
      resizable
      persistKey="quitter.dryDock.size"
      minWidth={480}
      minHeight={360}
    >
      <div className="space-y-3 p-3 text-xs">
        <div className="rounded border border-gray-700 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Editor</div>
          <div className="flex flex-wrap gap-1">
            {participants.map(participant => {
              const active = participant.userId === editorId;
              const disabled = !!editorId && !active;
              return (
                <button
                  key={participant.userId}
                  type="button"
                  disabled={disabled || participant.userId !== currentUserId}
                  onClick={() => { void onAcquire(); }}
                  className={`rounded border px-2 py-0.5 text-[10px] ${
                    active
                      ? 'border-amber-400 bg-amber-700/40 text-amber-100'
                      : disabled
                        ? 'border-gray-700 text-gray-600'
                        : 'border-gray-600 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {participant.name}
                </button>
              );
            })}
            {isGM && editorId && (
              <button
                type="button"
                onClick={() => { void onReleaseEditor(true); }}
                className="rounded border border-red-700 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/40"
              >
                Force release
              </button>
            )}
          </div>
          <div className="mt-1 text-[10px] text-gray-500">
            {editorId ? `${editorName} is editing.` : 'Select your name to take the editor.'}
          </div>
        </div>

        <div className="space-y-2 rounded border border-gray-700 p-2">
          <label className="block text-gray-400">
            Ship name
            <input
              type="text"
              value={name}
              disabled={!isEditor}
              onChange={e => setName(e.target.value)}
              className="mt-0.5 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-white disabled:opacity-50"
            />
          </label>
          <div className="flex justify-between"><span className="text-gray-400">Serial</span><span>{alphaLabel(playerShip.serialNumber)}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Missing HP</span><span>{missingHp}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Repair cost (display only)</span><span className="text-amber-300">{repairCost.toLocaleString()} gp</span></div>
          <p className="text-[10px] text-gray-500">
            Saving restores full HP, refreshes the design from Archfar's Shipyard and creates an immutable version snapshot.
          </p>
          <button
            type="button"
            disabled={!isEditor || saving}
            onClick={() => { void save(); }}
            className="w-full rounded border border-amber-600 bg-amber-700/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-700/50 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Ship'}
          </button>
        </div>

        <div className="rounded border border-gray-700 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Version history</div>
          {versions.length === 0 ? (
            <div className="text-[11px] text-gray-500">No saved versions yet.</div>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {versions.map(version => (
                <div key={version.id} className="flex items-center justify-between gap-2 rounded border border-gray-700 px-2 py-1 text-[10px]">
                  <span>v{version.versionNumber} — {version.name}</span>
                  <span className="text-gray-500">
                    HP {version.shipHp} · {new Date(version.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DraggablePanel>
  );
}
