import { INTERACTION_RANGE_PX } from '../config/balance';
import { NPC_DEFINITIONS, type NpcDefinition } from '../content/npcs';
import type { GameState } from './state';

/** Deterministic nearest-friendly lookup used by context-action priority. */
export function nearestNpc(state: GameState, range = INTERACTION_RANGE_PX): NpcDefinition | null {
  let nearest: NpcDefinition | null = null;
  let nearestDistance = range;
  for (const npc of NPC_DEFINITIONS) {
    const distance = Math.hypot(npc.x - state.player.x, npc.y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = npc;
      nearestDistance = distance;
    }
  }
  return nearest;
}
