'use client';

// Full-screen dry-dock refit. One participant holds the editor lease; everyone
// sees the window. The left column is the live refit cost summary, the middle and
// right columns are the normal Ship Editor builder with total mass locked.
//
// Three actions (rule 4):
//   Save refit          update the active campaign version in place
//   Save as new version commit a new version (asks for the name); sealed, so it
//                       cannot be undone
//   Cancel              close the window locally
//
// No invoice is stored: the cost is regenerated from the design difference. Crew
// and cargo changes are shown but never charged.

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CargoManifestItem,
  ShipCargoItem,
  ShipTemplate,
} from '@/types/ship';
import type {
  CampaignShip,
  ShipRuntime,
  ShipSnapshot,
} from '@/packages/ships';
import {
  buildShipFromTemplate,
  campaignBaseName,
  campaignDisplayName,
  campaignNextNumeral,
  campaignPreviousVersion,
  computeShipBuild,
  computeShipRefitInvoice,
  mapShipCargoRow,
  normalizeCargoManifest,
  romanNumeral,
  shipHullDestroyed,
} from '@/packages/ships';
import { alphaLabel } from '@/packages/units';
import { supabase } from '@/packages/infra/supabase';
import { fetchShipCatalogs, type ShipCatalogs } from '@/hooks/useShipTemplates';
import ShipEditor, { type ShipEditorPanelContext } from '@/components/ShipEditor/ShipEditor';
import { DraggablePanel } from '@/components/shared/DraggablePanel';
import { DryDockInvoice } from './DryDockInvoice';

export interface DryDockParticipant {
  userId: string;
  name: string;
}

export interface DryDockSaveArgs {
  name: string;
  template: ShipTemplate;
  snapshot: ShipSnapshot;
  cargo: CargoManifestItem[];
}

export interface DryDockForkArgs extends DryDockSaveArgs {
  /** True when the name changed: the server starts a fresh numeral at 1. */
  resetNumeral: boolean;
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function DryDockWindow({
  ship,
  campaign,
  versions,
  participants,
  currentUserId,
  isGM,
  onEndSession,
  initial,
  initialSize,
  onAcquire,
  onHeartbeat,
  onReleaseEditor,
  onSave,
  onSaveAsNewVersion,
}: {
  ship: ShipRuntime;
  campaign: CampaignShip;
  versions: CampaignShip[];
  participants: DryDockParticipant[];
  currentUserId: string | null;
  isGM: boolean;
  /** DM-only: end the shared session for everyone (the window has no local hide). */
  onEndSession: () => void;
  /** Initial window position (defaults to a safe inset). */
  initial?: { x: number; y: number };
  /** Preferred initial window size when there is no stored one. */
  initialSize?: { w: number; h: number };
  onAcquire: () => Promise<void>;
  onHeartbeat: () => Promise<void>;
  onReleaseEditor: (force: boolean) => Promise<void>;
  onSave: (args: DryDockSaveArgs) => Promise<boolean>;
  onSaveAsNewVersion: (args: DryDockForkArgs) => Promise<boolean>;
}) {
  const [catalogs, setCatalogs] = useState<ShipCatalogs | null>(null);
  const [cargoCatalog, setCargoCatalog] = useState<ShipCargoItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [forkDraft, setForkDraft] = useState<{ args: DryDockSaveArgs; defaultName: string } | null>(null);
  const [forkName, setForkName] = useState('');
  const [forkError, setForkError] = useState<string | null>(null);
  const [viewVersionId, setViewVersionId] = useState<string>(campaign.id);
  const [editorDirty, setEditorDirty] = useState(false);
  const savingRef = useRef(false);

  const editorId = campaign.editorUserId;
  const isEditor = !!currentUserId && editorId === currentUserId;
  const editorName = useMemo(
    () => participants.find(p => p.userId === editorId)?.name || (editorId ? 'Unknown player' : ''),
    [participants, editorId],
  );

  const before = ship.snapshot;
  const beforeTemplate = before?.template ?? null;
  const beforeBuild = before?.build ?? null;
  const beforeStats = before?.stats ?? null;
  const minHpAttained = ship.minHpAttained ?? ship.shipHp;

  const orderedVersions = useMemo(() => {
    const list = [...versions];
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return list;
  }, [versions]);
  const viewIndex = Math.max(0, orderedVersions.findIndex(v => v.id === viewVersionId));
  const viewVersion = orderedVersions[viewIndex] ?? campaign;
  const previewMode = viewVersion.id !== campaign.id;
  const previousVersion = useMemo(
    () => campaignPreviousVersion(viewVersion, versions),
    [viewVersion, versions],
  );

  useEffect(() => {
    if (!orderedVersions.some(v => v.id === viewVersionId)) setViewVersionId(campaign.id);
  }, [orderedVersions, viewVersionId, campaign.id]);

  // A new current version (e.g. after a fork) becomes the viewed version.
  useEffect(() => {
    setViewVersionId(campaign.id);
    setEditorDirty(false);
  }, [campaign.id]);

  /** Switch the preview; leaving a dirty current version asks first. */
  const selectVersion = (id: string) => {
    if (id === viewVersionId) return;
    if (editorDirty && viewVersion.id === campaign.id) {
      if (!window.confirm('Discard unsaved refit changes?')) return;
    }
    setEditorDirty(false);
    setViewVersionId(id);
  };

  useEffect(() => {
    if (!isEditor) return;
    const timer = setInterval(() => { void onHeartbeat(); }, 5000);
    return () => clearInterval(timer);
  }, [isEditor, onHeartbeat]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchShipCatalogs();
        if (!cancelled) setCatalogs(next);
      } catch (err) {
        if (!cancelled) setCatalogError(errorText(err));
      }
      try {
        const { data, error } = await supabase.from('ship_cargo').select('*').order('name');
        if (error) throw error;
        if (!cancelled) setCargoCatalog((data || []).map(mapShipCargoRow));
      } catch (err) {
        console.warn('ship_cargo is unavailable:', errorText(err));
        if (!cancelled) setCargoCatalog([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Cost summary: labour + equipment only (crew and cargo are never charged). */
  /** Labour + equipment only; crew and cargo are never charged. */
  const summarize = (invoice: ReturnType<typeof computeShipRefitInvoice>) => {
    const lines = invoice.lines.filter(line => line.kind !== 'crew' && line.kind !== 'cargo');
    return {
      ...invoice,
      lines,
      total: Math.round(lines.reduce((sum, line) => sum + line.subtotal, 0)),
    };
  };

  const refitSummary = (template: ShipTemplate) => {
    if (!beforeTemplate || !catalogs) return null;
    const invoice = computeShipRefitInvoice({
      before: beforeTemplate,
      after: template,
      armors: catalogs.armors,
      components: catalogs.components,
      weapons: catalogs.weapons,
      cargoCatalog,
      repair: {
        currentHp: ship.shipHp,
        minHp: minHpAttained,
        maxHp: ship.shipHpMax,
      },
    });
    return summarize(invoice);
  };

  /** Cost/diff between a viewed version and the version it was derived from. */
  const versionDiff = (previous: CampaignShip | null) => {
    if (!previous?.snapshot || !viewVersion.snapshot || !catalogs) return null;
    const invoice = computeShipRefitInvoice({
      before: previous.snapshot.template,
      after: viewVersion.snapshot.template,
      armors: catalogs.armors,
      components: catalogs.components,
      weapons: catalogs.weapons,
      cargoCatalog,
      repair: {
        currentHp: previous.shipHp,
        minHp: previous.minHpAttained,
        maxHp: previous.shipHpMax,
      },
    });
    return summarize(invoice);
  };

  const buildRefit = (template: ShipTemplate): DryDockSaveArgs => {
    if (!before || !beforeTemplate || !beforeBuild || !beforeStats || !catalogs) {
      throw new Error('The dry dock has not finished loading the ship catalogs.');
    }
    if (shipHullDestroyed(before, ship.boxState)) {
      throw new Error('The hull is destroyed; this ship cannot be repaired or refitted.');
    }
    if (template.totalMass !== beforeTemplate.totalMass) {
      throw new Error('Total ship mass is fixed in dry dock.');
    }
    const cargo = normalizeCargoManifest(template.manifest);
    const templateWithCargo: ShipTemplate = { ...template, manifest: cargo };
    const build = buildShipFromTemplate(
      templateWithCargo,
      catalogs.armors,
      catalogs.components,
      catalogs.weapons,
    );
    if (!build) throw new Error('The refitted ship could not be built.');
    const stats = computeShipBuild(build);
    if (stats.overload) {
      throw new Error(`The refit exceeds the fixed ${template.totalMass}t mass by ${Math.abs(stats.remainingMass)}t.`);
    }
    if (stats.weaponPlacedTons > stats.weaponCapacity) {
      throw new Error('Placed weapons exceed the allocated weapon capacity.');
    }
    return {
      name: template.name.trim() || campaign.name,
      template: templateWithCargo,
      snapshot: { template: templateWithCargo, build, stats },
      cargo,
    };
  };

  const runSave = async (args: DryDockSaveArgs, save: (a: DryDockSaveArgs) => Promise<boolean>) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      return await save(args);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveRefit = async (template: ShipTemplate): Promise<boolean> => {
    try {
      return await runSave(buildRefit(template), onSave);
    } catch (err) {
      throw err;
    }
  };

  const forkRefit = async (template: ShipTemplate): Promise<boolean> => {
    try {
      const args = buildRefit(template);
      const defaultName = campaign.name;
      setForkDraft({ args, defaultName });
      setForkName(defaultName);
      setForkError(null);
      return true;
    } catch (err) {
      throw err;
    }
  };

  const confirmFork = async () => {
    if (!forkDraft) return;
    const name = forkName.trim() || forkDraft.defaultName;
    // A renamed version starts a fresh base name, so the server stores numeral 1.
    const resetNumeral = name !== campaign.name;
    setForkError(null);
    try {
      const ok = await runSave(
        { ...forkDraft.args, name },
        args => onSaveAsNewVersion({ ...args, resetNumeral }),
      );
      if (ok) setForkDraft(null);
    } catch (err) {
      setForkError(errorText(err));
    }
  };

  const renderVersionNavigator = () => (
    <div className="shrink-0 rounded border border-gray-700 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">
          Versions{previewMode ? ' · preview' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={viewIndex <= 0}
            onClick={() => selectVersion(orderedVersions[viewIndex - 1].id)}
            className="rounded border border-gray-600 px-1.5 text-[10px] text-gray-300 disabled:text-gray-600"
          >
            ‹
          </button>
          <span className="text-[10px] text-gray-500">
            {viewIndex + 1}/{orderedVersions.length || 1}
          </span>
          <button
            type="button"
            disabled={viewIndex >= orderedVersions.length - 1}
            onClick={() => selectVersion(orderedVersions[viewIndex + 1].id)}
            className="rounded border border-gray-600 px-1.5 text-[10px] text-gray-300 disabled:text-gray-600"
          >
            ›
          </button>
        </div>
      </div>
      <select
        value={viewVersion.id}
        onChange={e => selectVersion(e.target.value)}
        className="w-full rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-[10px] text-gray-200"
      >
        {orderedVersions.map(version => (
          <option key={version.id} value={version.id}>
            {campaignDisplayName(version)}
          </option>
        ))}
      </select>
      <div className="mt-1 grid grid-cols-2 gap-x-2 text-[10px] text-gray-400">
        <span>HP</span>
        <span className="text-right tabular-nums">{viewVersion.shipHp}/{viewVersion.shipHpMax}</span>
        <span>Scenario</span>
        <span className="truncate text-right">{viewVersion.scenarioLabel || '—'}</span>
        <span>Status</span>
        <span className="text-right">{previewMode ? 'read-only' : 'current'}</span>
      </div>
    </div>
  );

  /** Read-only preview of a historical version, with a diff from its parent. */
  const renderPreviewPanel = () => {
    const diff = versionDiff(previousVersion);
    const snapshot = viewVersion.snapshot;
    const used = snapshot?.stats?.usedMass ?? 0;
    const previousUsed = previousVersion?.snapshot?.stats?.usedMass ?? 0;
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="shrink-0 rounded border border-sky-700/60 bg-sky-950/20 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-sky-100">
                {campaignDisplayName(viewVersion)}
              </div>
              <div className="text-[10px] text-sky-200/80">
                Read-only preview · HP {viewVersion.shipHp}/{viewVersion.shipHpMax} · worst {viewVersion.minHpAttained}
              </div>
            </div>
            <span className="shrink-0 rounded border border-sky-600 px-1.5 py-0.5 text-[10px] text-sky-200">
              read-only
            </span>
          </div>
          <div className="mt-1 text-[10px] text-gray-500">
            {viewVersion.createdAt ? new Date(viewVersion.createdAt).toLocaleString() : ''}
            {viewVersion.scenarioLabel ? ` · ${viewVersion.scenarioLabel}` : ''}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!snapshot ? (
            <div className="rounded border border-gray-700 bg-gray-900/60 p-2 text-[11px] text-gray-400">
              This version has no saved design to preview.
            </div>
          ) : !previousVersion ? (
            <div className="rounded border border-gray-700 bg-gray-900/60 p-2 text-[11px] text-gray-400">
              First version — no earlier version to compare.
            </div>
          ) : !previousVersion.snapshot ? (
            <div className="rounded border border-gray-700 bg-gray-900/60 p-2 text-[11px] text-gray-400">
              The previous version has no saved design to compare.
            </div>
          ) : diff ? (
            <>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
                Changes from {campaignDisplayName(previousVersion)}
              </div>
              <DryDockInvoice
                invoice={diff}
                beforeUsedMass={previousUsed}
                afterUsedMass={used}
                totalMass={snapshot.template.totalMass}
                currentHp={previousVersion.shipHp}
                maxHp={previousVersion.shipHpMax}
                minHp={previousVersion.minHpAttained}
              />
              <div className="mt-2 rounded border border-gray-700 bg-gray-900/60 p-2 text-[10px] text-gray-400">
                Crew and cargo changes are not charged.
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-500">Loading comparison…</div>
          )}
        </div>

        {renderVersionNavigator()}
        {catalogError && (
          <div className="rounded border border-red-700 bg-red-950/30 p-2 text-[10px] text-red-200">
            {catalogError}
          </div>
        )}
      </div>
    );
  };

  const renderLeftPanel = (context: ShipEditorPanelContext) => {
    if (previewMode) return renderPreviewPanel();
    const invoice = refitSummary(context.template);
    if (!invoice) return <div className="text-sm text-gray-500">Loading refit cost…</div>;
    const afterBuild = buildShipFromTemplate(
      context.template,
      catalogs?.armors ?? [],
      catalogs?.components ?? [],
      catalogs?.weapons ?? [],
    );
    const afterUsed = afterBuild ? computeShipBuild(afterBuild).usedMass : context.stats.usedMass;
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="shrink-0 rounded border border-amber-700/60 bg-amber-950/20 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-amber-100">
                {campaignBaseName(campaign)}
                {campaign.serialNumber > 0 ? ` ${alphaLabel(campaign.serialNumber)}` : ''}
              </div>
              <div className="text-[10px] text-amber-200/80">
                {campaignDisplayName(campaign)} · HP {ship.shipHp}/{ship.shipHpMax} · worst {minHpAttained}
              </div>
            </div>
            {!isGM && (
              <span className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400">
                The DM ends the dry dock
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {participants.map(participant => {
              const active = participant.userId === editorId;
              const disabled = !!editorId && !active;
              return (
                <button
                  key={participant.userId}
                  type="button"
                  disabled={disabled || participant.userId !== currentUserId}
                  onClick={() => { void onAcquire(); }}
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${
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
                className="rounded border border-red-700 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900/40"
              >
                Force release
              </button>
            )}
          </div>
          <div className="mt-1 text-[10px] text-gray-500">
            {editorId ? `${editorName} is editing.` : 'Take the editor to refit this ship.'}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <DryDockInvoice
            invoice={invoice}
            beforeUsedMass={beforeStats?.usedMass ?? 0}
            afterUsedMass={afterUsed}
            totalMass={context.template.totalMass}
            currentHp={ship.shipHp}
            maxHp={ship.shipHpMax}
            minHp={minHpAttained}
          />
          <div className="mt-2 rounded border border-gray-700 bg-gray-900/60 p-2 text-[10px] text-gray-400">
            Crew and cargo changes are not charged.
          </div>
        </div>

        {renderVersionNavigator()}
        {catalogError && (
          <div className="rounded border border-red-700 bg-red-950/30 p-2 text-[10px] text-red-200">
            {catalogError}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <DraggablePanel
        title={`Dry dock — ${campaignBaseName(campaign)}${campaign.serialNumber > 0 ? ` ${alphaLabel(campaign.serialNumber)}` : ''}`}
        subtitle={previewMode
          ? `Previewing ${campaignDisplayName(viewVersion)} · read-only · HP ${viewVersion.shipHp}/${viewVersion.shipHpMax}`
          : `${campaignDisplayName(campaign)} · ${editorId ? `${editorName} is editing` : 'no editor yet'} · HP ${ship.shipHp}/${ship.shipHpMax}`}
        onClose={isGM ? onEndSession : undefined}
        closeLabel="End dry dock"
        z={150}
        resizable
        persistKey="quitter.dryDock.size"
        initialSize={initialSize ?? { w: 1280, h: 820 }}
        initial={initial ?? { x: 32, y: 56 }}
        className="w-[1080px]"
        bodyClassName="overflow-hidden"
        minWidth={1080}
        minHeight={640}
      >
        <div className="flex h-full min-h-0 flex-col bg-[#0d0d1a]">
          {catalogs && (viewVersion.snapshot?.template ?? beforeTemplate) ? (
            <ShipEditor
              key={`${ship.id}:${viewVersion.id}`}
              mode="dryDock"
              previewMode={previewMode}
              readOnly={!isEditor || saving}
              onDirtyChange={setEditorDirty}
              initialTemplate={viewVersion.snapshot?.template ?? beforeTemplate}
              damageBoxState={viewVersion.damage}
              lockedFields={['totalMass']}
              renderLeftPanel={renderLeftPanel}
              onSaveOverride={saveRefit}
              onSaveAsNewVersionOverride={forkRefit}
              onCancelOverride={isGM ? onEndSession : undefined}
            />
          ) : catalogError ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-300">
              Dry dock could not load the ship catalogs: {catalogError}
            </div>
          ) : !beforeTemplate ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-300">
              This ship has no design snapshot to refit.
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              Loading dry dock…
            </div>
          )}
        </div>
      </DraggablePanel>

      {forkDraft && (
        <div className="fixed inset-0 z-[420] grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-amber-600 bg-gray-900 p-4 text-sm text-white shadow-xl">
            <div className="mb-1 font-semibold text-amber-200">Save as new version</div>
            <p className="mb-2 text-[11px] text-gray-300">
              This commits a new campaign version. The current version freezes and the map
              ship switches to the new one. A refit cannot be undone.
            </p>
            <label className="mb-3 block text-[11px] text-gray-400">
              Ship name
              <input
                value={forkName}
                onChange={e => setForkName(e.target.value)}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') void confirmFork(); }}
                className="mt-0.5 w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white"
              />
              <span className="mt-0.5 block text-[10px] text-gray-500">
                {forkName.trim() === campaign.name
                  ? `This version will be “${campaign.name} ${romanNumeral(campaignNextNumeral(campaign, versions))}”.`
                  : 'A new name starts a fresh family label with no numeral.'}
              </span>
            </label>
            {forkError && (
              <div className="mb-3 rounded border border-red-600 bg-red-950/50 px-2 py-1.5 text-[11px] text-red-200">
                {forkError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForkDraft(null)}
                className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => { void confirmFork(); }}
                className="rounded border border-amber-500 bg-amber-800/60 px-3 py-1 text-xs text-amber-100 hover:bg-amber-700/60 disabled:opacity-50"
              >
                Create version
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
