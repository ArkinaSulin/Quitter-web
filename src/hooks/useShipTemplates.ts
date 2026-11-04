'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/packages/infra/supabase';
import {
  ShipBuild,
  ShipDerivedStats,
  buildShipFromTemplate,
  computeShipBuild,
  mapShipArmorRow,
  mapShipComponentRow,
  mapShipTemplateRow,
  mapShipWeaponRow,
} from '@/packages/ships';
import { ShipArmor, ShipComponent, ShipTemplate, ShipWeapon } from '@/types/ship';

export interface ShipLibraryEntry {
  template: ShipTemplate;
  build: ShipBuild | null;
  stats: ShipDerivedStats | null;
}

/**
 * Loads every ship template with its derived build/stats for the scenario Ship
 * Selector. Flat queries + a client-side join mirror the Ship Editor's fetch so
 * a PostgREST relationship-cache hiccup cannot blank the whole list.
 */
export async function fetchShipLibrary(): Promise<ShipLibraryEntry[]> {
  const [
    templatesRes,
    armorsRes,
    componentsRes,
    weaponsRes,
    templateComponentsRes,
    templateWeaponsRes,
  ] = await Promise.all([
    supabase.from('ship_templates').select('*').order('name'),
    supabase.from('ship_armors').select('*').order('id'),
    supabase.from('ship_components').select('*').order('id'),
    supabase.from('ship_weapons').select('*').order('id'),
    supabase.from('ship_template_components').select('*'),
    supabase.from('ship_template_weapons').select('*'),
  ]);
  if (templatesRes.error) throw templatesRes.error;
  if (armorsRes.error) throw armorsRes.error;
  if (componentsRes.error) throw componentsRes.error;
  if (weaponsRes.error) throw weaponsRes.error;
  if (templateComponentsRes.error) throw templateComponentsRes.error;
  if (templateWeaponsRes.error) throw templateWeaponsRes.error;

  const componentsByTemplate = new Map<string, any[]>();
  for (const row of templateComponentsRes.data || []) {
    const list = componentsByTemplate.get(row.template_id) || [];
    list.push(row);
    componentsByTemplate.set(row.template_id, list);
  }
  const weaponsByTemplate = new Map<string, any[]>();
  for (const row of templateWeaponsRes.data || []) {
    const list = weaponsByTemplate.get(row.template_id) || [];
    list.push(row);
    weaponsByTemplate.set(row.template_id, list);
  }

  const armors: ShipArmor[] = (armorsRes.data || []).map(mapShipArmorRow);
  const components: ShipComponent[] = (componentsRes.data || []).map(mapShipComponentRow);
  const weapons: ShipWeapon[] = (weaponsRes.data || []).map(mapShipWeaponRow);
  const templates = (templatesRes.data || []).map(row => mapShipTemplateRow({
    ...row,
    ship_template_components: componentsByTemplate.get(row.id) || [],
    ship_template_weapons: weaponsByTemplate.get(row.id) || [],
  }));

  return templates
    .map(template => {
      const build = buildShipFromTemplate(template, armors, components, weapons);
      return {
        template,
        build,
        stats: build ? computeShipBuild(build) : null,
      };
    })
    .sort((a, b) => a.template.name.localeCompare(b.template.name));
}

export function useShipTemplates() {
  const [ships, setShips] = useState<ShipLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setShips(await fetchShipLibrary());
    } catch (err: any) {
      console.error('Failed to load ships:', err);
      setError(err?.message || 'Failed to load ships');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ships, loading, error, reload };
}
