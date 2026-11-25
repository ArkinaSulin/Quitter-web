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
  designCapacity,
  showIcon = true,
  compact = false,
}: {
  mass: number;
  capacity: number;
  /** Undamaged hold size; shown as `used / effective (design)t` when larger. */
  designCapacity?: number;
  showIcon?: boolean;
  compact?: boolean;
}) {
  const over = mass > capacity;
  const full = capacity > 0 && mass >= capacity;
  const color = over ? 'text-red-300' : full ? 'text-amber-300' : 'text-gray-200';
  const designSuffix = designCapacity != null && designCapacity > capacity
    ? ` (${formatCargoMass(designCapacity)})`
    : '';
  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${compact ? 'text-xs' : 'text-base font-bold'} ${color}`}
      title={over ? 'Cargo exceeds capacity' : full ? 'Cargo hold full' : 'Cargo load'}
    >
      {over && showIcon && <WarningTriangle className="h-3.5 w-3.5" />}
      {formatCargoMass(mass)} / {formatCargoMass(capacity)}{designSuffix}t
    </span>
  );
}

export interface CargoManifestProps {
  items: CargoManifestItem[];
  capacity: number;
  /** Undamaged hold size; shown as `used / effective (design)t` when larger. */
  designCapacity?: number;
  canEdit: boolean;
  /** Read-only preview: show Add cargo disabled instead of hiding it. */
  readOnly?: boolean;
  /** Food & water endurance at the current people count. */
  foodWaterDays?: number | null;
  /** Current people count for the Food & water edit hint. */
  people?: number;
  onChange?: (items: CargoManifestItem[]) => void;
}

export function CargoManifest({
  items,
  capacity,
  designCapacity,
  canEdit,
  readOnly = false,
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

  const grid = 'grid grid-cols-[minmax(0,1fr)_34px_42px_22px] gap-1';
  const rowClass = 'flex items-center px-2 py-1 text-[11px]';

  const saveDialog = (draft: CargoManifestDraft, index?: number) => {
    if (!onChange) return;
    if (draft.quantity <= 0) {
      if (index != null) onChange(removeCargoLine(items, index));
      return;
    }
    onChange(index != null ? updateCargoLine(items, index, draft) : addCargoLine(items, draft));
  };

  return (
    <div className={`rounded-lg border ${over ? 'border-red-600 bg-red-950/30' : full ? 'border-amber-600 bg-amber-950/20' : 'border-gray-700'}`}>
      <div className="border-b border-gray-800 px-2 py-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-left text-[10px] uppercase leading-tight tracking-wide text-gray-500">
            Cargo<br />manifest
          </span>
          <div className="flex min-w-0 flex-1 justify-center">
            <CargoLoadBadge mass={total} capacity={capacity} designCapacity={designCapacity} showIcon compact />
          </div>
          {(canEdit || readOnly) && (
            <button
              type="button"
              onClick={() => setDialog({
                category: 'general_cargo',
                name: CARGO_CATEGORY_LABELS.general_cargo,
                quantity: 1,
              })}
              disabled={!canEdit}
              className="shrink-0 px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Add cargo
            </button>
          )}
        </div>
        {foodWaterDays !== undefined && (
          <div className="mt-0.5 flex items-center justify-between text-[9px] text-gray-500">
            <span>Food &amp; water</span>
            <span className={foodWaterDays === 0 ? 'text-red-300' : foodWaterDays != null && foodWaterDays <= 7 ? 'text-amber-300' : 'text-gray-300'}>
              {foodWaterDays == null ? '—' : `${foodWaterDays} days`}
            </span>
          </div>
        )}
        <div className={`mt-0.5 ${grid} text-[9px] uppercase tracking-wide text-gray-500`}>
          <span>Name</span><span className="text-right">Qty</span><span className="text-right">Mass</span><span />
        </div>
      </div>

      <div className="max-h-[24vh] divide-y divide-gray-800 overflow-y-auto">
        {visible.length === 0 && <div className="p-2 text-[11px] text-gray-500">No cargo.</div>}

        {visible.map(({ item, index }) => (
          <div key={`cargo-${index}`} className={`${rowClass} ${grid}`}>
            <span
              className="truncate text-gray-200"
              title={`${item.name} · ${CARGO_CATEGORY_LABELS[item.category]}`}
            >
              {item.name}
            </span>
            <span className="text-right tabular-nums text-gray-300" title={cargoUnitLabel(item.category)}>
              {item.quantity}
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
