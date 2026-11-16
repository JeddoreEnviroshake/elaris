import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { NPC_DEFINITIONS } from '../../src/content/npcs';
import { TOWN_BUILDINGS } from '../../src/content/townBuildings';
import { shellThreshold, townBuildingShell } from '../../src/content/interiors';
import { enterWorldArea } from '../../src/simulation/areas';
import { createInitialState } from '../../src/simulation/state';
import { townBuildingAroundPlayer } from '../../src/simulation/town';
import { NpcServiceOverlay } from '../../src/ui/npcServiceOverlay';

describe('town services', () => {
  it('keeps NPC identity content without overworld positions', () => {
    expect(NPC_DEFINITIONS.map((npc) => npc.service)).toEqual([
      'weaponsmith', 'farm', 'market', 'church', 'armoury', 'magic-shop', 'tavern', 'arena',
    ]);
    expect(new Set(NPC_DEFINITIONS.map((npc) => npc.id)).size).toBe(NPC_DEFINITIONS.length);
    expect(NPC_DEFINITIONS.every((npc) => !('x' in npc) && !('y' in npc))).toBe(true);
    expect(NPC_DEFINITIONS.every((npc) => npc.interactionRadiusTiles > 0)).toBe(true);
    expect(new Set(NPC_DEFINITIONS.map((npc) => npc.dialogueId)).size).toBe(NPC_DEFINITIONS.length);
    expect(NPC_DEFINITIONS.every((npc) => npc.appearance.description.length > 20)).toBe(true);
    expect(NPC_DEFINITIONS.every((npc) => npc.barks.arrival.length > 0 && npc.barks.nearby.length > 0)).toBe(true);
  });

  it('offers only the skill points assigned to each training building', () => {
    const state = createInitialState(789);
    state.coins = 800;
    const interior = new NpcServiceOverlay(document.body, state, () => {}, () => {});
    const expectations = [
      ['weaponsmith', ['Strength']],
      ['church', ['Luck', 'Health', 'Health Regeneration']],
      ['armoury', ['Dexterity', 'Carry Weight']],
      ['magic-shop', ['Magic']],
      ['tavern', ['Mana', 'Mana Regeneration']],
      ['arena', ['Stamina', 'Stamina Regeneration', 'Speed']],
    ] as const;

    for (const [buildingId, attributes] of expectations) {
      interior.open(TOWN_BUILDINGS.find((building) => building.id === buildingId)!);
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('[aria-label^="Purchase "][aria-label$=" skill point"]')];
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(
        attributes.map((attribute) => `Purchase ${attribute} skill point`),
      );
    }

    const church = TOWN_BUILDINGS.find((building) => building.id === 'church')!;
    interior.open(church);
    document.querySelector<HTMLButtonElement>('[aria-label="Purchase Health skill point"]')!.click();
    expect(state.coins).toBe(700);
    expect(state.player.attributes.health).toBe(1);
    expect(state.player.maxHp).toBe(110);
    interior.destroy();
  });

  it('sells the Magic Staff from the Magic Shop for 3,000 coins', () => {
    const state = createInitialState(790);
    state.coins = 3_000;
    let changed = 0;
    const interior = new NpcServiceOverlay(document.body, state, () => { changed += 1; }, () => {});
    interior.open(TOWN_BUILDINGS.find((building) => building.id === 'magic-shop')!);

    expect(document.body.textContent).toContain('Magic Staff · 3000 coins');
    const purchase = document.querySelector<HTMLButtonElement>('[aria-label="Purchase Magic Staff"]')!;
    expect(purchase.disabled).toBe(false);
    purchase.click();

    expect(state.coins).toBe(0);
    expect(state.tools[0]?.definitionId).toBe('magic-staff');
    expect(changed).toBe(1);
    expect(document.body.textContent).toContain('Purchased and equipped Magic Staff');
    interior.destroy();
  });

  it('finds the player inside a building only in that building’s own settlement', () => {
    const state = createInitialState(123);
    const market = TOWN_BUILDINGS.find((building) => building.id === 'market')!;
    const inside = (building: typeof market): void => {
      const threshold = shellThreshold(townBuildingShell(building));
      state.player.x = Math.round((building.footprint.tileX + threshold.x) * TILE_SIZE);
      state.player.y = Math.round((building.footprint.tileY + threshold.y) * TILE_SIZE);
    };
    inside(market);
    expect(townBuildingAroundPlayer(state)?.id).toBe('market');
    // The same spot in another area is open field.
    expect(enterWorldArea(state, 1, 0)).toBe(true);
    inside(market);
    expect(townBuildingAroundPlayer(state)).toBeNull();

    const farm = TOWN_BUILDINGS.find((building) => building.id === 'farm')!;
    inside(farm);
    expect(state.currentArea.name).toBe('Verdant Reach');
    expect(townBuildingAroundPlayer(state)?.id).toBe('farm');
  });

  it('opens the themed service, wires Market transactions, and leaves the player at the counter', () => {
    const state = createInitialState(456);
    state.inventory.wood = 3;
    let changed = 0;
    let closedFor: string | null = null;
    const market = TOWN_BUILDINGS.find((building) => building.id === 'market')!;
    const before = { x: state.player.x, y: state.player.y };
    const interior = new NpcServiceOverlay(document.body, state, () => { changed += 1; }, (building) => {
      closedFor = building.id;
    });
    interior.open(market);
    const dialog = document.querySelector('[role="dialog"]');
    expect(interior.isOpen).toBe(true);
    expect(dialog?.getAttribute('aria-label')).toBe('Market service');
    expect((dialog as HTMLElement | null)?.dataset.interiorId).toBe('elaris-market');
    expect(dialog?.textContent).toContain('Tavi');
    (document.querySelector('[aria-label="Sell all wood"]') as HTMLButtonElement).click();
    expect(state.inventory.wood).toBe(0);
    expect(state.coins).toBe(6);
    expect(changed).toBe(1);
    interior.close();
    // Walk-in shops: closing the panel moves nobody.
    expect(closedFor).toBe('market');
    expect(state.player).toMatchObject(before);
    interior.destroy();
  });
});
