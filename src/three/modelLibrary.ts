import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { modelAsset, type ModelAssetKey } from './assetRegistry';

export interface ModelInstanceOptions {
  readonly targetHeight?: number;
  readonly tint?: number;
}

export interface ModelPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotation?: number;
  readonly scale?: number;
}

/** Cache source GLBs once and return normalized, independently tintable clones. */
export class ModelLibrary {
  private readonly loader = new GLTFLoader();
  private readonly sources = new Map<ModelAssetKey, Promise<THREE.Group>>();

  /** Borrow immutable authored texture maps for the remaining code-built props. */
  async surface(key: ModelAssetKey): Promise<THREE.MeshStandardMaterial> {
    const source = await this.source(key);
    let surface: THREE.MeshStandardMaterial | undefined;
    let plaster: THREE.MeshStandardMaterial | undefined;
    source.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      surface ??= materials.find((material): material is THREE.MeshStandardMaterial =>
        material instanceof THREE.MeshStandardMaterial && material.map !== null);
      plaster ??= materials.find((material): material is THREE.MeshStandardMaterial =>
        material instanceof THREE.MeshStandardMaterial && material.map !== null && material.name.includes('Plaster'));
    });
    if (key === 'entrance.wall' && plaster) return plaster;
    if (!surface) throw new Error(`No textured surface in ${key}`);
    if (key === 'entrance.deck' && !surface.userData.borrowedVRange) {
      let low = Infinity, high = -Infinity;
      source.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const uv = child.geometry.getAttribute('uv');
        if (uv) for (let i = 0; i < uv.count; i++) { low = Math.min(low, uv.getY(i)); high = Math.max(high, uv.getY(i)); }
      });
      if (Number.isFinite(low) && high > low) surface.userData.borrowedVRange = [low, high];
    }
    return surface;
  }

  dispose(): void {
    const sources = [...this.sources.values()];
    this.sources.clear();
    void Promise.allSettled(sources).then((results) => {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        result.value.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          geometries.add(child.geometry);
          for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            materials.add(material);
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
          }
        });
      }
      for (const texture of textures) texture.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    });
  }

  /** One draw per source primitive rather than per plant/stone. */
  async instantiateBatch(key: ModelAssetKey, placements: readonly ModelPlacement[], targetHeight?: number,
    fit?: { width: number; depth?: number }): Promise<THREE.Group> {
    const source = await this.instantiate(key, targetHeight === undefined ? {} : { targetHeight });
    if (fit) {
      const size = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
      source.scale.x *= fit.width / size.x;
      if (fit.depth !== undefined) source.scale.z *= fit.depth / size.z;
    }
    source.updateMatrixWorld(true);
    const batch = new THREE.Group();
    batch.name = `batch.${key}`;
    const transform = new THREE.Object3D();
    const matrix = new THREE.Matrix4();
    source.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = new THREE.InstancedMesh(child.geometry, child.material, placements.length);
      mesh.name = child.name;
      mesh.userData.sharedModelGeometry = true;
      mesh.userData.sharedModelTextures = true;
      mesh.receiveShadow = true;
      // Tiny plants receive the sun shadow; they do not need another shadow pass.
      mesh.castShadow = false;
      placements.forEach((placement, index) => {
        transform.position.set(placement.x, placement.y, placement.z);
        transform.rotation.set(0, placement.rotation ?? 0, 0);
        transform.scale.setScalar(placement.scale ?? 1);
        transform.updateMatrix();
        matrix.multiplyMatrices(transform.matrix, child.matrixWorld);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      batch.add(mesh);
    });
    return batch;
  }

  async instantiate(key: ModelAssetKey, options: ModelInstanceOptions = {}): Promise<THREE.Group> {
    const asset = modelAsset(key);
    const source = await this.source(key);
    // The authored gate includes fixed fence sections. Only the named leaf
    // belongs on a hinge; two of these panels form the two-tile opening.
    const content = key === 'town.fence-gate' ? new THREE.Group() : source.clone(true);
    if (key === 'town.fence-gate') {
      const leaf = source.getObjectByName('gate');
      if (!leaf) throw new Error('Missing gate leaf in town.fence-gate');
      const orientedLeaf = new THREE.Group();
      orientedLeaf.rotation.y = asset.rotationY ?? 0;
      orientedLeaf.add(leaf.clone(true));
      content.add(orientedLeaf);
    }
    this.cloneMaterials(content, options.tint, asset.author === 'Kenney');
    // Asset-space calibration belongs here rather than at every placement.
    // The Kenney fence and gate are authored 90 degrees off Elaris' boundary
    // axis, so their registry correction now applies to town and player builds.
    content.rotation.y = key === 'town.fence-gate' ? 0 : asset.rotationY ?? 0;
    this.normalize(content, options.targetHeight ?? asset.targetHeight, key === 'town.fence-gate' ? 1 : undefined);
    content.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      // Architectural sheets must still exist when viewed from below or behind.
      if (/wall|roof|dormer|balcony/.test(key)) {
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.side = THREE.DoubleSide;
      }
      child.castShadow = true;
      child.receiveShadow = true;
      // GLB clones share immutable geometry with the cached source.
      child.userData.sharedModelGeometry = true;
      child.userData.sharedModelTextures = true;
    });
    // Imported scenery is rigid. Parent groups can still sway or move while
    // their immutable local transforms avoid per-frame matrix recomputation.
    content.traverse((child) => { child.updateMatrix(); child.matrixAutoUpdate = false; });
    // Keep normalization on a child so scene placement can move the wrapper
    // without discarding the model's ground/center correction.
    const instance = new THREE.Group();
    instance.name = key;
    instance.add(content);
    return instance;
  }

  private source(key: ModelAssetKey): Promise<THREE.Group> {
    const cached = this.sources.get(key);
    if (cached) return cached;
    const asset = modelAsset(key);
    const pending = this.loader.loadAsync(asset.path).then((gltf) => gltf.scene).catch((error: unknown) => {
      this.sources.delete(key);
      throw error;
    });
    this.sources.set(key, pending);
    return pending;
  }

  private cloneMaterials(group: THREE.Object3D, tint: number | undefined, flatShading: boolean): void {
    const cache = new Map<THREE.Material, THREE.Material>();
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const clones = materials.map((material) => {
        const cached = cache.get(material);
        if (cached) return cached;
        const clone = material.clone();
        if (clone instanceof THREE.MeshStandardMaterial) {
          if (tint !== undefined) clone.color.multiply(new THREE.Color(tint));
          // Keep the matte material response consistent across packs while
          // preserving Quaternius' authored smooth normals and textures.
          clone.roughness = Math.max(0.74, clone.roughness);
          clone.metalness = Math.min(0.72, clone.metalness);
          clone.flatShading = flatShading;
          if(assetFoliage(material.name)) {
            clone.emissiveMap=clone.map;clone.emissive.setHex(0x70845b);clone.emissiveIntensity=.19;
            clone.roughness=1;
          }
          clone.dithering = true;
          clone.needsUpdate = true;
        }
        cache.set(material, clone);
        return clone;
      });
      child.material = Array.isArray(child.material) ? clones : clones[0]!;
    });
  }

  private normalize(group: THREE.Group, targetHeight: number, targetWidth?: number): void {
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const scale = targetHeight / Math.max(0.001, size.y);
    group.scale.setScalar(scale);
    group.updateMatrixWorld(true);

    if (targetWidth !== undefined) {
      const width = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).x;
      group.scale.x *= targetWidth / Math.max(0.001, width);
      group.updateMatrixWorld(true);
    }

    const scaledBox = new THREE.Box3().setFromObject(group);
    const center = scaledBox.getCenter(new THREE.Vector3());
    group.position.set(-center.x, -scaledBox.min.y, -center.z);
  }
}

function assetFoliage(name:string):boolean{return /leaves|leaf|grass|fern/i.test(name);}
