import * as THREE from 'three';
import { isRoadPosition } from '../content/roads';
import type { TownBuildingDefinition } from '../content/townBuildings';
import { coordinateHash as signedCoordinateHash } from '../simulation/biomes';
import { terrainAt } from '../simulation/landscape';
import type { GameState } from '../simulation/state';
import type { ModelAssetKey } from './assetRegistry';
import { ModelLibrary, type ModelPlacement } from './modelLibrary';
import { isInsideBufferedFootprint, type EnvironmentFootprint } from './environmentComposition';
import { addRoofUnderside } from './buildingUndersides';
import { townBuildingShell } from '../content/interiors';
import { ELARIS_WEST_ENTRANCE } from '../content/townDefences';
import { settlementModules } from './quaterniusArt';

// The legacy hash's last XOR returns a signed 32-bit value. Normalize locally
// without changing existing world generation or save compatibility.
function coordinateHash(seed: number, x: number, z: number): number {
  const value = signedCoordinateHash(seed, x, z);
  return value < 0 ? value + 1 : value;
}

/** The art pass is bounded; the rest of the world retains its current assets. */
export function isTownEntrance(x: number, z: number): boolean {
  return x >= 43 && x <= 84 && z >= 65 && z <= 104;
}

export interface EntrancePlant extends ModelPlacement {
  readonly key: ModelAssetKey;
}

let paintedGround: THREE.Texture | null = null;
function groundTexture(): THREE.Texture {
  if (paintedGround) return paintedGround;
  const texture = new THREE.TextureLoader().load('/assets/terrain/painted-meadow.png');
  texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.anisotropy=4;paintedGround=texture;return texture;
}
export function disposePaintedGround(): void { paintedGround?.dispose();paintedGround=null; }

/** Seeded low planting, always clear of doors, roads, water and building shells. */
export function entrancePlanting(seed: number, footprints: readonly EnvironmentFootprint[]): EntrancePlant[] {
  const placements: EntrancePlant[] = [];
  for (let index = 0; index < 1000; index++) {
    const x = 45 + coordinateHash(seed ^ 0x5155, index, 1) * 38;
    const z = 67 + coordinateHash(seed ^ 0x4e41, index, 2) * 35;
    if (isInsideBufferedFootprint({ x, z }, footprints, 0.7) || isRoadPosition('0,0', x, z, 0.55)) continue;
    if (terrainAt(seed, { x: 0, y: 0, theme: 'elaris' }, Math.floor(x), Math.floor(z)) !== 'ground') continue;
    // Clumps and quiet spaces rather than a uniform carpet.
    const cluster = coordinateHash(seed ^ 0x434c, Math.floor(x / 3), Math.floor(z / 3));
    if (cluster < 0.3) continue;
    const variant = coordinateHash(seed ^ 0x504c, index, 3);
    const key: ModelAssetKey = variant < 0.65 ? 'entrance.grass'
      : variant < 0.81 ? 'entrance.fern' : variant < 0.9 ? 'entrance.flowers'
        : variant < 0.96 ? 'entrance.flowers-blue' : 'entrance.mushroom';
    placements.push({ key, x, y: -0.04, z, rotation: variant * Math.PI * 2, scale: 0.7 + cluster * 0.55 });
  }
  return placements;
}

/** Smooth color variation across the ground, without tile or polygon outlines. */
export function meadowMaterial(color: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color:new THREE.Color(color).lerp(new THREE.Color(0xffffff),.72), map:groundTexture(), roughness:1 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec2 vMeadow;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvMeadow = (modelMatrix * vec4(position, 1.0)).xz;',
    );
    shader.fragmentShader = `varying vec2 vMeadow;
      float meadowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float meadowNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(meadowHash(i),meadowHash(i+vec2(1.,0.)),f.x),
          mix(meadowHash(i+vec2(0.,1.)),meadowHash(i+vec2(1.,1.)),f.x),f.y);
      }\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      float broad = meadowNoise(vMeadow * .24);
      float fine = meadowNoise(vMeadow * 5.);
      diffuseColor.rgb *= mix(vec3(.78,.88,.72), vec3(1.12,1.08,.91), broad);
      diffuseColor.rgb *= .96 + fine * .08;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replaceAll('vMapUv','vMeadow * .115').replace('diffuseColor *= sampledDiffuseColor;',
        'float turfLight=dot(sampledDiffuseColor.rgb,vec3(.2126,.7152,.0722)); sampledDiffuseColor.rgb=mix(vec3(turfLight),sampledDiffuseColor.rgb,.62); sampledDiffuseColor.rgb=mix(vec3(.18,.225,.125),sampledDiffuseColor.rgb,.72); diffuseColor *= sampledDiffuseColor;'));
  };
  material.customProgramCacheKey = () => 'elaris-meadow-v1';
  return material;
}

/** Small repeating dirt/aggregate map; all road tiles share one material. */
export function entranceRoadMaterial(mask?: Uint8Array): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#9a805b'; context.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const h = coordinateHash(0x524f4144, i, 2);
    const x = coordinateHash(0x524f4144, i, 3) * 128;
    const y = coordinateHash(0x524f4144, i, 4) * 128;
    context.fillStyle = h > .7 ? '#b59b76' : h > .4 ? '#8b7555' : '#a28a65';
    context.beginPath(); context.ellipse(x, y, 0.5 + h * 1.7, 0.4 + h, h * 3, 0, Math.PI * 2); context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1 });
  const roadMask=mask ? new THREE.DataTexture(mask,160,160,THREE.RedFormat) : null;
  if(roadMask){roadMask.minFilter=roadMask.magFilter=THREE.LinearFilter;roadMask.needsUpdate=true;
    material.transparent=true;material.userData.ownedTextures=[roadMask];}
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec2 vRoadWorld;\n${shader.vertexShader}`.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       vec4 roadPosition = vec4(position,1.);
       #ifdef USE_INSTANCING
         roadPosition = instanceMatrix * roadPosition;
       #endif
       vRoadWorld = (modelMatrix * roadPosition).xz;`);
    shader.fragmentShader = `varying vec2 vRoadWorld;\n${shader.fragmentShader}`.replace('#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', 'vRoadWorld * .7'));
    if(roadMask){shader.uniforms.uRoadMask={value:roadMask};
      shader.fragmentShader=`uniform sampler2D uRoadMask;\n${shader.fragmentShader}`.replace('#include <alphatest_fragment>',
        'diffuseColor.a *= smoothstep(.24,.82,texture2D(uRoadMask,vRoadWorld/160.).r);\n#include <alphatest_fragment>');}
  };
  material.customProgramCacheKey = () => `painted-road-${!!roadMask}`;
  return material;
}

export class TownEntrance {
  readonly root = new THREE.Group();
  private readonly smoke: THREE.Points;
  private readonly smokePositions = new Float32Array(18 * 3);
  private readonly ripples: THREE.InstancedMesh;
  private readonly rippleBases: ModelPlacement[] = [];
  private readonly transform = new THREE.Object3D();
  private disposed = false;
  private smokeOrigin = new THREE.Vector3(76.8, 5.8, 76);
  private readonly forgeGlow = new THREE.PointLight(0xffa456, 3.2, 5.5, 2);

  constructor(private readonly models: ModelLibrary, private readonly state: GameState) {
    this.root.name = 'town-entrance';
    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(this.smokePositions, 3));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(210,200,182,.45)'); gradient.addColorStop(1, 'rgba(210,200,182,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 32, 32);
    this.smoke = new THREE.Points(smokeGeometry, new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(canvas), color: 0xc2b7a3, size: 1.4,
      transparent: true, opacity: .34, depthWrite: false,
    }));
    this.smoke.name = 'entrance.forge-smoke';
    this.smoke.frustumCulled = false;
    this.root.add(this.smoke);
    this.ripples = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.58, 0.025),
      new THREE.MeshBasicMaterial({ color: 0xa9e0ce, transparent: true, opacity: .28, depthWrite: false }), 64);
    this.ripples.name = 'entrance.water-ripples';
    this.root.add(this.ripples);
  }

  build(footprints: readonly EnvironmentFootprint[]): void {
    const planting = entrancePlanting(this.state.seed, footprints);
    const byKey = new Map<ModelAssetKey, ModelPlacement[]>();
    for (const plant of planting) {
      const group = byKey.get(plant.key) ?? []; group.push(plant); byKey.set(plant.key, group);
    }
    for (const [key, placements] of byKey) void this.batch(key, placements);
    this.buildRiverbank();
    this.buildGate();
  }

  private async batch(key: ModelAssetKey, placements: readonly ModelPlacement[], height?: number): Promise<void> {
    if (!placements.length) return;
    try {
      const batch = await this.models.instantiateBatch(key, placements, height);
      if (this.disposed) { this.disposeMaterials(batch); return; }
      this.root.add(batch);
    } catch (error) { console.warn(`[3d] Unable to load entrance scenery ${key}`, error); }
  }

  private async model(parent: THREE.Group, key: ModelAssetKey, x: number, y: number, z: number,
    height?: number, rotation = 0, fit?: { width: number; depth?: number }): Promise<THREE.Group> {
    const model = await this.models.instantiate(key, height === undefined ? {} : { targetHeight: height });
    if (this.disposed) { this.disposeMaterials(model); return model; }
    if (fit) {
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.x *= fit.width / size.x;
      if (fit.depth !== undefined) model.scale.z *= fit.depth / size.z;
    }
    model.position.set(x, y, z); model.rotation.y = rotation;
    parent.add(model);
    return model;
  }

  private buildRiverbank(): void {
    const pebbles: ModelPlacement[] = [];
    const reeds: ModelPlacement[] = [];
    const deck: ModelPlacement[] = [];
    const rails: ModelPlacement[] = [];
    const foam: ModelPlacement[] = [];
    const approachStones: ModelPlacement[] = [];
    const isWater = (x: number, z: number) => ['shallow-water', 'deep-water'].includes(terrainAt(this.state.seed, this.state.currentArea, x, z));
    const isBridge = (x: number, z: number) => terrainAt(this.state.seed, this.state.currentArea, x, z) === 'bridge';
    for (let z = 72; z <= 100; z++) for (let x = 51; x <= 65; x++) {
      const kind = terrainAt(this.state.seed, this.state.currentArea, x, z);
      const h = coordinateHash(this.state.seed ^ 0x42414e4b, x, z);
      if (kind === 'ground' && z === 84 && x >= 53 && x <= 56 && isRoadPosition('0,0',x+.5,z+.5)) {
        approachStones.push({x:x+.5,y:.002,z:z+.5,rotation:h,scale:.7});
      }
      if (kind === 'bridge') {
        deck.push({ x: x + .5, y: .117, z: z + .5 });
        // Rails run the full length of both long edges, never across the
        // approach, so each side of the crossing reads as one straight line.
        for (const dz of [-1, 1]) if (!isBridge(x, z + dz)) rails.push({ x: x + .5, y: .1, z: z + .5 + dz * .49 });
      }
      if (isWater(x, z)) {
        if (h > .72 && this.rippleBases.length < 64) this.rippleBases.push({ x: x + .5, y: .007, z: z + .5, rotation: h });
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
          if (terrainAt(this.state.seed, this.state.currentArea, x + dx, z + dz) !== 'ground') continue;
          foam.push({ x: x + .5 + dx * .47, y: .009, z: z + .5 + dz * .47, rotation: dx ? Math.PI / 2 : 0, scale: .8 + h * .2 });
        }
      }
      if (kind !== 'ground' || isRoadPosition('0,0', x + .5, z + .5, .6)) continue;
      if (![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz]) => isWater(x + dx!, z + dz!))) continue;
      pebbles.push({ x: x + .25 + h * .5, y: -.025, z: z + .4, rotation: h * 6, scale: .6 + h });
      if (h > .25) reeds.push({ x: x + .5, y: -.04, z: z + .5, rotation: h * 6, scale: .9 + h * .4 });
    }
    void this.batch('entrance.pebble', pebbles);
    void this.batch('entrance.fern', reeds);
    // Source floor is 2m wide and .02m high: normalize to an exact 1m tile.
    void this.batch('entrance.deck', deck, .0101);
    void this.batch('entrance.railing', rails, .4);
    void this.batch('entrance.path-stone',approachStones,.06);
    if (foam.length) {
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(.9, .065),
        new THREE.MeshBasicMaterial({ color: 0xc9ddba, transparent: true, opacity: .32, depthWrite: false }), foam.length);
      mesh.name = 'entrance.shoreline';
      foam.forEach((p,i) => {
        this.transform.position.set(p.x,p.y,p.z); this.transform.rotation.set(-Math.PI / 2,0,p.rotation ?? 0);
        this.transform.scale.setScalar(p.scale ?? 1); this.transform.updateMatrix(); mesh.setMatrixAt(i,this.transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true; this.root.add(mesh);
    }
    this.ripples.count = this.rippleBases.length;
  }

  private buildGate(): void {
    const timber = new THREE.MeshStandardMaterial({ color: 0x493b2b, roughness: .95 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x8e8b72, roughness: 1 });
    // Posts stand just outside the gate's hinges, so the frame, the gate, the
    // bridge and the road all share one centre line and one width.
    const { x: gateX, top, bottom } = ELARIS_WEST_ENTRANCE;
    const postX = gateX + .2, centre = (top + bottom) / 2;
    for (const z of [top - .15, bottom + .15]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(.65,.65,.65),stone); base.position.set(postX,.3,z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(.23,3.5,.23),timber); post.position.set(postX,1.9,z);
      base.castShadow = post.castShadow = true; base.receiveShadow = true;
      this.root.add(base,post);
      void this.model(this.root,'town.lantern',postX-.33,2.55,z,.55).catch(console.warn);
      const glow = new THREE.PointLight(0xffc47c,.8,3,2); glow.position.set(postX-.3,2.6,z); this.root.add(glow);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(.27,.25,bottom-top+.9),timber); beam.position.set(postX,3.65,centre); beam.castShadow=true;
    this.root.add(beam);
  }

  /**
   * Quaternius modular forge on the shared walk-in shell: the walls stand on
   * the same lines the simulation collides with, and the doorway is the one
   * the player walks through. The leaf itself is hung by the renderer so it
   * can swing.
   */
  async buildForge(group: THREE.Group, building: TownBuildingDefinition, ruined: boolean): Promise<THREE.Material[]> {
    if (ruined) group.scale.y = .62;
    const shell = townBuildingShell(building);
    const width = shell.right - shell.left, depth = shell.bottom - shell.top, wallHeight = 2.4;
    const jobs: Promise<THREE.Group>[] = [];
    const modules = new Map<string, {key:ModelAssetKey;height:number|undefined;fit:{width:number;depth?:number}|undefined;placements:ModelPlacement[]}>();
    const add = (key: ModelAssetKey,x:number,y:number,z:number,height?:number,rotation=0,fit?:{width:number;depth?:number}) => {
      const id = `${key}:${height}:${fit?.width}:${fit?.depth}`;
      const batch = modules.get(id) ?? {key,height,fit,placements:[]};
      batch.placements.push({x,y,z,rotation}); modules.set(id,batch);
    };
    for (const piece of settlementModules(building)) {
      if (piece.key === 'entrance.roof' || piece.key === 'town.lantern') continue;
      add(piece.key, piece.x, piece.y, piece.z, piece.height, piece.rotation ?? 0,
        piece.width === undefined ? undefined : {width: piece.width});
    }
    let lining: THREE.Group | null = null;
    if (!ruined) {
      add('entrance.roof',0,wallHeight-.05,0,2.1,0,{width:width+.65,depth:depth+.7});
      lining = addRoofUnderside(group, width + .63, depth + .68, wallHeight - .06);
      add('entrance.chimney',1.9,2.65,-.75,2.8);
    }
    add('entrance.vine',-width/2-.08,.3,.55,1.7,-Math.PI/2);
    add('entrance.wagon',-1.45,0,-depth/2-.7,.95,Math.PI/2);
    const doorAlong = shell.door.along - shell.tilesWide / 2;
    add('town.lantern',doorAlong+1.05,1.62,depth/2+.25,.6);
    // The foundation's top is flush with the room floor.
    const foundation = new THREE.Mesh(new THREE.BoxGeometry(width+.14,.18,depth+.14),
      new THREE.MeshStandardMaterial({color:0x68675a,roughness:1}));
    foundation.position.y=-.07; foundation.receiveShadow=true; group.add(foundation);
    // A shallow forge opening with emissive coals adds depth without a shadow light.
    const recess = new THREE.Mesh(new THREE.BoxGeometry(.85,.78,.12), new THREE.MeshStandardMaterial({color:0x231d18,roughness:1}));
    recess.position.set(-1.6,.7,depth/2+.13); group.add(recess);
    const coals = new THREE.Mesh(new THREE.PlaneGeometry(.61,.39),new THREE.MeshStandardMaterial({
      color:0xd97838,emissive:0xff6b20,emissiveIntensity:ruined?0:2.5,roughness:1}));
    coals.position.set(-1.6,.48,depth/2+.2); group.add(coals);
    this.forgeGlow.position.set(-1.6,1,depth/2+.65); this.forgeGlow.visible=!ruined; group.add(this.forgeGlow);
    this.smoke.visible=!ruined;
    this.smokeOrigin.set(group.position.x+1.9,5.45,group.position.z-.75);
    for (const {key,height,fit,placements} of modules.values()) {
      if (placements.length === 1) {
        const p = placements[0]!;
        jobs.push(this.model(group,key,p.x,p.y,p.z,height,p.rotation,fit));
      } else {
        jobs.push(this.models.instantiateBatch(key,placements,height,fit).then(batch=>{
          if (this.disposed) { this.disposeMaterials(batch); return batch; }
          batch.traverse(child=>{if(child instanceof THREE.Mesh)child.castShadow=true;});
          group.add(batch); return batch;
        }));
      }
    }
    const models = await Promise.allSettled(jobs);
    const materials = new Set<THREE.Material>();
    lining?.traverse(child => { if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) materials.add(child.material); });
    for (const result of models) {
      if(result.status==='rejected') { console.warn('[3d] Unable to load forge module', result.reason); continue; }
      result.value.traverse(child=>{
        if(!(child instanceof THREE.Mesh))return;
        for(const material of Array.isArray(child.material)?child.material:[child.material]) {
          if(ruined && material instanceof THREE.MeshStandardMaterial) material.color.multiplyScalar(.48);
          materials.add(material);
        }
      });
    }
    materials.add(foundation.material); materials.add(recess.material); materials.add(coals.material);
    group.userData.entranceForgeReady = true;
    group.userData.doorTile = building.door;
    return [...materials];
  }

  update(time: number, reducedMotion: boolean): void {
    const seconds = reducedMotion ? 0 : time / 1000;
    for(let i=0;i<18;i++) {
      const age = ((seconds*.15+i/18)%1);
      this.smokePositions.set([this.smokeOrigin.x + age*1.4 + Math.sin(i*2.3+seconds*.3)*age*.2,
        this.smokeOrigin.y+age*3.1, this.smokeOrigin.z+age*.45],i*3);
    }
    (this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate=true;
    this.forgeGlow.intensity=3.1+(reducedMotion?0:Math.sin(seconds*7)*.18);
    this.rippleBases.forEach((p,i)=>{
      this.transform.position.set(p.x+Math.sin(seconds*.3+i)*.12,p.y,p.z+Math.cos(seconds*.2+i)*.08);
      this.transform.rotation.set(-Math.PI/2,0,.1);
      this.transform.scale.set(0.6+Math.sin(seconds*.7+i)*.25,1,1);
      this.transform.updateMatrix(); this.ripples.setMatrixAt(i,this.transform.matrix);
    });
    this.ripples.instanceMatrix.needsUpdate=true;
  }

  /** Called before the renderer disposes the root's geometry and materials. */
  retire(): void { this.disposed = true; }

  private disposeMaterials(root: THREE.Object3D): void {
    const materials = new Set<THREE.Material>();
    root.traverse(child=>{if(child instanceof THREE.Mesh) for(const m of Array.isArray(child.material)?child.material:[child.material])materials.add(m);});
    for(const material of materials)material.dispose();
  }
}
