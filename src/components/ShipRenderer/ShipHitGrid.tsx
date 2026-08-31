// src/components/ShipRenderer/ShipHitGrid.tsx
// Shared hit-box silhouette: the ship's hit grid grouped by subsystem, used by the
// Ship Editor (right panel, full/edited build) and later by the ScenarioMap (live box
// pools + damage states). Mirror of the TokenRenderer <-> preview split.

import { ShipBuild, ShipDerivedStats, accessoryPoolHp, componentById, COMPONENT_IDS } from '@/lib/shipStats';

export interface BoxGroup {
  label: string;
  boxes: number;
  pool: number;
  safe: boolean;
}

/** Derive the box groups for a build from its derived stats (1 t = 1 box). */
export function hitBoxGroups(build: ShipBuild, stats: ShipDerivedStats): BoxGroup[] {
  const boxHp = stats.boxHp;
  const c = build.components;
  const safeAccessoryMass = build.templateAccessories.reduce((sum, a) => {
    const acc = build.accessoriesCatalog.find(x => x.id === a.accessoryId);
    return sum + (acc && !acc.hittable ? acc.mass * a.count : 0);
  }, 0);
  const groups: BoxGroup[] = [
    { label: 'Armor', boxes: Math.round(stats.armorMass), pool: 0, safe: true },
    { label: 'Hull R', boxes: build.hullR, pool: 0, safe: true },
    { label: 'Safe specials', boxes: safeAccessoryMass, pool: 0, safe: true },
    { label: 'Helm Bridge', boxes: componentById(c, COMPONENT_IDS.helmBridge).mass, pool: stats.pools.helm, safe: false },
    { label: 'Command Bridge', boxes: build.bridge * componentById(c, COMPONENT_IDS.commandBridge).mass, pool: stats.pools.bridge, safe: false },
    { label: 'Aux Helm', boxes: build.auxHelm * componentById(c, COMPONENT_IDS.auxHelm).mass, pool: stats.pools.auxHelm, safe: false },
    { label: 'Sails', boxes: build.sails * componentById(c, COMPONENT_IDS.sail).mass, pool: stats.pools.sails, safe: false },
    { label: 'Rudders', boxes: build.rudders * componentById(c, COMPONENT_IDS.rudder).mass, pool: stats.pools.rudders, safe: false },
    { label: 'L.Weap', boxes: build.lWeap * componentById(c, COMPONENT_IDS.lWeap).mass, pool: stats.pools.lWeap, safe: false },
    { label: 'S.Weap', boxes: build.sWeap * componentById(c, COMPONENT_IDS.sWeap).mass, pool: stats.pools.sWeap, safe: false },
    { label: 'Crew quarters', boxes: stats.crewQuarters, pool: stats.pools.crewQuarters, safe: false },
  ];
  for (const a of build.templateAccessories) {
    const acc = build.accessoriesCatalog.find(x => x.id === a.accessoryId);
    if (!acc || !acc.hittable) continue;
    groups.push({ label: acc.id, boxes: Math.round(acc.mass * a.count), pool: accessoryPoolHp(acc, boxHp) * a.count, safe: false });
  }
  groups.push({ label: 'Cargo', boxes: Math.max(0, build.cargoArea), pool: stats.pools.cargo, safe: false });
  groups.push({ label: 'Unclaimed', boxes: Math.max(0, Math.round(stats.unclaimedSpace)), pool: stats.pools.unclaimed, safe: false });
  return groups.filter(g => g.boxes > 0);
}

export function ShipHitGrid({ groups }: { groups: BoxGroup[] }) {
  return (
    <div className="space-y-1.5">
      {groups.map(group => (
        <div key={group.label} className="flex items-center gap-2">
          <span className={`text-[10px] w-24 truncate text-right ${group.safe ? 'text-gray-500' : 'text-gray-300'}`}>
            {group.label}
          </span>
          <div className="flex flex-wrap gap-0.5">
            {Array.from({ length: Math.min(group.boxes, 120) }).map((_, i) => (
              <div
                key={i}
                title={`${group.label} · pool ${group.pool} HP`}
                className={`w-1.5 h-1.5 rounded-sm ${group.safe ? 'bg-gray-700 border border-gray-600' : 'bg-yellow-600'}`}
              />
            ))}
          </div>
          <span className="text-[9px] text-gray-500 ml-auto">{group.pool}</span>
        </div>
      ))}
    </div>
  );
}
