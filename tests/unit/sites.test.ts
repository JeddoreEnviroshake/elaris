import { describe, expect, it } from 'vitest';
import { RESOURCE_STACK_SIZE, INVENTORY_SLOTS, BAG_ITEM_IDS } from '../../src/config/balance';
import { TILE_SIZE } from '../../src/config/platform';
import { SITE_KINDS } from '../../src/content/sites';
import { isWithinTownPrecinct } from '../../src/content/townBuildings';
import { isRegionalLandmarkTileClear } from '../../src/content/regions';
import { describeArea, enterWorldArea } from '../../src/simulation/areas';
import { createGridMovementState, stepMovement } from '../../src/simulation/commands';
import { hashGameState } from '../../src/simulation/determinism';
import { isTerrainSpawnable } from '../../src/simulation/landscape';
import { damageRaider } from '../../src/simulation/raids';
import { advanceRoamers } from '../../src/simulation/raids';
import {
  SITE_HALF_TILES, advanceSiteSearch, areaSites, beginSiteSearch, currentSiteProgress, discoverNearbySites,
  liveAreaSites, siteContainerLoot, siteRestockIndex, type SiteDefinition,
} from '../../src/simulation/sites';
import { sellResource } from '../../src/simulation/economy';
import { validatePlacement } from '../../src/simulation/gameplayCommands';
import { buildableById } from '../../src/content/buildingParts';
import { reconcileAllResourceStacks } from '../../src/simulation/inventoryStacks';
import { createInitialState, type GameState } from '../../src/simulation/state';

/** A fresh world standing at the first live site found walking out from Elaris. */
function atSite(seed = 2024): { state: GameState; site: SiteDefinition } {
  const state = createInitialState(seed);
  for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]] as const) {
    enterWorldArea(state, x, y);
    const site = liveAreaSites(state)[0];
    if (site) {
      // Nothing else in the area may hit the player or wander into the test.
      state.raiders = [];
      state.wildCreatures = [];
      state.player.x = site.containers[0]!.x;
      state.player.y = site.containers[0]!.y;
      return { state, site };
    }
  }
  throw new Error(`no site near Elaris for seed ${seed}`);
}

function runSearch(state: GameState): ReturnType<typeof advanceSiteSearch> {
  for (let guard = 0; guard < 1_000; guard += 1) {
    state.tick += 1;
    const result = advanceSiteSearch(state);
    if (result) return result;
  }
  throw new Error('search never finished');
}

describe('field site generation', () => {
  it('is stable for a seed and an area', () => {
    const area = describeArea(77, 2, -1);
    const first = JSON.stringify(areaSites(77, area, 6));
    const again = JSON.stringify(areaSites(77, { ...area }, 6));
    expect(again).toBe(first);
    // A different seed scatters differently.
    expect(JSON.stringify(areaSites(78, describeArea(78, 2, -1), 6))).not.toBe(first);
  });

  it('never places a site in Elaris, in a town, in water or on a landmark', () => {
    expect(areaSites(5, describeArea(5, 0, 0), 6)).toEqual([]);
    let total = 0;
    for (let ax = -3; ax <= 3; ax += 1) {
      for (let ay = -3; ay <= 3; ay += 1) {
        const area = describeArea(5, ax, ay);
        for (const site of areaSites(5, area, 6)) {
          total += 1;
          expect(SITE_KINDS[site.kind].themes).toContain(area.theme);
          for (const [dx, dy] of [[0, 0], [-SITE_HALF_TILES, -SITE_HALF_TILES], [SITE_HALF_TILES, SITE_HALF_TILES]] as const) {
            const px = (site.anchorTileX + dx) * TILE_SIZE + TILE_SIZE / 2;
            const py = (site.anchorTileY + dy) * TILE_SIZE + TILE_SIZE / 2;
            expect(isWithinTownPrecinct(px, py, area.key)).toBe(false);
            expect(isTerrainSpawnable(5, area, px, py)).toBe(true);
            expect(isRegionalLandmarkTileClear(area.key, site.anchorTileX + dx, site.anchorTileY + dy)).toBe(false);
          }
          expect(site.containers.length).toBe(SITE_KINDS[site.kind].containerCount);
          expect(site.containers.at(-1)!.strongbox).toBe(true);
          expect(site.containers.every((c) => Number.isInteger(c.x) && Number.isInteger(c.y))).toBe(true);
        }
      }
    }
    expect(total).toBeGreaterThan(20);
  });

  it('adds or hides the highest-numbered sites when the count changes, never moving one', () => {
    const area = describeArea(9, -2, 1);
    const six = areaSites(9, area, 6);
    expect(areaSites(9, area, 2)).toEqual(six.slice(0, 2));
  });

  it('suppresses a site a building already stands on, and refuses new building inside one', () => {
    const { state, site } = atSite();
    const wall = buildableById('thatch-wall');
    expect(validatePlacement(state, state.buildings, wall, site.anchorTileX, site.anchorTileY).message).toBe('Ruins are in the way');
    state.buildings.push({ id: 'legacy-hut', definitionId: 'thatch-wall', tileX: site.anchorTileX, tileY: site.anchorTileY, rotated: false } as never);
    expect(liveAreaSites(state).some((candidate) => candidate.id === site.id)).toBe(false);
  });
});

describe('site loot', () => {
  it('is identical for identical inputs and turns over with the restock index', () => {
    const { state, site } = atSite();
    const strongbox = site.containers.length - 1;
    const a = siteContainerLoot(state.seed, site.id, strongbox, 4, 3, false);
    const b = siteContainerLoot(state.seed, site.id, strongbox, 4, 3, false);
    expect(b).toEqual(a);
    const across = new Set(Array.from({ length: 8 }, (_, restock) => JSON.stringify(siteContainerLoot(state.seed, site.id, 0, restock, 3, false))));
    expect(across.size).toBeGreaterThan(1);
    for (const [, amount] of a.resources) expect(Number.isInteger(amount) && amount > 0).toBe(true);
    expect(a.coins).toBeGreaterThan(0);
  });

  it('always holds salvage, and more uncommon loot in a danger phase', () => {
    const { state, site } = atSite();
    const salvage = new Set(['scrap-iron', 'clockwork', 'lens', 'arcane-dust', 'construct-core', 'ancient-alloy']);
    let calm = 0;
    let danger = 0;
    for (let restock = 0; restock < 12; restock += 1) {
      for (const container of site.containers) {
        const quiet = siteContainerLoot(state.seed, site.id, container.index, restock, 1, false);
        const loud = siteContainerLoot(state.seed, site.id, container.index, restock, 1, true);
        calm += quiet.resources.reduce((sum, [, n]) => sum + n, 0);
        danger += loud.resources.reduce((sum, [, n]) => sum + n, 0);
        if (container.strongbox) expect(quiet.resources.some(([resource]) => salvage.has(resource))).toBe(true);
      }
    }
    expect(danger).toBeGreaterThan(calm);
  });
});

describe('searching a site', () => {
  it('grants loot, marks the container searched and refuses a second search', () => {
    const { state, site } = atSite();
    const before = BAG_ITEM_IDS.reduce((sum, id) => sum + state.inventory[id], 0);
    expect(beginSiteSearch(state, site.id, 0).ok).toBe(true);
    expect(state.activeSearch).not.toBeNull();
    const result = runSearch(state);
    expect(result?.kind).toBe('completed');
    expect(BAG_ITEM_IDS.reduce((sum, id) => sum + state.inventory[id], 0)).toBeGreaterThan(before);
    expect(currentSiteProgress(state, site.id).searched).toEqual([0]);
    expect(beginSiteSearch(state, site.id, 0).message).toMatch(/Already searched/);
  });

  it('cancels when the player moves', () => {
    const { state, site } = atSite();
    beginSiteSearch(state, site.id, 0);
    state.tick += 10;
    state.player.x += 5;
    expect(advanceSiteSearch(state)?.kind).toBe('interrupted');
    expect(state.activeSearch).toBeNull();
    expect(currentSiteProgress(state, site.id).searched).toEqual([]);
  });

  it('cancels when the player is hurt', () => {
    const { state, site } = atSite();
    beginSiteSearch(state, site.id, 0);
    state.tick += 10;
    state.player.hp -= 1;
    expect(advanceSiteSearch(state)?.kind).toBe('interrupted');
  });

  it('runs and cancels through the fixed step', () => {
    const { state, site } = atSite();
    beginSiteSearch(state, site.id, 0);
    const movement = createGridMovementState();
    const results: string[] = [];
    for (let tick = 0; tick < 20; tick += 1) {
      stepMovement(state, { x: 1, y: 0, slow: false, continuous: true }, 1000 / 60, movement, undefined, undefined, undefined, (r) => results.push(r.kind));
    }
    expect(results).toContain('interrupted');
    expect(state.activeSearch).toBeNull();
  });

  it('spills what the bag cannot hold onto the ground at the container', () => {
    const { state, site } = atSite();
    state.inventory.wood = RESOURCE_STACK_SIZE * INVENTORY_SLOTS;
    reconcileAllResourceStacks(state);
    const dropsBefore = state.groundDrops.length;
    state.player.x = site.containers.at(-1)!.x;
    state.player.y = site.containers.at(-1)!.y;
    expect(beginSiteSearch(state, site.id, site.containers.length - 1).ok).toBe(true);
    const result = runSearch(state);
    expect(result?.kind).toBe('completed');
    if (result?.kind !== 'completed') return;
    expect(result.spilled.length).toBeGreaterThan(0);
    expect(state.groundDrops.length).toBe(dropsBefore + result.spilled.length);
    const strongbox = site.containers.at(-1)!;
    expect(state.groundDrops.slice(dropsBefore).every((drop) => drop.x === strongbox.x && drop.y === strongbox.y)).toBe(true);
  });

  it('refills on the next restock', () => {
    const { state, site } = atSite();
    beginSiteSearch(state, site.id, 0);
    runSearch(state);
    const restock = siteRestockIndex(state);
    while (siteRestockIndex(state) === restock) state.tick += 600;
    expect(siteRestockIndex(state)).toBe(restock + 1);
    expect(currentSiteProgress(state, site.id).searched).toEqual([]);
    expect(beginSiteSearch(state, site.id, 0).ok).toBe(true);
  });

  it('records a site as discovered once the player comes within range', () => {
    const { state, site } = atSite();
    state.siteProgress = {};
    state.player.x = site.x + 30 * TILE_SIZE;
    expect(discoverNearbySites(state)).toBe(false);
    state.player.x = site.x + 10 * TILE_SIZE;
    state.player.y = site.y;
    expect(discoverNearbySites(state)).toBe(true);
    expect(state.siteProgress[site.id]).toBeDefined();
  });

  it('hashes deterministically mid-search', async () => {
    const { state, site } = atSite();
    beginSiteSearch(state, site.id, 0);
    state.tick += 30;
    advanceSiteSearch(state);
    const copy = structuredClone(state);
    await expect(hashGameState(copy)).resolves.toBe(await hashGameState(state));
  });
});

describe('site guards', () => {
  function guardsAt(state: GameState, site: SiteDefinition) {
    return state.raiders.filter((raider) => raider.siteId === site.id);
  }
  /** Stand far away and tick the roamer step until a post check runs. */
  function postCheck(state: GameState): void {
    state.player.x = 8;
    state.player.y = 8;
    state.tick = (Math.floor(state.tick / 60) + 1) * 60;
    advanceRoamers(state);
  }

  it('stand at their posts, outside the roamer quota, and return only on restock', () => {
    const { state, site } = atSite();
    postCheck(state);
    const guards = guardsAt(state, site);
    expect(guards.length).toBe(state.gameBalance.outlands.guardsPerSite);
    expect(guards.every((guard) => guard.roaming && site.guardPosts.some((post) => post.x === guard.homeX && post.y === guard.homeY))).toBe(true);

    damageRaider(state, guards[0]!, 1_000_000);
    expect(currentSiteProgress(state, site.id).guardsDefeated).toBe(1);
    // Leaving and coming back wipes live raiders; the fallen one stays fallen.
    state.raiders = [];
    postCheck(state);
    expect(guardsAt(state, site).length).toBe(state.gameBalance.outlands.guardsPerSite - 1);

    const restock = siteRestockIndex(state);
    while (siteRestockIndex(state) === restock) state.tick += 600;
    state.raiders = [];
    // Danger phases pause roamers during raids; step to the next safe post check.
    for (let tries = 0; tries < 200 && guardsAt(state, site).length < state.gameBalance.outlands.guardsPerSite; tries += 1) postCheck(state);
    expect(guardsAt(state, site).length).toBe(state.gameBalance.outlands.guardsPerSite);
  });
});

describe('salvage in the economy', () => {
  it('refuses to sell zero-priced items rather than destroying them', () => {
    const state = createInitialState(3);
    state.inventory['vault-key'] = 1;
    const coins = state.coins;
    expect(sellResource(state, 'vault-key', 1).ok).toBe(false);
    expect(state.inventory['vault-key']).toBe(1);
    expect(state.coins).toBe(coins);
    state.inventory['scrap-iron'] = 5;
    expect(sellResource(state, 'scrap-iron', 5).ok).toBe(true);
    expect(state.coins).toBe(coins + 20);
  });
});

describe("Bram's rumour", () => {
  it('points at a field site next door when nothing is left unopened in town', async () => {
    const { buyRumour } = await import('../../src/simulation/npcStock');
    const state = createInitialState(2024);
    state.containers.forEach((container) => { container.opened = true; });
    state.coins = 1_000;
    const result = buyRumour(state);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/(Homestead|Workshop|Shrine).*still sealed/);
  });
});

describe('the field-site e2e fixture', () => {
  it('passes save validation after a trip out of town and a search', async () => {
    const { migrateToCurrent } = await import('../../src/persistence/migrations');
    const { SAVE_VERSION } = await import('../../src/persistence/types');
    const { createOpeningChapter } = await import('../../src/content/onboarding');
    const { state, site } = atSite(2024);
    state.onboarding = createOpeningChapter(2024, true);
    beginSiteSearch(state, site.id, 0);
    state.tick += 10;
    advanceSiteSearch(state);
    const save = { meta: { saveVersion: SAVE_VERSION, contentVersion: 68, worldGenVersion: 13, appVersion: 'test', savedAt: 1 }, state: structuredClone(state) };
    expect(() => migrateToCurrent(save)).not.toThrow();
  });
});
