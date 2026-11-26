// src/components/ScenarioMap/ShipTooltip.tsx
// Hover summary for a scenario ship image: name, HP, effective acceleration,
// effective MC and the mode's speed (declared wildspace speed or atmosphere
// speed). Kept intentionally compact — the Ship Window has the full detail.
import { alphaLabel } from '@/packages/units';
import {
  shipAtmospherePools,
  shipTurnDistance,
  type ShipDerivedStats,
  type ShipRuntime,
} from '@/packages/ships';
import { Floating } from './Floating';

interface Props {
  ship: ShipRuntime;
  /** Effective (manning-adjusted) runtime stats; null when the snapshot is gone. */
  stats: ShipDerivedStats | null;
  mode: 'atmosphere' | 'wildspace';
  turnNumber: number;
  x: number;
  y: number;
}

export function ShipTooltip({ ship, stats, mode, turnNumber, x, y }: Props) {
  const name = `${ship.name}${ship.serialNumber > 0 ? ` ${alphaLabel(ship.serialNumber)}` : ''}`;
  const speed = mode === 'wildspace'
    ? (ship.declaredRound === turnNumber ? ship.declaredSpeed : (ship.lastSpeed ?? 5))
    : (stats?.atmosphericSpeed ?? 0);
  const mc = stats
    ? shipTurnDistance(stats, speed, mode, ship.mcReduction ?? 0)
    : null;
  const accel = stats ? Math.max(0, Math.floor(stats.accel)) : null;
  const pools = shipAtmospherePools(ship, stats);
  const speedLabel = mode === 'wildspace' ? 'Declared speed' : 'Atmosphere speed';

  return (
    <Floating
      x={x}
      y={y}
      z={200}
      className="bg-black/90 border border-gray-600 rounded shadow-xl px-3 py-2 text-xs text-white max-w-[min(320px,calc(100vw-16px))]"
    >
      <div className="mb-1 font-semibold text-amber-200">{name}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <span className="text-gray-400">HP</span>
        <span>{ship.shipHp}/{ship.shipHpMax}</span>
        {mode === 'wildspace' && (
          <>
            <span className="text-gray-400">Acceleration</span>
            <span>{accel ?? '—'}</span>
          </>
        )}
        <span className="text-gray-400">MC</span>
        <span>{mc ?? '—'}</span>
        {mode === 'atmosphere' && (
          <>
            <span className="text-gray-400">MP</span>
            <span>{Math.floor(pools.mpRemaining)}/{Math.floor(pools.mpMax)}</span>
            <span className="text-gray-400">FP</span>
            <span>{Math.floor(pools.fpRemaining)}/{Math.floor(pools.fpMax)}</span>
          </>
        )}
        <span className="text-gray-400">{speedLabel}</span>
        <span>{stats ? speed : '—'}</span>
      </div>
    </Floating>
  );
}
