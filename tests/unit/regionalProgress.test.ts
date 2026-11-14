import { describe, expect, it } from 'vitest';
import { REGIONAL_IDENTITIES } from '../../src/content/regions';
import { TICKS_PER_SECOND } from '../../src/config/balance';
import { TILE_SIZE } from '../../src/config/platform';
import { enterWorldArea } from '../../src/simulation/areas';
import {
  discoverNearbyRegionalLandmark,
  recordRegionalGather,
  regionalContractView,
  regionalMasteryView,
} from '../../src/simulation/regionalProgress';
import { createInitialState, type WildCreatureState } from '../../src/simulation/state';
import { ELARIS_SANCTUARY_TILE, SURVIVAL_CYCLE_TICKS } from '../../src/simulation/survivalCycle';
import { travelViaWaystone, waystoneDestinations, waystoneOriginView } from '../../src/simulation/waystones';

/** The species with the most spawns in an area's roster. */
function dominantSpecies(creatures: readonly WildCreatureState[]): string {
  const counts = new Map<string, number>();
  for (const creature of creatures) {
    counts.set(creature.speciesId, (counts.get(creature.speciesId) ?? 0) + 1);
  }
  return [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

describe('regional exploration and repeatable work', () => {
  it('awards each authored landmark once when the player reaches it', () => {
    const state = createInitialState(71);
    expect(enterWorldArea(state, 1, 0)).toBe(true);
    const region = REGIONAL_IDENTITIES.find((definition) => definition.areaKey === '1,0')!;
    const coinsBefore = state.coins;

    state.player.x = (region.landmark.tileX + 0.5) * TILE_SIZE;
    state.player.y = (region.landmark.tileY + 0.5) * TILE_SIZE;

    expect(discoverNearbyRegionalLandmark(state)?.message).toContain('Sunwheel Orchard');
    expect(state.coins).toBe(coinsBefore + region.discoveryReward.coins);
    expect(discoverNearbyRegionalLandmark(state)).toBeNull();
  });

  it('pays a regional gathering contract once per survival cycle and then resets it', () => {
    const state = createInitialState(72);
    enterWorldArea(state, 1, 0);
    const definition = REGIONAL_IDENTITIES.find((entry) => entry.areaKey === '1,0')!;

    expect(recordRegionalGather(state, 'wood', 99)).toBeNull();
    expect(recordRegionalGather(state, 'fiber', 5)?.completed).toBe(false);
    expect(regionalContractView(state, '1,0')).toMatchObject({ progress: 5, completed: false });

    const coinsBefore = state.coins;
    const completed = recordRegionalGather(state, 'fiber', definition.contract.target);
    expect(completed).toMatchObject({ completed: true });
    expect(state.coins).toBe(coinsBefore + definition.contract.rewardCoins);
    expect(recordRegionalGather(state, 'fiber', definition.contract.target)).toBeNull();

    state.tick = SURVIVAL_CYCLE_TICKS;
    expect(regionalContractView(state, '1,0')).toMatchObject({ progress: 0, completed: false, cycleIndex: 1 });
    expect(recordRegionalGather(state, 'fiber', definition.contract.target)?.completed).toBe(true);
    expect(state.coins).toBe(coinsBefore + definition.contract.rewardCoins * 2);
  });

  it('generates a distinct resource and creature identity around clear landmarks', () => {
    const verdant = createInitialState(81);
    const sylvaren = createInitialState(81);
    enterWorldArea(verdant, 1, 0);
    enterWorldArea(sylvaren, 2, 0);

    const verdantPlants = verdant.resourceNodes.filter((node) => node.kind === 'plant').length;
    const verdantTrees = verdant.resourceNodes.filter((node) => node.kind === 'tree').length;
    const sylvarenTrees = sylvaren.resourceNodes.filter((node) => node.kind === 'tree').length;
    const sylvarenPlants = sylvaren.resourceNodes.filter((node) => node.kind === 'plant').length;
    expect(verdantPlants).toBeGreaterThan(100);
    expect(verdantPlants).toBeGreaterThan(verdantTrees);
    // The characteristic species dominates the region's roster, whatever the
    // population quota is set to.
    expect(dominantSpecies(verdant.wildCreatures)).toBe('tuftle');
    expect(sylvarenTrees).toBeGreaterThan(100);
    expect(sylvarenTrees).toBeGreaterThan(sylvarenPlants);
    expect(dominantSpecies(sylvaren.wildCreatures)).toBe('glade-stag');

    for (const state of [verdant, sylvaren]) {
      const landmark = REGIONAL_IDENTITIES.find((definition) => definition.areaKey === state.currentArea.key)!.landmark;
      expect(state.resourceNodes.every((node) => Math.hypot(
        node.x / TILE_SIZE - (landmark.tileX + 0.5),
        node.y / TILE_SIZE - (landmark.tileY + 0.5),
      ) > 4)).toBe(true);
    }
  });

  it('advances mastery through discovery and contracts completed in three cycles', () => {
    const state = createInitialState(91);
    enterWorldArea(state, 2, 0);
    const definition = REGIONAL_IDENTITIES.find((entry) => entry.areaKey === '2,0')!;

    expect(regionalMasteryView(state, '2,0')).toMatchObject({ tier: 'Unknown', contractCompletions: 0 });
    state.player.x = (definition.landmark.tileX + 0.5) * TILE_SIZE;
    state.player.y = (definition.landmark.tileY + 0.5) * TILE_SIZE;
    discoverNearbyRegionalLandmark(state);
    expect(regionalMasteryView(state, '2,0')).toMatchObject({ tier: 'Surveyed', contractCompletions: 0 });

    recordRegionalGather(state, 'wood', definition.contract.target);
    expect(regionalMasteryView(state, '2,0')).toMatchObject({ tier: 'Familiar', contractCompletions: 1 });
    for (let cycle = 1; cycle <= 2; cycle += 1) {
      state.tick = SURVIVAL_CYCLE_TICKS * cycle;
      recordRegionalGather(state, 'wood', definition.contract.target);
    }
    expect(regionalMasteryView(state, '2,0')).toMatchObject({
      tier: 'Mastered',
      contractCompletions: 3,
      nextTier: null,
    });
  });

  it('opens mastered waystone routes only at an anchor and only during safe phases', () => {
    const state = createInitialState(92);
    const verdant = REGIONAL_IDENTITIES.find((entry) => entry.areaKey === '1,0')!;
    state.regionalProgress.discoveredLandmarkIds.push(verdant.landmark.id);
    state.regionalProgress.contractCompletionCounts[verdant.contract.id] = 3;

    expect(waystoneDestinations(state)).toEqual([]);
    state.player.x = (ELARIS_SANCTUARY_TILE.x + 0.5) * TILE_SIZE;
    state.player.y = (ELARIS_SANCTUARY_TILE.y + 0.5) * TILE_SIZE;
    expect(waystoneOriginView(state).active).toBe(true);
    expect(waystoneDestinations(state)).toContainEqual({ areaKey: '1,0', name: 'Verdant Reach' });

    expect(travelViaWaystone(state, '1,0')).toEqual({
      ok: true,
      message: 'The waystone carries you to Verdant Reach.',
    });
    expect(state.currentArea.key).toBe('1,0');
    expect(waystoneDestinations(state)).toContainEqual({ areaKey: '0,0', name: 'Elaris' });

    state.tick = state.gameBalance.raid.safePhaseSeconds * TICKS_PER_SECOND;
    expect(waystoneOriginView(state)).toMatchObject({ active: false });
    expect(travelViaWaystone(state, '0,0').ok).toBe(false);
  });
});
