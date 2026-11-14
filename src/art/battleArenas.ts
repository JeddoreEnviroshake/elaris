import type { CreatureDefinition } from '../content/creatures';

export const BATTLE_ARENA_PATHS = {
  grassland: '/assets/battle/grassland-arena.png',
  hills: '/assets/battle/hills-arena.png',
  forest: '/assets/battle/forest-arena.png',
} as const;

export function battleArenaPath(habitat: CreatureDefinition['habitat']): string {
  return BATTLE_ARENA_PATHS[habitat];
}
