import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type WorldContainerState } from '../../src/simulation/state';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { generateAreaContainers, CONTAINERS_PER_AREA } from '../../src/simulation/worldGeneration';
import {
  EXHAUSTED_BLUEPRINT_COINS,
  containerContents,
  nearestUnopenedContainer,
  openNearestContainer,
} from '../../src/simulation/worldContainers';
import { BLUEPRINT_ITEM_IDS } from '../../src/simulation/blueprintKnowledge';

const ELARIS = { x: 0, y: 0, theme: 'elaris' as const };

function stateWithContainer(kind: WorldContainerState['kind'], overrides: Partial<GameState> = {}): GameState {
  const state = createInitialState(1234);
  state.containers = [{ id: 'container-test', kind, x: state.player.x + 4, y: state.player.y, opened: false }];
  return Object.assign(state, overrides);
}

describe('world container generation', () => {
  it('is seed-stable: the same seed always produces the same containers', () => {
    const first = generateAreaContainers(99, 'area', true, ELARIS, 99, '0,0');
    const second = generateAreaContainers(99, 'area', true, ELARIS, 99, '0,0');
    expect(first).toEqual(second);
    expect(first.length).toBe(CONTAINERS_PER_AREA);
  });

  it('produces different layouts for different seeds', () => {
    const a = generateAreaContainers(1, 'a', true, ELARIS, 1, '0,0');
    const b = generateAreaContainers(2, 'b', true, ELARIS, 2, '0,0');
    expect(a.map((c) => `${c.x},${c.y}`)).not.toEqual(b.map((c) => `${c.x},${c.y}`));
  });

  it('places containers on whole pixels so the state hash stays valid', () => {
    const state = createInitialState(7);
    for (const container of state.containers) {
      expect(Number.isSafeInteger(container.x)).toBe(true);
      expect(Number.isSafeInteger(container.y)).toBe(true);
    }
    expect(() => canonicalizeGameState(state)).not.toThrow();
  });

  it('prefixes ids per area so two regions never collide', () => {
    const containers = generateAreaContainers(5, '3,4', true, ELARIS, 5, '3,4');
    for (const container of containers) expect(container.id.startsWith('3,4-container-')).toBe(true);
  });
});

describe('container contents', () => {
  it('is a pure function of the container id and area seed', () => {
    const container: WorldContainerState = { id: 'c1', kind: 'supply-cache', x: 300, y: 420, opened: false };
    expect(containerContents(container, 88)).toEqual(containerContents(container, 88));
  });

  it('only collapsed cellars carry blueprints', () => {
    const at = (kind: WorldContainerState['kind']) =>
      containerContents({ id: 'c', kind, x: 200, y: 200, opened: false }, 3);
    expect(at('hollow-log').blueprintItemId).toBeNull();
    expect(at('supply-cache').blueprintItemId).toBeNull();
    expect(at('collapsed-cellar').blueprintItemId).not.toBeNull();
  });

  it('never proposes a blueprint the player already owns', () => {
    const owned = [...BLUEPRINT_ITEM_IDS];
    const contents = containerContents(
      { id: 'c', kind: 'collapsed-cellar', x: 200, y: 200, opened: false }, 3, owned,
    );
    expect(contents.blueprintItemId).toBeNull();
  });

  /**
   * Regression: coordinateHash's final XOR is signed and can return a negative
   * value, which silently pushed amounts below their configured minimum and
   * made pickBlueprint index out of bounds.
   */
  it('grants amounts inside each entry’s configured range', () => {
    const ranges: Record<string, [number, number]> = {
      fiber: [4, 9], berry: [2, 5], arrow: [4, 10], 'cloth-mask': [1, 2],
      'iron-ore': [2, 5], 'iron-ingot': [2, 4], 'taming-snare': [1, 3],
    };
    for (let seed = 0; seed < 200; seed += 1) {
      for (const kind of ['hollow-log', 'supply-cache', 'collapsed-cellar'] as const) {
        const contents = containerContents(
          { id: `c${seed}`, kind, x: 100 + seed, y: 700 - seed, opened: false }, seed,
        );
        for (const [resource, amount] of contents.resources) {
          const [min, max] = ranges[resource]!;
          expect(Number.isSafeInteger(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(min);
          expect(amount).toBeLessThanOrEqual(max);
        }
        expect(Number.isSafeInteger(contents.coins)).toBe(true);
        expect(contents.coins).toBeGreaterThanOrEqual(0);
        if (kind === 'collapsed-cellar') expect(typeof contents.blueprintItemId).toBe('string');
      }
    }
  });
});

describe('opening containers', () => {
  it('requires the player to be in range', () => {
    const state = stateWithContainer('hollow-log');
    state.containers[0]!.x = state.player.x + 5_000;
    expect(nearestUnopenedContainer(state)).toBeNull();
    expect(openNearestContainer(state).ok).toBe(false);
  });

  it('grants its contents and marks the container opened', () => {
    const state = stateWithContainer('hollow-log');
    const before = state.inventory.fiber + state.inventory.berry;
    const result = openNearestContainer(state);
    expect(result.ok).toBe(true);
    expect(state.containers[0]!.opened).toBe(true);
    expect(state.inventory.fiber + state.inventory.berry).toBeGreaterThan(before);
  });

  it('is one-shot: a second open finds nothing', () => {
    const state = stateWithContainer('supply-cache');
    expect(openNearestContainer(state).ok).toBe(true);
    const coinsAfterFirst = state.coins;
    const second = openNearestContainer(state);
    expect(second.ok).toBe(false);
    expect(state.coins).toBe(coinsAfterFirst);
  });

  it('pays coins from a supply cache', () => {
    const state = stateWithContainer('supply-cache');
    openNearestContainer(state);
    expect(state.coins).toBeGreaterThan(0);
  });

  it('unlocks a blueprint from a collapsed cellar', () => {
    const state = stateWithContainer('collapsed-cellar');
    state.unlockedItemIds = [];
    openNearestContainer(state);
    expect(state.unlockedItemIds.length).toBe(1);
    expect(BLUEPRINT_ITEM_IDS).toContain(state.unlockedItemIds[0]!);
  });

  it('never hands over a blueprint the player already knows', () => {
    const state = stateWithContainer('collapsed-cellar');
    const first = containerContents(state.containers[0]!, state.currentArea.seed, state.unlockedItemIds);
    const second = containerContents(
      state.containers[0]!, state.currentArea.seed, [first.blueprintItemId!],
    );
    expect(second.blueprintItemId).not.toBe(first.blueprintItemId);
  });

  it('pays coins once every blueprint is already known', () => {
    const state = stateWithContainer('collapsed-cellar');
    state.unlockedItemIds = [...BLUEPRINT_ITEM_IDS];
    const ownedBefore = state.unlockedItemIds.length;
    // The cellar's own purse is paid too; the bonus is what it hands over
    // instead of a blueprint it can no longer supply.
    const cellarCoins = containerContents(
      nearestUnopenedContainer(state)!, state.currentArea.seed, state.unlockedItemIds,
    ).coins;
    const coinsBefore = state.coins;
    openNearestContainer(state);
    expect(state.coins).toBe(coinsBefore + cellarCoins + EXHAUSTED_BLUEPRINT_COINS);
    expect(state.unlockedItemIds.length).toBe(ownedBefore);
  });

  it('spills to the ground rather than losing loot when the bag is full', () => {
    const state = stateWithContainer('hollow-log');
    // Fill every Bag slot with distinct stacks so tryAddResource must refuse.
    state.inventory.wood = 99 * 40;
    state.inventoryStacks.wood = Array.from({ length: 40 }, () => 99);
    expect(openNearestContainer(state).ok).toBe(true);
    expect(state.groundDrops.length).toBeGreaterThan(0);
  });

  it('does not perturb the shared RNG stream', () => {
    const state = stateWithContainer('collapsed-cellar');
    const rngBefore = state.rngState;
    openNearestContainer(state);
    expect(state.rngState).toBe(rngBefore);
  });
});
