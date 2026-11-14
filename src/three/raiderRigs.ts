import * as THREE from 'three';
import { rigLimb, rigMaterial, rigMesh, rigSphere } from './characterRigs';
import type { RaiderKindId } from '../simulation/state';

/**
 * Articulated 3D raiders for the danger minute.
 *
 * The 2D sprites read at a glance because the player has a very short minute to
 * decide what to shoot, and these rigs keep that same silhouette contract:
 * Scavengers small and hunched, Breakers broad with a maul, Stalkers lean and
 * leaning forward. Palettes are lifted straight from drawRaiders so switching
 * presentation never changes which threat is which.
 *
 * Rigs face +z, matching the player rig, so a heading is `atan2(dx, dz)`.
 */

export type RaiderMotion = 'idle' | 'walk' | 'attack';

export interface RaiderRig {
  readonly root: THREE.Group;
  readonly kindId: RaiderKindId;
  readonly joints: Readonly<Record<string, THREE.Group>>;
  animate(timeMs: number, motion: RaiderMotion, reducedMotion: boolean): void;
}

/**
 * Chest height per kind, in world units. Arrows aim here rather than at the
 * feet, so a shot reads as hitting the body instead of the ground under it.
 */
export const RAIDER_CHEST_HEIGHT: Readonly<Record<RaiderKindId, number>> = Object.freeze({
  scavenger: 0.78,
  breaker: 1.12,
  stalker: 0.96,
  drifter: 0.78,
  poacher: 0.96,
});

function eyes(parent: THREE.Group, color: number, spread: number, y: number, z: number, radius: number): void {
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(radius, 6, 5), material);
    eye.position.set(side * spread, y, z);
    parent.add(eye);
  }
}

/** Small, hunched, and dangerous only in numbers: the body of every wave. */
function scavengerRig(): RaiderRig {
  const root = new THREE.Group();
  root.name = 'scavenger-rig';
  const hide = rigMaterial(0x4a3b32);
  const dark = rigMaterial(0x2a2320);
  const wrap = rigMaterial(0x6b5748);

  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.y = 0.62;
  // Hunched: the whole upper body pitches forward over the legs.
  torso.rotation.x = 0.34;
  const chest = rigMesh(new THREE.CapsuleGeometry(0.22, 0.3, 4, 7), hide);
  chest.position.y = 0.1;
  torso.add(chest);
  root.add(torso);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.52, 0.1);
  head.add(rigSphere(0.17, dark));
  const hood = rigMesh(new THREE.ConeGeometry(0.24, 0.3, 7, 1, true), wrap);
  hood.position.set(0, 0.08, -0.03);
  head.add(hood);
  eyes(head, 0xd8604a, 0.07, 0.01, 0.15, 0.032);
  torso.add(head);

  const leftArm = rigLimb(torso, 'left-arm', -0.24, 0.28, 0.42, dark, 0.065);
  const rightArm = rigLimb(torso, 'right-arm', 0.24, 0.28, 0.42, dark, 0.065);
  const leftLeg = rigLimb(root, 'left-leg', -0.11, 0.6, 0.56, dark, 0.075);
  const rightLeg = rigLimb(root, 'right-leg', 0.11, 0.6, 0.56, dark, 0.075);

  return animated('scavenger', root, { torso, head, leftArm, rightArm, leftLeg, rightLeg }, (time, motion, still) => {
    if (motion === 'attack') {
      const claw = Math.sin(time * 0.026) * still;
      leftArm.rotation.x = -1.1 + claw * 0.5;
      rightArm.rotation.x = -1.1 - claw * 0.5;
      torso.rotation.x = 0.34 + claw * 0.1;
      return;
    }
    const stride = motion === 'walk' ? Math.sin(time * 0.013) * 0.6 : 0;
    leftArm.rotation.x = stride * still;
    rightArm.rotation.x = -stride * still;
    leftLeg.rotation.x = -stride * 0.9 * still;
    rightLeg.rotation.x = stride * 0.9 * still;
    torso.rotation.x = 0.34 + (motion === 'walk' ? Math.abs(Math.sin(time * 0.026)) * 0.05 : Math.sin(time * 0.003) * 0.03) * still;
  });
}

/** Broad and slow, and the reason walls alone are a poor answer. */
function breakerRig(): RaiderRig {
  const root = new THREE.Group();
  root.name = 'breaker-rig';
  const plate = rigMaterial(0x4a3336);
  const dark = rigMaterial(0x231d1e);
  const strap = rigMaterial(0x6d4b45);

  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.y = 0.9;
  const chest = rigMesh(new THREE.CapsuleGeometry(0.3, 0.34, 4, 8), plate);
  chest.scale.set(1.2, 1, 0.88);
  chest.position.y = 0.1;
  torso.add(chest);
  const pauldrons = rigMesh(new THREE.BoxGeometry(0.82, 0.14, 0.34), dark);
  pauldrons.position.y = 0.46;
  torso.add(pauldrons);
  root.add(torso);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.74;
  head.add(rigSphere(0.2, dark));
  // A helmet rim around the skull, not a bowl balanced on top of it.
  const band = rigMesh(new THREE.CylinderGeometry(0.21, 0.23, 0.11, 8), strap);
  band.position.y = 0.02;
  head.add(band);
  eyes(head, 0xe8703f, 0.09, 0.0, 0.18, 0.038);
  torso.add(head);

  const leftArm = rigLimb(torso, 'left-arm', -0.44, 0.44, 0.62, plate, 0.11);
  const rightArm = rigLimb(torso, 'right-arm', 0.44, 0.44, 0.62, plate, 0.11);
  const leftLeg = rigLimb(root, 'left-leg', -0.19, 0.84, 0.82, dark, 0.13);
  const rightLeg = rigLimb(root, 'right-leg', 0.19, 0.84, 0.82, dark, 0.13);

  // The maul: what turns a wall into rubble in a handful of swings.
  const maul = new THREE.Group();
  maul.name = 'maul';
  maul.position.y = -0.5;
  // A pale haft, because a dark one disappears against the Breaker's plate.
  const haft = rigMesh(new THREE.CylinderGeometry(0.035, 0.04, 0.72, 6), rigMaterial(0x8a6440));
  haft.position.y = -0.32;
  const stone = rigMesh(new THREE.BoxGeometry(0.32, 0.24, 0.24), rigMaterial(0x697375, 0.62));
  stone.position.y = -0.68;
  maul.add(haft, stone);
  rightArm.add(maul);

  return animated('breaker', root, { torso, head, leftArm, rightArm, leftLeg, rightLeg, maul }, (time, motion, still) => {
    if (motion === 'attack') {
      // A slow overhead swing: wind all the way up, then drive down.
      const swing = Math.sin(time * 0.009) * still;
      rightArm.rotation.x = -2.2 + swing * 1.5;
      rightArm.rotation.z = -0.18;
      leftArm.rotation.x = -0.7 + swing * 0.4;
      leftLeg.rotation.x = 0;
      rightLeg.rotation.x = 0;
      torso.rotation.x = 0.1 - swing * 0.22;
      return;
    }
    const stride = motion === 'walk' ? Math.sin(time * 0.009) * 0.44 : 0;
    // The maul is carried out in front rather than dragged along the ground.
    rightArm.rotation.x = -0.95 + stride * 0.3 * still;
    rightArm.rotation.z = -0.2;
    leftArm.rotation.x = stride * still;
    leftArm.rotation.z = 0;
    leftLeg.rotation.x = -stride * 0.8 * still;
    rightLeg.rotation.x = stride * 0.8 * still;
    torso.rotation.x = (motion === 'walk' ? Math.abs(Math.sin(time * 0.018)) * 0.05 : Math.sin(time * 0.0025) * 0.02) * still;
    torso.position.y = 0.9 + (motion === 'walk' ? Math.abs(Math.sin(time * 0.018)) * 0.04 * still : 0);
  });
}

/** Fast and fragile: reaches the facilities first if the outer ring is thin. */
function stalkerRig(): RaiderRig {
  const root = new THREE.Group();
  root.name = 'stalker-rig';
  const cloth = rigMaterial(0x35405a);
  const dark = rigMaterial(0x1e2430);
  const trim = rigMaterial(0x4d5c80);

  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.y = 0.8;
  // A sprinter's forward lean, held even when standing still.
  torso.rotation.x = 0.22;
  const chest = rigMesh(new THREE.CapsuleGeometry(0.19, 0.46, 4, 7), cloth);
  chest.position.y = 0.14;
  torso.add(chest);
  root.add(torso);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.62, 0.04);
  head.add(rigSphere(0.16, dark));
  const visor = rigMesh(new THREE.BoxGeometry(0.28, 0.08, 0.22), trim);
  visor.position.y = 0.06;
  head.add(visor);
  eyes(head, 0x9fd8ff, 0.075, 0.06, 0.14, 0.03);
  torso.add(head);

  const leftArm = rigLimb(torso, 'left-arm', -0.25, 0.4, 0.54, dark, 0.06);
  const rightArm = rigLimb(torso, 'right-arm', 0.25, 0.4, 0.54, dark, 0.06);
  const leftLeg = rigLimb(root, 'left-leg', -0.12, 0.78, 0.78, dark, 0.075);
  const rightLeg = rigLimb(root, 'right-leg', 0.12, 0.78, 0.78, dark, 0.075);
  for (const arm of [leftArm, rightArm]) {
    const blade = rigMesh(new THREE.ConeGeometry(0.045, 0.34, 5), rigMaterial(0xb9c7ba, 0.5));
    blade.position.y = -0.68;
    blade.rotation.x = Math.PI;
    arm.add(blade);
  }

  return animated('stalker', root, { torso, head, leftArm, rightArm, leftLeg, rightLeg }, (time, motion, still) => {
    if (motion === 'attack') {
      const slash = Math.sin(time * 0.032) * still;
      leftArm.rotation.x = -1.35 + slash * 0.8;
      rightArm.rotation.x = -1.35 - slash * 0.8;
      torso.rotation.x = 0.22 + slash * 0.12;
      return;
    }
    const stride = motion === 'walk' ? Math.sin(time * 0.02) * 0.82 : 0;
    leftArm.rotation.x = stride * still;
    rightArm.rotation.x = -stride * still;
    leftLeg.rotation.x = -stride * 0.95 * still;
    rightLeg.rotation.x = stride * 0.95 * still;
    torso.rotation.x = 0.22 + (motion === 'walk' ? Math.abs(Math.sin(time * 0.04)) * 0.06 : Math.sin(time * 0.004) * 0.03) * still;
    torso.position.y = 0.8 + (motion === 'walk' ? Math.abs(Math.sin(time * 0.04)) * 0.05 * still : 0);
  });
}

function animated(
  kindId: RaiderKindId,
  root: THREE.Group,
  joints: Record<string, THREE.Group>,
  pose: (timeMs: number, motion: RaiderMotion, still: number) => void,
): RaiderRig {
  return {
    root,
    kindId,
    joints,
    animate(timeMs, motion, reducedMotion) {
      pose(timeMs, motion, reducedMotion ? 0 : 1);
    },
  };
}

export function createRaiderRig(kindId: RaiderKindId): RaiderRig {
  switch (kindId) {
    case 'scavenger': return scavengerRig();
    case 'breaker': return breakerRig();
    case 'stalker': return stalkerRig();
    // Roamers reuse the closest raider build until they get their own rigs.
    case 'drifter': return scavengerRig();
    case 'poacher': return stalkerRig();
  }
}
