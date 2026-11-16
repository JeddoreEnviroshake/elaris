import { describe, expect, it } from 'vitest';
import { QUEST_DEFINITIONS } from '../../src/content/quests';
import { craftArrows, craftTamingSnare } from '../../src/simulation/supplyCrafting';
import { sellResource } from '../../src/simulation/economy';
import { questViews } from '../../src/simulation/progression';
import { learnBlueprint } from '../../src/simulation/blueprintKnowledge';
import { createInitialState } from '../../src/simulation/state';
import {
  BLUEPRINT_ITEM_IDS, CONSUMABLE_BLUEPRINT_IDS, VARIANT_BLUEPRINT_IDS,
} from '../../src/simulation/blueprintKnowledge';

describe('expanded quest catalog', () => {
  it('contains a unique quest for every permanent unlock across parallel lines', () => {
    const ids = QUEST_DEFINITIONS.map((quest) => quest.id);
    expect(QUEST_DEFINITIONS).toHaveLength(220);
    expect(new Set(ids).size).toBe(ids.length);
    // The unlock line covers what you place or equip and can reach by playing.
    // The handcraft consumables have quests in the crafting line instead, and
    // the variants have none at all by design: no quest can promise a recipe
    // that only exists as a blueprint someone has to find.
    const excluded = new Set<string>([...CONSUMABLE_BLUEPRINT_IDS, ...VARIANT_BLUEPRINT_IDS]);
    const placeableOrEquippable = BLUEPRINT_ITEM_IDS.filter((id) => !excluded.has(id));
    for (const unlockId of placeableOrEquippable) expect(ids).toContain(`unlock-${unlockId}`);
    expect(new Set(QUEST_DEFINITIONS.map((quest) => quest.category))).toEqual(new Set([
      'main', 'unlocks', 'crafting', 'creatures', 'building', 'facilities', 'economy', 'exploration',
    ]));
  });

  it('links the first expedition arc to its authored map destinations', () => {
    const state = createInitialState(19);
    const journey = ['missing-farm-shipments', 'blights-trail', 'news-for-elaris'];
    expect(QUEST_DEFINITIONS.filter((quest) => journey.includes(quest.id)).map((quest) => quest.mapAreaKey))
      .toEqual(['1,0', '2,0', '0,0']);

    state.questProgress.areaKeysVisited.push('1,0');
    expect(questViews(state).find((quest) => quest.id === journey[0])?.complete).toBe(true);
    state.questProgress.areaKeysVisited.push('2,0');
    state.currentArea = { ...state.currentArea, key: '2,0', x: 2, name: 'Sylvaren', theme: 'forest' };
    expect(questViews(state).find((quest) => quest.id === journey[1])?.complete).toBe(true);
    expect(questViews(state).find((quest) => quest.id === journey[2])?.complete).toBe(false);
    state.currentArea = { ...state.currentArea, key: '0,0', x: 0, name: 'Elaris', theme: 'elaris' };
    expect(questViews(state).find((quest) => quest.id === journey[2])?.complete).toBe(true);
  });

  it('tracks consumable crafting and sales as lifetime quest progress', () => {
    const state = createInitialState(4);
    learnBlueprint(state, 'taming-snare');
    learnBlueprint(state, 'arrow');
    state.inventory.wood = 3;
    state.inventory.fiber = 2;
    state.inventory.stone = 1;
    expect(craftTamingSnare(state).ok).toBe(true);
    expect(craftArrows(state).ok).toBe(true);
    expect(state.questProgress.crafted).toMatchObject({ 'taming-snare': 1, arrows: 3 });
    expect(questViews(state).find((quest) => quest.id === 'craft-snare')?.complete).toBe(true);

    state.inventory.wood = 25;
    expect(sellResource(state, 'wood', 25).ok).toBe(true);
    expect(state.questProgress.resourcesSold.wood).toBe(25);
    expect(questViews(state).find((quest) => quest.id === 'timber-merchant')?.complete).toBe(true);
  });

  it('initializes durable progress for a new character', () => {
    const progress = createInitialState(9).questProgress;
    expect(progress.areaKeysVisited).toEqual(['0,0']);
    expect(progress.areaThemesVisited).toEqual(['elaris']);
    expect(progress.creatureDefeats).toEqual({
      tuftle: 0, craghopper: 0, 'glade-stag': 0, snarlfox: 0,
      masonmole: 0, 'bulwark-boar': 0, quillfinch: 0, mistmoth: 0, slingtail: 0,
    });
  });
});
