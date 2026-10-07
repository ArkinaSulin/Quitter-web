// src/components/ScenarioMap/SoftEnforcementModals.tsx
// The soft-enforcement prompts (over-budget / cap / conversion confirms).
// Pure rendering: the pending states + fully-bound action closures come from
// ScenarioMap; the bodies are text built from the states.
import { Unit, Hex } from '@/types/gameProtocol';
import { EdgeRef } from '@/packages/movement';
import { heroMovePerAction } from '@/packages/movement';
import { unitAttackCap } from '@/packages/combat';
import { getFormationChangeMpCost } from '@/packages/movement';
import { flyMax } from '@/packages/movement';
import { ConfirmModal } from './ConfirmModal';

export interface PendingMove {
  unit: Unit;
  targetHex: Hex;
  cost: number;
  attachedHero?: Unit | null;
  breakToFormation?: string;
  /** Set when the over-budget move is a CLIMB (up/down a structure edge): the
   *  confirm resumes `handleClimbMove` from this origin surface. */
  climb?: { originSurface: number };
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

export interface PendingHeroAttachConversion {
  hero: Unit;
  target: Unit;
  position: 'front' | 'back' | 'rider';
  /** The host hex's entry cost (MP) the hero must pay to attach. */
  cost: number;
  actionsNeeded: number;
}

export interface PendingAttachOverBudget {
  hero: Unit;
  target: Unit;
  position: 'front' | 'back' | 'rider';
  /** The host hex's entry cost (MP) the hero could not afford. */
  cost: number;
}

export interface PendingFormation {
  unit: Unit;
  formation: string;
  /** Which pool the change draws from — airborne units pay from the fly pool. */
  mode: 'ground' | 'fly';
}

/** A rotate / about-turn with no MP and no convertible action — confirm first. */
export interface PendingRotate {
  unit: Unit;
  direction: 'left' | 'right';
  /** 1 = a 60° rotate; 3 = a 180° about-turn. */
  steps: number;
  /** The MP/FP the rotate costs. */
  cost: number;
  /** Which pool label to show in the prompt. */
  poolLabel: 'MP' | 'FP';
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

/**
 * The active weapon can't reach, and MORE THAN ONE weapon can: confirm a switch
 * to the first reaching weapon before attacking (single button — a caster with
 * many spells would otherwise flood the screen). Cancel leaves the weapon as-is.
 */
export interface PendingWeaponSwitch {
  attacker: Unit;
  target: Unit;
  /** Index (into the attacker's parsed weapons) of the offered/first weapon. */
  index: number;
  /** Display label of the offered weapon (incl. cost). */
  label: string;
  /** Name of the weapon currently held (for the message). */
  activeName: string;
  /** Options preserved when the attack resumes after the switch. */
  options?: { forceCast?: boolean };
}

/** Attacking a barrier/hex structure over budget / past the attack cap. */
export interface PendingWallAttack {
  attacker: Unit;
  /** Edge structure target (walls/spikes). */
  ref?: EdgeRef;
  /** Hex structure target (gates/towers). */
  hex?: Hex;
  /** Human label for the target, e.g. "(0,0) ⇄ (1,0)" or "(2,1)". */
  label: string;
  overBudget: boolean;
  overCap: boolean;
}

export interface SoftEnforcementModalsProps {
  pending: {
    move: PendingMove | null;
    attack: PendingAttack | null;
    attackCap: PendingAttackCap | null;
    heroAttachConversion: PendingHeroAttachConversion | null;
    attachOverBudget: PendingAttachOverBudget | null;
    formation: PendingFormation | null;
    rotate: PendingRotate | null;
    castOverBudget: boolean;
    chargeAttack: PendingChargeAttack | null;
    chargeThrough: PendingChargeThrough | null;
    weaponSwitch: PendingWeaponSwitch | null;
    wallAttack: PendingWallAttack | null;
  };
  /** Fully-bound confirm handlers (clear state + controlsLocked guard + act). */
  actions: {
    confirmMove: () => void;
    confirmAttack: () => void;
    confirmAttackCap: () => void;
    confirmHeroAttachConversion: () => void;
    confirmAttachOverBudget: () => void;
    confirmFormation: () => void;
    confirmRotate: () => void;
    confirmCast: () => void;
    confirmChargeAttack: () => void;
    confirmChargeThrough: () => void;
    declineChargeThrough: () => void;
    confirmWeaponSwitch: () => void;
    confirmWallAttack: () => void;
  };
  cancels: {
    move: () => void;
    attack: () => void;
    attackCap: () => void;
    heroAttachConversion: () => void;
    attachOverBudget: () => void;
    formation: () => void;
    rotate: () => void;
    castOverBudget: () => void;
    chargeAttack: () => void;
    weaponSwitch: () => void;
    wallAttack: () => void;
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
          title={p.move.climb ? 'Climb over budget?' : 'Move over budget?'}
          buttons={[{ label: p.move.climb ? 'Yes, climb anyway' : 'Yes, move anyway', variant: 'red', onClick: actions.confirmMove }]}
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

      {p.heroAttachConversion && (
        <ConfirmModal
          tone="amber"
          title="Convert actions to 1 MP?"
          buttons={[{ label: 'Convert and attach', variant: 'green', onClick: actions.confirmHeroAttachConversion }]}
          onCancel={cancels.heroAttachConversion}
        >
          {p.heroAttachConversion.hero.unitName} has {Math.floor(Math.max(0, p.heroAttachConversion.hero.movementPointsAvailable))} MP but attaching costs {p.heroAttachConversion.cost} MP.
          Convert {p.heroAttachConversion.actionsNeeded} action{p.heroAttachConversion.actionsNeeded > 1 ? 's' : ''}
          {p.heroAttachConversion.actionsNeeded > 1 ? ` (+${Math.round(heroMovePerAction(unitMaxMP(p.heroAttachConversion.hero)) * p.heroAttachConversion.actionsNeeded * 10) / 10} MP)` : ''}
          to attach to {p.heroAttachConversion.target.unitName} ({p.heroAttachConversion.position})?
        </ConfirmModal>
      )}

      {p.attachOverBudget && (
        <ConfirmModal
          tone="red"
          title="Attach over budget?"
          buttons={[{ label: 'Yes, attach anyway', variant: 'red', onClick: actions.confirmAttachOverBudget }]}
          onCancel={cancels.attachOverBudget}
        >
          {p.attachOverBudget.hero.unitName} cannot afford the {p.attachOverBudget.cost} MP to enter {p.attachOverBudget.target.unitName}'s hex, but can still attach to {p.attachOverBudget.target.unitName} ({p.attachOverBudget.position}).
        </ConfirmModal>
      )}

      {p.formation && (
        <ConfirmModal
          tone="red"
          title="Change formation over budget?"
          buttons={[{ label: 'Yes, change anyway', variant: 'red', onClick: actions.confirmFormation }]}
          onCancel={cancels.formation}
        >
          {p.formation.unit.unitName} needs {getFormationChangeMpCost(p.formation.mode === 'fly' ? flyMax(p.formation.unit) : unitMaxMP(p.formation.unit))} {p.formation.mode === 'fly' ? 'FP' : 'MP'} (1 action) to form {p.formation.formation}, but has {p.formation.unit.actionsAvailable} action(s) left.
        </ConfirmModal>
      )}

      {p.rotate && (
        <ConfirmModal
          tone="red"
          title={p.rotate.steps === 3 ? 'About-turn with no MP?' : 'Rotate with no MP?'}
          buttons={[{ label: 'Yes, rotate anyway', variant: 'red', onClick: actions.confirmRotate }]}
          onCancel={cancels.rotate}
        >
          {p.rotate.unit.unitName} has no {p.rotate.poolLabel} or actions left — {p.rotate.steps === 3 ? 'about-turning 180°' : 'rotating 60°'} costs {p.rotate.cost} {p.rotate.poolLabel}. Rotate anyway ({p.rotate.poolLabel}/actions may go negative)?
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

      {p.weaponSwitch && (
        <ConfirmModal
          tone="amber"
          title="Switch weapon to attack?"
          buttons={[{ label: `Switch to ${p.weaponSwitch.label} and attack`, variant: 'green', onClick: actions.confirmWeaponSwitch }]}
          onCancel={cancels.weaponSwitch}
        >
          {p.weaponSwitch.attacker.unitName} can't reach {p.weaponSwitch.target.unitName} with {p.weaponSwitch.activeName}.
          Switch to {p.weaponSwitch.label} and attack? (Cancel to pick another weapon instead.)
        </ConfirmModal>
      )}

      {p.wallAttack && (
        <ConfirmModal
          tone="amber"
          title={p.wallAttack.overCap ? `Attack past the ${unitAttackCap()}-attack cap?` : 'Attack with no actions?'}
          buttons={[{ label: 'Yes, attack the barrier', variant: 'red', onClick: actions.confirmWallAttack }]}
          onCancel={cancels.wallAttack}
        >
          {p.wallAttack.overCap
            ? `${p.wallAttack.attacker.unitName} has already attacked ${p.wallAttack.attacker.attacksUsed}/${unitAttackCap()} times this turn.`
            : `${p.wallAttack.attacker.unitName} has no actions left, but can still attack.`}
          {' '}Strike the barrier at {p.wallAttack.label} anyway?
        </ConfirmModal>
      )}
    </>
  );
}
