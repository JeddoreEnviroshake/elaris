import * as THREE from 'three';
import { isRoadPosition } from '../content/roads';
import type { TownBuildingDefinition } from '../content/townBuildings';
import { coordinateHash } from '../simulation/biomes';
import { terrainAt } from '../simulation/landscape';
import type { GameState } from '../simulation/state';
import type { ModelAssetKey } from './assetRegistry';
import { isInsideBufferedFootprint, type EnvironmentFootprint } from './environmentComposition';
import { ModelLibrary, type ModelPlacement } from './modelLibrary';
import { finishRoof, SETTLEMENT_ROOFS } from './visualDirection';
import { addRoofUnderside } from './buildingUndersides';

export const artNoise = (seed: number, x: number, z: number): number => {
  const noise = coordinateHash(seed, x, z);
  return noise < 0 ? noise + 1 : noise;
};

export interface ArtModel extends ModelPlacement {
  readonly key: ModelAssetKey;
  readonly height?: number;
  readonly width?: number;
  readonly depth?: number;
  readonly roofColor?: number;
}

/** An asynchronous art lifetime, independent of gameplay and save state. */
export class QuaterniusArt {
  private active = true;

  constructor(private readonly models: ModelLibrary, readonly root: THREE.Group) {}

  retire(): void { this.active = false; }

  private owns(object: THREE.Object3D): boolean {
    let owner: THREE.Object3D = this.root;
    while (owner.parent) owner = owner.parent;
    let ancestor: THREE.Object3D = object;
    while (ancestor.parent) ancestor = ancestor.parent;
    return this.active && owner === ancestor;
  }

  async add(parent: THREE.Group, asset: ArtModel): Promise<THREE.Group | null> {
    try {
      const model = await this.models.instantiate(asset.key,
        asset.height === undefined ? {} : { targetHeight: asset.height });
      if (!this.owns(parent)) { releaseArt(model); return null; }
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.set(
        (asset.width === undefined ? 1 : asset.width / size.x) * (asset.scale ?? 1),
        asset.scale ?? 1,
        (asset.depth === undefined ? 1 : asset.depth / size.z) * (asset.scale ?? 1),
      );
      model.position.set(asset.x, asset.y, asset.z);
      model.rotation.y = asset.rotation ?? 0;
      if(asset.roofColor!==undefined)finishRoof(model,asset.roofColor);
      parent.add(model);
      return model;
    } catch (error) { console.warn(`[3d] Unable to load styled asset ${asset.key}`, error); return null; }
  }

  async batch(parent: THREE.Group, key: ModelAssetKey, placements: readonly ModelPlacement[], height?: number,
    fit?: {width: number; depth?: number}, shadows = false): Promise<THREE.Group | null> {
    if (!placements.length) return null;
    try {
      const batch = await this.models.instantiateBatch(key, placements, height, fit);
      if (!this.owns(parent)) { releaseArt(batch); return null; }
      batch.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = shadows; });
      parent.add(batch);
      return batch;
    } catch (error) { console.warn(`[3d] Unable to load styled batch ${key}`, error); return null; }
  }

  async surface(root: THREE.Object3D, key: ModelAssetKey, lift = 0): Promise<void> {
    try {
      const source = await this.models.surface(key);
      if (!this.owns(root)) return;
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.userData.sharedModelTextures = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          const firstUse = material.map !== source.map;
          material.map = source.map;
          material.normalMap = source.normalMap;
          material.normalScale.set(.45, .45);
          // The timber texture is a trim atlas. Repeat its authored wood band
          // rather than repeating unrelated trims across floors and furniture.
          const band = source.userData.borrowedVRange as readonly number[] | undefined;
          if (key === 'entrance.deck' && band) {
            const low = (band[0]! + .002).toFixed(6), span = (band[1]! - band[0]! - .004).toFixed(6);
            const atlasUv = (uv: string): string => `vec2(${uv}.x, ${low} + fract(${uv}.y) * ${span})`;
            material.onBeforeCompile = (shader) => {
              shader.fragmentShader = shader.fragmentShader
                .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', atlasUv('vMapUv')))
                .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replaceAll('vNormalMapUv', atlasUv('vNormalMapUv')));
            };
            material.customProgramCacheKey = () => `quaternius-timber-band:${low}:${span}`;
          }
          if (firstUse) material.color.lerp(new THREE.Color(0xffffff), lift);
          material.roughness = Math.max(.8, material.roughness);
          material.needsUpdate = true;
        }
      });
    } catch (error) { console.warn(`[3d] Unable to load styled surface ${key}`, error); }
  }

  async modules(parent: THREE.Group, pieces: readonly ArtModel[]): Promise<THREE.Material[]> {
    const groups = new Map<string, {asset: ArtModel; placements: ModelPlacement[]}>();
    for (const asset of pieces) {
      const key = `${asset.key}:${asset.height}:${asset.width}:${asset.depth}:${asset.roofColor}`;
      const group = groups.get(key) ?? {asset, placements: []};
      group.placements.push(asset); groups.set(key, group);
    }
    const results = await Promise.all([...groups.values()].map(({asset, placements}) => {
      if (placements.length === 1) return this.add(parent, asset);
      const fit = asset.width === undefined ? undefined
        : {width: asset.width, ...(asset.depth === undefined ? {} : {depth: asset.depth})};
      return this.batch(parent, asset.key, placements, asset.height, fit, true).then(batch=>{
        if(batch&&asset.roofColor!==undefined)finishRoof(batch,asset.roofColor);return batch;
      });
    }));
    const materials = new Set<THREE.Material>();
    for (const result of results) result?.traverse((child) => {
      if (child instanceof THREE.Mesh) for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
    });
    return [...materials];
  }
}

/** Dispose instance-owned resources while retaining cached model data. */
export function releaseArt(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) child.dispose();
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Sprite || child instanceof THREE.Points || child instanceof THREE.Line)) return;
    if ('geometry' in child && !child.userData.sharedModelGeometry) geometries.add(child.geometry);
    if(child instanceof THREE.Mesh){if(child.customDepthMaterial)materials.add(child.customDepthMaterial);if(child.customDistanceMaterial)materials.add(child.customDistanceMaterial);}
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      if (!child.userData.sharedModelTextures) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

/** Partition a facade around its saved door, retaining its exact centre line. */
export function settlementModules(building: TownBuildingDefinition): ArtModel[] {
  const {footprint, door} = building;
  const width = footprint.tilesWide * .84, depth = footprint.tilesHigh * .8;
  const height = building.id === 'church' ? 2.8 : building.id === 'magic-shop' ? 2.7 : 2.4;
  const pieces: ArtModel[] = [];
  const northSouth = door.tileY === footprint.tileY || door.tileY === footprint.tileY + footprint.tilesHigh - 1;
  const side = northSouth ? door.tileY === footprint.tileY ? -1 : 1 : door.tileX === footprint.tileX ? -1 : 1;
  const alongDoor = northSouth ? door.tileX + building.doorWidth / 2 - footprint.tileX - footprint.tilesWide / 2
    : door.tileY + building.doorWidth / 2 - footprint.tileY - footprint.tilesHigh / 2;
  const doorSpan = Math.min(2, (northSouth ? width : depth) * .4);
  const panel = (key: ModelAssetKey, along: number, span: number, boundary: number, horizontal: boolean, direction: number): void => {
    const rotation = horizontal ? direction > 0 ? 0 : Math.PI : direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    pieces.push({key, x: horizontal ? along : boundary, y: 0, z: horizontal ? boundary : along, height, width: span, rotation});
    if (key === 'entrance.wall-window') pieces.push({key:'entrance.shutters', x: horizontal ? along : boundary + direction * .11,
      y: height * .32, z: horizontal ? boundary + direction * .11 : along, height: height * .46, rotation});
  };
  const run = (start: number, end: number, boundary: number, horizontal: boolean, direction: number): void => {
    const count = Math.max(1, Math.ceil((end - start) / 1.7));
    const span = (end - start) / count;
    if (span < .05) return;
    for (let i = 0; i < count; i++) panel(i % 2 === 0 && span > 1.1 ? 'entrance.wall-window' : 'entrance.wall',
      start + (i + .5) * span, span, boundary, horizontal, direction);
  };
  for (const direction of [-1, 1]) {
    const z = direction * depth / 2;
    const x = direction * width / 2;
    if (northSouth && side === direction) {
      run(-width / 2, alongDoor - doorSpan / 2, z, true, direction);
      panel(building.id==='church'?'detail.arch-wall':'entrance.wall-door', alongDoor, doorSpan, z, true, direction);
      run(alongDoor + doorSpan / 2, width / 2, z, true, direction);
    } else run(-width / 2, width / 2, z, true, direction);
    if (!northSouth && side === direction) {
      run(-depth / 2, alongDoor - doorSpan / 2, x, false, direction);
      panel('entrance.wall-door', alongDoor, doorSpan, x, false, direction);
      run(alongDoor + doorSpan / 2, depth / 2, x, false, direction);
    } else run(-depth / 2, depth / 2, x, false, direction);
  }
  pieces.push({key:'entrance.roof',x:0,y:height-.04,z:0,height:building.id==='church'?2.2:1.9,width:width+.6,depth:depth+.7,roofColor:SETTLEMENT_ROOFS[building.id]});
  pieces.push({key:building.id==='church'?'detail.round-door':'entrance.door',x:northSouth?alongDoor:side*(width/2+.06),y:.01,
    z:northSouth?side*(depth/2+.06):alongDoor,height:height*.69,
    rotation:northSouth?side>0?0:Math.PI:side>0?Math.PI/2:-Math.PI/2});
  pieces.push({key:'town.lantern',x:northSouth?alongDoor+.85:side*(width/2+.2),y:height*.65,
    z:northSouth?side*(depth/2+.2):alongDoor+.85,height:.55});
  return pieces;
}

export async function buildStyledSettlement(art: QuaterniusArt, root: THREE.Group, building: TownBuildingDefinition,
  ruined: boolean): Promise<THREE.Material[]> {
  const pieces = settlementModules(building);
  const width = building.footprint.tilesWide * .84, depth = building.footprint.tilesHigh * .8;
  const wallHeight = building.id === 'church' ? 2.8 : building.id === 'magic-shop' ? 2.7 : 2.4;
  const linings = [addRoofUnderside(root, width + .58, depth + .68, wallHeight - .05)];
  const add = (key: ModelAssetKey,x:number,y:number,z:number,height:number,rotation=0,width?:number,modelDepth?:number): void => {
    pieces.push({key,x,y,z,height,rotation,roofColor:SETTLEMENT_ROOFS[building.id],...(width===undefined?{}:{width}),...(modelDepth===undefined?{}:{depth:modelDepth})});
  };
  if (building.id === 'church' || building.id === 'magic-shop') {
    const level = building.id === 'church' ? 3.2 : 3;
    for (const direction of [-1,1]) {
      add('entrance.wall-window',direction*.95,level,0,1.8,direction>0?Math.PI/2:-Math.PI/2,1.9);
      add('entrance.wall',0,level,direction*.95,1.8,direction>0?0:Math.PI,1.9);
    }
    add('detail.tower-roof',0,level+1.75,0,building.id==='magic-shop'?2.5:1.95,0,2.7,2.7);
    linings.push(addRoofUnderside(root, 2.68, 2.68, level + 1.73));
    if (building.id === 'church') {
      const brass = new THREE.MeshStandardMaterial({color:0xd4b36b,metalness:.4,roughness:.65});
      const upright = new THREE.Mesh(new THREE.BoxGeometry(.08,.85,.08),brass); upright.position.set(0,7.1,0);
      const crossbar = new THREE.Mesh(new THREE.BoxGeometry(.48,.08,.08),brass); crossbar.position.set(0,7.22,0);
      root.add(upright,crossbar);
    } else {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.42),new THREE.MeshStandardMaterial({color:0xb7b4f4,
        emissive:0x7766bd,emissiveIntensity:ruined?0:1.2,roughness:.45}));
      crystal.position.set(0,7.8,0); root.add(crystal);
    }
  }
  if (building.id === 'tavern' || building.id === 'weaponsmith') add('entrance.chimney',width*.27,2.6,-depth*.2,2.5);
  if(building.id==='tavern'||building.id==='armoury') {
    for(const x of [-width*.23,width*.23])add('detail.dormer',x,3.0,.6,1.15,0,1.2,1.25);
  }
  if(building.id==='tavern'||building.id==='farm') {
    const front=building.door.tileY===building.footprint.tileY?-1:1;
    for(const x of [-1.9,1.2])add('detail.support',x,0,front*(depth/2+.1),2.15,front<0?Math.PI:0);
    if(building.id==='farm') {
      add('detail.wood-roof',-.35,2.15,front*(depth/2+.65),.55,front<0?Math.PI:0,4,1.65);
      linings.push(addRoofUnderside(root, 3.98, 1.63, 2.13, -.35, front * (depth / 2 + .65)));
    }
  }
  if(building.id==='magic-shop')add('detail.balcony',0,2.1,depth/2+.15,.6,0,2.2,.6);
  if (building.id === 'market') {
    add('town.stall-green',-width*.3,0,-depth/2-.08,1.7,Math.PI,1.9,.8);
    add('town.stall-red',width*.3,0,-depth/2-.08,1.7,Math.PI,1.9,.8);
    for (const x of [-width*.32,width*.32]) add('entrance.crate',x,0,depth*.28,.65);
  } else if (building.id === 'farm') {
    add('entrance.wagon',-width*.27,0,depth*.25,1.2,Math.PI/2);
    add('entrance.crate',width*.3,0,depth*.27,.7);
    add('entrance.grass',width*.3,.7,depth*.27,.5);
  } else if (building.id === 'tavern') {
    add('survival.barrel',-width*.34,0,-depth*.25,.85);
    add('survival.barrel',width*.34,0,-depth*.25,.85);
    add('town.banner-red',-width*.26,1.3,-depth/2-.12,1.1,Math.PI/2);
  } else if (building.id === 'armoury') {
    add('town.blade-sign',width*.28,1.3,depth/2+.15,1,Math.PI/2);
    add('town.banner-red',-width*.3,1.2,depth/2+.14,1.2,Math.PI/2);
  } else if (building.id === 'weaponsmith') {
    add('survival.workbench-anvil',-width*.3,0,depth*.31,.9);
  }
  add('detail.vine',-width/2-.05,.15,depth*.12,1.4,-Math.PI/2);
  const base = new THREE.Mesh(new THREE.BoxGeometry(width+.12,.18,depth+.12),new THREE.MeshStandardMaterial({color:0x8c8976,roughness:1}));
  base.position.y=-.015; base.receiveShadow=true; root.add(base);
  void art.surface(base,'entrance.paving',.1);
  const materials = await art.modules(root,pieces);
  materials.push(base.material);
  for (const lining of linings) lining.traverse(child => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.Material && !materials.includes(child.material)) materials.push(child.material);
  });
  const windows=pieces.filter(piece=>piece.key==='entrance.wall-window');
  if(windows.length) {
    const glazing=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),
      new THREE.MeshBasicMaterial({color:building.id==='church'?0x90b8c5:building.id==='magic-shop'?0xb5a7d9:0xd9bb7a,
        side:THREE.DoubleSide,transparent:true,opacity:.8}),windows.length);
    glazing.name='settlement.window-glass';
    const transform=new THREE.Object3D();
    windows.forEach((window,i)=>{
      const angle=window.rotation??0;
      transform.position.set(window.x+Math.sin(angle)*.09,window.y+(window.height??2.4)*.54,window.z+Math.cos(angle)*.09);
      transform.rotation.set(0,angle,0);transform.scale.set((window.width??1.6)*.4,(window.height??2.4)*.34,1);
      transform.updateMatrix();glazing.setMatrixAt(i,transform.matrix);
    });
    root.add(glazing);materials.push(glazing.material);
  }
  if (ruined) {
    root.scale.y=.62;
    for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) {
      material.color.multiplyScalar(.45); material.emissive.setHex(0);
    }
  }
  root.userData.quaterniusReady=true;
  root.userData.visualStyle='quaternius';
  return materials;
}

export interface RegionalPlant extends ModelPlacement { readonly key: ModelAssetKey }

/** Decoration is composed by spatial cell so moving the camera can stream it. */
export function regionalPlanting(state: GameState, cellX: number, cellZ: number,
  footprints: readonly EnvironmentFootprint[]): RegionalPlant[] {
  const result: RegionalPlant[]=[];
  const theme=state.currentArea.theme;
  const density=theme==='forest'||theme==='thicket'?72:theme==='mountain'?18:44;
  for(let i=0;i<density;i++) {
    const x=cellX*12+.5+artNoise(state.currentArea.seed^0x574f524c,cellX*100+i,cellZ)*11;
    const z=cellZ*12+.5+artNoise(state.currentArea.seed^0x504c414e,cellX,cellZ*100+i)*11;
    if(x>=160||z>=160||x<0||z<0)continue;
    // The entrance keeps its denser authored planting; other cells use this system.
    if(state.currentArea.key==='0,0'&&x>=43&&x<=84&&z>=65&&z<=104)continue;
    if(isRoadPosition(state.currentArea.key,x,z,.65)||isInsideBufferedFootprint({x,z},footprints,.85))continue;
    if(terrainAt(state.seed,state.currentArea,Math.floor(x),Math.floor(z))!=='ground')continue;
    const h=artNoise(state.currentArea.seed^0x5354594c,i+cellX*73,cellZ);
    if(artNoise(state.currentArea.seed,Math.floor(x/3),Math.floor(z/3))<.35)continue;
    const key:ModelAssetKey=theme==='mountain'?'entrance.pebble':theme==='marsh'
      ? h<.6?'entrance.fern':'entrance.grass'
      :h<.68?'entrance.grass':h<.86?'entrance.fern':h<.95?'entrance.flowers':'entrance.mushroom';
    result.push({key,x,y:-.04,z,rotation:h*6.28,scale:.65+h*.5});
  }
  return result;
}

/** Only the nearby nine cells occupy the active scene, including while walking. */
export class VegetationStream {
  readonly root = new THREE.Group();
  private readonly cells = new Map<string, {root: THREE.Group; art: QuaterniusArt}>();
  private cell = '';

  constructor(private readonly models: ModelLibrary, private readonly state: GameState,
    private readonly footprints: readonly EnvironmentFootprint[]) {
    this.root.name = 'regional-vegetation';
  }

  /**
   * `radius` is in 12-tile cells: 1 (the nine nearby cells) for the overhead
   * view, more for first person, whose fog sits much farther out.
   */
  update(x: number, z: number, radius = 1): void {
    const cx = Math.floor(x / 12), cz = Math.floor(z / 12);
    if (this.cell === `${cx},${cz},${radius}`) return;
    this.cell = `${cx},${cz},${radius}`;
    const live = new Set<string>();
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const key = `${cx + dx},${cz + dz}`; live.add(key);
      if (this.cells.has(key)) continue;
      const root = new THREE.Group(); root.name = `vegetation:${key}`; this.root.add(root);
      const art = new QuaterniusArt(this.models, root); this.cells.set(key, {root, art});
      const placements = regionalPlanting(this.state, cx + dx, cz + dz, this.footprints);
      const batches = new Map<ModelAssetKey, ModelPlacement[]>();
      for (const placement of placements) {
        const batch = batches.get(placement.key) ?? []; batch.push(placement); batches.set(placement.key, batch);
      }
      for (const [model, instances] of batches) void art.batch(root, model, instances);
    }
    for (const [key, cell] of this.cells) if (!live.has(key)) {
      cell.art.retire(); this.root.remove(cell.root); releaseArt(cell.root); this.cells.delete(key);
    }
  }

  retire(): void { for (const cell of this.cells.values()) cell.art.retire(); this.cells.clear(); }
}

const waterTime = {value: 0};
export function updateStyledWater(time: number, reducedMotion: boolean): void { waterTime.value = reducedMotion ? 0 : time / 1000; }

export function styledWaterMaterial(color: number, opacity: number, depthMask?: Uint8Array): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({color, transparent:true, opacity});
  const mask=depthMask?new THREE.DataTexture(depthMask,160,160,THREE.RedFormat):null;
  if(mask){mask.minFilter=mask.magFilter=THREE.LinearFilter;mask.needsUpdate=true;material.userData.ownedTextures=[mask];}
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStyledWaterTime = waterTime;
    shader.vertexShader = `varying vec2 vWaterWorld;\n${shader.vertexShader}`.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       vec4 waterPosition = vec4(position,1.);
       #ifdef USE_INSTANCING
         waterPosition = instanceMatrix * waterPosition;
       #endif
       vWaterWorld = (modelMatrix * waterPosition).xz;`);
    shader.fragmentShader = `varying vec2 vWaterWorld; uniform float uStyledWaterTime;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
        float drift = sin(vWaterWorld.x*.65+vWaterWorld.y*.51+uStyledWaterTime*.12);
        float ripple = sin(vWaterWorld.x*3.+vWaterWorld.y*4.+drift*1.8-uStyledWaterTime*.6)
          * sin(vWaterWorld.x*.8-vWaterWorld.y*.5+uStyledWaterTime*.23);
        diffuseColor.rgb *= .96 + ripple*.055;
        diffuseColor.rgb += vec3(.006,.014,.012)*smoothstep(.9,1.,ripple);`);
    if(mask){
      shader.uniforms.uWaterDepth={value:mask};
      shader.uniforms.uShallowColor={value:new THREE.Color(0x6f9884)};
      shader.uniforms.uDeepColor={value:new THREE.Color(0x285666)};
      shader.uniforms.uFoamColor={value:new THREE.Color(0xb4bc98)};
      shader.fragmentShader=`uniform sampler2D uWaterDepth; uniform vec3 uShallowColor; uniform vec3 uDeepColor; uniform vec3 uFoamColor;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>',`#include <color_fragment>
          float depth=texture2D(uWaterDepth,vWaterWorld/160.).r;
          diffuseColor.rgb=mix(uShallowColor,uDeepColor,smoothstep(.42,.96,depth));
          float shore=(1.-smoothstep(.32,.51,depth))*smoothstep(.08,.25,depth);
          float foam=.62+.38*sin(vWaterWorld.x*3.+vWaterWorld.y*2.-uStyledWaterTime*.5);
          diffuseColor.rgb=mix(diffuseColor.rgb,uFoamColor,shore*foam*.55);`);
    }
  };
  material.customProgramCacheKey=()=>`quaternius-water-v2:${!!mask}`;
  return material;
}
