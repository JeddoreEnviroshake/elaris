import * as THREE from 'three';
import { buildWarden } from './playerModel';
import { createSculptedCreature } from './creatureModels';
import { Sculpt, surface, type SculptDetail } from './characterSculpt';
import { WardenAnimator } from './playerAnimation';
import type { AnimationFrame } from './animationMotion';
import type { ResourceNodeKind, SpeciesId } from '../simulation/state';

export type PlayerMotion = 'idle' | 'ready' | 'walk' | 'run' | 'gather' | 'ride' | 'melee' | 'ranged' | 'cast' | 'throw' | 'hit' | 'dodge' | 'defeat' | 'celebrate';
export type CreatureMotion = 'idle' | 'walk' | 'run' | 'alert' | 'attack' | 'hit' | 'dodge' | 'defeat' | 'capture' | 'assist';
export type GatherToolKind = 'axe' | 'pickaxe' | 'sickle' | 'staff' | 'bow' | 'hands';

export interface PlayerRig {
  readonly root: THREE.Group;
  readonly joints: Readonly<{
    torso: THREE.Group;
    head: THREE.Group;
    leftArm: THREE.Group;
    rightArm: THREE.Group;
    leftLeg: THREE.Group;
    rightLeg: THREE.Group;
    toolHand: THREE.Group;
    hips:THREE.Group;leftElbow:THREE.Group;rightElbow:THREE.Group;
    leftKnee:THREE.Group;rightKnee:THREE.Group;leftAnkle:THREE.Group;rightAnkle:THREE.Group;
  }>;
  setGatherTool(kind: GatherToolKind): void;
  replaceGatherTool(kind: Exclude<GatherToolKind, 'hands'>, model: THREE.Group): void;
  animate(timeMs: number, motion: PlayerMotion, reducedMotion: boolean, frame?:AnimationFrame): void;
}

export interface PlayerRigPalette {
  readonly cloth?: number;
  readonly leather?: number;
  readonly skin?: number;
  readonly boot?: number;
  readonly cloak?: number;
}

export interface CreatureRig {
  readonly root: THREE.Group;
  readonly speciesId: SpeciesId;
  readonly joints: Readonly<Record<string, THREE.Group>>;
  animate(timeMs: number, motion: CreatureMotion, reducedMotion: boolean, frame?:AnimationFrame): void;
}

const standard = (color: number, roughness = 0.86): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
  color, roughness, flatShading: false, dithering: true,
});

const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
};

const sphere = (radius: number, material: THREE.Material): THREE.Mesh => mesh(new THREE.SphereGeometry(radius, radius < .15 ? 8 : 12, 8), material);

/**
 * Shared rig primitives. Exported so sibling rig modules (raiders) build their
 * base shapes with the same scale, lighting and joint conventions. The player
 * and wildlife use the merged, vertex-painted surfaces in characterSculpt.
 */
export { standard as rigMaterial, mesh as rigMesh, sphere as rigSphere, limb as rigLimb };

function limb(
  parent: THREE.Group,
  name: string,
  x: number,
  y: number,
  length: number,
  material: THREE.Material,
  radius = 0.09,
): THREE.Group {
  const joint = new THREE.Group();
  joint.name = name;
  joint.position.set(x, y, 0);
  const part = mesh(new THREE.CapsuleGeometry(radius,Math.max(.01,length-radius*2),3,8), material);
  part.position.y = -length / 2;
  joint.add(part);
  parent.add(joint);
  return joint;
}

function makeAxe(): THREE.Group {
  const root = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.72, 6), standard(0x6b442b));
  handle.position.y = -0.3;
  const blade = mesh(new THREE.BoxGeometry(0.28, 0.19, 0.055), standard(0x9fa9a6, 0.58));
  blade.position.set(0.13, 0.02, 0);
  root.add(handle, blade);
  return root;
}

function makePickaxe(): THREE.Group {
  const root = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.76, 6), standard(0x6b442b));
  handle.position.y = -0.3;
  const head = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.52, 6), standard(0x8e9997, 0.58));
  head.rotation.z = Math.PI / 2;
  root.add(handle, head);
  return root;
}

function makeSickle(): THREE.Group {
  const root = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.38, 6), standard(0x6b442b));
  handle.position.y = -0.17;
  const blade = mesh(
    new THREE.TorusGeometry(0.21, 0.035, 5, 10, Math.PI * 1.15),
    standard(0xaeb7b4, 0.55),
  );
  blade.position.set(0.12, -0.38, 0);
  blade.rotation.z = -0.2;
  root.add(handle, blade);
  return root;
}

function makeStaff(): THREE.Group {
  const root = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.028, 0.038, 0.95, 7), standard(0x67412d));
  shaft.position.y = -0.4;
  const crown = mesh(new THREE.TorusGeometry(0.13, 0.026, 6, 12), standard(0xd2b36b, 0.5));
  crown.position.y = 0.12;
  const focus = sphere(0.09, standard(0x9d72e8, 0.35));
  focus.position.y = 0.12;
  const glow = new THREE.PointLight(0xb58cff, 0.8, 1.8, 2);
  glow.position.y = 0.12;
  root.add(shaft, crown, focus, glow);
  return root;
}

function makeBow():THREE.Group {
  const root=new THREE.Group(),sculpt=new Sculpt();
  sculpt.tube([[0,-.36,.025],[0,-.17,.15],[0,.15,.16],[0,.37,.025]],[.014,.023,.023,.014],0x9a7550,20,6);
  sculpt.tube([[0,-.36,.025],[0,0,-.055],[0,.37,.025]],[.004,.004,.004],0xd7ccaa,10,4);
  sculpt.ellipsoid([0,0,.16],[.027,.075,.028],0x534530);
  sculpt.finish(root,'ranger.longbow');return root;
}

export function gatherToolForNode(kind: ResourceNodeKind | null): GatherToolKind {
  if (kind === 'tree') return 'axe';
  if (kind === 'stone' || kind === 'metal') return 'pickaxe';
  if (kind === 'plant' || kind === 'berry-bush') return 'sickle';
  return 'hands';
}

export function createPlayerRig(palette: PlayerRigPalette = {},detail:SculptDetail='full'): PlayerRig {
  const warden=buildWarden(palette,detail);
  const {root,torso,head,leftArm,rightArm,leftLeg,rightLeg}=warden;
  const animator=new WardenAnimator(warden);

  const toolHand = new THREE.Group();
  toolHand.name = 'tool-hand';
  toolHand.position.set(0.03, -0.34, 0);
  toolHand.rotation.z = -0.18;
  animator.rightElbow.add(toolHand);
  const leftToolHand=new THREE.Group();leftToolHand.name='left-tool-hand';leftToolHand.position.set(-.03,-.34,0);leftToolHand.rotation.z=.12;
  animator.leftElbow.add(leftToolHand);
  const tools: Record<GatherToolKind, THREE.Group | null> = {
    axe: makeAxe(), pickaxe: makePickaxe(), sickle: makeSickle(), staff: makeStaff(), bow:null,hands: null,
  };
  for (const [kind, tool] of Object.entries(tools)) {
    if (!tool) continue;
    tool.name = `tool-${kind}`;
    (kind==='bow'?leftToolHand:toolHand).add(tool);
  }

  let activeTool: GatherToolKind = 'hands';
  const setGatherTool = (kind: GatherToolKind): void => {
    if(kind==='bow'&&!tools.bow){const bow=makeBow();bow.name='tool-bow';leftToolHand.add(bow);tools.bow=bow;}
    activeTool = kind;
    for (const [toolKind, tool] of Object.entries(tools)) if (tool) tool.visible = toolKind === kind;
  };
  const replaceGatherTool = (kind: Exclude<GatherToolKind, 'hands'>, model: THREE.Group): void => {
    const fallback = tools[kind];
    if (fallback) {
      fallback.name = `fallback-tool-${kind}`;
      fallback.visible = false;
    }
    model.name = `tool-${kind}`;
    const hand=kind==='bow'?leftToolHand:toolHand;
    if (model.parent !== hand) hand.add(model);
    tools[kind] = model;
    setGatherTool(activeTool);
  };
  setGatherTool('hands');

  return {
    root,
    joints: { torso, head, leftArm, rightArm, leftLeg, rightLeg, toolHand,
      hips:animator.hips,leftElbow:animator.leftElbow,rightElbow:animator.rightElbow,
      leftKnee:animator.leftKnee,rightKnee:animator.rightKnee,leftAnkle:animator.leftAnkle,rightAnkle:animator.rightAnkle },
    setGatherTool,
    replaceGatherTool,
    animate(timeMs, motion, reducedMotion, frame) {
      animator.animate(timeMs,motion,reducedMotion,activeTool,frame);
    },
  };
}

/** Local hip height of the player rig; a rider's hips sit on the saddle point. */
export const RIDER_HIP_HEIGHT = 0.68;

/** Saddle point in creature-local space (creatures face -z, riders face +z). */
export function mountSeatOffset(speciesId: SpeciesId): { y: number; z: number } {
  switch (speciesId) {
    case 'glade-stag': return { y: 1.58, z: 0.08 };
    case 'craghopper': return { y: 1.02, z: 0.04 };
    case 'snarlfox': return { y: 0.92, z: 0.04 };
    case 'tuftle': return { y: 0.86, z: 0 };
    // The Bulwark Boar is the only rideable one of the defence roster; the rest
    // take a seat height anyway so a future mount needs no rig work.
    case 'bulwark-boar': return { y: 1.12, z: 0.06 };
    case 'masonmole': return { y: 0.94, z: 0.04 };
    case 'quillfinch': return { y: 0.78, z: 0 };
    case 'mistmoth': return { y: 0.82, z: 0 };
    case 'slingtail': return { y: 0.96, z: 0.04 };
  }
}

/** Tack shown under a rider so the seat reads as deliberate, not floating. */
export function createSaddle(speciesId: SpeciesId): THREE.Group {
  const seat = mountSeatOffset(speciesId);
  const root = new THREE.Group();
  root.name = `saddle-${speciesId}`;
  const vertices:number[]=[],uv:number[]=[],indices:number[]=[],columns=10,rows=6;
  for(let r=0;r<=rows;r++)for(let c=0;c<=columns;c++) {
    const x=(c/columns-.5)*.76,t=r/rows;
    vertices.push(x,seat.y-.13-Math.pow(Math.abs(x)/.38,2)*.19,seat.z+(t-.5)*.56);
    uv.push(c/columns,t);
    if(r<rows&&c<columns){const k=r*(columns+1)+c;indices.push(k,k+1,k+columns+1,k+1,k+columns+2,k+columns+1);}
  }
  const tack=new Sculpt();
  tack.add(surface(vertices,uv,indices),(_p,texel)=>Math.abs(texel.x-.5)>.43||Math.abs(texel.y-.5)>.42?0xc6ae7b:0x7e5146);
  tack.ellipsoid([0,seat.y-.07,seat.z],[.235,.067,.20],0x674e36);
  tack.tube([[-.20,seat.y-.07,seat.z+.17],[0,seat.y+.03,seat.z+.21],[.20,seat.y-.07,seat.z+.17]], [.04,.045,.04],0x493b2d,12,7);
  tack.tube([[-.12,seat.y-.06,seat.z-.18],[0,seat.y+.045,seat.z-.2],[.12,seat.y-.06,seat.z-.18]], [.025,.03,.025],0x71573a,10,6);
  for(const side of [-1,1]) {
    tack.tube([[side*.24,seat.y-.1,seat.z],[side*.33,seat.y-.25,seat.z-.13],[side*.32,seat.y-.38,seat.z-.21]],
      [.017,.014,.014],0x604b34,9,5);
  }
  tack.finish(root,'saddle.woven-blanket-and-leather');
  return root;
}

export function createCreatureRig(speciesId: SpeciesId): CreatureRig {
  return createSculptedCreature(speciesId);
}
