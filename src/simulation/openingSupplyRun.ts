import { isOpeningGuardian, openingGuardianId, openingSideCacheId, openingSupplyCacheId } from '../content/onboarding';
import { buildableById } from '../content/buildingParts';
import { INTERACTION_RANGE_PX, gameCreatureDefinition } from '../config/balance';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { effectiveBuildingDimensions } from './buildingGeometry';
import { terrainAtWithBuildings, terrainCapabilities } from './landscape';
import { isTownFootprintTile } from '../content/townBuildings';
import { addGroundDrop, FACILITY_INTERACTION_RANGE_PX, selectCompanionAbility, setBattleCompanion, tryAddResource, type CommandResult } from './gameplayCommands';
import { startEncounterWithCreature } from './encounters';
import { tryCarryBlueprint } from './carriedBlueprints';
import { knowsBlueprint } from './blueprintKnowledge';
import { completeOpeningMilestone } from './onboardingProgress';
import { ELARIS_PUBLIC_WORKBENCH_TILE, withinElarisPublicWorkbench } from './elarisWorkbench';
import { resolveTownMovement } from './town';
import { isBuildingBoundaryCrossingBlocked } from './buildingCollision';
import type { GameState, ResourceId, WildCreatureState } from './state';
import type { ShelterSite } from './openingShelter';

export const SUPPLY_RUN_MATERIALS = { wood: 4, fiber: 2 } as const;
export const SUPPLY_RUN_ROAD = { tileX: 56, tileY: 85 } as const;
export const supplyRunAvailable = (state: GameState) => !!state.onboarding.supplyRun && state.onboarding.completedMilestoneIds.includes('return-to-follow');
export function supplyRunInReach(state: GameState, sideCache = false): boolean {
  const site = state.onboarding.supplyRun?.site;
  return !!site && state.currentArea.key === site.areaKey && Math.hypot(state.player.x - (site.tileX + .5 - (sideCache ? 4 : 0)) * TILE_SIZE, state.player.y - (site.tileY + .5) * TILE_SIZE) <= INTERACTION_RANGE_PX;
}

/** The authored west road is walkable across seeds. Never clears existing property. */
export function findSupplyRunSite(state: GameState): ShelterSite | null {
  if (state.currentArea.key !== '0,0') return null;
  const clear = (x: number, y: number) => terrainCapabilities(terrainAtWithBuildings(state.seed, state.currentArea, state.buildings, x, y)).walkable
    && !isTownFootprintTile(x, y) && !state.buildings.some((building) => {
      const size = effectiveBuildingDimensions(building);
      return x >= building.tileX && x < building.tileX + size.tilesWide && y >= building.tileY && y < building.tileY + size.tilesHigh;
    }) && !state.resourceNodes.some((node) => node.hp > 0 && Math.floor(node.x / TILE_SIZE) === x && Math.floor(node.y / TILE_SIZE) === y)
    && !state.containers.some((container) => Math.floor(container.x / TILE_SIZE) === x && Math.floor(container.y / TILE_SIZE) === y);
  for (const y of [85, 84, 86, 83]) for (let radius = 0; radius <= 12; radius++) for (const x of radius === 0 ? [34] : [34 - radius, 34 + radius]) {
    if (clear(x, y) && clear(x - 4, y) && clear(x - 1, y)) return { areaKey: '0,0', tileX: x, tileY: y };
  }
  return null;
}

export function reconcileOpeningSupplyRun(state: GameState): boolean {
  if (!supplyRunAvailable(state)) return false;
  const run = state.onboarding.supplyRun!; let changed = false;
  if (!run.site && state.currentArea.key === '0,0') { run.site = findSupplyRunSite(state); if (run.site) changed = true; }
  if (run.site && state.currentArea.key === run.site.areaKey) {
    for (const [id, dx, opened] of [[openingSupplyCacheId(state.seed), 0, run.suppliesRecovered], [openingSideCacheId(state.seed), -4, run.sideCacheOpened]] as const) {
      const existing = state.containers.find((container) => container.id === id);
      if (!existing) { state.containers.push({ id, kind: dx === 0 ? 'supply-cache' : 'hollow-log', x: (run.site.tileX + dx + .5) * TILE_SIZE, y: (run.site.tileY + .5) * TILE_SIZE, opened }); changed = true; }
      else if (opened && !existing.opened) { existing.opened = true; changed = true; }
    }
    if (!run.discovered && Math.hypot(state.player.x - (run.site.tileX + .5) * TILE_SIZE, state.player.y - (run.site.tileY + .5) * TILE_SIZE) <= 8 * TILE_SIZE) { run.discovered = true; changed = true; }
  }
  if (state.onboarding.status === 'active') {
    if (run.suppliesRecovered && completeOpeningMilestone(state, 'recover-supplies')) changed = true;
    if (run.suppliesRecovered && run.blueprintClaimed) {
      if (completeOpeningMilestone(state, 'collect-discovery')) changed = true;
    }
  }
  return changed;
}

export function claimOpeningDiscovery(state: GameState): CommandResult {
  const run = state.onboarding.supplyRun;
  if (!run?.suppliesRecovered || run.blueprintClaimed) return { ok: false, message: 'The discovery is not ready or was already collected' };
  if (state.pendingRespawn || state.activeEncounter || !supplyRunInReach(state) && !withinElarisPublicWorkbench(state, FACILITY_INTERACTION_RANGE_PX)) return { ok: false, message: 'Collect the paper at the supply cart or Elaris public workbench' };
  if (knowsBlueprint(state, 'garden-bed')) { run.blueprintClaimed = true; return { ok: true, message: 'You already know the Garden Bed recipe. The recovered building materials are yours.' }; }
  const paper = tryCarryBlueprint(state, 'garden-bed');
  if (!paper) return { ok: false, message: 'Bag full. The Garden Bed blueprint waits safely at the cart or Elaris public workbench; make one free space.' };
  run.blueprintClaimed = true; run.blueprintInstanceId = paper.instanceId;
  return { ok: true, message: 'Garden Bed blueprint recovered. Bring it east along the road to Elaris public workbench at X 84, Y 83 to register it.' };
}

export function recoverOpeningSupplies(state: GameState): CommandResult {
  const run = state.onboarding.supplyRun;
  if (!supplyRunAvailable(state) || !run || !supplyRunInReach(state) || state.activeEncounter || state.pendingRespawn) return { ok: false, message: 'Move near the supply cart outside an encounter' };
  if (run.suppliesRecovered) return claimOpeningDiscovery(state);
  run.discovered = true; run.suppliesRecovered = true;
  const container = state.containers.find((candidate) => candidate.id === openingSupplyCacheId(state.seed)); if (container) container.opened = true;
  for (const [id, amount] of Object.entries(SUPPLY_RUN_MATERIALS)) if (!tryAddResource(state, id as ResourceId, amount)) addGroundDrop(state, id as ResourceId, amount, state.player.x, state.player.y);
  const delivery = claimOpeningDiscovery(state);
  return { ok: true, message: `Supplies recovered: 4 wood and 2 fiber for a future Garden Bed. ${delivery.message}`, targetId: openingSupplyCacheId(state.seed) };
}

export function openOpeningSideCache(state: GameState): CommandResult {
  const run = state.onboarding.supplyRun;
  if (!supplyRunAvailable(state) || !run || run.sideCacheOpened || !supplyRunInReach(state, true) || state.activeEncounter || state.pendingRespawn) return { ok: false, message: 'Move closer to the unopened roadside log' };
  run.sideCacheOpened = true;
  const container = state.containers.find((candidate) => candidate.id === openingSideCacheId(state.seed)); if (container) container.opened = true;
  for (const [id, amount] of [['berry', 3], ['cloth-mask', 1]] as const) if (!tryAddResource(state, id, amount)) addGroundDrop(state, id, amount, state.player.x, state.player.y);
  return { ok: true, message: 'Roadside log: 3 berries and 1 Cloth Mask. The supply cart is four tiles east.', targetId: openingSideCacheId(state.seed) };
}

export function beginOpeningGuardPractice(state: GameState): CommandResult {
  const run = state.onboarding.supplyRun;
  if (!supplyRunAvailable(state) || !run?.site || !supplyRunInReach(state) || state.pendingRespawn || state.activeEncounter) return { ok: false, message: 'Walk near the supply cart to practise Shell Guard' };
  if (run.guardianDefeated) return { ok: false, message: 'You have already defeated this Craghopper. Recover the supplies or head home.' };
  const companion = state.ownedCreatures.find((creature) => creature.id === state.onboarding.companionId);
  if (!companion || companion.role !== 'follow' || state.expeditions.some((expedition) => expedition.creatureId === companion.id)) return { ok: false, message: 'Bring your following Tuftle to practise Shell Guard together' };
  let guardian = state.wildCreatures.find((creature) => isOpeningGuardian(state, creature.id));
  const created = !guardian;
  if (!guardian) {
    const maxHp = gameCreatureDefinition(state, 'craghopper').encounter.maxHp;
    const x = (run.site.tileX - .5) * TILE_SIZE; const y = (run.site.tileY + .5) * TILE_SIZE;
    guardian = { id: openingGuardianId(state.seed), speciesId: 'craghopper', x, y, homeX: x, homeY: y, level: 1, hp: Math.min(maxHp, 18), maxHp, aggroUntilTick: 0,
      nextAttackTick: 0, fleeUntilTick: 0, captureBonusBps: 0, encounterCooldownUntilTick: 0 } satisfies WildCreatureState;
    state.wildCreatures.push(guardian);
  }
  const previous = { id: state.battleCompanionId, ability: companion.selectedBattleAbilityId };
  setBattleCompanion(state, companion.id); selectCompanionAbility(state, 'tuftle-guard', companion.id);
  const result = startEncounterWithCreature(state, guardian.id, INTERACTION_RANGE_PX + TILE_SIZE);
  if (!result.ok) { state.battleCompanionId = previous.id; companion.selectedBattleAbilityId = previous.ability; if (created) state.wildCreatures = state.wildCreatures.filter((wild) => wild.id !== guardian!.id); return result; }
  run.guardianStarted = true;
  state.activeEncounter!.message = 'Optional guard practice. Read Intent before acting. Shell Guard blocks an incoming hit when ready; Rest lets the Craghopper approach. Retreat is guaranteed here. Supplies do not require a win.';
  return { ok: true, message: state.activeEncounter!.message };
}

/** Match actual walking rules; a saved player-built obstruction gets an honest no-route answer. */
export function supplyRunRoute(state: GameState, target: { tileX: number; tileY: number }): Array<{ tileX: number; tileY: number }> | null {
  if (state.currentArea.key !== '0,0') return null;
  const start = { tileX: Math.floor(state.player.x / TILE_SIZE), tileY: Math.floor(state.player.y / TILE_SIZE) };
  const queue = [start]; const parents = new Map<string, string | null>([[`${start.tileX},${start.tileY}`, null]]);
  const blocked = new Set<string>();
  for (const building of state.buildings) if (buildableFootprint(building.definitionId)) {
    const size = effectiveBuildingDimensions(building);
    for (let dy = 0; dy < size.tilesHigh; dy++) for (let dx = 0; dx < size.tilesWide; dx++) blocked.add(`${building.tileX + dx},${building.tileY + dy}`);
  }
  for (let i = 0; i < queue.length && i < 10000; i++) {
    const point = queue[i]!; const key = `${point.tileX},${point.tileY}`;
    if (point.tileX === target.tileX && point.tileY === target.tileY) {
      const route = [point]; let parent = parents.get(key);
      while (parent) { const [x, y] = parent.split(',').map(Number); route.push({ tileX: x!, tileY: y! }); parent = parents.get(parent); }
      return route.reverse();
    }
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const x = point.tileX + dx; const y = point.tileY + dy; const nextKey = `${x},${y}`;
      if (x < 0 || y < 0 || x >= WORLD_TILES || y >= WORLD_TILES || parents.has(nextKey) || blocked.has(nextKey)
        || !terrainCapabilities(terrainAtWithBuildings(state.seed, state.currentArea, state.buildings, x, y)).walkable) continue;
      const fromX = (point.tileX + .5) * TILE_SIZE; const fromY = (point.tileY + .5) * TILE_SIZE;
      const toX = (x + .5) * TILE_SIZE; const toY = (y + .5) * TILE_SIZE;
      const town = resolveTownMovement(state, fromX, fromY, toX, toY);
      if (town.x !== toX || town.y !== toY || isBuildingBoundaryCrossingBlocked(state.buildings, fromX, fromY, dx, dy)) continue;
      parents.set(nextKey, key); queue.push({ tileX: x, tileY: y });
    }
  }
  return null;
}

const buildableFootprint = (id: Parameters<typeof buildableById>[0]) => buildableById(id).footprintKind === 'facility';
export function supplyRunTarget(state: GameState) {
  const run = state.onboarding.supplyRun;
  if (!supplyRunAvailable(state) || !run?.site || state.currentArea.key !== '0,0') return null;
  if (run.blueprintClaimed && knowsBlueprint(state, 'garden-bed')) return null;
  const drop = run.blueprintDropId ? state.blueprintDrops.find((candidate) => candidate.id === run.blueprintDropId) : null;
  if (drop) return { tileX: Math.floor(drop.x / TILE_SIZE), tileY: Math.floor(drop.y / TILE_SIZE), label: 'Discovery paper' };
  return run.suppliesRecovered ? { ...ELARIS_PUBLIC_WORKBENCH_TILE, label: 'Public workbench' } : { tileX: run.site.tileX, tileY: run.site.tileY, label: 'Lost supply cart' };
}
