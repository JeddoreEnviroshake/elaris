import { TILE_SIZE, WORLD_PX } from '../config/platform';
import { creatureDefinition } from '../content/creatures';
import { isTownFootprintWorldPosition } from '../content/townBuildings';
import { solidBoundaryBetween } from '../simulation/buildingCollision';
import { isCreatureAway } from '../simulation/expeditions';
import { terrainAtWithBuildings, terrainCapabilities } from '../simulation/landscape';
import type { GameState } from '../simulation/state';

export interface GatherAssistancePresentation {
  creatureId: string;
  x: number;
  y: number;
  progress: number;
}

/** Cosmetic formation only. Bonuses use the authoritative player's reach, never these poses. */
export function followerCreaturePlacements(state: GameState) {
  if (state.pendingRespawn || state.player.traversalMode === 'boat') return [];
  const direction = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[state.player.facing]!;
  const dx = direction[0]!;
  const dy = direction[1]!;
  const occupied = new Set<string>();
  return state.ownedCreatures.filter((creature) => creature.role === 'follow'
    && creatureDefinition(creature.speciesId).followMode !== 'mount' && !isCreatureAway(state, creature.id))
    .map((creature, index) => {
      const side = index % 2 === 0 ? 1 : -1;
      const candidates = [
        [-dx + dy * side, -dy - dx * side], [-dx, -dy], [dy * side, -dx * side],
        [-dy * side, dx * side], [dx, dy], [0, 0],
      ];
      const position = candidates.map(([x, y]) => ({ x: state.player.x + x! * TILE_SIZE, y: state.player.y + y! * TILE_SIZE }))
        .find(({ x, y }) => x >= 0 && y >= 0 && x < WORLD_PX && y < WORLD_PX
          && !occupied.has(`${x},${y}`) && !isTownFootprintWorldPosition(x, y, state.currentArea.key)
          && terrainCapabilities(terrainAtWithBuildings(state.seed, state.currentArea, state.buildings, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))).walkable
          && !solidBoundaryBetween(state.buildings, state.player.x, state.player.y, x, y))
        ?? { x: state.player.x, y: state.player.y };
      occupied.add(`${position.x},${position.y}`);
      return { id: creature.id, speciesId: creature.speciesId, ...position };
    });
}

export function followerAssistanceLift(id: string, assistance: GatherAssistancePresentation | null | undefined, reducedMotion: boolean): number {
  if (reducedMotion || assistance?.creatureId !== id) return 0;
  return Math.sin(Math.PI * Math.max(0, Math.min(1, assistance.progress))) * 0.3;
}
