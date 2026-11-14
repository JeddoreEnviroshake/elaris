import { describe, expect, it } from 'vitest';
import { canonicalizeGameState, hashGameState } from '../../src/simulation/determinism';
import { createInitialState, type GameState } from '../../src/simulation/state';

function reorderedCopy(state: GameState): GameState {
  return {
    onboarding: structuredClone(state.onboarding),
    tools: state.tools.map((tool) => ({
      maxDurability: tool.maxDurability,
      durability: tool.durability,
      definitionId: tool.definitionId,
      instanceId: tool.instanceId,
      powerRank: tool.powerRank,
      speedRank: tool.speedRank,
      durabilityRank: tool.durabilityRank,
    })),
    resourceNodes: state.resourceNodes.map((node) => ({
      maxHp: node.maxHp,
      respawnAtTick: node.respawnAtTick,
      hp: node.hp,
      y: node.y,
      x: node.x,
      kind: node.kind,
      id: node.id,
    })),
    wildCreatures: state.wildCreatures.map((creature) => ({
      level: creature.level,
      captureBonusBps: creature.captureBonusBps,
      fleeUntilTick: creature.fleeUntilTick,
      nextAttackTick: creature.nextAttackTick,
      aggroUntilTick: creature.aggroUntilTick,
      homeY: creature.homeY,
      homeX: creature.homeX,
      maxHp: creature.maxHp,
      hp: creature.hp,
      encounterCooldownUntilTick: creature.encounterCooldownUntilTick,
      y: creature.y,
      x: creature.x,
      speciesId: creature.speciesId,
      id: creature.id,
    })),
    containers: state.containers.map((container) => ({
      opened: container.opened,
      y: container.y,
      x: container.x,
      kind: container.kind,
      id: container.id,
    })),
    raiders: state.raiders.map((raider) => ({
      level: raider.level,
      nextAttackTick: raider.nextAttackTick,
      targetBuildingId: raider.targetBuildingId,
      maxHp: raider.maxHp,
      hp: raider.hp,
      y: raider.y,
      x: raider.x,
      kindId: raider.kindId,
      id: raider.id,
    })),
    arcaneStorm: {
      strikes: state.arcaneStorm.strikes.map((strike) => ({ ...strike })),
      nextStrikeIndex: state.arcaneStorm.nextStrikeIndex,
      cycleIndex: state.arcaneStorm.cycleIndex,
    },
    raidCycleIndex: state.raidCycleIndex,
    raidSettledAreaKeys: [...state.raidSettledAreaKeys],
    ownedCreatures: state.ownedCreatures.map((creature) => ({
      role: creature.role,
      worksiteId: creature.worksiteId,
      nextWorkTick: creature.nextWorkTick,
      assignment: creature.assignment,
      bondXp: creature.bondXp,
      selectedBattleAbilityId: creature.selectedBattleAbilityId,
      name: creature.name,
      speciesId: creature.speciesId,
      id: creature.id,
    })),
    rngState: state.rngState,
    ...(state.rowboatOwned !== undefined ? { rowboatOwned: state.rowboatOwned } : {}),
    clothMaskActiveUntilTick: state.clothMaskActiveUntilTick,
    currentArea: { ...state.currentArea },
    visitedAreas: structuredClone(state.visitedAreas),
    player: {
      attributes: { ...state.player.attributes },
      attributePoints: state.player.attributePoints,
      xp: state.player.xp,
      level: state.player.level,
      maxMana: state.player.maxMana,
      mana: state.player.mana,
      maxStamina: state.player.maxStamina,
      stamina: state.player.stamina,
      maxHp: state.player.maxHp,
      hp: state.player.hp,
      facing: state.player.facing,
      ...(state.player.traversalMode ? { traversalMode: state.player.traversalMode } : {}),
      y: state.player.y,
      x: state.player.x,
    },
    nextEntityId: state.nextEntityId,
    inventory: {
      fiber: state.inventory.fiber, stone: state.inventory.stone, wood: state.inventory.wood,
      'iron-ore': state.inventory['iron-ore'], 'iron-ingot': state.inventory['iron-ingot'],
      'taming-snare': state.inventory['taming-snare'],
      'reinforced-snare': state.inventory['reinforced-snare'], berry: state.inventory.berry,
      arrow: state.inventory.arrow, 'cloth-mask': state.inventory['cloth-mask'],
      'safeguard-charm': state.inventory['safeguard-charm'],
      'draft-parchment': state.inventory['draft-parchment'],
      'tuftle-down': state.inventory['tuftle-down'],
      'craghopper-shell': state.inventory['craghopper-shell'],
      'stag-antler': state.inventory['stag-antler'],
      'snarlfox-pelt': state.inventory['snarlfox-pelt'],
      'masonmole-claw': state.inventory['masonmole-claw'],
      'boar-tusk': state.inventory['boar-tusk'],
      'quillfinch-quill': state.inventory['quillfinch-quill'],
      'mistmoth-scale': state.inventory['mistmoth-scale'],
      'slingtail-stone': state.inventory['slingtail-stone'],
    },
    inventoryStacks: structuredClone(state.inventoryStacks),
    expeditions: state.expeditions.map((expedition) => ({
      rollIndex: expedition.rollIndex,
      remainingMs: expedition.remainingMs,
      routeId: expedition.routeId,
      creatureId: expedition.creatureId,
      id: expedition.id,
    })),
    expeditionsDispatched: state.expeditionsDispatched,
    arcaneStudyPurchases: state.arcaneStudyPurchases,
    packRanks: state.packRanks,
    unlockedItemIds: [...state.unlockedItemIds],
    pendingBlueprintGrantIds: [...state.pendingBlueprintGrantIds],
    carriedBlueprints: state.carriedBlueprints.map((carried) => ({ ...carried })),
    blueprintDrops: state.blueprintDrops.map((drop) => ({ ...drop })),
    toolDrops: state.toolDrops.map((drop) => ({ ...drop, tool: { ...drop.tool } })),
    blueprintProgress: structuredClone(state.blueprintProgress),
    coins: state.coins,
    resourcesSold: state.resourcesSold,
    firstTamedSpeciesIds: [...state.firstTamedSpeciesIds],
    resourcesCollected: {
      fiber: state.resourcesCollected.fiber,
      stone: state.resourcesCollected.stone,
      wood: state.resourcesCollected.wood,
      'iron-ore': state.resourcesCollected['iron-ore'],
      'iron-ingot': state.resourcesCollected['iron-ingot'],
    },
    yieldRemainderByResource: { ...state.yieldRemainderByResource },
    repairsMade: state.repairsMade,
    completedQuestIds: [...state.completedQuestIds],
    claimedQuestRewardIds: [...state.claimedQuestRewardIds],
    npcMemory: {
      visits: { ...state.npcMemory.visits },
      seenMomentIds: [...state.npcMemory.seenMomentIds],
    },
    questProgress: structuredClone(state.questProgress),
    regionalProgress: structuredClone(state.regionalProgress),
    workerResourcesProduced: state.workerResourcesProduced,
    highestAreaTierEver: state.highestAreaTierEver,
    highestRatingEverTenths: state.highestRatingEverTenths,
    buildings: state.buildings.map((building) => ({
      tileY: building.tileY,
      tileX: building.tileX,
      definitionId: building.definitionId,
      id: building.id,
    })),
    groundDrops: state.groundDrops,
    equippedToolId: state.equippedToolId,
    activeEncounter: state.activeEncounter,
    battleCompanionId: state.battleCompanionId,
    actionCooldownUntilTick: state.actionCooldownUntilTick,
    gameBalance: structuredClone(state.gameBalance),
    tick: state.tick,
    dangerExposureStartedAtTick: state.dangerExposureStartedAtTick,
    pendingRespawn: state.pendingRespawn ? { ...state.pendingRespawn } : null,
    respawnProtectionUntilTick: state.respawnProtectionUntilTick,
    deathCache: state.deathCache
      ? { ...state.deathCache, resources: { ...state.deathCache.resources }, tools: state.deathCache.tools.map((tool) => ({ ...tool })) }
      : null,
    seed: state.seed,
  };
}

describe('canonical deterministic state hashing', () => {
  it('hashes identical equivalent states identically', async () => {
    const first = createInitialState(12345);
    const second = structuredClone(first);

    await expect(hashGameState(first)).resolves.toBe(await hashGameState(second));
  });

  it('is unaffected by object-key ordering at every level', async () => {
    const state = createInitialState(77);

    expect(canonicalizeGameState(reorderedCopy(state))).toBe(canonicalizeGameState(state));
    await expect(hashGameState(reorderedCopy(state))).resolves.toBe(await hashGameState(state));
  });

  it('accepts a levelled world and hashes two generations of it identically', async () => {
    const first = createInitialState(4242);
    const second = createInitialState(4242);

    // Levels are part of the canonical state, so they have to be whole numbers
    // and they have to come out the same for the same seed.
    expect(first.wildCreatures.every((creature) => Number.isInteger(creature.level) && creature.level >= 1)).toBe(true);
    expect(first.wildCreatures.map((creature) => creature.level))
      .toEqual(second.wildCreatures.map((creature) => creature.level));
    await expect(hashGameState(first)).resolves.toBe(await hashGameState(second));
  });

  it('changes when a creature is re-ranked', async () => {
    const before = createInitialState(4242);
    const after = structuredClone(before);
    after.wildCreatures[0]!.level += 1;

    expect(await hashGameState(after)).not.toBe(await hashGameState(before));
  });

  it('changes when meaningful authoritative state changes', async () => {
    const before = createInitialState(9);
    const after = structuredClone(before);
    after.inventory.wood += 1;

    expect(await hashGameState(after)).not.toBe(await hashGameState(before));
  });

  it('includes deterministic-yield carry and Furnace queue work in the hash', async () => {
    const before = createInitialState(91);
    const after = structuredClone(before);
    after.yieldRemainderByResource['iron-ore'] = 2500;
    after.buildings.push({
      id: 'furnace-hash', definitionId: 'furnace', tileX: 1, tileY: 1,
      furnace: { queue: [{
        recipe: 'iron-ingot', remainingWorkMs: 4000,
        reservedInputs: { 'iron-ore': 2, wood: 1 }, completedOutput: 0, blocked: false,
      }] },
    });
    expect(await hashGameState(after)).not.toBe(await hashGameState(before));
  });

  it('includes durable NPC memory in the hash while ignoring key insertion order', async () => {
    const before = createInitialState(92);
    const after = structuredClone(before);
    after.npcMemory.visits['mara-smith'] = 2;
    after.npcMemory.visits['tavi-trader'] = 1;
    after.npcMemory.seenMomentIds.push('mara:introduction');
    expect(await hashGameState(after)).not.toBe(await hashGameState(before));

    const reordered = structuredClone(after);
    reordered.npcMemory.visits = { 'tavi-trader': 1, 'mara-smith': 2 };
    expect(await hashGameState(reordered)).toBe(await hashGameState(after));
  });

  it('preserves semantic array ordering', async () => {
    const first = createInitialState(101);
    const second = structuredClone(first);
    second.resourceNodes.reverse();

    expect(await hashGameState(second)).not.toBe(await hashGameState(first));
  });

  it.each([
    ['fractional number', 1.5, 'numbers must be safe integers'],
    ['undefined', undefined, 'received undefined'],
    ['Date', new Date(0), 'only arrays and plain objects are supported'],
    ['bigint', 1n, 'received bigint'],
  ])('clearly rejects an unsupported %s', (_label, value, reason) => {
    const invalid = createInitialState(1) as GameState & { invalid?: unknown };
    invalid.invalid = value;

    expect(() => canonicalizeGameState(invalid)).toThrowError(
      `Unsupported canonical value at $.invalid: ${reason}`,
    );
  });

  it('clearly rejects cyclic objects', () => {
    const invalid = createInitialState(1) as GameState & { invalid?: unknown };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    invalid.invalid = cycle;

    expect(() => canonicalizeGameState(invalid)).toThrowError(
      'Unsupported canonical value at $.invalid.self: cyclic references are not supported',
    );
  });
});
