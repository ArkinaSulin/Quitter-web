// src/components/ScenarioMap/MapInfoTooltip.tsx
'use client';
// Hover tooltip for authored board features: a hex's effects + hex structure
// (gate/tower), or an edge structure (wall/spike). Never shows units — those use
// UnitTooltip. With Shift held, the hex tooltip shows the effect and structure
// side by side (like the hero+host UnitTooltip).
import React from 'react';
import { Hex, GroundEffect } from '@/types/gameProtocol';
import { EdgeRef } from '@/lib/walls';
import { MapStructures, instanceModifiers, instanceDoorState } from '@/lib/mapStructures';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { modifierAmount } from '@/lib/effectTemplates';
import { useTooltipClamp } from './useTooltipClamp';

interface MapInfoTooltipProps {
  kind: 'hex' | 'edge';
  hex?: Hex;
  edge?: EdgeRef;
  x: number;
  y: number;
  structures: MapStructures;
  templates: Record<string, StructureTemplate>;
  zones: GroundEffect[];
  /** Shift held: effect + structure side by side instead of one at a time. */
  sideBySide: boolean;
}

const mpText = (v: number | null): string => (v === null ? '—' : v < 0 ? 'block' : `${v}`);

function coverAc(mods: { kind: string; dice?: string; mode?: string }[]): { melee: number; ranged: number } {
  let melee = 0;
  let ranged = 0;
  for (const m of mods) {
    if (m.kind !== 'ac') continue;
    const d = modifierAmount(m.dice);
    if (m.mode === 'melee') melee += d;
    else if (m.mode === 'ranged') ranged += d;
    else { melee += d; ranged += d; }
  }
  return { melee, ranged };
}

function EffectInfo({ zone }: { zone: GroundEffect }) {
  const amount = zone.dice ?? '';
  return (
    <div className="mb-1 last:mb-0">
      <div className="font-semibold" style={{ color: zone.color || '#fff' }}>{zone.name}</div>
      <div className="text-gray-300">{zone.kind} {amount}{zone.healing ? ' heal' : ''}</div>
      <div className="text-gray-500">
        {zone.permanent ? 'permanent' : `${zone.turnsLeft} turn${zone.turnsLeft === 1 ? '' : 's'} left`}
        {zone.casterTeam ? ` · ${zone.casterTeam}` : ''}
      </div>
    </div>
  );
}

const modLine = (mods: { kind: string; dice?: string; mode?: string }[]): string =>
  mods.map(m => `${m.kind}${m.mode ? `(${m.mode})` : ''}`).join(', ');

function HexStructureInfo({ template, inst, hp, maxHp }: { template: StructureTemplate; inst: StructureInstance; hp: number; maxHp: number }) {
  const door = instanceDoorState(inst, template);
  return (
    <div>
      <div className="font-semibold text-amber-300">{template.name}</div>
      <div className="text-gray-300">HP {hp}/{maxHp} · DT {template.dt}</div>
      {door.doorMax > 0 && (
        <div className="text-gray-300">Door {door.open ? 'open' : `${door.doorHp}/${door.doorMax}`}</div>
      )}
      <div className="text-gray-400">Enter: foot {mpText(template.mpFootIn)} MP · mounted {mpText(template.mpMountedIn)} MP</div>
      {template.modifiers.length > 0 && <div className="text-gray-400">Effects: {modLine(template.modifiers)}</div>}
      <div className="text-gray-500 mt-1">Shift + double-click to edit · Shift + drop a unit to attack</div>
    </div>
  );
}

function EdgeStructureInfo({ template, inst, hp, maxHp, outside }: { template: StructureTemplate; inst: StructureInstance; hp: number; maxHp: number; outside: 'a' | 'b' }) {
  const mods = instanceModifiers(inst, template);
  const ac = coverAc(mods);
  const door = instanceDoorState(inst, template);
  return (
    <div>
      <div className="font-semibold text-amber-300">{template.name}</div>
      <div className="text-gray-300">HP {hp}/{maxHp} · DT {template.dt}</div>
      {door.doorMax > 0 && <div className="text-gray-300">Door {door.open ? 'open' : `${door.doorHp}/${door.doorMax}`}</div>}
      <div className="text-gray-400">In: foot {mpText(template.mpFootIn)} · mtd {mpText(template.mpMountedIn)} MP</div>
      <div className="text-gray-400">Out: foot {mpText(template.mpFootOut)} · mtd {mpText(template.mpMountedOut)} MP</div>
      {(ac.melee || ac.ranged) ? <div className="text-gray-400">Cover AC melee {ac.melee} · ranged {ac.ranged}</div> : null}
      <div className="text-gray-500">Outside side: {outside === 'a' ? 'A' : 'B'}{template.spikes ? ' · stakes' : template.battlement ? ' · battlement' : ''}</div>
      <div className="text-gray-500 mt-1">Shift + double-click to edit · Shift + drop a unit to attack</div>
    </div>
  );
}

export function MapInfoTooltip({ kind, hex, edge, x, y, structures, templates, zones, sideBySide }: MapInfoTooltipProps) {
  const { ref, style } = useTooltipClamp(x, y);

  let body: React.ReactNode = null;
  let title = 'Hex info';

  if (kind === 'edge' && edge) {
    const inst = structures[edge.key];
    const t = inst ? templates[inst.templateId] : undefined;
    if (t && inst) {
      const maxHp = t.maxHp;
      title = 'Barrier';
      body = <EdgeStructureInfo template={t} inst={inst} hp={inst.hp ?? maxHp} maxHp={maxHp} outside={inst.outside ?? 'a'} />;
    }
  } else if (kind === 'hex' && hex) {
    const key = `${hex.q},${hex.r}`;
    const zoneList = zones.filter(z => z.q === hex.q && z.r === hex.r);
    const inst = structures[key];
    const t = inst ? templates[inst.templateId] : undefined;
    const structEl = t && inst
      ? <HexStructureInfo template={t} inst={inst} hp={inst.hp ?? t.maxHp} maxHp={t.maxHp} />
      : null;
    const effectsEl = zoneList.length > 0 ? (
      <>
        {zoneList.map(z => <EffectInfo key={z.key} zone={z} />)}
      </>
    ) : null;
    title = `Hex (${hex.q}, ${hex.r})`;
    if (sideBySide && effectsEl && structEl) {
      body = (
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">{effectsEl}</div>
          <div className="w-px bg-gray-600 flex-none" />
          <div className="flex-1 min-w-0">{structEl}</div>
        </div>
      );
    } else {
      // Priority: effect → structure.
      body = effectsEl ?? structEl;
    }
  }

  if (!body) return null;

  return (
    <div
      ref={ref}
      className={`absolute z-50 pointer-events-none bg-black/90 border border-gray-600 rounded shadow-xl p-3 text-xs text-white ${sideBySide ? 'max-w-[min(560px,calc(100vw-16px))]' : 'max-w-[min(360px,calc(100vw-16px))]'}`}
      style={style}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{title}</div>
      {body}
    </div>
  );
}
