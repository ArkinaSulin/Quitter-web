// src/packages/combat/lib/warMachine.ts
// War-machine bombardment: the to-hit roll that decides how many area markers a
// crew-served weapon places. Each landed shot becomes ONE AoE marker the player
// places over the target's troops (see `MagicCastModal`); the shell itself then
// deals area damage. Range/LoS/flag roll modes apply, so an advantage cancels a
// disadvantage exactly like a normal attack.
import { RollMode, rollD20 } from './unitCombat';

/**
 * Roll a war machine's `shots` to-hit attacks against `targetAc` and return how
 * many LANDED (each landed shot = one AoE marker to place). Natural 1 always
 * misses, natural 20 always hits; otherwise `d20 + attackBonus >= targetAc`.
 * `mode` (advantage/disadvantage) rolls two dice and takes the higher/lower.
 */
export function rollWarMachineHits(
  shots: number,
  attackBonus: number,
  targetAc: number,
  rng: () => number,
  mode: RollMode = 'normal',
): { hits: number; rolls: number[] } {
  const rolls: number[] = [];
  let hits = 0;
  for (let i = 0; i < shots; i++) {
    const r1 = rollD20(rng);
    const r2 = mode === 'normal' ? null : rollD20(rng);
    const roll = mode === 'advantage' ? Math.max(r1, r2!) : mode === 'disadvantage' ? Math.min(r1, r2!) : r1;
    rolls.push(roll);
    if (roll === 1) continue;
    if (roll === 20 || roll + attackBonus >= targetAc) hits++;
  }
  return { hits, rolls };
}
