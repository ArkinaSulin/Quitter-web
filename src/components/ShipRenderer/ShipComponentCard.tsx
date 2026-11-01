// src/components/ShipRenderer/ShipComponentCard.tsx
// One component/weapon card in the ship layout. Cards grow to the tallest card
// in their horizontal grid row. Reinforcement is shown as a thick silvery border.

export interface ShipComponentCrewSlot {
  name?: string;
  level?: number;
  assigned: boolean;
}

export interface ShipComponentCardData {
  id: string;
  /** Stable key used by reinforcements/card placements. */
  cardKey?: string;
  name: string;
  tons: number;
  ac: number;
  dt: number;
  crewRequired: number;
  crewSlots?: ShipComponentCrewSlot[];
  reinforced?: boolean;
  safe?: boolean;
  note?: string;
  kind?: 'component' | 'weapon';
  empty?: boolean;
  onAdd?: () => void;
  onContextMenu?: (event: React.MouseEvent, data: ShipComponentCardData) => void;
}

const MAX_BOXES = 120;

export function ShipComponentCard({ data }: { data: ShipComponentCardData }) {
  if (data.empty) {
    return (
      <button
        type="button"
        onClick={data.onAdd}
        className={`h-full min-h-[110px] w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition ${
          data.onAdd
            ? 'border-gray-600 text-gray-500 hover:border-yellow-400 hover:text-yellow-300'
            : 'border-gray-700 text-gray-700 cursor-default'
        }`}
      >
        <span className="text-xl leading-none">+</span>
        <span className="text-[8px] uppercase tracking-wide mt-1">{data.name}</span>
      </button>
    );
  }

  const boxes = Math.max(0, Math.round(data.tons));
  const shownBoxes = Math.min(boxes, MAX_BOXES);
  const crew = Math.max(0, Math.round(data.crewRequired));
  const slots: ShipComponentCrewSlot[] = data.crewSlots
    ?? Array.from({ length: crew }, () => ({ assigned: false }));

  return (
    <div
      onContextMenu={(event) => data.onContextMenu?.(event, data)}
      className={`h-full min-h-[110px] w-full min-w-0 rounded-2xl bg-gray-800/70 p-1.5 flex flex-col ${
        data.reinforced
          ? 'border-4 border-slate-300 shadow-[0_0_0_1px_rgba(255,255,255,0.35)]'
          : 'border border-gray-600'
      }`}
      title={data.note || undefined}
    >
      <div className="text-[9px] font-semibold text-gray-200 break-words" title={data.name}>
        {data.name}
      </div>

      <div className="flex flex-wrap gap-[2px] mt-0.5" title={`${boxes} boxes`}>
        {Array.from({ length: shownBoxes }).map((_, i) => (
          <span
            key={i}
            className={`w-1 h-1 rounded-[1px] ${
              data.safe ? 'bg-gray-600 border border-gray-500' : 'bg-yellow-600'
            }`}
          />
        ))}
        {boxes > MAX_BOXES && <span className="text-[7px] text-gray-500">+{boxes - MAX_BOXES}</span>}
      </div>

      <div className="mt-0.5 flex items-center gap-2 text-[8px] text-gray-400">
        <span>AC: {data.ac}</span>
        <span>DT: {data.dt}</span>
      </div>

      {slots.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {slots.map((slot, i) => (
            <div key={i} className="flex items-center gap-1 text-[8px] leading-tight min-w-0">
              <span
                title={slot.assigned ? 'assigned crew' : 'crew needed'}
                className={`w-1.5 h-1.5 rounded-full flex-none ${
                  slot.assigned ? 'bg-green-500' : 'border border-gray-400'
                }`}
              />
              {slot.assigned && (
                <span className="truncate text-gray-300">
                  {slot.name || (slot.level ? `Lv ${slot.level} crew` : 'Crew')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {data.note && (
        <div className="mt-auto pt-0.5 text-[7px] text-gray-500 truncate" title={data.note}>
          {data.note}
        </div>
      )}
    </div>
  );
}
