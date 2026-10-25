'use client';

import { useCallback, useEffect, useState } from 'react';
import { UnitTemplate } from '@/types/gameProtocol';
import { supabase } from '@/packages/infra/supabase';
import { mapTemplate } from '@/packages/infra';

export async function fetchUnitTemplates(): Promise<UnitTemplate[]> {
  const { data, error } = await supabase
    .from('unit_templates')
    .select(`
      *,
      unit_races(name, icon_url, base_hd, size_category, visual_scale, can_charge),
      unit_types(name, icon_url),
      unit_armors(name),
      unit_mounts(name, can_charge)
    `)
    .order('unit_name');

  if (error) throw error;
  return (data || []).map(mapTemplate);
}

export function useUnitTemplates() {
  const [templates, setTemplates] = useState<UnitTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await fetchUnitTemplates());
    } catch (err: any) {
      console.error('Failed to load templates:', err);
      setError(err?.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { templates, loading, error, reload };
}
