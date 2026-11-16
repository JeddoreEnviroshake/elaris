import * as THREE from 'three';

const windTime = { value: 0 };
const windMaterials = new WeakSet<THREE.Material>();

export function updateTreeWind(timeMs: number, reducedMotion: boolean): void {
  windTime.value = reducedMotion ? 0 : timeMs / 1000;
}

/** Bend the upper tree in world units; its lower trunk and roots never move. */
export function addGroundedTreeWind(root: THREE.Object3D): void {
  const patch = (material: THREE.Material): void => {
    if (windMaterials.has(material)) return;
    windMaterials.add(material);
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.uTreeWindTime = windTime;
      shader.vertexShader = `uniform float uTreeWindTime;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 treeWorld = (modelMatrix * vec4(transformed, 1.)).xyz;
          float crownWeight = smoothstep(.45, 3.0, treeWorld.y);
          float breeze = sin(uTreeWindTime * .75 + treeWorld.x * .7 + treeWorld.z * .4);
          transformed.x += breeze * .045 * crownWeight / max(.0001, length(modelMatrix[0].xyz));`);
    };
    material.customProgramCacheKey = () => 'grounded-tree-wind-v1';
    material.needsUpdate = true;
  };
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(patch);
    // Matching shadow deformation avoids a still shadow beneath a moving crown.
    const source = materials[0];
    const map = source instanceof THREE.MeshStandardMaterial ? source.map : null;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: source?.alphaTest ?? 0 });
    const distance = new THREE.MeshDistanceMaterial({ map, alphaTest: source?.alphaTest ?? 0 });
    patch(depth); patch(distance);
    child.customDepthMaterial = depth;
    child.customDistanceMaterial = distance;
  });
}
