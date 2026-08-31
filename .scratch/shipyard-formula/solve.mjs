// QuiVER shipyard formula hunt — verify the HTML calculator against the 17
// reference presets, then search rounding/weight variants that match ALL.
import { components, referenceShips } from './data.mjs';

const NUMERIC_COLS = [0, 1, 2, 3, 4, 5, 6, 7, 10]; // capacity..crew + cost
const TEXT_COLS = [8, 9];

function parseValue(value) {
  if (value == null) return { kind: 'direct', num: 0, display: '0' };
  if (typeof value === 'string' && value.endsWith('%')) {
    const n = parseFloat(value.slice(0, -1));
    if (Number.isNaN(n)) return { kind: 'error', num: 0, display: value };
    return { kind: 'percent', num: n / 100, display: value };
  }
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (Number.isNaN(n)) return { kind: 'error', num: 0, display: String(value) };
  return { kind: 'direct', num: n, display: String(value) };
}

const triangular = (n) => (n * (n + 1)) / 2;

function componentValue(compKey, option, col) {
  const def = components[compKey];
  if (def.inputType === 'dropdown') return def.values[option]?.[col];
  return def.values[col];
}

function numeric(compKey, option, col) {
  const v = componentValue(compKey, option, col);
  const p = parseValue(v);
  return p.kind === 'percent' ? p.num : p.num;
}

// Variant knobs for the HP hunt:
//   hpRound: 'floor' | 'round' | 'round5' | 'round10'
//   hpTruncateComponents: truncate each fractional component contribution toward zero first
export function computeShip(ship, opts = {}) {
  const {
    hpRound = 'floor',
    hpTruncateComponents = false,
  } = opts;

  const defs = components;
  const frameKey = ship.frame;
  const armorKey = ship.armor;
  const c = ship.components;
  const specialKey = c.special || '';

  const frameRow = defs.frame.values[frameKey];
  const armorRow = defs.armor.values[armorKey];
  const specialRow = defs.special.values[specialKey];

  const armorCap = parseValue(armorRow[0]);
  const armorHp = parseValue(armorRow[1]);
  const armorCost = parseValue(armorRow[10]);
  const specialCap = parseValue(specialRow[0]);
  const specialHp = parseValue(specialRow[1]);
  const specialCost = parseValue(specialRow[10]);

  // --- per-component scaled rows (numbers multiply, dropdowns are literal) ---
  const compKeys = ['helm', 'keel', 'sail', 'rudder', 'cargo', 'stdWeapon', 'largeWeapon', 'hullReinforcement', 'additionalCrew'];
  const mult = { helm: c.helm, keel: c.keel ?? 1, sail: c.sail, rudder: c.rudder, cargo: c.cargo, stdWeapon: c.stdWeapon, largeWeapon: c.largeWeapon, hullReinforcement: c.hullReinforcement, additionalCrew: c.additionalCrew };

  const scaled = {};
  for (const k of compKeys) {
    scaled[k] = defs[k].values.map((v) => (typeof v === 'string' ? v : v * (mult[k] || 0)));
  }

  // --- CAPACITY (col 0) ---
  let capacity;
  if (specialCap.kind === 'percent') {
    capacity = frameRow[0] * (1 + armorCap.num + specialCap.num);
  } else {
    capacity = frameRow[0] * (1 + armorCap.num) + specialCap.num;
  }
  for (const k of compKeys) capacity += numeric(k, null, 0) * (mult[k] || 0);

  // --- HP (col 1) ---
  let hp;
  if (specialHp.kind === 'percent') {
    hp = frameRow[1] * (1 + armorHp.num + specialHp.num);
  } else {
    hp = frameRow[1] * (1 + armorHp.num) + specialHp.num;
  }
  const trunc = (x) => Math.trunc(x);
  for (const k of compKeys) {
    let contrib = defs[k].values[1] * (mult[k] || 0);
    if (hpTruncateComponents) contrib = trunc(contrib);
    hp += contrib;
  }

  const roundTo = (x, step) => Math.round(x / step) * step;
  const hpFinal =
    hpRound === 'floor' ? Math.floor(hp)
    : hpRound === 'round' ? Math.round(hp)
    : hpRound === 'round5' ? roundTo(hp, 5)
    : roundTo(hp, 10);

  // --- DT (col 2) ---
  let dt = frameRow[2] + armorRow[2] + specialRow[2];
  for (const k of compKeys) dt += defs[k].values[2] * (mult[k] || 0);

  // --- TARGET AREA (col 3): per-component min 1 / max 10 (0 stays 0) ---
  const targetAreas = {};
  let totalTargetArea = 0;
  for (const k of ['frame', 'armor', ...compKeys, 'special']) {
    let ta;
    if (k === 'frame') ta = frameRow[3];
    else if (k === 'armor') ta = armorRow[3];
    else if (k === 'special') ta = specialRow[3];
    else ta = defs[k].values[3] * (mult[k] || 0);
    let fin = Math.max(0, ta);
    if (fin > 0) fin = Math.max(1, Math.min(10, fin));
    targetAreas[k] = { original: ta, value: fin };
    totalTargetArea += fin;
  }

  // --- CARGO (col 4) ---
  let cargo = frameRow[4] + c.cargo * 5;
  for (const k of compKeys) if (k !== 'cargo') cargo += defs[k].values[4] * (mult[k] || 0);

  // --- SPEED (col 5) ---
  const frameSize = frameKey === 'Small' ? 1 : frameKey === 'Medium' ? 2 : 3;
  const base = 2 * (frameSize - 1);
  let x = 0;
  while (triangular(x + 1) <= c.sail) x++;
  const speed = Math.min(9, Math.max(0, Math.floor(x - base)));

  // --- MANEUVER (col 6) ---
  let maneuver = 0;
  if (frameSize === 1) maneuver = c.rudder >= 1 ? (c.rudder > 1 ? 1 : 2) : 0;
  else if (frameSize === 2) maneuver = c.rudder >= 2 ? (c.rudder > 2 ? 2 : 3) : 0;
  else maneuver = c.rudder >= 3 ? (c.rudder > 3 ? 3 : 4) : 0;

  // --- CREW (col 7) + special modifier ---
  let crew = 0;
  for (const k of compKeys) crew += defs[k].values[7] * (mult[k] || 0);
  const specialCrew = parseValue(specialRow[7]).num;
  crew += specialCrew;

  // --- COST (col 10) ---
  const frameCost = frameRow[10];
  let otherDirect = 0;
  for (const k of compKeys) otherDirect += defs[k].values[10] * (mult[k] || 0);
  let cost;
  if (specialCost.kind === 'percent') {
    cost = Math.floor(frameCost * (1 + armorCost.num + specialCost.num) + otherDirect);
  } else {
    cost = Math.floor(frameCost * (1 + armorCost.num) + otherDirect + specialCost.num);
  }

  // --- AC ---
  const ac = armorRow[11];

  return {
    capacity: Math.floor(capacity),
    hp: hpFinal,
    dt: Math.floor(dt),
    targetArea: Math.floor(totalTargetArea),
    cargo: Math.floor(cargo),
    speed,
    maneuver,
    crew: Math.floor(crew),
    cost,
    ac,
    targetAreas,
  };
}

function verify(variantName, opts) {
  let ok = 0;
  const failures = [];
  for (const [name, ship] of Object.entries(referenceShips)) {
    const s = computeShip(ship, opts);
    const p = ship.preset;
    const diffs = [];
    for (const stat of ['hp', 'damageThreshold', 'speed', 'maneuver', 'crew', 'cargo', 'cost']) {
      const key = stat === 'damageThreshold' ? 'dt' : stat;
      if (s[key] !== p[stat]) diffs.push(`${stat}: calc ${s[key]} vs preset ${p[stat]}`);
    }
    if (diffs.length === 0) ok++;
    else failures.push({ name, diffs });
  }
  return { variantName, ok, total: Object.keys(referenceShips).length, failures };
}

console.log('=== Baseline: HTML formula (floor) ===');
let r = verify('floor', {});
console.log(`${r.ok}/${r.total} match`);
for (const f of r.failures) console.log(`  ${f.name}: ${f.diffs.join('; ')}`);

console.log('\n=== HP rounding variants ===');
for (const hpRound of ['floor', 'round', 'round5', 'round10']) {
  for (const hpTruncateComponents of [false, true]) {
    const rr = verify(`hp=${hpRound} trunc=${hpTruncateComponents}`, { hpRound, hpTruncateComponents });
    const names = rr.failures.map((f) => f.name).join(', ');
    console.log(`${rr.variantName}: ${rr.ok}/${rr.total}  [mismatch: ${names || 'none'}]`);
  }
}

// Per-ship HP detail for the best candidates
console.log('\n=== HP detail: round10, no truncation ===');
for (const [name, ship] of Object.entries(referenceShips)) {
  const s = computeShip(ship, { hpRound: 'round10' });
  const mark = s.hp === ship.preset.hp ? 'OK ' : 'MISS';
  console.log(`${mark} ${name.padEnd(15)} calc ${String(s.hp).padStart(4)} preset ${String(ship.preset.hp).padStart(4)}`);
}

// Turtle cost outlier: what multiplier/weights reproduce 60200?
console.log('\n=== Turtle cost hunt ===');
{
  const turtle = referenceShips['Turtle Ship'];
  const frameCost = components.frame.values.Large[10]; // 20000
  const armorCost = components.armor.values.Metal[10]; // 100%
  const specialCost = components.special.values['Enclosed design -20% Capacity'][10]; // 30%
  let otherDirect = 0;
  for (const k of ['helm', 'sail', 'rudder', 'cargo', 'stdWeapon', 'largeWeapon', 'hullReinforcement', 'additionalCrew']) {
    otherDirect += components[k].values[10] * (turtle.components[k] || 0);
  }
  console.log(`frame ${frameCost}, armor ${armorCost}, special ${specialCost}, components ${otherDirect}`);
  console.log(`formula %: ${Math.floor(frameCost * (1 + 1 + 0.3) + otherDirect)} (preset 60200)`);
  console.log(`frame-only % (no special): ${Math.floor(frameCost * (1 + 1) + otherDirect)}`);
  console.log(`special as direct 30% of frame: ${Math.floor(frameCost * (1 + 1) + otherDirect + 0.3 * frameCost)}`);
  // What special % fits?  (60200 - otherDirect)/frameCost - 1 - armor
  const need = (60200 - otherDirect) / frameCost;
  console.log(`required total multiplier: ${need.toFixed(4)} → special % = ${((need - 1 - 1) * 100).toFixed(2)}% (labeled 30%)`);
  // Maybe hull cost differs? Try hull cost 50/150:
  for (const hullCost of [50, 100, 150, 200]) {
    const comps = otherDirect - 12 * 100 + 12 * hullCost;
    console.log(`hull cost ${hullCost}: ${Math.floor(frameCost * 2.3 + comps)}`);
  }
}

// === Integer-weight HP search: does a clean integer set match 17/17? ===
console.log('\n=== Integer weight search (HP = round10(base + weights)) ===');
{
  const candidates = [];
  for (let sail = -8; sail <= 0; sail++) {
    for (let hull = 0; hull <= 8; hull++) {
      for (let helm = -6; helm <= 0; helm++) {
        let ok = 0;
        const misses = [];
        for (const [name, ship] of Object.entries(referenceShips)) {
          const c = ship.components;
          const frameRow = components.frame.values[ship.frame];
          const armorRow = components.armor.values[ship.armor];
          const specialRow = components.special.values[c.special || ''];
          const armorHp = parseValue(armorRow[1]);
          const specialHp = parseValue(specialRow[1]);
          let base;
          if (specialHp.kind === 'percent') base = frameRow[1] * (1 + armorHp.num + specialHp.num);
          else base = frameRow[1] * (1 + armorHp.num) + specialHp.num;
          const total = base
            + helm * (c.helm || 0)
            + sail * (c.sail || 0)
            + 0 * (c.rudder || 0)
            + 0 * (c.stdWeapon || 0)
            + 0 * (c.largeWeapon || 0)
            + hull * (c.hullReinforcement || 0);
          const hp = Math.round(total / 10) * 10;
          if (hp === ship.preset.hp) ok++;
          else misses.push(`${name}:${hp}`);
        }
        candidates.push({ ok, sail, hull, helm, misses });
      }
    }
  }
  candidates.sort((a, b) => b.ok - a.ok);
  for (const c of candidates.slice(0, 5)) {
    console.log(`ok=${c.ok}/17  sail=${c.sail} hull=${c.hull} helm=${c.helm} rudder/stdW/largeW=0  misses: ${c.misses.join(' ')}`);
  }
}
