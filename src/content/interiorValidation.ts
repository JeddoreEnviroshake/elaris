import { NPC_DEFINITIONS, type NpcDefinition } from './npcs';
import {
  INTERIOR_DEFINITIONS,
  INTERIOR_INTERACTION_RANGE_TILES,
  isInsideTownShell,
  reachableShellPoints,
  townBuildingShell,
  type InteriorDefinition,
  type RoomPoint,
} from './interiors';
import { TOWN_BUILDINGS, type TownBuildingDefinition } from './townBuildings';

export function interiorContentValidationErrors(
  interiors: readonly InteriorDefinition[] = INTERIOR_DEFINITIONS,
  buildings: readonly TownBuildingDefinition[] = TOWN_BUILDINGS,
  npcs: readonly NpcDefinition[] = NPC_DEFINITIONS,
): string[] {
  const errors: string[] = [];
  const knownNpcs = new Map(npcs.map((npc) => [npc.id, npc]));
  const interiorsById = new Map<string, InteriorDefinition>();
  const interiorsByBuilding = new Map<string, InteriorDefinition>();

  for (const interior of interiors) {
    if (interiorsById.has(interior.id)) errors.push(`interior:${interior.id} is duplicated`);
    else interiorsById.set(interior.id, interior);
    if (interiorsByBuilding.has(interior.buildingId)) errors.push(`interior building:${interior.buildingId} is duplicated`);
    else interiorsByBuilding.set(interior.buildingId, interior);
    errors.push(...validateInteriorDefinition(interior, knownNpcs));
  }

  for (const building of buildings) {
    const interior = interiorsById.get(building.interiorId);
    if (!interior) {
      errors.push(`building:${building.id} references unknown interior:${building.interiorId}`);
      continue;
    }
    if (interior.buildingId !== building.id) {
      errors.push(`building:${building.id} interior:${interior.id} belongs to building:${interior.buildingId}`);
    }
    const spawn = interior.npcSpawns.find((candidate) => candidate.npcId === building.npcId);
    if (!spawn) errors.push(`building:${building.id} interior:${interior.id} is missing NPC:${building.npcId}`);
    const service = interior.hotspots.find((hotspot) =>
      hotspot.kind === 'service' && hotspot.npcId === building.npcId && hotspot.service === building.service,
    );
    if (!service) errors.push(`building:${building.id} interior:${interior.id} is missing its ${building.service} service hotspot`);
    errors.push(...validateInteriorPlacement(interior, building));
  }

  const buildingIds = new Set(buildings.map((building) => building.id));
  for (const interior of interiors) {
    if (!buildingIds.has(interior.buildingId)) errors.push(`interior:${interior.id} references unknown building:${interior.buildingId}`);
  }
  return errors;
}

/** Authoring checks that do not depend on which site the room is built at. */
export function validateInteriorDefinition(
  interior: InteriorDefinition,
  knownNpcs: ReadonlyMap<string, NpcDefinition> = new Map(NPC_DEFINITIONS.map((npc) => [npc.id, npc])),
): string[] {
  const errors: string[] = [];
  const label = `interior:${interior.id}`;
  uniqueIds(interior.props.map((prop) => prop.id), `${label} prop`, errors);
  uniqueIds(interior.hotspots.map((hotspot) => hotspot.id), `${label} hotspot`, errors);
  uniqueIds(interior.npcSpawns.map((spawn) => spawn.npcId), `${label} NPC`, errors);

  for (const point of [...interior.props, ...interior.hotspots, ...interior.npcSpawns, ...interior.patrons]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) errors.push(`${label} has a non-finite position`);
  }
  for (const prop of interior.props) {
    if (prop.scale !== undefined && (!Number.isFinite(prop.scale) || prop.scale <= 0)) {
      errors.push(`${label} prop:${prop.id} has an invalid scale`);
    }
  }
  for (const hotspot of interior.hotspots) {
    if (hotspot.kind !== 'service') continue;
    const npc = knownNpcs.get(hotspot.npcId);
    if (!npc) errors.push(`${label} hotspot:${hotspot.id} references unknown NPC:${hotspot.npcId}`);
    else if (npc.service !== hotspot.service) errors.push(`${label} hotspot:${hotspot.id} service does not match NPC:${npc.id}`);
    if (!interior.npcSpawns.some((spawn) => spawn.npcId === hotspot.npcId)) {
      errors.push(`${label} hotspot:${hotspot.id} has no spawn for NPC:${hotspot.npcId}`);
    }
  }
  for (const spawn of interior.npcSpawns) {
    if (!knownNpcs.has(spawn.npcId)) errors.push(`${label} references unknown NPC:${spawn.npcId}`);
  }
  if (!interior.hotspots.some((hotspot) => hotspot.kind === 'service')) errors.push(`${label} must declare a service hotspot`);

  if (!validColor(interior.ambience.ambientColor) || !validColor(interior.ambience.keyLightColor)
    || !finiteNonNegative(interior.ambience.ambientIntensity) || !finiteNonNegative(interior.ambience.keyLightIntensity)
    || interior.ambience.soundscape.trim().length === 0) {
    errors.push(`${label} has invalid ambience configuration`);
  }
  return errors;
}

/**
 * Checks against one site: everything stands between the walls, and every
 * hotspot can be reached on foot from outside that site's own doorway. A
 * blueprint's sites may put the door in different columns, so each is checked.
 */
export function validateInteriorPlacement(interior: InteriorDefinition, building: TownBuildingDefinition): string[] {
  const errors: string[] = [];
  const label = `interior:${interior.id} at ${building.areaKey}`;
  const shell = townBuildingShell(building);
  const placed: Array<readonly [string, RoomPoint]> = [
    ...interior.props.map((prop) => [`prop:${prop.id}`, prop] as const),
    ...interior.hotspots.map((hotspot) => [`hotspot:${hotspot.id}`, hotspot] as const),
    ...interior.npcSpawns.map((spawn) => [`NPC:${spawn.npcId}`, spawn] as const),
    ...interior.patrons.map((patron, index) => [`patron:${index}`, patron] as const),
  ];
  for (const [pointLabel, point] of placed) {
    if (!isInsideTownShell(shell, point.x, point.y)) errors.push(`${label} ${pointLabel} is outside the walls`);
  }
  const reachable = reachableShellPoints(shell, interior);
  if (!reachable.some((point) => isInsideTownShell(shell, point.x, point.y))) {
    errors.push(`${label} doorway does not lead inside`);
    return errors;
  }
  for (const hotspot of interior.hotspots) {
    const usable = reachable.some((point) =>
      Math.hypot(point.x - hotspot.x, point.y - hotspot.y) <= INTERIOR_INTERACTION_RANGE_TILES - 0.2);
    if (!usable) errors.push(`${label} hotspot:${hotspot.id} cannot be reached from the doorway`);
  }
  return errors;
}

function uniqueIds(ids: readonly string[], label: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id.length === 0) errors.push(`${label} has an empty ID`);
    else if (seen.has(id)) errors.push(`${label}:${id} is duplicated`);
    seen.add(id);
  }
}

function finiteNonNegative(value: number): boolean { return Number.isFinite(value) && value >= 0; }
function validColor(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff; }
