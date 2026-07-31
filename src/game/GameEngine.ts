import { Unit, Hex } from '@/types/gameProtocol';

export type ActionType = 'MOVE' | 'ROTATE' | 'FORMATION' | 'TEAM' | 'HIDE' | 'TOGGLE_HIDE' | 'PLACE' | 'ATTACK' | 'DAMAGE' | 'HEAL' | 'ROUT' | 'DELETE' | 'ALLIANCE' | 'ATTACH_HERO' | 'DETACH_HERO' | 'END_TURN' | 'SCENARIO';

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
  private readonly maxSize = 50;
  private redoStack: CommandEntry[] = [];

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

  getStackSize(): number {
    return this.stack.length;
  }

  getRedoStackSize(): number {
    return this.redoStack.length;
  }
}
