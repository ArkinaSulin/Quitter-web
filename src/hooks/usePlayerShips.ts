'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import {
  PlayerShip,
  PlayerShipVersion,
  mapPlayerShipRow,
  mapPlayerShipVersionRow,
  type ShipSnapshot,
} from '@/packages/ships';
import type { CargoManifestItem } from '@/types/ship';

export function usePlayerShips(scenarioId: string, ownerId: string | null) {
  const [ships, setShips] = useState<PlayerShip[]>([]);
  const [versions, setVersions] = useState<PlayerShipVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Two hooks can watch the same scenario (ScenarioMap + ShipSelector). Reuse
  // of the same Supabase channel name throws when the second `.on()` runs after
  // the first `.subscribe()`, so each hook instance gets its own channel id.
  const [channelId] = useState(() => crypto.randomUUID());

  const reload = useCallback(async () => {
    setLoading(true);
    const [shipsRes, versionsRes] = await Promise.all([
      supabase.from('player_ships').select('*').order('serial_number'),
      supabase.from('player_ship_versions').select('*').order('version_number', { ascending: false }),
    ]);
    if (shipsRes.error) {
      setError(shipsRes.error.message);
      setLoading(false);
      return;
    }
    if (versionsRes.error) {
      setError(versionsRes.error.message);
      setLoading(false);
      return;
    }
    setShips((shipsRes.data || []).map(mapPlayerShipRow));
    setVersions((versionsRes.data || []).map(mapPlayerShipVersionRow));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const channel = supabase
      .channel(`player_ships:${scenarioId}:${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_ships' }, () => {
        void reload();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [scenarioId, channelId, reload]);

  const createFromTemplate = useCallback(async (args: {
    templateId: string;
    templateName: string;
    shipHpMax: number;
  }): Promise<PlayerShip | null> => {
    const { data: serialData, error: serialError } = await supabase.rpc('next_scenario_serial', {
      p_scenario_id: scenarioId,
    });
    if (serialError) {
      setError(serialError.message);
      return null;
    }
    const serial = Number(serialData) || 0;
    const { data, error: insertError } = await supabase
      .from('player_ships')
      .insert({
        owner_id: ownerId,
        template_id: args.templateId,
        name: args.templateName || 'Ship',
        serial_number: serial,
        ship_hp: Math.max(1, args.shipHpMax),
        ship_hp_max: Math.max(1, args.shipHpMax),
        damage: {},
        crew_state: {},
        cargo: [],
      })
      .select('*')
      .single();
    if (insertError || !data) {
      setError(insertError?.message || 'Could not create player ship');
      return null;
    }
    const mapped = mapPlayerShipRow(data);
    setShips(prev => [...prev, mapped].sort((a, b) => a.serialNumber - b.serialNumber));
    return mapped;
  }, [scenarioId, ownerId]);

  const releaseIdle = useCallback(async () => {
    await supabase.rpc('release_idle_player_ships');
    await reload();
  }, [reload]);

  const acquireEditor = useCallback(async (shipId: string): Promise<boolean> => {
    const { data, error: rpcError } = await supabase.rpc('acquire_player_ship_editor', {
      p_ship_id: shipId,
    });
    if (rpcError) return false;
    await reload();
    return !!data;
  }, [reload]);

  const heartbeatEditor = useCallback(async (shipId: string) => {
    await supabase.rpc('heartbeat_player_ship_editor', { p_ship_id: shipId });
  }, []);

  const releaseEditor = useCallback(async (shipId: string, force = false) => {
    await supabase.rpc('release_player_ship_editor', {
      p_ship_id: shipId,
      p_force: force,
    });
    await reload();
  }, [reload]);

  /** Explicit Save: update runtime + append an immutable full version. */
  const saveShip = useCallback(async (args: {
    playerShip: PlayerShip;
    name: string;
    shipHp: number;
    shipHpMax: number;
    damage: Record<string, unknown>;
    crewState: Record<string, unknown>;
    cargo: CargoManifestItem[];
    snapshot: ShipSnapshot;
    sourceScenarioId: string;
  }): Promise<PlayerShipVersion | null> => {
    const name = args.name.trim() || args.playerShip.name;
    const versionNumber = Math.max(
      0,
      ...versions.filter(v => v.playerShipId === args.playerShip.id).map(v => v.versionNumber),
    ) + 1;

    const { error: updateError } = await supabase
      .from('player_ships')
      .update({
        name,
        ship_hp: args.shipHp,
        ship_hp_max: args.shipHpMax,
        damage: args.damage,
        crew_state: args.crewState,
        cargo: args.cargo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.playerShip.id);
    if (updateError) {
      setError(updateError.message);
      return null;
    }

    const { data, error: versionError } = await supabase
      .from('player_ship_versions')
      .insert({
        player_ship_id: args.playerShip.id,
        version_number: versionNumber,
        name,
        ship_hp: args.shipHp,
        damage: args.damage,
        crew_state: args.crewState,
        cargo: args.cargo,
        snapshot: args.snapshot,
        source_scenario_id: args.sourceScenarioId,
        created_by: ownerId,
      })
      .select('*')
      .single();
    if (versionError || !data) {
      setError(versionError?.message || 'Could not save ship version');
      return null;
    }
    const version = mapPlayerShipVersionRow(data);
    setVersions(prev => [version, ...prev]);
    await reload();
    return version;
  }, [ownerId, reload, versions]);

  return {
    ships,
    versions,
    loading,
    error,
    reload,
    createFromTemplate,
    releaseIdle,
    acquireEditor,
    heartbeatEditor,
    releaseEditor,
    saveShip,
  };
}
