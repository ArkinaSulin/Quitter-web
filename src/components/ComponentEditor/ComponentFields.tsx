'use client';

import { ShipComponentTemplate } from '@/types/ship';

const INPUT =
  'w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-yellow-400 outline-none disabled:opacity-50';

function Cell({ label, children, widthClass = 'flex-1' }: { label: string; children: React.ReactNode; widthClass?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-gray-400 min-w-0 ${widthClass}`}>
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(integer ? Math.round(parseFloat(e.target.value) || 0) : (parseFloat(e.target.value) || 0))}
      className={INPUT}
    />
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 accent-yellow-400"
      />
      {label}
    </label>
  );
}

const KIND_LABEL: Record<ShipComponentTemplate['kind'], string> = {
  component: 'Component',
  weapon: 'Weapon',
};

export function ComponentFields({
  value,
  onChange,
  readOnly,
}: {
  value: ShipComponentTemplate;
  onChange: (next: ShipComponentTemplate) => void;
  readOnly: boolean;
}) {
  const patch = (p: Partial<ShipComponentTemplate>) => onChange({ ...value, ...p });
  const isWeapon = value.kind === 'weapon';
  const nameEditable = value.kind === 'weapon' || !value.builtIn;

  return (
    <fieldset disabled={readOnly} className="space-y-3">
      <div className="flex items-end gap-2">
        <Cell label="Name" widthClass="flex-1">
          <input
            type="text"
            value={value.name}
            disabled={!nameEditable}
            onChange={e => patch({ name: e.target.value })}
            className={INPUT}
          />
        </Cell>
        <Cell label="Type" widthClass="w-36">
          <div className="w-full bg-gray-800 text-gray-300 text-sm rounded px-3 py-1.5 border border-gray-600">
            {KIND_LABEL[value.kind]}
          </div>
        </Cell>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Cell label="Mass (ton)">
          <NumInput value={value.mass} min={0} step={0.5} onChange={v => patch({ mass: v })} />
        </Cell>
        <Cell label="Crew">
          <NumInput value={value.crew} min={0} step={0.5} onChange={v => patch({ crew: v })} />
        </Cell>
        <Cell label="Cost (gp)">
          <NumInput value={value.cost} min={0} integer onChange={v => patch({ cost: v })} />
        </Cell>
      </div>

      {!isWeapon && (
        <>
          <Switch
            checked={value.hittable}
            onChange={v => patch({ hittable: v })}
            label="Hittable"
          />
          <Switch
            checked={value.canCombine}
            onChange={v => patch({ canCombine: v })}
            label="Can combine cards"
          />
        </>
      )}

      {isWeapon && (
        <>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <Cell label="Damage (literal/fallback)">
              <input
                type="text"
                value={value.damage}
                onChange={e => patch({ damage: e.target.value })}
                className={INPUT}
                placeholder="e.g. 2d10"
              />
            </Cell>
            <Cell label="Reload steps (0 = every step)">
              <NumInput value={value.reloadSteps} min={0} integer onChange={v => patch({ reloadSteps: v })} />
            </Cell>
          </div>
          <Cell label="Damage formula (optional)">
            <input
              type="text"
              value={value.damageFormula}
              onChange={e => patch({ damageFormula: e.target.value })}
              className={INPUT}
              placeholder="{mass/10}d10"
            />
          </Cell>
          <div className="grid grid-cols-3 gap-2">
            <Cell label="Min range">
              <NumInput value={value.minRange} min={0} integer onChange={v => patch({ minRange: v })} />
            </Cell>
            <Cell label="Range">
              <NumInput value={value.range} min={0} integer onChange={v => patch({ range: v })} />
            </Cell>
            <Cell label="Max range">
              <NumInput value={value.maxRange} min={0} integer onChange={v => patch({ maxRange: v })} />
            </Cell>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Cell label="Area dimension (ft, 0 = single)">
              <NumInput value={value.magicDimension} min={0} integer onChange={v => patch({ magicDimension: v })} />
            </Cell>
            <Cell label="Area shape">
              <select
                value={value.shape}
                onChange={e => patch({ shape: e.target.value as ShipComponentTemplate['shape'] })}
                className={INPUT}
              >
                {['circle', 'cube', 'cone', 'line'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Cell>
            <Cell label="Save stat">
              <select
                value={value.savingThrow}
                onChange={e => patch({ savingThrow: e.target.value as ShipComponentTemplate['savingThrow'] })}
                className={INPUT}
              >
                {['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha', 'none'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Cell>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Cell label="Save DC">
              <NumInput value={value.saveDC} min={0} integer onChange={v => patch({ saveDC: v })} />
            </Cell>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={value.onSaveHalfOrNeg}
                onChange={e => patch({ onSaveHalfOrNeg: e.target.checked })}
                className="h-3.5 w-3.5 accent-yellow-400"
              />
              Half damage on a successful save
            </label>
          </div>
          <p className="text-[10px] text-gray-500">
            Damage formula overrides literal damage and resolves from the carrying ship's total mass,
            rounded up. Example: {'{mass/10}d10'} → 70t = 7d10. Reload steps: 0 = fire every step,
            4 = load four steps then fire on the fifth. Area dimension 0 = single target.
          </p>
          <Cell label="Weapon note">
            <textarea
              value={value.special}
              onChange={e => patch({ special: e.target.value })}
              rows={2}
              className={INPUT}
            />
          </Cell>
        </>
      )}

      {!isWeapon && (
        <Cell label="Effect / note">
          <textarea
            value={value.effect}
            onChange={e => patch({ effect: e.target.value })}
            rows={2}
            className={INPUT}
          />
        </Cell>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Cell label="AC">
          <NumInput value={value.ac} min={0} integer onChange={v => patch({ ac: v })} />
        </Cell>
        <Cell label="DT">
          <NumInput value={value.dt} min={0} integer onChange={v => patch({ dt: v })} />
        </Cell>
        <Cell label="Image URL">
          <input
            type="text"
            value={value.imageUrl}
            onChange={e => patch({ imageUrl: e.target.value })}
            className={INPUT}
            placeholder="https://…"
          />
        </Cell>
      </div>
    </fieldset>
  );
}
