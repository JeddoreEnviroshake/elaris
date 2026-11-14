import { describe, expect, it } from 'vitest';
import { blueprintsGrantedAtLevel } from '../../src/content/blueprintGates';
import { CONSUMABLE_BLUEPRINT_IDS } from '../../src/simulation/blueprintKnowledge';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { SAVE_VERSION } from '../../src/persistence/types';
import { CONTENT_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { INTERACTION_RANGE_PX } from '../../src/config/balance';
import { TILE_SIZE } from '../../src/config/platform';
import { beginPlayerDefeat } from '../../src/simulation/survivalCycle';
import { CREATURE_DEFINITIONS } from '../../src/content/creatures';
import { isWithinTownSafeZoneWorldPosition } from '../../src/content/townDefences';

function v0Save() {
  return {
    meta: { saveVersion: 0, worldGenVersion: 1, contentVersion: 1, appVersion: 'test', savedAt: 1 },
    // v0 had no rngState
    state: { seed: 42, tick: 3, player: { x: 10, y: 20, facing: 'down' } },
  };
}

describe('migrateToCurrent', () => {
  it('upgrades a v0 save to current and adds rngState from the seed', () => {
    const { save, migrated } = migrateToCurrent(v0Save());
    expect(migrated).toBe(true);
    expect(save.meta.saveVersion).toBe(SAVE_VERSION);
    expect(save.state.rngState).toBe(42);
    expect(save.state.player.facing).toBe('down');
    expect(save.state.resourceNodes.length).toBeGreaterThan(0);
    expect(save.state.inventory).toEqual({
      'taming-snare': 0, 'reinforced-snare': 0, berry: 2, arrow: 5, 'cloth-mask': 0,
      'safeguard-charm': 0, 'draft-parchment': 0,
      wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
      'tuftle-down': 0, 'craghopper-shell': 0, 'stag-antler': 0, 'snarlfox-pelt': 0,
      'masonmole-claw': 0, 'boar-tusk': 0, 'quillfinch-quill': 0, 'mistmoth-scale': 0,
      'slingtail-stone': 0,
    });
    expect(save.state.groundDrops).toEqual([]);
    expect(save.state.highestAreaTierEver).toBe(0);
    expect(save.state.currentArea.name).toBe('Elaris');
    expect(save.state.visitedAreas).toEqual({});
    expect(save.state.buildings).toEqual([]);
    expect(save.state.resourcesCollected).toEqual({ wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 });
    expect(save.state).not.toHaveProperty('unlockPoints');
    // The level-1 gate, plus the consumables every pre-v72 save always had —
    // less the Rowboat, which v79 hands back to the find pools.
    expect(save.state.unlockedItemIds).toEqual(
      [...blueprintsGrantedAtLevel(1), ...CONSUMABLE_BLUEPRINT_IDS]
        .filter((id) => id !== 'rowboat')
        .sort(),
    );
  });

  it('adds gameplay state to a v1 save while preserving progress', () => {
    const v1 = {
      meta: { saveVersion: 1, worldGenVersion: 1, contentVersion: 1, appVersion: 'test', savedAt: 1 },
      state: { seed: 42, rngState: 99, tick: 12, player: { x: 50, y: 60, facing: 'left' } },
    };
    const { save, migrated } = migrateToCurrent(v1);
    expect(migrated).toBe(true);
    expect(save.state.player.x).toBe(50);
    expect(save.state.rngState).toBe(99);
    expect(save.state.resourceNodes.length).toBeGreaterThan(0);
  });

  it('leaves an already-current save unmigrated', () => {
    const current = migrateToCurrent(v0Save()).save;
    const again = migrateToCurrent(current);
    expect(again.migrated).toBe(false);
  });

  it('adds an empty ground-drop collection to a v2 save', () => {
    const v2 = migrateToCurrent(v0Save()).save;
    v2.meta.saveVersion = 2;
    delete (v2.state as Partial<typeof v2.state>).groundDrops;
    const { save, migrated } = migrateToCurrent(v2);
    expect(migrated).toBe(true);
    expect(save.state.groundDrops).toEqual([]);
  });

  it('adds sticky area progression to a v3 save', () => {
    const v3 = migrateToCurrent(v0Save()).save;
    v3.meta.saveVersion = 3;
    delete (v3.state as Partial<typeof v3.state>).highestAreaTierEver;
    const { save, migrated } = migrateToCurrent(v3);
    expect(migrated).toBe(true);
    expect(save.state.highestAreaTierEver).toBe(0);
  });

  it('adds an empty persisted building collection to a v4 save', () => {
    const v4 = migrateToCurrent(v0Save()).save;
    v4.meta.saveVersion = 4;
    delete (v4.state as Partial<typeof v4.state>).buildings;
    const { save, migrated } = migrateToCurrent(v4);
    expect(migrated).toBe(true);
    expect(save.state.buildings).toEqual([]);
  });

  it('adds fiber inventory and plant nodes to a v5 save', () => {
    const v5 = migrateToCurrent(v0Save()).save;
    v5.meta.saveVersion = 5;
    delete (v5.state.inventory as Partial<typeof v5.state.inventory>).fiber;
    v5.state.resourceNodes = v5.state.resourceNodes.filter((node) => node.kind !== 'plant');
    const { save, migrated } = migrateToCurrent(v5);
    expect(migrated).toBe(true);
    expect(save.state.inventory.fiber).toBe(0);
    expect(save.state.resourceNodes.some((node) => node.kind === 'plant')).toBe(true);
  });

  it('adds durable quest progress to a v6 save', () => {
    const v6 = migrateToCurrent(v0Save()).save;
    v6.meta.saveVersion = 6;
    delete (v6.state as Partial<typeof v6.state>).resourcesCollected;
    delete (v6.state as Partial<typeof v6.state>).repairsMade;
    v6.state.inventory.wood = 4;
    const { save, migrated } = migrateToCurrent(v6);
    expect(migrated).toBe(true);
    expect(save.state.resourcesCollected).toEqual({ wood: 4, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 });
    expect(save.state.repairsMade).toBe(0);
  });

  it('adds the starter Tuftle and an empty owned roster to a v7 save', () => {
    const v7 = migrateToCurrent(v0Save()).save;
    v7.meta.saveVersion = 7;
    delete (v7.state as Partial<typeof v7.state>).wildCreatures;
    delete (v7.state as Partial<typeof v7.state>).ownedCreatures;
    const { save, migrated } = migrateToCurrent(v7);
    expect(migrated).toBe(true);
    // Every species is represented, and the area is stocked to its population
    // quota rather than to one spawn per species.
    expect(new Set(save.state.wildCreatures.map((creature) => creature.speciesId)))
      .toEqual(new Set(CREATURE_DEFINITIONS.map((definition) => definition.speciesId)));
    expect(save.state.wildCreatures.length).toBeGreaterThan(4);
    expect(save.state.wildCreatures.every((creature) => Number.isFinite(creature.x) && Number.isFinite(creature.y))).toBe(true);
    expect(save.state.ownedCreatures).toEqual([]);
  });

  it('adds Tuftle work state and persistent Storage Box (small) storage to a v8 save', () => {
    const v8 = migrateToCurrent(v0Save()).save;
    v8.meta.saveVersion = 8;
    v8.state.ownedCreatures = [{ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle' } as never];
    v8.state.buildings = [{ id: 'cache-1', definitionId: 'field-cache', tileX: 1, tileY: 1 }];
    const { save, migrated } = migrateToCurrent(v8);
    expect(migrated).toBe(true);
    expect(save.state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0 });
    expect(save.state.buildings[0]).toMatchObject({ storage: { wood: 0, stone: 0, fiber: 0 } });
  });

  it('moves legacy v9 Tuftle assignments to safe rest state', () => {
    const v9 = migrateToCurrent(v0Save()).save;
    v9.meta.saveVersion = 9;
    v9.state.ownedCreatures = [{ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle', role: 'work', assignment: 'fiber', worksiteId: 'old-cache', nextWorkTick: 20, bondXp: 0, selectedBattleAbilityId: 'tuftle-guard' }];
    const { save } = migrateToCurrent(v9);
    expect(save.state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 20 });
  });

  it('adds durable quest records and worker production to a v10 save', () => {
    const v10 = migrateToCurrent(v0Save()).save;
    v10.meta.saveVersion = 10;
    delete (v10.state as Partial<typeof v10.state>).completedQuestIds;
    delete (v10.state as Partial<typeof v10.state>).claimedQuestRewardIds;
    delete (v10.state as Partial<typeof v10.state>).workerResourcesProduced;
    const { save, migrated } = migrateToCurrent(v10);
    expect(migrated).toBe(true);
    expect(save.state.completedQuestIds).toEqual([]);
    expect(save.state.claimedQuestRewardIds).toEqual([]);
    expect(save.state.workerResourcesProduced).toBe(0);
  });

  it('adds renewal deadlines to depleted nodes in a v11 save', () => {
    const v11 = migrateToCurrent(v0Save()).save;
    v11.meta.saveVersion = 11;
    v11.state.tick = 500;
    const depleted = v11.state.resourceNodes[0]!;
    depleted.hp = 0;
    for (const node of v11.state.resourceNodes) delete (node as Partial<typeof node>).respawnAtTick;
    const { save, migrated } = migrateToCurrent(v11);
    expect(migrated).toBe(true);
    expect(save.state.resourceNodes[0]!.respawnAtTick).toBeGreaterThan(500);
    expect(save.state.resourceNodes[1]!.respawnAtTick).toBeNull();
    expect(save.meta).toMatchObject({ saveVersion: SAVE_VERSION, worldGenVersion: WORLD_GEN_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('adds missing species to a v15 world without duplicating represented species', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 15;
    current.meta.worldGenVersion = 5;
    current.meta.contentVersion = 14;
    current.state.wildCreatures = current.state.wildCreatures.filter((creature) => creature.speciesId === 'tuftle');
    current.state.ownedCreatures.push({
      id: 'creature-owned-stag', speciesId: 'glade-stag', name: 'Fern', role: 'rest',
      assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'glade-stag-forward',
    });

    const { save, migrated } = migrateToCurrent(current);
    expect(migrated).toBe(true);
    // The tuftles the save already had are kept, and every species the world
    // was missing is added back. The exact roster length follows the area
    // population quota rather than being one spawn per species.
    // Glade Stag is represented by the owned roster, so the world is not
    // restocked with one.
    const species = new Set(save.state.wildCreatures.map((creature) => creature.speciesId));
    expect(species).toEqual(new Set(CREATURE_DEFINITIONS
      .map((definition) => definition.speciesId)
      .filter((speciesId) => speciesId !== 'glade-stag')));
    expect(save.state.wildCreatures.filter((creature) => creature.speciesId === 'tuftle').length)
      .toBeGreaterThanOrEqual(current.state.wildCreatures.length);
    expect(save.state.ownedCreatures.map((creature) => creature.speciesId)).toEqual(['glade-stag']);
  });

  it('adds deterministic growth state to existing v16 Woodlot Planters', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 16;
    current.meta.contentVersion = 15;
    current.state.tick = 240;
    current.state.buildings = [{ id: 'planter-1', definitionId: 'woodlot-planter', tileX: 15, tileY: 15 }];
    const { save, migrated } = migrateToCurrent(current);
    expect(migrated).toBe(true);
    expect(save.state.buildings[0]!.woodlot).toEqual({ progressTicks: 0, readyWood: 0, nextGrowthTick: 300 });
  });

  it('migrates v20 cell boundaries and markers to edge/kind state', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 20;
    current.meta.contentVersion = 19;
    current.state.buildings = [
      { id: 'floor', definitionId: 'wood-floor', tileX: 4, tileY: 4 },
      { id: 'wall', definitionId: 'wood-wall', tileX: 4, tileY: 4 },
      { id: 'marker', definitionId: 'environment-marker', tileX: 4, tileY: 4 },
    ];
    const migrated = migrateToCurrent(current).save;
    expect(migrated.state.buildings[1]).toMatchObject({ boundaryEdge: 'north' });
    expect(migrated.state.buildings[2]).toMatchObject({ environmentKind: 'indoor' });
  });

  it('grandfathers old-rule access and defaults migrated rotations in v21', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 21;
    const legacyState = current.state as unknown as Record<string, unknown>;
    delete legacyState['unlockPoints'];
    delete legacyState['unlockedItemIds'];
    current.state.resourcesCollected.wood = 1;
    current.state.resourcesCollected.fiber = 1;
    current.state.highestAreaTierEver = 8;
    current.state.buildings = [{ id: 'wall', definitionId: 'wood-wall', tileX: 4, tileY: 4, boundaryEdge: 'north' }];
    current.state.tools = [{
      instanceId: 'tool-1', definitionId: 'wooden-pick', durability: 1, maxDurability: 48,
      powerRank: 0, speedRank: 0, durabilityRank: 0,
    }];
    current.state.equippedToolId = 'tool-1';

    const migrated = migrateToCurrent(current).save;
    expect(migrated.state).not.toHaveProperty('unlockPoints');
    expect(migrated.state.unlockedItemIds).toEqual(expect.arrayContaining([
      'thatch-floor', 'wood-wall', 'wooden-pick', 'field-cache', 'workbench', 'garden-bed',
    ]));
    expect(migrated.state.buildings[0]).toMatchObject({ rotated: false });
  });

  it('migrates v22 iron resources, mountain ore, Furnace queues, and Iron tools', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 22;
    current.meta.worldGenVersion = 7;
    current.meta.contentVersion = 20;
    delete (current.state.inventory as Partial<typeof current.state.inventory>)['iron-ore'];
    delete (current.state.inventory as Partial<typeof current.state.inventory>)['iron-ingot'];
    delete (current.state.resourcesCollected as Partial<typeof current.state.resourcesCollected>)['iron-ore'];
    delete (current.state.resourcesCollected as Partial<typeof current.state.resourcesCollected>)['iron-ingot'];
    delete (current.state as Partial<typeof current.state>).yieldRemainderByResource;
    current.state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Iron Highlands', theme: 'mountain', seed: 99 };
    current.state.resourceNodes = [];
    current.state.buildings = [{ id: 'furnace-old', definitionId: 'furnace', tileX: 2, tileY: 2 }];
    current.state.tools = [{
      instanceId: 'tool-iron', definitionId: 'iron-pick', durability: 10, maxDurability: 240,
      powerRank: 0, speedRank: 0, durabilityRank: 0,
    }];
    current.state.equippedToolId = 'tool-iron';

    const migrated = migrateToCurrent(current).save;
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, worldGenVersion: WORLD_GEN_VERSION, contentVersion: CONTENT_VERSION });
    expect(migrated.state.inventory).toMatchObject({ 'iron-ore': 0, 'iron-ingot': 0 });
    expect(migrated.state.yieldRemainderByResource).toEqual({
      wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
    });
    expect(migrated.state.resourceNodes.some((node) => node.kind === 'metal')).toBe(true);
    expect(migrated.state.buildings[0]!.furnace).toEqual({ queue: [] });
    expect(migrated.state.tools[0]!.definitionId).toBe('iron-pick');
  });

  it('migrates v23 saves to authoritative save-backed Admin tuning', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 23;
    current.meta.contentVersion = 21;
    delete (current.state as Partial<typeof current.state>).gameBalance;

    const migrated = migrateToCurrent(current).save;
    expect(migrated.state.gameBalance.hands.damageByTarget.tree).toBe(5);
    expect(migrated.state.gameBalance.tools['iron-pick']).toMatchObject({
      maxDurability: 240,
      actionTicks: 12,
      damageByTarget: { metal: 24 },
    });
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('migrates v24 saves with the original base walk speed', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 24;
    current.meta.contentVersion = 22;
    const migrated = migrateToCurrent(current).save;
    expect(migrated.state.gameBalance.characterDefaults.walkSpeed).toBe(96);
    expect('walkSpeed' in migrated.state.player).toBe(false);
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('migrates v25 local Walk Speed into global character defaults', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 25;
    current.meta.contentVersion = 23;
    (current.state.player as typeof current.state.player & { walkSpeed: number }).walkSpeed = 144;
    delete (current.state.gameBalance as Partial<typeof current.state.gameBalance>).characterDefaults;

    const migrated = migrateToCurrent(current).save;
    expect(migrated.state.gameBalance.characterDefaults).toMatchObject({
      startingHp: 100,
      startingStamina: 100,
      startingMana: 30,
      startingAttributePoints: 0,
      walkSpeed: 144,
    });
    expect('walkSpeed' in migrated.state.player).toBe(false);
  });

  it('migrates v26 minimum tiers into complete global resource-object values', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 26;
    current.meta.contentVersion = 24;
    const legacy = current.state.gameBalance as unknown as Record<string, unknown>;
    legacy['minimumToolTierByTarget'] = { tree: 0, stone: 3, metal: 2, plant: 0, 'berry-bush': 0 };
    delete legacy['objects'];

    const migrated = migrateToCurrent(current).save;
    expect(migrated.state.gameBalance.objects.stone).toMatchObject({
      resource: 'stone', maxHp: 40, minimumToolTier: 3,
    });
    expect(migrated.state.gameBalance.objects.metal).toMatchObject({
      resource: 'iron-ore', yieldMin: 2, yieldMax: 4,
    });
    expect('minimumToolTierByTarget' in migrated.state.gameBalance).toBe(false);
  });

  it('backfills positional encounters, regen attributes, and regen balance from v27', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 27;
    current.meta.contentVersion = 25;
    const wild = current.state.wildCreatures[0]!;
    current.state.activeEncounter = {
      wildCreatureId: wild.id, creatureHp: 10, creatureMaxHp: 10, round: 2, message: 'Your turn.',
      playerPos: 30, creaturePos: 70,
      companionCreatureId: null, selectedCompanionAbilityId: null, companionAbilityReadyRounds: {}, enemyIntent: 'advance',
    };
    const legacyEncounter = current.state.activeEncounter as unknown as Record<string, unknown>;
    delete legacyEncounter['playerPos']; delete legacyEncounter['creaturePos'];
    const legacyAttributes = current.state.player.attributes as unknown as Record<string, unknown>;
    delete legacyAttributes['health']; delete legacyAttributes['stamina']; delete legacyAttributes['magic'];
    const legacyDefaults = current.state.gameBalance.characterDefaults as unknown as Record<string, unknown>;
    delete legacyDefaults['hpRegenBase']; delete legacyDefaults['staminaRegenBase']; delete legacyDefaults['manaRegenBase'];

    const migrated = migrateToCurrent(current).save;
    // v61 ends any duel in progress: creature health lives on the creature now,
    // and the battle screen the encounter belonged to is being retired. The
    // v27 positional backfill still runs on the way past — it just no longer
    // has anything to survive into.
    expect(migrated.state.activeEncounter).toBeNull();
    // v75 splits the three recovery attributes apart and restates the base
    // rates per second in hundredths.
    expect(migrated.state.player.attributes).toMatchObject({
      health: 0, healthRegen: 0, stamina: 0, staminaRegen: 0, mana: 0, manaRegen: 0, magic: 0,
    });
    expect(migrated.state.gameBalance.characterDefaults).toMatchObject({
      hpRegenBaseHundredths: 0, staminaRegenBaseHundredths: 500, manaRegenBaseHundredths: 200,
    });
  });

  it('gives wild creatures world health and a leash anchor from v60', () => {
    const legacy = migrateToCurrent(v0Save()).save;
    legacy.meta.saveVersion = 60;
    legacy.meta.contentVersion = 55;
    const wild = legacy.state.wildCreatures[0]!;
    // A v60 creature is position-only: strip everything this migration adds.
    const legacyCreature = wild as unknown as Record<string, unknown>;
    for (const field of ['hp', 'maxHp', 'homeX', 'homeY', 'aggroUntilTick', 'nextAttackTick', 'fleeUntilTick', 'captureBonusBps']) {
      delete legacyCreature[field];
    }
    const legacyBalance = legacy.state.gameBalance.creatures.tuftle as unknown as Record<string, unknown>;
    for (const field of ['speedPxPerTick', 'attackRangePx', 'attackIntervalTicks', 'aggroRangePx', 'leashPx', 'preferredRangePx']) {
      delete legacyBalance[field];
    }

    const migrated = migrateToCurrent(legacy).save;
    const creature = migrated.state.wildCreatures[0]!;
    expect(creature.hp).toBe(creature.maxHp);
    expect(creature.maxHp).toBeGreaterThan(0);
    // Home is where the creature stood, because the original spawn point is
    // not recoverable from a v60 save and does not need to be.
    expect(creature.homeX).toBe(creature.x);
    expect(creature.homeY).toBe(creature.y);
    expect(creature.aggroUntilTick).toBe(0);
    expect(creature.captureBonusBps).toBe(0);
    expect(migrated.state.gameBalance.creatures.tuftle).toMatchObject({
      speedPxPerTick: 1, attackRangePx: 24, attackIntervalTicks: 180, aggroRangePx: 0, leashPx: 160,
    });
  });

  it('gives a v61 save the published camera angle it never had', () => {
    const legacy = migrateToCurrent(v0Save()).save;
    legacy.meta.saveVersion = 61;
    legacy.meta.contentVersion = 56;
    const legacyBalance = legacy.state.gameBalance as unknown as Record<string, unknown>;
    delete legacyBalance['camera'];

    const migrated = migrateToCurrent(legacy).save;

    expect(migrated.state.gameBalance.camera).toEqual({ yawTenths: 200, pitchTenths: 474 });
  });

  it('splits a v62 danger phase into one length per danger element', () => {
    const legacy = migrateToCurrent(v0Save()).save;
    legacy.meta.saveVersion = 62;
    legacy.meta.contentVersion = 57;
    const legacyRaid = legacy.state.gameBalance.raid as unknown as Record<string, unknown>;
    delete legacyRaid['dangerPhaseSecondsByThreat'];
    // A save whose single danger phase was already retuned away from the default.
    legacyRaid['dangerPhaseSeconds'] = 45;

    const migrated = migrateToCurrent(legacy).save;

    // Every element inherits the length the save was tuned to, so the cycle the
    // player had is the cycle they keep until somebody edits one of them.
    // The storm did not exist at v62; it is added later in the chain and takes
    // the same tuned length rather than snapping back to the shipped default.
    expect(migrated.state.gameBalance.raid.dangerPhaseSecondsByThreat).toEqual({ fog: 45, raid: 45, storm: 45 });
    expect('dangerPhaseSeconds' in migrated.state.gameBalance.raid).toBe(false);
  });

  it('gives a v63 save the shipped sprint values', () => {
    const legacy = migrateToCurrent(v0Save()).save;
    legacy.meta.saveVersion = 63;
    legacy.meta.contentVersion = 57;
    const legacyDefaults = legacy.state.gameBalance.characterDefaults as unknown as Record<string, unknown>;
    delete legacyDefaults['sprintSpeedTenths'];
    delete legacyDefaults['sprintStaminaPerSecond'];
    // A retuned walk speed is left alone; only the missing sprint values arrive.
    legacyDefaults['walkSpeed'] = 120;

    const migrated = migrateToCurrent(legacy).save;

    expect(migrated.state.gameBalance.characterDefaults.sprintSpeedTenths).toBe(15);
    expect(migrated.state.gameBalance.characterDefaults.sprintStaminaPerSecond).toBe(2);
    expect(migrated.state.gameBalance.characterDefaults.walkSpeed).toBe(120);
  });

  it('gives a v65 save an empty storm and the shipped storm tuning', () => {
    const legacy = migrateToCurrent(v0Save()).save;
    legacy.meta.saveVersion = 65;
    const legacyState = legacy.state as unknown as Record<string, unknown>;
    delete legacyState['arcaneStorm'];
    const balance = legacy.state.gameBalance as unknown as Record<string, unknown>;
    delete balance['storm'];
    const raid = legacy.state.gameBalance.raid as unknown as Record<string, unknown>;
    // A save whose fog and raid nights were already retuned keeps both, and the
    // storm inherits the fog length rather than the shipped default.
    raid['dangerPhaseSecondsByThreat'] = { fog: 45, raid: 90 };

    const migrated = migrateToCurrent(legacy).save;

    expect(migrated.state.arcaneStorm).toEqual({ cycleIndex: null, nextStrikeIndex: 0, strikes: [] });
    expect(migrated.state.gameBalance.storm.playerDamage).toBe(35);
    expect(migrated.state.gameBalance.raid.dangerPhaseSecondsByThreat)
      .toEqual({ fog: 45, raid: 90, storm: 45 });
  });

  it('rejects a save whose strike state could not have happened', () => {
    const base = migrateToCurrent(v0Save()).save;
    const strike = {
      id: 'strike-1',
      cycleIndex: 4,
      strikeIndex: 0,
      areaKey: base.state.currentArea.key,
      x: 160,
      y: 160,
      telegraphAtTick: 100,
      impactAtTick: 280,
      rewardIronOre: 0,
      resolvedAtTick: null as number | null,
    };
    for (const mutate of [
      // A marker with no storm running, a marker for a slot that was never
      // scheduled, an impact before its own telegraph, and a resolution before
      // the impact it resolves.
      () => { base.state.arcaneStorm = { cycleIndex: null, nextStrikeIndex: 0, strikes: [{ ...strike }] }; },
      () => { base.state.arcaneStorm = { cycleIndex: 4, nextStrikeIndex: 0, strikes: [{ ...strike }] }; },
      () => { base.state.arcaneStorm = { cycleIndex: 4, nextStrikeIndex: 1, strikes: [{ ...strike, telegraphAtTick: 999 }] }; },
      () => { base.state.arcaneStorm = { cycleIndex: 4, nextStrikeIndex: 1, strikes: [{ ...strike, resolvedAtTick: 200 }] }; },
      () => { base.state.arcaneStorm = { cycleIndex: 4, nextStrikeIndex: 1, strikes: [{ ...strike, areaKey: '9,9' }] }; },
      () => { base.state.arcaneStorm = { cycleIndex: 4, nextStrikeIndex: 1, strikes: [{ ...strike, x: 160.5 }] }; },
    ]) {
      mutate();
      expect(() => migrateToCurrent(base)).toThrow();
    }

    base.state.arcaneStorm = { cycleIndex: 4, nextStrikeIndex: 1, strikes: [{ ...strike }] };
    expect(migrateToCurrent(base).migrated).toBe(false);
  });

  it('rejects a defeat cause that does not exist and accepts an arcane one', () => {
    const base = migrateToCurrent(v0Save()).save;
    const pending = {
      cause: 'arcane-storm' as const,
      lostItemCount: 0,
      defeatedAreaKey: base.state.currentArea.key,
      defeatedAreaName: base.state.currentArea.name,
      defeatedAreaX: 0,
      defeatedAreaY: 0,
      defeatedX: 160,
      defeatedY: 160,
      defeatedAtTick: 10,
    };
    base.state.player.hp = 0;
    base.state.pendingRespawn = pending;
    expect(migrateToCurrent(base).migrated).toBe(false);

    base.state.pendingRespawn = { ...pending, cause: 'lightning' as never };
    expect(() => migrateToCurrent(base)).toThrow();
  });

  it('backfills battle companion and Bond state from v32 without changing roster identity', () => {
    const legacy = migrateToCurrent(v0Save()).save;
    legacy.meta.saveVersion = 32;
    legacy.meta.contentVersion = 30;
    legacy.state.ownedCreatures.push({
      id: 'creature-legacy', speciesId: 'tuftle', name: 'Moss', role: 'follow', assignment: null,
      worksiteId: null, nextWorkTick: 0, bondXp: 9, selectedBattleAbilityId: 'tuftle-heal',
    });
    const rawCreature = legacy.state.ownedCreatures[0] as unknown as Record<string, unknown>;
    delete rawCreature['bondXp']; delete rawCreature['selectedBattleAbilityId'];
    const rawState = legacy.state as unknown as Record<string, unknown>;
    delete rawState['battleCompanionId'];

    const migrated = migrateToCurrent(legacy).save;
    expect(migrated.state.battleCompanionId).toBeNull();
    expect(migrated.state.ownedCreatures[0]).toMatchObject({
      id: 'creature-legacy', role: 'follow', bondXp: 0, selectedBattleAbilityId: 'tuftle-guard',
    });
  });

  it('consolidates legacy attributes, preserves their effects, and refunds removed options', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 28;
    current.meta.contentVersion = 26;
    current.state.player.attributePoints = 1;
    current.state.player.hp = 50; current.state.player.stamina = 60; current.state.player.mana = 10;
    current.state.player.attributes = {
      vitality: 2, strength: 3, endurance: 4, agility: 5, dexterity: 6,
      defense: 7, capacity: 8, handling: 9, health: 10, stamina: 11, magic: 12,
    } as unknown as typeof current.state.player.attributes;

    const migrated = migrateToCurrent(current).save;
    // v75 copies each old bundle into the stats it used to cover rather than
    // dividing it: the character was promised all of them.
    expect(migrated.state.player.attributes).toEqual({
      strength: 3, dexterity: 6, magic: 0, luck: 9, speed: 5,
      health: 12, healthRegen: 12,
      stamina: 15, staminaRegen: 15, carryWeight: 15,
      mana: 12, manaRegen: 12,
    });
    expect(migrated.state.player).toMatchObject({
      hp: 150, maxHp: 200, stamina: 170, maxStamina: 210,
      mana: 130, maxMana: 150, attributePoints: 16,
    });
  });

  it('backfills the default Bag weights and Weight Limit from v29', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 29;
    current.meta.contentVersion = 27;
    delete (current.state.gameBalance as Partial<typeof current.state.gameBalance>).bagWeight;

    const migrated = migrateToCurrent(current).save;
    expect(migrated.state.gameBalance.bagWeight).toEqual({
      capacityHundredths: 10_000,
      itemHundredths: {
        'taming-snare': 100, 'reinforced-snare': 125, berry: 25, arrow: 25, 'cloth-mask': 50,
        'safeguard-charm': 25, 'draft-parchment': 25, wood: 100,
        stone: 300, fiber: 50, 'iron-ingot': 500, 'iron-ore': 300,
        'tuftle-down': 25, 'craghopper-shell': 150, 'stag-antler': 100, 'snarlfox-pelt': 75,
        'masonmole-claw': 100, 'boar-tusk': 125, 'quillfinch-quill': 25, 'mistmoth-scale': 25,
        'slingtail-stone': 200,
      },
    });
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('backfills stack boundaries and persistent expiry markers from v30', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 30;
    current.meta.contentVersion = 28;
    current.state.inventory.wood = 104;
    delete (current.state as Partial<typeof current.state>).inventoryStacks;
    current.state.groundDrops = [{
      id: 'drop-500', resource: 'wood', amount: 2, x: 10, y: 20, expiresAtTick: null,
    }];
    delete (current.state.groundDrops[0]! as Partial<typeof current.state.groundDrops[0]>).expiresAtTick;

    const migrated = migrateToCurrent(current).save;
    expect(migrated.state.inventoryStacks.wood).toEqual([99, 5]);
    expect(migrated.state.groundDrops[0]?.expiresAtTick).toBeNull();
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('upgrades legacy Storage Boxes to six-space inventories from v31', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 31;
    current.meta.contentVersion = 29;
    current.state.buildings = [{
      id: 'cache-legacy', definitionId: 'field-cache', tileX: 1, tileY: 1,
      storage: { wood: 7, stone: 3, fiber: 0 },
    }];

    const migrated = migrateToCurrent(current).save;
    const box = migrated.state.buildings[0]!;
    expect(box.storage).toEqual({
      wood: 7, stone: 3, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
      'taming-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0,
    });
    expect(box.storageStacks).toEqual({
      wood: [7], stone: [3], fiber: [], 'iron-ore': [], 'iron-ingot': [],
      'taming-snare': [], berry: [], arrow: [], 'cloth-mask': [],
    });
    expect(box.storedTools).toEqual([]);
  });

  it('adds persisted danger-exposure grace state to a v33 save', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 33;
    delete (current.state as Partial<typeof current.state>).dangerExposureStartedAtTick;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.dangerExposureStartedAtTick).toBeNull();
    expect(migrated.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('adds raid, raider, defence, structure, and creature balance to a v38 save', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 38;
    const legacy = current.state.gameBalance as Partial<typeof current.state.gameBalance>;
    delete legacy.raid; delete legacy.raiders; delete legacy.defense;
    delete legacy.structures; delete legacy.creatures;

    const migrated = migrateToCurrent(current).save;
    const balance = migrated.state.gameBalance;

    expect(balance.raid.targetPriority).toBe('purifier-last');
    expect(balance.raiders.breaker.wallDamagePercent).toBe(300);
    expect(balance.defense.turretDamage).toBeGreaterThan(0);
    expect(balance.structures.wallHp.wood).toBeGreaterThan(0);
    expect(balance.creatures.tuftle.maxHp).toBeGreaterThan(0);
    expect(migrated.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('adds rowboat traversal and preserves legacy bases with land clearings from v36', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 36;
    delete (current.state as Partial<typeof current.state>).rowboatOwned;
    delete current.state.player.traversalMode;
    current.state.player.x = 50 * 16;
    current.state.player.y = 60 * 16;
    current.state.buildings = [{ id: 'legacy-floor', definitionId: 'wood-floor', tileX: 52, tileY: 60 }];

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.rowboatOwned).toBe(false);
    expect(migrated.state.player.traversalMode).toBe('foot');
    expect(migrated.state.currentArea.landClearingTiles).toEqual(expect.arrayContaining(['50,60', '52,60']));
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, worldGenVersion: WORLD_GEN_VERSION });
  });

  it('backfills configurable level-up rewards from v41', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 41;
    delete (current.state.gameBalance as Partial<typeof current.state.gameBalance>).levelUp;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.gameBalance.levelUp).toEqual({
      attributePointsPerStat: 1,
      spendableAttributePoints: 2,
      coins: 0,
    });
    expect(migrated.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('widens the damage table to raiders and structures on a v44 save', () => {
    // A v44 save knows only about resource-node targets. The new keys must be
    // filled from shipped defaults, and the player's own edits left alone.
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    const balance = current['state'].gameBalance;
    for (const tool of Object.values(balance.tools) as Array<Record<string, any>>) {
      delete tool['damageByTarget'].raider;
      delete tool['damageByTarget'].structure;
      delete tool['wearMultiplierByTarget'].raider;
      delete tool['wearMultiplierByTarget'].structure;
    }
    delete balance.hands.damageByTarget.raider;
    delete balance.hands.damageByTarget.structure;
    // A deliberate player edit that must survive the widening untouched.
    balance.tools['iron-axe'].damageByTarget.tree = 99;
    current['meta'].saveVersion = 44;

    const migrated = migrateToCurrent(current).save;

    const axe = migrated.state.gameBalance.tools['iron-axe'];
    expect(axe.damageByTarget.tree).toBe(99);
    expect(axe.damageByTarget.raider).toBeGreaterThan(0);
    expect(axe.damageByTarget.structure).toBeGreaterThan(0);
    expect(axe.wearMultiplierByTarget.raider).toBeGreaterThan(0);
    expect(migrated.state.gameBalance.hands.damageByTarget.structure).toBeGreaterThan(0);
    expect(migrated.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('adds the sword balance rows to a save that predates them', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    const balance = current['state'].gameBalance;
    for (const id of ['wooden-sword', 'stone-sword', 'iron-sword']) delete balance.tools[id];
    balance.tools['iron-axe'].maxDurability = 777;
    current['meta'].saveVersion = 45;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.gameBalance.tools['iron-sword'].damageByTarget.raider).toBeGreaterThan(0);
    expect(migrated.state.gameBalance.tools['iron-sword'].damageByTarget.metal).toBe(0);
    // An existing row the player tuned is left exactly as it was.
    expect(migrated.state.gameBalance.tools['iron-axe'].maxDurability).toBe(777);
    expect(migrated.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('turns a durable bow flag into a carried, wearing tool', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current['state'].bowOwned = true;
    current['state'].tools = [];
    current['meta'].saveVersion = 46;

    const migrated = migrateToCurrent(current).save;

    const bow = migrated.state.tools.find((tool) => tool.definitionId === 'bow');
    expect(bow).toBeDefined();
    expect(bow!.durability).toBe(bow!.maxDurability);
    expect('bowOwned' in migrated.state).toBe(false);
  });

  it('does not hand a bow to a save that never owned one', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current['state'].bowOwned = false;
    current['state'].tools = [];
    current['meta'].saveVersion = 46;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.tools.some((tool) => tool.definitionId === 'bow')).toBe(false);
  });

  it('adds roamer kinds and defense dials to a save that predates them', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    const balance = current['state'].gameBalance;
    for (const kindId of ['drifter', 'poacher']) delete balance.raiders[kindId];
    delete balance.defense.roamerAggroRangeTiles;
    delete balance.defense.roamerLeashTiles;
    delete balance.defense.roamersPerArea;
    delete balance.defense.roamerRespawnTicks;
    balance.defense.playerShotDamage = 42;
    current['meta'].saveVersion = 47;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.gameBalance.raiders.drifter.maxHp).toBeGreaterThan(0);
    expect(migrated.state.gameBalance.raiders.drifter.aggroRangePx).toBeGreaterThan(0);
    expect(migrated.state.gameBalance.defense.roamersPerArea).toBeGreaterThan(0);
    // A dial the player already tuned survives the backfill.
    expect(migrated.state.gameBalance.defense.playerShotDamage).toBe(42);
    expect(migrated.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('adds persisted respawn state to a v48 save without inventing a defeat', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    delete current['state'].pendingRespawn;
    delete current['state'].respawnProtectionUntilTick;
    current['meta'].saveVersion = 48;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.pendingRespawn).toBeNull();
    expect(migrated.state.respawnProtectionUntilTick).toBeNull();
    expect(migrated.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('canonicalizes authored expedition destinations in a v49 save', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current['state'].currentArea = {
      ...current['state'].currentArea,
      key: '1,0', x: 1, y: 0, name: 'Old Random Meadow', theme: 'thicket',
    };
    current['state'].visitedAreas['2,0'] = {
      ...current['state'].currentArea,
      key: '2,0', x: 2, y: 0, name: 'Old Random Forest', theme: 'marsh',
      resourceNodes: [], wildCreatures: [], groundDrops: [], buildings: [], raiders: [],
    };
    current['meta'].saveVersion = 49;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.currentArea).toMatchObject({ key: '1,0', name: 'Verdant Reach', theme: 'meadow' });
    expect(migrated.state.visitedAreas['2,0']).toMatchObject({ key: '2,0', name: 'Sylvaren', theme: 'forest' });
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('adds unclaimed regional discoveries and contracts to a v50 save', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    delete current['state'].regionalProgress;
    current['meta'].saveVersion = 50;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.regionalProgress).toEqual({
      discoveredLandmarkIds: [],
      contracts: {},
      contractCompletionCounts: {},
    });
    expect(migrated.meta).toMatchObject({
      saveVersion: SAVE_VERSION,
      worldGenVersion: WORLD_GEN_VERSION,
      contentVersion: CONTENT_VERSION,
    });
  });

  it('adds regional mastery history to a v51 save without changing live contract progress', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current['state'].regionalProgress = {
      discoveredLandmarkIds: ['sunwheel-orchard'],
      contracts: {
        'verdant-fiber-run': { cycleIndex: 2, progress: 12, completed: true },
      },
    };
    current['meta'].saveVersion = 51;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.regionalProgress).toEqual({
      discoveredLandmarkIds: ['sunwheel-orchard'],
      contracts: {
        'verdant-fiber-run': { cycleIndex: 2, progress: 12, completed: true },
      },
      contractCompletionCounts: { 'verdant-fiber-run': 1 },
    });
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('adds the Magic Staff balance row to a v52 save without changing existing tool tuning', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    delete current['state'].gameBalance.tools['magic-staff'];
    current['state'].gameBalance.tools['iron-axe'].maxDurability = 777;
    current['meta'].saveVersion = 52;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.gameBalance.tools['magic-staff']).toMatchObject({
      maxDurability: 240,
      damageByTarget: { metal: 12, raider: 18 },
    });
    expect(migrated.state.gameBalance.tools['iron-axe'].maxDurability).toBe(777);
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('adds worker housing bins and rests legacy workers in the v53 migration', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current['meta'].saveVersion = 53;
    current['meta'].contentVersion = 48;
    delete current['state'].gameBalance.structures.facilityHp['farm-counter'];
    delete current['state'].gameBalance.structures.facilityHp['small-pen'];
    delete current['state'].gameBalance.structures.facilityHp.barn;
    current['state'].buildings.push({ id: 'pen-legacy', definitionId: 'small-pen', tileX: 10, tileY: 10 });
    current['state'].ownedCreatures.push({
      id: 'creature-legacy', speciesId: 'tuftle', name: 'Moss', role: 'work', assignment: 'fiber',
      worksiteId: 'cache-legacy', nextWorkTick: 20, bondXp: 0, selectedBattleAbilityId: 'tuftle-guard',
    });

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.buildings.at(-1)?.housing).toEqual({ bin: { fiber: 0, berry: 0 } });
    expect(migrated.state.ownedCreatures[0]).toMatchObject({
      role: 'rest', assignment: null, worksiteId: null, housingId: null, workRemainderMs: 0,
    });
    expect(migrated.state.gameBalance.structures.facilityHp).toMatchObject({
      'farm-counter': 100, 'small-pen': 90, barn: 180,
    });
  });

  it('adds species-role facility state and health rows in the v54 migration', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current.meta.saveVersion = 54;
    current.meta.contentVersion = 49;
    delete current.state.gameBalance.structures.facilityHp['stone-yard'];
    delete current.state.gameBalance.structures.facilityHp['cart-dock'];
    current.state.buildings.push(
      { id: 'yard-legacy', definitionId: 'stone-yard', tileX: 10, tileY: 10 },
      { id: 'dock-legacy', definitionId: 'cart-dock', tileX: 12, tileY: 10 },
    );

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.buildings.find((building) => building.id === 'yard-legacy')?.producer).toEqual({ bin: { stone: 0 } });
    expect(migrated.state.buildings.find((building) => building.id === 'dock-legacy')?.cartDock).toEqual({
      linkedStorageId: null, playerInside: false, lastTransferMessage: null,
    });
    expect(migrated.state.gameBalance.structures.facilityHp).toMatchObject({ 'stone-yard': 140, 'cart-dock': 140 });
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('adds bulk storage, Logistics Hub state, and material health rows in the v55 migration', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current.meta.saveVersion = 55;
    current.meta.contentVersion = 50;
    delete current.state.gameBalance.structures.wallHp.stone;
    delete current.state.gameBalance.structures.wallHp.metal;
    delete current.state.gameBalance.structures.facilityHp.warehouse;
    delete current.state.gameBalance.structures.facilityHp['logistics-hub'];
    current.state.buildings.push(
      {
        id: 'warehouse-legacy', definitionId: 'warehouse', tileX: 10, tileY: 10,
        storage: { wood: 7, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 },
        storageStacks: { wood: [7], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [] }, storedTools: [],
      },
      { id: 'hub-legacy', definitionId: 'logistics-hub', tileX: 13, tileY: 10 },
    );

    const migrated = migrateToCurrent(current).save;
    expect(migrated.state.buildings.find((building) => building.id === 'warehouse-legacy')?.storage)
      .toMatchObject({ wood: 7, berry: 0, arrow: 0 });
    expect(migrated.state.buildings.find((building) => building.id === 'hub-legacy')?.logistics)
      .toEqual({ routes: [], lastRoutingMessage: null });
    expect(migrated.state.gameBalance.structures.wallHp).toMatchObject({ stone: 450, metal: 900 });
    expect(migrated.state.gameBalance.structures.facilityHp).toMatchObject({ warehouse: 260, 'logistics-hub': 220 });
  });

  it('adds minimal NPC memory in the v56 migration', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current.meta.saveVersion = 56;
    current.meta.contentVersion = 51;
    delete current.state.npcMemory;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.npcMemory).toEqual({ visits: {}, seenMomentIds: [] });
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
  });

  it('rejects invalid durable NPC memory', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    current.state.npcMemory = { visits: { 'not-an-npc': 1 }, seenMomentIds: [] };
    expect(() => migrateToCurrent(current)).toThrow(SaveValidationError);

    current.state.npcMemory = { visits: { 'mara-smith': 1 }, seenMomentIds: ['same', 'same'] };
    expect(() => migrateToCurrent(current)).toThrow(SaveValidationError);
  });

  it('accepts and restores a current save with a pending respawn decision', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.state.inventory.wood = 4;
    beginPlayerDefeat(current.state, 'creature');

    const reloaded = migrateToCurrent(structuredClone(current));

    expect(reloaded.migrated).toBe(false);
    expect(reloaded.save.state.pendingRespawn).toMatchObject({
      cause: 'creature',
      lostItemCount: 11,
      defeatedAreaKey: '0,0',
    });
    expect(reloaded.save.state.player.hp).toBe(0);
  });

  it('stamps level 1 on everything already in a v66 world', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    const state = current['state'];
    state.raiders = [{
      id: 'raider-old', kindId: 'scavenger', x: 100, y: 100, hp: 12, maxHp: 30,
      targetBuildingId: null, nextAttackTick: 0,
    }];
    state.visitedAreas = {
      '1,0': {
        key: '1,0', x: 1, y: 0, name: 'Verdant', theme: 'forest', seed: 7,
        resourceNodes: [], groundDrops: [], containers: [], buildings: [], raiders: [],
        wildCreatures: [{ ...state.wildCreatures[0], id: 'wild-stored-001' }],
      },
    };
    for (const creature of state.wildCreatures) delete creature.level;
    for (const creature of state.visitedAreas['1,0'].wildCreatures) delete creature.level;
    delete state.gameBalance.world;
    delete state.gameBalance.raiders.drifter.aggroRangePx;
    delete state.gameBalance.raiders.drifter.levelMultiplierBps;
    delete state.gameBalance.creatures.tuftle.levelMultiplierBps;
    state.gameBalance.defense.roamerAggroRangeTiles = 6;
    current['meta'].saveVersion = 66;

    const migrated = migrateToCurrent(current).save;

    // Level 1 rather than re-ranked from where it stands: this save has been
    // balanced against these enemies all along.
    expect(migrated.state.wildCreatures.every((creature) => creature.level === 1)).toBe(true);
    expect(migrated.state.raiders.every((raider) => raider.level === 1)).toBe(true);
    expect(migrated.state.visitedAreas['1,0']!.wildCreatures[0]!.level).toBe(1);
    // Damage already taken survives the stamp.
    expect(migrated.state.raiders[0]!.hp).toBe(12);
    expect(migrated.state.gameBalance.world.creaturesPerArea).toBeGreaterThan(0);
    expect(migrated.state.gameBalance.raiders.drifter.aggroRangePx).toBeGreaterThan(0);
    expect(migrated.state.gameBalance.creatures.tuftle.levelMultiplierBps).toBeGreaterThan(0);
    // The single global roamer zone is gone, replaced by the per-kind ones.
    expect('roamerAggroRangeTiles' in migrated.state.gameBalance.defense).toBe(false);
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, worldGenVersion: WORLD_GEN_VERSION });
  });

  it('moves a v68 bow shot range onto the Bow as its Range', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    const balance = current['state'].gameBalance;
    delete balance.hands.rangePx;
    for (const tool of Object.values<any>(balance.tools)) delete tool.rangePx;
    // An admin who widened the shot range meant it, so the Bow inherits it.
    balance.defense.playerShotRangeTiles = 9;
    current['meta'].saveVersion = 68;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.gameBalance.tools.bow.rangePx).toBe(9 * TILE_SIZE);
    expect(migrated.state.gameBalance.tools['iron-sword'].rangePx).toBe(INTERACTION_RANGE_PX);
    expect(migrated.state.gameBalance.hands.rangePx).toBe(INTERACTION_RANGE_PX);
    expect('playerShotRangeTiles' in migrated.state.gameBalance.defense).toBe(false);
    expect(migrated.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('sweeps resources and caches out of the Elaris walls in a v75 world', () => {
    const current = migrateToCurrent(v0Save()).save as unknown as Record<string, any>;
    const state = current['state'];
    // Tile (80, 80) is the spawn point, well inside the perimeter; the grove
    // west of the gate stands for everything outside it.
    const inside = { x: 80 * TILE_SIZE, y: 80 * TILE_SIZE };
    const outside = { x: 52 * TILE_SIZE, y: 84 * TILE_SIZE };
    expect(isWithinTownSafeZoneWorldPosition(inside.x, inside.y)).toBe(true);
    expect(isWithinTownSafeZoneWorldPosition(outside.x, outside.y)).toBe(false);
    state.currentArea = { ...state.currentArea, key: '0,0', x: 0, y: 0 };
    state.resourceNodes = [
      { id: 'town-tree', kind: 'tree', ...inside, hp: 20, maxHp: 20, respawnAtTick: null },
      { id: 'field-tree', kind: 'tree', ...outside, hp: 12, maxHp: 20, respawnAtTick: null },
    ];
    state.containers = [
      { id: 'town-cache', kind: 'supply-cache', ...inside, opened: false },
      { id: 'field-cache', kind: 'hollow-log', ...outside, opened: false },
    ];
    state.visitedAreas = {
      '0,0': {
        key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris', seed: state.seed,
        resourceNodes: [{ id: 'stored-town-stone', kind: 'stone', ...inside, hp: 20, maxHp: 20, respawnAtTick: null }],
        groundDrops: [], buildings: [], raiders: [], wildCreatures: [],
        containers: [{ id: 'stored-town-cache', kind: 'hollow-log', ...inside, opened: false }],
      },
    };
    current['meta'].saveVersion = 75;

    const migrated = migrateToCurrent(current).save;

    expect(migrated.state.resourceNodes.map((node) => node.id)).toEqual(['field-tree']);
    expect(migrated.state.containers.map((container) => container.id)).toEqual(['field-cache']);
    expect(migrated.state.visitedAreas['0,0']!.resourceNodes).toEqual([]);
    expect(migrated.state.visitedAreas['0,0']!.containers).toEqual([]);
    // Progress on the node outside the walls is untouched.
    expect(migrated.state.resourceNodes[0]!.hp).toBe(12);
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, worldGenVersion: WORLD_GEN_VERSION });
  });

  it('rejects a save newer than the supported version', () => {
    const future = { meta: { saveVersion: SAVE_VERSION + 1, savedAt: 1 }, state: {} };
    expect(() => migrateToCurrent(future)).toThrow(SaveValidationError);
  });

  it('rejects structurally invalid saves', () => {
    expect(() => migrateToCurrent({ meta: { saveVersion: 1, savedAt: 1 }, state: {} })).toThrow(
      SaveValidationError,
    );
    expect(() => migrateToCurrent(null)).toThrow(SaveValidationError);
    expect(() =>
      migrateToCurrent({
        meta: { saveVersion: 1, savedAt: 1 },
        state: { seed: 1, rngState: 1, tick: 0, player: { x: 0, y: 0, facing: 'sideways' } },
      }),
    ).toThrow(SaveValidationError);
  });
});

describe('v77 -> v78: blueprint counters', () => {
  it('gives an old save empty counters and the shipped find balance', () => {
    const { save } = migrateToCurrent(v0Save());
    expect(save.state.blueprintProgress).toEqual({});
    const blueprints = save.state.gameBalance.blueprints;
    expect(blueprints.nodeTargets.tree).toBe(20);
    expect(blueprints.nodeTargets.stone).toBe(15);
    expect(blueprints.jitterBps).toBe(2_000);
    expect(blueprints.rareShareBpsByTheme.elaris).toBe(0);
    expect(blueprints.rareShareBpsByTheme.marsh).toBeGreaterThan(blueprints.rareShareBpsByTheme.meadow);
  });

  it('leaves counters a newer save already carries alone', () => {
    const { save } = migrateToCurrent(v0Save());
    const carried = {
      ...save,
      state: { ...save.state, blueprintProgress: { 'marsh:tree': { struck: 7, cycle: 2 } } },
    };
    const again = migrateToCurrent(carried);
    expect(again.migrated).toBe(false);
    expect(again.save.state.blueprintProgress).toEqual({ 'marsh:tree': { struck: 7, cycle: 2 } });
  });

  it('rejects a counter that is not two whole numbers', () => {
    const { save } = migrateToCurrent(v0Save());
    for (const broken of [{ struck: 1.5, cycle: 0 }, { struck: -1, cycle: 0 }, { struck: 1 }]) {
      const corrupt = { ...save, state: { ...save.state, blueprintProgress: { 'marsh:tree': broken } } };
      expect(() => migrateToCurrent(corrupt)).toThrow(SaveValidationError);
    }
  });
});

describe('v78 -> v79: the Rowboat must be found', () => {
  it('takes back the grandfathered recipe while keeping the other consumables', () => {
    const { save } = migrateToCurrent(v0Save());
    expect(save.state.unlockedItemIds).not.toContain('rowboat');
    for (const id of ['arrow', 'cloth-mask', 'taming-snare', 'reinforced-snare']) {
      expect(save.state.unlockedItemIds).toContain(id);
    }
  });

  it('leaves a boat already built afloat', () => {
    const { save } = migrateToCurrent(v0Save());
    const owner = { ...save, state: { ...save.state, rowboatOwned: true } };
    const again = migrateToCurrent(owner);
    expect(again.save.state.rowboatOwned).toBe(true);
    expect(again.save.state.unlockedItemIds).not.toContain('rowboat');
  });

  it('keeps a rowboat blueprint the player has since found', () => {
    const { save } = migrateToCurrent(v0Save());
    const learned = {
      ...save,
      state: { ...save.state, unlockedItemIds: [...save.state.unlockedItemIds, 'rowboat'].sort() },
    };
    const again = migrateToCurrent(learned);
    expect(again.migrated).toBe(false);
    expect(again.save.state.unlockedItemIds).toContain('rowboat');
  });
});

describe('v79 -> v80: the death cache', () => {
  it('lands an upgraded save with no cache and no beacon', () => {
    const { save } = migrateToCurrent(v0Save());
    expect(save.state.deathCache).toBeNull();
  });

  it('carries a real cache through validation intact', () => {
    const { save } = migrateToCurrent(v0Save());
    const cache = {
      id: 'death-cache-1',
      areaKey: '0,0',
      areaName: 'Elaris',
      areaX: 0,
      areaY: 0,
      x: 600,
      y: 480,
      resources: { wood: 12 },
      tools: [{
        instanceId: 'tool-1', definitionId: 'stone-axe',
        durability: 40, maxDurability: 60,
        powerRank: 0, speedRank: 0, durabilityRank: 0,
      }],
      createdAtTick: 100,
      expiresAtTick: 100 + 10 * 60 * 60,
    };
    const again = migrateToCurrent({ ...save, state: { ...save.state, deathCache: cache } });
    expect(again.save.state.deathCache).toEqual(cache);
  });

  it('rejects a cache holding nothing, which would beacon empty ground', () => {
    const { save } = migrateToCurrent(v0Save());
    const empty = {
      id: 'death-cache-1', areaKey: '0,0', areaName: 'Elaris', areaX: 0, areaY: 0,
      x: 600, y: 480, resources: {}, tools: [], createdAtTick: 100, expiresAtTick: 200,
    };
    expect(() => migrateToCurrent({ ...save, state: { ...save.state, deathCache: empty } }))
      .toThrow(SaveValidationError);
  });

  it('rejects a cache whose deadline has already passed at write time', () => {
    const { save } = migrateToCurrent(v0Save());
    const backwards = {
      id: 'death-cache-1', areaKey: '0,0', areaName: 'Elaris', areaX: 0, areaY: 0,
      x: 600, y: 480, resources: { wood: 1 }, tools: [], createdAtTick: 300, expiresAtTick: 200,
    };
    expect(() => migrateToCurrent({ ...save, state: { ...save.state, deathCache: backwards } }))
      .toThrow(SaveValidationError);
  });
});
