import { describe, expect, it } from 'vitest';
import { interiorContentValidationErrors, validateInteriorDefinition } from '../../src/content/interiorValidation';
import {
  INTERIOR_DEFINITIONS,
  interiorDefinitionById,
  interiorDefinitionForBuilding,
  interiorTileKey,
  reachableInteriorTileKeys,
  type InteriorDefinition,
} from '../../src/content/interiors';
import { TOWN_BUILDINGS, TOWN_BUILDING_BLUEPRINTS } from '../../src/content/townBuildings';

describe('town interior registry', () => {
  it('defines one valid, linked interior for every town building', () => {
    // One room per blueprint, not per placement: a field copy of a service
    // opens the same authored interior as its Elaris original.
    expect(INTERIOR_DEFINITIONS).toHaveLength(TOWN_BUILDING_BLUEPRINTS.length);
    expect(interiorContentValidationErrors()).toEqual([]);
    expect(new Set(INTERIOR_DEFINITIONS.map((interior) => interior.id)).size).toBe(INTERIOR_DEFINITIONS.length);
    expect(new Set(INTERIOR_DEFINITIONS.map((interior) => interior.buildingId)).size).toBe(INTERIOR_DEFINITIONS.length);

    for (const building of TOWN_BUILDINGS) {
      const interior = interiorDefinitionById(building.interiorId);
      expect(interior.buildingId).toBe(building.id);
      expect(interiorDefinitionForBuilding(building.id)).toBe(interior);
      expect(interior.npcSpawns.some((spawn) => spawn.npcId === building.npcId)).toBe(true);
      expect(interior.hotspots.some((hotspot) =>
        hotspot.kind === 'service' && hotspot.npcId === building.npcId && hotspot.service === building.service,
      )).toBe(true);
    }
  });

  it('lets interiors pick only what the camera frames, never its angle', () => {
    for (const interior of INTERIOR_DEFINITIONS) {
      expect(Object.keys(interior.camera), `${interior.id} camera config`).toEqual(['target']);
      expect(interior.camera.target.tileX).toBeLessThan(interior.dimensions.tilesWide);
      expect(interior.camera.target.tileY).toBeLessThan(interior.dimensions.tilesHigh);
    }
  });

  it('makes every exit, hotspot, and NPC mutually reachable from the player spawn', () => {
    for (const interior of INTERIOR_DEFINITIONS) {
      const reachable = reachableInteriorTileKeys(interior);
      expect(reachable.has(interiorTileKey(interior.playerSpawn)), interior.id).toBe(true);
      expect(reachable.has(interiorTileKey(interior.exit)), `${interior.id} exit`).toBe(true);
      for (const hotspot of interior.hotspots) {
        expect(reachable.has(interiorTileKey(hotspot)), `${interior.id} hotspot ${hotspot.id}`).toBe(true);
      }
      for (const spawn of interior.npcSpawns) {
        expect(reachable.has(interiorTileKey(spawn)), `${interior.id} NPC ${spawn.npcId}`).toBe(true);
      }
    }
  });

  it('reports duplicate and unreachable authored content', () => {
    const forge = interiorDefinitionById('weaponsmith-forge');
    expect(interiorContentValidationErrors([forge, forge])).toContain('interior:weaponsmith-forge is duplicated');

    const sealed: InteriorDefinition = {
      ...forge,
      collision: [
        ...forge.collision,
        { id: 'sealed-crossing', tileX: 0, tileY: 7, tilesWide: forge.dimensions.tilesWide, tilesHigh: 1 },
      ],
    };
    const errors = validateInteriorDefinition(sealed);
    expect(errors).toContain('interior:weaponsmith-forge hotspot:mara-service is unreachable from player spawn');
    expect(errors).toContain('interior:weaponsmith-forge NPC:mara-smith is unreachable from player spawn');
  });
});
