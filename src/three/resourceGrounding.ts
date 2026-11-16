import * as THREE from 'three';
import { TILE_SIZE } from '../config/platform';
import type { ResourceNodeState } from '../simulation/state';
import { releaseArt } from './quaterniusArt';

/** Match the meadow surface, rather than leaving imported models above it. */
export const RESOURCE_GROUND_Y = -.08;
export const TREE_BASE_Y = RESOURCE_GROUND_Y - .025;
export const ROCK_BASE_Y = RESOURCE_GROUND_Y - .10;

/** Roots, litter and soft soil/moss patches share three instanced draws. */
export class ResourceGrounding {
  readonly root = new THREE.Group();
  private signature = '';

  constructor() { this.root.name = 'resources.ground-contact'; }

  sync(nodes: readonly ResourceNodeState[]): void {
    const grounded = nodes.filter(node => node.hp > 0 && ['tree', 'stone', 'metal'].includes(node.kind));
    const signature = grounded.map(node => `${node.id}:${node.kind}:${node.x}:${node.y}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    releaseArt(this.root);
    this.root.clear();
    if (!grounded.length) return;

    const soil = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, depthWrite: false });
    soil.onBeforeCompile = shader => {
      shader.vertexShader = `varying vec2 vContactUv;\n${shader.vertexShader}`
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvContactUv = uv;');
      shader.fragmentShader = `varying vec2 vContactUv;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 p=(vContactUv-.5)*2.;
          float angle=atan(p.y,p.x);
          float edge=length(p)+.06*sin(angle*5.)+.035*sin(angle*9.);
          diffuseColor.a *= (1.-smoothstep(.42,1.,edge))*.66;`);
    };
    soil.customProgramCacheKey = () => 'resource-soil-v1';
    const patches = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), soil, grounded.length);
    patches.name = 'resources.soil-and-moss';
    patches.receiveShadow = true;
    const trees = grounded.filter(node => node.kind === 'tree');
    const roots = new THREE.InstancedMesh(new THREE.CylinderGeometry(.025, .11, 1, 5),
      new THREE.MeshStandardMaterial({ color: 0x67513a, roughness: 1 }), trees.length * 4);
    roots.name = 'resources.exposed-roots';
    roots.receiveShadow = true;
    const litter = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), grounded.length * 5);
    litter.name = 'resources.leaves-and-scree';
    litter.receiveShadow = true;
    const transform = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    let rootIndex = 0;
    grounded.forEach((node, index) => {
      const x = node.x / TILE_SIZE, z = node.y / TILE_SIZE;
      const phase = x * 1.73 + z * 2.91;
      const tree = node.kind === 'tree';
      transform.position.set(x, RESOURCE_GROUND_Y + .006, z);
      transform.rotation.set(0, phase, 0);
      transform.scale.set(tree ? 2.5 : 1.9, 1, tree ? 2.1 : 1.6);
      transform.updateMatrix(); patches.setMatrixAt(index, transform.matrix);
      patches.setColorAt(index, new THREE.Color(tree ? 0x554b32 : 0x536044));
      if (tree) for (let j = 0; j < 4; j++) {
        const angle = phase + j * Math.PI / 2;
        const start = new THREE.Vector3(x + Math.cos(angle) * .09, RESOURCE_GROUND_Y + .13, z + Math.sin(angle) * .09);
        const end = new THREE.Vector3(x + Math.cos(angle) * .64, RESOURCE_GROUND_Y - .025, z + Math.sin(angle) * .64);
        // The broad end meets the trunk; the narrow tip disappears into soil.
        const direction = end.clone().sub(start);
        transform.position.copy(start).add(end).multiplyScalar(.5);
        transform.quaternion.setFromUnitVectors(up, direction.clone().normalize());
        transform.scale.set(1, direction.length(), 1);
        transform.updateMatrix(); roots.setMatrixAt(rootIndex++, transform.matrix);
      }
      for (let j = 0; j < 5; j++) {
        const angle = phase + j * 2.4;
        const distance = .42 + (Math.sin(phase + j * 7) * .5 + .5) * .47;
        transform.position.set(x + Math.cos(angle) * distance, RESOURCE_GROUND_Y + .012, z + Math.sin(angle) * distance);
        transform.rotation.set(0, angle, 0);
        transform.scale.set(tree ? .095 : .075, tree ? .012 : .035, .045);
        transform.updateMatrix(); litter.setMatrixAt(index * 5 + j, transform.matrix);
        litter.setColorAt(index * 5 + j, new THREE.Color(tree ? j % 2 ? 0x6c613d : 0x857346 : 0x7b8070));
      }
    });
    this.root.add(patches, roots, litter);
  }

  dispose(): void { releaseArt(this.root); this.root.clear(); }
}
