import { TILE_SIZE, WORLD_PX } from '../config/platform';
import { creatureDefinition } from '../content/creatures';
import { isTownFootprintWorldPosition } from '../content/townBuildings';
import { solidBoundaryBetween } from '../simulation/buildingCollision';
import { isCreatureAway } from '../simulation/expeditions';
import { terrainAtWithBuildings, terrainCapabilities } from '../simulation/landscape';
import type { GameState, SpeciesId } from '../simulation/state';

export interface GatherAssistancePresentation {
  creatureId: string;
  x: number;
  y: number;
  progress: number;
}

/**
 * Cosmetic formation only. Bonuses use the authoritative player's reach, never these poses.
 *
 * `travel` is the unit direction the player is walking (free movement walks at
 * any angle); the formation trails behind it. Without one it falls back to the
 * four-way saved facing.
 */
export function followerCreaturePlacements(
  state: GameState,
  travel?: { x: number; y: number },
  firstPerson = false,
  origin: { x: number; y: number } = state.player,
) {
  if (state.pendingRespawn || state.player.traversalMode === 'boat') return [];
  // The renderer passes the interpolated pose the player rig is drawn at; the
  // fixed-step sim position advances in ticks and would make the party stutter.
  const player = { x: origin.x, y: origin.y };
  const direction = travel && Number.isFinite(travel.x) && Number.isFinite(travel.y) && Math.hypot(travel.x, travel.y) > 0.5
    ? [travel.x, travel.y]
    : { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[state.player.facing]!;
  const length = Math.hypot(direction[0]!, direction[1]!);
  const dx = direction[0]! / length;
  const dy = direction[1]! / length;
  const occupied: Array<{ x: number; y: number; radius: number }> = [];
  return state.ownedCreatures.filter((creature) => creature.role === 'follow'
    && creatureDefinition(creature.speciesId).followMode !== 'mount' && !isCreatureAway(state, creature.id))
    .flatMap((creature, index) => {
      const side = index % 2 === 0 ? 1 : -1;
      const radius = followerRadiusTiles(creature.speciesId);
      const trailing = firstPerson ? 2.4 + radius + Math.floor(index / 2) * 1.3 : 1;
      const lateral = firstPerson ? .9 + radius : 1;
      const candidates: Array<{ x: number; y: number }> = [];
      // Narrow gaps use the centre slots; blocked slots search farther behind.
      for (const row of [0, 1.4, 2.8]) for (const offset of [lateral * side, 0, -lateral * side]) {
        candidates.push({
          x: player.x + (-dx * (trailing + row) + dy * offset) * TILE_SIZE,
          y: player.y + (-dy * (trailing + row) - dx * offset) * TILE_SIZE,
        });
      }
      if (!firstPerson) for (const sideOffset of [1, -1]) candidates.push({
        x: player.x + dy * sideOffset * TILE_SIZE * 1.5,
        y: player.y - dx * sideOffset * TILE_SIZE * 1.5,
      });
      const clear = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < WORLD_PX && y < WORLD_PX
        && !isTownFootprintWorldPosition(x, y, state.currentArea.key)
        && terrainCapabilities(terrainAtWithBuildings(state.seed, state.currentArea, state.buildings, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))).walkable;
      const position = candidates.find(({ x, y }) => {
        if (occupied.some(other => Math.hypot(x - other.x, y - other.y) < (radius + other.radius + .25) * TILE_SIZE)) return false;
        if (solidBoundaryBetween(state.buildings, player.x, player.y, x, y)) return false;
        const steps = Math.ceil(Math.hypot(x - player.x, y - player.y) / (TILE_SIZE * .4));
        for (let step = 1; step <= steps; step++) {
          if (!clear(player.x + (x - player.x) * step / steps, player.y + (y - player.y) * step / steps)) return false;
        }
        // Validate the body footprint as well as its centre at the chosen slot.
        return [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]
          .every(([ox, oy]) => clear(x + ox! * TILE_SIZE, y + oy! * TILE_SIZE));
      });
      // No safe slot: omit this cosmetic rig until there is space, never put it inside the player.
      if (!position) return [];
      occupied.push({ ...position, radius });
      return { id: creature.id, speciesId: creature.speciesId, ...position };
    });
}

/** Body/wing clearance, independent of gameplay reach and assistance bonuses. */
export function followerRadiusTiles(speciesId: SpeciesId): number {
  switch (speciesId) {
    case 'mistmoth': return 1.1;
    case 'slingtail': return .85;
    case 'snarlfox': return .75;
    case 'bulwark-boar': case 'glade-stag': return .9;
    case 'quillfinch': return .45;
    default: return .6;
  }
}

export function followerAssistanceLift(id: string, assistance: GatherAssistancePresentation | null | undefined, reducedMotion: boolean): number {
  if (reducedMotion || assistance?.creatureId !== id) return 0;
  return Math.sin(Math.PI * Math.max(0, Math.min(1, assistance.progress))) * 0.3;
}

/** Beyond this gap (in world units, one per tile) a follower is re-placed, not walked: a door, respawn or area change. */
export const FOLLOWER_SNAP_DISTANCE = 12;
const FOLLOWER_CHASE_RATE = 7;

/**
 * Eases a follower's drawn position toward its formation slot. The slot jumps
 * whenever the formation turns or a blocked slot falls through to the next
 * candidate, so drawing the slot directly teleports the rig; chasing it makes
 * those changes read as the creature trotting to its new spot.
 */
export function easeFollowerToward(
  current: { x: number; z: number },
  target: { x: number; z: number },
  deltaSeconds: number,
): { x: number; z: number } {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) > FOLLOWER_SNAP_DISTANCE) return { ...target };
  const blend = 1 - Math.exp(-Math.max(0, deltaSeconds) * FOLLOWER_CHASE_RATE);
  return { x: current.x + dx * blend, z: current.z + dz * blend };
}
