// src/components/ScenarioMap/SoftEnforcementModals.tsx
// The 12 soft-enforcement prompts (over-budget / cap / conversion confirms).
// Pure rendering: the pending states + fully-bound action closures come from
// ScenarioMap; the bodies are text built from the states.
import { Unit, Hex } from '@/types/gameProtocol';
import { CombatOutcome } from '@/lib/unitCombat';
import { heroMovePerAction } from '@/lib/moveCost';
import { unitAttackCap } from '@/lib/attackCap';
import { getFormationChangeMpCost } from '@/lib/formationCost';
import { ConfirmModal } from './ConfirmModal';

export interface PendingMove {
  unit: Unit;
  targetHex: Hex;
  cost: number;
  attachedHero?: Unit | null;
}

export interface PendingAttack {
  attacker: Unit;
  target: Unit;
}

export interface PendingAttackCap {
  attacker: Unit;
  target: Unit;
  isCharging?: boolean;
}

export interface PendingRetaliationCap {
  attacker: Unit;
  target: Unit;
  overBudget: boolean;
  options: { isCharging?: boolean };
  outcome: CombatOutcome;
  retaliatorKilled: boolean;
  retaliatorRouted: boolean;
  reachSymmetric: boolean;
  retaliatorName: string;
  attacksUsed: number;
  cap: number;
}

export interface PendingHeroAttachConversion {
  hero: Unit;
  target: Unit;
  position: 'front' | 'back';
  actionsNeeded: number;
}

export interface PendingHeroSwapConversion {
  hero: Unit;
  actionsNeeded: number;
}

export interface PendingAttachOverBudget {
  hero: Unit;
  target: Unit;
  position: 'front' | 'back';
}

export interface PendingFormation {
  unit: Unit;
  formation: string;
}

export interface PendingChargeAttack {
  attacker: Unit;
  target: Unit;
}

export interface PendingChargeThrough {
  attacker: Unit;
  target: Unit;
  landHex: Hex;
  attachedHero?: Unit;
}

/** Offensive on an ally (friendly fire) or healing an enemy — soft cross-alliance confirm. */
export interface PendingCrossAlliance {
  attacker: Unit;
  target: Unit;
  kind: 'attack' | 'heal';
}

export interface SoftEnforcementModalsProps {
  pending: {
    move: PendingMove | null;
    attack: PendingAttack | null;
    attackCap: PendingAttackCap | null;
    retaliationCap: PendingRetaliationCap | null;
    heroAttachConversion: PendingHeroAttachConversion | null;
    heroSwapConversion: PendingHeroSwapConversion | null;
    attachOverBudget: PendingAttachOverBudget | null;
    swapOverBudget: Unit | null;
    formation: PendingFormation | null;
    castOverBudget: boolean;
    chargeAttack: PendingChargeAttack | null;
    chargeThrough: PendingChargeThrough | null;
    crossAlliance: PendingCrossAlliance | null;
  };
  /** Fully-bound confirm handlers (clear state + controlsLocked guard + act). */
  actions: {
    confirmMove: () => void;
    confirmAttack: () => void;
    confirmAttackCap: () => void;
    confirmRetaliationAllow: () => void;
    confirmRetaliationSuppress: () => void;
    confirmHeroAttachConversion: () => void;
    confirmHeroSwapConversion: () => void;
    confirmAttachOverBudget: () => void;
    confirmSwapOverBudget: () => void;
    confirmFormation: () => void;
    confirmCast: () => void;
    confirmChargeAttack: () => void;
    confirmChargeThrough: () => void;
    declineChargeThrough: () => void;
    confirmCrossAlliance: () => void;
  };
  cancels: {
    move: () => void;
    attack: () => void;
    attackCap: () => void;
    retaliationCap: () => void;
    heroAttachConversion: () => void;
    heroSwapConversion: () => void;
    attachOverBudget: () => void;
    swapOverBudget: () => void;
    formation: () => void;
    castOverBudget: () => void;
    chargeAttack: () => void;
    crossAlliance: () => void;
  };
  unitMaxMP: (unit: Unit) => number;
}

export function SoftEnforcementModals({ pending, actions, cancels, unitMaxMP }: SoftEnforcementModalsProps) {
  const p = pending;
  return (
    <>
      {p.move && (
        <ConfirmModal
          tone="red"
          title="Move over budget?"
          buttons={[{ label: 'Yes, move anyway', variant: 'red', onClick: actions.confirmMove }]}
          onCancel={cancels.move}
        >
          {p.move.attachedHero
            ? `${p.move.unit.unitName} + ${p.move.attachedHero.unitName} need ${p.move.cost} MP to reach (${p.move.targetHex.q}, ${p.move.targetHex.r}), but ${p.move.unit.unitName} has ${p.move.unit.actionsAvailable} and ${p.move.attachedHero.unitName} has ${p.move.attachedHero.actionsAvailable} action(s) left.`
            : `${p.move.unit.unitName} needs ${p.move.cost} MP (${p.move.unit.isHero
                ? `${Math.ceil(p.move.cost / heroMovePerAction(unitMaxMP(p.move.unit)))} action(s) at ${heroMovePerAction(unitMaxMP(p.move.unit))} MP/action`
                : `${Math.ceil(p.move.cost / Math.max(1, unitMaxMP(p.move.unit)))} action(s)`}) to reach (${p.move.targetHex.q}, ${p.move.targetHex.r}), but has ${p.move.unit.actionsAvailable} action(s) left.`}
        </ConfirmModal>
      )}

      {p.attack && (
        <ConfirmModal
          tone="red"
          title="Attack with no actions?"
          buttons={[{ label: 'Yes, attack anyway', variant: 'red', onClick: actions.confirmAttack }]}
          onCancel={cancels.attack}
        >
          {p.attack.attacker.unitName} has no actions left, but can still attack {p.attack.target.unitName}.
        </ConfirmModal>
      )}

      {p.attackCap && (
        <ConfirmModal
          tone="amber"
          title={`Attack past the ${unitAttackCap()}-attack cap?`}
          buttons={[{ label: 'Yes, attack anyway', variant: 'red', onClick: actions.confirmAttackCap }]}
          onCancel={cancels.attackCap}
        >
          {p.attackCap.attacker.unitName} has already attacked {p.attackCap.attacker.attacksUsed}/{unitAttackCap()} times this turn
          {p.attackCap.attacker.isCharging ? ' (charge attack)' : ''}. Attack {p.attackCap.target.unitName} anyway?
        </ConfirmModal>
      )}

      {p.retaliationCap && (
        <ConfirmModal
          tone="amber"
          title={`Retaliation past the ${p.retaliationCap.cap}-attack cap?`}
          buttons={[
            { label: 'Yes, allow retaliation', variant: 'red', onClick: actions.confirmRetaliationAllow },
            { label: 'No, suppress retaliation', onClick: actions.confirmRetaliationSuppress },
          ]}
          onCancel={cancels.retaliationCap}
        >
          {p.retaliationCap.retaliatorName} has already attacked {p.retaliationCap.attacksUsed}/{p.retaliationCap.cap} times this turn.
          Allow it to retaliate against {p.retaliationCap.target.unitName} anyway?
        </ConfirmModal>
      )}

      {p.heroAttachConversion && (
        <ConfirmModal
          tone="amber"
          title="Convert actions to 1 MP?"
          buttons={[{ label: 'Convert and attach', variant: 'green', onClick: actions.confirmHeroAttachConversion }]}
          onCancel={cancels.heroAttachConversion}
        >
          {p.heroAttachConversion.hero.unitName} has {Math.floor(Math.max(0, p.heroAttachConversion.hero.movementPointsAvailable))} MP but attaching costs 1 MP.
          Convert {p.heroAttachConversion.actionsNeeded} action{p.heroAttachConversion.actionsNeeded > 1 ? 's' : ''}
          {p.heroAttachConversion.actionsNeeded > 1 ? ` (+${Math.round(heroMovePerAction(unitMaxMP(p.heroAttachConversion.hero)) * p.heroAttachConversion.actionsNeeded * 10) / 10} MP)` : ''}
          to attach to {p.heroAttachConversion.target.unitName} ({p.heroAttachConversion.position})?
        </ConfirmModal>
      )}

      {p.heroSwapConversion && (
        <ConfirmModal
          tone="amber"
          title="Convert actions to 1 MP?"
          buttons={[{ label: 'Convert and swap', variant: 'green', onClick: actions.confirmHeroSwapConversion }]}
          onCancel={cancels.heroSwapConversion}
        >
          {p.heroSwapConversion.hero.unitName} has {Math.floor(Math.max(0, p.heroSwapConversion.hero.movementPointsAvailable))} MP but swapping position costs 1 MP.
          Convert {p.heroSwapConversion.actionsNeeded} action{p.heroSwapConversion.actionsNeeded > 1 ? 's' : ''} to swap to the {p.heroSwapConversion.hero.attachedPosition === 'back' ? 'front' : 'back'}?
        </ConfirmModal>
      )}

      {p.attachOverBudget && (
        <ConfirmModal
          tone="red"
          title="Attach with no MP?"
          buttons={[{ label: 'Yes, attach anyway', variant: 'red', onClick: actions.confirmAttachOverBudget }]}
          onCancel={cancels.attachOverBudget}
        >
          {p.attachOverBudget.hero.unitName} has no MP or actions left, but can still attach to {p.attachOverBudget.target.unitName} ({p.attachOverBudget.position}).
        </ConfirmModal>
      )}

      {p.swapOverBudget && (
        <ConfirmModal
          tone="red"
          title="Swap position with no MP?"
          buttons={[{ label: 'Yes, swap anyway', variant: 'red', onClick: actions.confirmSwapOverBudget }]}
          onCancel={cancels.swapOverBudget}
        >
          {p.swapOverBudget.unitName} has no MP or actions left, but can still move to the {p.swapOverBudget.attachedPosition === 'back' ? 'front' : 'back'}.
        </ConfirmModal>
      )}

      {p.formation && (
        <ConfirmModal
          tone="red"
          title="Change formation over budget?"
          buttons={[{ label: 'Yes, change anyway', variant: 'red', onClick: actions.confirmFormation }]}
          onCancel={cancels.formation}
        >
          {p.formation.unit.unitName} needs {getFormationChangeMpCost(unitMaxMP(p.formation.unit))} MP (1 action) to form {p.formation.formation}, but has {p.formation.unit.actionsAvailable} action(s) left.
        </ConfirmModal>
      )}

      {p.castOverBudget && (
        <ConfirmModal
          tone="red"
          title="Cast with no actions?"
          buttons={[{ label: 'Yes, cast anyway', variant: 'red', onClick: actions.confirmCast }]}
          onCancel={cancels.castOverBudget}
        >
          The caster has no actions left, but can still cast the spell.
        </ConfirmModal>
      )}

      {p.chargeAttack && (
        <ConfirmModal
          tone="amber"
          title="Charge incomplete?"
          buttons={[{ label: 'Yes, attack normally', variant: 'amber', onClick: actions.confirmChargeAttack }]}
          onCancel={cancels.chargeAttack}
        >
          {p.chargeAttack.attacker.unitName} attacks before completing its 2-hex charge — this loses the free charge attack. Attack as normal instead (costs 1 action)?
        </ConfirmModal>
      )}

      {p.chargeThrough && (
        <ConfirmModal
          tone="amber"
          title="Charge over?"
          buttons={[
            { label: 'Yes, charge over', variant: 'amber', onClick: actions.confirmChargeThrough },
            { label: 'No, stop here', onClick: actions.declineChargeThrough },
          ]}
        >
          {p.chargeThrough.attacker.unitName} can charge over {p.chargeThrough.target.unitName} and land at ({p.chargeThrough.landHex.q}, {p.chargeThrough.landHex.r}) for 2 MP.
        </ConfirmModal>
      )}

      {p.crossAlliance && (
        <ConfirmModal
          tone="amber"
          title={p.crossAlliance.kind === 'attack' ? 'Friendly fire?' : 'Heal an enemy?'}
          buttons={[
            { label: p.crossAlliance.kind === 'attack' ? 'Yes, attack anyway' : 'Yes, heal anyway', variant: 'red', onClick: actions.confirmCrossAlliance },
          ]}
          onCancel={cancels.crossAlliance}
        >
          {p.crossAlliance.kind === 'attack'
            ? `${p.crossAlliance.attacker.unitName} attacks ${p.crossAlliance.target.unitName}, who is in the same alliance. Attack anyway? (friendly fire)`
            : `${p.crossAlliance.attacker.unitName} heals ${p.crossAlliance.target.unitName}, who is in a different alliance. Heal an enemy anyway?`}
        </ConfirmModal>
      )}
    </>
  );
}
