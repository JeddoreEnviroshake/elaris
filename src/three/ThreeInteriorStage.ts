import * as THREE from 'three';
import {MotionTracker,turnTowards} from './animationMotion';
import {creatureStride} from './creatureAnimation';
import type { ModelLibrary } from './modelLibrary';
import { QuaterniusArt } from './quaterniusArt';
import type { InteriorDefinition, InteriorNpcActivity, InteriorPropPrefab } from '../content/interiors';
import { npcDefinition, type NpcId } from '../content/npcs';
import { townBuildingById } from '../content/townBuildings';
import type { InteriorPose } from '../presentation/interiorSession';
import { createCreatureRig, createPlayerRig, type CreatureRig, type PlayerRig } from './characterRigs';

export interface InteriorStageFrame {
  readonly definition: InteriorDefinition;
  readonly pose: InteriorPose;
  readonly focusedHotspotId: string | null;
}

export interface InteriorCompositionSnapshot {
  readonly definitionId: string | null;
  readonly propPrefabs: readonly InteriorPropPrefab[];
  readonly npcIds: readonly NpcId[];
  readonly ambientActors: number;
  readonly effectParticles: number;
  readonly visibleEffectParticles: number;
  readonly meshCount: number;
  readonly triangleCount: number;
  readonly animatedObjects: number;
  readonly dynamicLights: number;
  readonly mobileProfile: boolean;
  readonly disposedResources: number;
}

export const INTERIOR_MOBILE_BUDGET = {
  effectParticles: 8,
  ambientActors: 4,
  animatedObjects: 12,
  dynamicLights: 4,
  triangles: 32_000,
} as const;

interface NpcVisual {
  readonly npcId: NpcId;
  readonly activity: InteriorNpcActivity;
  readonly rig: PlayerRig;
  readonly baseRotation: number;
}

interface AmbientActor {
  readonly rig: PlayerRig;
  readonly phase: number;
}

interface CreatureVisual {
  readonly rig: CreatureRig;
  readonly phase: number;
  readonly baseX: number;
  readonly baseZ: number;
}

interface AnimatedObject {
  readonly object: THREE.Object3D;
  readonly kind: 'float' | 'rune' | 'flame' | 'banner';
  readonly baseY: number;
  readonly phase: number;
}

interface EffectParticle {
  readonly mesh: THREE.Mesh;
  readonly base: THREE.Vector3;
  readonly phase: number;
  readonly rise: number;
}

/** Data-driven semantic 3D composer shared by all authored town interiors. */
export class ThreeInteriorStage {
  readonly root = new THREE.Group();
  private definitionId: string | null = null;
  private readonly hotspotRings = new Map<string, THREE.Mesh>();
  private readonly npcVisuals: NpcVisual[] = [];
  private readonly ambientActors: AmbientActor[] = [];
  private readonly creatures: CreatureVisual[] = [];
  private readonly animatedObjects: AnimatedObject[] = [];
  private readonly particles: EffectParticle[] = [];
  private readonly dynamicLights: THREE.PointLight[] = [];
  private propPrefabs: InteriorPropPrefab[] = [];
  private mobileProfile = false;
  private disposedResources = 0;
  private art: QuaterniusArt | null = null;
  private readonly motionTracker=new MotionTracker();

  constructor(private readonly models?: ModelLibrary) {
    this.root.name = 'interior-stage';
    this.root.visible = false;
  }

  show(frame: InteriorStageFrame, timeMs: number, reducedMotion: boolean, mobileProfile = false): void {
    if (this.definitionId !== frame.definition.id) this.build(frame.definition);
    this.mobileProfile = mobileProfile;
    this.root.visible = true;
    const focused = frame.definition.hotspots.find((hotspot) => hotspot.id === frame.focusedHotspotId) ?? null;
    for (const [id, ring] of this.hotspotRings) {
      const active = id === frame.focusedHotspotId;
      ring.visible = active;
      const pulse = reducedMotion ? 1 : 1 + Math.sin(timeMs * 0.006) * 0.08;
      ring.scale.setScalar(active ? pulse : 1);
    }

    for (const visual of this.npcVisuals) {
      const acknowledged = focused?.kind === 'service' && focused.npcId === visual.npcId;
      const activeWork = timeMs % 3_800 < 2_450;
      const motion = activeWork?visual.activity==='arcane-study'?'cast':['hammering','armour-drill','coaching'].includes(visual.activity)?'gather':'idle':'idle';
      visual.rig.animate(timeMs, motion, reducedMotion);
      visual.rig.root.rotation.y = acknowledged
        ? Math.atan2(frame.pose.x - visual.rig.root.position.x, frame.pose.y - visual.rig.root.position.z)
        : visual.baseRotation;
      visual.rig.root.scale.setScalar(acknowledged && !reducedMotion ? 1 + Math.sin(timeMs * 0.008) * 0.018 : 1);
    }
    for (let index = 0; index < this.ambientActors.length; index += 1) {
      const actor = this.ambientActors[index]!;
      actor.rig.root.visible = !mobileProfile || index < INTERIOR_MOBILE_BUDGET.ambientActors;
      if (actor.rig.root.visible) actor.rig.animate(timeMs + actor.phase, 'idle', reducedMotion);
    }
    for (let index = 0; index < this.creatures.length; index += 1) {
      const creature = this.creatures[index]!;
      creature.rig.root.visible = !mobileProfile || index + this.ambientActors.length < INTERIOR_MOBILE_BUDGET.ambientActors;
      if (!creature.rig.root.visible) continue;
      const walking = !reducedMotion && Math.sin(timeMs * 0.0012 + creature.phase) > 0.7;
      const oldX=creature.rig.root.position.x,oldZ=creature.rig.root.position.z;
      if (walking) {
        creature.rig.root.position.x = creature.baseX + Math.sin(timeMs * 0.00055 + creature.phase) * 0.35;
        creature.rig.root.position.z = creature.baseZ + Math.cos(timeMs * 0.00045 + creature.phase) * 0.25;
      }
      const dx=creature.rig.root.position.x-oldX,dz=creature.rig.root.position.z-oldZ;
      const heading=Math.hypot(dx,dz)>.001?Math.atan2(-dx,-dz):creature.rig.root.rotation.y;
      const frame=this.motionTracker.sample(creature.rig.root,timeMs,creature.rig.root.position.x,creature.rig.root.position.z,heading,creatureStride(creature.rig.speciesId,this.motionTracker.speed(creature.rig.root)));
      creature.rig.root.rotation.y=reducedMotion?heading:turnTowards(creature.rig.root.rotation.y,heading,frame.deltaSeconds??1/60);
      creature.rig.animate(timeMs+creature.phase,(frame.speed??0)>.04?'walk':'idle',reducedMotion,frame);
    }
    for (let index = 0; index < this.animatedObjects.length; index += 1) {
      const animated = this.animatedObjects[index]!;
      animated.object.visible = !mobileProfile || index < INTERIOR_MOBILE_BUDGET.animatedObjects;
      if (!animated.object.visible) continue;
      if (reducedMotion) continue;
      const phase = timeMs * 0.001 + animated.phase;
      if (animated.kind === 'float') {
        animated.object.position.y = animated.baseY + Math.sin(phase * 1.8) * 0.18;
        animated.object.rotation.y += 0.006;
      } else if (animated.kind === 'rune') {
        animated.object.rotation.y += 0.004;
        animated.object.scale.setScalar(1 + Math.sin(phase * 2.2) * 0.04);
      } else if (animated.kind === 'flame') {
        animated.object.scale.y = 0.9 + Math.sin(phase * 7) * 0.18;
      } else animated.object.rotation.z = Math.sin(phase * 1.3) * 0.035;
    }
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index]!;
      particle.mesh.visible = !reducedMotion && (!mobileProfile || index < INTERIOR_MOBILE_BUDGET.effectParticles);
      if (!particle.mesh.visible) continue;
      const phase = (timeMs * 0.00022 * particle.rise + particle.phase) % 1;
      particle.mesh.position.set(
        particle.base.x + Math.sin(particle.phase * 19 + phase * Math.PI * 2) * 0.3,
        particle.base.y + phase * particle.rise,
        particle.base.z + Math.cos(particle.phase * 13 + phase * Math.PI * 2) * 0.24,
      );
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - phase);
    }
    for (let index = 0; index < this.dynamicLights.length; index += 1) {
      const light = this.dynamicLights[index]!;
      light.intensity = reducedMotion ? light.userData.baseIntensity : light.userData.baseIntensity * (0.9 + Math.sin(timeMs * 0.014 + index) * 0.1);
    }
  }

  hide(): void { this.root.visible = false; }
  dispose(): void { this.clear(); }

  getCompositionSnapshot(): InteriorCompositionSnapshot {
    let meshCount = 0;
    let triangleCount = 0;
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshCount += 1;
      const geometry = object.geometry;
      const vertices = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
      triangleCount += Math.floor(vertices / 3);
    });
    return {
      definitionId: this.definitionId,
      propPrefabs: [...this.propPrefabs],
      npcIds: this.npcVisuals.map((visual) => visual.npcId),
      ambientActors: this.ambientActors.length + this.creatures.length,
      effectParticles: this.particles.length,
      visibleEffectParticles: this.particles.filter(({ mesh }) => mesh.visible).length,
      meshCount,
      triangleCount,
      animatedObjects: this.animatedObjects.filter(({ object }) => object.visible).length,
      dynamicLights: this.dynamicLights.length,
      mobileProfile: this.mobileProfile,
      disposedResources: this.disposedResources,
    };
  }

  private build(definition: InteriorDefinition): void {
    this.clear();
    this.art = this.models ? new QuaterniusArt(this.models, this.root) : null;
    this.definitionId = definition.id;
    this.propPrefabs = definition.props.map((prop) => prop.prefab);
    const theme = townBuildingById(definition.buildingId).interiorTheme;
    const width = definition.dimensions.tilesWide;
    const depth = definition.dimensions.tilesHigh;
    const floorColor = colorOf(theme.surface, theme.exteriorWall);
    const wallColor = colorOf(theme.background, theme.exteriorRoof);
    const accentColor = colorOf(theme.accent, theme.exteriorAccent);
    const glowColor = colorOf(theme.glow, definition.ambience.keyLightColor);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.95 }),
    );
    floor.name = `room-floor:${definition.id}`;
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width / 2, 0, depth / 2);
    floor.receiveShadow = true;
    this.root.add(floor);
    const timberRoom = ['tavern', 'farm', 'market'].includes(definition.buildingId);
    const uv = floor.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / 2, uv.getY(i) * depth / 2);
    void this.art?.surface(floor, timberRoom ? 'entrance.deck' : 'entrance.paving', timberRoom ? .7 : .55);
    this.buildWalls(definition, new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.98 }));
    for (const wall of this.root.children) if (wall instanceof THREE.Mesh && wall !== floor) {
      void this.art?.surface(wall, 'entrance.wall', .5);
    }
    if (this.art && definition.buildingId !== 'arena') {
      const count = Math.ceil(width / 1.7);
      const panes=Array.from({length:count}, (_,i) => ({
        x:(i+.5)*width/count, y:0, z:.08,
      })).filter(p=>definition.exit.tileY!==0||Math.abs(p.x-(definition.exit.tileX+.5))>1.25);
      void this.art.batch(this.root, 'entrance.wall-window', panes, 2.7, {width:width/count}, true);
      if(definition.exit.tileY===0)void this.art.add(this.root,{key:'detail.arch-frame',x:definition.exit.tileX+.5,y:0,z:.08,height:2.4,width:1.85});
    }
    if(['tavern','church','magic-shop'].includes(definition.buildingId)) this.addRug(width,depth,definition.buildingId==='tavern'?0x744e43:definition.buildingId==='church'?0x4a6473:0x65516f);

    for (const prop of definition.props) {
      const propRoot = new THREE.Group();
      propRoot.name = `interior-prop:${prop.prefab}:${prop.id}`;
      propRoot.position.set(prop.tileX + 0.5, 0, prop.tileY + 0.5);
      propRoot.rotation.y = THREE.MathUtils.degToRad(prop.rotationDegrees);
      this.buildProp(propRoot, prop.prefab, { floor: floorColor, wall: wallColor, accent: accentColor, glow: glowColor }, definition);
      this.root.add(propRoot);
    }

    const exitMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(1.55, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x4a7590, emissive: 0x17394d, emissiveIntensity: 0.6, roughness: 0.85 }),
    );
    exitMarker.name = 'interior-exit-marker';
    exitMarker.rotation.x = -Math.PI / 2;
    exitMarker.position.set(definition.exit.tileX + 0.5, 0.025, definition.exit.tileY + 0.5);
    this.root.add(exitMarker);

    for (const hotspot of definition.hotspots) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.48, 0.62, 24),
        new THREE.MeshBasicMaterial({ color: hotspot.kind === 'exit' ? 0x8dd4ff : accentColor, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
      );
      ring.name = `hotspot:${hotspot.id}`;
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(hotspot.tileX + 0.5, 0.04, hotspot.tileY + 0.5);
      ring.visible = false;
      this.hotspotRings.set(hotspot.id, ring);
      this.root.add(ring);
    }

    for (const spawn of definition.npcSpawns) this.addNpc(spawn.npcId, spawn.activity, spawn.tileX + 0.5, spawn.tileY + 0.5, spawn.facing);
    this.addAmbientPresence(definition);
    this.addEffects(definition, glowColor);

    const ambient = new THREE.HemisphereLight(definition.ambience.keyLightColor, definition.ambience.ambientColor, 1.15);
    ambient.name = 'interior-ambient-light';
    this.root.add(ambient);
    const key = new THREE.PointLight(definition.ambience.keyLightColor, definition.ambience.keyLightIntensity * 2.1, Math.max(width, depth) * 1.6, 2);
    key.name = 'interior-key-light';
    key.position.set(width * 0.52, 5.5, depth * 0.48);
    this.root.add(key);
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) object.frustumCulled = true;
    });
  }

  private buildWalls(definition: InteriorDefinition, material: THREE.Material): void {
    const width = definition.dimensions.tilesWide;
    const depth = definition.dimensions.tilesHigh;
    const height = definition.buildingId === 'arena' ? 1.2 : 2.8;
    this.addBox(this.root, 0.24, height, depth, 0, height / 2, depth / 2, material);
    this.addBox(this.root, 0.24, Math.min(height,1.05), depth, width, Math.min(height,1.05) / 2, depth / 2, material);
    const exitCenter = definition.exit.tileX + 0.5;
    if (definition.exit.tileY === depth - 1 || definition.exit.tileY === 0) {
      const z = definition.exit.tileY === 0 ? 0 : depth;
      const left = Math.max(0, exitCenter - 0.9);
      const right = Math.max(0, width - exitCenter - 0.9);
      const entryHeight=z===depth?Math.min(height,1.05):height;
      if (left > 0) this.addBox(this.root, left, entryHeight, 0.24, left / 2, entryHeight / 2, z, material);
      if (right > 0) this.addBox(this.root, right, entryHeight, 0.24, exitCenter + 0.9 + right / 2, entryHeight / 2, z, material);
      const oppositeZ = z === 0 ? depth : 0;
      const oppositeHeight=oppositeZ===depth?Math.min(height,1.05):height;
      this.addBox(this.root, width, oppositeHeight, 0.24, width / 2, oppositeHeight / 2, oppositeZ, material);
    } else {
      this.addBox(this.root, width, height, 0.24, width / 2, height / 2, 0, material);
      this.addBox(this.root, width, height, 0.24, width / 2, height / 2, depth, material);
    }
  }

  private addRug(width:number,depth:number,color:number):void {
    const pixels=new Uint8Array(64*64*4);
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const edge=Math.min(x,y,63-x,63-y);
      const decorative=edge<2||(edge>4&&edge<7)||((Math.abs(x-32)+Math.abs(y-32)<9)&&((x+y)%4<2));
      const hex=decorative?0xc6aa70:color, offset=(y*64+x)*4;
      const weave=(x+y)%2?.94:1;
      pixels[offset]=((hex>>16)&255)*weave;pixels[offset+1]=((hex>>8)&255)*weave;pixels[offset+2]=(hex&255)*weave;pixels[offset+3]=255;
    }
    const texture=new THREE.DataTexture(pixels,64,64);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
    const rug=new THREE.Mesh(new THREE.PlaneGeometry(width*.46,depth*.32),new THREE.MeshStandardMaterial({map:texture,roughness:1}));
    rug.name='interior.woven-rug';rug.rotation.x=-Math.PI/2;rug.position.set(width*.5,.018,depth*.55);rug.receiveShadow=true;this.root.add(rug);
  }

  private buildProp(
    root: THREE.Group,
    prefab: InteriorPropPrefab,
    colors: { floor: number; wall: number; accent: number; glow: number },
    definition: InteriorDefinition,
  ): void {
    const wood = material(0x6c452d);
    const darkWood = material(0x3e2a20);
    const metal = material(0x8c9998, 0.55);
    const stone = material(0x646866);
    const cloth = material(colors.accent, 0.82);
    const glow = new THREE.MeshStandardMaterial({ color: colors.glow, emissive: colors.glow, emissiveIntensity: 1.4, roughness: 0.45 });
    switch (prefab) {
      case 'forge':
      case 'hearth': {
        this.addBox(root, prefab === 'forge' ? 2.6 : 1.55, 0.85, 1.5, 0, 0.43, 0, material(0x61372c));
        const fire = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.85, 7), glow);
        fire.position.set(0, 1.02, 0);
        root.add(fire);
        this.animatedObjects.push({ object: fire, kind: 'flame', baseY: fire.position.y, phase: root.position.x });
        this.addDynamicLight(root, colors.glow, 3.8, 7, 0, 1.4, 0.2);
        break;
      }
      case 'anvil':
        this.addBox(root, 1.25, 0.28, 0.48, 0, 0.82, 0, metal);
        this.addBox(root, 0.52, 0.65, 0.38, 0, 0.42, 0, darkWood);
        this.addBox(root, 0.72, 0.12, 0.62, 0, 0.06, 0, stone);
        break;
      case 'workbench':
      case 'counter':
      case 'ledger-desk': {
        const length = prefab === 'counter' ? 2.8 : 2.2;
        this.addBox(root, length, 0.18, 0.78, 0, 0.82, 0, wood);
        for (const x of [-length * 0.38, length * 0.38]) this.addBox(root, 0.16, 0.8, 0.16, x, 0.4, 0, darkWood);
        if (prefab === 'ledger-desk') {
          const book = this.bookMesh(0x7c3e2d);
          book.position.set(0, 0.98, 0);
          book.rotation.y = Math.PI / 8;
          root.add(book);
        }
        break;
      }
      case 'tool-rack':
      case 'armour-rack':
      case 'bookcase':
      case 'shelf': {
        this.addBox(root, 1.55, 2.2, 0.28, 0, 1.1, 0, darkWood);
        for (const y of [0.38, 0.95, 1.52, 2.08]) this.addBox(root, 1.65, 0.1, 0.48, 0, y, 0.12, wood);
        for (let index = 0; index < 5; index += 1) {
          const item = prefab === 'bookcase'
            ? this.bookMesh(index % 2 ? colors.accent : 0x8b4937)
            : new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.56, 0.12), prefab === 'armour-rack' ? metal : material(0xaeb8b5, 0.58));
          item.position.set(-0.58 + index * 0.29, 1.35 + (index % 2) * 0.25, 0.32);
          root.add(item);
        }
        break;
      }
      case 'barrel': {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.85, 10), wood);
        barrel.position.y = 0.43;
        root.add(barrel);
        for (const y of [0.18, 0.67]) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.035, 5, 12), metal);
          band.rotation.x = Math.PI / 2;
          band.position.y = y;
          root.add(band);
        }
        break;
      }
      case 'crate':
      case 'produce-crates': {
        for (let index = 0; index < (prefab === 'produce-crates' ? 3 : 1); index += 1) {
          this.addBox(root, 0.85, 0.55, 0.72, (index - 1) * 0.72, 0.28 + (index === 1 ? 0.3 : 0), 0, wood);
          if (prefab === 'produce-crates') for (let fruit = 0; fruit < 3; fruit += 1) {
            const produce = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), material(fruit % 2 ? 0xd8a43d : 0x7dad55));
            produce.position.set((index - 1) * 0.72 - 0.2 + fruit * 0.2, 0.65 + (index === 1 ? 0.3 : 0), 0);
            root.add(produce);
          }
        }
        break;
      }
      case 'feed-sacks':
        for (let index = 0; index < 4; index += 1) {
          const sack = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), material(0xb79a62));
          sack.scale.set(0.8, 1.25, 0.65);
          sack.position.set((index % 2) * 0.55, 0.38 + Math.floor(index / 2) * 0.45, Math.floor(index / 2) * 0.12);
          root.add(sack);
        }
        break;
      case 'animal-pen':
        for (const [x, z, rotation] of [[0, -1.25, 0], [0, 1.25, 0], [-1.25, 0, Math.PI / 2], [1.25, 0, Math.PI / 2]] as const) {
          const rail = new THREE.Group(); rail.position.set(x, 0, z); rail.rotation.y = rotation;
          this.addBox(rail, 2.5, 0.12, 0.12, 0, 0.42, 0, wood);
          for (const px of [-1.12, 1.12]) this.addBox(rail, 0.13, 0.85, 0.13, px, 0.42, 0, darkWood);
          root.add(rail);
        }
        break;
      case 'market-stall':
        this.addBox(root, 2.5, 0.75, 0.8, 0, 0.38, 0, wood);
        for (const x of [-1.05, 1.05]) this.addBox(root, 0.1, 2.2, 0.1, x, 1.1, 0, darkWood);
        this.addBox(root, 2.8, 0.12, 1.35, 0, 2.15, 0, cloth);
        break;
      case 'merchant-scale': {
        this.addBox(root, 0.1, 1.15, 0.1, 0, 0.58, 0, metal);
        this.addBox(root, 1.15, 0.08, 0.08, 0, 1.05, 0, metal);
        for (const x of [-0.48, 0.48]) {
          const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 12), metal);
          plate.position.set(x, 0.7, 0);
          root.add(plate);
        }
        break;
      }
      case 'pew':
      case 'spectator-bench':
        this.addBox(root, prefab === 'pew' ? 2.7 : 2.2, 0.16, 0.55, 0, 0.62, 0, wood);
        this.addBox(root, prefab === 'pew' ? 2.7 : 2.2, 0.65, 0.13, 0, 0.92, 0.27, darkWood);
        break;
      case 'altar':
        this.addBox(root, 2.35, 0.9, 0.85, 0, 0.45, 0, material(0xb8aea0));
        this.addBox(root, 2.5, 0.1, 1, 0, 0.95, 0, cloth);
        break;
      case 'candle-stand':
        this.addBox(root, 1.3, 0.1, 0.55, 0, 0.7, 0, metal);
        for (const x of [-0.45, 0, 0.45]) {
          this.addBox(root, 0.08, 0.55 + Math.abs(x) * 0.25, 0.08, x, 0.98, 0, material(0xf4e0a8));
          const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), glow);
          flame.position.set(x, 1.3 + Math.abs(x) * 0.25, 0);
          root.add(flame);
          this.animatedObjects.push({ object: flame, kind: 'flame', baseY: flame.position.y, phase: x * 9 });
        }
        this.addDynamicLight(root, colors.glow, 1.8, 4, 0, 1.4, 0);
        break;
      case 'stained-window': {
        const window = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.5), new THREE.MeshBasicMaterial({ color: colors.glow, transparent: true, opacity: 0.68, side: THREE.DoubleSide }));
        window.position.y = 1.7;
        root.add(window);
        this.addDynamicLight(root, colors.glow, 2.2, 7, 0, 1.4, 1.3);
        break;
      }
      case 'shield-display': {
        const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.48, 0.12, 7), metal);
        shield.rotation.x = Math.PI / 2;
        shield.position.y = 1.2;
        root.add(shield);
        break;
      }
      case 'practice-dummy':
        this.addBox(root, 0.18, 1.8, 0.18, 0, 0.9, 0, wood);
        this.addBox(root, 1.25, 0.14, 0.14, 0, 1.35, 0, wood);
        root.add(this.sphere(0.27, 0, 1.85, 0, material(0xb89b6a)));
        break;
      case 'rune-circle': {
        const rune = new THREE.Group();
        for (const radius of [0.65, 1.05, 1.42]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 6, 32), glow);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.035;
          rune.add(ring);
        }
        root.add(rune);
        this.animatedObjects.push({ object: rune, kind: 'rune', baseY: 0, phase: root.position.x });
        this.addDynamicLight(root, colors.glow, 3.1, 8, 0, 1.2, 0);
        break;
      }
      case 'staff-display':
        this.addBox(root, 1.65, 0.18, 0.75, 0, 0.1, 0, darkWood);
        this.addBox(root, 0.09, 1.9, 0.09, 0, 1.05, 0, wood);
        root.add(this.sphere(0.16, 0, 2.05, 0, glow));
        this.addDynamicLight(root, colors.glow, 2.1, 5, 0, 1.8, 0);
        break;
      case 'floating-books':
        for (let index = 0; index < 4; index += 1) {
          const book = this.bookMesh(index % 2 ? colors.accent : 0x874d6d);
          book.position.set(-0.8 + index * 0.52, 1.2 + (index % 2) * 0.42, Math.sin(index) * 0.4);
          book.rotation.set(0.15, index * 0.8, 0.08);
          root.add(book);
          this.animatedObjects.push({ object: book, kind: 'float', baseY: book.position.y, phase: index * 1.7 });
        }
        break;
      case 'tavern-table': {
        const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.16, 12), wood); top.position.y = 0.78; root.add(top);
        this.addBox(root, 0.22, 0.78, 0.22, 0, 0.39, 0, darkWood);
        break;
      }
      case 'stool': {
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.14, 10), wood); seat.position.y = 0.58; root.add(seat);
        this.addBox(root, 0.14, 0.58, 0.14, 0, 0.29, 0, darkWood);
        break;
      }
      case 'notice-board':
        this.addBox(root, 1.65, 1.25, 0.12, 0, 1.15, 0, wood);
        for (const [x, y] of [[-0.42, 1.3], [0.35, 1.48], [0, 0.92]] as const) this.addBox(root, 0.48, 0.33, 0.03, x, y, -0.08, material(0xd5c59b));
        break;
      case 'arena-ring': {
        const sand = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.55, 0.12, 28), material(0xb38b5d));
        sand.position.set(2.5, 0.06, 0.5);
        root.add(sand);
        for (const [x, z] of [[-0.6, -2.6], [5.6, -2.6], [-0.6, 3.6], [5.6, 3.6]] as const) {
          this.addBox(root, 0.16, 1.35, 0.16, x, 0.67, z, darkWood);
        }
        break;
      }
      case 'training-post':
        this.addBox(root, 0.32, 2.05, 0.32, 0, 1.02, 0, wood);
        for (const y of [0.55, 1.1, 1.65]) {
          const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 5, 10), cloth); wrap.rotation.x = Math.PI / 2; wrap.position.y = y; root.add(wrap);
        }
        break;
      case 'banner': {
        this.addBox(root, 0.1, 2.45, 0.1, 0, 1.22, 0, darkWood);
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.75), cloth); banner.position.set(0, 1.55, 0.04); root.add(banner);
        this.animatedObjects.push({ object: banner, kind: 'banner', baseY: banner.position.y, phase: 2 });
        break;
      }
    }
    root.userData.definitionId = definition.id;
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.material === wood || child.material === darkWood) void this.art?.surface(child, 'entrance.deck', .55);
      else if (child.material === stone || ((prefab === 'forge' || prefab === 'hearth')
        && child.geometry instanceof THREE.BoxGeometry)) void this.art?.surface(child, 'entrance.paving', .35);
    });
    if (this.art && (prefab === 'crate' || prefab === 'produce-crates')) {
      const boxes = root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh
        && child.geometry instanceof THREE.BoxGeometry);
      for (const box of boxes) void this.art.add(root, {key:'entrance.crate',x:box.position.x,y:box.position.y-.275,
        z:box.position.z,height:.55,width:.85,depth:.72}).then((model) => { if (model) box.visible = false; });
    }
    root.userData.visualStyle = 'quaternius';
  }

  private addNpc(npcId: NpcId, activity: InteriorNpcActivity, x: number, z: number, facing: InteriorPose['facing']): void {
    const npc = npcDefinition(npcId);
    const rig = createPlayerRig({
      cloth: colorOf(npc.appearance.primaryColor, 0x754c3d),
      leather: colorOf(npc.appearance.accentColor, 0x41322a), skin: 0xb97c52, boot: 0x201815, cloak: 0x3b2a25,
    });
    rig.root.name = `interior-npc:${npcId}`;
    rig.root.position.set(x, 0.04, z);
    const rotation = facingRotation(facing);
    rig.root.rotation.y = rotation;
    if (activity === 'hammering') rig.setGatherTool('pickaxe');
    else if (activity === 'armour-drill' || activity === 'coaching') rig.setGatherTool('axe');
    else if (activity === 'arcane-study') rig.setGatherTool('staff');
    else rig.setGatherTool('hands');
    this.root.add(rig.root);
    const label = this.createLabel(npc.name, npc.appearance.primaryColor, npc.appearance.accentColor);
    label.position.set(x, 2.15, z);
    this.root.add(label);
    this.npcVisuals.push({ npcId, activity, rig, baseRotation: rotation });
  }

  private addAmbientPresence(definition: InteriorDefinition): void {
    const effects = new Set(definition.ambience.effects);
    if (effects.has('animal-idles')) {
      for (const [speciesId, x, z, phase] of [['tuftle', 2.4, 3.8, 0], ['glade-stag', 11.4, 4.3, 2.5]] as const) {
        const rig = createCreatureRig(speciesId); rig.root.scale.setScalar(speciesId === 'tuftle' ? 0.8 : 0.65); rig.root.position.set(x, 0, z); this.root.add(rig.root);
        this.creatures.push({ rig, phase, baseX: x, baseZ: z });
      }
    }
    const actorPositions: Array<[number, number]> = effects.has('market-bustle')
      ? [[4.8, 3.5], [11.2, 6.6]]
      : definition.buildingId === 'tavern'
        ? [[4.1, 4.2], [5.2, 7.3]]
        : effects.has('crowd-motion')
          ? [[2, 4], [2, 8], [16, 4], [16, 8]]
          : [];
    actorPositions.forEach(([x, z], index) => {
      const rig = createPlayerRig({ cloth: index % 2 ? 0x54796d : 0x805346, leather: 0x3f3128, skin: 0xb9825e, boot: 0x241c18, cloak: 0x3d4c42 },'compact');
      rig.root.name = `interior-ambient-actor:${index}`;
      rig.root.position.set(x, 0.04, z);
      rig.root.rotation.y = index % 2 ? Math.PI / 2 : -Math.PI / 2;
      rig.root.scale.setScalar(effects.has('crowd-motion') ? 0.78 : 0.88);
      this.root.add(rig.root);
      this.ambientActors.push({ rig, phase: index * 830 });
    });
  }

  private addEffects(definition: InteriorDefinition, glowColor: number): void {
    const effects = new Set(definition.ambience.effects);
    const fiery = effects.has('forge-sparks') || effects.has('chimney-embers') || effects.has('hearth-embers');
    const arcane = effects.has('rune-drift') || effects.has('floating-pages');
    const metallic = effects.has('metal-glints');
    const count = fiery ? 18 : arcane ? 14 : metallic ? 10 : 8;
    for (let index = 0; index < count; index += 1) {
      const particleColor = fiery ? (index % 3 ? 0xff7a31 : 0xffe9a0) : arcane ? glowColor : metallic ? 0xe7f4ef : 0xe4c78f;
      const mesh = new THREE.Mesh(
        new THREE.TetrahedronGeometry(fiery ? 0.045 : 0.035),
        new THREE.MeshBasicMaterial({ color: particleColor, transparent: true, opacity: 0.7, depthWrite: false }),
      );
      const base = fiery
        ? new THREE.Vector3(definition.buildingId === 'tavern' ? 2 : 2.4, 0.55, definition.buildingId === 'tavern' ? 6 : 2.2)
        : new THREE.Vector3(1 + (index * 3.7) % Math.max(2, definition.dimensions.tilesWide - 2), 0.35, 1 + (index * 2.9) % Math.max(2, definition.dimensions.tilesHigh - 2));
      mesh.position.copy(base);
      this.root.add(mesh);
      this.particles.push({ mesh, base, phase: index / count, rise: fiery ? 1.7 : arcane ? 2.8 : 1.2 });
    }
  }

  private addDynamicLight(parent: THREE.Object3D, color: number, intensity: number, distance: number, x: number, y: number, z: number): void {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    light.userData.baseIntensity = intensity;
    parent.add(light);
    this.dynamicLights.push(light);
  }

  private addBox(parent: THREE.Object3D, width: number, height: number, depth: number, x: number, y: number, z: number, meshMaterial: THREE.Material): THREE.Mesh {
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), meshMaterial);
    box.position.set(x, y, z);
    box.castShadow = true;
    box.receiveShadow = true;
    parent.add(box);
    return box;
  }

  private sphere(radius: number, x: number, y: number, z: number, meshMaterial: THREE.Material): THREE.Mesh {
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), meshMaterial);
    sphere.position.set(x, y, z);
    sphere.castShadow = true;
    return sphere;
  }

  private bookMesh(color: number): THREE.Group {
    const book = new THREE.Group();
    this.addBox(book, 0.36, 0.08, 0.5, -0.18, 0, 0, material(color));
    this.addBox(book, 0.36, 0.08, 0.5, 0.18, 0, 0, material(color));
    return book;
  }

  private createLabel(text: string, background = '#30150b', foreground = '#ffe2b4'): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#183329';
      context.beginPath();
      context.roundRect(8, 8, 368, 64, 14);
      context.fill();
      context.strokeStyle=foreground;context.lineWidth=2;context.stroke();
      context.fillStyle=background;context.fillRect(23,25,4,30);
      context.fillStyle = '#f2e4c4';
      context.font = '400 30px Georgia, serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 192, 41);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(2.35, 0.49, 1);
    sprite.renderOrder = 12;
    return sprite;
  }

  private clear(): void {
    this.art?.retire();
    this.art = null;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      child.traverse((nested) => {
        if (nested instanceof THREE.Sprite) {
          if (nested.material.map) textures.add(nested.material.map);
          materials.add(nested.material);
        }
        if (nested instanceof THREE.Mesh) {
          if(nested.customDepthMaterial)materials.add(nested.customDepthMaterial);
          if(nested.customDistanceMaterial)materials.add(nested.customDistanceMaterial);
          if (nested instanceof THREE.InstancedMesh) nested.dispose();
          if (!nested.userData.sharedModelGeometry) geometries.add(nested.geometry);
          for (const nestedMaterial of Array.isArray(nested.material) ? nested.material : [nested.material]) {
            materials.add(nestedMaterial);
            if (!nested.userData.sharedModelTextures && 'map' in nestedMaterial && nestedMaterial.map instanceof THREE.Texture) textures.add(nestedMaterial.map);
          }
        }
        if(nested instanceof THREE.Line){geometries.add(nested.geometry);for(const m of Array.isArray(nested.material)?nested.material:[nested.material])materials.add(m);}
      });
    }
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const nestedMaterial of materials) nestedMaterial.dispose();
    this.disposedResources += textures.size + geometries.size + materials.size;
    this.hotspotRings.clear();
    this.npcVisuals.length = 0;
    this.ambientActors.length = 0;
    this.creatures.length = 0;
    this.animatedObjects.length = 0;
    this.particles.length = 0;
    this.dynamicLights.length = 0;
    this.propPrefabs = [];
    this.mobileProfile = false;
    this.definitionId = null;
  }
}

function material(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

function colorOf(value: string, fallback: number): number {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  return match ? Number.parseInt(match[1]!, 16) : fallback;
}

function facingRotation(facing: InteriorPose['facing']): number {
  switch (facing) {
    case 'up': return Math.PI;
    case 'down': return 0;
    case 'left': return -Math.PI / 2;
    case 'right': return Math.PI / 2;
  }
}
