// src/components/ShipRenderer/ShipFunctionalArea.tsx
// The ship's functional board — the shared component both the Ship Editor (preview)
// and the ScenarioMap will render. On the map, players drop their PC token on a
// functional box to take that SHIP action (station duty) or on the top "Free Actions"
// box to take a PC action; crew allocation happens from a floating window. The editor
// previews the same board so the admin sees the station layout + crew requirements.
//
// v1 renders station boxes + crew circles (hollow = needed, filled = assigned) from a
// plain descriptor list, so the map can later feed live state (crew_assigned, box-pool
// damage, destroyed stations) without changing this component.

export interface ShipStation {
  id: string;
  label: string;
  /** Crew needed to operate the station (component crew, weapon-specific crew comes with the engine). */
  crewNeeded: number;
  crewAssigned: number;
  /** Firing arc: 'Fore' | 'Side' | 'Rear' | '360' | null (no arc — e.g. free action area). */
  arc: string | null;
  destroyed?: boolean;
}

export function ShipFunctionalArea({ stations, children }: {
  stations: ShipStation[];
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {/* Free actions — PC actions (fight/cast/move on deck) go here on the map. */}
      <div className="border-2 border-dashed border-gray-600 rounded p-2 text-center">
        <span className="text-[11px] text-gray-400">
          Free Actions
          <span className="text-gray-600 block text-[9px]">PC tokens land here for PC actions</span>
        </span>
      </div>

      {/* Station board. The X-quadrant / 360-centre arrangement is a scenario-map
          concern (firing-arc toggle); here the stations render as a grid. */}
      {stations.length === 0 ? (
        <div className="text-[11px] text-gray-500 border border-dashed border-gray-700 rounded p-2 text-center">
          No stations to display.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {stations.map(st => (
            <div
              key={st.id}
              className={`border rounded p-1.5 text-center ${st.destroyed ? 'border-red-800 bg-red-900/20 opacity-60' : 'border-gray-600 bg-gray-800/50'}`}
            >
              <div className="text-[10px] text-gray-300 truncate">{st.label}</div>
              <div className="text-[9px] text-gray-500">
                {st.arc ? `arc ${st.arc}` : 'no arc'}
                {st.destroyed ? ' · destroyed' : ''}
              </div>
              <div className="flex items-center justify-center gap-0.5 mt-1">
                {Array.from({ length: Math.max(1, st.crewNeeded) }).map((_, i) => (
                  <div
                    key={i}
                    title={i < st.crewAssigned ? 'assigned crew' : 'crew needed'}
                    className={`w-2 h-2 rounded-full ${
                      i < st.crewAssigned
                        ? 'bg-green-500'
                        : 'border border-gray-400 bg-transparent'
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
