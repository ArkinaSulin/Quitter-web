'use client';

// Left-column invoice for the dry dock. One row per billed item; labour is
// summarised as removal / addition totals, while equipment is itemised by name.

import type { ShipRefitInvoice, ShipRefitLineKind } from '@/packages/ships';

const KIND_ORDER: ShipRefitLineKind[] = [
  'labour_removal',
  'labour_addition',
  'labour_remove_patch',
  'repair',
  'equipment_component',
  'equipment_weapon',
  'equipment_armor',
  'crew',
  'cargo',
];

const KIND_LABEL: Partial<Record<ShipRefitLineKind, string>> = {
  equipment_component: 'Components',
  equipment_weapon: 'Weapons',
  equipment_armor: 'Armor',
  crew: 'Crew',
  cargo: 'Cargo',
};

function gp(value: number): string {
  return `${Math.round(value).toLocaleString()} gp`;
}

function rateGp(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 2 })} gp`;
}

function quantity(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  if (unit === 'HP') return `${rounded} HP`;
  if (unit === 'person') return `${rounded} ${rounded === 1 ? 'person' : 'people'}`;
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'}`;
}

export function DryDockInvoice({
  invoice,
  beforeUsedMass,
  afterUsedMass,
  totalMass,
  currentHp,
  maxHp,
  minHp,
}: {
  invoice: ShipRefitInvoice;
  beforeUsedMass: number;
  afterUsedMass: number;
  totalMass: number;
  currentHp: number;
  maxHp: number;
  minHp: number;
}) {
  const ordered = KIND_ORDER.flatMap(kind => invoice.lines.filter(line => line.kind === kind));
  let lastKind: ShipRefitLineKind | null = null;

  return (
    <div className="space-y-2 text-[11px]">
      <div className="rounded border border-amber-700/60 bg-amber-950/20 p-2">
        <div className="text-[10px] uppercase tracking-wide text-amber-300">Refit summary (labour + equipment)</div>
        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-gray-300">
          <span>Total mass</span><span className="text-right tabular-nums">{totalMass}t (fixed)</span>
          <span>Used mass</span><span className="text-right tabular-nums">{beforeUsedMass}t → {afterUsedMass}t</span>
          <span>HP</span><span className="text-right tabular-nums">{currentHp}/{maxHp} · worst {minHp}</span>
        </div>
      </div>

      <div className="divide-y divide-gray-800 rounded border border-gray-700">
        {ordered.length === 0 && (
          <div className="p-2 text-gray-500">No billable changes. Crew and cargo edits cost nothing.</div>
        )}
        {ordered.map((line, index) => {
          const header = line.kind !== lastKind && KIND_LABEL[line.kind] ? KIND_LABEL[line.kind] : null;
          lastKind = line.kind;
          return (
            <div key={`${line.kind}-${index}-${line.label}`} className="px-2 py-1.5">
              {header && (
                <div className="mb-0.5 text-[9px] uppercase tracking-wide text-gray-500">{header}</div>
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-gray-200" title={line.label}>{line.label}</div>
                  <div className="text-[9px] text-gray-500">
                    {rateGp(line.rate)} × {quantity(line.quantity, line.unit)}
                    {line.detail ? ` · ${line.detail}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums text-amber-200">{gp(line.subtotal)}</div>
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between px-2 py-2 text-xs">
          <span className="font-semibold text-gray-200">Total</span>
          <span className="font-bold text-amber-300">{gp(invoice.total)}</span>
        </div>
      </div>

      {invoice.warnings.length > 0 && (
        <div className="space-y-1 rounded border border-amber-700/60 bg-amber-950/20 p-2 text-[10px] text-amber-200">
          {invoice.warnings.map(warning => <div key={warning}>{warning}</div>)}
        </div>
      )}
    </div>
  );
}
