/// <reference lib="webworker" />
// One-shot AI planner worker. The full plot runs off the main thread so the
// canvas, Supabase realtime and the rest of the UI stay responsive.
import { hydrateSettingsCache } from '@/packages/infra';
import { planAiMoves } from '@/packages/ai';
import type { AiPlannerRequest, AiPlannerResponse } from './aiPlanner.types';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<AiPlannerRequest>) => {
  const { id, ctx, settings } = event.data;
  const started = performance.now();
  try {
    hydrateSettingsCache(settings);
    const result = planAiMoves(ctx);
    const response: AiPlannerResponse = {
      id,
      result,
      elapsedMs: Math.round(performance.now() - started),
    };
    scope.postMessage(response);
  } catch (err) {
    const response: AiPlannerResponse = {
      id,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Math.round(performance.now() - started),
    };
    scope.postMessage(response);
  }
};
