// src/components/ScenarioMap/UnitSelector.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { UnitTemplate, UnitType, Race } from '@/types/gameProtocol';
import { Team } from '@/components/TokenRenderer/tokenUtils';
import { mapTemplate } from '@/lib/templateMappers';

interface UnitSelectorProps {
  scenarioId: string;
  onUnitDragStart: (template: UnitTemplate) => void;
}

export function UnitSelector({ scenarioId, onUnitDragStart }: UnitSelectorProps) {
  const [templates, setTemplates] = useState<UnitTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('unit_templates')
        .select(`
          *,
          races(name, icon_url, base_hd, size_category, visual_scale, can_charge),
          unit_types(name, icon_url),
          armors(name),
          mounts(name)
        `)
        .order('unit_name');

      if (error) throw error;
      setTemplates((data || []).map(mapTemplate));
    } catch (err: any) {
      console.error('Failed to load templates:', err);
      setError(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filtered = templates.filter(t =>
    t.unitName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        Loading units...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-400 text-sm p-4">
        {error}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm p-4">
        No units found. Create some in the Unit Editor.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1.5 flex-shrink-0">
        <input
          type="text"
          placeholder="Search units..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {filtered.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-4">No units match</div>
        ) : (
          filtered.map((template) => (
            <div
              key={template.id}
              onMouseDown={(e) => { if (e.button === 0) onUnitDragStart(template); }}
              className="bg-gray-700 hover:bg-gray-600 rounded p-2 cursor-grab active:cursor-grabbing transition select-none border border-gray-600"
            >
              <div className="flex items-center gap-2">
                {(template.customImageUrl || template.raceIconUrl) && (
                  <img
                    src={template.customImageUrl || template.raceIconUrl}
                    alt={template.raceName || 'Race'}
                    className="w-6 h-6 rounded object-contain flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {template.unitName}
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-2">
                    <span>{template.raceName || 'No Race'}</span>
                    <span>•</span>
                    <span>{template.equipCostGp || 0}gp</span>
                    {template.isHero && (
                      <>
                        <span>•</span>
                        <span className="text-yellow-400">Star Hero</span>
                      </>
                    )}
                  </div>
                </div>
                {template.unitTypeIconUrl && (
                  <img
                    src={template.unitTypeIconUrl}
                    alt={template.modelTypeName || 'Type'}
                    className="w-6 h-6 rounded object-contain flex-shrink-0"
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}