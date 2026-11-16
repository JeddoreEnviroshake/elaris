/**
 * Items used straight from the hotbar, mid-fight, with no menu in between
 * (taming-chance-plan.md).
 *
 * - Food (berries and every species' favourite) is handed to the creature
 *   close enough to feed: the locked one when it is in reach, else the nearest.
 * - A snare is thrown in front of the character. It flies along the aim and
 *   takes the first creature it passes close enough to; one that hits nothing
 *   lands on the ground as a pickup, so a wild throw costs a walk, not a snare.
 *
 * The aim arrives from the presentation layer as a whole-number direction
 * (any length; it is normalised here), so nothing fractional reaches state.
 */
import { CREATURE_DEFINITIONS } from '../content/creatures';
import { isOpeningTuftle } from '../content/onboarding';
import { OFFER_RANGE_PX, SNARE_THROW_RANGE_PX } from '../config/balance';
import { WORLD_PX } from '../config/platform';
import { addGroundDrop, type CommandResult } from './gameplayCommands';
import { reconcileResourceStacks } from './inventoryStacks';
import { offerOpeningTuftle, throwOpeningSnare } from './onboarding';
import { offerToCreature, throwSnareAtCreature, type SnareItemId, type TameThrowResult } from './tameChance';
import type { GameState, ResourceId, WildCreatureState } from './state';

/** How close to the flight line a creature must be for the snare to catch it. */
export const SNARE_HIT_RADIUS_PX = 20;
/** Cosine of the half-angle of the forward cone a snare searches (about 45°). */
export const SNARE_CONE_COS = 0.7;

export const SNARE_ITEM_IDS: readonly SnareItemId[] = ['taming-snare', 'reinforced-snare'];

/** Everything a creature might eat: any berry, plus each species' favourite. */
export const FOOD_ITEM_IDS: readonly ResourceId[] = [
  ...new Set<ResourceId>(['berry', ...CREATURE_DEFINITIONS.map((definition) => definition.tame.favourite)]),
];

/** Items that can sit on the hotbar and be used from it. */
export const HOTBAR_ITEM_IDS: readonly ResourceId[] = [...SNARE_ITEM_IDS, ...FOOD_ITEM_IDS];

export function isHotbarItem(resource: ResourceId): boolean {
  return HOTBAR_ITEM_IDS.includes(resource);
}

export function isSnareItem(resource: ResourceId): resource is SnareItemId {
  return (SNARE_ITEM_IDS as readonly ResourceId[]).includes(resource);
}

export interface HotbarAim {
  /** Direction of the throw in world pixels; length does not matter. */
  dirX: number;
  dirY: number;
  /** A creature the player has locked; it wins whenever it is in reach. */
  lockedCreatureId: string | null;
}

export interface HotbarUseResult extends TameThrowResult {
  /** Where a thrown snare ended up — the creature it hit, or where it landed. */
  thrownTo?: { x: number; y: number };
  /** A snare that hit nothing and now lies on the ground. */
  landed?: boolean;
  /** Food was eaten. */
  fed?: boolean;
}

function distance(state: GameState, wild: WildCreatureState): number {
  return Math.hypot(wild.x - state.player.x, wild.y - state.player.y);
}

function lockedInReach(state: GameState, aim: HotbarAim, range: number): WildCreatureState | null {
  if (!aim.lockedCreatureId) return null;
  const locked = state.wildCreatures.find((wild) => wild.id === aim.lockedCreatureId);
  return locked && locked.hp > 0 && distance(state, locked) <= range ? locked : null;
}

/** The creature a hand-fed item goes to. */
export function feedTarget(state: GameState, aim: HotbarAim): WildCreatureState | null {
  const locked = lockedInReach(state, aim, OFFER_RANGE_PX);
  if (locked) return locked;
  let best: WildCreatureState | null = null;
  for (const wild of state.wildCreatures) {
    if (wild.hp <= 0 || distance(state, wild) > OFFER_RANGE_PX) continue;
    if (!best || distance(state, wild) < distance(state, best)) best = wild;
  }
  return best;
}

/**
 * The creature a snare thrown along `aim` would catch: the nearest one in a
 * forward cone, so "in front of the character" forgives a thumb that was a
 * few degrees off. A lock in range wins — the character turns to throw at
 * what the player picked — and with nothing ahead, a creature within arm's
 * reach is taken instead.
 */
export function snareTarget(state: GameState, aim: HotbarAim): WildCreatureState | null {
  const locked = lockedInReach(state, aim, SNARE_THROW_RANGE_PX);
  if (locked) return locked;
  const length = Math.hypot(aim.dirX, aim.dirY);
  if (length === 0) return null;
  const ux = aim.dirX / length; const uy = aim.dirY / length;
  let best: WildCreatureState | null = null; let bestDistance = Infinity;
  for (const wild of state.wildCreatures) {
    if (wild.hp <= 0) continue;
    const dx = wild.x - state.player.x; const dy = wild.y - state.player.y;
    const reach = Math.hypot(dx, dy);
    if (reach > SNARE_THROW_RANGE_PX) continue;
    const along = dx * ux + dy * uy;
    // Inside the cone, or close enough to the line that the snare brushes it.
    const inCone = reach === 0 || along >= reach * SNARE_CONE_COS;
    const brushed = along >= 0 && Math.abs(dx * uy - dy * ux) <= SNARE_HIT_RADIUS_PX;
    if (!inCone && !brushed) continue;
    if (reach < bestDistance) { best = wild; bestDistance = reach; }
  }
  // Nothing ahead, but something within arm's reach: the character turns to
  // it. Throwing past a creature standing beside you reads as a bug.
  return best ?? feedTarget(state, { ...aim, lockedCreatureId: null });
}

export function useHotbarItem(state: GameState, item: ResourceId, aim: HotbarAim): HotbarUseResult {
  if (state.pendingRespawn) return { ok: false, message: 'Not right now' };
  if (state.inventory[item] <= 0) return { ok: false, message: `No ${item} left` };
  if (isSnareItem(item)) return throwSnare(state, item, aim);
  if (FOOD_ITEM_IDS.includes(item)) return feed(state, item, aim);
  return { ok: false, message: 'That cannot be used from the hotbar' };
}

function feed(state: GameState, item: ResourceId, aim: HotbarAim): HotbarUseResult {
  const target = feedTarget(state, aim);
  if (!target) return { ok: false, message: 'No creature close enough to feed' };
  if (isOpeningTuftle(state, target.id)) {
    if (item !== 'berry') return { ok: false, message: 'The Tuftle wants a berry' };
    const result: CommandResult = offerOpeningTuftle(state);
    return { ...result, fed: result.ok, creatureId: target.id };
  }
  const result = offerToCreature(state, target.id, item);
  return { ...result, fed: result.ok, creatureId: target.id };
}

function throwSnare(state: GameState, item: SnareItemId, aim: HotbarAim): HotbarUseResult {
  const target = snareTarget(state, aim);
  if (target && isOpeningTuftle(state, target.id)) {
    const result: CommandResult = throwOpeningSnare(state, item);
    return result.ok
      ? { ...result, tamed: true, creatureId: target.id, thrownTo: { x: target.x, y: target.y } }
      : { ...result, creatureId: target.id };
  }
  if (target) {
    const at = { x: target.x, y: target.y };
    const result = throwSnareAtCreature(state, target.id, SNARE_THROW_RANGE_PX, item);
    return result.ok ? { ...result, thrownTo: at } : result;
  }
  // Nothing in the way: the snare sails its full range and lands as a pickup.
  const length = Math.hypot(aim.dirX, aim.dirY) || 1;
  const land = (from: number, delta: number) => Math.max(0, Math.min(WORLD_PX - 1, Math.round(from + delta * SNARE_THROW_RANGE_PX)));
  const x = land(state.player.x, aim.dirX / length);
  const y = land(state.player.y, aim.dirY / length);
  state.inventory[item] -= 1;
  reconcileResourceStacks(state, item);
  addGroundDrop(state, item, 1, x, y);
  return { ok: true, landed: true, thrownTo: { x, y }, message: 'The snare caught nothing and landed on the ground' };
}
