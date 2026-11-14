import { createOrdinaryState as createInitialState } from './helpers/ordinaryWorld';
import { describe, expect, it } from 'vitest';
import { AREA_THEME_IDS, RESOURCE_NODE_KINDS, TICKS_PER_SECOND } from '../../src/config/balance';
import { blueprintQuality } from '../../src/content/blueprintQuality';
import {
  BLUEPRINT_DROPPING_SPECIES,
  CAVE_RESERVED_BLUEPRINT_IDS,
  RAIDER_BLUEPRINT_POOL,
  THEME_BLUEPRINT_POOLS,
  creatureBlueprintPool,
  sourceBlueprintPool,
} from '../../src/content/blueprintPools';
import { coordinateHash } from '../../src/simulation/biomes';
import {
  advanceBlueprintProgress,
  creatureProgressKey,
  foldedRoll,
  nodeProgressKey,
  nodeRareShareBps,
  resolveBlueprintFind,
  rollCreatureBlueprint,
  rollNodeBlueprint,
  sourceTarget,
} from '../../src/simulation/blueprintFinds';
import { BLUEPRINT_ITEM_IDS, learnBlueprint } from '../../src/simulation/blueprintKnowledge';
import { survivalTimerAtTick } from '../../src/simulation/survivalCycle';
import {
  type AreaThemeId, type GameState, type ResourceNodeState,
} from '../../src/simulation/state';

function inTheme(theme: AreaThemeId): GameState {
  const state = createInitialState(4242);
  state.currentArea = { ...state.currentArea, theme };
  return state;
}

function nodeOfKind(state: GameState, kind: ResourceNodeState['kind']): ResourceNodeState {
  const found = state.resourceNodes.find((node) => node.kind === kind);
  return found ?? { id: 'n', kind, x: 200, y: 200, hp: 0, maxHp: 1, respawnAtTick: null };
}

/** Deplete one node kind repeatedly and report which strikes paid. */
function strikesThatPaid(state: GameState, kind: ResourceNodeState['kind'], count: number): number[] {
  const node = nodeOfKind(state, kind);
  const paid: number[] = [];
  for (let strike = 1; strike <= count; strike += 1) {
    if (rollNodeBlueprint(state, node)) paid.push(strike);
  }
  return paid;
}

describe('folding the coordinate hash', () => {
  it('maps every hash into [0,1) and uses the whole range', () => {
    let min = 1;
    let max = 0;
    let negatives = 0;
    for (let x = 0; x < 400; x += 1) {
      const raw = coordinateHash(99, x, x * 7);
      if (raw < 0) negatives += 1;
      const roll = foldedRoll(raw);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
      min = Math.min(min, roll);
      max = Math.max(max, roll);
    }
    // The fold is only needed because the hash really does go negative.
    expect(negatives).toBeGreaterThan(0);
    // Math.abs would cap the range near 0.5 and double the density below it.
    expect(max).toBeGreaterThan(0.9);
    expect(min).toBeLessThan(0.1);
  });

  it('is stable for a given hash', () => {
    expect(foldedRoll(-0.25)).toBeCloseTo(0.75, 10);
    expect(foldedRoll(0.25)).toBeCloseTo(0.25, 10);
  });
});

describe('counters', () => {
  it('always pays, and pays within the jitter band', () => {
    const state = inTheme('marsh');
    const base = state.gameBalance.blueprints.nodeTargets.tree;
    const spread = Math.floor((base * state.gameBalance.blueprints.jitterBps) / 10_000);
    const paid = strikesThatPaid(state, 'tree', base * 12);

    expect(paid.length).toBeGreaterThanOrEqual(10);
    const gaps = paid.map((strike, index) => strike - (paid[index - 1] ?? 0));
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(base - spread);
      expect(gap).toBeLessThanOrEqual(base + spread);
    }
  });

  it('does not pay on the same strike every time — the target is not countable', () => {
    const state = inTheme('marsh');
    const base = state.gameBalance.blueprints.nodeTargets.tree;
    const paid = strikesThatPaid(state, 'tree', base * 20);
    const gaps = new Set(paid.map((strike, index) => strike - (paid[index - 1] ?? 0)));
    expect(gaps.size).toBeGreaterThan(1);
  });

  it('averages the tuned target over a long run', () => {
    const state = inTheme('marsh');
    const base = state.gameBalance.blueprints.nodeTargets.tree;
    const strikes = base * 200;
    const paid = strikesThatPaid(state, 'tree', strikes);
    const average = strikes / paid.length;
    // Within one node of the target: the band is symmetric, so a systematic
    // drift would mean the jitter is skewed rather than merely noisy.
    expect(Math.abs(average - base)).toBeLessThan(1);
  });

  it('keeps a separate count per node kind and per region', () => {
    const state = inTheme('forest');
    for (let i = 0; i < 5; i += 1) rollNodeBlueprint(state, nodeOfKind(state, 'tree'));
    expect(state.blueprintProgress[nodeProgressKey('forest', 'tree')]?.struck).toBe(5);
    expect(state.blueprintProgress[nodeProgressKey('forest', 'stone')]).toBeUndefined();

    // Walking to another region does not cash out the count built up here.
    state.currentArea = { ...state.currentArea, theme: 'marsh' };
    rollNodeBlueprint(state, nodeOfKind(state, 'tree'));
    expect(state.blueprintProgress[nodeProgressKey('forest', 'tree')]?.struck).toBe(5);
    expect(state.blueprintProgress[nodeProgressKey('marsh', 'tree')]?.struck).toBe(1);
  });

  it('cannot be rerolled by reloading: the pending target is seeded', () => {
    const state = inTheme('marsh');
    const key = nodeProgressKey('marsh', 'tree');
    const first = sourceTarget(state, key, 20, 0);
    for (let i = 0; i < 20; i += 1) expect(sourceTarget(state, key, 20, 0)).toBe(first);
    // A different payout number is a different target — that is the re-roll.
    const targets = new Set(Array.from({ length: 40 }, (_, cycle) => sourceTarget(state, key, 20, cycle)));
    expect(targets.size).toBeGreaterThan(1);
  });

  it('switches a source off when its target is zero', () => {
    const state = inTheme('marsh');
    state.gameBalance.blueprints.nodeTargets.tree = 0;
    expect(strikesThatPaid(state, 'tree', 500)).toEqual([]);
  });

  it('makes the counter exact when jitter is zero', () => {
    const state = inTheme('marsh');
    state.gameBalance.blueprints.jitterBps = 0;
    const base = state.gameBalance.blueprints.nodeTargets.stone;
    expect(strikesThatPaid(state, 'stone', base * 4))
      .toEqual([base, base * 2, base * 3, base * 4]);
  });

  it('counts every node kind the world generates', () => {
    for (const kind of RESOURCE_NODE_KINDS) {
      const state = inTheme('forest');
      rollNodeBlueprint(state, nodeOfKind(state, kind));
      expect(state.blueprintProgress[nodeProgressKey('forest', kind)]?.struck).toBe(1);
    }
  });
});

describe('what a find hands over', () => {
  it('carries the blueprint rather than teaching it', () => {
    const state = inTheme('marsh');
    const base = state.gameBalance.blueprints.nodeTargets.tree;
    const node = nodeOfKind(state, 'tree');
    let find = null;
    for (let i = 0; i < base * 2 && !find; i += 1) find = rollNodeBlueprint(state, node);

    expect(find).not.toBeNull();
    expect(find!.spilled).toBe(false);
    // Paper, not knowledge: it still has to survive the trip to a workbench.
    expect(state.unlockedItemIds).not.toContain(find!.blueprintId);
    expect(state.carriedBlueprints.map((carried) => carried.blueprintId)).toContain(find!.blueprintId);
  });

  it('draws from the region it was found in', () => {
    for (const theme of ['meadow', 'forest', 'thicket', 'mountain', 'marsh'] as const) {
      const state = inTheme(theme);
      const pool = THEME_BLUEPRINT_POOLS[theme]!;
      const picked = new Set<string>();
      const node = nodeOfKind(state, 'tree');
      for (let i = 0; i < state.gameBalance.blueprints.nodeTargets.tree * 30; i += 1) {
        const find = rollNodeBlueprint(state, node);
        if (find) picked.add(find.blueprintId);
      }
      expect(picked.size).toBeGreaterThan(0);
      for (const id of picked) expect(pool).toContain(id);
    }
  });

  it('never produces better than Rare from a node, whatever the region', () => {
    for (const theme of AREA_THEME_IDS) {
      for (const id of sourceBlueprintPool('node', { theme })) {
        expect(['common', 'rare']).toContain(blueprintQuality(id));
      }
    }
  });

  it('reserves the Ancient tools for caves — no source can produce one', () => {
    expect(CAVE_RESERVED_BLUEPRINT_IDS.size).toBe(5);
    const everySource = [
      ...AREA_THEME_IDS.flatMap((theme) => sourceBlueprintPool('node', { theme })),
      ...sourceBlueprintPool('raider'),
      ...sourceBlueprintPool('storm-cache'),
      ...sourceBlueprintPool('cellar'),
      ...BLUEPRINT_DROPPING_SPECIES.flatMap((speciesId) => sourceBlueprintPool('creature', { speciesId })),
    ];
    for (const id of everySource) expect(CAVE_RESERVED_BLUEPRINT_IDS.has(id)).toBe(false);
  });

  it('falls back to anything unknown below the ceiling once a region is exhausted', () => {
    const state = inTheme('meadow');
    for (const id of THEME_BLUEPRINT_POOLS.meadow!) learnBlueprint(state, id);
    const picked = resolveBlueprintFind(state.unlockedItemIds, 'node', { common: 1, rare: 1 }, 0.5);

    expect(picked).not.toBeNull();
    expect(THEME_BLUEPRINT_POOLS.meadow).not.toContain(picked!);
    // Still capped: exhausting a region does not open the Epic tier.
    expect(['common', 'rare']).toContain(blueprintQuality(picked!));
  });

  it('hands over a duplicate rather than nothing once everything is known', () => {
    const state = inTheme('marsh');
    for (const id of BLUEPRINT_ITEM_IDS) learnBlueprint(state, id);
    const picked = resolveBlueprintFind(state.unlockedItemIds, 'node', { common: 1, rare: 1 }, 0.5, { theme: 'marsh' });

    expect(picked).not.toBeNull();
    expect(sourceBlueprintPool('node', { theme: 'marsh' })).toContain(picked!);
  });

  it('gives raiders the combat pool and lets them reach Epic', () => {
    expect(RAIDER_BLUEPRINT_POOL.some((id) => blueprintQuality(id) === 'epic')).toBe(true);
    expect(RAIDER_BLUEPRINT_POOL).toContain('turret');
    expect(RAIDER_BLUEPRINT_POOL).toContain('war-table');
  });

  it('gives a species the blueprints for the worksites it can work at', () => {
    expect(creatureBlueprintPool('craghopper')).toEqual(['stone-yard']);
    expect(creatureBlueprintPool('quillfinch')).toEqual(['turret']);
    expect(creatureBlueprintPool('glade-stag')).toEqual(['cart-dock']);
    expect([...creatureBlueprintPool('tuftle')].sort()).toEqual(['barn', 'small-pen']);
  });

  it('pays a species blueprint on its own defeat counter', () => {
    const state = inTheme('forest');
    const target = state.gameBalance.blueprints.creatureTarget;
    const finds: string[] = [];
    for (let i = 0; i < target * 4; i += 1) {
      const find = rollCreatureBlueprint(state, 'craghopper');
      if (find) finds.push(find.blueprintId);
    }
    expect(finds.length).toBeGreaterThanOrEqual(3);
    // Craghoppers work stone yards, so that is what hunting them teaches.
    expect(new Set(finds)).toEqual(new Set(['stone-yard']));
    expect(state.blueprintProgress[creatureProgressKey('craghopper')]!.cycle).toBe(finds.length);
  });
});

describe('rarity', () => {
  it('climbs with how unpleasant a region is to work in', () => {
    const ordered: AreaThemeId[] = ['meadow', 'forest', 'thicket', 'mountain', 'marsh'];
    for (let i = 1; i < ordered.length; i += 1) {
      expect(nodeRareShareBps(inTheme(ordered[i]!)))
        .toBeGreaterThan(nodeRareShareBps(inTheme(ordered[i - 1]!)));
    }
    expect(nodeRareShareBps(inTheme('elaris'))).toBe(0);
  });

  it('is raised by poison fog, up to the maximum', () => {
    const state = inTheme('marsh');
    const calm = nodeRareShareBps(state);
    state.tick = firstFogTick(state);
    expect(nodeRareShareBps(state)).toBeGreaterThan(calm);

    // The cap is what stops a Rare becoming the reliable outcome.
    state.gameBalance.blueprints.fogRareMultiplierBps = 500_000;
    expect(nodeRareShareBps(state)).toBe(state.gameBalance.blueprints.rareShareMaxBps);
  });
});

describe('progress bookkeeping', () => {
  it('resets the count and advances the payout number on a find', () => {
    const state = inTheme('marsh');
    state.gameBalance.blueprints.jitterBps = 0;
    const key = 'test-source';
    for (let i = 1; i < 5; i += 1) {
      expect(advanceBlueprintProgress(state, key, 5)).toBe(false);
      expect(state.blueprintProgress[key]).toEqual({ struck: i, cycle: 0 });
    }
    expect(advanceBlueprintProgress(state, key, 5)).toBe(true);
    expect(state.blueprintProgress[key]).toEqual({ struck: 0, cycle: 1 });
  });

  it('stores only whole numbers, which the determinism canonicaliser requires', () => {
    const state = inTheme('marsh');
    strikesThatPaid(state, 'tree', 120);
    for (const progress of Object.values(state.blueprintProgress)) {
      expect(Number.isSafeInteger(progress.struck)).toBe(true);
      expect(Number.isSafeInteger(progress.cycle)).toBe(true);
    }
  });
});

/** The first tick of the first poison fog danger phase. */
function firstFogTick(state: GameState): number {
  for (let seconds = 0; seconds < 60 * 60; seconds += 1) {
    const tick = seconds * TICKS_PER_SECOND;
    const timer = survivalTimerAtTick(tick, state.gameBalance.raid);
    if (timer.phase === 'danger' && timer.threat === 'fog') return tick;
  }
  throw new Error('no fog phase found');
}
