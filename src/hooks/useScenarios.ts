// src/hooks/useScenarios.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase, getCurrentUser } from '@/lib/supabaseClient';
import { Scenario, Participant } from '@/types/gameProtocol';

export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Get current user on mount
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
      setScenarios(data || []);
    } catch (err: any) {
      console.error('Fetch scenarios error:', err);
      setError(err.message || 'Failed to load scenarios');
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a new scenario
  const createScenario = useCallback(async (name: string, password?: string) => {
    if (!currentUser) {
      throw new Error('You must be logged in');
    }
    const creatorName = currentUser.user_metadata?.full_name || currentUser.email || 'Unknown';
    const newScenario = {
      name,
      creator_id: currentUser.id,
      creator_name: creatorName,
      password_hash: password || null, // plaintext for MVP
    };
    const { data, error } = await supabase
      .from('scenarios')
      .insert(newScenario)
      .select()
      .single();
    if (error) throw error;
    // Also add creator as GM participant
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
    // Refresh list
    await fetchScenarios();
    return data;
  }, [currentUser, fetchScenarios]);

  // Delete a scenario (only if creator)
  const deleteScenario = useCallback(async (scenarioId: string) => {
    if (!currentUser) throw new Error('Not logged in');
    // Check if current user is creator (optional, we can rely on RLS)
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    if (scenario.creatorId !== currentUser.id) {
      throw new Error('You are not the creator of this scenario');
    }
    const { error } = await supabase
      .from('scenarios')
      .delete()
      .eq('id', scenarioId);
    if (error) throw error;
    await fetchScenarios();
  }, [currentUser, scenarios, fetchScenarios]);

  // Join a scenario (add as participant)
  const joinScenario = useCallback(async (scenarioId: string, password?: string) => {
    if (!currentUser) throw new Error('Not logged in');
    // Check password if set
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    if (scenario.passwordHash && scenario.passwordHash !== password) {
      throw new Error('Invalid password');
    }
    // Check if already a participant
    const { data: existing, error: checkError } = await supabase
      .from('scenario_participants')
      .select('id')
      .eq('scenario_id', scenarioId)
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (checkError) throw checkError;
    if (existing) {
      // Already joined, just return
      return scenario;
    }
    // Determine role: if no participants yet, make this user GM, else Player
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

  // Get role for current user in a scenario
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

  // Load scenarios on mount
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
  };
}