// src/lib/mapEffects.ts
// Authored per-hex effects on a reusable map board (maps.hex_effects). Each hex
// holds ONE effect template reference; on scenario assign the refs are expanded
// into PERMANENT ground zones (one zone per template modifier) so the existing
// ground-effect runtime (membership/aura/DoT/entry/mp_cost/enter_org_max) applies.
import { EffectTemplate } from './effectTemplates';
import { GroundEffect } from '@/types/gameProtocol';

/** Authored per-hex effect on a library board: one template per hex. */
export type MapHexEffect = {
  q: number;
  r: number;
  /** The effect_templates row id. */
  effectId: string;
};

/** Sanitize the jsonb hex_effects blob: valid coords, one entry per hex. */
export function parseHexEffects(raw: any): MapHexEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: MapHexEffect[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const q = Math.round(Number((v as any).q));
    const r = Math.round(Number((v as any).r));
    const effectId = (v as any).effectId;
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
    if (typeof effectId !== 'string' || !effectId) continue;
    const k = `${q},${r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ q, r, effectId });
  }
  return out;
}

/**
 * Expand authored hex effects into permanent ground zones. A composite template
 * yields one zone per modifier (mirroring the in-scenario zone drop). Unknown
 * template ids are skipped.
 */
export function expandHexEffects(
  hexEffects: MapHexEffect[] | null | undefined,
  templates: Record<string, EffectTemplate>,
): GroundEffect[] {
  const out: GroundEffect[] = [];
  for (const he of hexEffects ?? []) {
    const t = templates[he.effectId];
    if (!t) continue;
    t.modifiers.forEach((m, i) => {
      out.push({
        key: `auto-${he.q},${he.r}-${i}`,
        q: he.q,
        r: he.r,
        name: t.name,
        color: t.color,
        ...(t.imageUrl ? { imageUrl: t.imageUrl } : {}),
        imageScale: t.imageScale,
        transparentBackground: t.transparentBackground,
        layer: t.layer,
        kind: m.kind as GroundEffect['kind'],
        delta: m.delta,
        ...(m.dice ? { dice: m.dice } : {}),
        ...(m.healing ? { healing: true } : {}),
        ...(m.savingThrow ? { savingThrow: m.savingThrow } : {}),
        ...(m.saveDC !== undefined ? { saveDC: m.saveDC } : {}),
        ...(m.onSaveHalfOrNeg !== undefined ? { onSaveHalfOrNeg: m.onSaveHalfOrNeg } : {}),
        zIndex: i,
        duration: 0,
        turnsLeft: 0,
        permanent: true,
        casterUnitId: null,
        casterTeam: null,
        casterPlayerId: null,
      });
    });
  }
  return out;
}
