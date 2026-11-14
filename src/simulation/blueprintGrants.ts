import { blueprintsGrantedAtLevel } from '../content/blueprintGates';
import { knowsBlueprint, learnBlueprint } from './blueprintKnowledge';
import type { GameState } from './state';

/**
 * The waiting room between earning a core blueprint and knowing it.
 *
 * A level-up does not teach anything by itself: it queues what was earned, and
 * the player collects it from a banner. The reveal is the reward, so the name
 * stays `????` in the Blueprints tab until they tap. This lives apart from
 * blueprintKnowledge so that module stays a leaf — the gate table has to import
 * the blueprint id list, so nothing the id list depends on may import gates.
 */

/**
 * Queue the core blueprints earned by reaching a level. Anything already known
 * or already waiting is skipped, so re-entering a level — an Admin edit, a
 * migration replaying the gates — never double-queues a grant.
 */
export function queueLevelBlueprints(state: GameState, level: number): string[] {
  const queued: string[] = [];
  for (const id of blueprintsGrantedAtLevel(level)) {
    if (knowsBlueprint(state, id) || state.pendingBlueprintGrantIds.includes(id)) continue;
    state.pendingBlueprintGrantIds.push(id);
    queued.push(id);
  }
  return queued;
}

/** Collect one earned blueprint, revealing its name. Idempotent. */
export function claimBlueprintGrant(state: GameState, id: string): boolean {
  const index = state.pendingBlueprintGrantIds.indexOf(id);
  if (index < 0) return false;
  state.pendingBlueprintGrantIds.splice(index, 1);
  learnBlueprint(state, id);
  return true;
}

/** Collect everything waiting, oldest first. Returns what was revealed. */
export function claimAllBlueprintGrants(state: GameState): string[] {
  const claimed = [...state.pendingBlueprintGrantIds];
  state.pendingBlueprintGrantIds = [];
  for (const id of claimed) learnBlueprint(state, id);
  return claimed;
}

export function hasPendingBlueprintGrants(state: GameState): boolean {
  return state.pendingBlueprintGrantIds.length > 0;
}
