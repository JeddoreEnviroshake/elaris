import { describe, expect, it } from 'vitest';
import {
  DANGER_PRESENTATION,
  dangerSafeCells,
  dangerSafeRects,
  purifierProtectedCells,
  purifierProtectedRects,
} from '../../src/scenes/dangerPresentation';
import { createInitialState } from '../../src/simulation/state';
import { enclosedEnvironment } from './helpers/buildings';

describe('danger presentation', () => {
  it('uses a dark night palette for raids rather than the poison-green palette', () => {
    expect(DANGER_PRESENTATION.raid.baseColor).toBe(0x050913);
    expect(DANGER_PRESENTATION.raid.baseColor).not.toBe(DANGER_PRESENTATION.fog.baseColor);
    expect(DANGER_PRESENTATION.raid.wispColors).not.toEqual(DANGER_PRESENTATION.fog.wispColors);
  });

  it('gives the storm a violet palette of its own', () => {
    expect(DANGER_PRESENTATION.storm.baseColor).not.toBe(DANGER_PRESENTATION.fog.baseColor);
    expect(DANGER_PRESENTATION.storm.baseColor).not.toBe(DANGER_PRESENTATION.raid.baseColor);
    expect(DANGER_PRESENTATION.storm.wispColors).not.toEqual(DANGER_PRESENTATION.raid.wispColors);
    // Lighter than a raid night: the player has to read the ground through it.
    expect(DANGER_PRESENTATION.storm.baseAlpha).toBeLessThan(DANGER_PRESENTATION.raid.baseAlpha);
  });

  it('punches nothing the player built out of a storm', () => {
    const state = createInitialState(654);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    state.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
    state.buildings.push({ id: 'purifier', definitionId: 'air-purifier', tileX: 11, tileY: 10 });

    // A purified, enclosed room is safe from both other threats and from none
    // of this one, so the wash covers it exactly like open ground.
    expect(dangerSafeCells(state, 'fog')).toContain('11,10');
    expect(dangerSafeCells(state, 'raid')).toContain('11,10');
    expect(dangerSafeCells(state, 'storm')).toEqual([]);
  });

  it('still clears Elaris during a storm, because the sanctuary does hold', () => {
    const state = createInitialState(655);
    const safe = dangerSafeCells(state, 'storm');
    expect(safe).toContain('80,82');
    expect(safe).not.toContain('55,82');
  });

  it('punches every enclosed room out on raid night but requires purification in fog', () => {
    const state = createInitialState(123);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    state.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');

    expect(dangerSafeCells(state, 'raid')).toContain('11,10');
    expect(dangerSafeCells(state, 'fog')).not.toContain('11,10');

    state.buildings.push({ id: 'purifier', definitionId: 'air-purifier', tileX: 11, tileY: 10 });
    expect(dangerSafeCells(state, 'fog')).toContain('11,10');
  });

  it('keeps Elaris town clear while leaving nearby unsafe ground affected', () => {
    const state = createInitialState(456);
    const safe = dangerSafeCells(state, 'raid');
    expect(safe).toContain('80,82');
    expect(safe).not.toContain('55,82');
  });

  it('does not change the world mask when the player steps into safety', () => {
    const state = createInitialState(789);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    state.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
    state.player.x = 2;
    state.player.y = 2;
    const outside = dangerSafeCells(state, 'raid');

    state.player.x = 11 * 16 + 8;
    state.player.y = 10 * 16 + 8;
    expect(dangerSafeCells(state, 'raid')).toEqual(outside);
  });

  it('merges adjacent safe cells into compact strips for the 3D mask', () => {
    const state = createInitialState(321);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    state.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
    expect(dangerSafeRects(state, 'raid')).toEqual([
      { tileX: 10, tileY: 10, tilesWide: 3, tilesHigh: 1 },
      { tileX: 10, tileY: 11, tilesWide: 3, tilesHigh: 1 },
    ]);
  });

  it('uses the same outdoor 3x3 coverage for fog masking and the blue floor cue', () => {
    const state = createInitialState(322);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    state.buildings = [{ id: 'purifier-outside', definitionId: 'air-purifier', tileX: 20, tileY: 20 }];

    expect(purifierProtectedCells(state)).toEqual(dangerSafeCells(state, 'fog'));
    expect(purifierProtectedRects(state)).toEqual([
      { tileX: 19, tileY: 19, tilesWide: 3, tilesHigh: 1 },
      { tileX: 19, tileY: 20, tilesWide: 3, tilesHigh: 1 },
      { tileX: 19, tileY: 21, tilesWide: 3, tilesHigh: 1 },
    ]);
  });
});
