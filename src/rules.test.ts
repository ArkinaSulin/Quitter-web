import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Meta-test: a "universal rule" must have exactly ONE implementation. These
// checks scan the package sources and fail if a known primitive is re-derived
// outside its canonical home. Add a case whenever a new universal rule lands
// (see docs/dev/00-universal-rules.md).
const SRC = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

function packageSourceFiles(): string[] {
  const root = path.join(SRC, 'packages');
  const out: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  })(root);
  return out;
}

function rel(p: string): string {
  return path.relative(SRC, p).replace(/\\/g, '/');
}

/** Files (relative) whose contents match `re`. */
function filesMatching(re: RegExp, only: (p: string) => boolean = () => true): string[] {
  return packageSourceFiles()
    .filter(p => !/_?\.?test\.tsx?$/.test(p) && only(p))
    .filter(p => re.test(fs.readFileSync(p, 'utf8')))
    .map(rel);
}

describe('one rule, one implementation', () => {
  it('d20 rolls live only in primitives/lib/damage.ts', () => {
    const hits = filesMatching(/Math\.floor\([^\n]*\*\s*20\)\s*\+\s*1/g);
    expect(hits).toEqual(['packages/primitives/lib/damage.ts']);
  });

  it('the fly-pool composition lives only in movement/lib/flying.ts', () => {
    const hits = filesMatching(/isAirborne\([^)]*\)\s*&&\s*canFly\(/g);
    expect(hits).toEqual(['packages/movement/lib/flying.ts']);
  });

  it('damage is clamped through primitives/lib/damage.ts (no local clamps on rolls)', () => {
    // No `Math.max(0, rollDamage(...))` (the old wall/structure pattern).
    expect(filesMatching(/Math\.max\(0,\s*rollDamage\(/g)).toEqual([]);
    // No `Math.min(rawDamage, ...)` (the old attack-cap pattern).
    expect(filesMatching(/Math\.min\(\s*rawDamage/g)).toEqual([]);
  });
});
