import { PLACEABLES } from '../config/areaGates';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { buildableById } from '../content/buildingParts';
import { creatureDefinition } from '../content/creatures';
import { isCreatureAway } from './expeditions';
import type { GatherableResourceId, ResourceNodeState } from './state';
import { CREATURE_WORK_PASSIVES } from '../content/creatureWorkPassives';
import { cellKey, evaluateFacilityGate, environmentAt, type EnvironmentInfo } from './environmentProgress';
import type { BuildingState, GameState, OwnedCreatureState } from './state';

export const FOLLOWER_ACTION_SPEED_CAP_BPS = 10_000;

/** Followers accompany the player; assistance reach is measured from player to harvested node. */
export function activeFollowerGatherAssistance(state: GameState, node: ResourceNodeState, resource: GatherableResourceId) {
  if (node.kind !== 'plant' || state.pendingRespawn || state.activeEncounter || state.player.traversalMode === 'boat') return null;
  const distance = Math.hypot(node.x - state.player.x, node.y - state.player.y);
  let best: { creatureId: string; creatureName: string; amountBps: number } | null = null;
  for (const creature of [...state.ownedCreatures].sort((a, b) => a.id.localeCompare(b.id))) {
    if (creature.role !== 'follow' || isCreatureAway(state, creature.id)) continue;
    for (const modifier of creatureDefinition(creature.speciesId).followerModifiers) {
      if (modifier.stat !== 'gatherYield' || !modifier.targets.includes(resource) || distance > modifier.rangePx) continue;
      // This channel uses the strongest eligible helper, rather than stacking duplicate companions.
      if (!best || modifier.amountBps > best.amountBps) best = { creatureId: creature.id, creatureName: creature.name, amountBps: modifier.amountBps };
    }
  }
  return best;
}
export const SNARLFOX_SAFETY_MULTIPLIER_BPS = 7_500;
export const SNARLFOX_SAFETY_PERIMETER_TILES = 6;

/** Functional operation gate shared by every species-specific worksite. */
export function creatureWorksiteOperationGate(state: GameState, building: BuildingState): boolean {
  const placeable = PLACEABLES.find((candidate) => candidate.id === building.definitionId);
  if (!placeable) return false;
  const definition = buildableById(building.definitionId);
  return evaluateFacilityGate(
    state.buildings,
    placeable,
    building.tileX,
    building.tileY,
    definition.tilesWide,
    definition.tilesHigh,
  ).ok;
}

export function creatureWorksiteEnvironment(state: GameState, building: BuildingState): EnvironmentInfo | null {
  if (!creatureWorksiteOperationGate(state, building)) return null;
  return environmentAt(state.buildings, building.tileX, building.tileY);
}

/** Invalid worksite references rest safely while retaining a valid housing reservation. */
export function reconcileCreatureWorksites(state: GameState): boolean {
  let changed = false;
  for (const creature of state.ownedCreatures) {
    if (creature.role !== 'work') continue;
    const definition = creatureDefinition(creature.speciesId);
    const worksite = creature.worksiteId
      ? state.buildings.find((building) => building.id === creature.worksiteId) ?? null
      : null;
    const valid = definition.work !== null
      && worksite !== null
      && definition.work.eligibleWorksites.includes(worksite.definitionId)
      && creatureWorksiteOperationGate(state, worksite);
    if (valid) continue;
    creature.role = 'rest';
    creature.assignment = null;
    creature.worksiteId = null;
    creature.workRemainderMs = 0;
    if (state.battleCompanionId === creature.id) state.battleCompanionId = null;
    changed = true;
  }
  return changed;
}

/**
 * A work-role creature that is actually on shift right now.
 *
 * Housing and an operational worksite are both required, which is the same bar
 * production already answers to: a creature whose pen was demolished is not
 * quietly still working, it is resting. Returns the worksite because every
 * caller needs it — a passive is anchored to the building, not to the creature.
 */
export function activeWorksiteFor(state: GameState, creature: OwnedCreatureState): BuildingState | null {
  if (creature.role !== 'work' || !creature.housingId || !creature.worksiteId) return null;
  const definition = creatureDefinition(creature.speciesId);
  if (!definition.work) return null;
  const housing = state.buildings.find((building) => building.id === creature.housingId);
  const worksite = state.buildings.find((building) => building.id === creature.worksiteId);
  if (!housing || !worksite) return null;
  if (!definition.work.eligibleWorksites.includes(worksite.definitionId)) return null;
  if (!creatureWorksiteOperationGate(state, housing)) return null;
  return creatureWorksiteOperationGate(state, worksite) ? worksite : null;
}

/**
 * Tiles kept breathable by a `purified-zone` creature on shift.
 *
 * Lives here rather than with the other work passives so poison-fog shelter can
 * ask for it without survivalCycle having to reach into the raid module, which
 * imports survivalCycle right back.
 *
 * The square is anchored on the worksite's own tile and extends east and south,
 * so where it lands is a placement decision the player can see and plan around
 * rather than something that shifts as the creature wanders.
 */
export function creaturePurifiedCells(
  state: GameState,
  creatures: readonly OwnedCreatureState[] = state.ownedCreatures,
): Set<string> {
  const cells = new Set<string>();
  for (const creature of creatures) {
    const passive = creatureDefinition(creature.speciesId).work?.passive;
    if (passive !== 'purified-zone') continue;
    const worksite = activeWorksiteFor(state, creature);
    if (!worksite) continue;
    // Two tiles square; the definition's `amount` is that square's cell count,
    // so widening the zone is a content edit rather than a code change.
    const side = Math.max(1, Math.round(Math.sqrt(CREATURE_WORK_PASSIVES['purified-zone'].amount)));
    for (let dy = 0; dy < side; dy += 1) {
      for (let dx = 0; dx < side; dx += 1) {
        const tileX = worksite.tileX + dx;
        const tileY = worksite.tileY + dy;
        if (tileX < 0 || tileY < 0 || tileX >= WORLD_TILES || tileY >= WORLD_TILES) continue;
        cells.add(cellKey(tileX, tileY));
      }
    }
  }
  return cells;
}

/** Strongest amount per stacking group, summed and capped for one target channel. */
export function activeFollowerActionSpeedBps(state: GameState, target: string): number {
  if (target !== 'stone' && target !== 'metal') return 0;
  const strongestByGroup = new Map<string, number>();
  for (const creature of state.ownedCreatures) {
    if (creature.role !== 'follow') continue;
    for (const modifier of creatureDefinition(creature.speciesId).followerModifiers) {
      if (modifier.stat !== 'actionSpeed' || !modifier.targets.includes(target)) continue;
      strongestByGroup.set(
        modifier.stackingGroup,
        Math.max(strongestByGroup.get(modifier.stackingGroup) ?? 0, modifier.amountBps),
      );
    }
  }
  return Math.min(FOLLOWER_ACTION_SPEED_CAP_BPS, [...strongestByGroup.values()].reduce((sum, value) => sum + value, 0));
}

function environmentIncludesPointWithPerimeter(environment: EnvironmentInfo, worldX: number, worldY: number): boolean {
  const tileX = worldX / TILE_SIZE;
  const tileY = worldY / TILE_SIZE;
  let nearestSquared = Number.POSITIVE_INFINITY;
  for (const key of environment.cells) {
    const [cellX, cellY] = key.split(',').map(Number) as [number, number];
    const dx = tileX < cellX ? cellX - tileX : tileX > cellX + 1 ? tileX - (cellX + 1) : 0;
    const dy = tileY < cellY ? cellY - tileY : tileY > cellY + 1 ? tileY - (cellY + 1) : 0;
    nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
  }
  return nearestSquared <= SNARLFOX_SAFETY_PERIMETER_TILES ** 2;
}

/** Aggressive detection scale at a world point; encounters deliberately disable it. */
export function snarlfoxDetectionMultiplierBps(state: GameState, worldX: number, worldY: number): number {
  if (state.activeEncounter) return 10_000;
  for (const creature of state.ownedCreatures) {
    if (creature.speciesId !== 'snarlfox' || creature.role !== 'work' || !creature.worksiteId || !creature.housingId) continue;
    const worksite = state.buildings.find((building) => building.id === creature.worksiteId);
    const housing = state.buildings.find((building) => building.id === creature.housingId);
    if (!worksite || !housing || !creatureWorksiteOperationGate(state, housing)) continue;
    const environment = creatureWorksiteEnvironment(state, worksite);
    if (environment && environmentIncludesPointWithPerimeter(environment, worldX, worldY)) {
      return SNARLFOX_SAFETY_MULTIPLIER_BPS;
    }
  }
  return 10_000;
}
