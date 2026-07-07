// src/hooks/useSupabaseSync.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Unit, Hex } from '@/types/gameProtocol';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// --- Converters ---
function mapRowToUnit(row: any): Unit {
  return {
    id: row.id,
    name: row.name,
    hex: { q: row.hex_q, r: row.hex_r, s: row.hex_s },
    facing: row.facing,
    team: row.team,
    hp: row.hp,
    maxHp: row.max_hp,
    isHero: row.is_hero,
    formation: row.formation,
    aggressiveness: row.aggressiveness || 3,
    baseMorale: row.base_morale || 3,
    currentMorale: row.current_morale || 3,
    baseAc: row.base_ac || 10,
    currentAc: row.current_ac || 10,
    isRouting: row.is_routing || false,
    weaponString: row.weapon_string || '',
  };
}

function mapUnitToRow(unit: Unit, scenarioId: string = 'default_mvp') {
  return {
    id: unit.id,
    scenario_id: scenarioId,
    name: unit.name,
    hex_q: unit.hex.q,
    hex_r: unit.hex.r,
    hex_s: unit.hex.s,
    facing: unit.facing,
    team: unit.team,
    hp: unit.hp,
    max_hp: unit.maxHp,
    is_hero: unit.isHero,
    formation: unit.formation,
    aggressiveness: unit.aggressiveness || 3,
    base_morale: unit.baseMorale || 3,
    current_morale: unit.currentMorale || 3,
    base_ac: unit.baseAc || 10,
    current_ac: unit.currentAc || 10,
    is_routing: unit.isRouting || false,
    weapon_string: unit.weaponString || '',
  };
}

// --- Singleton channel manager ---
const channelMap = new Map<string, any>();
const listenerMap = new Map<string, Array<(payload: any) => void>>();
const seededMap = new Map<string, boolean>(); // Track seeded status per scenario

function getOrCreateChannel(scenarioId: string) {
  if (!channelMap.has(scenarioId)) {
    console.log(`[Realtime] Creating singleton channel for ${scenarioId}`);
    const channel = supabase
      .channel(`units:${scenarioId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'units',
          filter: `scenario_id=eq.${scenarioId}`,
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const listeners = listenerMap.get(scenarioId) || [];
          for (const listener of listeners) {
            listener(payload);
          }
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Singleton channel ${scenarioId} status:`, status);
      });
    channelMap.set(scenarioId, channel);
  }
  return channelMap.get(scenarioId);
}

function addListener(scenarioId: string, callback: (payload: any) => void) {
  if (!listenerMap.has(scenarioId)) {
    listenerMap.set(scenarioId, []);
  }
  listenerMap.get(scenarioId)!.push(callback);
}

function removeListener(scenarioId: string, callback: (payload: any) => void) {
  const listeners = listenerMap.get(scenarioId);
  if (listeners) {
    const index = listeners.indexOf(callback);
    if (index !== -1) listeners.splice(index, 1);
  }
}

export function useSupabaseSync(scenarioId: string = 'default_mvp') {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const callbackRef = useRef<(payload: any) => void>();
  const seedingAttempted = useRef(false);

  // 1. Load units on mount
  useEffect(() => {
    let isMounted = true;

    const fetchUnits = async () => {
      try {
        const { data, error } = await supabase
          .from('units')
          .select('*')
          .eq('scenario_id', scenarioId);

        if (error) throw error;
        if (isMounted && data) {
          const mapped = data.map(mapRowToUnit);
          setUnits(mapped);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('[Supabase] Fetch error:', err);
        if (isMounted) setError(err.message || 'Failed to load units');
      }
    };

    fetchUnits();

    return () => { isMounted = false; };
  }, [scenarioId]);

  // 2. Singleton Realtime subscription
  useEffect(() => {
    getOrCreateChannel(scenarioId);

    const handleRealtime = (payload: RealtimePostgresChangesPayload<any>) => {
      console.log('[Realtime] Payload received:', payload);
      setUnits((prevUnits) => {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (eventType === 'INSERT' && newRow) {
          const newUnit = mapRowToUnit(newRow);
          if (prevUnits.some(u => u.id === newUnit.id)) {
            return prevUnits.map(u => u.id === newUnit.id ? newUnit : u);
          }
          return [...prevUnits, newUnit];
        }

        if (eventType === 'UPDATE' && newRow) {
          const updatedUnit = mapRowToUnit(newRow);
          return prevUnits.map(u => u.id === updatedUnit.id ? updatedUnit : u);
        }

        if (eventType === 'DELETE' && oldRow) {
          return prevUnits.filter(u => u.id !== oldRow.id);
        }

        return prevUnits;
      });
    };

    addListener(scenarioId, handleRealtime);
    callbackRef.current = handleRealtime;

    return () => {
      if (callbackRef.current) {
        removeListener(scenarioId, callbackRef.current);
      }
    };
  }, [scenarioId]);

  // 3. Move unit
  const moveUnit = useCallback(async (unitId: string, targetHex: Hex) => {
    console.log(`[moveUnit] Moving ${unitId} to (${targetHex.q}, ${targetHex.r})`);

    setUnits(prev =>
      prev.map(u =>
        u.id === unitId ? { ...u, hex: targetHex } : u
      )
    );

    const { error: updateError } = await supabase
      .from('units')
      .update({
        hex_q: targetHex.q,
        hex_r: targetHex.r,
        hex_s: targetHex.s,
        updated_at: new Date().toISOString(),
      })
      .eq('id', unitId)
      .eq('scenario_id', scenarioId);

    if (updateError) {
      console.error('[Supabase] Move failed, rolling back:', updateError);
      const { data } = await supabase
        .from('units')
        .select('*')
        .eq('id', unitId)
        .single();
      if (data) {
        const rolledBack = mapRowToUnit(data);
        setUnits(prev =>
          prev.map(u =>
            u.id === unitId ? rolledBack : u
          )
        );
      }
      setError(updateError.message);
      return false;
    }
    return true;
  }, [scenarioId]);

  // 4. Seed demo units
  const seedDemoUnits = useCallback(async () => {
    if (seededMap.get(scenarioId)) {
      console.log('[seedDemoUnits] Already seeded for scenario:', scenarioId);
      return;
    }

    if (seedingAttempted.current) {
      console.log('[seedDemoUnits] Seed already attempted for this hook instance');
      return;
    }

    seedingAttempted.current = true;

    console.log('[seedDemoUnits] Checking for existing units in scenario:', scenarioId);
    try {
      const { data: existingUnits, error } = await supabase
        .from('units')
        .select('id, name')
        .eq('scenario_id', scenarioId);

      if (error) {
        console.error('[seedDemoUnits] Check failed:', error);
        return;
      }

      const existingCount = existingUnits?.length || 0;
      console.log(`[seedDemoUnits] Found ${existingCount} units.`);

      const demoUnits = [
        {
          id: crypto.randomUUID(),
          name: 'Blue Knight',
          hex: { q: 0, r: 0, s: 0 },
          facing: 0,
          team: 'blue' as const,
          hp: 10,
          maxHp: 10,
          isHero: true,
          formation: 'Tight' as const,
          aggressiveness: 3,
          baseMorale: 3,
          currentMorale: 3,
          baseAc: 10,
          currentAc: 10,
          isRouting: false,
          weaponString: 'Longsword,single,1d8,1',
        },
        {
          id: crypto.randomUUID(),
          name: 'Yellow Archer',
          hex: { q: 3, r: -2, s: -1 },
          facing: 3,
          team: 'yellow' as const,
          hp: 6,
          maxHp: 6,
          isHero: false,
          formation: 'Loose' as const,
          aggressiveness: 3,
          baseMorale: 3,
          currentMorale: 3,
          baseAc: 10,
          currentAc: 10,
          isRouting: false,
          weaponString: 'Shortbow,single,1d6,6',
        },
        {
          id: crypto.randomUUID(),
          name: 'Violet Mage',
          hex: { q: -2, r: 4, s: -2 },
          facing: 2,
          team: 'violet' as const,
          hp: 8,
          maxHp: 8,
          isHero: true,
          formation: 'Scattered' as const,
          aggressiveness: 3,
          baseMorale: 3,
          currentMorale: 3,
          baseAc: 10,
          currentAc: 10,
          isRouting: false,
          weaponString: 'Fireball,area,6d6,4;Staff,single,1d6,1',
        },
      ];

      if (existingCount >= 3) {
        console.log('[seedDemoUnits] All 3 demo units found, skipping seed.');
        seededMap.set(scenarioId, true);
        return;
      }

      if (existingCount > 0 && existingCount < 3) {
        console.log(`[seedDemoUnits] Found ${existingCount} units but expected 3. Checking for missing ones...`);
        const existingNames = new Set(existingUnits?.map(u => u.name) || []);
        const missingUnits = demoUnits.filter(u => !existingNames.has(u.name));

        if (missingUnits.length === 0) {
          seededMap.set(scenarioId, true);
          return;
        }

        console.log(`[seedDemoUnits] Missing ${missingUnits.length} units:`, missingUnits.map(u => u.name));

        for (const unit of missingUnits) {
          const { error: insertError } = await supabase
            .from('units')
            .insert(mapUnitToRow(unit, scenarioId));
          if (insertError) {
            console.error('[seedDemoUnits] Insert failed for', unit.name, ':', insertError);
          } else {
            console.log('[seedDemoUnits] Inserted missing unit:', unit.name);
          }
        }

        seededMap.set(scenarioId, true);
        return;
      }

      console.log('[seedDemoUnits] No units found, inserting all 3 demo units...');
      for (const unit of demoUnits) {
        const { error: insertError } = await supabase
          .from('units')
          .insert(mapUnitToRow(unit, scenarioId));
        if (insertError) {
          console.error('[seedDemoUnits] Insert failed for', unit.name, ':', insertError);
        } else {
          console.log('[seedDemoUnits] Inserted unit:', unit.name);
        }
      }

      seededMap.set(scenarioId, true);
      console.log('[seedDemoUnits] Demo units insertion complete.');
    } catch (err) {
      console.error('[seedDemoUnits] Unexpected error:', err);
    }
  }, [scenarioId]);

  // 5. Clear units
  const clearUnits = useCallback(async () => {
    const { error } = await supabase
      .from('units')
      .delete()
      .eq('scenario_id', scenarioId);
    if (error) console.error('Clear units error:', error);
    seededMap.delete(scenarioId);
    seedingAttempted.current = false;
  }, [scenarioId]);

  return {
    units,
    setUnits,
    moveUnit,
    loading,
    error,
    seedDemoUnits,
    clearUnits,
  };
}