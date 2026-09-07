// src/lib/terms.ts
// A shared, plain-language glossary for the whole UI: every abbreviation and
// wargame term QuiTTER uses, explained in one concise line each. Surfaces:
// the TopBar "?" glossary modal, tooltips, and future in-panel help.
export interface Term {
  /** The abbreviation (may be undefined for named concepts). */
  abbr?: string;
  /** The full name / what it stands for. */
  name: string;
  /** One crisp, non-wargamer explanation. */
  explain: string;
}

export const TERMS: Term[] = [
  { abbr: 'AC', name: 'Armor Class', explain: 'How hard it is to hurt the unit. A d20 attack roll plus bonuses must equal or beat AC to hit.' },
  { abbr: 'AGR', name: 'Aggressiveness', explain: 'The unit’s will to attack (1–10). It rolls a d10; roll ≤ AGR to attack. Failing means hesitation — no attack that action.' },
  { abbr: 'MOR', name: 'Morale', explain: 'The unit’s will to keep fighting. When effective morale drops to 0 or below after an attack, the unit ROUTS (breaks and flees).' },
  { abbr: 'MP', name: 'Movement Points', explain: 'The currency of moving on the hex map. Each hex usually costs 1 MP to enter; one action converts to a full movement pool.' },
  { abbr: 'HP', name: 'Hit Points', explain: 'Unit health. Non-hero damage is spread across troops; heroes use it directly.' },
  { abbr: 'Troops', name: 'Troops', explain: 'The individual soldiers in a unit — drawn as dots/triangles. Each has its own HP; one hit kills at most one troop.' },
  { abbr: 'HD', name: 'Hit Dice', explain: 'A unit’s level. Higher levels are scarier (they project more threat) and can fight above their weight.' },
  { abbr: 'DoT', name: 'Damage over Time', explain: 'A burning-style effect that damages the target on each turn (tick) instead of all at once.' },
  { abbr: 'ZoC', name: 'Zone of Control', explain: 'The front hexes a formed unit controls — enemies can land there but cannot move through them.' },
  { abbr: 'Kill zone', name: 'Kill zone', explain: 'The two hexes directly in front of a unit. This is the only place a unit threatens the enemy’s morale.' },
  { abbr: '2H', name: 'Two-handed', explain: 'The weapon needs both hands — you cannot use a shield or form Shield Wall while holding it (AC drops by 2).' },
  { abbr: 'F', name: 'Free action', explain: 'Using this weapon does not cost an action.' },
  { abbr: 'NR', name: 'No retaliation', explain: 'This attack cannot be struck back at (it is safe to use).' },
  { abbr: 'Reach', name: 'Reach', explain: 'A long weapon (pike, lance). The side with reach usually strikes first in a fight.' },
  { abbr: 'Rout', name: 'Rout', explain: 'When a unit’s morale breaks it Routs: white flag, it can only flee, cannot attack or hold formation.' },
  { abbr: 'Rally', name: 'Rally', explain: 'Recovering a routed unit by adopting a formed formation when its morale is above 0.' },
  { abbr: 'Charge', name: 'Charge', explain: 'A head-on run into the enemy’s front. A full charge (2+ hexes) lands a free double-damage attack, but the unit drops one formation level.' },
  { abbr: 'Rear/Flank', name: 'Rear / Flank', explain: 'Where an attack comes from relative to the target’s facing. Rear: no retaliation and no will-to-attack check. Flank: weakened retaliation. Front: full.' },
  { abbr: 'Disadvantage', name: 'Disadvantage', explain: 'Roll two d20 and keep the lower. Shooting between a weapon’s range and max range is at disadvantage.' },
  { abbr: 'Save / DC', name: 'Saving throw / Difficulty Class', explain: 'Area spells let each affected troop roll d20 + its save bonus; meeting the spell’s DC means it saved (half damage or none).' },
  { abbr: 'Range / Max range', name: 'Range', explain: 'Range = full effect. Between range and max range you shoot at disadvantage. Beyond max range is out of reach.' },
  { abbr: 'Scattered', name: 'Scattered', explain: 'Loose, no formation: moves any direction at full speed, hard to hit with arrows, but fights poorly when caught.' },
  { abbr: 'Open Order', name: 'Open Order', explain: 'Standard loose-but-ordered line: flexible movement, ordinary combat.' },
  { abbr: 'Close Order', name: 'Close Order', explain: 'A tight line: fights harder, but moves slower and cannot turn around when mounted.' },
  { abbr: 'Phalanx', name: 'Phalanx', explain: 'A very dense spear wall: deadly from the front, slow, hard to break in melee.' },
  { abbr: 'Shield Wall', name: 'Shield Wall', explain: 'Interlocked shields: +AC and morale, slow; you cannot carry a two-handed weapon inside it.' },
  { abbr: 'Hero', name: 'Hero', explain: 'A named character token (portrait + HP). Heroes act with 5 actions, never rout, and can attach to units.' },
  { abbr: 'Unit', name: 'Unit', explain: 'A block of troops (dots) commanded as one token.' },
  { abbr: 'Attach', name: 'Attach (hero)', explain: 'A hero joining a unit — Front (leader, shares damage, steadying the troops) or Back (protected, safe until the host falls).' },
  { abbr: 'Effect', name: 'Effect', explain: 'A temporary buff/debuff/DoT placed on a unit or zone (e.g. Bless, Bane, Burning). Duration counts the caster’s own activations.' },
  { abbr: 'Caster activation', name: 'Caster activation', explain: 'Effects tick when the caster’s side takes its turn — so “3 turns” means 3 of the caster’s turns.' },
  { abbr: 'Tempo', name: 'Tempo', explain: 'Whose turn “counts” for an effect’s clock — used when a GM places an effect without a caster.' },
  { abbr: 'Friendly/Enemy/Neutral', name: 'Alliances', explain: 'Team groupings that decide who you fight with. Turn order runs friendly → enemy → neutral.' },
  { abbr: 'Free move', name: 'Free Move', explain: 'Setup mode where movement and actions cost nothing (usually Turn 0 / before the battle).' },
  { abbr: 'Undo', name: 'Undo', explain: 'Rewind the last action (Ctrl+Z). Everyone shares one history; undo removes the move, attack, or rout it caused.' },
  { abbr: 'Replay', name: 'Replay', explain: 'Watch the whole battle again as it happened, step by step.' },
];

/** Format one entry as plain text for copy/share. */
export function termText(t: Term): string {
  return t.abbr ? `${t.abbr} — ${t.name}: ${t.explain}` : `${t.name}: ${t.explain}`;
}
