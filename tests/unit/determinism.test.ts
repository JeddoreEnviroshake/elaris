import { describe, expect, it } from 'vitest';
import { canonicalizeGameState, hashGameState } from '../../src/simulation/determinism';
import { createInitialState, type GameState } from '../../src/simulation/state';

function reorderedCopy(state: GameState): GameState {
  return {
    tools: state.tools.map((tool) => ({
      maxDurability: tool.maxDurability,
      durability: tool.durability,
      definitionId: tool.definitionId,
      instanceId: tool.instanceId,
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
      encounterCooldownUntilTick: creature.encounterCooldownUntilTick,
      y: creature.y,
      x: creature.x,
      speciesId: creature.speciesId,
      id: creature.id,
    })),
    ownedCreatures: state.ownedCreatures.map((creature) => ({
      role: creature.role,
      worksiteId: creature.worksiteId,
      nextWorkTick: creature.nextWorkTick,
      assignment: creature.assignment,
      name: creature.name,
      speciesId: creature.speciesId,
      id: creature.id,
    })),
    rngState: state.rngState,
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
      y: state.player.y,
      x: state.player.x,
    },
    nextEntityId: state.nextEntityId,
    inventory: { fiber: state.inventory.fiber, stone: state.inventory.stone, wood: state.inventory.wood },
    consumables: { arrows: state.consumables.arrows, tamingSnares: state.consumables.tamingSnares, berries: state.consumables.berries },
    resourcesCollected: {
      fiber: state.resourcesCollected.fiber,
      stone: state.resourcesCollected.stone,
      wood: state.resourcesCollected.wood,
    },
    repairsMade: state.repairsMade,
    completedQuestIds: [...state.completedQuestIds],
    claimedQuestRewardIds: [...state.claimedQuestRewardIds],
    workerResourcesProduced: state.workerResourcesProduced,
    highestAreaTierEver: state.highestAreaTierEver,
    buildings: state.buildings.map((building) => ({
      tileY: building.tileY,
      tileX: building.tileX,
      definitionId: building.definitionId,
      id: building.id,
    })),
    groundDrops: state.groundDrops,
    equippedToolId: state.equippedToolId,
    activeEncounter: state.activeEncounter,
    actionCooldownUntilTick: state.actionCooldownUntilTick,
    tick: state.tick,
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

  it('changes when meaningful authoritative state changes', async () => {
    const before = createInitialState(9);
    const after = structuredClone(before);
    after.inventory.wood += 1;

    expect(await hashGameState(after)).not.toBe(await hashGameState(before));
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
