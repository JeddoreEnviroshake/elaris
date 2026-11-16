import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { interiorDefinitionById } from '../../src/content/interiors';
import { TOWN_BUILDINGS } from '../../src/content/townBuildings';
import { ModelLibrary } from '../../src/three/modelLibrary';
import { TownRoom } from '../../src/three/townRooms';

let canvasContextSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  canvasContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    fillStyle: '', font: '', textAlign: 'center', textBaseline: 'middle', strokeStyle: '', lineWidth: 1,
    beginPath: () => {}, roundRect: () => {}, fill: () => {}, stroke: () => {}, fillRect: () => {}, fillText: () => {},
  } as unknown as CanvasRenderingContext2D));
});

afterAll(() => canvasContextSpy.mockRestore());

function frame(x: number, z: number, overrides: Partial<Parameters<TownRoom['update']>[0]> = {}): Parameters<TownRoom['update']>[0] {
  return { playerX: x, playerZ: z, focusedHotspotId: null, timeMs: 1_000, reducedMotion: true, firstPerson: false, ...overrides };
}

describe('walk-in town rooms', () => {
  const models = new ModelLibrary();

  it('furnishes every placement in the world at its own footprint, with no lights of its own', () => {
    for (const building of TOWN_BUILDINGS) {
      const room = new TownRoom(models, building, false);
      const interior = interiorDefinitionById(building.interiorId);
      expect(room.root.position.x).toBe(building.footprint.tileX);
      expect(room.root.position.z).toBe(building.footprint.tileY);
      expect(room.snapshot().propPrefabs).toEqual(interior.props.map((prop) => prop.prefab));
      expect(room.snapshot().npcIds).toEqual(interior.npcSpawns.map((spawn) => spawn.npcId));
      // The renderer shares one room light; a room adding its own would change
      // the scene's light count (and recompile shaders) on every doorway.
      let lights = 0;
      room.root.traverse((child) => { if (child instanceof THREE.Light) lights += 1; });
      expect(lights, `${building.id} at ${building.areaKey}`).toBe(0);
      room.retire();
    }
  });

  it('knows when the player is inside, and shows names only to someone indoors in the overhead view', () => {
    const forge = TOWN_BUILDINGS.find((building) => building.id === 'weaponsmith' && building.areaKey === '0,0')!;
    const room = new TownRoom(models, forge, false);
    const label = room.root.getObjectByName('interior-npc-label')!;
    const inside = { x: forge.footprint.tileX + 3.6, z: forge.footprint.tileY + 3.9 };

    // Beside the building, overhead: the room is under its roof and not drawn.
    room.update(frame(forge.footprint.tileX - 2, forge.footprint.tileY + 3));
    expect(room.isPlayerInside).toBe(false);
    expect(room.root.visible).toBe(false);
    // At eye level it can be seen through the windows.
    room.update(frame(forge.footprint.tileX - 2, forge.footprint.tileY + 3, { firstPerson: true }));
    expect(room.root.visible).toBe(true);
    expect(label.visible).toBe(false);
    // On the doorstep the open door shows the room, overhead too.
    room.update(frame(forge.footprint.tileX + 4, forge.footprint.tileY + forge.footprint.tilesHigh + 0.5));
    expect(room.root.visible).toBe(true);
    expect(label.visible).toBe(false);

    room.update(frame(inside.x, inside.z));
    expect(room.isPlayerInside).toBe(true);
    expect(label.visible).toBe(true);

    room.update(frame(inside.x, inside.z, { firstPerson: true }));
    expect(label.visible).toBe(false);

    // Far away, the furniture is neither drawn nor animated.
    room.update(frame(forge.footprint.tileX + 40, forge.footprint.tileY));
    expect(room.root.visible).toBe(false);
    room.retire();
  });

  it('turns the keeper toward a player who walks up to them', () => {
    const forge = TOWN_BUILDINGS.find((building) => building.id === 'weaponsmith' && building.areaKey === '0,0')!;
    const room = new TownRoom(models, forge, false);
    const mara = room.root.getObjectByName('interior-npc:mara-smith')!;
    const authored = mara.rotation.y;
    const player = { x: forge.footprint.tileX + 3.6, z: forge.footprint.tileY + 3.9 };
    room.update(frame(player.x, player.z, { focusedHotspotId: 'mara-service' }));
    const towardPlayer = Math.atan2(player.x - forge.footprint.tileX - mara.position.x, player.z - forge.footprint.tileY - mara.position.z);
    expect(mara.rotation.y).toBeCloseTo(towardPlayer);
    room.update(frame(player.x, player.z));
    expect(mara.rotation.y).toBeCloseTo(authored);
    room.retire();
  });

  it('leaves a ruin empty', () => {
    const market = TOWN_BUILDINGS.find((building) => building.id === 'market' && building.areaKey === '0,0')!;
    const room = new TownRoom(models, market, true);
    expect(room.interior).toBeNull();
    expect(room.snapshot().npcIds).toEqual([]);
    expect(room.root.getObjectByName('interior-npc:tavi-trader')).toBeUndefined();
    room.retire();
  });
});
