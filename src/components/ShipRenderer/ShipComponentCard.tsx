// src/components/ShipRenderer/ShipComponentCard.tsx
// One bounded, square component slot in the ship layout. The card shows the
// catalog image (or a placeholder), name, one small box per ton, AC and the
// crew circles required by that component. Crew assignment is future work, so
// the circles start hollow.

export interface ShipComponentCardData {
  id: string;
  name: string;
  imageUrl?: string;
  tons: number;
  ac: number;
  crewRequired: number;
  crewAssigned?: number;
  safe?: boolean;
  note?: string;
  empty?: boolean;
  onAdd?: () => void;
}

const MAX_BOXES = 120;

export function ShipComponentCard({ data }: { data: ShipComponentCardData }) {
  if (data.empty) {
    return (
      <button
        type="button"
        onClick={data.onAdd}
        className={`aspect-square w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition ${
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
  const assigned = Math.max(0, Math.min(crew, data.crewAssigned ?? 0));

  return (
    <div className="aspect-square w-full min-w-0 rounded-2xl border border-gray-600 bg-gray-800/70 p-1.5 flex flex-col">
      <div className="flex-1 min-h-0 rounded-xl bg-gray-900 border border-gray-700 overflow-hidden flex items-center justify-center">
        {data.imageUrl ? (
          <img src={data.imageUrl} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="text-[11px] font-bold text-gray-600 uppercase">{data.name.slice(0, 3)}</span>
        )}
      </div>

      <div className="mt-0.5 text-[9px] font-semibold text-gray-200 truncate" title={data.name}>
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

      <div className="mt-0.5 flex items-center justify-between gap-1">
        <span className="text-[8px] text-gray-400 flex-none">AC {data.ac}</span>
        <span className="flex flex-wrap justify-end gap-[2px]">
          {Array.from({ length: crew }).map((_, i) => (
            <span
              key={i}
              title={i < assigned ? 'assigned crew' : 'crew needed'}
              className={`w-1.5 h-1.5 rounded-full ${
                i < assigned ? 'bg-green-500' : 'border border-gray-400'
              }`}
            />
          ))}
        </span>
      </div>

      {data.note && (
        <div className="text-[7px] text-gray-500 truncate" title={data.note}>
          {data.note}
        </div>
      )}
    </div>
  );
}
