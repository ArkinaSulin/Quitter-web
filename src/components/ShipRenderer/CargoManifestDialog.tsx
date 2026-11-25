'use client';

// Shared add/edit dialog for one cargo-manifest line. Every line has a name and
// category (so Ore and Furniture can both be General cargo); the quantity unit
// follows the category.

import { useState } from 'react';
import { CargoCategory } from '@/types/ship';
import {
  CARGO_CATEGORIES,
  CARGO_CATEGORY_LABELS,
  cargoUnitLabel,
  roundCargoQuantity,
} from '@/packages/ships';

export interface CargoManifestDraft {
  category: CargoCategory;
  name: string;
  quantity: number;
}

export interface CargoManifestDialogProps {
  initialCategory: CargoCategory;
  initialName: string;
  initialQuantity: number;
  allowRemove?: boolean;
  /** Current people count, for the Food & water days hint. */
  people?: number;
  onSave: (draft: CargoManifestDraft) => void;
  onRemove?: () => void;
  onCancel: () => void;
}

export function CargoManifestDialog({
  initialCategory,
  initialName,
  initialQuantity,
  allowRemove = false,
  people = 0,
  onSave,
  onRemove,
  onCancel,
}: CargoManifestDialogProps) {
  const [category, setCategory] = useState<CargoCategory>(initialCategory);
  const [name, setName] = useState(initialName);
  const [nameTouched, setNameTouched] = useState(
    !!initialName && initialName !== CARGO_CATEGORY_LABELS[initialCategory],
  );
  const [quantity, setQuantity] = useState(roundCargoQuantity(initialCategory, initialQuantity));
  const unit = cargoUnitLabel(category);
  const step = category === 'food_water' || category === 'ship_repair_kit' ? 1 : 0.1;
  const valid = name.trim().length > 0;

  const foodDays = category === 'food_water' && people > 0
    ? Math.floor(quantity / people)
    : null;

  const changeCategory = (next: CargoCategory) => {
    setCategory(next);
    setQuantity(current => roundCargoQuantity(next, current || 1));
    if (!nameTouched) setName(CARGO_CATEGORY_LABELS[next]);
  };

  return (
    <div className="fixed inset-0 z-[260] grid place-items-center bg-black/70" onMouseDown={onCancel}>
      <div className="w-[420px] max-w-[96vw] rounded-xl border border-gray-600 bg-gray-900 p-4" onMouseDown={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-amber-300">{allowRemove ? 'Edit cargo' : 'Add cargo'}</h2>
          <button onClick={onCancel} className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-300">Close</button>
        </div>

        <div className="space-y-2">
          <label className="flex flex-col gap-0.5 text-[10px] text-gray-400">
            <span>Item name</span>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setNameTouched(true); }}
              placeholder="Cargo"
              className="w-full rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-100"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-gray-400">
            <span>Category</span>
            <select
              value={category}
              onChange={e => changeCategory(e.target.value as CargoCategory)}
              className="w-full rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-100"
            >
              {CARGO_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{CARGO_CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-gray-400">
            <span>Quantity ({unit})</span>
            <input
              type="number"
              step={step}
              min={0}
              value={quantity}
              onChange={e => setQuantity(roundCargoQuantity(category, Number(e.target.value) || 0))}
              className="w-full rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-100"
            />
          </label>
          {foodDays != null && (
            <div className="text-[10px] text-gray-400">
              = <span className="text-gray-200">{foodDays} days</span> for {people} people
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {allowRemove && onRemove ? (
            <button
              onClick={() => { onRemove(); onCancel(); }}
              className="rounded border border-red-600 px-3 py-1 text-xs text-red-300 hover:bg-red-900/40"
            >
              Remove
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onCancel} className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300">Cancel</button>
            <button
              disabled={!valid}
              onClick={() => onSave({
                category,
                name: name.trim(),
                quantity: roundCargoQuantity(category, quantity),
              })}
              className="rounded border border-amber-600 bg-amber-700/30 px-3 py-1 text-xs text-amber-100 hover:bg-amber-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
