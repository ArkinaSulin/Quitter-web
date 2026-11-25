'use client';

// Campaign Ship Manager — every campaign version owned by the signed-in DM, with
// the derived status (rule 11):
//   active  used by a live scenario instance
//   frozen  not on a map, but it has a child
//   orphan  not on a map and has no child
// Leaf/orphan rows can be deleted; owners can rename the family root.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  campaignBaseName,
  campaignDisplayName,
  campaignFamilyLabel,
  campaignRootId,
  campaignRoots,
  campaignStatus,
  type CampaignShip,
  type CampaignShipStatus,
} from '@/packages/ships';
import { supabase } from '@/packages/infra/supabase';
import { useCampaignShips } from '@/hooks/useCampaignShips';

const STATUS_LABEL: Record<CampaignShipStatus, string> = {
  active: 'Active',
  frozen: 'Frozen',
  orphan: 'Orphaned',
};

const STATUS_CLASS: Record<CampaignShipStatus, string> = {
  active: 'border-green-600/60 bg-green-900/30 text-green-200',
  frozen: 'border-amber-600/60 bg-amber-900/30 text-amber-200',
  orphan: 'border-gray-600 bg-gray-800/60 text-gray-300',
};

export function CampaignShipManager({ ownerId }: { ownerId: string }) {
  const router = useRouter();
  const store = useCampaignShips('manager', ownerId);
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const loadLive = async () => {
    const { data } = await supabase
      .from('ship_spelljammer')
      .select('campaign_id')
      .eq('is_deleted', false)
      .not('campaign_id', 'is', null);
    setLiveIds(new Set((data || [])
      .map((row: { campaign_id: string | null }) => row.campaign_id)
      .filter((id): id is string => !!id)));
  };

  useEffect(() => {
    void loadLive();
    const channel = supabase
      .channel(`campaign-manager:${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ship_spelljammer' }, () => {
        void loadLive();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [ownerId]);

  const rows = store.mine;
  const roots = campaignRoots(rows);
  const byRoot = useMemo(() => {
    const map = new Map<string, CampaignShip[]>();
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const row of rows) {
      const rootId = campaignRootId(row, byId);
      const list = map.get(rootId) ?? [];
      list.push(row);
      map.set(rootId, list);
    }
    for (const list of Array.from(map.values())) {
      list.sort((a: CampaignShip, b: CampaignShip) => a.createdAt.localeCompare(b.createdAt));
    }
    return map;
  }, [rows]);

  const remove = async (row: CampaignShip) => {
    if (!confirm(`Delete campaign version "${campaignDisplayName(row)}"?`)) return;
    const ok = await store.remove(row.id);
    setError(ok ? null : 'Could not delete the campaign version.');
  };

  const saveRename = async () => {
    if (!renaming) return;
    const target = rows.find(row => row.id === renaming.id);
    const ok = await store.rename(renaming.id, renaming.name);
    if (!ok) { setError('Could not rename the campaign ship.'); return; }
    // Keep a live carrier's map label in step with the family rename.
    if (target) {
      await supabase
        .from('ship_spelljammer')
        .update({ name: campaignBaseName({ name: renaming.name, numeral: target.numeral }) })
        .eq('campaign_id', target.id)
        .eq('campaign_carrier', true)
        .eq('is_deleted', false);
    }
    setError(null);
    setRenaming(null);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0d0d1a] text-white">
      <header className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-amber-200">Campaign Ship Manager</h1>
          <p className="text-[11px] text-gray-400">
            Versions you declared. Names are display only; the version tree is the identity.
          </p>
        </div>
        <button
          onClick={() => router.push('/')}
          className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
        >
          Back to lobby
        </button>
      </header>

      {(error || store.error) && (
        <div className="border-b border-red-700 bg-red-950/40 px-4 py-2 text-xs text-red-200">
          {error || store.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {store.loading ? (
          <div className="text-sm text-gray-400">Loading campaign ships…</div>
        ) : roots.length === 0 ? (
          <div className="text-sm text-gray-400">
            No campaign ships yet. Convert a placed ship in a scenario to create one.
          </div>
        ) : (
          <div className="space-y-4">
            {roots.map(root => {
              const family = byRoot.get(root.id) ?? [root];
              return (
                <section key={root.id} className="rounded-lg border border-gray-700 bg-gray-900/40">
                  <div className="flex items-center justify-between gap-2 border-b border-gray-700 px-3 py-2">
                    <div className="min-w-0">
                      {renaming?.id === root.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={renaming.name}
                            onChange={e => setRenaming({ id: root.id, name: e.target.value })}
                            className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-white"
                            autoFocus
                          />
                          <button onClick={() => { void saveRename(); }} className="rounded border border-amber-600 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-900/40">
                            Save
                          </button>
                          <button onClick={() => setRenaming(null)} className="rounded border border-gray-600 px-2 py-0.5 text-[10px] text-gray-300 hover:bg-gray-700">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="truncate text-sm font-semibold text-amber-100">
                            {campaignFamilyLabel(root)}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            {family.length} version{family.length === 1 ? '' : 's'} · serial {root.serialNumber || '—'}
                          </div>
                        </>
                      )}
                    </div>
                    {!renaming && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => setRenaming({ id: root.id, name: root.name })}
                          className="rounded border border-gray-600 px-2 py-0.5 text-[10px] text-gray-300 hover:bg-gray-700"
                        >
                          Rename family
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(
                              `Renumber "${campaignFamilyLabel(root)}" by creation order (1..${family.length})? `
                              + 'This sets the numerals and refreshes the map names; branches are linearised.',
                            )) return;
                            const ok = await store.renumberFamily(root.id);
                            setError(ok ? null : 'Could not renumber the family.');
                          }}
                          title="Repair version numerals (creation order 1..N)"
                          className="rounded border border-amber-700 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-900/40"
                        >
                          Renumber
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="divide-y divide-gray-800">
                    {family.map(row => {
                      const status = campaignStatus(row, rows, liveIds);
                      return (
                        <div key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                          <span className="min-w-0 flex-1 truncate">{campaignDisplayName(row)}</span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[status]}`}>
                            {STATUS_LABEL[status]}
                          </span>
                          <span className="w-24 text-right tabular-nums text-gray-400">
                            HP {row.shipHp}/{row.shipHpMax}
                          </span>
                          <span className="w-32 truncate text-right text-gray-500">
                            {row.scenarioLabel || 'no scenario'}
                          </span>
                          <span className="w-32 truncate text-right text-gray-600">
                            {row.numeral > 1 ? `version ${row.numeral}` : 'first version'}
                          </span>
                          <button
                            onClick={() => { void remove(row); }}
                            disabled={status === 'active'}
                            title={
                              status === 'active'
                                ? 'This version is on a scenario map'
                                : 'Delete this version (a frozen version hands its children to its parent)'
                            }
                            className="rounded border border-red-700 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
