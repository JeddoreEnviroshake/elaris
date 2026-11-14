import {
  EXPEDITION_ROUTES,
  EXPEDITION_SPECIALTY,
  expeditionRoute,
  type ExpeditionRouteDefinition,
} from '../content/expeditions';
import { bagItemWeightHundredths } from './bagWeight';
import { coordinateHash } from './biomes';
import { creditCoins } from './coins';
import { addGroundDrop, tryAddResource, type CommandResult } from './gameplayCommands';
import { BLUEPRINT_ITEM_IDS, knowsBlueprint, learnBlueprint } from './blueprintKnowledge';
import type { ExpeditionRouteId, ExpeditionState, GameState, ResourceId } from './state';

/**
 * Dispatch, settlement, and collection for creature expeditions.
 *
 * Time is carried in whole milliseconds and settled by the same call shape the
 * Furnace uses, so an expedition advances identically whether the game is open,
 * backgrounded, or closed — there is no separate offline code path to keep in
 * sync with the online one.
 */

/** Coins paid by a survey once every blueprint is already known. */
export const EXHAUSTED_SURVEY_COINS = 60;

export interface ExpeditionSettlement {
  changed: boolean;
  /** Expeditions that reached zero during this window. */
  returned: number;
}

export function creatureExpedition(state: GameState, creatureId: string): ExpeditionState | null {
  return state.expeditions.find((expedition) => expedition.creatureId === creatureId) ?? null;
}

/** True while a creature is away and therefore unavailable for anything else. */
export function isCreatureAway(state: GameState, creatureId: string): boolean {
  return creatureExpedition(state, creatureId) !== null;
}

export function isExpeditionHome(expedition: ExpeditionState): boolean {
  return expedition.remainingMs <= 0;
}

export function dispatchBlockedReason(
  state: GameState,
  creatureId: string,
  routeId: ExpeditionRouteId,
): string | null {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return 'Creature not found';
  if (isCreatureAway(state, creatureId)) return `${creature.name} is already away`;
  // Resting is the only free state: a follower is at the player's side and a
  // worker is mid-shift, and silently pulling either would undo a instruction
  // the player gave somewhere else.
  if (creature.role !== 'rest') return `Set ${creature.name} to Rest before sending them out`;
  if (!EXPEDITION_ROUTES.some((route) => route.id === routeId)) return 'Unknown route';
  return null;
}

export function dispatchExpedition(
  state: GameState,
  creatureId: string,
  routeId: ExpeditionRouteId,
): CommandResult {
  const blocked = dispatchBlockedReason(state, creatureId, routeId);
  if (blocked) return { ok: false, message: blocked };
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId)!;
  const route = expeditionRoute(routeId);

  state.expeditions.push({
    id: `expedition-${state.nextEntityId}`,
    creatureId,
    routeId,
    remainingMs: route.durationMs,
    rollIndex: state.expeditionsDispatched,
  });
  state.nextEntityId += 1;
  state.expeditionsDispatched += 1;
  if (state.battleCompanionId === creatureId) state.battleCompanionId = null;

  return { ok: true, message: `${creature.name} sets out on the ${route.displayName}` };
}

/**
 * Advance every expedition by a window of real time. Mirrors advanceFurnaces:
 * the same function serves the per-tick online call and the one-shot offline
 * settlement, so a long absence cannot be worth more or less than staying open.
 */
export function advanceExpeditions(state: GameState, elapsedMs: number): ExpeditionSettlement {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return { changed: false, returned: 0 };
  const applied = Math.floor(elapsedMs);
  let changed = false;
  let returned = 0;
  for (const expedition of state.expeditions) {
    if (expedition.remainingMs <= 0) continue;
    const next = Math.max(0, expedition.remainingMs - applied);
    if (next !== expedition.remainingMs) changed = true;
    expedition.remainingMs = next;
    if (next === 0) returned += 1;
  }
  return { changed, returned };
}

export interface ExpeditionRewards {
  readonly resources: ReadonlyArray<readonly [ResourceId, number]>;
  readonly coins: number;
  readonly carriesBlueprint: boolean;
  readonly blueprintItemId: string | null;
}

/**
 * Resolve what one expedition brings home. Pure and seeded from the trip's own
 * roll index, so it never touches `state.rngState` and re-reading it before and
 * after collection gives the same answer.
 */
export function expeditionRewards(
  state: GameState,
  expedition: ExpeditionState,
  unlockedItemIds: readonly string[] = state.unlockedItemIds,
): ExpeditionRewards {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === expedition.creatureId);
  const route = expeditionRoute(expedition.routeId);
  const speciesId = creature ? creature.speciesId : 'tuftle';
  const specialty = EXPEDITION_SPECIALTY[speciesId];

  // coordinateHash's final XOR is signed; fold it before use.
  const hash = (salt: number) => {
    const raw = coordinateHash((state.seed ^ salt) >>> 0, expedition.rollIndex, route.durationMs % 1_000_003);
    return ((raw % 1) + 1) % 1;
  };
  // ±20% around the route's advertised yield, so two identical trips still feel
  // like separate events without ever being disappointing.
  const varied = (base: number, salt: number) => Math.max(1, Math.round(base * (0.8 + hash(salt) * 0.4)));
  // Convert the route's carry budget into units of whatever this species
  // fetches, so a Snarlfox's heavy ore and a Tuftle's light fiber are the same
  // size of haul rather than the same number of items.
  const unitWeight = Math.max(1, bagItemWeightHundredths(state, specialty));
  const primaryUnits = Math.max(1, Math.floor(route.primaryYieldHundredths / unitWeight));

  return {
    resources: [
      [specialty, varied(primaryUnits, 0x5052_494d)],
      ['berry', varied(route.berryYield, 0x4245_5252)],
    ],
    coins: varied(route.coins, 0x434f_494e),
    carriesBlueprint: route.blueprint,
    blueprintItemId: route.blueprint ? pickBlueprint(hash(0x424c_5052), unlockedItemIds) : null,
  };
}

function pickBlueprint(roll: number, unlockedItemIds: readonly string[]): string | null {
  const candidates = BLUEPRINT_ITEM_IDS.filter((id) => !unlockedItemIds.includes(id)).slice().sort();
  if (candidates.length === 0) return null;
  const index = Math.floor(roll * candidates.length);
  return candidates[Math.max(0, Math.min(candidates.length - 1, index))]!;
}

export function collectBlockedReason(state: GameState, expeditionId: string): string | null {
  const expedition = state.expeditions.find((candidate) => candidate.id === expeditionId);
  if (!expedition) return 'No such expedition';
  if (!isExpeditionHome(expedition)) return `Still away · ${formatRemaining(expedition.remainingMs)} to go`;
  return null;
}

/**
 * Take delivery. Overflow falls at the player's feet as ordinary ground drops,
 * the same as a container or a creature defeat, so a full bag costs a second
 * trip rather than the reward.
 */
export function collectExpedition(state: GameState, expeditionId: string): CommandResult {
  const blocked = collectBlockedReason(state, expeditionId);
  if (blocked) return { ok: false, message: blocked };
  const expedition = state.expeditions.find((candidate) => candidate.id === expeditionId)!;
  const creature = state.ownedCreatures.find((candidate) => candidate.id === expedition.creatureId);
  const rewards = expeditionRewards(state, expedition);

  const brought: string[] = [];
  for (const [resource, amount] of rewards.resources) {
    if (amount <= 0) continue;
    if (!tryAddResource(state, resource, amount)) {
      addGroundDrop(state, resource, amount, state.player.x, state.player.y);
    }
    brought.push(`+${amount} ${resource}`);
  }
  if (rewards.coins > 0) {
    creditCoins(state, rewards.coins, `+${rewards.coins} coins`);
    brought.push(`+${rewards.coins} coins`);
  }
  if (rewards.carriesBlueprint) {
    if (rewards.blueprintItemId && !knowsBlueprint(state, rewards.blueprintItemId)) {
      learnBlueprint(state, rewards.blueprintItemId);
      brought.push(`Blueprint: ${rewards.blueprintItemId.replace(/-/g, ' ')}`);
    } else {
      creditCoins(state, EXHAUSTED_SURVEY_COINS, `+${EXHAUSTED_SURVEY_COINS} coins`);
      brought.push(`+${EXHAUSTED_SURVEY_COINS} coins`);
    }
  }

  state.expeditions = state.expeditions.filter((candidate) => candidate.id !== expeditionId);
  const name = creature?.name ?? 'The party';
  return { ok: true, message: `${name} returns · ${brought.join(' · ')}` };
}

/** Rounded, player-facing time remaining. */
export function formatRemaining(remainingMs: number): string {
  const totalMinutes = Math.max(0, Math.ceil(remainingMs / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export { EXPEDITION_ROUTES, expeditionRoute, type ExpeditionRouteDefinition };
