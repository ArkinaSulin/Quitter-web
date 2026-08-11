// src/hooks/useScenarios.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { Scenario } from '@/types/gameProtocol';

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
  };
}

export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user: currentUser } = useAuth();
  const presenceChannels = useRef<Map<string, any>>(new Map());
  const presenceCallbacks = useRef<Map<string, () => void>>(new Map());
  // Lobby watchers: one read-only presence channel per scenario, so the lobby can
  // show "(Room Open)" when that scenario's GM is actually present.
  const lobbyPresenceChannels = useRef<Map<string, any>>(new Map());
  const [dmOnlineByScenario, setDmOnlineByScenario] = useState<Record<string, boolean>>({});
  // Scenario IDs the current user participates in (GM or player) — drives the
  // lobby's "My Scenarios" filter.
  const [myScenarioIds, setMyScenarioIds] = useState<string[]>([]);

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

  const unsubscribeFromPresence = useCallback((scenarioId: string) => {
    const channel = presenceChannels.current.get(scenarioId);
    if (channel) {
      console.log('[Presence] Unsubscribing from', scenarioId);
      channel.unsubscribe();
      presenceChannels.current.delete(scenarioId);
      presenceCallbacks.current.delete(scenarioId);
    }
  }, []);

  // Lobby "Room Open" indicator: watch each scenario's presence channel read-only
  // and flip dmOnlineByScenario[scenarioId] when a GM enters/leaves.
  const subscribeToLobbyPresence = useCallback((scenarioId: string) => {
    if (lobbyPresenceChannels.current.has(scenarioId)) return;

    const channel = supabase.channel(`presence:${scenarioId}`, {
      config: { presence: { key: `lobby:${scenarioId}` } },
    });

    const refresh = () => {
      const state = channel.presenceState();
      let dmFound = false;
      for (const key in state) {
        const users = state[key] as any[];
        if (users.some((u: any) => u.role === 'GM')) {
          dmFound = true;
          break;
        }
      }
      setDmOnlineByScenario(prev =>
        prev[scenarioId] === dmFound ? prev : { ...prev, [scenarioId]: dmFound },
      );
    };

    channel.on('presence', { event: 'sync' }, refresh);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') refresh();
    });

    lobbyPresenceChannels.current.set(scenarioId, channel);
  }, []);

  const unsubscribeFromLobbyPresence = useCallback((scenarioId: string) => {
    const channel = lobbyPresenceChannels.current.get(scenarioId);
    if (channel) {
      channel.unsubscribe();
      lobbyPresenceChannels.current.delete(scenarioId);
    }
    setDmOnlineByScenario(prev => {
      const next = { ...prev };
      delete next[scenarioId];
      return next;
    });
  }, []);

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

    // 5. Clean up presence channel
    unsubscribeFromPresence(scenarioId);

    // 6. Refresh the list
    await fetchScenarios();
  }, [currentUser, fetchScenarios, unsubscribeFromPresence]);

  const joinScenario = useCallback(async (scenarioId: string, password?: string) => {
    if (!currentUser) throw new Error('Not logged in');
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    if (scenario.passwordHash && scenario.passwordHash !== password) {
      throw new Error('Invalid password');
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
    return new Promise((resolve) => {
      const channel = supabase.channel(`presence:${scenarioId}`, {
        config: { presence: { key: `${scenarioId}` } },
      });
      let resolved = false;

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        let dmFound = false;
        for (const key in state) {
          const users = state[key] as any[];
          if (users.some((u: any) => u.role === 'GM')) {
            dmFound = true;
            break;
          }
        }
        if (!resolved) {
          resolved = true;
          channel.unsubscribe();
          resolve(dmFound);
        }
      });

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setTimeout(() => {
            if (!resolved) {
              const state = channel.presenceState();
              let dmFound = false;
              for (const key in state) {
                const users = state[key] as any[];
                if (users.some((u: any) => u.role === 'GM')) {
                  dmFound = true;
                  break;
                }
              }
              resolved = true;
              channel.unsubscribe();
              resolve(dmFound);
            }
          }, 1000);
        } else if (status === 'CHANNEL_ERROR') {
          if (!resolved) {
            resolved = true;
            channel.unsubscribe();
            resolve(false);
          }
        }
      });
    });
  }, []);

  const subscribeToPresence = useCallback((scenarioId: string, onDMLeave: () => void) => {
    if (!currentUser) {
      console.log('[Presence] No current user, skipping');
      return null;
    }

    const existingChannel = presenceChannels.current.get(scenarioId);
    if (existingChannel) {
      console.log('[Presence] Channel already exists for', scenarioId, '- reusing');
      presenceCallbacks.current.set(scenarioId, onDMLeave);
      return existingChannel;
    }

    console.log('[Presence] Creating new channel for', scenarioId);
    const channel = supabase.channel(`presence:${scenarioId}`, {
      config: { presence: { key: `${scenarioId}` } },
    });

    presenceCallbacks.current.set(scenarioId, onDMLeave);

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      let dmPresent = false;
      for (const key in state) {
        const users = state[key] as any[];
        if (users.some((u: any) => u.role === 'GM')) {
          dmPresent = true;
          break;
        }
      }
      if (!dmPresent) {
        console.log('[Presence] DM left scenario:', scenarioId);
        const callback = presenceCallbacks.current.get(scenarioId);
        if (callback) {
          callback();
        }
      }
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const userRole = await getMyRole(scenarioId);
        const role = userRole || 'Player';
        console.log('[Presence] Tracking user as:', role);
        channel.track({ user_id: currentUser.id, role });
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[Presence] Channel error for', scenarioId);
      }
    });

    presenceChannels.current.set(scenarioId, channel);
    return channel;
  }, [currentUser]);

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
    subscribeToPresence,
    unsubscribeFromPresence,
    subscribeToLobbyPresence,
    unsubscribeFromLobbyPresence,
    updateScreenshot,
    fetchScenarioMapData,
    updateScenarioMapData,
    updateScenarioField,
  };
}