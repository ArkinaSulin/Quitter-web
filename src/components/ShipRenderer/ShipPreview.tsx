// src/components/ShipRenderer/ShipPreview.tsx
// Editor-side wrapper composing the shared ship visual components (hit grid +
// functional area), mirroring TokenRenderer/TokenPreview. The ScenarioMap will use the
// same underlying components directly with live scenario state.

import { ShipBuild, ShipDerivedStats, componentById, COMPONENT_IDS } from '@/lib/shipStats';
import { hitBoxGroups, ShipHitGrid } from './ShipHitGrid';
import { ShipFunctionalArea, ShipStation } from './ShipFunctionalArea';

/** Derive the station descriptor list from a build (editor preview). The map feeds the
 *  same list shape from live state (crew_assigned, box-pool damage, destroyed stations). */
export function stationsFromBuild(build: ShipBuild, stats: ShipDerivedStats): ShipStation[] {
  const c = build.components;
  const stations: ShipStation[] = [];
  stations.push({
    id: 'helm',
    label: 'Helm Bridge',
    crewNeeded: componentById(c, COMPONENT_IDS.helmBridge).crew,
    crewAssigned: 0,
    arc: '360',
  });
  if (build.bridge > 0) {
    stations.push({
      id: 'command-bridge',
      label: 'Command Bridge',
      crewNeeded: build.bridge * componentById(c, COMPONENT_IDS.commandBridge).crew,
      crewAssigned: 0,
      arc: '360',
    });
  }
  if (build.auxHelm > 0) {
    stations.push({
      id: 'aux-helm',
      label: 'Auxiliary Helm',
      crewNeeded: build.auxHelm * componentById(c, COMPONENT_IDS.auxHelm).crew,
      crewAssigned: 0,
      arc: '360',
    });
  }
  stations.push({
    id: 'sails',
    label: 'Sails',
    crewNeeded: Math.ceil(build.sails * componentById(c, COMPONENT_IDS.sail).crew),
    crewAssigned: 0,
    arc: '360',
  });
  stations.push({
    id: 'rudder',
    label: 'Rudder',
    crewNeeded: build.rudders * componentById(c, COMPONENT_IDS.rudder).crew,
    crewAssigned: 0,
    arc: '360',
  });
  stations.push({
    id: 'weapons',
    label: 'Weapons',
    crewNeeded: build.lWeap * componentById(c, COMPONENT_IDS.lWeap).crew + build.sWeap * componentById(c, COMPONENT_IDS.sWeap).crew,
    crewAssigned: 0,
    arc: '360',
  });
  return stations.filter(s => s.crewNeeded > 0);
}

export function ShipPreview({ build, stats }: { build: ShipBuild; stats: ShipDerivedStats }) {
  const groups = hitBoxGroups(build, stats);
  const stations = stationsFromBuild(build, stats);
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Hit Box Silhouette</label>
        <p className="text-[10px] text-gray-500 mb-2">
          1 ton = 1 box · only armor + Hull R are safe (outlined). Grey = safe, colored = hittable.
        </p>
        <ShipHitGrid groups={groups} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Functional Area</label>
        <p className="text-[10px] text-gray-500 mb-2">
          On the scenario map, PCs drop their token on a station to take a ship action, or on
          Free Actions to take a PC action.
        </p>
        <ShipFunctionalArea stations={stations} />
      </div>
    </div>
  );
}
