// src/hooks/useScenarioCapabilities.ts
'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ScenarioRole, ScenarioRoleCapabilities } from '@/types/gameProtocol';
import { getRoleCapabilities, emptyCapabilities } from '@/lib/scenarioPermissions';

// Session cache: the scenario_role_capabilities matrix is read-only config and
// changes with a DB edit, not at runtime — safe to fetch once per session.
let capsCache: Record<string, ScenarioRoleCapabilities> | null = null;

async function loadCapabilitiesMatrix(): Promise<Record<string, ScenarioRoleCapabilities>> {
  if (capsCache) return capsCache;
  const { data } = await supabase.from('scenario_role_capabilities').select('*');
  capsCache = (data || []).reduce((acc: Record<string, ScenarioRoleCapabilities>, row: any) => {
    acc[row.role] = { ...emptyCapabilities(), ...row };
    return acc;
  }, {});
  return capsCache;
}

/**
 * Loads the scenario role → capability matrix (migration 030) and resolves a
 * participant role to its capability set (GM bypasses the matrix entirely).
 */
export function useScenarioCapabilities() {
  const [matrix, setMatrix] = useState<Record<string, ScenarioRoleCapabilities>>(capsCache ?? {});

  useEffect(() => {
    loadCapabilitiesMatrix().then(setMatrix).catch(() => {});
  }, []);

  const resolve = (role: ScenarioRole | null | undefined): ScenarioRoleCapabilities =>
    getRoleCapabilities(role, matrix);

  return { matrix, getRoleCapabilities: resolve };
}
