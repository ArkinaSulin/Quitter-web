// src/workers/gameWorker.ts
/// <reference lib="webworker" />

import { WorkerMessage, WorkerResponse, MoveUnitPayload, AttackPayload, LockUnitPayload } from '@/types/gameProtocol';

// --- Worker State (MVP) ---
let gameState: any = {
  units: [],
  turn: 0,
};

// --- Message Handler ---
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, messageId } = event.data;

  try {
    switch (type) {
      case 'MOVE_UNIT':
        handleMoveUnit(payload, messageId);
        break;
      case 'ATTACK':
        handleAttack(payload, messageId);
        break;
      case 'LOCK_UNIT':
        handleLockUnit(payload, messageId);
        break;
      case 'UNLOCK_UNIT':
        handleUnlockUnit(payload, messageId);
        break;
      case 'UNDO':
        handleUndo(messageId);
        break;
      case 'GET_STATE':
        handleGetState(messageId);
        break;
      case 'SYNC_STATE':
        handleSyncState(payload, messageId);
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error: any) {
    // Never crash the worker; always reply with an error.
    const response: WorkerResponse = {
      type: 'ERROR',
      payload: null,
      messageId,
      error: error.message || 'Unknown worker error',
    };
    self.postMessage(response);
  }
});

// --- Handlers ---
function handleMoveUnit(payload: MoveUnitPayload, messageId?: string) {
  console.log('[Worker] Moving unit:', payload);
  // TODO: Validate move, update state, broadcast sync event.
  const response: WorkerResponse = {
    type: 'SUCCESS',
    payload: { unitId: payload.unitId, newHex: payload.targetHex },
    messageId,
  };
  self.postMessage(response);
}

function handleAttack(payload: AttackPayload, messageId?: string) {
  console.log('[Worker] Attack:', payload);
  // TODO: Resolve combat (simultaneous, morale check, retaliation).
  const response: WorkerResponse = {
    type: 'SUCCESS',
    payload: { attackerId: payload.attackerId, targetId: payload.targetId, damageDealt: 4 },
    messageId,
  };
  self.postMessage(response);
}

function handleLockUnit(payload: LockUnitPayload, messageId?: string) {
  console.log('[Worker] Lock unit:', payload);
  // TODO: Broadcast lock via Supabase Realtime.
  const response: WorkerResponse = {
    type: 'SUCCESS',
    payload: { unitId: payload.unitId, lockedBy: payload.lockedBy },
    messageId,
  };
  self.postMessage(response);
}

function handleUnlockUnit(payload: { unitId: string }, messageId?: string) {
  console.log('[Worker] Unlock unit:', payload);
  const response: WorkerResponse = {
    type: 'SUCCESS',
    payload: { unitId: payload.unitId },
    messageId,
  };
  self.postMessage(response);
}

function handleUndo(messageId?: string) {
  console.log('[Worker] Undo requested');
  // TODO: Restore previous state snapshot.
  const response: WorkerResponse = {
    type: 'SUCCESS',
    payload: { restored: true },
    messageId,
  };
  self.postMessage(response);
}

function handleGetState(messageId?: string) {
  const response: WorkerResponse = {
    type: 'STATE_UPDATE',
    payload: gameState,
    messageId,
  };
  self.postMessage(response);
}

function handleSyncState(payload: any, messageId?: string) {
  console.log('[Worker] Syncing state:', payload);
  gameState = payload;
  const response: WorkerResponse = {
    type: 'SUCCESS',
    payload: { synced: true },
    messageId,
  };
  self.postMessage(response);
}

// --- Error Handling: Global worker errors ---
self.addEventListener('error', (event) => {
  console.error('[Worker] Uncaught error:', event.message);
  // Post error back to main thread
  const response: WorkerResponse = {
    type: 'ERROR',
    payload: null,
    error: event.message || 'Worker crashed',
  };
  self.postMessage(response);
});

console.log('[Worker] Game worker initialized.');