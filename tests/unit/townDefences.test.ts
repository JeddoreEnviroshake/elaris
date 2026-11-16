import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import {
  PERMANENT_AIR_PURIFIER,
  PERMANENT_PURIFIER_RADIUS_TILES,
  TOWN_AIR_PURIFIERS,
  TOWN_PERIMETER_POINTS,
  TOWN_PERIMETER_SEGMENTS,
  isWithinTownSafeZoneWorldPosition,
  townFenceBlocksWorldMove,
} from '../../src/content/townDefences';
import { createInitialState } from '../../src/simulation/state';
import { ELARIS_LAST_SAFE_LEVEL, hasElarisFallen } from '../../src/simulation/elarisFall';
import { isPlayerEnclosed, isPlayerSheltered, respawnDestinations } from '../../src/simulation/survivalCycle';
import { resolveTownMovement } from '../../src/simulation/town';
import { createGridMovementState, stepMovement } from '../../src/simulation/commands';
import { spawnRaidersForCurrentArea } from '../../src/simulation/raids';
import { enclosedEnvironment } from './helpers/buildings';

const px = (tile: number): number => tile * TILE_SIZE;

describe('Elaris town defences', () => {
  it('connects the requested perimeter with three traversable gates', () => {
    expect(TOWN_PERIMETER_POINTS).toEqual([
      { x: 61, y: 70 }, { x: 110, y: 70 }, { x: 110, y: 92 },
      { x: 87, y: 92 }, { x: 87, y: 103 }, { x: 63, y: 103 },
    ]);
    for (let index = 1; index < TOWN_PERIMETER_SEGMENTS.length; index += 1) {
      expect(TOWN_PERIMETER_SEGMENTS[index - 1]!.end).toEqual(TOWN_PERIMETER_SEGMENTS[index]!.start);
    }
    expect(TOWN_PERIMETER_SEGMENTS.at(-1)!.end).toEqual(TOWN_PERIMETER_SEGMENTS[0]!.start);
    expect(TOWN_PERIMETER_SEGMENTS.filter((segment) => segment.kind === 'gate')).toEqual([
      { start: { x: 103.5, y: 70 }, end: { x: 105.5, y: 70 }, kind: 'gate' },
      { start: { x: 110, y: 84 }, end: { x: 110, y: 86 }, kind: 'gate' },
      { start: { x: 62, y: 87 }, end: { x: 62, y: 83 }, kind: 'gate' },
    ]);
  });

  it('uses non-overlapping two-space fence pieces around the town', () => {
    const fences = TOWN_PERIMETER_SEGMENTS.filter((segment) => segment.kind === 'fence');
    // Previously there were 160 near-unit visual pieces, causing every
    // two-space model to overlap its neighbors. The same route now needs only
    // 80 fence instances (plus the three gates).
    expect(fences).toHaveLength(80);
    for (const segment of fences) {
      const gridSpan = Math.max(
        Math.abs(segment.end.x - segment.start.x),
        Math.abs(segment.end.y - segment.start.y),
      );
      expect(gridSpan).toBeGreaterThan(0);
      expect(gridSpan).toBeLessThanOrEqual(2);
    }

    // Full pieces advance by two grid spaces. Odd-length authored runs may end
    // in one short piece, but consecutive pieces only meet at their endpoints.
    expect(fences.filter((segment) => Math.max(
      Math.abs(segment.end.x - segment.start.x),
      Math.abs(segment.end.y - segment.start.y),
    ) === 2)).toHaveLength(75);
  });

  it('blocks fence crossings while allowing both requested gates', () => {
    expect(townFenceBlocksWorldMove(px(100.5), px(69.5), px(100.5), px(70.5))).toBe(true);
    expect(townFenceBlocksWorldMove(px(104.5), px(69.5), px(104.5), px(70.5))).toBe(false);
    expect(townFenceBlocksWorldMove(px(104), px(69), px(104), px(70))).toBe(false);
    expect(townFenceBlocksWorldMove(px(105), px(69), px(105), px(70))).toBe(false);
    expect(townFenceBlocksWorldMove(px(109.5), px(85), px(110.5), px(85))).toBe(false);
    expect(townFenceBlocksWorldMove(px(109), px(84), px(110), px(84))).toBe(false);
    expect(townFenceBlocksWorldMove(px(109), px(86), px(110), px(86))).toBe(false);
    expect(townFenceBlocksWorldMove(px(60.5), px(75.5), px(61.5), px(75.5))).toBe(true);
    expect(townFenceBlocksWorldMove(px(61.5), px(83.5), px(62.5), px(83.5))).toBe(false);
    expect(townFenceBlocksWorldMove(px(61), px(83), px(62), px(83))).toBe(false);
    expect(townFenceBlocksWorldMove(px(61), px(84), px(62), px(84))).toBe(false);
    expect(townFenceBlocksWorldMove(px(61), px(86), px(62), px(86))).toBe(false);
    // The frame's outer lanes stay fenced.
    expect(townFenceBlocksWorldMove(px(61.5), px(82.5), px(62.5), px(82.5))).toBe(true);
    expect(townFenceBlocksWorldMove(px(61.5), px(87.5), px(62.6), px(87.5))).toBe(true);

    const state = createInitialState(123);
    expect(resolveTownMovement(state, px(100.5), px(69.5), px(100.5), px(70.5)).y).toBe(px(69.5));
    expect(resolveTownMovement(state, px(104.5), px(69.5), px(104.5), px(70.5)).y).toBe(px(70.5));
    expect(resolveTownMovement(state, px(109.5), px(85), px(110.5), px(85)).x).toBe(px(110.5));
  });

  it('clears both panel lanes at every gate while keeping adjacent fences solid', () => {
    for (const gate of TOWN_PERIMETER_SEGMENTS.filter(segment => segment.kind === 'gate')) {
      const dx = gate.end.x - gate.start.x, dy = gate.end.y - gate.start.y;
      // Each gate is as wide as the road through it: two spaces, or four on
      // the west entrance's main road.
      expect([2, 4]).toContain(Math.hypot(dx, dy));
      for (const fraction of [.125, .375, .625, .875]) {
        const x = gate.start.x + dx * fraction, y = gate.start.y + dy * fraction;
        const nx = dy / 4, ny = -dx / 4;
        expect(townFenceBlocksWorldMove(px(x - nx), px(y - ny), px(x + nx), px(y + ny))).toBe(false);
        expect(townFenceBlocksWorldMove(px(x + nx), px(y + ny), px(x - nx), px(y - ny))).toBe(false);
      }
      for (const fraction of [-.1, 1.1]) {
        const x = gate.start.x + dx * fraction, y = gate.start.y + dy * fraction;
        expect(townFenceBlocksWorldMove(px(x - dy / 4), px(y + dx / 4), px(x + dy / 4), px(y - dx / 4))).toBe(true);
      }
    }
  });

  it('lets normal player movement cross both gates in either direction', () => {
    const crossGate = (
      from: { x: number; y: number },
      intent: { x: number; y: number; slow: boolean },
    ) => {
      const state = createInitialState(123);
      state.player.x = px(from.x);
      state.player.y = px(from.y);
      stepMovement(state, intent, 1_000, createGridMovementState());
      return { x: state.player.x / TILE_SIZE, y: state.player.y / TILE_SIZE };
    };

    expect(crossGate({ x: 104.5, y: 69.5 }, { x: 0, y: 1, slow: false })).toEqual({ x: 104.5, y: 70.5 });
    expect(crossGate({ x: 104.5, y: 70.5 }, { x: 0, y: -1, slow: false })).toEqual({ x: 104.5, y: 69.5 });
    expect(crossGate({ x: 61.5, y: 83.5 }, { x: 1, y: 0, slow: false })).toEqual({ x: 62.5, y: 83.5 });
    expect(crossGate({ x: 62.5, y: 83.5 }, { x: -1, y: 0, slow: false })).toEqual({ x: 61.5, y: 83.5 });
    // Default characters retain an integer tile offset, so these endpoint
    // lanes are the ones exercised during ordinary play.
    expect(crossGate({ x: 104, y: 69 }, { x: 0, y: 1, slow: false })).toEqual({ x: 104, y: 70 });
    expect(crossGate({ x: 105, y: 69 }, { x: 0, y: 1, slow: false })).toEqual({ x: 105, y: 70 });
    expect(crossGate({ x: 109, y: 85 }, { x: 1, y: 0, slow: false })).toEqual({ x: 110, y: 85 });
    expect(crossGate({ x: 110, y: 85 }, { x: -1, y: 0, slow: false })).toEqual({ x: 109, y: 85 });
    expect(crossGate({ x: 61, y: 83 }, { x: 1, y: 0, slow: false })).toEqual({ x: 62, y: 83 });
    expect(crossGate({ x: 61, y: 84 }, { x: 1, y: 0, slow: false })).toEqual({ x: 62, y: 84 });
  });

  it('places two municipal purifiers inside a safe zone from fog and raids', () => {
    expect(TOWN_AIR_PURIFIERS).toHaveLength(2);
    expect(TOWN_AIR_PURIFIERS.every((purifier) =>
      isWithinTownSafeZoneWorldPosition(px(purifier.x + 0.5), px(purifier.y + 0.5)))).toBe(true);

    const state = createInitialState(456);
    state.player.x = px(80.5);
    state.player.y = px(82.5);
    expect(isPlayerSheltered(state)).toBe(true);
    expect(isPlayerEnclosed(state)).toBe(true);

    state.player.x = px(55.5);
    state.player.y = px(82.5);
    expect(isPlayerSheltered(state)).toBe(false);
    expect(isPlayerEnclosed(state)).toBe(false);
  });

  it('keeps the permanent purifier breathing after Elaris falls', () => {
    expect(PERMANENT_AIR_PURIFIER).toEqual({ x: 69, y: 90 });

    const state = createInitialState(4242);
    state.player.level = ELARIS_LAST_SAFE_LEVEL + 1;
    expect(hasElarisFallen(state)).toBe(true);

    // The ruins themselves are open ground: standing anywhere else inside the
    // old perimeter is exposure, purifier or not.
    state.player.x = px(80.5);
    state.player.y = px(82.5);
    expect(isPlayerSheltered(state)).toBe(false);

    // Its own tile and the far edge of its reach both save a roaming player.
    for (const tile of [
      { x: PERMANENT_AIR_PURIFIER.x, y: PERMANENT_AIR_PURIFIER.y },
      { x: PERMANENT_AIR_PURIFIER.x + PERMANENT_PURIFIER_RADIUS_TILES, y: PERMANENT_AIR_PURIFIER.y },
      { x: PERMANENT_AIR_PURIFIER.x, y: PERMANENT_AIR_PURIFIER.y - PERMANENT_PURIFIER_RADIUS_TILES },
    ]) {
      state.player.x = px(tile.x + 0.5);
      state.player.y = px(tile.y + 0.5);
      expect(isPlayerSheltered(state)).toBe(true);
      // Clean air is not a wall; a raid night still needs an enclosure.
      expect(isPlayerEnclosed(state)).toBe(false);
    }

    state.player.x = px(PERMANENT_AIR_PURIFIER.x + PERMANENT_PURIFIER_RADIUS_TILES + 1.5);
    state.player.y = px(PERMANENT_AIR_PURIFIER.y + 0.5);
    expect(isPlayerSheltered(state)).toBe(false);

    // And the sanctuary waystone respawns you inside that air.
    const sanctuary = respawnDestinations(state).find((destination) => destination.kind === 'elaris');
    expect(sanctuary?.safe).toBe(true);
  });

  it('excludes protected town construction from Night Raid targets', () => {
    const state = createInitialState(789);
    state.buildings = [
      ...enclosedEnvironment(78, 81, 3, 2, 'indoor'),
      { id: 'town-test-purifier', definitionId: 'air-purifier', tileX: 79, tileY: 81 },
      { id: 'town-test-bed', definitionId: 'bed', tileX: 79, tileY: 82 },
    ];
    expect(spawnRaidersForCurrentArea(state)).toBe(false);
    expect(state.raiders).toHaveLength(0);
  });
});
