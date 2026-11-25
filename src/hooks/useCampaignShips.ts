'use client';

// Campaign ships (`ship_campaign`). Rows are versions; the family root carries
// the group name. Only scenario instances flagged as carrier mirror runtime
// back into these rows (database trigger), so the client only reads them and
// calls the version RPCs.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import {
  CampaignShip,
  mapCampaignShipRow,
  type ShipSnapshot,
} from '@/packages/ships';
import type { CargoManifestItem } from '@/types/ship';

export interface CampaignForkArgs {
  shipId: string;
  name: string;
  /** True when the user renamed the version: store base name with numeral 1. */
  resetNumeral: boolean;
  snapshot: ShipSnapshot;
  shipHp: number;
  shipHpMax: number;
  minHpAttained: number;
  boxState: Record<string, unknown>;
  crewState: Record<string, unknown>;
  cargo: CargoManifestItem[];
}

export function useCampaignShips(scenarioId: string, ownerId: string | null) {
  const [ships, setShips] = useState<CampaignShip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelId] = useState(() => crypto.randomUUID());

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('ship_campaign')
      .select('*')
      .order('created_at');
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    setShips((data || []).map(mapCampaignShipRow));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const channel = supabase
      .channel(`ship_campaign:${scenarioId}:${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ship_campaign' }, () => {
        void reload();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [scenarioId, channelId, reload]);

  /** DM converts a placed, unlinked ship into the root of a new family. */
  const declare = useCallback(async (shipId: string, name: string): Promise<string | null> => {
    const { data, error: rpcError } = await supabase.rpc('declare_campaign_ship', {
      p_ship_id: shipId,
      p_name: name,
    });
    if (rpcError) {
      setError(rpcError.message);
      return null;
    }
    await reload();
    return (data as string) ?? null;
  }, [reload]);

  /** Convert a scenario copy into its own version, parented to the copy source. */
  const convert = useCallback(async (shipId: string, name: string): Promise<string | null> => {
    const { data, error: rpcError } = await supabase.rpc('convert_instance_to_campaign', {
      p_ship_id: shipId,
      p_name: name,
    });
    if (rpcError) {
      setError(rpcError.message);
      return null;
    }
    await reload();
    return (data as string) ?? null;
  }, [reload]);

  const rename = useCallback(async (campaignId: string, name: string): Promise<boolean> => {
    const { error: rpcError } = await supabase.rpc('rename_campaign_ship', {
      p_campaign_id: campaignId,
      p_name: name,
    });
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    await reload();
    return true;
  }, [reload]);

  /** Committed refit fork; deliberately outside the undo log. */  const fork = useCallback(async (args: CampaignForkArgs): Promise<string | null> => {
    const { data, error: rpcError } = await supabase.rpc('fork_campaign_version', {
      p_ship_id: args.shipId,
      p_name: args.name,
      p_reset_numeral: args.resetNumeral,
      p_snapshot: args.snapshot,
      p_ship_hp: args.shipHp,
      p_ship_hp_max: args.shipHpMax,
      p_min_hp_attained: args.minHpAttained,
      p_box_state: args.boxState,
      p_crew_state: args.crewState,
      p_cargo: args.cargo,
    });
    if (rpcError) {
      setError(rpcError.message);
      throw new Error(rpcError.message);
    }
    await reload();
    return (data as string) ?? null;
  }, [reload]);

  const remove = useCallback(async (campaignId: string): Promise<boolean> => {
    const { error: rpcError } = await supabase.rpc('delete_campaign_ship', {
      p_campaign_id: campaignId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    await reload();
    return true;
  }, [reload]);

  /** Owner-only repair: renumber the family by creation order (1..N). */
  const renumberFamily = useCallback(async (campaignId: string): Promise<boolean> => {
    const { error: rpcError } = await supabase.rpc('renumber_campaign_family', {
      p_campaign_id: campaignId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    await reload();
    return true;
  }, [reload]);

  const acquireEditor = useCallback(async (campaignId: string): Promise<boolean> => {
    const { data, error: rpcError } = await supabase.rpc('acquire_campaign_ship_editor', {
      p_campaign_id: campaignId,
    });
    if (rpcError) return false;
    await reload();
    return !!data;
  }, [reload]);

  const heartbeatEditor = useCallback(async (campaignId: string) => {
    await supabase.rpc('heartbeat_campaign_ship_editor', { p_campaign_id: campaignId });
  }, []);

  const mine = useMemo(
    () => (ownerId ? ships.filter(ship => ship.ownerId === ownerId) : []),
    [ships, ownerId],
  );

  const releaseEditor = useCallback(async (campaignId: string, force = false) => {
    await supabase.rpc('release_campaign_ship_editor', {
      p_campaign_id: campaignId,
      p_force: force,
    });
    await reload();
  }, [reload]);

  return {
    ships,
    /** Rows owned by this user (the selector and manager use these). */
    mine,
    loading,
    error,
    reload,
    declare,
    convert,
    rename,
    fork,
    remove,
    renumberFamily,
    acquireEditor,
    heartbeatEditor,
    releaseEditor,
  };
}
