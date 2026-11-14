import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { NPC_DEFINITIONS } from '../../src/content/npcs';
import { TOWN_BUILDINGS, outsideDoorTile, townBuildingDoorTiles } from '../../src/content/townBuildings';
import { enterWorldArea } from '../../src/simulation/areas';
import { createInitialState } from '../../src/simulation/state';
import { isSolidTownTile, positionPlayerOutsideDoor, townBuildingAtPlayerDoor } from '../../src/simulation/town';
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

  it('detects door entry only in each building’s authored settlement', () => {
    const state = createInitialState(123);
    const market = TOWN_BUILDINGS.find((building) => building.id === 'market')!;
    state.player.x = (market.door.tileX + 0.5) * TILE_SIZE;
    state.player.y = (market.door.tileY + 0.5) * TILE_SIZE;
    expect(townBuildingAtPlayerDoor(state)?.id).toBe('market');
    const secondDoorTile = townBuildingDoorTiles(market)[1]!;
    state.player.x = (secondDoorTile.tileX + 0.5) * TILE_SIZE;
    state.player.y = (secondDoorTile.tileY + 0.5) * TILE_SIZE;
    expect(townBuildingAtPlayerDoor(state)?.id).toBe('market');
    expect(isSolidTownTile(secondDoorTile.tileX, secondDoorTile.tileY)).toBe(false);
    expect(isSolidTownTile(secondDoorTile.tileX + 1, secondDoorTile.tileY)).toBe(true);
    expect(enterWorldArea(state, 1, 0)).toBe(true);
    expect(townBuildingAtPlayerDoor(state)).toBeNull();

    const farm = TOWN_BUILDINGS.find((building) => building.id === 'farm')!;
    state.player.x = (farm.door.tileX + 0.5) * TILE_SIZE;
    state.player.y = (farm.door.tileY + 0.5) * TILE_SIZE;
    expect(state.currentArea.name).toBe('Verdant Reach');
    expect(townBuildingAtPlayerDoor(state)?.id).toBe('farm');
  });

  it('opens the themed interior, wires Market transactions, and leaves outside the door', () => {
    const state = createInitialState(456);
    state.inventory.wood = 3;
    let changed = 0;
    const market = TOWN_BUILDINGS.find((building) => building.id === 'market')!;
    const interior = new NpcServiceOverlay(document.body, state, () => { changed += 1; }, (building) => {
      positionPlayerOutsideDoor(state, building);
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
    const outside = outsideDoorTile(market);
    expect(state.player.x).toBe((outside.tileX + 0.5) * TILE_SIZE);
    expect(state.player.y).toBe((outside.tileY + 0.5) * TILE_SIZE);
    expect(townBuildingAtPlayerDoor(state)).toBeNull();
    interior.destroy();
  });
});
