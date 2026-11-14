import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ARCANE_IMPACT_AFTERMATH_TICKS } from '../../src/simulation/arcaneStorm';
import {
  ARCANE_REWARD_COLOR,
  ARCANE_RING_COLOR,
  applyArcaneStrikeFrame,
  arcaneStrikeFrame,
  createArcaneStrikeVisual,
} from '../../src/three/arcaneStormRigs';
import type { ArcaneStrikeState } from '../../src/simulation/state';

function strike(overrides: Partial<ArcaneStrikeState> = {}): ArcaneStrikeState {
  return {
    id: 'strike-1',
    cycleIndex: 4,
    strikeIndex: 0,
    areaKey: '1,0',
    x: 640,
    y: 640,
    telegraphAtTick: 300,
    impactAtTick: 480,
    rewardIronOre: 0,
    resolvedAtTick: null,
    ...overrides,
  };
}

describe('arcane strike presentation', () => {
  it('sweeps the countdown ring inward across exactly the telegraph', () => {
    expect(arcaneStrikeFrame(strike(), 300, false).countdownScale).toBe(1);
    expect(arcaneStrikeFrame(strike(), 390, false).countdownScale).toBeCloseTo(0.5, 5);
    // Never zero: a ring that vanishes a frame early reads as an early impact.
    expect(arcaneStrikeFrame(strike(), 480, false).countdownScale).toBeGreaterThan(0);
  });

  it('replaces the sweep with a still ring that brightens, under reduced motion', () => {
    const early = arcaneStrikeFrame(strike(), 300, true);
    const late = arcaneStrikeFrame(strike(), 470, true);
    expect(late.countdownScale).toBe(early.countdownScale);
    expect(late.countdownOpacity).toBeGreaterThan(early.countdownOpacity);
  });

  it('shows the impact column only after the strike lands, and fades it out', () => {
    const pending = arcaneStrikeFrame(strike(), 470, false);
    expect(pending.landing).toBe(false);
    expect(pending.columnOpacity).toBe(0);

    const landed = arcaneStrikeFrame(strike({ resolvedAtTick: 480 }), 480, false);
    expect(landed.landing).toBe(true);
    expect(landed.columnOpacity).toBeGreaterThan(0);

    const expired = arcaneStrikeFrame(
      strike({ resolvedAtTick: 480 }),
      480 + ARCANE_IMPACT_AFTERMATH_TICKS,
      false,
    );
    expect(expired.columnOpacity).toBe(0);
  });

  it('marks a rewarding strike with the gold ring and an ordinary one violet', () => {
    const plain = createArcaneStrikeVisual(2, false);
    const rewarded = createArcaneStrikeVisual(2, true);
    expect(plain.ring.material.color.getHex()).toBe(ARCANE_RING_COLOR);
    expect(rewarded.ring.material.color.getHex()).toBe(ARCANE_REWARD_COLOR);
  });

  it('applies a frame to the built marker without touching its position', () => {
    const visual = createArcaneStrikeVisual(2, false);
    visual.root.position.set(40, 0, 40);
    applyArcaneStrikeFrame(visual, arcaneStrikeFrame(strike({ resolvedAtTick: 480 }), 480, false));

    expect(visual.column.visible).toBe(true);
    expect(visual.countdown.visible).toBe(false);
    expect(visual.root.position.toArray()).toEqual([40, 0, 40]);
  });

  it('owns geometry and materials that a disposal pass can reach', () => {
    const visual = createArcaneStrikeVisual(2, true);
    const meshes: THREE.Mesh[] = [];
    visual.root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });

    expect(meshes).toHaveLength(3);
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
});
