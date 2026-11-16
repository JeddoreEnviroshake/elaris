import * as THREE from 'three';
import { gameToolDefinition } from '../config/balance';
import type { GameState, ResourceNodeKind } from '../simulation/state';
import { ease, envelope } from './animationMotion';
import { createFirstPersonArm, createFirstPersonTool, type FirstPersonTool, type FirstPersonToolModel,
  type FirstPersonToolTier } from './firstPersonModels';
import type { ThreePresentationState } from './presentationState';
import { releaseArt } from './quaterniusArt';

export interface FirstPersonHandsFrame {
  readonly tool: FirstPersonTool;
  readonly tier: FirstPersonToolTier;
  readonly motion: 'idle' | 'gather' | 'melee' | 'ranged' | 'magic';
  readonly progress: number;
  readonly resourceKind: ResourceNodeKind | null;
  readonly arrowsAvailable: boolean;
  readonly reducedMotion: boolean;
}

/** Use the tool actually equipped, including swords used to harvest and empty hands. */
export function firstPersonHandsFrame(state: GameState, presentation: ThreePresentationState | null): FirstPersonHandsFrame {
  const action = presentation?.playerAction;
  const gathering = presentation?.gathering ?? false;
  const equipped = state.tools.find(tool => tool.instanceId === state.equippedToolId);
  const definition = equipped && (equipped.durability > 0 || gathering || action)
    ? gameToolDefinition(state, equipped.definitionId) : null;
  const tool = action?.kind === 'magic' && definition?.kind !== 'staff' ? 'hands' : definition?.kind ?? 'hands';
  return {
    tool, tier: definition?.tier ?? 'wooden',
    motion: action?.kind ?? (gathering ? 'gather' : 'idle'),
    progress: action?.progress ?? (gathering ? presentation?.gatherProgress ?? 0 : 0),
    resourceKind: presentation?.gatherKind ?? null,
    arrowsAvailable: state.inventory.arrow > 0,
    reducedMotion: presentation?.prefersReducedMotion ?? false,
  };
}

/**
 * A separate close-range scene. Only the wrists and tools animate: neither this
 * camera nor the world camera receives action, movement or idle offsets.
 */
export class FirstPersonHands {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, .02, 4);
  readonly root = new THREE.Group();
  readonly left = createFirstPersonArm(-1);
  readonly right = createFirstPersonArm(1);
  private readonly ambient = new THREE.HemisphereLight(0xdde8d9, 0x5c6650, 2);
  private readonly key = new THREE.DirectionalLight(0xffefd4, 2.5);
  private readonly models = new Map<string, FirstPersonToolModel>();
  private selected: FirstPersonToolModel | null = null;
  private readonly rune = new THREE.Mesh(new THREE.TorusGeometry(.065, .004, 5, 28),
    new THREE.MeshBasicMaterial({ color: 0x9fe5d8, transparent: true, opacity: .7, depthWrite: false }));
  private readonly inverseLook = new THREE.Quaternion();

  constructor() {
    this.root.name = 'first-person.hands';
    this.root.add(this.left.root, this.right.root);
    this.rune.name = 'first-person.casting-rune';
    this.rune.position.set(0, .12, -.065);
    this.left.root.add(this.rune);
    this.key.position.set(-2, 3, 1);
    this.scene.add(this.root, this.ambient, this.key);
    this.root.visible = false;
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // Retain both wrists on portrait phones without changing the world's FOV.
    const fit = .8 * Math.min(1, aspect);
    this.root.scale.set(fit, fit, 1);
    this.root.position.y = -.28 + .27 * fit;
  }

  setVisible(visible: boolean): void { this.root.visible = visible; }

  lightFrom(hemisphere: THREE.HemisphereLight, sun: THREE.DirectionalLight, camera: THREE.Camera): void {
    this.ambient.color.copy(hemisphere.color);
    this.ambient.groundColor.copy(hemisphere.groundColor);
    this.ambient.intensity = hemisphere.intensity;
    this.key.color.copy(sun.color);
    this.key.intensity = sun.intensity * .75;
    this.inverseLook.copy(camera.quaternion).invert();
    this.key.position.copy(sun.position).sub(sun.target.position).applyQuaternion(this.inverseLook);
  }

  update(frame: FirstPersonHandsFrame): void {
    const { tool, motion, reducedMotion } = frame;
    const p = Number.isFinite(frame.progress) ? THREE.MathUtils.clamp(frame.progress, 0, 1) : 0;
    this.root.userData.tool = tool;
    this.root.userData.motion = motion;
    this.root.userData.progress = p;
    this.selectTool(tool, frame.tier);
    const left = this.left.root, right = this.right.root;
    // Deliberately motionless idle, walking and sprinting poses.
    left.position.set(-.29, -.30, -.68); left.rotation.set(.04, .15, .12);
    right.position.set(.30, -.27, -.68); right.rotation.set(.08, -.16, -.12);
    const wind = reducedMotion ? 0 : envelope(p, 0, .20, .46);
    const hit = reducedMotion ? 0 : envelope(p, .20, .47, 1);
    const gather = motion === 'gather';
    const casting = motion === 'magic' || (gather && tool === 'staff');
    const harvest = gather && (frame.resourceKind === 'plant' || frame.resourceKind === 'berry-bush');
    const twoHandPick = tool === 'pick' && (motion === 'idle' || gather);
    this.left.open.visible = casting || (tool === 'hands' && gather);
    this.left.grip.visible = !this.left.open.visible;
    this.right.open.visible = tool === 'hands' && motion !== 'melee';
    this.right.grip.visible = !this.right.open.visible;

    if ((gather || motion === 'melee') && !casting && !reducedMotion) {
      if (tool === 'hands') {
        right.position.add(new THREE.Vector3(-hit * .16, wind * .05 + hit * .07, -hit * .25));
        right.rotation.x -= hit * .48;
        if (gather) {
          left.position.add(new THREE.Vector3(hit * .12, hit * .04, -hit * .18));
          left.rotation.x -= hit * .35;
        }
      } else if (tool === 'sickle' || harvest) {
        right.position.add(new THREE.Vector3(wind * .08 - hit * .28, wind * .04 - hit * .025, -hit * .18));
        right.rotation.set(.12 - hit * .85, -.16 + wind * .42 - hit * .50, -.12 - wind * .30 + hit * .75);
      } else {
        right.position.add(new THREE.Vector3(wind * .10 - hit * .23, wind * .10 - hit * .03, wind * .06 - hit * .24));
        right.rotation.set(.08 + wind * .38 - hit * 1.18, -.16 + wind * .30 - hit * .34, -.12 - wind * .40 + hit * .62);
      }
    }
    if (twoHandPick) {
      left.position.set(0, -.14, .015).applyQuaternion(right.quaternion).add(right.position);
      left.quaternion.copy(right.quaternion);
      left.rotateY(-.35);
    }
    if (tool === 'bow') this.updateBow(frame, p);
    if (casting && !reducedMotion) {
      right.position.add(new THREE.Vector3(-wind * .035 - hit * .07, wind * .06 + hit * .02, wind * .04 - hit * .17));
      right.rotation.x += wind * .17 - hit * .34;
      left.position.add(new THREE.Vector3(wind * .10 + hit * .12, wind * .09 + hit * .15, -hit * .22));
      left.rotation.set(-hit * .55, .15 - hit * .20, .12 - wind * .24);
    }
    this.rune.visible = casting;
    this.rune.material.opacity = reducedMotion ? .45 : .20 + wind * .60 + hit * .15;
    this.rune.scale.setScalar(reducedMotion ? 1 : 1 + wind * .30);
  }

  private selectTool(tool: FirstPersonTool, tier: FirstPersonToolTier): void {
    if (this.selected) this.selected.root.visible = false;
    this.selected = null;
    if (tool === 'hands') return;
    const key = `${tool}:${tier}`;
    let model = this.models.get(key);
    if (!model) {
      model = createFirstPersonTool(tool, tier);
      (tool === 'bow' ? this.left.root : this.right.root).add(model.root);
      this.models.set(key, model);
    }
    model.root.visible = true;
    this.selected = model;
  }

  private updateBow(frame: FirstPersonHandsFrame, p: number): void {
    const model = this.selected;
    if (!model?.string || !model.arrow) return;
    const firing = frame.motion === 'ranged';
    const draw = firing && !frame.reducedMotion ? ease(p / .16) * (1 - ease((p - .16) / .08)) : 0;
    const release = firing && !frame.reducedMotion ? envelope(p, .16, .28, .65) : 0;
    this.left.root.position.set(-.22, -.24 + draw * .04, -.70 - draw * .04);
    this.left.root.rotation.set(.04, -.10, -.18);
    const hold = firing && !frame.reducedMotion ? envelope(p, 0, .16, .85) : 0;
    this.right.root.position.lerp(new THREE.Vector3(-.22, -.24 + draw * .04, -.80 + draw * .18), hold);
    this.right.root.position.x += release * .24;
    this.right.root.position.z += release * .09;
    this.right.root.rotation.set(.05, -.2, -.10);
    const string = model.string.geometry.getAttribute('position') as THREE.BufferAttribute;
    string.setZ(1, -.10 + draw * .22);
    string.needsUpdate = true;
    model.string.geometry.computeBoundingSphere();
    model.arrow.position.z = -.10 + draw * .22;
    model.arrow.visible = frame.arrowsAvailable && (!firing || p < .23 || p > .80);
  }

  dispose(): void { releaseArt(this.scene); this.scene.clear(); this.models.clear(); }
}
