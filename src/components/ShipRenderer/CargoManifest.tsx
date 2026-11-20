'use client';

// Cargo manifest list shared by the Ship Editor and the scenario ship window.
// Every line has its own name and category, so e.g. Ore and Furniture are two
// separate General cargo lines. Quantities use the category unit: person-days,
// kits, or tons. No Auto/Clear/team controls and no ownership. Empty categories
// are simply absent until an item is added.

import { useState } from 'react';
import { CargoCategory, CargoManifestItem } from '@/types/ship';
import {
  CARGO_CATEGORY_LABELS,
  addCargoLine,
  cargoItemMass,
  cargoManifestMass,
  cargoUnitLabel,
  formatCargoMass,
  removeCargoLine,
  updateCargoLine,
} from '@/packages/ships';
import { CargoManifestDialog, CargoManifestDraft } from './CargoManifestDialog';

export function WarningTriangle({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17.2" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CargoLoadBadge({
  mass,
  capacity,
  showIcon = true,
  compact = false,
}: {
  mass: number;
  capacity: number;
  showIcon?: boolean;
  compact?: boolean;
}) {
  const over = mass > capacity;
  const full = capacity > 0 && mass >= capacity;
  const color = over ? 'text-red-300' : full ? 'text-amber-300' : 'text-gray-200';
  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${compact ? 'text-xs' : 'text-base font-bold'} ${color}`}
      title={over ? 'Cargo exceeds capacity' : full ? 'Cargo hold full' : 'Cargo load'}
    >
      {over && showIcon && <WarningTriangle className="h-3.5 w-3.5" />}
      {formatCargoMass(mass)} / {formatCargoMass(capacity)}t
    </span>
  );
}

export interface CargoManifestProps {
  items: CargoManifestItem[];
  capacity: number;
  canEdit: boolean;
  /** Food & water endurance at the current people count. */
  foodWaterDays?: number | null;
  /** Current people count for the Food & water edit hint. */
  people?: number;
  onChange?: (items: CargoManifestItem[]) => void;
}

export function CargoManifest({
  items,
  capacity,
  canEdit,
  foodWaterDays,
  people = 0,
  onChange,
}: CargoManifestProps) {
  const [dialog, setDialog] = useState<{
    category: CargoCategory;
    name: string;
    quantity: number;
    index?: number;
  } | null>(null);

  const total = cargoManifestMass(items);
  const over = total > capacity;
  const full = capacity > 0 && total >= capacity;
  const visible = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.quantity > 0);

  const grid = 'grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_70px_44px_22px]';
  const rowClass = 'flex items-center gap-2 px-2 py-1 text-[11px]';

  const saveDialog = (draft: CargoManifestDraft, index?: number) => {
    if (!onChange) return;
    if (draft.quantity <= 0) {
      if (index != null) onChange(removeCargoLine(items, index));
      return;
    }
    onChange(index != null ? updateCargoLine(items, index, draft) : addCargoLine(items, draft));
  };

  return (
    <div className={`relative rounded-lg border ${over ? 'border-red-600 bg-red-950/30' : full ? 'border-amber-600 bg-amber-950/20' : 'border-gray-700'}`}>
      {over && (
        <span className="pointer-events-none absolute right-1.5 top-1.5 text-red-300" title="Cargo exceeds capacity">
          <WarningTriangle className="h-4 w-4" />
        </span>
      )}
      <div className="border-b border-gray-800 px-2 py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Cargo manifest</span>
          <CargoLoadBadge mass={total} capacity={capacity} showIcon={false} compact />
        </div>
        {foodWaterDays !== undefined && (
          <div className="mt-0.5 flex items-center justify-between text-[9px] text-gray-500">
            <span>Food &amp; water</span>
            <span className={foodWaterDays === 0 ? 'text-red-300' : foodWaterDays != null && foodWaterDays <= 7 ? 'text-amber-300' : 'text-gray-300'}>
              {foodWaterDays == null ? '—' : `${foodWaterDays} days`}
            </span>
          </div>
        )}
        <div className={`mt-0.5 ${grid} gap-1 text-[9px] uppercase tracking-wide text-gray-500`}>
          <span>Name</span><span>Category</span><span className="text-right">Qty</span><span className="text-right">Mass</span><span />
        </div>
      </div>

      <div className="max-h-[24vh] divide-y divide-gray-800 overflow-y-auto">
        {visible.length === 0 && <div className="p-2 text-[11px] text-gray-500">No cargo.</div>}

        {visible.map(({ item, index }) => (
          <div key={`cargo-${index}`} className={`${rowClass} ${grid}`}>
            <span className="truncate text-gray-200" title={item.name}>{item.name}</span>
            <span className="truncate text-gray-400" title={CARGO_CATEGORY_LABELS[item.category]}>
              {CARGO_CATEGORY_LABELS[item.category]}
            </span>
            <span className="text-right tabular-nums text-gray-300">
              {item.quantity} <span className="text-gray-500">{cargoUnitLabel(item.category)}</span>
            </span>
            <span className="text-right tabular-nums text-gray-300">{formatCargoMass(cargoItemMass(item))}t</span>
            {canEdit ? (
              <button
                type="button"
                onClick={() => setDialog({
                  category: item.category,
                  name: item.name,
                  quantity: item.quantity,
                  index,
                })}
                className="rounded border border-amber-600 px-0.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-700/30"
              >
                +/-
              </button>
            ) : <span />}
          </div>
        ))}

        {canEdit && (
          <button
            type="button"
            onClick={() => setDialog({
              category: 'general_cargo',
              name: CARGO_CATEGORY_LABELS.general_cargo,
              quantity: 1,
            })}
            className="flex w-full items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-emerald-300 hover:bg-gray-800"
          >
            + Add cargo
          </button>
        )}
      </div>

      {dialog && (
        <CargoManifestDialog
          initialCategory={dialog.category}
          initialName={dialog.name}
          initialQuantity={dialog.quantity}
          allowRemove={dialog.index != null}
          people={people}
          onCancel={() => setDialog(null)}
          onSave={draft => {
            saveDialog(draft, dialog.index);
            setDialog(null);
          }}
          onRemove={dialog.index != null ? () => {
            if (onChange) onChange(removeCargoLine(items, dialog.index!));
          } : undefined}
        />
      )}
    </div>
  );
}
