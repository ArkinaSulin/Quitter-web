import { Unit, Hex } from '@/types/gameProtocol';
import { getSetting, DEFAULT_UNDO_STACK_SIZE } from '@/lib/settingsCache';

export type ActionType = 'MOVE' | 'ROTATE' | 'FORMATION' | 'TEAM' | 'HIDE' | 'TOGGLE_HIDE' | 'PLACE' | 'ATTACK' | 'DAMAGE' | 'HEAL' | 'ROUT' | 'DELETE' | 'ALLIANCE' | 'ATTACH_HERO' | 'DETACH_HERO' | 'SWAP_HERO_POSITION' | 'END_TURN' | 'SCENARIO' | 'CHARGE' | 'CHARGE_END' | 'WEAPON_SELECT' | 'CAST' | 'EDIT_UNIT';

export interface UnitChange {
  field: string;
  from: any;
  to: any;
}

export interface SubStep {
  type: ActionType;
  description: string;
  unitId: string;
  changes: UnitChange[];
  /** Snapshot carried for replay (e.g. full unit on PLACE). Ignored by live apply. */
  payload?: unknown;
}

export interface CommandEntry {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  scenarioId: string;
  actionType: ActionType;
  description: string;
  subSteps: SubStep[];
  chained: boolean;
}

export class GameEngine {
  private stack: CommandEntry[] = [];
  private redoStack: CommandEntry[] = [];

  /** Undo/redo history depth — game-wide setting, read live (fallback 2000). */
  private get maxSize(): number {
    return getSetting('undo_stack_size', DEFAULT_UNDO_STACK_SIZE);
  }

  execute(
    actionType: ActionType,
    subSteps: SubStep[],
    description: string,
    playerId: string,
    playerName: string,
    scenarioId: string,
    options: { chained?: boolean } = {},
  ): CommandEntry {
    const entry: CommandEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      playerId,
      playerName,
      scenarioId,
      actionType,
      description,
      subSteps,
      chained: options.chained ?? false,
    };
    this.stack.push(entry);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
    // A new local action invalidates any redo.
    this.redoStack = [];
    return entry;
  }

  private collectChainFromTop(): CommandEntry[] {
    if (this.stack.length === 0) return [];
    const chain: CommandEntry[] = [];
    while (this.stack.length > 0) {
      const entry = this.stack.pop()!;
      chain.unshift(entry);
      if (!entry.chained) break;
    }
    return chain;
  }

  private restoreStack(chain: CommandEntry[]): void {
    for (const e of chain) this.stack.push(e);
  }

  private peekChain(source: CommandEntry[]): CommandEntry[] {
    if (source.length === 0) return [];
    const chain: CommandEntry[] = [];
    let i = source.length - 1;
    while (i >= 0) {
      chain.unshift(source[i]);
      if (!source[i].chained) break;
      i--;
    }
    return chain;
  }

  private checkPermission(chain: CommandEntry[], playerId: string, isGM: boolean): boolean {
    return isGM || chain.every(e => e.playerId === playerId);
  }

  undo(currentPlayerId: string, isGM: boolean): CommandEntry[] | null {
    const chain = this.collectChainFromTop();
    if (chain.length === 0) return null;
    if (!this.checkPermission(chain, currentPlayerId, isGM)) {
      this.restoreStack(chain);
      return null;
    }
    for (const e of chain) this.redoStack.push(e);
    return chain;
  }

  redo(currentPlayerId: string, isGM: boolean): CommandEntry[] | null {
    const chain = this.peekChain(this.redoStack);
    if (chain.length === 0) return null;
    if (!this.checkPermission(chain, currentPlayerId, isGM)) return null;
    for (let i = chain.length - 1; i >= 0; i--) {
      this.redoStack.pop()!;
      this.stack.push(chain[i]);
    }
    return chain;
  }

  canUndo(currentPlayerId: string, isGM: boolean): boolean {
    const chain = this.peekChain(this.stack);
    if (chain.length === 0) return false;
    return this.checkPermission(chain, currentPlayerId, isGM);
  }

  canRedo(currentPlayerId: string, isGM: boolean): boolean {
    const chain = this.peekChain(this.redoStack);
    if (chain.length === 0) return false;
    return this.checkPermission(chain, currentPlayerId, isGM);
  }

  peekUndo(currentPlayerId: string, isGM: boolean): CommandEntry | null {
    const chain = this.peekChain(this.stack);
    if (chain.length === 0) return null;
    if (!this.checkPermission(chain, currentPlayerId, isGM)) return null;
    return chain[chain.length - 1];
  }

  peekRedo(currentPlayerId: string, isGM: boolean): CommandEntry | null {
    const chain = this.peekChain(this.redoStack);
    if (chain.length === 0) return null;
    if (!this.checkPermission(chain, currentPlayerId, isGM)) return null;
    return chain[chain.length - 1];
  }

  peekUndoChainLength(currentPlayerId: string, isGM: boolean): number {
    const chain = this.peekChain(this.stack);
    if (chain.length === 0) return 0;
    if (!this.checkPermission(chain, currentPlayerId, isGM)) return 0;
    return chain.length;
  }

  /**
   * Non-destructive view of the top chain (the last command plus its chained
   * predecessors). Used to validate an undo against the server before popping.
   */
  peekTopChain(): CommandEntry[] {
    return this.peekChain(this.stack);
  }

  getStackSize(): number {
    return this.stack.length;
  }

  getRedoStackSize(): number {
    return this.redoStack.length;
  }

  /** Replace the entire undo stack (e.g. hydrated from the command_log). */
  loadStack(entries: CommandEntry[]): void {
    this.stack = [...entries];
    if (this.stack.length > this.maxSize) {
      this.stack = this.stack.slice(this.stack.length - this.maxSize);
    }
    this.redoStack = [];
  }

  /** Append an entry received from another client's realtime command_log insert. */
  pushExternal(entry: CommandEntry): void {
    if (this.stack.some(e => e.id === entry.id)) return;
    this.stack.push(entry);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
    // A new external action invalidates any local redo.
    this.redoStack = [];
  }

  /**
   * Drop an entry that was soft-deleted by a remote undo. Only the main stack is
   * touched — the redo stack is per-client, and the undoing client's own realtime
   * event must NOT wipe its just-created redo entry.
   */
  removeEntry(id: string): void {
    this.stack = this.stack.filter(e => e.id !== id);
  }

  /** Re-add an entry that a remote redo undeleted (idempotent). */
  undeleteEntry(entry: CommandEntry): void {
    if (this.stack.some(e => e.id === entry.id)) return;
    this.stack.push(entry);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
  }
}
