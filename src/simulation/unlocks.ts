import type { AreaTier } from '../config/areaGates';
import { AREA_TIERS, PLACEABLES } from '../config/areaGates';
import { buildableById } from '../content/buildingParts';
import { evaluateFacilityGate } from './environmentProgress';
import type { BuildingDefinitionId, GameState, GatherableResourceId, MaterialId, SpeciesId, ToolDefinitionId } from './state';

/**
 * Typed, inspectable unlock ownership (spec: "Unlock ownership and
 * prerequisites"). Every recipe, contract, and placeable carries exactly one
 * requirement; systems and UI both evaluate it here and surface the exact
 * failed predicates. Unlock logic is never distributed across UI code.
 */

export type UnlockPredicate =
  | { kind: 'highestAreaTierEver'; atLeast: AreaTier }
  | { kind: 'materialDiscovered'; materialId: MaterialId }
  | { kind: 'highestRatingEver'; atLeast: number }
  | { kind: 'firstTamedSpecies'; speciesId: SpeciesId }
  | { kind: 'workstationAvailable'; workstationId: BuildingDefinitionId }
  | { kind: 'resourceCollected'; resourceId: GatherableResourceId; atLeast: number }
  | { kind: 'toolOwned'; definitionId: ToolDefinitionId }
  | { kind: 'facilityPlaced'; definitionId: BuildingDefinitionId }
  | { kind: 'workerResourcesProduced'; atLeast: number };

export interface UnlockRequirement {
  allOf?: UnlockPredicate[];
  anyOf?: UnlockPredicate[];
  /** Truly free content is explicitly marked; an empty requirement fails. */
  alwaysUnlocked?: boolean;
}

export interface UnlockEvaluation {
  unlocked: boolean;
  /** Exact failed predicates, for UI reasons. Empty when unlocked. */
  failed: UnlockPredicate[];
}

/**
 * `workstationAvailable` is an execution requirement, not permanent ownership:
 * a placed workstation counts only while its current environment qualifies.
 * Losing it pauses the craft but never erases a discovered recipe.
 */
function workstationAvailable(state: GameState, workstationId: BuildingDefinitionId): boolean {
  const placeable = PLACEABLES.find((candidate) => candidate.id === workstationId);
  return state.buildings.some((building) => {
    if (building.definitionId !== workstationId) return false;
    if (!placeable) return true;
    const definition = buildableById(building.definitionId);
    return evaluateFacilityGate(
      state.buildings, placeable, building.tileX, building.tileY, definition.tilesWide, definition.tilesHigh,
    ).ok;
  });
}

/**
 * Detailed lock reason for a workstation requirement: distinguishes "none
 * placed yet" from a placed-but-non-qualifying station, surfacing the exact
 * facility-gate failure (enclosure, area, kind) instead of a vague line.
 * Only called when the predicate is known unmet, so every placed station fails.
 */
function workstationBlockedReason(state: GameState, workstationId: BuildingDefinitionId): string {
  const name = workstationId.replace(/-/g, ' ');
  const placed = state.buildings.filter((building) => building.definitionId === workstationId);
  if (placed.length === 0) return `place a ${name}`;
  const placeable = PLACEABLES.find((candidate) => candidate.id === workstationId);
  if (!placeable) return `needs a working ${name}`;
  for (const building of placed) {
    const definition = buildableById(building.definitionId);
    const gate = evaluateFacilityGate(
      state.buildings, placeable, building.tileX, building.tileY, definition.tilesWide, definition.tilesHigh,
    );
    if (!gate.ok && gate.reason) return `${name} — ${gate.reason}`;
  }
  return `needs a working ${name}`;
}

export function predicateSatisfied(state: GameState, predicate: UnlockPredicate): boolean {
  switch (predicate.kind) {
    case 'highestAreaTierEver':
      return state.highestAreaTierEver >= predicate.atLeast;
    case 'materialDiscovered':
      // Lifetime collection is sticky; inventory covers migrated/test states
      // that already possess a material before the discovery counter existed.
      return predicate.materialId === 'iron'
        ? state.resourcesCollected['iron-ore'] > 0 || state.resourcesCollected['iron-ingot'] > 0
          || state.inventory['iron-ore'] > 0 || state.inventory['iron-ingot'] > 0
        : state.resourcesCollected[predicate.materialId] > 0 || state.inventory[predicate.materialId] > 0;
    case 'highestRatingEver':
      return state.highestRatingEverTenths >= predicate.atLeast * 10;
    case 'firstTamedSpecies':
      return state.firstTamedSpeciesIds.includes(predicate.speciesId);
    case 'workstationAvailable':
      return workstationAvailable(state, predicate.workstationId);
    case 'resourceCollected':
      return state.resourcesCollected[predicate.resourceId] >= predicate.atLeast;
    case 'toolOwned':
      return state.tools.some((tool) => tool.definitionId === predicate.definitionId);
    case 'facilityPlaced':
      return state.buildings.some((building) => building.definitionId === predicate.definitionId);
    case 'workerResourcesProduced':
      return state.workerResourcesProduced >= predicate.atLeast;
  }
}

/**
 * Spec-exact evaluation:
 *   predicateCount > 0 && every(allOf ?? []) &&
 *   (anyOf == null ? true : anyOf.length > 0 && some(anyOf))
 * Both groups AND together; a requirement with no predicates fails, and an
 * explicitly empty anyOf fails, unless the content is marked alwaysUnlocked.
 */
export function evaluateUnlock(state: GameState, requirement: UnlockRequirement): UnlockEvaluation {
  if (requirement.alwaysUnlocked) return { unlocked: true, failed: [] };
  const allOf = requirement.allOf ?? [];
  const anyOf = requirement.anyOf;
  const predicateCount = allOf.length + (anyOf?.length ?? 0);
  if (predicateCount === 0) return { unlocked: false, failed: [] };

  const failed = allOf.filter((predicate) => !predicateSatisfied(state, predicate));
  let anySatisfied = true;
  if (anyOf != null) {
    anySatisfied = anyOf.length > 0 && anyOf.some((predicate) => predicateSatisfied(state, predicate));
    if (!anySatisfied) failed.push(...anyOf);
  }
  return { unlocked: failed.length === 0 && anySatisfied, failed };
}

export function describePredicate(predicate: UnlockPredicate): string {
  switch (predicate.kind) {
    case 'highestAreaTierEver': {
      const tier = AREA_TIERS.find((candidate) => candidate.area === predicate.atLeast);
      return `first enclose a ${predicate.atLeast}-tile ${tier?.label ?? 'area'}`;
    }
    case 'materialDiscovered':
      return `collect ${predicate.materialId} first`;
    case 'highestRatingEver':
      return `reach Homestead Rating ${predicate.atLeast}`;
    case 'firstTamedSpecies':
      return `tame a ${predicate.speciesId} first`;
    case 'workstationAvailable':
      return `needs a working ${predicate.workstationId.replace(/-/g, ' ')}`;
    case 'resourceCollected':
      return `collect ${predicate.atLeast} ${predicate.resourceId}`;
    case 'toolOwned':
      return `craft ${predicate.definitionId.replace(/-/g, ' ')}`;
    case 'facilityPlaced':
      return `place ${predicate.definitionId.replace(/-/g, ' ')}`;
    case 'workerResourcesProduced':
      return `have workers produce ${predicate.atLeast} resources`;
  }
}

/** One concise lock line for menus, or null when unlocked. */
export function unlockBlockedReason(state: GameState, requirement: UnlockRequirement): string | null {
  const evaluation = evaluateUnlock(state, requirement);
  if (evaluation.unlocked) return null;
  const first = evaluation.failed[0];
  if (!first) return 'Locked';
  const detail = first.kind === 'workstationAvailable'
    ? workstationBlockedReason(state, first.workstationId)
    : describePredicate(first);
  return `Locked — ${detail}`;
}
