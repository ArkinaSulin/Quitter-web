// src/workers/aiPlanner.types.ts
import type { AiPlanContext, AiPlanResult } from '@/packages/ai';

export interface AiPlannerRequest {
  id: number;
  ctx: AiPlanContext;
  /** admin_game_settings snapshot, so movement/combat helpers match the UI. */
  settings: Record<string, unknown>;
}

export interface AiPlannerResponse {
  id: number;
  result?: AiPlanResult;
  error?: string;
  elapsedMs: number;
}
