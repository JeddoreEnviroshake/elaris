import { describe, expect, it } from 'vitest';
import { SELL_PRICES } from '../../src/content/economy';
import {
  BLUEPRINT_QUALITIES,
  BLUEPRINT_QUALITY_WEIGHTS,
  blueprintQuality,
  blueprintsOfQuality,
} from '../../src/content/blueprintQuality';
import {
  BLUEPRINT_DRAFT_COST,
  BLUEPRINT_SCRAP_PARCHMENT,
  draftBlockedReason,
  draftBlueprint,
  draftBlueprintFromParchment,
  pickDraftedBlueprint,
  tryCarryBlueprint,
} from '../../src/simulation/carriedBlueprints';
import { BLUEPRINT_SALE_PRICE } from '../../src/simulation/npcStock';
import { BLUEPRINT_ITEM_IDS, knowsBlueprint, learnBlueprint } from '../../src/simulation/blueprintKnowledge';
import { elarisPublicWorkbenchCenterPx } from '../../src/simulation/elarisWorkbench';
import { createInitialState, type GameState } from '../../src/simulation/state';

function atBench(parchment = BLUEPRINT_DRAFT_COST): GameState {
  const state = createInitialState(77);
  const center = elarisPublicWorkbenchCenterPx();
  state.player.x = center.x;
  state.player.y = center.y;
  state.inventory['draft-parchment'] = parchment;
  return state;
}

describe('blueprint quality', () => {
  it('gives every blueprint a tier, defaulting to common', () => {
    for (const id of BLUEPRINT_ITEM_IDS) {
      expect(BLUEPRINT_QUALITIES).toContain(blueprintQuality(id));
    }
    expect(blueprintQuality('thatch-wall')).toBe('common');
    expect(blueprintQuality('stone-pick')).toBe('rare');
    expect(blueprintQuality('iron-sword')).toBe('epic');
    expect(blueprintQuality('warehouse')).toBe('legendary');
    // An id nobody tiered is common, not an accidental Legendary.
    expect(blueprintQuality('not-a-blueprint')).toBe('common');
  });

  it('leaves no tier empty, so every weight can actually be drawn', () => {
    for (const quality of BLUEPRINT_QUALITIES) {
      expect(blueprintsOfQuality(quality).length).toBeGreaterThan(0);
    }
  });

  it('makes rarer tiers rarer', () => {
    expect(BLUEPRINT_QUALITY_WEIGHTS.common).toBeGreaterThan(BLUEPRINT_QUALITY_WEIGHTS.rare);
    expect(BLUEPRINT_QUALITY_WEIGHTS.rare).toBeGreaterThan(BLUEPRINT_QUALITY_WEIGHTS.epic);
    expect(BLUEPRINT_QUALITY_WEIGHTS.epic).toBeGreaterThan(BLUEPRINT_QUALITY_WEIGHTS.legendary);
  });
});

describe('the drafting table', () => {
  it('needs a workbench, the parchment, and something left to learn', () => {
    const away = createInitialState(77);
    away.player.x = 10;
    away.player.y = 10;
    away.inventory['draft-parchment'] = BLUEPRINT_DRAFT_COST;
    expect(draftBlockedReason(away)).toBe('Draft at a workbench');

    const poor = atBench(BLUEPRINT_DRAFT_COST - 1);
    expect(draftBlockedReason(poor)).toBe('Need 1 more Draft Parchment');
    expect(draftBlueprintFromParchment(poor)).toMatchObject({ ok: false });
    expect(poor.inventory['draft-parchment']).toBe(BLUEPRINT_DRAFT_COST - 1);

    const complete = atBench();
    for (const id of BLUEPRINT_ITEM_IDS) learnBlueprint(complete, id);
    expect(draftBlockedReason(complete)).toBe('You already know every blueprint');
  });

  it('spends the parchment and hands over paper, not knowledge', () => {
    const state = atBench(BLUEPRINT_DRAFT_COST + 3);
    const result = draftBlueprintFromParchment(state);

    expect(result.ok).toBe(true);
    expect(state.inventory['draft-parchment']).toBe(3);
    expect(state.carriedBlueprints).toHaveLength(1);
    // Drafting chooses that a blueprint appears; it never skips the trip that
    // makes one yours.
    expect(knowsBlueprint(state, state.carriedBlueprints[0]!.blueprintId)).toBe(false);
  });

  it('only ever draws something the player does not own', () => {
    const state = atBench(BLUEPRINT_DRAFT_COST * 6);
    for (let i = 0; i < 6; i += 1) {
      const before = new Set(state.unlockedItemIds);
      const result = draftBlueprintFromParchment(state);
      if (!result.ok) break;
      const drawn = state.carriedBlueprints.at(-1)!.blueprintId;
      expect(before.has(drawn)).toBe(false);
      // Register it so the next draw has to avoid it too.
      learnBlueprint(state, drawn);
      state.carriedBlueprints = [];
    }
  });

  it('weights the roll toward common and away from legendary', () => {
    const state = atBench();
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1_000; i += 1) {
      const id = pickDraftedBlueprint(state, i / 1_000)!;
      const quality = blueprintQuality(id);
      counts[quality] = (counts[quality] ?? 0) + 1;
    }
    expect(counts.common!).toBeGreaterThan(counts.rare!);
    expect(counts.rare!).toBeGreaterThan(counts.epic!);
    expect(counts.epic!).toBeGreaterThan(counts.legendary!);
    // Roughly the authored 50/30/15/5 split across a uniform sweep.
    expect(counts.common!).toBeGreaterThan(400);
    expect(counts.legendary!).toBeGreaterThan(20);
  });

  it('drops exhausted tiers from the roll instead of rerolling them', () => {
    const state = atBench();
    // Learn every Common and Rare; the odds must close over what is left
    // rather than wasting rolls on tiers with nothing in them.
    for (const id of [...blueprintsOfQuality('common'), ...blueprintsOfQuality('rare')]) {
      learnBlueprint(state, id);
    }
    for (let i = 0; i < 200; i += 1) {
      const quality = blueprintQuality(pickDraftedBlueprint(state, i / 200)!);
      expect(['epic', 'legendary']).toContain(quality);
    }
  });

  it('is reproducible from a save rather than rerollable by reloading', () => {
    const first = atBench();
    const second = atBench();
    expect(draftBlueprintFromParchment(first).ok).toBe(true);
    expect(draftBlueprintFromParchment(second).ok).toBe(true);
    expect(first.carriedBlueprints[0]!.blueprintId)
      .toBe(second.carriedBlueprints[0]!.blueprintId);
    // The stream advanced, so the next draw differs.
    expect(first.rngState).not.toBe(createInitialState(77).rngState);
  });

  it('refuses rather than charging when the bag is full', () => {
    const state = atBench();
    while (tryCarryBlueprint(state, 'barn') !== null) { /* fill the bag */ }
    expect(draftBlockedReason(state)).toBe('Bag is full');
    expect(draftBlueprintFromParchment(state)).toMatchObject({ ok: false });
    expect(state.inventory['draft-parchment']).toBe(BLUEPRINT_DRAFT_COST);
  });

  it('reports the tier it drew, so a Legendary reads as one', () => {
    const state = atBench();
    const result = draftBlueprint(state, 0.999);
    expect(result.ok).toBe(true);
    expect(result.drafted!.quality).toBe('legendary');
    expect(result.message).toContain('Legendary');
  });
});

describe('what parchment is worth', () => {
  it('sells for the authored price', () => {
    expect(SELL_PRICES['draft-parchment']).toBe(250);
  });

  it('keeps selling a whole blueprint better than breaking it up', () => {
    // Otherwise Tavi's blueprint row is dead content and scrapping is simply
    // the correct move every time.
    expect(BLUEPRINT_SALE_PRICE)
      .toBeGreaterThan(BLUEPRINT_SCRAP_PARCHMENT * SELL_PRICES['draft-parchment']);
  });

  it('costs more parchment to draft than one scrapped blueprint yields', () => {
    // A duplicate can never pay for its own replacement, or the loop would
    // print blueprints out of nothing.
    expect(BLUEPRINT_DRAFT_COST).toBeGreaterThan(BLUEPRINT_SCRAP_PARCHMENT);
  });
});
