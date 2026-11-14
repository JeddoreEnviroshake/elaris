import { INTERACTION_RANGE_PX, INVENTORY_SLOTS } from '../config/balance';
import { isBlueprintItemId, knowsBlueprint, learnBlueprint, unknownBlueprintIds } from './blueprintKnowledge';
import {
  BLUEPRINT_QUALITIES,
  BLUEPRINT_QUALITY_LABELS,
  BLUEPRINT_QUALITY_WEIGHTS,
  blueprintQuality,
  blueprintsOfQuality,
  type BlueprintQuality,
} from '../content/blueprintQuality';
import { reconcileResourceStacks } from './inventoryStacks';
import { createRng } from './rng';
import {
  FACILITY_INTERACTION_RANGE_PX, addGroundDrop, tryAddResource, usedInventorySlots,
  type CommandResult,
} from './gameplayCommands';
import { withinElarisPublicWorkbench } from './elarisWorkbench';
import { isOpeningDiscoveryPaper } from '../content/onboarding';
import { buildingCenterPx } from './buildingGeometry';
import {
  STORAGE_RESOURCE_IDS, isStorageContainer, storageBoxContents, storageContainerSlots,
} from './storageBox';
import type { BlueprintGroundDrop, BuildingState, CarriedBlueprint, GameState } from './state';

/**
 * Blueprints as things you carry.
 *
 * A found blueprint is not knowledge yet — it is a piece of paper in the bag.
 * It takes a slot, it draws raiders, and it is lost with the bag if the run
 * home fails. Registering it at a workbench is the moment it becomes permanent,
 * and that trip is the whole point of the system.
 */

/**
 * Whether a workbench is in reach — the player's own, or the town's.
 *
 * Two sources, one answer. The Elaris bench is town content rather than a
 * building the player owns, so it is checked separately, and it stops
 * answering once the town falls.
 */
export function canRegisterHere(state: GameState, range = FACILITY_INTERACTION_RANGE_PX): boolean {
  if (withinElarisPublicWorkbench(state, range)) return true;
  return state.buildings.some((building) => {
    if (building.definitionId !== 'workbench') return false;
    const center = buildingCenterPx(building);
    return Math.hypot(center.x - state.player.x, center.y - state.player.y) <= range;
  });
}

/** Blueprints take one slot each and no meaningful weight. */
export function carriedBlueprintSlots(state: GameState): number {
  return state.carriedBlueprints.length;
}

/**
 * Put a found blueprint in the bag. Refuses rather than silently dropping it
 * when the bag is full, so a caller can spill it to the ground the way every
 * other over-full reward does.
 */
export function tryCarryBlueprint(state: GameState, blueprintId: string): CarriedBlueprint | null {
  if (!isBlueprintItemId(blueprintId)) return null;
  if (usedInventorySlots(state) >= INVENTORY_SLOTS) return null;
  const carried: CarriedBlueprint = {
    instanceId: `blueprint-${state.nextEntityId}`,
    blueprintId,
  };
  state.nextEntityId += 1;
  state.carriedBlueprints.push(carried);
  return carried;
}

/** Take one out of the bag without teaching it — drops, trades, and scrapping. */
export function removeCarriedBlueprint(state: GameState, instanceId: string): CarriedBlueprint | null {
  const index = state.carriedBlueprints.findIndex((candidate) => candidate.instanceId === instanceId);
  if (index < 0) return null;
  return state.carriedBlueprints.splice(index, 1)[0]!;
}

export function registerBlockedReason(state: GameState, instanceId: string): string | null {
  const carried = state.carriedBlueprints.find((candidate) => candidate.instanceId === instanceId);
  if (!carried) return 'You are not carrying that blueprint';
  if (!canRegisterHere(state)) return 'Register at a workbench';
  return null;
}

/**
 * File one carried blueprint at a workbench. This is the only way a
 * supplementary blueprint becomes permanent, and it is one-way: once filed,
 * nothing takes it back.
 *
 * A duplicate of something already known is still consumed and still counts as
 * filed. Registering is how a player disposes of one safely, and refusing here
 * would leave them holding raider bait they cannot put down.
 */
export function registerCarriedBlueprint(state: GameState, instanceId: string): CommandResult {
  const blocked = registerBlockedReason(state, instanceId);
  if (blocked) return { ok: false, message: blocked };

  const carried = removeCarriedBlueprint(state, instanceId)!;
  const name = carried.blueprintId.replace(/-/g, ' ');
  if (knowsBlueprint(state, carried.blueprintId)) {
    return { ok: true, message: `Filed a duplicate ${name} blueprint` };
  }
  learnBlueprint(state, carried.blueprintId);
  return { ok: true, message: `Registered ${name} — the blueprint is yours for good` };
}

/** File everything in the bag in one trip. Returns what was newly learned. */
export function registerAllCarriedBlueprints(state: GameState): CommandResult {
  if (state.carriedBlueprints.length === 0) {
    return { ok: false, message: 'No blueprints to register' };
  }
  if (!canRegisterHere(state)) return { ok: false, message: 'Register at a workbench' };

  const learned: string[] = [];
  let duplicates = 0;
  for (const carried of [...state.carriedBlueprints]) {
    if (knowsBlueprint(state, carried.blueprintId)) duplicates += 1;
    else learned.push(carried.blueprintId.replace(/-/g, ' '));
    registerCarriedBlueprint(state, carried.instanceId);
  }
  const parts: string[] = [];
  if (learned.length > 0) parts.push(`Registered ${learned.join(', ')}`);
  if (duplicates > 0) parts.push(`filed ${duplicates} duplicate${duplicates === 1 ? '' : 's'}`);
  return { ok: true, message: parts.join(' · ') };
}

/**
 * Spaces a box is using. Mirrors the UI slot model deliberately rather than
 * importing it: the simulation must never depend on a presentation module, and
 * a box that disagrees with its own panel about being full is worse than the
 * small duplication.
 */
function usedStorageSlots(box: BuildingState): number {
  const contents = storageBoxContents(box);
  const resourceSlots = STORAGE_RESOURCE_IDS.reduce(
    (slots, resource) => slots + contents.stacks[resource].length, 0,
  );
  return resourceSlots + contents.tools.length + contents.blueprints.length;
}

/**
 * Move a carried blueprint into a Storage Box.
 *
 * Stashing is allowed on purpose. It is not a loophole because the box keeps
 * radiating raider heat from where it stands: a player who parks blueprints at
 * home has chosen to make their base the target instead of themselves.
 */
export function stashBlueprintInBox(
  state: GameState,
  instanceId: string,
  boxId: string,
): CommandResult {
  const box = state.buildings.find((building) => building.id === boxId);
  if (!box || !isStorageContainer(box)) return { ok: false, message: 'No such storage' };
  const contents = storageBoxContents(box);
  if (usedStorageSlots(box) >= storageContainerSlots(box)) {
    return { ok: false, message: 'Storage is full' };
  }

  const carried = removeCarriedBlueprint(state, instanceId);
  if (!carried) return { ok: false, message: 'You are not carrying that blueprint' };
  contents.blueprints.push(carried);
  return {
    ok: true,
    message: `Stashed ${carried.blueprintId.replace(/-/g, ' ')} — the box draws raiders while it holds it`,
  };
}

/** Take a stashed blueprint back into the bag. */
export function takeBlueprintFromBox(
  state: GameState,
  instanceId: string,
  boxId: string,
): CommandResult {
  const box = state.buildings.find((building) => building.id === boxId);
  if (!box || !isStorageContainer(box)) return { ok: false, message: 'No such storage' };
  const contents = storageBoxContents(box);
  const index = contents.blueprints.findIndex((candidate) => candidate.instanceId === instanceId);
  if (index < 0) return { ok: false, message: 'That blueprint is not in this box' };
  if (usedInventorySlots(state) >= INVENTORY_SLOTS) return { ok: false, message: 'Bag is full' };

  const [carried] = contents.blueprints.splice(index, 1);
  state.carriedBlueprints.push(carried!);
  return { ok: true, message: `Took ${carried!.blueprintId.replace(/-/g, ' ')}` };
}

/**
 * How long a blueprint lies in the world before it is gone for good.
 *
 * Ten real minutes at the fixed 60 Hz tick. Long enough for a corpse run from
 * anywhere a player can reasonably die, short enough that the run has to start
 * now — which is the whole point of dropping them rather than deleting them.
 */
export const BLUEPRINT_DROP_TTL_TICKS = 10 * 60 * 60;

/** Put a blueprint on the ground: a death, or a deliberate handoff. */
export function dropBlueprintAt(
  state: GameState,
  carried: CarriedBlueprint,
  x: number,
  y: number,
): void {
  const opening = isOpeningDiscoveryPaper(state, carried.instanceId);
  const id = `blueprint-drop-${state.nextEntityId}`;
  state.blueprintDrops.push({
    id,
    blueprintId: carried.blueprintId,
    x: Math.round(x),
    y: Math.round(y),
    expiresAtTick: opening ? Number.MAX_SAFE_INTEGER : state.tick + BLUEPRINT_DROP_TTL_TICKS,
  });
  if (opening) state.onboarding.supplyRun!.blueprintDropId = id;
  state.nextEntityId += 1;
}

/** Deliberately put one down, for a trade or to shed the raider heat. */
export function dropCarriedBlueprint(state: GameState, instanceId: string): CommandResult {
  const opening = isOpeningDiscoveryPaper(state, instanceId);
  const carried = removeCarriedBlueprint(state, instanceId);
  if (!carried) return { ok: false, message: 'You are not carrying that blueprint' };
  dropBlueprintAt(state, carried, state.player.x, state.player.y);
  return {
    ok: true,
    message: opening ? 'Dropped the supply-run discovery. It will remain here until you recover it.' : `Dropped ${carried.blueprintId.replace(/-/g, ' ')} — it will not lie there long`,
  };
}

/**
 * Everything unregistered in the bag falls where the player died. Registered
 * blueprints are untouched: filing one is permanent, and that promise is what
 * makes the trip home worth making.
 */
export function dropCarriedBlueprintsOnDefeat(state: GameState, x: number, y: number): number {
  const lost = state.carriedBlueprints.length;
  for (const carried of state.carriedBlueprints) dropBlueprintAt(state, carried, x, y);
  state.carriedBlueprints = [];
  return lost;
}

/** Pick a dropped blueprint back up. The corpse run, or the other half of a trade. */
export function recoverBlueprintDrop(state: GameState, dropId: string): CommandResult {
  const index = state.blueprintDrops.findIndex((drop) => drop.id === dropId);
  if (index < 0) return { ok: false, message: 'That blueprint is gone' };
  const drop = state.blueprintDrops[index]!;
  if (Math.hypot(drop.x - state.player.x, drop.y - state.player.y) > INTERACTION_RANGE_PX) {
    return { ok: false, message: 'Move closer' };
  }
  if (usedInventorySlots(state) >= INVENTORY_SLOTS) return { ok: false, message: 'Bag is full' };

  state.blueprintDrops.splice(index, 1);
  state.carriedBlueprints.push({
    instanceId: `blueprint-${state.nextEntityId}`,
    blueprintId: drop.blueprintId,
  });
  if (state.onboarding.supplyRun?.blueprintDropId === drop.id) {
    state.onboarding.supplyRun.blueprintInstanceId = `blueprint-${state.nextEntityId}`;
    state.onboarding.supplyRun.blueprintDropId = null;
  }
  state.nextEntityId += 1;
  return { ok: true, message: `Recovered ${drop.blueprintId.replace(/-/g, ' ')}` };
}

/** Sweep expired drops. Returns true when anything was lost this tick. */
export function expireBlueprintDrops(state: GameState): boolean {
  const before = state.blueprintDrops.length;
  state.blueprintDrops = state.blueprintDrops.filter((drop) => state.tick < drop.expiresAtTick);
  return state.blueprintDrops.length !== before;
}

/**
 * Parchment recovered from one scrapped blueprint.
 *
 * Deliberately less than a blueprint is worth to anyone else: scrapping is the
 * floor under a duplicate, not the best thing to do with one. Selling it to
 * Tavi pays more, and trading it to another player pays most of all.
 */
export const BLUEPRINT_SCRAP_PARCHMENT = 2;

export function scrapBlockedReason(state: GameState, instanceId: string): string | null {
  const carried = state.carriedBlueprints.find((candidate) => candidate.instanceId === instanceId);
  if (!carried) return 'You are not carrying that blueprint';
  if (isOpeningDiscoveryPaper(state, instanceId)) return 'Register this supply-run discovery at a workbench before disposing of duplicates';
  // Scrapping is bench work, exactly as registering is. A blueprint is only
  // ever resolved — learned or destroyed — somewhere a player had to walk to.
  if (!canRegisterHere(state)) return 'Scrap at a workbench';
  return null;
}

/**
 * Break a carried blueprint down for parchment at a workbench.
 *
 * The one irreversible thing a player can do to a blueprint on purpose, so it
 * is bench work rather than a field action: the trip home is the pause for
 * thought, and nothing is destroyed by a mistap in the middle of a raid.
 */
export function scrapCarriedBlueprint(state: GameState, instanceId: string): CommandResult {
  const blocked = scrapBlockedReason(state, instanceId);
  if (blocked) return { ok: false, message: blocked };

  const carried = removeCarriedBlueprint(state, instanceId)!;
  const name = carried.blueprintId.replace(/-/g, ' ');
  if (!tryAddResource(state, 'draft-parchment', BLUEPRINT_SCRAP_PARCHMENT)) {
    addGroundDrop(
      state, 'draft-parchment', BLUEPRINT_SCRAP_PARCHMENT, state.player.x, state.player.y,
    );
    return {
      ok: true,
      message: `Scrapped ${name} · ${BLUEPRINT_SCRAP_PARCHMENT} Draft Parchment dropped (bag full)`,
    };
  }
  return {
    ok: true,
    message: `Scrapped ${name} · +${BLUEPRINT_SCRAP_PARCHMENT} Draft Parchment`,
  };
}

/**
 * Parchment spent at the drafting table for one blueprint you do not own.
 *
 * Two and a half scrapped duplicates for one new recipe. Priced so a satchel of
 * junk is worth carrying home rather than selling on the spot, without making
 * the table a faster route to a blueprint than actually going and finding one.
 */
export const BLUEPRINT_DRAFT_COST = 5;

export function draftBlockedReason(state: GameState): string | null {
  // Drafting is bench work like registering and scrapping: every irreversible
  // thing that happens to a blueprint happens somewhere you had to walk to.
  if (!canRegisterHere(state)) return 'Draft at a workbench';
  if (state.inventory['draft-parchment'] < BLUEPRINT_DRAFT_COST) {
    return `Need ${BLUEPRINT_DRAFT_COST - state.inventory['draft-parchment']} more Draft Parchment`;
  }
  if (unknownBlueprintIds(state).length === 0) return 'You already know every blueprint';
  if (usedInventorySlots(state) >= INVENTORY_SLOTS) return 'Bag is full';
  return null;
}

/**
 * Draw one blueprint the player does not know, weighted toward the common end.
 *
 * The tier decides first and its members split that share evenly, so adding
 * recipes to a tier never changes how often the *tier* comes up. Tiers the
 * player has already exhausted are dropped before the roll rather than being
 * rolled and rerolled, which keeps the odds honest as a collection fills in.
 */
export function pickDraftedBlueprint(state: GameState, roll: number): string | null {
  const unknown = new Set(unknownBlueprintIds(state));
  const pools = BLUEPRINT_QUALITIES
    .map((quality) => ({
      quality,
      weight: BLUEPRINT_QUALITY_WEIGHTS[quality],
      ids: blueprintsOfQuality(quality).filter((id) => unknown.has(id)),
    }))
    .filter((pool) => pool.ids.length > 0 && pool.weight > 0);
  if (pools.length === 0) return null;

  const total = pools.reduce((sum, pool) => sum + pool.weight, 0);
  let cursor = Math.min(Math.max(roll, 0), 0.999_999) * total;
  for (const pool of pools) {
    if (cursor < pool.weight) {
      const index = Math.floor((cursor / pool.weight) * pool.ids.length);
      return pool.ids[Math.max(0, Math.min(pool.ids.length - 1, index))]!;
    }
    cursor -= pool.weight;
  }
  return pools[pools.length - 1]!.ids[0]!;
}

export interface DraftedBlueprint {
  blueprintId: string;
  quality: BlueprintQuality;
}

/**
 * Spend parchment at a workbench for a blueprint you do not own.
 *
 * It arrives as paper, not knowledge — the same unregistered item a field find
 * produces, drawing the same raiders until it is filed. Drafting is a way to
 * choose *that* a blueprint appears, never a way to skip the trip that makes
 * one yours.
 */
export function draftBlueprint(state: GameState, roll: number): CommandResult & {
  drafted?: DraftedBlueprint;
} {
  const blocked = draftBlockedReason(state);
  if (blocked) return { ok: false, message: blocked };

  const blueprintId = pickDraftedBlueprint(state, roll);
  if (!blueprintId) return { ok: false, message: 'You already know every blueprint' };

  state.inventory['draft-parchment'] -= BLUEPRINT_DRAFT_COST;
  reconcileResourceStacks(state, 'draft-parchment');
  const carried = tryCarryBlueprint(state, blueprintId);
  if (!carried) {
    // Space was checked above, so this is unreachable in practice; refund
    // rather than silently eat five parchment if it ever is reached.
    state.inventory['draft-parchment'] += BLUEPRINT_DRAFT_COST;
    reconcileResourceStacks(state, 'draft-parchment');
    return { ok: false, message: 'Bag is full' };
  }

  const quality = blueprintQuality(blueprintId);
  const name = blueprintId.replace(/-/g, ' ');
  return {
    ok: true,
    message: `Drafted a ${BLUEPRINT_QUALITY_LABELS[quality]} blueprint: ${name} — register it to keep it`,
    drafted: { blueprintId, quality },
  };
}

/**
 * The drafting table as the game calls it: the roll comes from the persisted
 * RNG stream, so a draw is reproducible from a save and cannot be rerolled by
 * reloading. `draftBlueprint` stays pure for tests that need a fixed roll.
 */
export function draftBlueprintFromParchment(state: GameState): CommandResult {
  const blocked = draftBlockedReason(state);
  if (blocked) return { ok: false, message: blocked };
  const rng = createRng(state.rngState);
  const roll = rng.nextInt(0, 1_000_000) / 1_000_000;
  state.rngState = rng.getState();
  return draftBlueprint(state, roll);
}

/** The nearest blueprint lying in reach, or null. */
export function nearestBlueprintDrop(
  state: GameState,
  range = INTERACTION_RANGE_PX,
): BlueprintGroundDrop | null {
  let nearest: BlueprintGroundDrop | null = null;
  let nearestDistance = range;
  for (const drop of state.blueprintDrops) {
    const distance = Math.hypot(drop.x - state.player.x, drop.y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = drop;
      nearestDistance = distance;
    }
  }
  return nearest;
}
