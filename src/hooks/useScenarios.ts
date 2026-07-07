// src/hooks/useScenarios.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, getCurrentUser } from '@/lib/supabaseClient';
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
  };
}

export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const presenceChannels = useRef<Map<string, any>>(new Map());
  const presenceCallbacks = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    getCurrentUser().then(({ data, error }) => {
      if (error) console.error('Auth error:', error);
      else setCurrentUser(data?.user || null);
    });
  }, []);

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

  // --- Moved BEFORE deleteScenario ---
  const unsubscribeFromPresence = useCallback((scenarioId: string) => {
    const channel = presenceChannels.current.get(scenarioId);
    if (channel) {
      console.log('[Presence] Unsubscribing from', scenarioId);
      channel.unsubscribe();
      presenceChannels.current.delete(scenarioId);
      presenceCallbacks.current.delete(scenarioId);
    }
  }, []);

  const deleteScenario = useCallback(async (scenarioId: string) => {
    if (!currentUser) throw new Error('Not logged in');
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    if (scenario.creatorId !== currentUser.id) {
      throw new Error('You are not the creator of this scenario');
    }

    // 1. Delete screenshot from storage if exists
    if (scenario.screenshotUrl) {
      const fileName = scenario.screenshotUrl.split('/').pop();
      if (fileName) {
        const { error: storageError } = await supabase
          .storage
          .from('scenario_screenshots')
          .remove([fileName]);
        if (storageError) {
          console.error('[deleteScenario] Failed to delete screenshot:', storageError);
        }
      }
    }

    // 2. Delete all units for this scenario (manual cleanup)
    console.log('[deleteScenario] Deleting units for scenario:', scenarioId);
    const { error: unitsError } = await supabase
      .from('units')
      .delete()
      .eq('scenario_id', scenarioId);
    if (unitsError) {
      console.error('[deleteScenario] Failed to delete units:', unitsError);
    }

    // 3. Delete participants for this scenario (manual cleanup)
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
  }, [currentUser, scenarios, fetchScenarios, unsubscribeFromPresence]);

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
    if (existing) return scenario;

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

  const updateScreenshot = useCallback(async (scenarioId: string, fileUrl: string) => {
    const { error } = await supabase
      .from('scenarios')
      .update({ screenshot_url: fileUrl, updated_at: new Date().toISOString() })
      .eq('id', scenarioId);
    if (error) console.error('Failed to update screenshot URL:', error);
    await fetchScenarios();
  }, [fetchScenarios]);

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

  return {
    scenarios,
    loading,
    error,
    currentUser,
    fetchScenarios,
    createScenario,
    deleteScenario,
    joinScenario,
    getMyRole,
    subscribeToPresence,
    unsubscribeFromPresence,
    updateScreenshot,
  };
}