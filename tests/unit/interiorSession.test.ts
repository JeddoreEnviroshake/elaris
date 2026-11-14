import { describe, expect, it } from 'vitest';
import {
  gameplayModeAllowsMovement,
  gameplayModeAllowsWorldInteraction,
  gameplayModeOwnsOverlayInput,
  InteriorSessionController,
} from '../../src/presentation/interiorSession';
import { TILE_SIZE } from '../../src/config/platform';
import { TOWN_BUILDINGS, outsideDoorTile } from '../../src/content/townBuildings';
import { createInitialState } from '../../src/simulation/state';
import { nearestTownBuildingDoor, recoverPlayerOutsideTownDoor, townBuildingAtPlayerDoor } from '../../src/simulation/town';

describe('interior session', () => {
  it('owns a complete enter, dialogue, service, and exit lifecycle', () => {
    const session = new InteriorSessionController();
    expect(session.mode).toEqual({ kind: 'world' });
    expect(session.allowsWorldInteraction).toBe(true);

    session.enter('weaponsmith', { x: 2, y: 6, facing: 'up' });
    expect(session.mode).toEqual({ kind: 'interior', buildingId: 'weaponsmith' });
    expect(session.pose).toEqual({ x: 2, y: 6, facing: 'up' });
    expect(session.transition).toEqual({ kind: 'entering', progress: 0 });
    expect(session.allowsLocalMovement).toBe(false);

    session.updateTransition(0.4);
    expect(session.transition?.progress).toBe(0.4);
    session.completeTransition();
    expect(session.transition).toBeNull();
    expect(session.allowsLocalMovement).toBe(true);

    session.focusHotspot('anvil');
    session.updatePose({ x: 4, y: 3, facing: 'right' });
    expect(session.focusedHotspotId).toBe('anvil');
    expect(session.pose).toEqual({ x: 4, y: 3, facing: 'right' });

    session.beginDialogue('mara-smith');
    expect(session.mode).toEqual({ kind: 'dialogue', buildingId: 'weaponsmith', npcId: 'mara-smith' });
    expect(session.ownsOverlayInput).toBe(true);
    expect(session.allowsLocalMovement).toBe(false);

    session.openService('mara-smith');
    expect(session.mode.kind).toBe('service');
    session.resumeInterior();
    expect(session.mode).toEqual({ kind: 'interior', buildingId: 'weaponsmith' });

    session.beginExit();
    expect(session.transition).toEqual({ kind: 'leaving', progress: 0 });
    session.completeTransition();
    expect(session.mode).toEqual({ kind: 'world' });
    expect(session.pose).toBeNull();
    expect(session.focusedHotspotId).toBeNull();
  });

  it('defines input ownership for every gameplay mode', () => {
    expect(gameplayModeAllowsMovement({ kind: 'world' })).toBe(true);
    expect(gameplayModeAllowsMovement({ kind: 'interior', buildingId: 'market' })).toBe(true);
    expect(gameplayModeAllowsMovement({ kind: 'dialogue', buildingId: 'market', npcId: 'tavi-trader' })).toBe(false);
    expect(gameplayModeAllowsMovement({ kind: 'service', buildingId: 'market', npcId: 'tavi-trader' })).toBe(false);

    expect(gameplayModeAllowsWorldInteraction({ kind: 'world' })).toBe(true);
    expect(gameplayModeAllowsWorldInteraction({ kind: 'interior', buildingId: 'market' })).toBe(false);
    expect(gameplayModeOwnsOverlayInput({ kind: 'dialogue', buildingId: 'market', npcId: 'tavi-trader' })).toBe(true);
    expect(gameplayModeOwnsOverlayInput({ kind: 'interior', buildingId: 'market' })).toBe(false);
  });

  it('rejects invalid transitions and safely recovers transient state to world', () => {
    const session = new InteriorSessionController();
    expect(() => session.beginDialogue('mara-smith')).toThrow('from world mode');
    expect(() => session.updatePose({ x: 0, y: 0, facing: 'down' })).toThrow('from world mode');

    session.enter('market', { x: 1, y: 1, facing: 'down' });
    expect(() => session.enter('tavern', { x: 0, y: 0, facing: 'up' })).toThrow('while market is active');
    expect(() => session.openService('tavi-trader')).toThrow('during an interior transition');
    session.completeTransition();
    session.openService('tavi-trader');

    session.recoverToWorld();
    expect(session.mode).toEqual({ kind: 'world' });
    expect(session.isActive).toBe(false);
    expect(session.transition).toBeNull();
  });

  it('returns defensive snapshots for local pose and transition state', () => {
    const session = new InteriorSessionController();
    session.enter('church', { x: 2, y: 2, facing: 'left' });
    const pose = session.pose as { x: number; y: number };
    const transition = session.transition as { progress: number };
    pose.x = 99;
    transition.progress = 0.9;
    expect(session.pose?.x).toBe(2);
    expect(session.transition?.progress).toBe(0);
  });

  it('recovers a saved doorway position to that building\'s safe exterior tile', () => {
    const state = createInitialState(813);
    const market = TOWN_BUILDINGS.find((building) => building.id === 'market')!;
    state.player.x = (market.door.tileX + 0.5) * TILE_SIZE;
    state.player.y = (market.door.tileY + 0.5) * TILE_SIZE;
    expect(townBuildingAtPlayerDoor(state)?.id).toBe('market');

    expect(recoverPlayerOutsideTownDoor(state)?.id).toBe('market');
    const outside = outsideDoorTile(market);
    expect(state.player.x).toBe((outside.tileX + 0.5) * TILE_SIZE);
    expect(state.player.y).toBe((outside.tileY + 0.5) * TILE_SIZE);
    expect(townBuildingAtPlayerDoor(state)).toBeNull();
    expect(recoverPlayerOutsideTownDoor(state)).toBeNull();
  });

  it('selects a nearby authored door without requiring the player to stand on it', () => {
    const state = createInitialState(813);
    const forge = TOWN_BUILDINGS.find((building) => building.id === 'weaponsmith')!;
    state.player.x = (forge.door.tileX + 0.5) * TILE_SIZE;
    state.player.y = (forge.door.tileY + 1.5) * TILE_SIZE;
    expect(townBuildingAtPlayerDoor(state)).toBeNull();
    expect(nearestTownBuildingDoor(state)?.id).toBe('weaponsmith');
  });
});
