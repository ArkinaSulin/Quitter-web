// Shared types between the AI-assist panel, the map overlay state and the
// canvas renderer.
import { Hex } from '@/types/gameProtocol';

/** One unit's plotted route for preview rendering (start → waypoints → end). */
export interface AiRouteVisual {
  unitId: string;
  /** Start + every landing hex, in order (polyline waypoints). */
  waypoints: Hex[];
  /** Attacks plotted along the route: hex the attacker fires from → target hex. */
  attacks: { from: Hex; targetHex: Hex }[];
}

/** Everything the canvas needs to draw for the AI assist UI. */
export interface AiOverlayData {
  /** Units wearing the "selected for AI" checkmark. */
  checkedUnitIds: string[];
  /** Eligible units the DM opted OUT of AI control (grey badge). */
  excludedUnitIds: string[];
  /** Preview/execute routes to draw (empty when idle). */
  routes: AiRouteVisual[];
}
