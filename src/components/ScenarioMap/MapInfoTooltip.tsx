// src/components/ScenarioMap/MapInfoTooltip.tsx
'use client';
// Hover tooltip for authored board features: a hex's effects + hex structure
// (gate/tower), or an edge structure (wall/spike). Never shows units — those use
// UnitTooltip. With Shift held, the hex tooltip shows the effect and structure
// side by side (like the hero+host UnitTooltip).
import React from 'react';
import { Hex, GroundEffect } from '@/types/gameProtocol';
import { EdgeRef } from '@/lib/walls';
import { MapStructures } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
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

function faceBits(block: boolean, moveCost: number | null, meleeAc: number | null, rangedAc: number | null): string {
  const bits: string[] = [block ? 'block' : 'pass'];
  if (moveCost !== null) bits.push(`MP ${moveCost}`);
  const ac: string[] = [];
  if (meleeAc) ac.push(`m${meleeAc}`);
  if (rangedAc) ac.push(`r${rangedAc}`);
  if (ac.length) bits.push(`AC ${ac.join('/')}`);
  return bits.join(' · ');
}

function faceFromTemplate(t: StructureTemplate, which: 'inside' | 'outside') {
  return which === 'inside'
    ? { block: t.edgeABlock, moveCost: t.edgeAMoveCost, meleeAc: t.edgeAMeleeAc, rangedAc: t.edgeARangedAc }
    : { block: t.edgeBBlock, moveCost: t.edgeBMoveCost, meleeAc: t.edgeBMeleeAc, rangedAc: t.edgeBRangedAc };
}

function EffectInfo({ zone }: { zone: GroundEffect }) {
  const amount = zone.dice ?? (zone.delta >= 0 ? `+${zone.delta}` : `${zone.delta}`);
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

function HexStructureInfo({ template, hp, maxHp, doorHp, open }: { template: StructureTemplate; hp: number; maxHp: number; doorHp: number | null; open: boolean }) {
  return (
    <div>
      <div className="font-semibold text-amber-300">{template.name}</div>
      <div className="text-gray-300">HP {hp}/{maxHp} · DT {template.dt}</div>
      {template.doorHp !== null && (
        <div className="text-gray-300">Door {open ? 'open' : `${doorHp ?? template.doorHp}/${template.doorHp}`}</div>
      )}
      {template.hexMoveCost !== null && <div className="text-gray-400">Enter: +{template.hexMoveCost} MP</div>}
      {template.modifiers.length > 0 && (
        <div className="text-gray-400">Effects: {template.modifiers.map(m => m.kind).join(', ')}</div>
      )}
      <div className="text-gray-500 mt-1">Shift + drop a unit here to attack</div>
    </div>
  );
}

function EdgeStructureInfo({ template, hp, maxHp, outside }: { template: StructureTemplate; hp: number; maxHp: number; outside: 'a' | 'b' }) {
  const inside = faceFromTemplate(template, 'inside');
  const out = faceFromTemplate(template, 'outside');
  return (
    <div>
      <div className="font-semibold text-amber-300">{template.name}</div>
      <div className="text-gray-300">HP {hp}/{maxHp} · DT {template.dt}</div>
      <div className="text-gray-400">Inside: {faceBits(inside.block, inside.moveCost, inside.meleeAc, inside.rangedAc)}</div>
      <div className="text-gray-400">Outside: {faceBits(out.block, out.moveCost, out.meleeAc, out.rangedAc)}</div>
      <div className="text-gray-500">Outside side: {outside === 'a' ? 'A' : 'B'}{template.spikes ? ' · stakes' : template.battlement ? ' · battlement' : ''}</div>
      <div className="text-gray-500 mt-1">Shift + drop a unit here to attack</div>
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
      const maxHp = inst.maxHp ?? t.maxHp;
      title = 'Barrier';
      body = <EdgeStructureInfo template={t} hp={inst.hp ?? maxHp} maxHp={maxHp} outside={inst.outside ?? 'a'} />;
    }
  } else if (kind === 'hex' && hex) {
    const key = `${hex.q},${hex.r}`;
    const zoneList = zones.filter(z => z.q === hex.q && z.r === hex.r);
    const inst = structures[key];
    const t = inst ? templates[inst.templateId] : undefined;
    const structEl = t && inst
      ? <HexStructureInfo template={t} hp={inst.hp ?? inst.maxHp ?? t.maxHp} maxHp={inst.maxHp ?? t.maxHp} doorHp={inst.doorHp ?? null} open={!!inst.open} />
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
