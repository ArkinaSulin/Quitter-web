'use client';

// Shared bits for creator-owned authoring content: an owner chip, the list
// filter, and the read-only notice shown when a row belongs to someone else.

import type { OwnershipFilter } from '@/packages/infra';
import type { useContentOwnership } from '@/hooks/useContentOwnership';

type Ownership = ReturnType<typeof useContentOwnership>;

export function OwnerChip({
  ownership,
  ownerId,
}: {
  ownership: Ownership;
  ownerId?: string | null;
}) {
  const kind = ownership.kind(ownerId);
  if (kind === 'mine') return null;
  const label = ownership.label(ownerId);
  const tone =
    kind === 'system'
      ? 'border-gray-600 bg-gray-800 text-gray-300'
      : kind === 'orphan'
        ? 'border-red-700/60 bg-red-950/40 text-red-200'
        : 'border-sky-700/60 bg-sky-950/40 text-sky-200';
  return (
    <span className={`inline-block max-w-full truncate rounded border px-1.5 py-0.5 text-[10px] ${tone}`}>
      {kind === 'orphan' ? 'Owner deleted — ' : ''}
      {label}
    </span>
  );
}

export function OwnerFilterSelect({
  ownership,
  value,
  onChange,
  className = '',
}: {
  ownership: Ownership;
  value: OwnershipFilter;
  onChange: (next: OwnershipFilter) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as OwnershipFilter)}
      className={`bg-gray-800 text-gray-200 text-xs rounded px-2 py-1 border border-gray-700 focus:border-amber-400 outline-none ${className}`}
      title="Filter by creator"
    >
      <option value="all">All content</option>
      <option value="mine">Mine</option>
      <option value="system">System / legacy</option>
      {ownership.isAdmin && <option value="orphans">Owner deleted</option>}
    </select>
  );
}

export function OwnerLockNotice({
  ownership,
  ownerId,
  onClone,
}: {
  ownership: Ownership;
  ownerId?: string | null;
  onClone?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-sky-700/60 bg-sky-950/30 px-3 py-2 text-[11px] text-sky-100">
      <span>
        Read-only — created by <strong>{ownership.label(ownerId)}</strong>.
      </span>
      {onClone && (
        <button
          type="button"
          onClick={onClone}
          className="rounded border border-sky-500 bg-sky-800/60 px-2 py-0.5 text-[10px] text-sky-50 hover:bg-sky-700/60"
        >
          Clone to edit
        </button>
      )}
    </div>
  );
}
