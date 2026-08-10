import { describe, it, expect } from 'vitest';
import { GameEngine, CommandEntry } from './GameEngine';

function entry(id: string, opts: { chained?: boolean; playerId?: string } = {}): CommandEntry {
  return {
    id,
    timestamp: Date.now(),
    playerId: opts.playerId ?? 'a',
    playerName: 'A',
    scenarioId: 's1',
    actionType: 'MOVE',
    description: id,
    subSteps: [],
    chained: opts.chained ?? false,
  };
}

describe('GameEngine', () => {
  it('peekTopChain returns the top chain without popping it', () => {
    const engine = new GameEngine();
    engine.execute('MOVE', [], 'a', 'p1', 'A', 's1');
    engine.execute('ROUT', [], 'b', 'p1', 'A', 's1', { chained: true });
    const chain = engine.peekTopChain();
    expect(chain.map(e => e.id)).toHaveLength(2);
    expect(chain[0].description).toBe('a'); // anchor first
    // Non-destructive: stack size unchanged.
    expect(engine.getStackSize()).toBe(2);
  });

  it('pushExternal clears the local redo stack', () => {
    const engine = new GameEngine();
    engine.execute('MOVE', [], 'a', 'p1', 'A', 's1');
    engine.undo('p1', false);
    expect(engine.canRedo('p1', false)).toBe(true);
    engine.pushExternal(entry('remote'));
    expect(engine.canRedo('p1', false)).toBe(false);
  });

  it('execute clears the local redo stack (new action invalidates redo)', () => {
    const engine = new GameEngine();
    engine.execute('MOVE', [], 'a', 'p1', 'A', 's1');
    engine.undo('p1', false);
    expect(engine.canRedo('p1', false)).toBe(true);
    engine.execute('MOVE', [], 'z', 'p1', 'A', 's1');
    expect(engine.canRedo('p1', false)).toBe(false);
  });

  it('pushExternal does not duplicate an entry already in the stack', () => {
    const engine = new GameEngine();
    const e = entry('x');
    engine.pushExternal(e);
    engine.pushExternal(e);
    expect(engine.getStackSize()).toBe(1);
  });

  it('pushExternal trims the stack to the settings max size (2000 default)', () => {
    const engine = new GameEngine();
    for (let i = 0; i < 2100; i++) engine.pushExternal(entry(`e${i}`));
    expect(engine.getStackSize()).toBe(2000);
    expect(engine.peekTopChain()[engine.peekTopChain().length - 1].id).toBe('e2099');
  });

  it('removeEntry drops an entry from the stack but keeps the redo entry', () => {
    const engine = new GameEngine();
    const a = engine.execute('MOVE', [], 'a', 'p1', 'A', 's1');
    const b = engine.execute('MOVE', [], 'b', 'p1', 'A', 's1');
    engine.undo('p1', false); // pops b into redo
    engine.removeEntry(b.id); // own realtime UPDATE for the undone entry
    expect(engine.canRedo('p1', false)).toBe(true); // redo must survive
    expect(engine.getStackSize()).toBe(1);
    expect(engine.peekTopChain()[0].id).toBe(a.id);
  });

  it('undeleteEntry re-adds a remotely-redone entry without duplicating', () => {
    const engine = new GameEngine();
    engine.pushExternal(entry('a'));
    engine.undeleteEntry(entry('b'));
    expect(engine.getStackSize()).toBe(2);
    engine.undeleteEntry(entry('a'));
    expect(engine.getStackSize()).toBe(2);
  });
});
