import { NPC_DEFINITIONS, type NpcDefinition } from './npcs';
import {
  INTERIOR_DEFINITIONS,
  interiorTileKey,
  isInteriorTileWalkable,
  reachableInteriorTileKeys,
  type InteriorCollider,
  type InteriorDefinition,
  type InteriorPoint,
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
  }

  const buildingIds = new Set(buildings.map((building) => building.id));
  for (const interior of interiors) {
    if (!buildingIds.has(interior.buildingId)) errors.push(`interior:${interior.id} references unknown building:${interior.buildingId}`);
  }
  return errors;
}

export function validateInteriorDefinition(
  interior: InteriorDefinition,
  knownNpcs: ReadonlyMap<string, NpcDefinition> = new Map(NPC_DEFINITIONS.map((npc) => [npc.id, npc])),
): string[] {
  const errors: string[] = [];
  const label = `interior:${interior.id}`;
  const { tilesWide, tilesHigh } = interior.dimensions;
  if (!positiveInteger(tilesWide) || !positiveInteger(tilesHigh)) errors.push(`${label} has invalid dimensions`);

  validatePoint(interior, interior.playerSpawn, 'player spawn', errors);
  validatePoint(interior, interior.exit, 'exit', errors);
  validatePoint(interior, interior.camera.target, 'camera target', errors);

  uniqueIds(interior.collision.map((collider) => collider.id), `${label} collider`, errors);
  uniqueIds(interior.props.map((prop) => prop.id), `${label} prop`, errors);
  uniqueIds(interior.hotspots.map((hotspot) => hotspot.id), `${label} hotspot`, errors);
  uniqueIds(interior.npcSpawns.map((spawn) => spawn.npcId), `${label} NPC`, errors);

  for (const collider of interior.collision) validateCollider(interior, collider, errors);
  for (let left = 0; left < interior.collision.length; left += 1) {
    for (let right = left + 1; right < interior.collision.length; right += 1) {
      if (collidersOverlap(interior.collision[left]!, interior.collision[right]!)) {
        errors.push(`${label} colliders:${interior.collision[left]!.id} and ${interior.collision[right]!.id} overlap`);
      }
    }
  }

  for (const prop of interior.props) validatePoint(interior, prop, `prop:${prop.id}`, errors);
  for (const hotspot of interior.hotspots) {
    validatePoint(interior, hotspot, `hotspot:${hotspot.id}`, errors);
    if (hotspot.kind !== 'service') continue;
    const npc = knownNpcs.get(hotspot.npcId);
    if (!npc) errors.push(`${label} hotspot:${hotspot.id} references unknown NPC:${hotspot.npcId}`);
    else if (npc.service !== hotspot.service) errors.push(`${label} hotspot:${hotspot.id} service does not match NPC:${npc.id}`);
    if (!interior.npcSpawns.some((spawn) => spawn.npcId === hotspot.npcId)) {
      errors.push(`${label} hotspot:${hotspot.id} has no spawn for NPC:${hotspot.npcId}`);
    }
  }

  for (const spawn of interior.npcSpawns) {
    validatePoint(interior, spawn, `NPC:${spawn.npcId}`, errors);
    if (!knownNpcs.has(spawn.npcId)) errors.push(`${label} references unknown NPC:${spawn.npcId}`);
    if (!Number.isFinite(spawn.interactionRadiusTiles) || spawn.interactionRadiusTiles <= 0) {
      errors.push(`${label} NPC:${spawn.npcId} has invalid interaction radius`);
    }
  }

  const exitHotspots = interior.hotspots.filter((hotspot) => hotspot.kind === 'exit');
  if (exitHotspots.length !== 1) errors.push(`${label} must declare exactly one exit hotspot`);
  const registeredExit = exitHotspots[0];
  if (registeredExit && (
    registeredExit.id !== interior.exit.id
      || registeredExit.tileX !== interior.exit.tileX
      || registeredExit.tileY !== interior.exit.tileY
  )) errors.push(`${label} exit hotspot does not match its canonical exit`);
  if (!interior.hotspots.some((hotspot) => hotspot.kind === 'service')) errors.push(`${label} must declare a service hotspot`);

  if (!validColor(interior.ambience.ambientColor) || !validColor(interior.ambience.keyLightColor)
    || !finiteNonNegative(interior.ambience.ambientIntensity) || !finiteNonNegative(interior.ambience.keyLightIntensity)
    || interior.ambience.soundscape.trim().length === 0) {
    errors.push(`${label} has invalid ambience configuration`);
  }

  if (positiveInteger(tilesWide) && positiveInteger(tilesHigh)) {
    const reachable = reachableInteriorTileKeys(interior);
    const required: Array<readonly [string, InteriorPoint]> = [
      ['exit', interior.exit],
      ...interior.hotspots.map((hotspot) => [`hotspot:${hotspot.id}`, hotspot] as const),
      ...interior.npcSpawns.map((spawn) => [`NPC:${spawn.npcId}`, spawn] as const),
    ];
    if (!isInteriorTileWalkable(interior, interior.playerSpawn.tileX, interior.playerSpawn.tileY)) {
      errors.push(`${label} player spawn is blocked`);
    }
    for (const [targetLabel, point] of required) {
      if (!isInteriorTileWalkable(interior, point.tileX, point.tileY)) errors.push(`${label} ${targetLabel} is blocked`);
      else if (!reachable.has(interiorTileKey(point))) errors.push(`${label} ${targetLabel} is unreachable from player spawn`);
    }
  }
  return errors;
}

function validatePoint(interior: InteriorDefinition, point: InteriorPoint, pointLabel: string, errors: string[]): void {
  if (!Number.isSafeInteger(point.tileX) || !Number.isSafeInteger(point.tileY)) {
    errors.push(`interior:${interior.id} ${pointLabel} must use integer tiles`);
    return;
  }
  if (point.tileX < 0 || point.tileY < 0
    || point.tileX >= interior.dimensions.tilesWide || point.tileY >= interior.dimensions.tilesHigh) {
    errors.push(`interior:${interior.id} ${pointLabel} is outside room bounds`);
  }
}

function validateCollider(interior: InteriorDefinition, collider: InteriorCollider, errors: string[]): void {
  validatePoint(interior, collider, `collider:${collider.id}`, errors);
  if (!positiveInteger(collider.tilesWide) || !positiveInteger(collider.tilesHigh)
    || collider.tileX + collider.tilesWide > interior.dimensions.tilesWide
    || collider.tileY + collider.tilesHigh > interior.dimensions.tilesHigh) {
    errors.push(`interior:${interior.id} collider:${collider.id} has invalid bounds`);
  }
}

function collidersOverlap(left: InteriorCollider, right: InteriorCollider): boolean {
  return left.tileX < right.tileX + right.tilesWide && right.tileX < left.tileX + left.tilesWide
    && left.tileY < right.tileY + right.tilesHigh && right.tileY < left.tileY + left.tilesHigh;
}

function uniqueIds(ids: readonly string[], label: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id.length === 0) errors.push(`${label} has an empty ID`);
    else if (seen.has(id)) errors.push(`${label}:${id} is duplicated`);
    seen.add(id);
  }
}

function positiveInteger(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function finiteNonNegative(value: number): boolean { return Number.isFinite(value) && value >= 0; }
function validColor(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff; }
