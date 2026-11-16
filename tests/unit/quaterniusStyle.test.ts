import { describe, expect, it } from 'vitest';
import { TOWN_BUILDINGS } from '../../src/content/townBuildings';
import { isRoadPosition } from '../../src/content/roads';
import { describeArea } from '../../src/simulation/areas';
import { terrainAt } from '../../src/simulation/landscape';
import { createInitialState } from '../../src/simulation/state';
import { isInsideBufferedFootprint } from '../../src/three/environmentComposition';
import { regionalPlanting, settlementDoor, settlementModules } from '../../src/three/quaterniusArt';
import { createCreatureRig } from '../../src/three/characterRigs';

describe('shared Quaternius art direction', () => {
  it('keeps each settlement door centred on its saved entrance, including north-facing shops', () => {
    for (const building of TOWN_BUILDINGS.filter(building=>building.id!=='arena')) {
      const modules=settlementModules(building);
      // The leaf hangs on its own hinge so it can swing; the wall leaves its doorway.
      const doorways=modules.filter(module=>module.key==='entrance.wall-door'||module.key==='detail.arch-wall');
      expect(doorways).toHaveLength(1);
      const door=settlementDoor(building);
      const horizontal=building.door.tileY===building.footprint.tileY
        ||building.door.tileY===building.footprint.tileY+building.footprint.tilesHigh-1;
      for (const centre of [door.centreX, doorways[0]!.x]) if(horizontal) expect(centre+building.footprint.tileX+building.footprint.tilesWide/2)
        .toBeCloseTo(building.door.tileX+building.doorWidth/2);
      if(!horizontal) expect(door.centreZ+building.footprint.tileY+building.footprint.tilesHigh/2)
        .toBeCloseTo(building.door.tileY+building.doorWidth/2);
      // The hinge sits on the doorway's jamb, half a doorway from its centre.
      expect(Math.hypot(door.hingeX-door.centreX,door.hingeZ-door.centreZ)).toBeCloseTo(.75);
      expect(modules.some(module=>module.key==='entrance.roof')).toBe(true);
      expect(modules.every(module=>Number.isFinite(module.x)&&Number.isFinite(module.z)&&(module.height??1)>0)).toBe(true);
    }
  });

  it('streams deterministic planting without placing props across roads, water, or service doors', () => {
    const state=createInitialState(42);
    const footprints=TOWN_BUILDINGS.filter(building=>building.areaKey==='0,0').map(building=>building.footprint);
    for(const [x,y] of [[0,0],[1,0],[2,0],[-1,2],[-3,-2]] as const) {
      state.currentArea=describeArea(state.seed,x,y);
      const before=JSON.stringify(state);
      const plants=regionalPlanting(state,6,6,x===0&&y===0?footprints:[]);
      expect(plants).toEqual(regionalPlanting(state,6,6,x===0&&y===0?footprints:[]));
      expect(plants.length).toBeLessThanOrEqual(72);
      for(const plant of plants) {
        expect(isRoadPosition(state.currentArea.key,plant.x,plant.z,.65)).toBe(false);
        expect(terrainAt(state.seed,state.currentArea,Math.floor(plant.x),Math.floor(plant.z))).toBe('ground');
        if(x===0&&y===0)expect(isInsideBufferedFootprint(plant,footprints,.85)).toBe(false);
      }
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it.each(['tuftle','craghopper','glade-stag','snarlfox','masonmole','slingtail','bulwark-boar','quillfinch','mistmoth'] as const)(
    'preserves %s identity in its own articulated model',speciesId=>{
      const rig=createCreatureRig(speciesId);
      expect(rig.speciesId).toBe(speciesId);
      expect(rig.root.name).toBe(`${speciesId}-rig`);
      expect(rig.root.getObjectByName('expressive-eyes')).toBeDefined();
      rig.animate(1000,'walk',false);
      rig.animate(1000,'idle',true);
      expect(Number.isFinite(rig.root.position.y)).toBe(true);
    },
  );
});
