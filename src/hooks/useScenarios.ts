// src/hooks/useScenarios.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { Scenario } from '@/types/gameProtocol';

// DM liveness: the GM writes dm_heartbeat_at every DM_HEARTBEAT_INTERVAL_MS.
// A beat older than DM_HEARTBEAT_STALE_MS means the GM's heartbeat has stopped —
// lock immediately (do not wait for a reconnect grace). Reader polls run faster
// than the stale threshold so a stopped heartbeat is caught within ~2 polls.
export const DM_HEARTBEAT_INTERVAL_MS = 5000;
export const DM_HEARTBEAT_STALE_MS = 7000;
export const DM_HEARTBEAT_POLL_MS = 2000;

function mapScenario(row: any): Scenario {
  return {
    id: row.id,
    name: row.name,
    creatorId: row.creator_id,
    creatorName: row.creator_name || 'Unknown',
    passwordHash: row.password_hash,
    mapData: row.map_data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    screenshotUrl: row.screenshot_url || null,
    currentTurnAlliance: row.current_turn_alliance || null,
    turnNumber: row.turn_number || 0,
    roomOpen: row.room_open ?? true,
    deleteRequestedBy: row.delete_requested_by || null,
    deleteRequestedByName: row.delete_requested_by_name || null,
    deleteRequestedAt: row.delete_requested_at || null,
    deletionLocked: !!row.deletion_locked,
    dmHeartbeatAt: row.dm_heartbeat_at || null,
  };
}

export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user: currentUser } = useAuth();
  const [dmOnlineByScenario, setDmOnlineByScenario] = useState<Record<string, boolean>>({});
  // Scenario IDs the current user participates in (GM or player) — drives the
  // lobby's "My Scenarios" filter.
  const [myScenarioIds, setMyScenarioIds] = useState<string[]>([]);

  // Heartbeat-based "DM online" badge: poll dm_heartbeat_at for every scenario
  // (the GM writes it every DM_HEARTBEAT_INTERVAL_MS). A beat fresher than
  // DM_HEARTBEAT_STALE_MS = online. Replaces the unreliable presence-channel
  // watchers.
  const refreshDmOnline = useCallback(async () => {
    const { data } = await supabase
      .from('scenarios')
      .select('id, dm_heartbeat_at');
    if (!data) return;
    const now = Date.now();
    const next: Record<string, boolean> = {};
    for (const row of data) {
      const beat = row.dm_heartbeat_at ? new Date(row.dm_heartbeat_at).getTime() : null;
      next[row.id] = beat !== null && now - beat <= DM_HEARTBEAT_STALE_MS;
    }
    setDmOnlineByScenario(prev =>
      Object.keys(next).length !== Object.keys(prev).length || Object.keys(next).some(k => prev[k] !== next[k])
        ? next
        : prev,
    );
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    refreshDmOnline();
    const t = setInterval(refreshDmOnline, DM_HEARTBEAT_POLL_MS);
    return () => clearInterval(t);
  }, [currentUser, refreshDmOnline]);

  const fetchScenarios = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('scenarios')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setScenarios((data || []).map(mapScenario));
    } catch (err: any) {
      console.error('Fetch scenarios error:', err);
      setError(err.message || 'Failed to load scenarios');
    } finally {
      setLoading(false);
    }
  }, []);

  const createScenario = useCallback(async (name: string, password?: string) => {
    if (!currentUser) throw new Error('You must be logged in');
    const creatorName =
      currentUser.user_metadata?.full_name ||
      currentUser.user_metadata?.name ||
      currentUser.email ||
      'Unknown';
    const newScenario = {
      name: name.trim(),
      creator_id: currentUser.id,
      creator_name: creatorName,
      password_hash: password?.trim() || null,
      free_move: true,
    };
    const { data, error } = await supabase
      .from('scenarios')
      .insert(newScenario)
      .select()
      .single();
    if (error) throw error;
    if (data) {
      const { error: partError } = await supabase
        .from('scenario_participants')
        .insert({
          scenario_id: data.id,
          user_id: currentUser.id,
          role: 'GM',
        });
      if (partError) console.error('Failed to add creator as participant:', partError);
    }
    await fetchScenarios();
    return data ? mapScenario(data) : null;
  }, [currentUser, fetchScenarios]);

  const deleteScenario = useCallback(async (scenarioId: string) => {
    if (!currentUser) throw new Error('Not logged in');

    // Verify ownership by querying DB directly (avoids stale local scenarios list)
    const { data: scenario, error: fetchError } = await supabase
      .from('scenarios')
      .select('creator_id')
      .eq('id', scenarioId)
      .single();
    if (fetchError || !scenario) throw new Error('Scenario not found');
    if (scenario.creator_id !== currentUser.id) {
      throw new Error('You are not the creator of this scenario');
    }

    // 1. Delete screenshot using deterministic filename
    const fileName = `scenario_${scenarioId}.png`;
    const { error: storageError } = await supabase
      .storage
      .from('scenario_screenshots')
      .remove([fileName]);
    if (storageError) {
      // Log but don't throw – screenshot might not exist
      console.warn('[deleteScenario] Failed to delete screenshot:', storageError.message);
    }

    // 2. Delete all units for this scenario
    console.log('[deleteScenario] Deleting units for scenario:', scenarioId);
    const { error: unitsError } = await supabase
      .from('units')
      .delete()
      .eq('scenario_id', scenarioId);
    if (unitsError) {
      console.error('[deleteScenario] Failed to delete units:', unitsError);
    }

    // 3. Delete participants
    const { error: participantsError } = await supabase
      .from('scenario_participants')
      .delete()
      .eq('scenario_id', scenarioId);
    if (participantsError) {
      console.error('[deleteScenario] Failed to delete participants:', participantsError);
    }

    // 4. Delete the scenario itself
    const { error } = await supabase
      .from('scenarios')
      .delete()
      .eq('id', scenarioId);
    if (error) throw error;

    // 5. Refresh the list
    await fetchScenarios();
  }, [currentUser, fetchScenarios]);

  const joinScenario = useCallback(async (scenarioId: string, password?: string) => {
    if (!currentUser) throw new Error('Not logged in');
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    if (scenario.passwordHash && scenario.passwordHash !== password) {
      throw new Error('Invalid password');
    }

    // A scenario marked for deletion is closed to everyone except its creator
    // (who must review it and decide delete vs keep). This blocks new players
    // AND existing participants re-entering; the flag is separate from room_open,
    // so un-flagging needs no rollback.
    if (scenario.deleteRequestedBy && scenario.creatorId !== currentUser.id) {
      throw new Error('This scenario is closed for deletion and no longer accepts players.');
    }

    if (scenario.creatorId !== currentUser.id) {
      const isDMOnline = await checkDMOnline(scenarioId);
      if (!isDMOnline) {
        throw new Error('The Game Master is not online. Please try again later.');
      }
    }

    const { data: existing, error: checkError } = await supabase
      .from('scenario_participants')
      .select('id')
      .eq('scenario_id', scenarioId)
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (checkError) throw checkError;
    // Existing participants can always re-enter, even while the room is closed.
    if (existing) return scenario;

    if (!scenario.roomOpen) {
      throw new Error('This room is closed. Ask the Game Master to open it before you can join.');
    }

    const { count, error: countError } = await supabase
      .from('scenario_participants')
      .select('*', { count: 'exact', head: true })
      .eq('scenario_id', scenarioId);
    if (countError) throw countError;
    const role = count === 0 ? 'GM' : 'Player';
    const { error: insertError } = await supabase
      .from('scenario_participants')
      .insert({
        scenario_id: scenarioId,
        user_id: currentUser.id,
        role,
      });
    if (insertError) throw insertError;
    return scenario;
  }, [currentUser, scenarios]);

  const checkDMOnline = useCallback(async (scenarioId: string): Promise<boolean> => {
    // Heartbeat is ground truth (presence leases were unreliable): the GM writes
    // dm_heartbeat_at every DM_HEARTBEAT_INTERVAL_MS; a beat fresher than
    // DM_HEARTBEAT_STALE_MS means the DM is online. Null = no beat yet — treat as
    // online (the GM writes on entering the map).
    const { data } = await supabase
      .from('scenarios')
      .select('dm_heartbeat_at')
      .eq('id', scenarioId)
      .single();
    const beat = data?.dm_heartbeat_at ? new Date(data.dm_heartbeat_at).getTime() : null;
    return beat === null || Date.now() - beat <= DM_HEARTBEAT_STALE_MS;
  }, []);

  /**
   * Update screenshot for a scenario using deterministic filename.
   * The file is saved as `scenario_{scenarioId}.png` – overwriting any previous screenshot.
   */
  const updateScreenshot = useCallback(async (scenarioId: string, file: File) => {
    if (!currentUser) throw new Error('Not logged in');

    // Verify ownership by querying DB directly (avoids stale local scenarios list)
    const { data: scenario, error: fetchError } = await supabase
      .from('scenarios')
      .select('creator_id')
      .eq('id', scenarioId)
      .single();
    if (fetchError || !scenario) throw new Error('Scenario not found');
    if (scenario.creator_id !== currentUser.id) {
      throw new Error('Only the creator can update the screenshot');
    }

    // Use deterministic filename
    const fileName = `scenario_${scenarioId}.png`;
    const storageBucket = supabase.storage.from('scenario_screenshots');

    // Delete any existing screenshot first, then upload fresh
    // (explicit delete+insert is more reliable than upsert with RLS)
    const { error: deleteError } = await storageBucket.remove([fileName]);
    if (deleteError) {
      console.warn('[updateScreenshot] Could not delete existing screenshot:', deleteError.message);
    }

    const { error: uploadError } = await storageBucket.upload(fileName, file, {
      cacheControl: '3600',
    });
    if (uploadError) throw uploadError;

    // Get the public URL with cache-busting timestamp
    const { data: urlData } = supabase.storage
      .from('scenario_screenshots')
      .getPublicUrl(fileName);
    const cacheBustedUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Update the scenario record with the URL
    const { error: updateError } = await supabase
      .from('scenarios')
      .update({ screenshot_url: cacheBustedUrl, updated_at: new Date().toISOString() })
      .eq('id', scenarioId);
    if (updateError) throw updateError;

    // Refresh the local list
    await fetchScenarios();
  }, [currentUser, fetchScenarios]);

  const getMyRole = useCallback(async (scenarioId: string): Promise<string | null> => {
    if (!currentUser) return null;
    const { data, error } = await supabase
      .from('scenario_participants')
      .select('role')
      .eq('scenario_id', scenarioId)
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) {
      console.error('Error fetching role:', error);
      return null;
    }
    return data?.role || null;
  }, [currentUser]);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  // My Scenarios = scenario IDs where the current user has a participant row
  // (GM or player). Refreshes when the scenario list changes (create/join/delete).
  useEffect(() => {
    if (!currentUser) {
      setMyScenarioIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('scenario_participants')
          .select('scenario_id')
          .eq('user_id', currentUser.id);
        if (cancelled) return;
        setMyScenarioIds(Array.from(new Set((data || []).map((r: any) => r.scenario_id))));
      } catch (err) {
        console.error('[useScenarios] Failed to load my scenario ids:', err);
        if (!cancelled) setMyScenarioIds([]);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser, scenarios]);

  const fetchScenarioMapData = useCallback(async (scenarioId: string): Promise<any | null> => {
    const { data, error } = await supabase
      .from('scenarios')
      .select('map_data')
      .eq('id', scenarioId)
      .single();
    if (error) {
      console.error('Error fetching map data:', error);
      return null;
    }
    return data?.map_data || null;
  }, []);

  const updateScenarioMapData = useCallback(async (scenarioId: string, mapData: any): Promise<boolean> => {
    const { error } = await supabase
      .from('scenarios')
      .update({ map_data: mapData, updated_at: new Date().toISOString() })
      .eq('id', scenarioId);
    if (error) {
      console.error('Error updating map data:', error);
      return false;
    }
    return true;
  }, []);

  const updateScenarioField = useCallback(async (scenarioId: string, fields: Record<string, any>): Promise<boolean> => {
    const { error } = await supabase
      .from('scenarios')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', scenarioId);
    if (error) {
      console.error('Error updating scenario:', error);
      return false;
    }
    return true;
  }, []);

  const requestScenarioDeletion = useCallback(async (scenarioId: string): Promise<{ ok: boolean; error?: string }> => {
    const { data, error } = await supabase.rpc('request_scenario_deletion', { p_scenario_id: scenarioId });
    if (error) {
      console.error('[requestScenarioDeletion] Failed:', error);
      return { ok: false, error: error.message };
    }
    const ok = !!data;
    if (ok) await fetchScenarios();
    return { ok };
  }, [fetchScenarios]);

  const clearScenarioDeletionRequest = useCallback(async (scenarioId: string): Promise<{ ok: boolean; error?: string }> => {
    const { data, error } = await supabase.rpc('clear_scenario_deletion_request', { p_scenario_id: scenarioId });
    if (error) {
      console.error('[clearScenarioDeletionRequest] Failed:', error);
      return { ok: false, error: error.message };
    }
    const ok = !!data;
    if (ok) await fetchScenarios();
    return { ok };
  }, [fetchScenarios]);

  const deleteExpiredScenarios = useCallback(async (): Promise<number> => {
    const { data, error } = await supabase.rpc('delete_expired_scenarios');
    if (error) {
      console.error('[deleteExpiredScenarios] Failed:', error);
      return 0;
    }
    return data || 0;
  }, []);

  const setScenarioDeletionLock = useCallback(async (scenarioId: string, locked: boolean): Promise<{ ok: boolean; error?: string }> => {
    const { data, error } = await supabase.rpc('set_scenario_deletion_lock', { p_scenario_id: scenarioId, p_locked: locked });
    if (error) {
      console.error('[setScenarioDeletionLock] Failed:', error);
      return { ok: false, error: error.message };
    }
    const ok = !!data;
    if (ok) await fetchScenarios();
    return { ok };
  }, [fetchScenarios]);

  return {
    scenarios,
    loading,
    error,
    currentUser,
    dmOnlineByScenario,
    myScenarioIds,
    fetchScenarios,
    createScenario,
    deleteScenario,
    joinScenario,
    getMyRole,
    updateScreenshot,
    fetchScenarioMapData,
    updateScenarioMapData,
    updateScenarioField,
    requestScenarioDeletion,
    clearScenarioDeletionRequest,
    deleteExpiredScenarios,
    setScenarioDeletionLock,
  };
}