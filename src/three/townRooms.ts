import * as THREE from 'three';
import { MotionTracker, turnTowards } from './animationMotion';
import { creatureStride } from './creatureAnimation';
import type { ModelLibrary } from './modelLibrary';
import { QuaterniusArt } from './quaterniusArt';
import {
  INTERIOR_PROP_FOOTPRINTS,
  interiorDefinitionById,
  isInsideTownShell,
  shellDoorstep,
  townBuildingShell,
  type InteriorDefinition,
  type InteriorNpcActivity,
  type InteriorPropPrefab,
  type TownBuildingShell,
} from '../content/interiors';
import { npcDefinition, type NpcId } from '../content/npcs';
import type { TownBuildingDefinition } from '../content/townBuildings';
import type { Facing } from '../simulation/state';
import { createCreatureRig, createPlayerRig, type CreatureRig, type PlayerRig } from './characterRigs';

/** Everything a room needs from the frame: where the player is, and what they are focused on. */
export interface TownRoomFrame {
  /** Player position in tiles (three.js x/z). */
  readonly playerX: number;
  readonly playerZ: number;
  /** Hotspot id under the context action in this building, if any. */
  readonly focusedHotspotId: string | null;
  readonly timeMs: number;
  readonly reducedMotion: boolean;
  /** Eye-level view: keepers' name plates would fill the screen, so they hide. */
  readonly firstPerson: boolean;
}

export interface TownRoomSnapshot {
  readonly buildingId: string;
  readonly areaKey: string;
  readonly visible: boolean;
  readonly playerInside: boolean;
  readonly propPrefabs: readonly InteriorPropPrefab[];
  readonly npcIds: readonly NpcId[];
}

interface NpcVisual {
  readonly npcId: NpcId;
  readonly activity: InteriorNpcActivity;
  readonly rig: PlayerRig;
  readonly label: THREE.Sprite;
  readonly baseRotation: number;
}

interface AnimatedObject {
  readonly object: THREE.Object3D;
  readonly kind: 'float' | 'rune' | 'flame' | 'banner';
  readonly baseY: number;
  readonly phase: number;
}

interface CreatureVisual {
  readonly rig: CreatureRig;
  readonly phase: number;
  readonly baseX: number;
  readonly baseZ: number;
}

/** Furniture is only animated and drawn while the player is near enough to see it. */
const ROOM_VISIBLE_RADIUS = 13;
/** Overhead, a room shows through its open door within this many tiles of the doorstep. */
const ROOM_DOORWAY_VIEW_RADIUS = 3.5;

/**
 * The furnished room inside one walk-in town building, built in the world at
 * the building's footprint. It owns no lights — the renderer keeps a single
 * room light that it moves to whichever building the player is in — so adding
 * rooms never changes the scene's light count or recompiles a shader.
 */
export class TownRoom {
  readonly root = new THREE.Group();
  readonly shell: TownBuildingShell;
  readonly interior: InteriorDefinition | null;
  private readonly art: QuaterniusArt;
  private readonly npcVisuals: NpcVisual[] = [];
  private readonly patrons: PlayerRig[] = [];
  private readonly creatures: CreatureVisual[] = [];
  private readonly animatedObjects: AnimatedObject[] = [];
  private embers: { points: THREE.Points; bases: THREE.Vector3[]; rise: number } | null = null;
  private readonly motionTracker = new MotionTracker();
  private playerInside = false;
  /** Whether furniture currently casts sun shadows; null until first applied. */
  private furnitureShadows: boolean | null = null;
  private shadowRefreshCountdown = 0;

  constructor(models: ModelLibrary, readonly building: TownBuildingDefinition, readonly ruined: boolean) {
    this.shell = townBuildingShell(building);
    this.interior = ruined ? null : interiorDefinitionById(building.interiorId);
    this.root.name = `town-room:${building.id}`;
    this.root.position.set(building.footprint.tileX, 0, building.footprint.tileY);
    this.art = new QuaterniusArt(models, this.root);
    this.build();
  }

  /** Whether a three.js x/z point (tiles) is between this building's walls. */
  contains(x: number, z: number): boolean {
    return isInsideTownShell(this.shell, x - this.building.footprint.tileX, z - this.building.footprint.tileY);
  }

  get centre(): { x: number; z: number } {
    return {
      x: this.building.footprint.tileX + this.building.footprint.tilesWide / 2,
      z: this.building.footprint.tileY + this.building.footprint.tilesHigh / 2,
    };
  }

  update(frame: TownRoomFrame): void {
    const centre = this.centre;
    const localX = frame.playerX - this.building.footprint.tileX;
    const localZ = frame.playerZ - this.building.footprint.tileY;
    this.playerInside = this.contains(frame.playerX, frame.playerZ);
    const near = Math.hypot(frame.playerX - centre.x, frame.playerZ - centre.z) < ROOM_VISIBLE_RADIUS;
    // Overhead, a room is hidden under its roof unless the player is in it
    // (the roof is cut away) or at its open door. Eye level sees in through
    // doorways and windows from anywhere nearby. The open-air arena always shows.
    const doorway = shellDoorstep(this.shell);
    const atDoor = Math.hypot(localX - doorway.x, localZ - doorway.y) < ROOM_DOORWAY_VIEW_RADIUS;
    const visible = near && (this.playerInside || frame.firstPerson || atDoor || this.shell.kind === 'ring');
    this.root.visible = visible;
    if (!visible) return;
    this.syncFurnitureShadows(this.shell.kind === 'ring' || (this.playerInside && !frame.firstPerson));
    const { timeMs, reducedMotion } = frame;
    const focused = this.interior?.hotspots.find((hotspot) => hotspot.id === frame.focusedHotspotId) ?? null;

    for (const visual of this.npcVisuals) {
      const acknowledged = focused?.kind === 'service' && focused.npcId === visual.npcId;
      const activeWork = timeMs % 3_800 < 2_450;
      const motion = activeWork
        ? visual.activity === 'arcane-study' ? 'cast'
          : ['hammering', 'armour-drill', 'coaching'].includes(visual.activity) ? 'gather' : 'idle'
        : 'idle';
      visual.rig.animate(timeMs, acknowledged ? 'idle' : motion, reducedMotion);
      const desired = acknowledged
        ? Math.atan2(localX - visual.rig.root.position.x, localZ - visual.rig.root.position.z)
        : visual.baseRotation;
      visual.rig.root.rotation.y = reducedMotion ? desired : turnTowards(visual.rig.root.rotation.y, desired, 1 / 30);
      // Names are read from inside the room; through a wall they would float
      // over the roof of a building nobody is looking into.
      visual.label.visible = !frame.firstPerson && (this.playerInside || this.shell.kind === 'ring');
    }
    this.patrons.forEach((rig, index) => rig.animate(timeMs + index * 830, 'idle', reducedMotion));
    for (const creature of this.creatures) {
      const walking = !reducedMotion && Math.sin(timeMs * 0.0012 + creature.phase) > 0.7;
      const oldX = creature.rig.root.position.x;
      const oldZ = creature.rig.root.position.z;
      if (walking) {
        creature.rig.root.position.x = creature.baseX + Math.sin(timeMs * 0.00055 + creature.phase) * 0.25;
        creature.rig.root.position.z = creature.baseZ + Math.cos(timeMs * 0.00045 + creature.phase) * 0.2;
      }
      const dx = creature.rig.root.position.x - oldX;
      const dz = creature.rig.root.position.z - oldZ;
      const heading = Math.hypot(dx, dz) > 0.001 ? Math.atan2(-dx, -dz) : creature.rig.root.rotation.y;
      const motion = this.motionTracker.sample(creature.rig.root, timeMs, creature.rig.root.position.x,
        creature.rig.root.position.z, heading, creatureStride(creature.rig.speciesId, this.motionTracker.speed(creature.rig.root)));
      creature.rig.root.rotation.y = reducedMotion ? heading : turnTowards(creature.rig.root.rotation.y, heading, motion.deltaSeconds ?? 1 / 60);
      creature.rig.animate(timeMs + creature.phase, (motion.speed ?? 0) > 0.04 ? 'walk' : 'idle', reducedMotion, motion);
    }
    if (!reducedMotion) {
      for (const animated of this.animatedObjects) {
        const phase = timeMs * 0.001 + animated.phase;
        if (animated.kind === 'float') {
          animated.object.position.y = animated.baseY + Math.sin(phase * 1.8) * 0.12;
          animated.object.rotation.y += 0.006;
        } else if (animated.kind === 'rune') {
          animated.object.rotation.y += 0.004;
          animated.object.scale.setScalar(1 + Math.sin(phase * 2.2) * 0.04);
        } else if (animated.kind === 'flame') {
          animated.object.scale.y = 0.9 + Math.sin(phase * 7) * 0.18;
        } else animated.object.rotation.z = Math.sin(phase * 1.3) * 0.035;
      }
    }
    if (this.embers) {
      this.embers.points.visible = !reducedMotion;
      if (!reducedMotion) {
        const attribute = this.embers.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        this.embers.bases.forEach((base, index) => {
          const phase = (timeMs * 0.00022 * this.embers!.rise + index / this.embers!.bases.length) % 1;
          attribute.setXYZ(index,
            base.x + Math.sin(index * 19 + phase * Math.PI * 2) * 0.22,
            base.y + phase * this.embers!.rise,
            base.z + Math.cos(index * 13 + phase * Math.PI * 2) * 0.18);
        });
        attribute.needsUpdate = true;
      }
    }
  }

  get isPlayerInside(): boolean { return this.playerInside; }

  /**
   * Under an intact roof the furniture's sun shadows fall inside the roof's
   * own shadow and cannot be seen, yet each caster still costs a shadow-pass
   * draw. They cast only while the room is open to the sky: the open-air
   * arena, or overhead with the player inside and the roof cut away. Re-applied
   * every second as well, so furniture whose model loads later is caught.
   */
  private syncFurnitureShadows(open: boolean): void {
    this.shadowRefreshCountdown -= 1;
    if (open === this.furnitureShadows && this.shadowRefreshCountdown > 0) return;
    this.furnitureShadows = open;
    this.shadowRefreshCountdown = 60;
    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.userData.roomCastsShadow === undefined) child.userData.roomCastsShadow = child.castShadow;
      child.castShadow = open && child.userData.roomCastsShadow === true;
    });
  }

  /** The keeper's head, for the renderer's single room light. */
  lightAnchor(): THREE.Vector3 {
    const spawn = this.interior?.npcSpawns[0];
    const x = spawn ? spawn.x : this.building.footprint.tilesWide / 2;
    const z = spawn ? spawn.y : this.building.footprint.tilesHigh / 2;
    return new THREE.Vector3(this.building.footprint.tileX + x, this.shell.kind === 'ring' ? 3 : 1.95,
      this.building.footprint.tileY + z);
  }

  snapshot(): TownRoomSnapshot {
    return {
      buildingId: this.building.id,
      areaKey: this.building.areaKey,
      visible: this.root.visible,
      playerInside: this.playerInside,
      propPrefabs: this.interior?.props.map((prop) => prop.prefab) ?? [],
      npcIds: this.npcVisuals.map((visual) => visual.npcId),
    };
  }

  /** Stop late-arriving models from attaching; the renderer disposes the meshes with worldRoot. */
  retire(): void { this.art.retire(); }

  private build(): void {
    const theme = this.building.interiorTheme;
    const floorColor = colorOf(theme.surface, theme.exteriorWall);
    const accentColor = colorOf(theme.accent, theme.exteriorAccent);
    const glowColor = colorOf(theme.glow, this.interior?.ambience.keyLightColor ?? theme.exteriorAccent);

    if (this.shell.kind === 'room') {
      const width = this.shell.right - this.shell.left;
      const depth = this.shell.bottom - this.shell.top;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        new THREE.MeshStandardMaterial({ color: this.ruined ? 0x4b4640 : floorColor, roughness: 0.95 }),
      );
      floor.name = `room-floor:${this.building.id}`;
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((this.shell.left + this.shell.right) / 2, 0.03, (this.shell.top + this.shell.bottom) / 2);
      floor.receiveShadow = true;
      const uv = floor.geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / 2, uv.getY(i) * depth / 2);
      const timberRoom = ['tavern', 'farm', 'market'].includes(this.building.id);
      void this.art.surface(floor, timberRoom ? 'entrance.deck' : 'entrance.paving', timberRoom ? .7 : .55);
      this.root.add(floor);
      if (!this.ruined && ['tavern', 'church', 'magic-shop'].includes(this.building.id)) {
        this.addRug(width, depth, this.building.id === 'tavern' ? 0x744e43 : this.building.id === 'church' ? 0x4a6473 : 0x65516f);
      }
    }
    if (!this.interior) return;

    for (const prop of this.interior.props) {
      const propRoot = new THREE.Group();
      propRoot.name = `interior-prop:${prop.prefab}:${prop.id}`;
      propRoot.position.set(prop.x, this.shell.kind === 'room' ? 0.03 : 0.1, prop.y);
      propRoot.rotation.y = THREE.MathUtils.degToRad(prop.rotationDegrees);
      // Scale fits furniture to the room's floor plan; a smaller table is not a lower one.
      propRoot.scale.set(prop.scale ?? 1, 1, prop.scale ?? 1);
      this.buildProp(propRoot, prop.prefab, { accent: accentColor, glow: glowColor });
      this.root.add(propRoot);
      if (prop.prefab === 'animal-pen' && this.interior.ambience.effects.includes('animal-idles')) {
        const rig = createCreatureRig('tuftle');
        rig.root.scale.setScalar(0.62);
        rig.root.position.set(prop.x, 0.03, prop.y);
        this.root.add(rig.root);
        this.creatures.push({ rig, phase: prop.x, baseX: prop.x, baseZ: prop.y });
      }
    }
    for (const spawn of this.interior.npcSpawns) this.addNpc(spawn.npcId, spawn.activity, spawn.x, spawn.y, spawn.facing);
    this.interior.patrons.forEach((patron, index) => {
      const rig = createPlayerRig({ cloth: index % 2 ? 0x54796d : 0x805346, leather: 0x3f3128, skin: 0xb9825e, boot: 0x241c18, cloak: 0x3d4c42 }, 'compact');
      rig.root.name = `interior-patron:${index}`;
      rig.root.position.set(patron.x, 0.06, patron.y);
      rig.root.rotation.y = facingRotation(patron.facing);
      rig.root.scale.setScalar(0.88);
      this.root.add(rig.root);
      this.patrons.push(rig);
    });
    this.addEmbers(glowColor);
    // Character rigs carry a held staff's glow light. Rooms own no lights: one
    // that appeared as the player walked near would change the scene's light
    // count and recompile every lit material.
    const lights: THREE.Light[] = [];
    this.root.traverse((child) => { if (child instanceof THREE.Light) lights.push(child); });
    for (const light of lights) light.removeFromParent();
  }

  private addRug(width: number, depth: number, color: number): void {
    const pixels = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const edge = Math.min(x, y, 63 - x, 63 - y);
      const decorative = edge < 2 || (edge > 4 && edge < 7) || ((Math.abs(x - 32) + Math.abs(y - 32) < 9) && ((x + y) % 4 < 2));
      const hex = decorative ? 0xc6aa70 : color;
      const offset = (y * 64 + x) * 4;
      const weave = (x + y) % 2 ? .94 : 1;
      pixels[offset] = ((hex >> 16) & 255) * weave;
      pixels[offset + 1] = ((hex >> 8) & 255) * weave;
      pixels[offset + 2] = (hex & 255) * weave;
      pixels[offset + 3] = 255;
    }
    const texture = new THREE.DataTexture(pixels, 64, 64);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(width * .42, depth * .3),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
    rug.name = 'interior.woven-rug';
    rug.rotation.x = -Math.PI / 2;
    rug.position.set((this.shell.left + this.shell.right) / 2, .04, this.shell.top + depth * .62);
    rug.receiveShadow = true;
    this.root.add(rug);
  }

  /** One point cloud per room: a single draw call however many sparks it carries. */
  private addEmbers(glowColor: number): void {
    const interior = this.interior;
    if (!interior) return;
    const effects = new Set(interior.ambience.effects);
    const fiery = effects.has('forge-sparks') || effects.has('hearth-embers');
    const arcane = effects.has('rune-drift') || effects.has('floating-pages');
    if (!fiery && !arcane) return;
    const source = interior.props.find((prop) => fiery
      ? prop.prefab === 'forge' || prop.prefab === 'hearth'
      : prop.prefab === 'rune-circle');
    if (!source) return;
    const count = 12;
    const bases = Array.from({ length: count }, (_, index) => new THREE.Vector3(
      source.x + Math.sin(index * 2.4) * (arcane ? 0.7 : 0.3),
      fiery ? 0.95 : 0.2,
      source.y + Math.cos(index * 2.4) * (arcane ? 0.7 : 0.25),
    ));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bases.flatMap((base) => [base.x, base.y, base.z]), 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: fiery ? 0xffa24a : glowColor, size: fiery ? 0.07 : 0.06, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    points.name = 'interior-embers';
    points.frustumCulled = false;
    this.root.add(points);
    this.embers = { points, bases, rise: fiery ? 1.5 : 2.2 };
  }

  private buildProp(root: THREE.Group, prefab: InteriorPropPrefab, colors: { accent: number; glow: number }): void {
    const wood = material(0x6c452d);
    const darkWood = material(0x3e2a20);
    const metal = material(0x8c9998, 0.55);
    const stone = material(0x646866);
    const cloth = material(colors.accent, 0.82);
    const glow = new THREE.MeshStandardMaterial({ color: colors.glow, emissive: colors.glow, emissiveIntensity: 1.4, roughness: 0.45 });
    const size = INTERIOR_PROP_FOOTPRINTS[prefab];
    switch (prefab) {
      case 'forge':
      case 'hearth': {
        this.addBox(root, size!.width, 0.85, size!.depth, 0, 0.43, 0, material(0x61372c));
        const fire = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.85, 7), glow);
        fire.position.set(0, 1.02, 0);
        root.add(fire);
        this.animatedObjects.push({ object: fire, kind: 'flame', baseY: fire.position.y, phase: root.position.x });
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
        const length = size!.width;
        this.addBox(root, length, 0.18, size!.depth, 0, 0.82, 0, wood);
        for (const x of [-length * 0.38, length * 0.38]) this.addBox(root, 0.16, 0.8, 0.16, x, 0.4, 0, darkWood);
        this.addBox(root, length * 0.9, 0.62, 0.06, 0, 0.42, size!.depth * 0.42, darkWood);
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
        this.addBox(root, 1.55, 2.0, 0.24, 0, 1.0, -0.12, darkWood);
        for (const y of [0.38, 0.92, 1.46, 1.96]) this.addBox(root, 1.65, 0.08, 0.46, 0, y, 0.02, wood);
        for (let index = 0; index < 5; index += 1) {
          const item = prefab === 'bookcase'
            ? this.bookMesh(index % 2 ? colors.accent : 0x8b4937)
            : new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.12), prefab === 'armour-rack' ? metal : material(0xaeb8b5, 0.58));
          item.position.set(-0.58 + index * 0.29, prefab === 'bookcase' ? 1.04 + (index % 2) * 0.54 : 1.21 + (index % 2) * 0.54, 0.08);
          if (prefab === 'bookcase') item.rotation.z = Math.PI / 2;
          root.add(item);
        }
        break;
      }
      case 'barrel': {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.85, 10), wood);
        barrel.position.y = 0.43;
        barrel.castShadow = true;
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
        const count = prefab === 'produce-crates' ? 3 : 1;
        for (let index = 0; index < count; index += 1) {
          const x = count === 1 ? 0 : (index - 1) * 0.76;
          this.addBox(root, 0.72, 0.55, 0.68, x, 0.28, 0, wood);
          if (prefab === 'produce-crates') for (let fruit = 0; fruit < 3; fruit += 1) {
            const produce = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), material(fruit % 2 ? 0xd8a43d : 0x7dad55));
            produce.position.set(x - 0.2 + fruit * 0.2, 0.62, 0);
            root.add(produce);
          }
        }
        break;
      }
      case 'feed-sacks':
        for (let index = 0; index < 4; index += 1) {
          const sack = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), material(0xb79a62));
          sack.scale.set(0.8, 1.2, 0.65);
          sack.position.set(-0.3 + (index % 2) * 0.6, 0.34 + Math.floor(index / 2) * 0.42, Math.floor(index / 2) * 0.1);
          root.add(sack);
        }
        break;
      case 'animal-pen':
        for (const [x, z, rotation] of [[0, -1.25, 0], [0, 1.25, 0], [-1.25, 0, Math.PI / 2], [1.25, 0, Math.PI / 2]] as const) {
          const rail = new THREE.Group();
          rail.position.set(x, 0, z);
          rail.rotation.y = rotation;
          this.addBox(rail, 2.5, 0.12, 0.12, 0, 0.42, 0, wood);
          this.addBox(rail, 2.5, 0.12, 0.12, 0, 0.78, 0, wood);
          for (const px of [-1.12, 1.12]) this.addBox(rail, 0.13, 0.95, 0.13, px, 0.47, 0, darkWood);
          root.add(rail);
        }
        {
          const straw = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), material(0xbfa457));
          straw.rotation.x = -Math.PI / 2;
          straw.position.y = 0.015;
          straw.receiveShadow = true;
          root.add(straw);
        }
        break;
      case 'market-stall':
        this.addBox(root, 2.5, 0.75, 0.8, 0, 0.38, 0, wood);
        for (const x of [-1.05, 1.05]) this.addBox(root, 0.1, 2.0, 0.1, x, 1.0, -0.3, darkWood);
        this.addBox(root, 2.7, 0.1, 1.1, 0, 2.0, 0.05, cloth);
        for (let index = 0; index < 4; index += 1) {
          const produce = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), material(index % 2 ? 0xc0573d : 0x9bbd57));
          produce.position.set(-0.9 + index * 0.6, 0.86, 0.05);
          root.add(produce);
        }
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
        this.addBox(root, size!.width, 0.12, 0.5, 0, 0.48, -0.04, wood);
        this.addBox(root, size!.width, 0.6, 0.1, 0, 0.82, 0.26, darkWood);
        for (const x of [-size!.width * 0.42, size!.width * 0.42]) this.addBox(root, 0.1, 0.48, 0.44, x, 0.24, -0.04, darkWood);
        break;
      case 'altar':
        this.addBox(root, 2.35, 0.9, 0.85, 0, 0.45, 0, material(0xb8aea0));
        this.addBox(root, 2.5, 0.1, 1, 0, 0.95, 0, cloth);
        break;
      case 'candle-stand':
        this.addBox(root, 1.3, 0.1, 0.55, 0, 0.7, 0, metal);
        this.addBox(root, 0.1, 0.7, 0.1, 0, 0.35, 0, metal);
        for (const x of [-0.45, 0, 0.45]) {
          this.addBox(root, 0.08, 0.3 + Math.abs(x) * 0.25, 0.08, x, 0.9, 0, material(0xf4e0a8));
          const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), glow);
          flame.position.set(x, 1.1 + Math.abs(x) * 0.12, 0);
          root.add(flame);
          this.animatedObjects.push({ object: flame, kind: 'flame', baseY: flame.position.y, phase: x * 9 });
        }
        break;
      case 'stained-window': {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.4), new THREE.MeshBasicMaterial({
          color: colors.glow, transparent: true, opacity: 0.72, side: THREE.DoubleSide,
        }));
        pane.position.set(0, 1.55, 0);
        root.add(pane);
        const lead = material(0x2c2a2e);
        this.addBox(root, 1.6, 0.06, 0.05, 0, 0.85, 0, lead);
        this.addBox(root, 1.6, 0.06, 0.05, 0, 2.25, 0, lead);
        this.addBox(root, 0.05, 1.4, 0.05, 0, 1.55, 0.01, lead);
        this.addBox(root, 1.5, 0.05, 0.05, 0, 1.55, 0.01, lead);
        const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), new THREE.MeshBasicMaterial({
          color: colors.glow, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }));
        shaft.rotation.x = -0.85;
        shaft.position.set(0, 0.95, 0.75);
        root.add(shaft);
        break;
      }
      case 'shield-display': {
        const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.1, 7), metal);
        shield.rotation.x = Math.PI / 2;
        shield.position.set(0, 1.45, 0.02);
        root.add(shield);
        const boss = this.sphere(0.12, 0, 1.45, 0.08, material(colors.accent, 0.5));
        root.add(boss);
        break;
      }
      case 'practice-dummy':
        this.addBox(root, 0.18, 1.6, 0.18, 0, 0.8, 0, wood);
        this.addBox(root, 0.9, 0.12, 0.12, 0, 1.2, 0, wood);
        this.addBox(root, 0.5, 0.55, 0.32, 0, 1.15, 0, material(0xb89b6a));
        root.add(this.sphere(0.2, 0, 1.62, 0, material(0xb89b6a)));
        this.addBox(root, 0.6, 0.08, 0.5, 0, 0.04, 0, darkWood);
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
        break;
      }
      case 'staff-display':
        this.addBox(root, 1.65, 0.7, 0.75, 0, 0.35, 0, darkWood);
        this.addBox(root, 0.09, 1.3, 0.09, 0, 1.35, 0, wood);
        root.add(this.sphere(0.14, 0, 2.05, 0, glow));
        break;
      case 'floating-books':
        for (let index = 0; index < 4; index += 1) {
          const book = this.bookMesh(index % 2 ? colors.accent : 0x874d6d);
          book.position.set(-0.8 + index * 0.52, 1.55 + (index % 2) * 0.3, Math.sin(index) * 0.4);
          book.rotation.set(0.15, index * 0.8, 0.08);
          root.add(book);
          this.animatedObjects.push({ object: book, kind: 'float', baseY: book.position.y, phase: index * 1.7 });
        }
        break;
      case 'tavern-table': {
        const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.12, 12), wood);
        top.position.y = 0.78;
        top.castShadow = true;
        root.add(top);
        this.addBox(root, 0.4, 0.78, 0.4, 0, 0.39, 0, darkWood);
        break;
      }
      case 'stool': {
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.14, 10), wood);
        seat.position.y = 0.58;
        root.add(seat);
        this.addBox(root, 0.14, 0.58, 0.14, 0, 0.29, 0, darkWood);
        break;
      }
      case 'notice-board':
        this.addBox(root, 1.45, 1.0, 0.08, 0, 1.45, -0.18, wood);
        for (const [x, y] of [[-0.38, 1.6], [0.32, 1.72], [0, 1.22]] as const) this.addBox(root, 0.42, 0.3, 0.02, x, y, -0.13, material(0xd5c59b));
        break;
      case 'training-post':
        this.addBox(root, 0.32, 2.05, 0.32, 0, 1.02, 0, wood);
        for (const y of [0.55, 1.1, 1.65]) {
          const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 5, 10), cloth);
          wrap.rotation.x = Math.PI / 2;
          wrap.position.y = y;
          root.add(wrap);
        }
        break;
      case 'banner': {
        this.addBox(root, 0.1, 2.45, 0.1, 0, 1.22, 0, darkWood);
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5), cloth);
        banner.position.set(0, 1.55, 0.06);
        root.add(banner);
        this.animatedObjects.push({ object: banner, kind: 'banner', baseY: banner.position.y, phase: 2 });
        break;
      }
    }
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.material === wood || child.material === darkWood) void this.art.surface(child, 'entrance.deck', .55);
      else if (child.material === stone || ((prefab === 'forge' || prefab === 'hearth')
        && child.geometry instanceof THREE.BoxGeometry)) void this.art.surface(child, 'entrance.paving', .35);
    });
    if (prefab === 'crate' || prefab === 'produce-crates' || prefab === 'barrel') {
      const key = prefab === 'barrel' ? 'survival.barrel' : 'entrance.crate';
      const boxes = root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh
        && (prefab === 'barrel' ? child.geometry instanceof THREE.CylinderGeometry : child.geometry instanceof THREE.BoxGeometry));
      for (const box of boxes) {
        void this.art.add(root, {
          key, x: box.position.x, y: 0, z: box.position.z,
          height: prefab === 'barrel' ? .9 : .55, ...(prefab === 'barrel' ? {} : { width: .72, depth: .68 }),
        }).then((model) => {
          if (!model) return;
          box.visible = false;
          if (prefab === 'barrel') for (const band of root.children) if (band instanceof THREE.Mesh && band.geometry instanceof THREE.TorusGeometry) band.visible = false;
        });
      }
    }
    root.userData.visualStyle = 'quaternius';
  }

  private addNpc(npcId: NpcId, activity: InteriorNpcActivity, x: number, z: number, facing: Facing): void {
    const npc = npcDefinition(npcId);
    const rig = createPlayerRig({
      cloth: colorOf(npc.appearance.primaryColor, 0x754c3d),
      leather: colorOf(npc.appearance.accentColor, 0x41322a), skin: 0xb97c52, boot: 0x201815, cloak: 0x3b2a25,
    });
    rig.root.name = `interior-npc:${npcId}`;
    rig.root.position.set(x, 0.06, z);
    const rotation = facingRotation(facing);
    rig.root.rotation.y = rotation;
    if (activity === 'hammering') rig.setGatherTool('pickaxe');
    else if (activity === 'armour-drill' || activity === 'coaching') rig.setGatherTool('axe');
    else if (activity === 'arcane-study') rig.setGatherTool('staff');
    else rig.setGatherTool('hands');
    this.root.add(rig.root);
    const label = createNameLabel(npc.name, npc.appearance.primaryColor, npc.appearance.accentColor);
    label.position.set(x, 2.05, z);
    label.visible = false;
    this.root.add(label);
    this.npcVisuals.push({ npcId, activity, rig, label, baseRotation: rotation });
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
}

function createNameLabel(text: string, background = '#30150b', foreground = '#ffe2b4'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#183329';
    context.beginPath();
    context.roundRect(8, 8, 368, 64, 14);
    context.fill();
    context.strokeStyle = foreground;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = background;
    context.fillRect(23, 25, 4, 30);
    context.fillStyle = '#f2e4c4';
    context.font = '400 30px Georgia, serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 192, 41);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.6, 0.33, 1);
  sprite.renderOrder = 12;
  sprite.name = 'interior-npc-label';
  return sprite;
}

function material(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

function colorOf(value: string, fallback: number): number {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  return match ? Number.parseInt(match[1]!, 16) : fallback;
}

function facingRotation(facing: Facing): number {
  switch (facing) {
    case 'up': return Math.PI;
    case 'down': return 0;
    case 'left': return -Math.PI / 2;
    case 'right': return Math.PI / 2;
  }
}
