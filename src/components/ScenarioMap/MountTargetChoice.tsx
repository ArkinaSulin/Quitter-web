'use client';
// src/components/ScenarioMap/MountTargetChoice.tsx
// Shared mount-vs-rider chooser for a mounted-pair target (the flyer drop modal
// and the ground-attack picker both offer it, combined with the weapon choice).
import { Unit } from '@/types/gameProtocol';

export function MountTargetChoice({ target, rider, value, onChange }: {
  target: Unit;
  rider: Unit;
  value: 'mount' | 'rider';
  onChange: (v: 'mount' | 'rider') => void;
}) {
  return (
    <div className="text-xs text-gray-300 space-y-1">
      <p className="text-gray-400">Main target</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" checked={value === 'mount'} onChange={() => onChange('mount')} />
        {target.unitName} (mount)
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" checked={value === 'rider'} onChange={() => onChange('rider')} />
        {rider.unitName} (rider)
      </label>
    </div>
  );
}
