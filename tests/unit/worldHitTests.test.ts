import { describe, expect, it } from 'vitest';
import { buildingAtWorld, entityAtWorld } from '../../src/presentation/worldHitTests';
import type { BuildingState } from '../../src/simulation/state';

describe('renderer-independent world picking', () => {
  it('picks the closest entity using world position without render objects', () => {
    const targets = [{ id:'near',x:20,y:20 },{ id:'far',x:30,y:20 }];
    expect(entityAtWorld(targets,22,20)?.id).toBe('near');
    expect(entityAtWorld(targets,100,100)).toBeNull();
  });
  it('honors rotated footprints and topmost overlapping structures', () => {
    const buildings: BuildingState[] = [
      {id:'floor',definitionId:'wood-floor',tileX:40,tileY:40},
      {id:'bench',definitionId:'workbench',tileX:40,tileY:40,rotated:true},
    ];
    expect(buildingAtWorld(buildings,40.5*16,40.5*16)?.id).toBe('bench');
    expect(buildingAtWorld(buildings,40.5*16,41.5*16)?.id).toBe('bench');
    expect(buildingAtWorld(buildings,41.5*16,40.5*16)).toBeNull();
  });
  it('hits boundary edges without blocking the whole adjacent tile', () => {
    const wall: BuildingState = {id:'wall',definitionId:'wood-wall',tileX:40,tileY:40,boundaryEdge:'east'};
    expect(buildingAtWorld([wall],41*16,40.5*16)?.id).toBe('wall');
    expect(buildingAtWorld([wall],40.4*16,40.5*16)).toBeNull();
  });
});
