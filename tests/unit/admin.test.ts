import { describe, expect, it } from 'vitest';
import { applyAdminUpdate, applyGameBalance, applyLocalAdminUpdate, createAdminDraft, validateGameBalance } from '../../src/simulation/admin';
import { craftTool, gatherNearest, structureMaxHp } from '../../src/simulation/gameplayCommands';
import { advanceRaid } from '../../src/simulation/raids';
import { leveledRaiderDefinition } from '../../src/config/balance';
import { DANGER_PHASE_SECONDS, SAFE_PHASE_SECONDS } from '../../src/simulation/survivalCycle';
import { createPlayerState } from '../../src/simulation/state';
import { createOrdinaryState as createInitialState } from './helpers/ordinaryWorld';
import { enclosedEnvironment } from './helpers/buildings';

describe('save-backed Admin updates', () => {
  it('atomically updates the complete character/economy/unlock surface', () => {
    const state = createInitialState(123);
    const draft = createAdminDraft(state);
    draft.player.hp = 250; draft.player.maxHp = 300;
    draft.player.stamina = 180; draft.player.maxStamina = 200;
    draft.player.mana = 90; draft.player.maxMana = 100;
    draft.player.level = 12; draft.player.xp = 345; draft.player.attributePoints = 7;
    draft.player.attributes.strength = 19;
    draft.player.x = 200; draft.player.y = 300; draft.player.facing = 'left';
    draft.inventory['iron-ingot'] = 44;
    draft.inventory.arrow = 88;
    draft.coins = 9_999;
    draft.unlockedItemIds = ['iron-pick', 'furnace'];

    expect(applyAdminUpdate(state, draft)).toMatchObject({ ok: true });
    expect(state.player).toMatchObject({ hp: 250, maxHp: 300, level: 12, x: 200, y: 300, facing: 'left' });
    expect(state.player.attributes.strength).toBe(19);
    expect(state.inventory['iron-ingot']).toBe(44);
    expect(state.inventory.arrow).toBe(88);
    expect(state.coins).toBe(9_999);
    expect(state.unlockedItemIds).toEqual(['furnace', 'iron-pick']);
  });

  it('keeps local character values separate from shared starting values and Walk Speed', () => {
    const state = createInitialState(321);
    const originalPlayer = structuredClone(state.player);
    const draft = createAdminDraft(state);
    Object.assign(draft.gameBalance.characterDefaults, {
      startingHp: 160,
      startingStamina: 140,
      startingMana: 80,
      startingAttributePoints: 12,
      walkSpeed: 144,
    });
    draft.gameBalance.levelUp.attributePointsPerStat = 4;
    draft.gameBalance.levelUp.spendableAttributePoints = 7;
    draft.gameBalance.levelUp.coins = 25;

    expect(applyAdminUpdate(state, draft)).toMatchObject({ ok: true });
    expect(state.player).toEqual(originalPlayer);
    expect(state.gameBalance.characterDefaults.walkSpeed).toBe(144);
    expect(state.gameBalance.levelUp).toEqual({
      attributePointsPerStat: 4, spendableAttributePoints: 7, coins: 25,
    });
    expect(createPlayerState(state.gameBalance)).toMatchObject({
      hp: 160, maxHp: 160,
      stamina: 140, maxStamina: 140,
      mana: 80, maxMana: 80,
      attributePoints: 12,
    });
  });

  it('publishes exact Bag weight values and Weight Limit', () => {
    const state = createInitialState(654);
    const draft = createAdminDraft(state);
    draft.gameBalance.bagWeight.capacityHundredths = 15_000;
    draft.gameBalance.bagWeight.itemHundredths.berry = 75;
    draft.gameBalance.bagWeight.itemHundredths.stone = 425;

    expect(applyAdminUpdate(state, draft)).toMatchObject({ ok: true });
    expect(state.gameBalance.bagWeight).toMatchObject({
      capacityHundredths: 15_000,
      itemHundredths: { berry: 75, stone: 425 },
    });
  });

  it('uses pushed per-tier crafting, durability, target damage, and wear values', () => {
    const state = createInitialState(456);
    const draft = createAdminDraft(state);
    const axe = draft.gameBalance.tools['wooden-axe'];
    for (const resource of Object.keys(axe.craftCost) as Array<keyof typeof axe.craftCost>) axe.craftCost[resource] = 0;
    axe.maxDurability = 77;
    axe.actionTicks = 9;
    axe.wearPerHit = 2;
    axe.damageByTarget.stone = 13;
    axe.wearMultiplierByTarget.stone = 3;
    draft.gameBalance.objects.stone.minimumToolTier = 1;
    expect(applyAdminUpdate(state, draft).ok).toBe(true);

    expect(craftTool(state, 'wooden-axe')).toMatchObject({ ok: true });
    const tool = state.tools[0]!;
    expect(tool).toMatchObject({ durability: 77, maxDurability: 77 });
    const stone = state.resourceNodes.find((node) => node.kind === 'stone')!;
    state.player.x = stone.x; state.player.y = stone.y;
    expect(gatherNearest(state)).toMatchObject({ ok: true });
    expect(stone.hp).toBe(stone.maxHp - 13);
    expect(tool.durability).toBe(77 - 2 * 2 * 3);
    expect(state.actionCooldownUntilTick).toBe(state.tick + 9);
  });

  it('supports Bare Hands target changes and rejects invalid updates without partial mutation', () => {
    const state = createInitialState(789);
    const hands = createAdminDraft(state);
    hands.gameBalance.hands.damageByTarget.stone = 8;
    hands.gameBalance.objects.stone.minimumToolTier = 0;
    expect(applyAdminUpdate(state, hands).ok).toBe(true);
    const stone = state.resourceNodes.find((node) => node.kind === 'stone')!;
    state.player.x = stone.x; state.player.y = stone.y;
    expect(gatherNearest(state)).toMatchObject({ ok: true });
    expect(stone.hp).toBe(stone.maxHp - 8);

    const invalid = createAdminDraft(state);
    invalid.coins = 1234;
    invalid.player.hp = invalid.player.maxHp + 1;
    expect(applyAdminUpdate(state, invalid)).toMatchObject({ ok: false });
    expect(state.coins).toBe(0);
  });

  it('applies edited raid, raider, and structure values to a live raid', () => {
    const state = createInitialState(4242);
    state.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
    state.buildings.push({ id: 'building-901', definitionId: 'air-purifier', tileX: 11, tileY: 10 });

    const draft = createAdminDraft(state);
    draft.gameBalance.raid.spawnDelaySeconds = 0;
    draft.gameBalance.raid.waveBaseSize = 2;
    draft.gameBalance.raid.waveGrowthTenths = 0;
    draft.gameBalance.raid.waveRatingTenths = 0;
    draft.gameBalance.raiders.scavenger.maxHp = 500;
    draft.gameBalance.structures.wallHp.wood = 999;
    expect(applyGameBalance(state, draft.gameBalance).ok).toBe(true);

    // Cycle 1's danger phase — the first one that is a raid rather than fog.
    state.tick = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * 60 + SAFE_PHASE_SECONDS * 60;
    advanceRaid(state);
    expect(state.raiders).toHaveLength(2);
    // Through the levelled definition: the wave takes the level of the ground
    // the base stands on, so the edited base health is what it scales from.
    expect(state.raiders.every((raider) => raider.maxHp === leveledRaiderDefinition(state, raider).maxHp)).toBe(true);
    expect(state.raiders.every((raider) => raider.maxHp >= 500)).toBe(true);
    expect(structureMaxHp(state.buildings.find((b) => b.definitionId === 'wood-wall')!, state.gameBalance)).toBe(999);
  });

  it('rejects raid values that would make the danger phase unplayable', () => {
    const state = createInitialState(4243);
    for (const mutate of [
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.raid.spawnDelaySeconds = 60; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.raid.dangerPhaseSecondsByThreat.fog = 0; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.raid.waveBaseSize = 99; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.raid.exposureDamagePerSecond = 500; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.raiders.breaker.maxHp = 0; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.creatures.tuftle.dodgeBps = 10_001; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.structures.facilityHp.turret = 0; },
      // A telegraph nobody can see coming, or one still running when the next
      // marker appears, stops the storm being a dodge test at all.
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.storm.telegraphSeconds = 8; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.storm.telegraphSeconds = 9; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.storm.intervalSeconds = 3; },
      // An impact that lands on or after the phase boundary belongs to no event.
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.storm.firstImpactSeconds = 60; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.storm.playerDamage = 80; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.storm.impactRadiusTiles = 0; },
      (draft: ReturnType<typeof createAdminDraft>) => { draft.gameBalance.storm.rewardIronOre = -1; },
    ]) {
      const draft = createAdminDraft(state);
      mutate(draft);
      expect(applyGameBalance(state, draft.gameBalance).ok).toBe(false);
    }
    // Nothing partial ever landed: the shipped default is still in place.
    expect(state.gameBalance.raid.targetPriority).toBe('purifier-last');
    expect(state.gameBalance.storm).toEqual({
      firstImpactSeconds: 8,
      intervalSeconds: 8,
      telegraphSeconds: 3,
      impactRadiusTiles: 2,
      playerDamage: 35,
      rewardEveryStrikes: 3,
      rewardIronOre: 1,
    });
  });

  it('accepts a retuned storm that still fits inside its own danger phase', () => {
    const state = createInitialState(4245);
    const draft = createAdminDraft(state);
    draft.gameBalance.storm.firstImpactSeconds = 12;
    draft.gameBalance.storm.intervalSeconds = 12;
    draft.gameBalance.storm.telegraphSeconds = 5;
    draft.gameBalance.storm.playerDamage = 20;

    expect(applyGameBalance(state, draft.gameBalance).ok).toBe(true);
    expect(state.gameBalance.storm.firstImpactSeconds).toBe(12);
  });

  it('measures the warning window against the raid night, not the fog one', () => {
    const state = createInitialState(4244);
    const draft = createAdminDraft(state);
    draft.gameBalance.raid.dangerPhaseSecondsByThreat = { fog: 30, raid: 90, storm: 60 };
    // Longer than the whole fog night, but it is not the fog night that spawns raiders.
    draft.gameBalance.raid.spawnDelaySeconds = 70;

    expect(applyGameBalance(state, draft.gameBalance).ok).toBe(true);
    expect(state.gameBalance.raid.dangerPhaseSecondsByThreat).toEqual({ fog: 30, raid: 90, storm: 60 });
  });

  it('keeps Local Push separate and applies global resource-object values immediately', () => {
    const state = createInitialState(2468);
    const draft = createAdminDraft(state);
    draft.coins = 50;
    draft.gameBalance.objects.tree.maxHp = 75;
    draft.gameBalance.objects.tree.resource = 'iron-ore';
    const tree = state.resourceNodes.find((node) => node.kind === 'tree')!;
    tree.hp -= 5;

    expect(applyLocalAdminUpdate(state, draft).ok).toBe(true);
    expect(state.coins).toBe(50);
    expect(state.gameBalance.objects.tree.maxHp).toBe(30);

    expect(applyGameBalance(state, draft.gameBalance).ok).toBe(true);
    expect(state.gameBalance.objects.tree.resource).toBe('iron-ore');
    expect(tree).toMatchObject({ maxHp: 75, hp: 70 });
  });
});

describe('blueprint find values', () => {
  const draftFor = () => createAdminDraft(createInitialState(77));

  it('publishes retuned counters to the live game', () => {
    const state = createInitialState(77);
    const draft = createAdminDraft(state);
    draft.gameBalance.blueprints.nodeTargets.tree = 5;
    draft.gameBalance.blueprints.jitterBps = 0;

    expect(applyGameBalance(state, draft.gameBalance)).toMatchObject({ ok: true });
    expect(state.gameBalance.blueprints.nodeTargets.tree).toBe(5);
  });

  it('accepts zero as switching a source off', () => {
    const draft = draftFor();
    draft.gameBalance.blueprints.nodeTargets.metal = 0;
    draft.gameBalance.blueprints.raiderTarget = 0;
    expect(validateGameBalance(draft.gameBalance)).toBeNull();
  });

  it('rejects a counter that cannot be counted', () => {
    const draft = draftFor();
    draft.gameBalance.blueprints.nodeTargets.tree = -1;
    expect(validateGameBalance(draft.gameBalance)).toMatch(/tree per blueprint/);
  });

  it('rejects chances outside basis points', () => {
    for (const mutate of [
      (d: ReturnType<typeof draftFor>) => { d.gameBalance.blueprints.jitterBps = 10_001; },
      (d: ReturnType<typeof draftFor>) => { d.gameBalance.blueprints.rareShareBpsByTheme.marsh = 20_000; },
      (d: ReturnType<typeof draftFor>) => { d.gameBalance.blueprints.stormCacheBlueprintBps = -1; },
    ]) {
      const draft = draftFor();
      mutate(draft);
      expect(validateGameBalance(draft.gameBalance)).not.toBeNull();
    }
  });

  it('rejects tier weights that would leave a roll nowhere to land', () => {
    const draft = draftFor();
    draft.gameBalance.blueprints.raiderTierWeights = { common: 0, rare: 0, epic: 0 };
    expect(validateGameBalance(draft.gameBalance)).toMatch(/cannot all be zero/);
  });
});
