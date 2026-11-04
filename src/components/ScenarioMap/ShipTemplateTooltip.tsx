// src/components/ScenarioMap/ShipTemplateTooltip.tsx
'use client';

import React from 'react';
import { componentById, weaponById } from '@/packages/ships';
import { ShipLibraryEntry } from '@/hooks/useShipTemplates';
import { Floating } from './Floating';

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function ShipTemplateTooltip({
  entry,
  x,
  y,
}: {
  entry: ShipLibraryEntry;
  x: number;
  y: number;
}) {
  const { template, build, stats } = entry;
  const optional = (build?.templateComponents ?? []).map(row => {
    const component = componentById(build!.components, row.componentId);
    return `${component.name || humanize(row.componentId)}${row.count > 1 ? ` ×${row.count}` : ''}`;
  });
  const weapons = (build?.templateWeapons ?? []).map(row => {
    const weapon = weaponById(build!.weaponsCatalog, row.weaponId);
    return `${weapon?.name || 'Weapon'}${row.count > 1 ? ` ×${row.count}` : ''}`;
  });

  return (
    <Floating x={x} y={y} z={50} className="bg-black/90 border border-gray-600 rounded shadow-xl p-3 text-xs text-white max-w-[min(440px,calc(100vw-16px))]">
      <div className="font-bold mb-1">
        {template.name}
        {template.role && <span className="text-gray-400 font-normal"> — {template.role}</span>}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <span className="text-gray-400">Mass:</span><span>{template.totalMass}t</span>
        <span className="text-gray-400">Cost:</span><span className="text-yellow-400">{(stats?.buildCost ?? 0).toLocaleString()}gp</span>
        <span className="text-gray-400">AC:</span><span>{stats?.ac ?? '—'}</span>
        <span className="text-gray-400">HP:</span><span>{stats?.shipHp ?? '—'}</span>
        <span className="text-gray-400">Damage threshold:</span><span>{stats?.damageThreshold ?? template.damageThreshold}</span>
        <span className="text-gray-400">Crew min / full:</span><span>{stats ? `${stats.minCrew} / ${stats.fullCrew}` : '—'}</span>
        <span className="text-gray-400">Quarters:</span><span>{stats?.crewCapacity ?? 0}</span>
        <span className="text-gray-400">Cargo:</span><span>{template.cargoArea}t</span>
        <span className="text-gray-400">Atmo speed:</span><span>{template.atmosphericSpeed}</span>
        <span className="text-gray-400">Acceleration:</span><span>{stats?.accel ?? '—'}</span>
        <span className="text-gray-400">MC:</span><span>{stats ? stats.mcRaw : '—'}</span>
        <span className="text-gray-400">Armor:</span><span>{build ? humanize(build.armor.name) : '—'}</span>
      </div>

      <div className="mt-2 pt-2 border-t border-gray-700">
        <div className="text-gray-400 mb-0.5">Ship configuration</div>
        <div className="text-gray-300">
          Helm ×{template.helm}
          {template.commandBridge > 0 ? ` · Bridge ×${template.commandBridge}` : ''}
          {template.sails > 0 ? ` · Sails ×${template.sails}` : ''}
          {template.rudders > 0 ? ` · Rudders ×${template.rudders}` : ''}
          {template.reinforcement > 0 ? ` · Reinforcement ×${template.reinforcement}` : ''}
        </div>
        {weapons.length > 0 && (
          <div className="mt-0.5"><span className="text-gray-400">Weapons:</span> {weapons.join(', ')}</div>
        )}
        {optional.length > 0 && (
          <div className="mt-0.5"><span className="text-gray-400">Components:</span> {optional.join(', ')}</div>
        )}
        {weapons.length === 0 && optional.length === 0 && (
          <div className="mt-0.5 text-gray-500">No weapons or optional components.</div>
        )}
      </div>
    </Floating>
  );
}
