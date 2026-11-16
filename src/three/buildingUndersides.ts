import * as THREE from 'three';

/** Solid timber closes roof bottoms; narrow rafters give the eaves real depth. */
export function addRoofUnderside(parent: THREE.Group, width: number, depth: number,
  y: number, x = 0, z = 0): THREE.Group {
  const root = new THREE.Group();
  root.name = 'building.roof-underside';
  root.position.set(x, y, z);
  const material = new THREE.MeshStandardMaterial({ color: 0x65513c, roughness: 1 });
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(width, .10, depth), material);
  ceiling.receiveShadow = true;
  root.add(ceiling);
  const count = Math.max(2, Math.ceil(width / .85));
  const rafters = new THREE.InstancedMesh(new THREE.BoxGeometry(.09, .13, depth + .04), material, count);
  rafters.name = 'building.eave-rafters';
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    matrix.makeTranslation(-width / 2 + .10 + i * (width - .20) / (count - 1), -.075, 0);
    rafters.setMatrixAt(i, matrix);
  }
  rafters.receiveShadow = true;
  rafters.castShadow = true;
  root.add(rafters);
  parent.add(root);
  return root;
}
