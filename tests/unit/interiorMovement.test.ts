import { describe, expect, it } from 'vitest';
import { interiorDefinitionById } from '../../src/content/interiors';
import { nearestInteriorHotspot, stepInteriorMovement } from '../../src/presentation/interiorMovement';
import { createGridMovementState, NO_MOVE } from '../../src/simulation/commands';

describe('interior movement', () => {
  const forge = interiorDefinitionById('weaponsmith-forge');

  it('moves through the authored forge floor and updates facing', () => {
    const next = stepInteriorMovement(
      forge,
      { x: 5.5, y: 8.5, facing: 'up' },
      { x: 1, y: 0, slow: false },
      100,
      createGridMovementState(),
    );
    expect(next.x).toBeGreaterThan(5.5);
    expect(next.y).toBe(8.5);
    expect(next.facing).toBe('right');
  });

  it('snaps analog input to one cardinal tile and finishes after release', () => {
    const movement = createGridMovementState();
    const first = stepInteriorMovement(
      forge,
      { x: 5.5, y: 8.5, facing: 'up' },
      { x: 0.55, y: -0.8, slow: false },
      100,
      movement,
    );
    expect(first.x).toBe(5.5);
    expect(first.y).toBeLessThan(8.5);
    expect(first.facing).toBe('up');
    expect(movement.targetX).toBe(5.5);
    expect(movement.targetY).toBe(7.5);

    const finished = stepInteriorMovement(forge, first, NO_MOVE, 1_000, movement);
    expect(finished).toMatchObject({ x: 5.5, y: 7.5, facing: 'up' });
    expect(movement.moving).toBe(false);
  });

  it('does not move through the authored anvil collider', () => {
    const next = stepInteriorMovement(
      forge,
      { x: 5.5, y: 4.5, facing: 'left' },
      { x: -1, y: 0, slow: false },
      100,
      createGridMovementState(),
    );
    expect(next.x).toBe(5.5);
  });

  it('focuses the nearest reachable hotspot', () => {
    expect(nearestInteriorHotspot(forge, { x: 7.5, y: 5.5 })?.id).toBe('mara-service');
    expect(nearestInteriorHotspot(forge, { x: 1.5, y: 8.5 })).toBeNull();
  });
});
