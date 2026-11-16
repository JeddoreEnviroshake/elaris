import * as THREE from 'three';
import {MotionTracker,turnTowards,playerStride} from './animationMotion';
import {creatureStride} from './creatureAnimation';
import { isRoadTile } from '../content/roads';
import { isRuinedTownBuilding, townBuildingsInArea, type TownBuildingDefinition } from '../content/townBuildings';
import { hasElarisFallen } from '../simulation/elarisFall';
import { PERMANENT_AIR_PURIFIER, TOWN_AIR_PURIFIERS, TOWN_PERIMETER_SEGMENTS } from '../content/townDefences';
import { ELARIS_PUBLIC_WORKBENCH_SIZE, ELARIS_PUBLIC_WORKBENCH_TILE } from '../simulation/elarisWorkbench';
import { ELARIS_WATER_TEMPLE } from '../content/elarisWaters';
import { creatureDefinition } from '../content/creatures';
import { regionalIdentityForArea } from '../content/regions';
import { buildableById } from '../content/buildingParts';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { GARDEN_BED_GROW_TICKS, WOODLOT_GROW_TICKS, gameToolDefinition } from '../config/balance';
import { BUILD_RANGE_PX } from '../simulation/gameplayCommands';
import { coordinateHash } from '../simulation/biomes';
import { boundaryCenterPx, boundarySpan, effectiveBoundaryEdge, effectiveDimensions } from '../simulation/buildingGeometry';
import type {
  BuildingState,
  GameState,
  ResourceNodeState,
  SpeciesId,
} from '../simulation/state';
import type { ModelAssetKey } from './assetRegistry';
import { ModelLibrary } from './modelLibrary';
import { ContactShadows, SceneFinish } from './sceneFinish';
import { TownEntrance, disposePaintedGround, entranceRoadMaterial, meadowMaterial } from './townEntrance';
import { QuaterniusArt, VegetationStream, buildStyledSettlement, styledWaterMaterial, updateStyledWater } from './quaterniusArt';
import type {
  BuildPlacementPresentation,
  InteractionTargetPresentation,
  ThreePresentationState,
} from './presentationState';
import {
  createCreatureRig,
  createPlayerRig,
  createSaddle,
  gatherToolForNode,
  mountSeatOffset,
  RIDER_HIP_HEIGHT,
  type CreatureRig,
  type PlayerRig,
} from './characterRigs';
import { createRaiderRig, RAIDER_CHEST_HEIGHT, type RaiderRig } from './raiderRigs';
import {
  arrowArcHeight,
  arrowFlightSeconds,
  ArrowShotTracker,
  createArrowMesh,
  type ArrowShot,
} from './raidArrows';
import {
  ELARIS_CAMERA_PITCH_DEGREES,
  ELARIS_CAMERA_YAW_DEGREES,
  elarisCameraOffset,
  type ElarisCameraOrientation,
} from './cameraControls';
import { captureBattleSnapshot, type BattleRoundPresentation } from './battleState';
import { terrainAt, type TerrainKind } from '../simulation/landscape';
import {
  ELARIS_SANCTUARY_TILE,
  survivalSchedule,
  type DangerThreat,
} from '../simulation/survivalCycle';
import { activeStormStrikes, stormImpactRadiusPx } from '../simulation/arcaneStorm';
import { workerCreaturePlacements, workerCreaturePose } from '../presentation/workerCreatures';
import { followerCreaturePlacements, followerAssistanceLift, type GatherAssistancePresentation } from '../presentation/followerCreatures';
import {
  applyArcaneStrikeFrame,
  arcaneStrikeFrame,
  createArcaneStrikeVisual,
  type ArcaneStrikeVisual,
} from './arcaneStormRigs';
import {
  DANGER_PRESENTATION,
  dangerSafeRects,
  purifierProtectedRects,
  type DangerSafeRect,
} from '../scenes/dangerPresentation';
import { ThreeBattleStage } from './ThreeBattleStage';
import {CombatEffects,COMBAT_PALETTE} from './combatEffects';
import { ThreeInteriorStage, type InteriorStageFrame } from './ThreeInteriorStage';
import {
  composeHeroEnvironment,
  isGroundOccluder,
  type EnvironmentPlacement,
  type HeroEnvironmentComposition,
} from './environmentComposition';
import {
  atmosphereCue,
  cameraRevealCue,
  creatureTraceStyle,
} from './wowPresentation';

const WORLD_UNIT_PX = TILE_SIZE;

/**
 * Growing facilities (Woodlot Planter, Garden Bed) render the crop they
 * produce at the crop's own size, so a mature planter and the wild node it
 * replaces share a silhouette. Growth is quantized into stages: the entity
 * signature carries the stage, so the plot rebuilds exactly when its visible
 * size changes rather than every tick.
 */
const CROP_GROWTH_STAGES = 5;

function cropGrowthStage(progressTicks: number, growTicks: number): number {
  return Math.min(CROP_GROWTH_STAGES, Math.floor((progressTicks / growTicks) * CROP_GROWTH_STAGES));
}

/** Quantized 0..1 growth, matching the stage in the entity signature. */
function woodlotGrowth(building: BuildingState): number {
  return cropGrowthStage(building.woodlot?.progressTicks ?? 0, WOODLOT_GROW_TICKS) / CROP_GROWTH_STAGES;
}

function gardenGrowth(building: BuildingState): number {
  return cropGrowthStage(building.garden?.progressTicks ?? 0, GARDEN_BED_GROW_TICKS) / CROP_GROWTH_STAGES;
}

/** Door swing tuning (three units = tiles): open radius, swing time, open angle. */
const DOOR_OPEN_RADIUS = 1.35;
const DOOR_SWING_SECONDS = 0.18;
const DOOR_OPEN_ANGLE = -Math.PI / 2;
const PLAYER_Y = 0.04;

/**
 * Raider tuning (three units = tiles). Positions come from the fixed-step sim
 * in whole pixels, so the rig chases its tick position instead of snapping to
 * it — the same smoothing the 2D sprites get for free from their frame rate.
 */
/**
 * Short creatures share a minimum level-label height; taller silhouettes get
 * extra clearance based on their sculpt's bounds, including antlers and tails.
 */
const CREATURE_PLATE_HEIGHT = 1.6;

const RAIDER_FOLLOW_RATE = 0.0008;
const RAIDER_TURN_RATE = 0.0015;
/** Muzzle of the turret barrel and the player's draw, for arrow origins. */
const TURRET_MUZZLE_Y = 0.63;
const PLAYER_DRAW_Y = 1.2;

/** Clear-weather distance fog, restored whenever the danger phase is not biting. */
const BASE_FOG_NEAR = 34;
const BASE_FOG_FAR = 76;

/**
 * Danger-phase poison fog: the 3D twin of the Phaser overlay's green wash. The
 * haze closes in and the light sickens while the player is exposed, and lifts
 * the moment they reach a purified room — the same shelter rule the simulation
 * uses for exposure damage.
 */
const DANGER_FOG_FADE_IN_SECONDS = 0.9;
const DANGER_FOG_FADE_OUT_SECONDS = 0.7;
const DANGER_MASK_REFRESH_MS = 400;
const PROTECTION_HIGHLIGHT_COLOR = 0x79efc2;
const PROTECTION_HIGHLIGHT_ALPHA = 0.11;

export interface ThreeRendererSnapshot {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleModels: number;
  readonly placementActive: boolean;
  readonly placementValid: boolean | null;
  readonly placementTileX: number | null;
  readonly placementTileY: number | null;
  readonly targetKind: InteractionTargetPresentation['kind'] | null;
  readonly effectParticles: number;
  readonly combatEffectInstances:number;
  /** Raid wave currently rigged, and arrows still in the air over it. */
  readonly raiderRigs: number;
  readonly followerRigs: number;
  readonly batchPreviewParts: number;
  /** Strike markers currently rigged, and how many of them are landing. */
  readonly stormMarkers: number;
  readonly stormImpacts: number;
  readonly arrowsInFlight: number;
  readonly battleActive: boolean;
  readonly battleRoundAnimating: boolean;
  readonly battleEffectInstances:number;
  readonly interiorActive: boolean;
  readonly interiorId: string | null;
}

interface FeedbackParticle {
  readonly mesh: THREE.Mesh;
  readonly velocity: THREE.Vector3;
  age: number;
  readonly lifetime: number;
  readonly gravity?: number;
  readonly spinX?: number;
  readonly spinZ?: number;
  readonly scaleFrom?: number;
  readonly scaleTo?: number;
  readonly baseScale?: THREE.Vector3;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** A raider rig plus the smoothed transform it is chasing. */
interface RaiderVisual {
  readonly rig: RaiderRig;
  x: number;
  z: number;
  heading: number;
  /** Distance covered since the last frame, which decides walk versus idle. */
  moving: boolean;
}

interface FlyingArrow {
  readonly mesh: THREE.Group;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly arc: number;
  readonly duration: number;
  readonly killed: boolean;
  elapsed: number;
}

interface SceneOccluder {
  readonly object: THREE.Object3D;
  readonly radius: number;
  readonly minimumOpacity: number;
  readonly materials: readonly THREE.Material[];
  readonly baseOpacity: readonly number[];
  opacity: number;
  readonly scope: 'world' | 'entity';
}

interface AmbientMotes {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  readonly bases: readonly THREE.Vector3[];
  readonly phases: readonly number[];
}

interface LandmarkBeacon {
  readonly root: THREE.Group;
  readonly beamMaterial: THREE.MeshBasicMaterial;
  readonly halo: THREE.Mesh;
  readonly baseOpacity: number;
}

interface ProtectionMaterial {
  readonly material: THREE.MeshBasicMaterial;
  readonly baseOpacity: number;
  readonly dangerOpacity: number;
  readonly phase: number;
}

/**
 * The `paint-*` intents predate aim-then-build: a drag with a ghost out now
 * only slides the ghost, and nothing is committed until Place. The names are
 * kept because they still mean "a drag while a ghost is out".
 */
type WorldPointerHandler = (
  worldX: number,
  worldY: number,
  intent: 'tap' | 'long-press' | 'hover' | 'paint-start' | 'paint-move' | 'paint-end',
  clientX: number,
  clientY: number,
) => void;

export function worldToThree(x: number, y: number): { x: number; z: number } {
  return { x: x / WORLD_UNIT_PX, z: y / WORLD_UNIT_PX };
}


/**
 * A presentation-only 3D frontend for the existing deterministic simulation.
 * Phaser continues to own input, menus, commands, and fixed-step state.
 */
export class Elaris3DRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 160);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly finish: SceneFinish;
  private readonly contactShadows = new ContactShadows();
  private readonly models = new ModelLibrary();
  private entrance: TownEntrance | null = null;
  private worldArt: QuaterniusArt | null = null;
  private vegetation: VegetationStream | null = null;
  private readonly entityVisuals = new Map<string, { signature: string; root: THREE.Object3D }>();
  private readonly worldRoot = new THREE.Group();
  private readonly entityRoot = new THREE.Group();
  private readonly playerRoot = new THREE.Group();
  private readonly actorRoot = new THREE.Group();
  private readonly boatHull = new THREE.Group();
  private readonly feedbackRoot = new THREE.Group();
  private readonly placementRoot = new THREE.Group();
  private readonly placementRangeRing = new THREE.Mesh(
    new THREE.RingGeometry(BUILD_RANGE_PX / TILE_SIZE - 0.045, BUILD_RANGE_PX / TILE_SIZE + 0.045, 72),
    new THREE.MeshBasicMaterial({ color: 0xffe7a0, transparent: true, opacity: 0.48, side: THREE.DoubleSide, depthWrite: false }),
  );
  private readonly selectionRoot = new THREE.Group();
  private readonly batchRoot = new THREE.Group();
  private readonly shelterGuideRoot = new THREE.Group();
  private readonly journeyRoot = new THREE.Group();
  private journeySignature = '';
  private batchSignature = '';
  private shelterGuideSignature = '';
  /** World-space floor wash for every tile currently reached by a purifier. */
  private readonly protectionRoot = new THREE.Group();
  private readonly battleStage = new ThreeBattleStage(this.models);
  private readonly combatEffects = new CombatEffects();
  private lastCombatActionId=Number.NEGATIVE_INFINITY;
  private readonly interiorStage = new ThreeInteriorStage(this.models);
  private readonly focusRing: THREE.Mesh;
  private readonly playerRing: THREE.Mesh;
  private targetStatus: THREE.Sprite | null = null;
  private readonly resizeObserver: ResizeObserver;
  private animationFrame: number | null = null;
  private enabled = false;
  private worldRevision = 0;
  private areaKey = '';
  private entitySignature = '';
  private lastSyncAt = Number.NEGATIVE_INFINITY;
  private lastFrameAt = performance.now();
  private readonly motionTracker=new MotionTracker();
  private lastGatherKind:ResourceNodeState['kind']|null=null;
  private previousPlayerHp=Number.POSITIVE_INFINITY;
  private playerHurtAt=Number.NEGATIVE_INFINITY;
  private cameraTarget = new THREE.Vector3();
  private modelCount = 0;
  private presentationProvider: (() => ThreePresentationState | null) | null = null;
  private placementSignature = '';
  private selectionSignature = '';
  private targetSignature = '';
  private readonly resourceHp = new Map<string, number>();
  private readonly previousDrops = new Map<string, { x: number; y: number }>();
  private readonly particles: FeedbackParticle[] = [];
  private readonly occluders: SceneOccluder[] = [];
  private ambientMotes: AmbientMotes | null = null;
  private landmarkBeacon: LandmarkBeacon | null = null;
  private readonly protectionMaterials: ProtectionMaterial[] = [];
  private readonly lastCreatureTraceAt = new Map<string, number>();
  private areaRevealStartedAt = performance.now();
  private readonly dangerOverlay: HTMLCanvasElement;
  private readonly dangerOverlayContext: CanvasRenderingContext2D;
  private dangerFogStrength = 0;
  private dangerThreat: DangerThreat = 'fog';
  private dangerMaskRects: DangerSafeRect[] = [];
  private protectionSignature = '';
  private lastProtectionSyncAt = Number.NEGATIVE_INFINITY;
  private lastDangerMaskAt = Number.NEGATIVE_INFINITY;
  private readonly creatureRigs = new Map<string, CreatureRig>();
  // Raiders live outside entityRoot: they move every tick, and entityRoot is
  // torn down and rebuilt whenever the entity signature changes.
  private readonly raiderRoot = new THREE.Group();
  private readonly raiderVisuals = new Map<string, RaiderVisual>();
  // Working creatures live outside entityRoot for the same reason as raiders:
  // they walk their worksite loop every frame.
  private readonly workerRoot = new THREE.Group();
  private readonly workerRigs = new Map<string, CreatureRig>();
  private readonly followerRigs = new Map<string, CreatureRig>();
  // Strike markers live beside the raiders for the same reason: they are
  // short-lived, they move with the simulation rather than the map, and they
  // must survive the entity rebuild that an area change performs.
  private readonly stormRoot = new THREE.Group();
  private readonly stormVisuals = new Map<string, ArcaneStrikeVisual>();
  private stormImpactsShown = 0;
  private readonly arrowRoot = new THREE.Group();
  private readonly arrows: FlyingArrow[] = [];
  private readonly arrowTracker = new ArrowShotTracker();
  /** Hinged leaf pivots for placed doors, plus each door's tile-space center. */
  private readonly doorPivots = new Map<string, { pivot: THREE.Object3D; cx: number; cz: number }>();
  /** Persisted openness (0 closed → 1 open) per door, survives entity rebuilds. */
  private readonly doorOpenness = new Map<string, number>();
  /** Permanent Elaris gates live in worldRoot, so entity rebuilds do not discard them. */
  private readonly townGatePivots = new Map<string, { pivot: THREE.Object3D; cx: number; cz: number }>();
  private readonly townGateOpenness = new Map<string, number>();
  private playerRig!: PlayerRig;
  /** Ridden creature under the player, rebuilt only when the species changes. */
  private readonly mountRoot = new THREE.Group();
  private mountRig: CreatureRig | null = null;
  private mountSpecies: SpeciesId | null = null;
  private lastFurnaceEffectAt = Number.NEGATIVE_INFINITY;
  private battleCameraActive = false;
  private cameraOrientation: ElarisCameraOrientation = {
    yawDegrees: ELARIS_CAMERA_YAW_DEGREES,
    pitchDegrees: ELARIS_CAMERA_PITCH_DEGREES,
  };
  private previousInteriorPose: { x: number; y: number } | null = null;
  private readonly battleAnchor = new THREE.Vector3();
  private readonly hemisphere = new THREE.HemisphereLight(0xdaf2e1, 0x35422e, 2.2);
  private readonly sun = new THREE.DirectionalLight(0xfff0cf, 3.6);
  private readonly fill = new THREE.DirectionalLight(0x7aa6b6, 0.75);
  private readonly playerLight = new THREE.PointLight(0xffdda1, 0.28, 5.2, 2);
  private worldPointerHandler: WorldPointerHandler | null = null;
  private heldPointer: {
    id: number;
    clientX: number;
    clientY: number;
    worldX: number;
    worldY: number;
    opened: boolean;
    painting: boolean;
    timer: number;
  } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly state: GameState,
  ) {
    // Scene antialiasing belongs to the composer's target; the output is a quad.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.finish = new SceneFinish(this.renderer, this.scene, this.camera);
    this.renderer.domElement.id = 'elaris-three-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Elaris 3D world');
    this.container.appendChild(this.renderer.domElement);
    this.dangerOverlay = document.createElement('canvas');
    this.dangerOverlay.setAttribute('aria-hidden', 'true');
    Object.assign(this.dangerOverlay.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const dangerOverlayContext = this.dangerOverlay.getContext('2d');
    if (!dangerOverlayContext) throw new Error('Danger overlay canvas is unavailable');
    this.dangerOverlayContext = dangerOverlayContext;
    this.container.appendChild(this.dangerOverlay);

    this.scene.add(
      this.worldRoot, this.entityRoot, this.raiderRoot, this.workerRoot, this.stormRoot, this.arrowRoot,
      this.feedbackRoot, this.protectionRoot, this.playerRoot, this.battleStage.root,this.combatEffects.root,
      this.interiorStage.root,
      this.contactShadows.mesh,
    );
    this.playerRoot.add(this.actorRoot);
    this.playerRoot.add(this.boatHull);
    this.playerLight.position.set(0, 1.6, 0);
    this.playerRoot.add(this.playerLight);
    // Creature rigs face -z while the player faces +z, so the mount turns about.
    this.mountRoot.rotation.y = Math.PI;
    this.playerRoot.add(this.mountRoot);
    this.placementRangeRing.rotation.x = -Math.PI / 2;
    this.placementRangeRing.position.y = 0.035;
    this.placementRangeRing.visible = false;
    this.feedbackRoot.add(this.placementRoot, this.placementRangeRing);
    this.feedbackRoot.add(this.selectionRoot);
    this.feedbackRoot.add(this.batchRoot, this.shelterGuideRoot, this.journeyRoot);
    this.configureLighting();
    this.focusRing = this.createFocusRing();
    this.playerRing = this.createPlayerRing();
    this.scene.add(this.focusRing);
    this.playerRoot.add(this.playerRing);

    const start = worldToThree(state.player.x, state.player.y);
    this.cameraTarget.set(start.x, 0, start.z);
    const cameraOffset = elarisCameraOffset(this.cameraOrientation);
    this.camera.position.set(start.x + cameraOffset.x, cameraOffset.y, start.z + cameraOffset.z);
    this.camera.lookAt(this.cameraTarget);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    window.addEventListener('pointerdown', this.onWorldPointerDown);
    window.addEventListener('pointermove', this.onWorldPointerMove);
    window.addEventListener('pointerup', this.onWorldPointerUp);
    window.addEventListener('pointercancel', this.cancelHeldPointer);
    this.resize();
    this.rebuildWorld();
    this.buildPlayer();
    this.animationFrame = requestAnimationFrame(this.renderFrame);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.container.style.display = enabled ? 'block' : 'none';
    if (enabled) this.resize();
  }

  setPresentationProvider(provider: () => ThreePresentationState | null): void {
    this.presentationProvider = provider;
  }

  getCameraOrientation(): ElarisCameraOrientation {
    return { ...this.cameraOrientation };
  }

  setCameraOrientation(orientation: ElarisCameraOrientation): void {
    if (!Number.isFinite(orientation.yawDegrees) || !Number.isFinite(orientation.pitchDegrees)) return;
    this.cameraOrientation = {
      yawDegrees: Math.max(-180, Math.min(180, orientation.yawDegrees)),
      pitchDegrees: Math.max(10, Math.min(80, orientation.pitchDegrees)),
    };
  }

  setWorldPointerHandler(handler: WorldPointerHandler): void {
    this.worldPointerHandler = handler;
  }

  playBattleRound(round: BattleRoundPresentation): void {
    this.battleStage.playRound(round);
  }

  getSnapshot(): ThreeRendererSnapshot {
    const presentation = this.presentationProvider?.() ?? null;
    return {
      drawCalls: this.finish.stats.drawCalls,
      triangles: this.finish.stats.triangles,
      visibleModels: this.modelCount,
      placementActive: presentation?.placement !== null && presentation?.placement !== undefined,
      placementValid: presentation?.placement?.valid ?? null,
      placementTileX: presentation?.placement?.tileX ?? null,
      placementTileY: presentation?.placement?.tileY ?? null,
      targetKind: presentation?.target?.kind ?? null,
      effectParticles: this.particles.length,
      combatEffectInstances:this.combatEffects.instanceCount,
      raiderRigs: this.raiderVisuals.size,
      followerRigs: this.followerRigs.size,
      batchPreviewParts: presentation?.batchPlacements?.length ?? 0,
      stormMarkers: this.stormVisuals.size,
      stormImpacts: this.stormImpactsShown,
      arrowsInFlight: this.arrows.length,
      battleActive: this.battleCameraActive,
      battleRoundAnimating: this.battleStage.roundAnimating,
      battleEffectInstances:this.battleStage.effectInstances,
      interiorActive: presentation?.interior !== null && presentation?.interior !== undefined,
      interiorId: presentation?.interior?.definition.id ?? null,
    };
  }

  dispose(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.resizeObserver.disconnect();
    window.removeEventListener('pointerdown', this.onWorldPointerDown);
    window.removeEventListener('pointermove', this.onWorldPointerMove);
    window.removeEventListener('pointerup', this.onWorldPointerUp);
    window.removeEventListener('pointercancel', this.cancelHeldPointer);
    this.cancelHeldPointer();
    this.entrance?.retire();
    this.worldArt?.retire();
    this.vegetation?.retire();
    this.disposeObject(this.worldRoot);
    this.disposeObject(this.entityRoot);
    this.disposeObject(this.raiderRoot);
    this.disposeObject(this.workerRoot);
    this.disposeObject(this.stormRoot);
    this.disposeObject(this.arrowRoot);
    this.disposeObject(this.feedbackRoot);
    this.disposeObject(this.protectionRoot);
    this.disposeObject(this.playerRoot);
    this.disposeObject(this.focusRing);
    this.battleStage.dispose();
    this.combatEffects.dispose();
    this.interiorStage.dispose();
    this.disposeObject(this.contactShadows.mesh);
    this.finish.dispose();
    disposePaintedGround();
    this.models.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.dangerOverlay.remove();
  }

  private configureLighting(): void {
    this.scene.background = new THREE.Color(0x9fcbb5);
    this.scene.fog = new THREE.Fog(0x9fcbb5, 32, 72);

    this.scene.add(this.hemisphere);

    this.sun.position.set(-24, 34, -18);
    this.sun.castShadow = true;
    const shadowSize = window.matchMedia('(pointer: coarse)').matches ? 1024 : 2048;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.camera.left = -24;
    this.sun.shadow.camera.right = 24;
    this.sun.shadow.camera.top = 24;
    this.sun.shadow.camera.bottom = -24;
    this.sun.shadow.camera.near = 4;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);

    this.fill.position.set(18, 12, 20);
    this.scene.add(this.fill);
  }

  private raycastGround(clientX: number, clientY: number): { worldX: number; worldY: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    return { worldX: hit.x * TILE_SIZE, worldY: hit.z * TILE_SIZE };
  }

  private isPhaserWorldCanvas(target: EventTarget | null): boolean {
    return target instanceof HTMLCanvasElement && target === document.querySelector('#game canvas');
  }

  private readonly onWorldPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0 || !this.isPhaserWorldCanvas(event.target)) return;
    this.cancelHeldPointer();
    const hit = this.raycastGround(event.clientX, event.clientY);
    if (!hit) return;
    const held = {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      worldX: hit.worldX,
      worldY: hit.worldY,
      opened: false,
      painting: this.presentationProvider?.()?.placement != null,
      timer: 0,
    };
    if (held.painting) {
      this.heldPointer = held;
      this.worldPointerHandler?.(hit.worldX, hit.worldY, 'paint-start', event.clientX, event.clientY);
      return;
    }
    held.timer = window.setTimeout(() => {
      if (this.heldPointer !== held) return;
      held.opened = true;
      this.worldPointerHandler?.(held.worldX, held.worldY, 'long-press', held.clientX, held.clientY);
    }, 550);
    this.heldPointer = held;
  };

  private readonly onWorldPointerMove = (event: PointerEvent): void => {
    const held = this.heldPointer;
    if (!held || held.id !== event.pointerId) {
      if (!this.enabled || !this.isPhaserWorldCanvas(event.target) || this.presentationProvider?.()?.placement == null) return;
      const hover = this.raycastGround(event.clientX, event.clientY);
      if (hover) this.worldPointerHandler?.(hover.worldX, hover.worldY, 'hover', event.clientX, event.clientY);
      return;
    }
    if (held.painting) {
      const hit = this.raycastGround(event.clientX, event.clientY);
      if (hit) this.worldPointerHandler?.(hit.worldX, hit.worldY, 'paint-move', event.clientX, event.clientY);
      return;
    }
    if (Math.hypot(event.clientX - held.clientX, event.clientY - held.clientY) > 10) this.cancelHeldPointer();
  };

  private readonly onWorldPointerUp = (event: PointerEvent): void => {
    const held = this.heldPointer;
    if (!held || held.id !== event.pointerId) return;
    window.clearTimeout(held.timer);
    this.heldPointer = null;
    if (held.painting) {
      this.worldPointerHandler?.(held.worldX, held.worldY, 'paint-end', event.clientX, event.clientY);
      return;
    }
    if (!held.opened) this.worldPointerHandler?.(held.worldX, held.worldY, 'tap', event.clientX, event.clientY);
  };

  private readonly cancelHeldPointer = (): void => {
    if (this.heldPointer) {
      window.clearTimeout(this.heldPointer.timer);
      if (this.heldPointer.painting) {
        this.worldPointerHandler?.(
          this.heldPointer.worldX,
          this.heldPointer.worldY,
          'paint-end',
          this.heldPointer.clientX,
          this.heldPointer.clientY,
        );
      }
    }
    this.heldPointer = null;
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.finish.resize(width, height);
    const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
    this.dangerOverlay.width = Math.round(width * pixelRatio);
    this.dangerOverlay.height = Math.round(height * pixelRatio);
    this.dangerOverlayContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const aspect = width / height;
    const shortAxis = Math.min(width, height);
    const viewHeight = shortAxis <= 480 ? 23 : shortAxis <= 900 ? 25 : 27;
    this.camera.left = -(viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  private rebuildWorld(): void {
    this.worldRevision += 1;
    this.areaRevealStartedAt = performance.now();
    this.areaKey = this.state.currentArea.key;
    this.entitySignature = '';
    this.entrance?.retire();
    this.worldArt?.retire();
    this.vegetation?.retire();
    this.entrance = null;
    this.entityVisuals.clear();
    this.creatureRigs.clear();
    this.doorPivots.clear();
    this.clearGroup(this.worldRoot);
    this.clearGroup(this.entityRoot);
    this.clearGroup(this.protectionRoot);
    this.protectionSignature = '';
    this.lastProtectionSyncAt = Number.NEGATIVE_INFINITY;
    // A raid belongs to one area; crossing a boundary drops its wave and any
    // arrow still in the air, and re-seeds the tracker against the new area.
    this.clearGroup(this.raiderRoot);
    // Worksites are area-local, so the workers staffing them do not travel.
    this.clearGroup(this.workerRoot);
    this.clearGroup(this.stormRoot);
    this.clearGroup(this.arrowRoot);
    this.combatEffects.clear();this.lastCombatActionId=Number.NEGATIVE_INFINITY;
    this.stormVisuals.clear();
    this.raiderVisuals.clear();
    this.workerRigs.clear();
    this.followerRigs.clear();
    this.arrows.length = 0;
    this.arrowTracker.reset();
    this.resourceHp.clear();
    this.previousDrops.clear();
    this.occluders.length = 0;
    this.townGatePivots.clear();
    this.townGateOpenness.clear();
    this.ambientMotes = null;
    this.landmarkBeacon = null;
    this.protectionMaterials.length = 0;
    this.lastCreatureTraceAt.clear();
    this.modelCount = 0;
    this.worldArt = new QuaterniusArt(this.models, this.worldRoot);

    const palette = this.areaPalette();
    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.Fog(palette.sky, BASE_FOG_NEAR, BASE_FOG_FAR);
    this.hemisphere.color.set(palette.sky).lerp(new THREE.Color(0xe8f4dc), 0.42);
    this.hemisphere.groundColor.set(palette.ground).multiplyScalar(0.62);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_TILES, WORLD_TILES),
      meadowMaterial(palette.ground),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD_TILES / 2, -0.08, WORLD_TILES / 2);
    ground.receiveShadow = true;
    ground.userData.sharedModelTextures = true;
    this.worldRoot.add(ground);

    const settlementBuildings = townBuildingsInArea(this.state.currentArea.key);
    this.vegetation = new VegetationStream(this.models, this.state, settlementBuildings.map((building) => building.footprint));
    this.worldRoot.add(this.vegetation.root);
    this.vegetation.update(this.state.player.x / TILE_SIZE, this.state.player.y / TILE_SIZE);
    const fallen = hasElarisFallen(this.state);
    const buildSettlement = (buildings: readonly TownBuildingDefinition[]): void => {
      for (const building of buildings) this.buildTownBuilding(building, isRuinedTownBuilding(building, fallen));
    };
    if (this.state.currentArea.theme === 'elaris') {
      this.entrance = new TownEntrance(this.models, this.state);
      this.worldRoot.add(this.entrance.root);
      this.entrance.build(settlementBuildings.map((building) => building.footprint));
      const environment = composeHeroEnvironment(
        this.state.currentArea.seed,
        settlementBuildings.map((building) => building.footprint),
      );
      this.buildHeroEnvironment(environment);
      buildSettlement(settlementBuildings);
      this.buildTownDefences(fallen);
      this.buildWaterTemple();
      // The beacon is the town's "you are safe here" light. It goes out with it.
      if (!fallen) this.buildSanctuaryBeacon();
    } else if (settlementBuildings.length > 0) {
      buildSettlement(settlementBuildings);
    }
    this.buildTownPaths();
    this.buildRegionalLandmark();
    this.buildLandscapeTerrain();
    this.syncEntities(true);
  }

  /** Render the same semantic tile mask that owns collision in the simulation. */
  private buildLandscapeTerrain(): void {
    const depthMask=new Uint8Array(WORLD_TILES*WORLD_TILES);
    const tiles: Record<Exclude<TerrainKind, 'ground'>, Array<{ x: number; z: number }>> = {
      'shallow-water': [],
      'deep-water': [],
      bridge: [],
      'rock-wall': [],
    };
    for (let tileZ = 0; tileZ < WORLD_TILES; tileZ += 1) {
      for (let tileX = 0; tileX < WORLD_TILES; tileX += 1) {
        const kind = terrainAt(this.state.seed, this.state.currentArea, tileX, tileZ);
        depthMask[tileZ*WORLD_TILES+tileX]=kind==='deep-water'?255:kind==='shallow-water'?128:kind==='bridge'?190:0;
        if (kind !== 'ground') tiles[kind].push({ x: tileX + 0.5, z: tileZ + 0.5 });
      }
    }

    const addInstances = (
      name: string,
      entries: readonly { x: number; z: number }[],
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      y: number,
    ): void => {
      if (entries.length === 0) return;
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.name = name;
      const matrix = new THREE.Matrix4();
      entries.forEach((entry, index) => {
        matrix.makeTranslation(entry.x, y, entry.z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.castShadow = name === 'landscape.rock-wall';
      this.worldRoot.add(mesh);
    };

    addInstances(
      'landscape.deep-water', tiles['deep-water'], new THREE.BoxGeometry(1.02, 0.045, 1.02),
      // Unlit water retains its depth palette beneath the daylight rig.
      styledWaterMaterial(0x285666, .95, depthMask), -0.035,
    );
    addInstances(
      'landscape.shallow-water', tiles['shallow-water'], new THREE.BoxGeometry(1.02, 0.05, 1.02),
      styledWaterMaterial(0x6f9884, .93, depthMask), -0.025,
    );
    addInstances(
      'landscape.bridge', tiles.bridge, new THREE.BoxGeometry(1.02, 0.16, 1.02),
      new THREE.MeshStandardMaterial({ color: 0x8c623d, roughness: 0.9 }), 0.035,
    );
    addInstances(
      'landscape.rock-wall', tiles['rock-wall'], new THREE.BoxGeometry(1.04, 0.95, 1.04),
      new THREE.MeshStandardMaterial({ color: this.state.currentArea.theme === 'mountain' ? 0x737e78 : 0x59635e, roughness: 1 }), 0.39,
    );
    const bridges = tiles.bridge.filter(({x,z}) => !(this.entrance && x >= 51 && x <= 66 && z >= 72 && z <= 101));
    void this.worldArt?.batch(this.worldRoot, 'entrance.deck', bridges.map(({x,z}) => ({x,y:.117,z})), .0101);
    const walls = this.worldRoot.getObjectByName('landscape.rock-wall');
    if (walls) void this.worldArt?.surface(walls, 'entrance.rock', .12);
  }

  private areaPalette(): { sky: number; ground: number; patch: number; accent: number } {
    switch (this.state.currentArea.theme) {
      case 'forest': return { sky: 0x8db39a, ground: 0x31533d, patch: 0x234631, accent: 0x648d52 };
      case 'mountain': return { sky: 0xbac8c3, ground: 0x526154, patch: 0x465048, accent: 0x7d8b7e };
      case 'meadow': return { sky: 0xb7d9c3, ground: 0x66834c, patch: 0x547642, accent: 0x9aaa5c };
      case 'thicket': return { sky: 0x91b59e, ground: 0x3b6045, patch: 0x2c4f38, accent: 0x71955b };
      case 'marsh': return { sky: 0x9aada2, ground: 0x4c6253, patch: 0x3e554a, accent: 0x778865 };
      case 'elaris': return { sky: 0xa8d2bc, ground: 0x507345, patch: 0x33583e, accent: 0x78965a };
    }
  }

  private buildHeroEnvironment(environment: HeroEnvironmentComposition): void {
    // Trees are gameplay resources only: every tree in the world is a choppable
    // resource node (rendered in syncEntities), so no decorative tree ring is
    // drawn around the town.
    this.buildGroundDetails(environment.groundDetails);
    // Rivers and bridges come exclusively from the authoritative landscape mask.
    this.buildAmbientMotes(environment);
  }

  private buildGroundDetails(details: readonly EnvironmentPlacement[]): void {
    const leafGeometry = new THREE.CircleGeometry(0.11, 5);
    const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x8b643a, roughness: 1, side: THREE.DoubleSide });
    const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, details.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let index = 0; index < details.length; index += 1) {
      const detail = details[index]!;
      rotation.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, detail.rotation));
      scale.set(detail.scale * (detail.variant > 0.82 ? 1.8 : 1), detail.scale, detail.scale * 0.55);
      matrix.compose(new THREE.Vector3(detail.x, -0.045, detail.z), rotation, scale);
      leaves.setMatrixAt(index, matrix);
    }
    leaves.receiveShadow = true;
    this.worldRoot.add(leaves);

    // A restrained number of recognizable props keeps the clearing authored
    // without making scenic plants look like dense interactive resources.
    for (let index = 0; index < details.length; index += 5) {
      const detail = details[index]!;
      const key: ModelAssetKey = detail.variant > 0.34 ? 'entrance.flowers'
        : detail.variant < 0.18 ? 'entrance.pebble' : 'entrance.grass';
      const height = key === 'entrance.flowers' ? .25 : key === 'entrance.grass' ? .22 : .16;
      this.addModel(this.worldRoot, key, { x: detail.x, y: 0, z: detail.z }, detail.rotation, height * detail.scale);
    }
  }

  private buildAmbientMotes(environment: HeroEnvironmentComposition): void {
    const count = 28;
    const positions = new Float32Array(count * 3);
    const bases: THREE.Vector3[] = [];
    const phases: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const detail = environment.groundDetails[(index * 7) % environment.groundDetails.length]!;
      const base = new THREE.Vector3(detail.x, 0.7 + detail.variant * 2.2, detail.z);
      bases.push(base);
      phases.push(detail.rotation);
      positions.set([base.x, base.y, base.z], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffe89a,
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'atmosphere.forest-motes';
    points.frustumCulled = false;
    this.worldRoot.add(points);
    this.ambientMotes = { points, bases, phases };
  }

  private buildTownPaths(): void {
    const tiles: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < WORLD_TILES; y++) for (let x = 0; x < WORLD_TILES; x++) {
      if (isRoadTile(this.state.currentArea.key, x, y) && terrainAt(this.state.seed, this.state.currentArea, x, y) === 'ground') tiles.push({ x, y });
    }
    if (!tiles.length) return;
    const mask=new Uint8Array(WORLD_TILES*WORLD_TILES);
    for(const {x,y} of tiles)mask[y*WORLD_TILES+x]=255;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.005, 1.005).rotateX(-Math.PI / 2),
      entranceRoadMaterial(mask), tiles.length);
    mesh.name = 'landscape.road'; mesh.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    tiles.forEach(({ x, y }, index) => { matrix.makeTranslation(x + .5, -.025, y + .5); mesh.setMatrixAt(index, matrix); });
    mesh.instanceMatrix.needsUpdate = true; this.worldRoot.add(mesh);
  }

  private buildRegionalLandmark(): void {
    const definition = regionalIdentityForArea(this.state.currentArea.key);
    if (!definition) return;
    const group = new THREE.Group();
    group.name = `landmark.${definition.landmark.id}`;
    group.position.set(definition.landmark.tileX + 0.5, 0, definition.landmark.tileY + 0.5);

    if (definition.landmark.kind === 'sunwheel-orchard') {
      for (let point = 0; point < 8; point += 1) {
        const angle = point / 8 * Math.PI * 2;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.12, 0.7, 6),
          new THREE.MeshStandardMaterial({ color: 0x76512c, roughness: 1 }),
        );
        trunk.position.set(Math.cos(angle) * 1.15, 0.35, Math.sin(angle) * 0.82);
        const canopy = new THREE.Mesh(
          new THREE.SphereGeometry(0.42, 8, 6),
          new THREE.MeshStandardMaterial({ color: point % 2 === 0 ? 0xb8c94d : 0x82a83f, roughness: 0.95 }),
        );
        canopy.position.copy(trunk.position).setY(0.9);
        trunk.castShadow = true;
        canopy.castShadow = true;
        group.add(trunk, canopy);
      }
      const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.48, 0.1, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0xf4cf62, roughness: 0.55, metalness: 0.2 }),
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.y = 0.12;
      group.add(wheel);
    } else {
      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(1.28, 1.36, 0.28, 24),
        new THREE.MeshStandardMaterial({ color: 0x273b48, roughness: 0.82, metalness: 0.05 }),
      );
      basin.position.y = 0.14;
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(1.03, 1.03, 0.035, 24),
        new THREE.MeshStandardMaterial({
          color: 0x61d9da,
          emissive: 0x205d75,
          emissiveIntensity: 0.75,
          roughness: 0.18,
          metalness: 0.12,
        }),
      );
      water.position.y = 0.3;
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(1.14, 0.16, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0x9b91b8, roughness: 0.72 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.33;
      const spire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.34, 3.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x745da5, emissive: 0x24183d, emissiveIntensity: 0.35, roughness: 0.55 }),
      );
      spire.position.y = 1.88;
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.58, 0),
        new THREE.MeshStandardMaterial({ color: 0xeee6ff, emissive: 0x7955b8, emissiveIntensity: 1.35, roughness: 0.25 }),
      );
      crystal.position.y = 3.82;
      for (const [radius, height] of [[0.5, 1.45], [0.72, 2.45]] as const) {
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(radius, 0.055, 6, 22),
          new THREE.MeshStandardMaterial({ color: 0x9bf2e9, emissive: 0x3f998f, emissiveIntensity: 1.1 }),
        );
        halo.rotation.x = Math.PI / 2;
        halo.position.y = height;
        group.add(halo);
      }
      const glow = new THREE.PointLight(0x9bf2e9, 1.8, 8, 2);
      glow.position.y = 2.8;
      basin.receiveShadow = true;
      spire.castShadow = true;
      group.add(basin, water, rim, spire, crystal, glow);
    }

    this.worldRoot.add(group);
    this.addLandmarkBeacon(group, new THREE.Color(definition.landmark.color).getHex(), 10.5);
  }

  /** Elaris' clean-air sanctuary remains visible through trees and encroaching fog. */
  private buildSanctuaryBeacon(): void {
    const root = new THREE.Group();
    root.name = 'landmark.elaris-waylight';
    root.position.set(ELARIS_SANCTUARY_TILE.x + 0.5, 0.04, ELARIS_SANCTUARY_TILE.y + 0.5);
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.58, 0.32, 8),
      new THREE.MeshStandardMaterial({ color: 0x425d50, roughness: 0.9, flatShading: true }),
    );
    plinth.position.y = 0.16;
    plinth.castShadow = true;
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3, 0),
      new THREE.MeshStandardMaterial({
        color: 0xcaf9cf,
        emissive: 0x3d9b68,
        emissiveIntensity: 1.7,
        roughness: 0.28,
        flatShading: true,
      }),
    );
    crystal.position.y = 0.72;
    const light = new THREE.PointLight(0x8ff0b2, 2.4, 7, 2);
    light.position.y = 1.05;
    root.add(plinth, crystal, light);
    this.worldRoot.add(root);
    this.addLandmarkBeacon(root, 0x9bf5bd, 9.5);
  }

  /** Additive beacon columns are cheap, readable at map scale, and region-specific. */
  private addLandmarkBeacon(parent: THREE.Group, color: number, height: number): void {
    const root = new THREE.Group();
    root.name = 'landmark.beacon';
    const beamMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.48, height, 10, 1, true), beamMaterial);
    beam.position.y = height / 2 + 0.5;
    const haloMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 6, 28), haloMaterial);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.34;
    root.add(beam, halo);
    parent.add(root);
    this.landmarkBeacon = { root, beamMaterial, halo, baseOpacity: beamMaterial.opacity };
  }

  /** Permanent, indestructible perimeter and clean-air fixtures for Elaris. */
  private buildTownDefences(fallen = false): void {
    TOWN_PERIMETER_SEGMENTS.forEach((segment, index) => {
      // Breaches in a fallen perimeter, matching the 2D scene piece for piece.
      if (fallen && index % 3 === 0) return;
      const dx = segment.end.x - segment.start.x;
      const dz = segment.end.y - segment.start.y;
      const rotationY = Math.atan2(-dz, dx);
      if (segment.kind === 'fence') {
        const length = Math.hypot(dx, dz);
        void this.addModel(
          this.worldRoot,
          'entrance.railing',
          { x: (segment.start.x + segment.end.x) / 2, y: 0, z: (segment.start.y + segment.end.y) / 2 },
          rotationY,
          0.92,
          undefined,
          // The imported fence is calibrated to the normal two-space span.
          // Scale only the occasional one-space remainder at an odd run end.
          { x: length / 2, y: 1, z: 1 },
        );
        return;
      }

      // Anchor the gate at one end instead of its center. Rotating this pivot
      // produces the same inward quarter-turn used by player-built doors.
      const root = new THREE.Group();
      root.name = `town.fence-gate.${index}`;
      root.position.set(segment.start.x, 0, segment.start.y);
      root.rotation.y = rotationY;
      this.worldRoot.add(root);
      const pivot = new THREE.Group();
      root.add(pivot);
      const length = Math.hypot(dx, dz);
      void this.addModel(pivot, 'town.fence-gate', { x: length / 2, y: 0, z: 0 }, 0, 0.92);
      const id = `town-gate-${index}`;
      pivot.rotation.y = (this.townGateOpenness.get(id) ?? 0) * DOOR_OPEN_ANGLE;
      this.townGatePivots.set(id, {
        pivot,
        cx: (segment.start.x + segment.end.x) / 2,
        cz: (segment.start.y + segment.end.y) / 2,
      });
    });

    // The town's public workbench, drawn from the same model a player-built one
    // uses. It survives the fall as scenery — a bench you can walk up to and
    // fail to use teaches the loss better than an empty patch of ground.
    const bench = new THREE.Group();
    bench.name = 'town.public-workbench';
    bench.position.set(
      ELARIS_PUBLIC_WORKBENCH_TILE.tileX + ELARIS_PUBLIC_WORKBENCH_SIZE.tilesWide / 2,
      0,
      ELARIS_PUBLIC_WORKBENCH_TILE.tileY + ELARIS_PUBLIC_WORKBENCH_SIZE.tilesHigh / 2,
    );
    this.addModel(bench, 'survival.workbench-anvil', { x: 0, y: 0, z: 0 }, 0, 1.05);
    this.worldRoot.add(bench);

    // A cold purifier is removed, never dimmed: its glow is the player's cue
    // that the air here is safe. The permanent column never goes cold, so it
    // survives the fall and stays lit — in the ruins it is the only green light
    // left, which is exactly the reading a roaming player needs.
    const stone = new THREE.MeshStandardMaterial({ color: 0x68716f, roughness: 0.98 });
    for (const purifier of fallen ? [PERMANENT_AIR_PURIFIER] : [...TOWN_AIR_PURIFIERS, PERMANENT_AIR_PURIFIER]) {
      const root = new THREE.Group();
      root.name = `town.air-purifier.${purifier.x}.${purifier.y}`;
      root.position.set(purifier.x + 0.5, 0, purifier.y + 0.5);
      const column = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.1, 0.62), stone);
      column.position.y = 0.55;
      column.castShadow = true;
      root.add(column);
      const vent = new THREE.PointLight(0x7fe3b0, 2, 3, 2);
      vent.position.y = 1.2;
      root.add(vent);
      this.worldRoot.add(root);
    }
  }

  /** A bright, columned shrine gives the north-west lake a distant silhouette. */
  private buildWaterTemple(): void {
    const root = new THREE.Group();
    root.name = 'landmark.elaris-water-temple';
    root.position.set(ELARIS_WATER_TEMPLE.tileX + 0.5, 0, ELARIS_WATER_TEMPLE.tileY + 0.5);

    const paleStone = new THREE.MeshStandardMaterial({ color: 0xc9d8cf, roughness: 0.78, flatShading: true });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x58747a, roughness: 0.9, flatShading: true });
    const aqua = new THREE.MeshStandardMaterial({
      color: 0x28aeb0, emissive: 0x155761, emissiveIntensity: 0.65, roughness: 0.3, metalness: 0.12,
    });

    const islandShelf = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.8, 0.3, 18), darkStone);
    islandShelf.position.y = 0.05;
    islandShelf.receiveShadow = true;
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 4.35, 0.48, 8), paleStone);
    platform.position.y = 0.34;
    platform.castShadow = true;
    platform.receiveShadow = true;
    root.add(islandShelf, platform);

    for (const z of [3.15, 3.7, 4.25]) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(2.5 + (z - 3.15) * 1.1, 0.18, 0.7), paleStone);
      step.position.set(0, 0.22 + (z - 3.15) * 0.15, z);
      step.castShadow = true;
      root.add(step);
    }

    for (const [x, z] of [[-2.45, -2.05], [2.45, -2.05], [-2.45, 2.05], [2.45, 2.05]] as const) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 3.25, 8), paleStone);
      column.position.set(x, 2.18, z);
      column.castShadow = true;
      const capital = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.2, 0.72), darkStone);
      capital.position.set(x, 3.78, z);
      root.add(column, capital);
    }

    const roofSlab = new THREE.Mesh(new THREE.CylinderGeometry(3.75, 3.75, 0.28, 8), darkStone);
    roofSlab.position.y = 3.98;
    roofSlab.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.65, 1.65, 8), aqua);
    roof.position.y = 4.92;
    roof.rotation.y = Math.PI / 8;
    roof.castShadow = true;
    root.add(roofSlab, roof);

    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.45, 0.48, 12), darkStone);
    basin.position.y = 0.82;
    const basinWater = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.08, 20), aqua);
    basinWater.position.y = 1.08;
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), aqua);
    pearl.position.y = 2.05;
    const light = new THREE.PointLight(0x7ff9ed, 2.8, 10, 2);
    light.position.y = 2.3;
    root.add(basin, basinWater, pearl, light);

    for (let point = 0; point < 8; point += 1) {
      const angle = point / 8 * Math.PI * 2;
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.38, 1.05, 6), darkStone);
      marker.position.set(Math.cos(angle) * 5.3, 0.52, Math.sin(angle) * 3.95);
      marker.rotation.z = Math.cos(angle) * 0.08;
      marker.castShadow = true;
      root.add(marker);
    }

    this.worldRoot.add(root);
  }

  private buildTownBuilding(building: TownBuildingDefinition, ruined = false): void {
    if (building.id === 'arena') {
      this.buildArena(building, ruined);
      return;
    }
    const group = new THREE.Group();
    group.name = `town.${building.id}`;
    group.position.set(building.footprint.tileX + building.footprint.tilesWide / 2, 0,
      building.footprint.tileY + building.footprint.tilesHigh / 2);
    this.worldRoot.add(group);
    const revision = this.worldRevision;
    const assembly = this.entrance && building.id === 'weaponsmith'
      ? this.entrance.buildForge(group, building, ruined)
      : buildStyledSettlement(this.worldArt!, group, building, ruined);
    void assembly.then((materials) => {
      if (revision !== this.worldRevision || !group.parent) return;
      this.registerOccluder(group, building.footprint.tilesWide * .43, materials, .24, 'world');
    });
    const label = this.createWorldLabel(ruined ? `${building.displayName} (ruined)` : building.displayName);
    label.position.set(0, building.id === 'church' ? 8 : building.id === 'magic-shop' ? 8.7 : 5.5, 0);
    group.add(label);
  }

  private buildArena(building: TownBuildingDefinition, ruined = false): void {
    const { footprint, interiorTheme } = building;
    const group = new THREE.Group();
    group.position.set(footprint.tileX + footprint.tilesWide / 2, 0, footprint.tileY + footprint.tilesHigh / 2);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.min(footprint.tilesWide, footprint.tilesHigh) * 0.47, Math.min(footprint.tilesWide, footprint.tilesHigh) * 0.47, 0.28, 32),
      new THREE.MeshStandardMaterial({ color: 0x9a7655, roughness: 1 }),
    );
    floor.position.y = 0.08;
    floor.receiveShadow = true;
    group.add(floor);
    const floorUv=floor.geometry.getAttribute('uv');
    for(let i=0;i<floorUv.count;i++) floorUv.setXY(i,floorUv.getX(i)*3,floorUv.getY(i)*3);
    void this.worldArt?.surface(floor, 'entrance.paving', .15);
    const railMaterial = new THREE.MeshStandardMaterial({ color: interiorTheme.exteriorRoof, roughness: 0.9 });
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.35, 0.32), railMaterial);
      post.position.set(Math.cos(angle) * 4.1, 0.68, Math.sin(angle) * 4.1);
      post.castShadow = true;
      void this.worldArt?.surface(post, 'entrance.deck', .2);
      group.add(post);
    }
    if (ruined) applyRuinAppearance(group);
    group.name = 'town.arena';
    group.userData.visualStyle = 'quaternius';
    this.worldRoot.add(group);
  }

  private syncEntities(force = false): void {
    const signature = this.computeEntitySignature();
    if (!force && signature === this.entitySignature) return;
    this.detectEntityEffects(force);
    this.entitySignature = signature;
    const live = new Set<string>();
    const sync = (key: string, visualSignature: string, create: () => void): void => {
      live.add(key);
      if (this.entityVisuals.get(key)?.signature === visualSignature) return;
      this.removeEntityVisual(key);
      const index = this.entityRoot.children.length;
      create();
      const root = this.entityRoot.children[index];
      if (root) this.entityVisuals.set(key, { signature: visualSignature, root });
    };
    const doorIds = new Set(this.state.buildings
      .filter((building) => building.definitionId.includes('door') || building.definitionId.includes('gate'))
      .map((building) => building.id));
    for (const id of [...this.doorOpenness.keys()]) if (!doorIds.has(id)) this.doorOpenness.delete(id);
    for (const node of this.state.resourceNodes) {
      sync(`resource:${node.id}`, `${node.kind}:${node.x}:${node.y}:${node.hp > 0}`, () => this.buildResourceNode(node));
    }
    for (const creature of this.state.wildCreatures) {
      sync(`creature:${creature.id}`, `${creature.speciesId}:${creature.level}`, () => {
      const position = worldToThree(creature.x, creature.y);
      const rig = createCreatureRig(creature.speciesId);
      rig.root.position.set(position.x, 0, position.z);
      rig.root.name = creature.id;
      rig.root.userData.speciesId = creature.speciesId;
      const idlePhase = coordinateHash(this.state.currentArea.seed, Math.floor(position.x), Math.floor(position.z)) * Math.PI * 2;
      rig.root.userData.idlePhase = idlePhase;
      rig.root.userData.baseRotation = idlePhase;
      rig.root.rotation.y = idlePhase;
      // Parented to the rig root, so the plate travels with the creature for
      // free. The offset is straight up the rotation axis, which is why a
      // turning creature does not swing its own label around.
      const plate = this.createLevelPlate(creature.level);
      plate.position.set(0, Math.max(CREATURE_PLATE_HEIGHT, Number(rig.root.userData.modelHeight ?? 0) + .22), 0);
      rig.root.add(plate);
      this.creatureRigs.set(creature.id, rig);
      this.entityRoot.add(rig.root);
      this.modelCount += 1;
      });
    }
    for (const drop of this.state.groundDrops) {
      sync(`drop:${drop.id}`, `${drop.resource}:${drop.x}:${drop.y}:${drop.amount}`, () => {
      const position = worldToThree(drop.x, drop.y);
      const material = new THREE.MeshStandardMaterial({
        color: drop.resource.includes('iron') ? 0x8a6a58 : drop.resource === 'wood' ? 0x825535 : drop.resource === 'fiber' ? 0xc8c77b : 0x778080,
        roughness: 0.85,
      });
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.23), material);
      mesh.position.set(position.x, 0.24, position.z);
      mesh.castShadow = true;
      mesh.name = drop.id;
      this.entityRoot.add(mesh);
      });
    }
    for (const building of this.state.buildings) {
      sync(`building:${building.id}`, this.buildingVisualSignature(building), () => this.buildPlacedStructure(building));
    }
    for (const key of this.entityVisuals.keys()) if (!live.has(key)) this.removeEntityVisual(key);
  }

  private removeEntityVisual(key: string): void {
    const visual = this.entityVisuals.get(key);
    if (!visual) return;
    for (let index = this.occluders.length - 1; index >= 0; index--) {
      let ancestor: THREE.Object3D | null = this.occluders[index]!.object;
      while (ancestor && ancestor !== visual.root) ancestor = ancestor.parent;
      if (ancestor === visual.root) this.occluders.splice(index, 1);
    }
    if (key.startsWith('creature:')) { this.creatureRigs.delete(visual.root.name); this.modelCount--; }
    if (key.startsWith('building:')) this.doorPivots.delete(visual.root.name);
    visual.root.traverse((child) => { if (child.userData.modelAssetInstance) this.modelCount--; });
    this.entityRoot.remove(visual.root);
    this.disposeObject(visual.root);
    this.entityVisuals.delete(key);
  }

  private buildingVisualSignature(building: BuildingState): string {
    return [building.id, building.definitionId, building.tileX, building.tileY, building.rotated ? 1 : 0,
      building.boundaryEdge ?? '', building.furnace?.queue.length ?? 0,
      building.garden?.readyFiber ?? 0, building.woodlot?.readyWood ?? 0,
      cropGrowthStage(building.garden?.progressTicks ?? 0, GARDEN_BED_GROW_TICKS),
      cropGrowthStage(building.woodlot?.progressTicks ?? 0, WOODLOT_GROW_TICKS),
      building.turret?.ammo ?? 0].join(':');
  }

  private computeEntitySignature(): string {
    const resources = this.state.resourceNodes.map((node) => `${node.id}:${node.hp}`).join(',');
    // The level joins the id: the plate is built with the rig, so a creature
    // whose level changed has to be rebuilt to say so.
    const creatures = this.state.wildCreatures
      .map((creature) => `${creature.id}:${creature.level}`)
      .join(',');
    const drops = this.state.groundDrops.map((drop) => `${drop.id}:${drop.amount}`).join(',');
    const buildings = this.state.buildings.map((building) => this.buildingVisualSignature(building)).join(',');
    return `${this.state.currentArea.key}|${resources}|${creatures}|${drops}|${buildings}`;
  }

  private detectEntityEffects(seedOnly: boolean): void {
    if (!seedOnly) {
      for (const node of this.state.resourceNodes) {
        const previousHp = this.resourceHp.get(node.id);
        if (previousHp !== undefined && node.hp < previousHp) this.spawnImpactEffect(node, node.hp <= 0);
      }
      const currentDropIds = new Set(this.state.groundDrops.map((drop) => drop.id));
      for (const [id, position] of this.previousDrops) {
        if (currentDropIds.has(id)) continue;
        const player = worldToThree(this.state.player.x, this.state.player.y);
        const old = worldToThree(position.x, position.y);
        if (Math.hypot(player.x - old.x, player.z - old.z) <= 3) this.spawnPickupEffect(old.x, old.z);
      }
    }
    this.resourceHp.clear();
    for (const node of this.state.resourceNodes) this.resourceHp.set(node.id, node.hp);
    this.previousDrops.clear();
    for (const drop of this.state.groundDrops) this.previousDrops.set(drop.id, { x: drop.x, y: drop.y });
  }

  private buildResourceNode(node: ResourceNodeState): void {
    const position = worldToThree(node.x, node.y);
    const root = new THREE.Group();
    root.position.set(position.x, 0, position.z);
    root.name = node.id;
    root.userData.resourceId = node.id;
    root.userData.resourceKind = node.kind;
    this.entityRoot.add(root);

    if (node.hp <= 0) {
      if (node.kind === 'tree') this.addModel(root, 'nature.stump', { x: 0, y: 0, z: 0 }, 0, 0.62);
      else this.addDepletedMarker(root, node.kind);
      return;
    }
    switch (node.kind) {
      case 'tree': {
        const variant = coordinateHash(this.state.currentArea.seed, Math.floor(position.x), Math.floor(position.z));
        const entranceVariant = variant < 0 ? variant + 1 : variant;
        const key: ModelAssetKey = this.state.currentArea.theme === 'mountain' || entranceVariant > .72
          ? 'entrance.pine' : entranceVariant > .38 ? 'entrance.tree-broad' : 'entrance.tree';
        this.addOccludingModel(root, key, { x: 0, y: 0, z: 0 }, variant * Math.PI * 2, undefined, 1.05, 'entity');
        break;
      }
      case 'stone':
        this.addModel(root, 'entrance.rock', { x: 0, y: 0, z: 0 }, node.x * 0.01, 1.15);
        break;
      case 'metal':
        this.addModel(root, 'entrance.rock', { x: 0, y: 0, z: 0 }, node.x * 0.01, 1.2, 0xc17a49);
        this.addOreCrystals(root);
        break;
      case 'plant':
        this.addModel(root, 'entrance.fern', { x: 0, y: 0, z: 0 }, node.y * 0.01, 0.58);
        break;
      case 'berry-bush':
        this.addModel(root, 'entrance.bush', { x: 0, y: 0, z: 0 }, node.y * 0.01, 0.88);
        this.addBerries(root);
        break;
    }
  }

  private addDepletedMarker(root: THREE.Group, kind: ResourceNodeState['kind']): void {
    const color = kind === 'metal' ? 0x6f554a : kind === 'plant' || kind === 'berry-bush' ? 0x7c7242 : 0x68706e;
    const marker = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    marker.scale.y = 0.35;
    marker.position.y = 0.08;
    marker.castShadow = true;
    root.add(marker);
  }

  private addOreCrystals(root: THREE.Group): void {
    const material = new THREE.MeshStandardMaterial({ color: 0xd68a51, emissive: 0x4a1b0c, emissiveIntensity: 0.45, roughness: 0.6 });
    for (const [x, z, height] of [[-0.28, 0.12, 0.55], [0.08, -0.12, 0.7], [0.3, 0.17, 0.45]] as const) {
      const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.14, height, 5), material);
      crystal.position.set(x, 0.54, z);
      crystal.castShadow = true;
      root.add(crystal);
    }
  }

  private addBerries(root: THREE.Group): void {
    const material = new THREE.MeshStandardMaterial({ color: 0xb8404d, roughness: 0.6 });
    for (const [x, y, z] of [[-0.24, 0.55, 0.3], [0.2, 0.7, 0.15], [0.32, 0.48, -0.22], [-0.18, 0.72, -0.25]] as const) {
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 5), material);
      berry.position.set(x, y, z);
      root.add(berry);
    }
  }

  /**
   * A Woodlot Planter is a tilled 2×2 plot with one tree growing in it. Newly
   * planted it is a bare trunk; at maturity the tree is the exact size of a
   * wild `tree` resource node (same model, same natural scale), so a grown
   * planter and a choppable tree read as the same object. Cut wood waiting to
   * be collected stacks beside the trunk.
   */
  private addWoodlotPlanter(root: THREE.Group, building: BuildingState, wood: THREE.Material): void {
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.86, 0.94, 0.14, 12),
      new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }),
    );
    soil.position.set(0.5, 0.07, 0.5);
    soil.receiveShadow = true;
    root.add(soil);
    // Four low corner posts keep the plot reading as built, not wild.
    for (const [px, pz] of [[-0.32, -0.32], [-0.32, 1.32], [1.32, -0.32], [1.32, 1.32]] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.14), wood);
      post.position.set(px, 0.17, pz);
      post.castShadow = true;
      root.add(post);
    }

    const growth = woodlotGrowth(building);
    if (growth <= 0) {
      // The planted trunk: a bare stump waiting to shoot.
      this.addModel(root, 'nature.stump', { x: 0.5, y: 0.14, z: 0.5 }, 0, 0.62);
    } else {
      // Scale to the wild tree's own size (targetHeight undefined) at maturity.
      const scale = 0.34 + 0.66 * growth;
      this.addOccludingModel(
        root, 'entrance.tree', { x: 0.5, y: 0.14, z: 0.5 }, 0, undefined, 1.05 * scale, 'entity',
        { x: scale, y: scale, z: scale },
      );
    }
    if ((building.woodlot?.readyWood ?? 0) > 0) {
      this.addModel(root, 'nature.log-stack', { x: 1.28, y: 0.14, z: 0.5 }, Math.PI / 2, 0.4);
    }
  }

  /**
   * The Garden Bed grows the same plant a wild `plant` node is: `nature.grass`
   * at its 0.58 height, scaled in from seedlings so a ripe bed matches the
   * fiber tufts it replaces.
   */
  private addGardenBedCrop(root: THREE.Group, building: BuildingState): void {
    const growth = gardenGrowth(building);
    const ready = (building.garden?.readyFiber ?? 0) > 0;
    const scale = ready ? 1 : 0.32 + 0.68 * growth;
    if (!ready && growth <= 0) return; // Freshly tilled soil: nothing sprouted yet.
    for (const x of [-0.16, 0.5, 1.16]) {
      this.addModel(root, 'entrance.grass', { x, y: 0.23, z: 0 }, x * 1.7, 0.58 * scale);
    }
  }

  private buildPlacedStructure(building: BuildingState): void {
    const root = new THREE.Group();
    const placedDefinition = buildableById(building.definitionId);
    // Boundary parts (walls/doors/fences/gates) are edge objects: anchor them on
    // the shared tile edge and orient from that edge, matching the placement
    // ghost. Everything else centers on its tile and rotates from `rotated`.
    const isBoundary = ['wall', 'door', 'fence', 'gate'].some((kind) => building.definitionId.includes(kind));
    if (isBoundary) {
      const edge = effectiveBoundaryEdge(building);
      const horizontal = edge === 'north' || edge === 'south';
      const center = boundaryCenterPx(
        building.tileX, building.tileY, edge, boundarySpan(placedDefinition),
      );
      root.position.set(center.x / TILE_SIZE, 0, center.y / TILE_SIZE);
      root.rotation.y = horizontal ? 0 : Math.PI / 2;
    } else if (placedDefinition.footprintKind === 'landscape') {
      const dimensions = effectiveDimensions(placedDefinition, building.rotated === true);
      root.position.set(
        building.tileX + dimensions.tilesWide / 2,
        0,
        building.tileY + dimensions.tilesHigh / 2,
      );
      root.rotation.y = building.rotated ? Math.PI / 2 : 0;
    } else {
      root.position.set(building.tileX + 0.5, 0, building.tileY + 0.5);
      root.rotation.y = building.rotated ? Math.PI / 2 : 0;
    }
    root.name = building.id;
    this.entityRoot.add(root);
    const wood = new THREE.MeshStandardMaterial({ color: 0x795334, roughness: 0.92 });
    const straw = new THREE.MeshStandardMaterial({ color: 0xb9a04e, roughness: 1 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x68716f, roughness: 0.98 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x56616b, roughness: 0.58, metalness: 0.72 });
    const material = building.definitionId.startsWith('thatch') ? straw
      : building.definitionId.startsWith('stone') ? stone
        : building.definitionId.startsWith('metal') ? metal : wood;

    if (building.definitionId === 'water') {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(0.98, 0.98),
        new THREE.MeshStandardMaterial({
          color: 0x3d9296,
          emissive: 0x163f49,
          emissiveIntensity: 0.18,
          transparent: true,
          opacity: 0.9,
          roughness: 0.28,
          metalness: 0.08,
          side: THREE.DoubleSide,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.035;
      water.receiveShadow = true;
      root.add(water);
    } else if (building.definitionId === 'wood-bridge') {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.14, 0.82), wood);
      deck.position.y = 0.14;
      deck.castShadow = true;
      deck.receiveShadow = true;
      root.add(deck);
      for (const x of [-0.72, -0.24, 0.24, 0.72]) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 0.84), stone);
        seam.position.set(x, 0.22, 0);
        root.add(seam);
      }
    } else if (building.definitionId === 'stone-bridge') {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.22, 0.9), stone);
      deck.position.y = 0.14;
      deck.castShadow = true;
      deck.receiveShadow = true;
      root.add(deck);
      for (const x of [-0.5, 0, 0.5]) {
        const joint = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.88), wood);
        joint.position.set(x, 0.265, 0);
        root.add(joint);
      }
    } else if (building.definitionId.includes('floor') || building.definitionId.includes('ground')) {
      const floor = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.09, 0.96), material);
      floor.position.y = -0.01;
      floor.receiveShadow = true;
      root.add(floor);
    } else if (building.definitionId.includes('door')) {
      this.addPlacedDoor(root, building);
    } else if (building.definitionId.includes('wall')) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.15, 0.18), material);
      wall.position.y = 0.58;
      wall.castShadow = true;
      root.add(wall);
    } else if (building.definitionId.includes('gate')) {
      this.addPlacedGate(root, building);
    } else if (building.definitionId.includes('fence')) {
      if (building.definitionId.startsWith('stone') || building.definitionId.startsWith('metal')) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.18), material);
        rail.position.y = 0.42;
        rail.castShadow = true;
        root.add(rail);
        for (const x of [-0.88, 0.88]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.82, 0.22), material);
          post.position.set(x, 0.41, 0);
          post.castShadow = true;
          root.add(post);
        }
      } else void this.addModel(root, 'entrance.railing', { x: 0, y: 0, z: 0 }, 0, 0.92);
    } else if (building.definitionId === 'field-cache') {
      this.addModel(root, 'survival.chest', { x: 0, y: 0, z: 0 }, 0, 0.78);
    } else if (building.definitionId === 'warehouse') {
      const shell = new THREE.Mesh(new THREE.BoxGeometry(2.85, 1.55, 1.82), stone);
      shell.position.set(1, 0.78, 0.5);
      shell.castShadow = true;
      root.add(shell);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.18, 2.02), metal);
      roof.position.set(1, 1.64, 0.5);
      roof.castShadow = true;
      root.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.12), wood);
      door.position.set(1, 0.62, 1.43);
      root.add(door);
      for (const x of [-0.05, 2.05]) this.addModel(root, 'survival.chest', { x, y: 0, z: 1.08 }, 0, 0.68);
    } else if (building.definitionId === 'logistics-hub') {
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 1, 0.24, 8), metal);
      platform.position.set(0.5, 0.12, 0.5);
      platform.castShadow = true;
      root.add(platform);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1.75, 8), metal);
      mast.position.set(0.5, 1, 0.5);
      mast.castShadow = true;
      root.add(mast);
      for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(0.13, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0x7fe3b0, emissive: 0x246b4b, emissiveIntensity: 1.6 }),
        );
        beacon.position.set(x, 0.56, z);
        root.add(beacon);
      }
      const signal = new THREE.PointLight(0x7fe3b0, 2.4, 4, 2);
      signal.position.set(0.5, 1.82, 0.5);
      root.add(signal);
    } else if (building.definitionId === 'workbench') {
      this.addModel(root, 'survival.workbench-anvil', { x: 0.5, y: 0, z: 0 }, 0, 1.05);
    } else if (building.definitionId === 'farm-counter') {
      const counter = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.78, 0.62), wood);
      counter.position.set(0.5, 0.39, 0);
      counter.castShadow = true;
      root.add(counter);
      this.addModel(root, 'survival.barrel', { x: -0.2, y: 0, z: 0.55 }, 0, 0.62);
      this.addModel(root, 'town.banner-green', { x: 1.25, y: 0, z: -0.15 }, 0, 1.2);
    } else if (building.definitionId === 'small-pen') {
      for (const [x, z, rotation] of [[0.5, -0.42, 0], [0.5, 1.42, 0], [-0.42, 0.5, Math.PI / 2], [1.42, 0.5, Math.PI / 2]] as const) {
        void this.addModel(root, 'entrance.railing', { x, y: 0, z }, rotation, 0.82);
      }
      const bedding = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.18, 8), straw);
      bedding.position.set(0.5, 0.1, 0.5);
      root.add(bedding);
      if ((building.housing?.bin.fiber ?? 0) > 0) {
        const ready = new THREE.PointLight(0xffdf74, 1.8, 2.5, 2);
        ready.position.set(0.5, 0.55, 0.5);
        root.add(ready);
      }
    } else if (building.definitionId === 'barn') {
      const walls = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 1.45, 1.75),
        new THREE.MeshStandardMaterial({ color: 0x8f3f2f, roughness: 0.92 }),
      );
      walls.position.set(1, 0.73, 0.5);
      walls.castShadow = true;
      root.add(walls);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(2.05, 1.0, 4),
        new THREE.MeshStandardMaterial({ color: 0x4b3024, roughness: 0.96 }),
      );
      roof.position.set(1, 1.65, 0.5);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.7;
      roof.castShadow = true;
      root.add(roof);
      void this.worldArt?.add(root,{key:'entrance.roof',x:1,y:1.3,z:.5,height:.9,width:3.25,depth:2.2})
        .then((model)=>{if(model)roof.visible=false;});
      this.addModel(root, 'town.door-wood', { x: 1, y: 0, z: 1.39 }, Math.PI, 0.72);
      this.addModel(root, 'survival.barrel', { x: 2.05, y: 0, z: 1.12 }, 0, 0.66);
    } else if (building.definitionId === 'stone-yard') {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.9), wood);
      curb.position.set(0.5, 0.08, 0.5);
      curb.castShadow = true;
      root.add(curb);
      const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x747b78, roughness: 1 });
      const stored = Math.min(7, Math.ceil((building.producer?.bin.stone ?? 0) / 3));
      for (let index = 0; index < Math.max(3, stored); index += 1) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + (index % 2) * 0.06, 0), rockMaterial);
        rock.position.set(0.05 + (index % 3) * 0.48, 0.3 + Math.floor(index / 3) * 0.3, 0.25 + (index % 2) * 0.55);
        rock.rotation.set(index * 0.4, index * 0.7, 0);
        rock.castShadow = true;
        root.add(rock);
      }
      this.addModel(root, 'survival.workbench-anvil', { x: 1.32, y: 0.18, z: 1.18 }, Math.PI / 2, 0.72);
    } else if (building.definitionId === 'cart-dock') {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 1.4), wood);
      deck.position.set(0.5, 0.2, 0.5);
      deck.castShadow = true;
      root.add(deck);
      const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x3f2b1d, roughness: 0.95 });
      for (const x of [-0.25, 1.25]) for (const z of [0.12, 0.88]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 12), wheelMaterial);
        wheel.position.set(x, 0.25, z);
        wheel.rotation.z = Math.PI / 2;
        wheel.castShadow = true;
        root.add(wheel);
      }
      const hitch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.25), wood);
      hitch.position.set(0.5, 0.34, -0.55);
      root.add(hitch);
      this.addModel(root, 'survival.barrel', { x: 0.12, y: 0.3, z: 0.5 }, 0, 0.58);
      this.addModel(root, 'survival.chest', { x: 0.88, y: 0.3, z: 0.52 }, 0, 0.58);
    } else if (building.definitionId === 'furnace') {
      const furnace = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.86, 1.3, 10), stone);
      furnace.position.set(0.5, 0.65, 0);
      furnace.castShadow = true;
      root.add(furnace);
      if (building.furnace?.queue.length) {
        const glow = new THREE.PointLight(0xff6a28, 4, 4, 2);
        glow.position.set(0.5, 0.45, 0.65);
        root.add(glow);
      }
    } else if (building.definitionId === 'woodlot-planter') {
      this.addWoodlotPlanter(root, building, wood);
    } else if (building.definitionId === 'garden-bed') {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.26, 0.9), wood);
      bed.position.set(0.5, 0.1, 0);
      root.add(bed);
      this.addGardenBedCrop(root, building);
    } else if (building.definitionId === 'bed') {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 0.8), straw);
      bed.position.set(0.45, 0.18, 0);
      root.add(bed);
    } else if (building.definitionId === 'air-purifier') {
      const column = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.1, 0.62), stone);
      column.position.y = 0.55;
      column.castShadow = true;
      root.add(column);
      const vent = new THREE.PointLight(0x7fe3b0, 2, 3, 2);
      vent.position.y = 1.2;
      root.add(vent);
    } else if (building.definitionId === 'war-table') {
      // A two-tile map table: dark timber frame, parchment surface, standing
      // markers, and a banner — the same read as the 2D sprite.
      const frame = new THREE.MeshStandardMaterial({ color: 0x3f2c1c, roughness: 0.9 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.9), frame);
      top.position.set(0.5, 0.78, 0);
      top.castShadow = true;
      root.add(top);
      const map = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.03, 0.74),
        new THREE.MeshStandardMaterial({ color: 0xd9c79a, roughness: 0.95 }),
      );
      map.position.set(0.5, 0.855, 0);
      root.add(map);
      const legGeo = new THREE.BoxGeometry(0.12, 0.72, 0.12);
      for (const [lx, lz] of [[-0.34, -0.36], [-0.34, 0.36], [1.34, -0.36], [1.34, 0.36]] as const) {
        const leg = new THREE.Mesh(legGeo, frame);
        leg.position.set(lx, 0.36, lz);
        leg.castShadow = true;
        root.add(leg);
      }
      const pinGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6);
      const pins: readonly [number, number, number][] = [
        [0.02, -0.14, 0xc94a3a], [0.86, 0.16, 0xc94a3a], [0.5, -0.02, 0x6fbf73],
      ];
      for (const [px, pz, color] of pins) {
        const pin = new THREE.Mesh(pinGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
        pin.position.set(px, 0.95, pz);
        root.add(pin);
      }
      this.addModel(root, 'town.banner-red', { x: 1.5, y: 0, z: -0.1 }, 0, 1.7);
    } else if (building.definitionId === 'turret') {
      // A swivel bolt-thrower on a timber platform. The magazine light is the
      // ammo tell, matching the loaded/empty sprite pair.
      const platform = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.8), wood);
      platform.position.y = 0.11;
      platform.castShadow = true;
      root.add(platform);
      const ballast = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.22, 8), stone);
      ballast.position.y = 0.33;
      root.add(ballast);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.34, 0.46),
        new THREE.MeshStandardMaterial({ color: 0x3c4550, roughness: 0.7, metalness: 0.3 }),
      );
      head.position.y = 0.61;
      head.castShadow = true;
      root.add(head);
      const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.1, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.6, metalness: 0.4 }),
      );
      barrel.position.set(0.42, 0.63, 0);
      root.add(barrel);
      const loaded = (building.turret?.ammo ?? 0) > 0;
      const magazine = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.08, 0.2),
        new THREE.MeshStandardMaterial({
          color: loaded ? 0x7fe3b0 : 0x8a3a34,
          emissive: loaded ? 0x2f6b4e : 0x3a1512,
          roughness: 0.5,
        }),
      );
      magazine.position.y = 0.82;
      root.add(magazine);
    }
    root.userData.visualStyle='quaternius';
    root.traverse((child)=>{
      if(!(child instanceof THREE.Mesh))return;
      if(child.material===wood||child.material===straw) void this.worldArt?.surface(child,'entrance.deck',.5);
      else if(child.material===stone) void this.worldArt?.surface(child,'entrance.paving',.4);
    });
  }

  /**
   * A player-built door: a dark timber frame (jambs + lintel) with a saturated
   * leaf hinged on the left jamb. The leaf sits on its own pivot so
   * updateDoorSwings can rotate it open/closed as the player passes through.
   */
  private addPlacedDoor(root: THREE.Group, building: BuildingState): void {
    const W = 0.95;   // opening span across the tile edge
    const H = 1.5;    // frame height
    const D = 0.16;   // frame depth
    const jt = 0.12;  // jamb thickness
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.85 });
    const jambGeo = new THREE.BoxGeometry(jt, H, D);
    for (const side of [-1, 1] as const) {
      const jamb = new THREE.Mesh(jambGeo, frameMat);
      jamb.position.set(side * (W / 2 - jt / 2), H / 2, 0);
      jamb.castShadow = true;
      root.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(W, 0.16, D), frameMat);
    lintel.position.set(0, H - 0.08, 0);
    lintel.castShadow = true;
    root.add(lintel);

    // Warm oak-red for wood, deep woven gold for thatch — distinct from walls.
    const leafColor = building.definitionId.startsWith('thatch') ? 0xb2942f
      : building.definitionId.startsWith('stone') ? 0x737b79
        : building.definitionId.startsWith('metal') ? 0x56616b : 0x8a4b24;
    const pivot = new THREE.Group();
    pivot.position.set(-(W / 2 - jt), 0, 0); // hinge at the inner face of the left jamb
    root.add(pivot);
    const leafW = W - 2 * jt;
    const leafH = H - 0.18;
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(leafW, leafH, 0.07),
      new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.7 }),
    );
    leaf.position.set(leafW / 2, leafH / 2 + 0.02, 0);
    leaf.castShadow = true;
    pivot.add(leaf);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8c15a, roughness: 0.4, metalness: 0.6 }),
    );
    knob.position.set(leafW - 0.09, leafH / 2 + 0.02, 0.06);
    pivot.add(knob);

    pivot.rotation.y = (this.doorOpenness.get(building.id) ?? 0) * DOOR_OPEN_ANGLE;
    this.doorPivots.set(building.id, { pivot, cx: root.position.x, cz: root.position.z });
  }

  /** Put a fence-gate model on an end hinge so it can swing like a door leaf. */
  private addPlacedGate(root: THREE.Group, building: BuildingState): void {
    const pivot = new THREE.Group();
    // Gates occupy the same two-edge span as fences; stretching from the end
    // hinge keeps the full opening clear when the leaf swings.
    pivot.position.x = -1;
    pivot.scale.x = 2;
    root.add(pivot);
    void this.addModel(pivot, 'town.fence-gate', { x: 0.5, y: 0, z: 0 }, 0, 0.92);
    pivot.rotation.y = (this.doorOpenness.get(building.id) ?? 0) * DOOR_OPEN_ANGLE;
    this.doorPivots.set(building.id, { pivot, cx: root.position.x, cz: root.position.z });
  }

  /**
   * Swing placed doors open as the player nears their opening and shut as they
   * leave, easing openness by real time. Reduced motion snaps to the target.
   */
  private updateDoorSwings(playerX: number, playerZ: number, deltaSeconds: number, reducedMotion: boolean): void {
    const step = deltaSeconds / DOOR_SWING_SECONDS;
    const update = (
      pivots: ReadonlyMap<string, { pivot: THREE.Object3D; cx: number; cz: number }>,
      openness: Map<string, number>,
    ): void => {
      for (const [id, opening] of pivots) {
        const target = Math.hypot(playerX - opening.cx, playerZ - opening.cz) <= DOOR_OPEN_RADIUS ? 1 : 0;
        const current = openness.get(id) ?? 0;
        const next = reducedMotion
          ? target
          : target > current ? Math.min(target, current + step) : Math.max(target, current - step);
        openness.set(id, next);
        opening.pivot.rotation.y = next * DOOR_OPEN_ANGLE;
      }
    };
    update(this.doorPivots, this.doorOpenness);
    update(this.townGatePivots, this.townGateOpenness);
  }

  private buildPlayer(): void {
    this.playerRig = createPlayerRig();
    this.actorRoot.add(this.playerRig.root);
    const hull = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 14, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b5d38, roughness: 0.88 }),
    );
    hull.scale.set(0.72, 0.22, 1.45);
    hull.position.y = 0.02;
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.boatHull.add(hull);
    for (const [kind, key] of [
      ['axe', 'survival.axe-upgraded'],
      ['pickaxe', 'survival.pickaxe-upgraded'],
    ] as const) {
      void this.addModel(this.playerRig.joints.toolHand, key, { x: 0, y: -0.02, z: 0 }, 0, 0.78).then((model) => {
        if (model.parent !== this.playerRig.joints.toolHand) return;
        model.rotation.z = Math.PI;
        model.rotation.y = kind === 'axe' ? -0.12 : 0.08;
        this.playerRig.replaceGatherTool(kind, model);
      });
    }
  }

  /** Mirrors WorldScene: the fastest active mount-mode follower carries the player. */
  private activeMountSpecies(): SpeciesId | null {
    const mount = this.state.ownedCreatures
      .filter((creature) => creature.role === 'follow' && creatureDefinition(creature.speciesId).followMode === 'mount')
      .sort((left, right) =>
        creatureDefinition(right.speciesId).travelSpeedMultiplier - creatureDefinition(left.speciesId).travelSpeedMultiplier,
      )[0];
    return mount?.speciesId ?? null;
  }

  private syncMount(speciesId: SpeciesId | null): void {
    if (speciesId === this.mountSpecies) return;
    this.mountSpecies = speciesId;
    this.clearGroup(this.mountRoot);
    this.mountRig = null;
    if (!speciesId) return;
    const rig = createCreatureRig(speciesId);
    const saddle=createSaddle(speciesId);rig.root.add(saddle);rig.root.updateMatrixWorld(true);
    rig.joints.body?.attach(saddle);
    this.mountRoot.add(rig.root);
    this.mountRig = rig;
  }

  private createPlayerRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.43, 0.55, 28),
      new THREE.MeshBasicMaterial({ color: 0xf5ecd6, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    return ring;
  }

  private createWorldLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = 'rgba(11, 18, 14, .78)';
      context.beginPath();
      context.roundRect(8, 12, 368, 72, 16);
      context.fill();
      context.strokeStyle = '#c6af79';
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = '#f5ecd6';
      context.font = '400 36px Georgia, serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 192, 49);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4.6, 1.15, 1);
    sprite.renderOrder = 12;
    return sprite;
  }

  /**
   * The "Lv N" plate that rides above a creature or raider.
   *
   * A deliberately smaller sibling of `createWorldLabel`: a building nameplate
   * is read from across the clearing, while this one has to sit over a body
   * without swallowing it. Same colours, so the two read as one system.
   */
  private createLevelPlate(level: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = 'rgba(11, 18, 14, .78)';
      context.beginPath();
      context.roundRect(6, 12, 116, 40, 12);
      context.fill();
      context.strokeStyle = '#6f8a61';
      context.lineWidth = 4;
      context.stroke();
      context.fillStyle = '#f5ecd6';
      context.font = '800 26px Trebuchet MS, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(`Lv ${level}`, 64, 33);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.4, 0.7, 1);
    // Above the health readout's render order, so a plate is never hidden by
    // the bar that appears once a fight has already started.
    sprite.renderOrder = 13;
    return sprite;
  }

  private createFocusRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.75, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    ring.visible = false;
    return ring;
  }

  private updateFocusRing(elapsedSeconds: number, target: InteractionTargetPresentation | null): void {
    if (target) {
      const position = worldToThree(target.x, target.y);
      const material = this.focusRing.material as THREE.MeshBasicMaterial;
      material.color.setHex(target.kind === 'resource' ? 0xffd66b
        : target.kind === 'drop' ? 0x7ce7d5
          : target.kind === 'creature' ? 0xe9a1ff : 0x90d7ff);
      this.focusRing.visible = true;
      this.focusRing.position.set(position.x, 0.04, position.z);
      const pulse = 0.95 + Math.sin(elapsedSeconds * 4) * 0.08;
      const size = target.kind === 'facility' || target.kind === 'garden' || target.kind === 'woodlot' ? 1.2 : 1;
      this.focusRing.scale.setScalar(pulse * size);
      return;
    }
    let nearest: ResourceNodeState | null = null;
    let nearestDistance = 2.3;
    for (const node of this.state.resourceNodes) {
      if (node.hp <= 0) continue;
      const dx = (node.x - this.state.player.x) / TILE_SIZE;
      const dz = (node.y - this.state.player.y) / TILE_SIZE;
      const distance = Math.hypot(dx, dz);
      if (distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    }
    if (!nearest) {
      this.focusRing.visible = false;
      return;
    }
    const position = worldToThree(nearest.x, nearest.y);
    this.focusRing.visible = true;
    this.focusRing.position.set(position.x, 0.04, position.z);
    const pulse = 0.95 + Math.sin(elapsedSeconds * 4) * 0.08;
    this.focusRing.scale.setScalar(pulse);
  }

  private updatePlacementGhost(placement: BuildPlacementPresentation | null): void {
    const signature = placement
      ? `${placement.definitionId}|${placement.tileX}|${placement.tileY}|${placement.tilesWide}|${placement.tilesHigh}|${placement.rotated ? 1 : 0}|${placement.boundaryEdge ?? ''}|${placement.valid ? 1 : 0}|${placement.message}|${placement.blockedCells.map((cell) => `${cell.tileX},${cell.tileY}:${cell.reason}`).join(';')}`
      : '';
    if (signature === this.placementSignature) return;
    this.placementSignature = signature;
    this.clearGroup(this.placementRoot);
    if (placement) this.addGhostSilhouette(this.placementRoot, placement);
  }

  private updateBatchAndShelter(placements: readonly BuildPlacementPresentation[], guide: { tileX: number; tileY: number } | null): void {
    const signature = JSON.stringify(placements);
    if (signature !== this.batchSignature) {
      this.batchSignature = signature;
      this.clearGroup(this.batchRoot);
      for (const placement of placements) this.addGhostSilhouette(this.batchRoot, placement);
    }
    const guideSignature = JSON.stringify(guide);
    if (guideSignature !== this.shelterGuideSignature) {
      this.shelterGuideSignature = guideSignature;
      this.clearGroup(this.shelterGuideRoot);
      if (guide) {
        const points: THREE.Vector3[] = [];
        for (let x = 0; x <= 4; x++) points.push(new THREE.Vector3(guide.tileX + x, .065, guide.tileY), new THREE.Vector3(guide.tileX + x, .065, guide.tileY + 2));
        for (let y = 0; y <= 2; y++) points.push(new THREE.Vector3(guide.tileX, .065, guide.tileY + y), new THREE.Vector3(guide.tileX + 4, .065, guide.tileY + y));
        this.shelterGuideRoot.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xffdb83, transparent: true, opacity: .9, depthTest: false })));
      }
    }
  }

  /** Red silhouette over the building the delete prompt targets — same read as a blocked ghost. */
  private updateSelectionHighlight(selection: BuildPlacementPresentation | null): void {
    const signature = selection
      ? `${selection.definitionId}|${selection.tileX}|${selection.tileY}|${selection.tilesWide}|${selection.tilesHigh}|${selection.rotated ? 1 : 0}|${selection.boundaryEdge ?? ''}`
      : '';
    if (signature === this.selectionSignature) return;
    this.selectionSignature = signature;
    this.clearGroup(this.selectionRoot);
    if (selection) this.addGhostSilhouette(this.selectionRoot, selection);
  }

  private updateJourneyWaypoint(waypoint: { tileX: number; tileY: number; label: string } | null): void {
    const signature = JSON.stringify(waypoint);
    if (signature === this.journeySignature) return;
    this.journeySignature = signature; this.clearGroup(this.journeyRoot);
    if (!waypoint) return;
    const x = waypoint.tileX + .5; const z = waypoint.tileY + .5;
    const material = new THREE.MeshBasicMaterial({ color: 0x8de4ed, transparent: true, opacity: .75, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.45, .06, 6, 24), material); ring.rotation.x = -Math.PI / 2; ring.position.set(x, .12, z);
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(.22), material); beacon.position.set(x, 2.2, z);
    const label = this.createWorldLabel(waypoint.label); label.position.set(x, 2.8, z);
    this.journeyRoot.add(ring, beacon, label);
  }

  private addGhostSilhouette(parent: THREE.Group, placement: BuildPlacementPresentation): void {
    const color = placement.valid ? 0x65e69a : 0xff6f72;
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      roughness: 0.72,
    });
    const footprintMaterial = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false,
    });
    const root = new THREE.Group();
    parent.add(root);

    if (placement.layer === 'boundary') {
      const edge = placement.boundaryEdge ?? 'north';
      const horizontal = edge === 'north' || edge === 'south';
      const length = horizontal ? placement.tilesWide : placement.tilesHigh;
      const x = placement.tileX + (horizontal ? length / 2 : edge === 'east' ? 1 : 0);
      const z = placement.tileY + (horizontal ? edge === 'south' ? 1 : 0 : length / 2);
      root.position.set(x, 0, z);
      const boundary = new THREE.Mesh(
        new THREE.BoxGeometry(horizontal ? length * 0.98 : 0.16, placement.definitionId.includes('fence') || placement.definitionId.includes('gate') ? 0.75 : 1.2, horizontal ? 0.16 : length * 0.98),
        material,
      );
      boundary.position.y = boundary.geometry.parameters.height / 2;
      root.add(boundary);
    } else {
      root.position.set(
        placement.tileX + placement.tilesWide / 2,
        0,
        placement.tileY + placement.tilesHigh / 2,
      );
      const footprint = new THREE.Mesh(
        new THREE.PlaneGeometry(placement.tilesWide * 0.96, placement.tilesHigh * 0.96),
        footprintMaterial,
      );
      footprint.rotation.x = -Math.PI / 2;
      footprint.position.y = 0.015;
      root.add(footprint);
      const gridPoints: THREE.Vector3[] = [];
      const halfWidth = placement.tilesWide / 2;
      const halfHeight = placement.tilesHigh / 2;
      for (let x = 0; x <= placement.tilesWide; x += 1) {
        const localX = x - halfWidth;
        gridPoints.push(new THREE.Vector3(localX, 0.035, -halfHeight), new THREE.Vector3(localX, 0.035, halfHeight));
      }
      for (let z = 0; z <= placement.tilesHigh; z += 1) {
        const localZ = z - halfHeight;
        gridPoints.push(new THREE.Vector3(-halfWidth, 0.035, localZ), new THREE.Vector3(halfWidth, 0.035, localZ));
      }
      const grid = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(gridPoints),
        new THREE.LineBasicMaterial({ color: placement.valid ? 0xc9ffe0 : 0xffd27a, transparent: true, opacity: 0.92 }),
      );
      grid.renderOrder = 9;
      root.add(grid);
      for (const cell of placement.blockedCells) {
        const blocked = new THREE.Mesh(
          new THREE.PlaneGeometry(0.92, 0.92),
          new THREE.MeshBasicMaterial({ color: 0xff4d5f, transparent: true, opacity: 0.48, side: THREE.DoubleSide, depthWrite: false }),
        );
        blocked.rotation.x = -Math.PI / 2;
        blocked.position.set(
          cell.tileX - placement.tileX + 0.5 - halfWidth,
          0.045,
          cell.tileY - placement.tileY + 0.5 - halfHeight,
        );
        blocked.renderOrder = 10;
        root.add(blocked);
      }
      const height = placement.layer === 'surface' ? 0.1
        : placement.definitionId === 'woodlot-planter' ? 0.75
          : placement.definitionId === 'furnace' ? 1.25 : 0.7;
      const silhouette = new THREE.Mesh(
        new THREE.BoxGeometry(placement.tilesWide * 0.86, height, placement.tilesHigh * 0.86),
        material,
      );
      silhouette.position.y = height / 2;
      root.add(silhouette);
    }
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.renderOrder = 8;
      }
    });
    // The green/red silhouette color is sufficient placement feedback; no text label.
  }

  private updateTargetStatus(target: InteractionTargetPresentation | null): void {
    const position=target?worldToThree(target.x,target.y):null;
    const modelHeight=target?.kind==='creature'?Number(this.creatureRigs.get(target.id)?.root.userData.modelHeight??0):0;
    const height=target?.kind==='resource'?2.35:target?.kind==='creature'
      ?Math.max(CREATURE_PLATE_HEIGHT,modelHeight+.22)+.55:1.55;
    const signature = target
      ? `${target.kind}|${target.id}|${target.label}|${target.value ?? ''}|${target.maxValue ?? ''}`
      : '';
    if (signature === this.targetSignature) {
      if(this.targetStatus&&position)this.targetStatus.position.set(position.x,height,position.z);
      return;
    }
    this.targetSignature = signature;
    if (this.targetStatus) {
      this.feedbackRoot.remove(this.targetStatus);
      this.disposeObject(this.targetStatus);
      this.targetStatus = null;
    }
    if (!target) return;
    const damaged = target.value !== undefined && target.maxValue !== undefined && target.value < target.maxValue;
    const text = damaged ? `${target.label}  ${target.value}/${target.maxValue}` : target.label;
    const color = target.kind === 'resource' ? '#ffd66b'
      : target.kind === 'drop' ? '#7ce7d5'
        : target.kind === 'creature' ? '#e9a1ff' : '#90d7ff';
    const sprite = this.createStatusLabel(text, color);
    sprite.position.set(position!.x, height, position!.z);
    this.feedbackRoot.add(sprite);
    this.targetStatus = sprite;
  }

  private createStatusLabel(text: string, accent: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = 'rgba(8, 17, 12, .88)';
      context.beginPath();
      context.roundRect(8, 12, 496, 72, 18);
      context.fill();
      context.strokeStyle = accent;
      context.lineWidth = 5;
      context.stroke();
      context.fillStyle = '#fff8e8';
      context.font = '400 32px Georgia, serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const clipped = text.length > 34 ? `${text.slice(0, 31)}…` : text;
      context.fillText(clipped, 256, 49);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(4.8, 0.9, 1);
    sprite.renderOrder = 15;
    return sprite;
  }

  private spawnImpactEffect(node: ResourceNodeState, depleted: boolean): void {
    const position = worldToThree(node.x, node.y);
    const color = node.kind === 'tree' ? 0xa97843
      : node.kind === 'stone' ? 0xaeb8b5
        : node.kind === 'metal' ? 0xd68a51
          : node.kind === 'berry-bush' ? 0xd85863 : 0xb8ca75;
    const count = depleted ? 10 : 6;
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.09 + (index % 3) * 0.025),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }),
      );
      mesh.position.set(position.x, 0.65 + (index % 2) * 0.16, position.z);
      this.feedbackRoot.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(((index * 37) % 11 - 5) * 0.18, 1.35 + (index % 3) * 0.35, ((index * 53) % 13 - 6) * 0.16),
        age: 0,
        lifetime: 0.55 + (index % 3) * 0.1,
      });
    }
  }

  private spawnPickupEffect(x: number, z: number): void {
    for (let index = 0; index < 5; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.075),
        new THREE.MeshBasicMaterial({ color: 0xffdf7d, transparent: true, opacity: 1 }),
      );
      mesh.position.set(x, 0.2, z);
      this.feedbackRoot.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((index - 2) * 0.18, 1.1 + index * 0.12, ((index * 7) % 5 - 2) * 0.16),
        age: 0,
        lifetime: 0.7,
      });
    }
  }

  /**
   * Arcane strike markers, read straight off the saved strike records.
   *
   * Deliberately the same numbers the 2D overlay draws: the outer ring is the
   * authoritative damage radius, the inner ring is the same countdown
   * proportion, and reward strikes carry the same gold core — so a player who
   * switches renderers mid-storm is never shown a different deadline.
   */
  private syncArcaneStrikes(reducedMotion: boolean): void {
    const strikes = activeStormStrikes(this.state);
    const live = new Set(strikes.map((strike) => strike.id));
    for (const [id, visual] of this.stormVisuals) {
      if (live.has(id)) continue;
      this.stormRoot.remove(visual.root);
      this.disposeObject(visual.root);
      this.stormVisuals.delete(id);
    }

    const radius = stormImpactRadiusPx(this.state.gameBalance.storm) / WORLD_UNIT_PX;
    let impacts = 0;
    for (const strike of strikes) {
      let visual = this.stormVisuals.get(strike.id);
      if (!visual) {
        visual = createArcaneStrikeVisual(radius, strike.rewardIronOre > 0);
        const position = worldToThree(strike.x, strike.y);
        visual.root.position.set(position.x, 0, position.z);
        this.stormVisuals.set(strike.id, visual);
        this.stormRoot.add(visual.root);
      }

      const frame = arcaneStrikeFrame(strike, this.state.tick, reducedMotion);
      if (frame.landing) impacts += 1;
      applyArcaneStrikeFrame(visual, frame);
    }
    this.stormImpactsShown = impacts;
  }

  /**
   * Raid wave, rebuilt only when the roster changes and re-posed every frame.
   * A wave is at most a handful of bodies for one minute, so each raider keeps
   * its own rig rather than sharing an instanced mesh.
   */
  private syncRaiders(time: number, deltaSeconds: number, reducedMotion: boolean): void {
    for (const [id, visual] of this.raiderVisuals) {
      if (this.state.raiders.some((raider) => raider.id === id)) continue;
      this.raiderRoot.remove(visual.rig.root);
      this.disposeObject(visual.rig.root);
      this.raiderVisuals.delete(id);
    }

    for (const raider of this.state.raiders) {
      const position = worldToThree(raider.x, raider.y);
      let visual = this.raiderVisuals.get(raider.id);
      if (!visual) {
        const rig = createRaiderRig(raider.kindId);
        rig.root.name = raider.id;
        rig.root.position.set(position.x, 0, position.z);
        // A raider walks in from the world edge, so it starts facing the base.
        const spawnHeading = Math.atan2(
          this.state.player.x - raider.x,
          this.state.player.y - raider.y,
        );
        rig.root.rotation.y = spawnHeading;
        const plate = this.createLevelPlate(raider.level);
        plate.position.set(0, RAIDER_CHEST_HEIGHT[raider.kindId] + 1.1, 0);
        rig.root.add(plate);
        visual = { rig, x: position.x, z: position.z, heading: spawnHeading, moving: false };
        this.raiderVisuals.set(raider.id, visual);
        this.raiderRoot.add(rig.root);
      }

      const chase = 1 - Math.pow(RAIDER_FOLLOW_RATE, deltaSeconds);
      const dx = position.x - visual.x;
      const dz = position.z - visual.z;
      visual.moving = Math.hypot(dx, dz) > 0.012;
      visual.x += dx * chase;
      visual.z += dz * chase;
      if (visual.moving) {
        const desired = Math.atan2(dx, dz);
        // Shortest-arc turn, so crossing the ±π seam never spins the rig.
        const delta = ((desired - visual.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        visual.heading += delta * (1 - Math.pow(RAIDER_TURN_RATE, deltaSeconds));
      }
      visual.rig.root.position.set(visual.x, 0, visual.z);
      visual.rig.root.rotation.y = visual.heading;
      // Attacking is the sim's own read: a raider stops walking the moment it
      // has a structure in reach, and that is exactly when it swings.
      visual.rig.animate(
        time,
        raider.targetBuildingId ? 'attack' : visual.moving ? 'walk' : 'idle',
        reducedMotion,
      );
    }
  }

  /**
   * Creatures set to Work walk a loop around the facility they staff, so a pen
   * with a Tuftle on duty reads as staffed from across the clearing. The path
   * is presentation only — `workerCreaturePose` derives it from the creature id
   * and the clock, and the 2D scene walks the same loop.
   */
  private syncFollowerCreatures(time: number, reducedMotion: boolean, assistance?: GatherAssistancePresentation | null): void {
    const placements = followerCreaturePlacements(this.state);
    for (const [id, rig] of this.followerRigs) {
      if (placements.some((placement) => placement.id === id)) continue;
      this.workerRoot.remove(rig.root);
      this.disposeObject(rig.root);
      this.followerRigs.delete(id);
    }
    for (const placement of placements) {
      let rig = this.followerRigs.get(placement.id);
      if (!rig) {
        rig = createCreatureRig(placement.speciesId);
        rig.root.name = placement.id;
        this.followerRigs.set(placement.id, rig);
        this.workerRoot.add(rig.root);
      }
      const position = worldToThree(placement.x, placement.y);
      const dx=position.x-rig.root.position.x,dz=position.z-rig.root.position.z;
      rig.root.position.set(position.x, 0, position.z);
      const helping = assistance?.creatureId === placement.id;
      const heading=helping?Math.atan2(placement.x-assistance.x,placement.y-assistance.y)
        :Math.hypot(dx,dz)>.001&&Math.hypot(dx,dz)<3?Math.atan2(-dx,-dz):this.facingAngle()+Math.PI;
      const frame=this.motionTracker.sample(rig.root,time,position.x,position.z,heading,creatureStride(placement.speciesId,this.motionTracker.speed(rig.root)));
      rig.root.rotation.y=reducedMotion?heading:turnTowards(rig.root.rotation.y,heading,frame.deltaSeconds??1/60);
      rig.animate(time,helping?'assist':(frame.speed??0)>2?'run':(frame.speed??0)>.04?'walk':'idle',reducedMotion,
        helping?{...frame,progress:assistance.progress}:frame);
      rig.root.position.y += followerAssistanceLift(placement.id, assistance, reducedMotion);
    }
  }

  private syncWorkerCreatures(time: number, reducedMotion: boolean): void {
    const placements = workerCreaturePlacements(this.state);
    for (const [id, rig] of this.workerRigs) {
      if (placements.some((placement) => placement.id === id)) continue;
      this.workerRoot.remove(rig.root);
      this.disposeObject(rig.root);
      this.workerRigs.delete(id);
    }

    for (const placement of placements) {
      let rig = this.workerRigs.get(placement.id);
      if (!rig) {
        rig = createCreatureRig(placement.speciesId);
        rig.root.name = placement.id;
        rig.root.userData.speciesId = placement.speciesId;
        this.workerRigs.set(placement.id, rig);
        this.workerRoot.add(rig.root);
      }
      const pose = workerCreaturePose(placement, time);
      const position = worldToThree(pose.x, pose.y);
      rig.root.position.set(position.x, 0, position.z);
      // Creature rigs face -z, so the heading is negated to point them forward.
      const heading=pose.moving?Math.atan2(-pose.dirX,-pose.dirY):rig.root.rotation.y;
      const frame=this.motionTracker.sample(rig.root,time,position.x,position.z,heading,creatureStride(placement.speciesId,this.motionTracker.speed(rig.root)));
      rig.root.rotation.y=reducedMotion?heading:turnTowards(rig.root.rotation.y,heading,frame.deltaSeconds??1/60);
      rig.animate(time+placement.phase*370,(frame.speed??0)>2?'run':(frame.speed??0)>.04?'walk':'idle',reducedMotion,frame);
    }
  }

  /**
   * Turn the shots the tracker found into arrows, and fly the ones already up.
   * Nothing here can change a raid's outcome: the damage landed the moment the
   * simulation spent the ammunition, and the arc is the story of that hit.
   */
  private updateArrows(deltaSeconds: number, reducedMotion: boolean): void {
    for (const shot of this.arrowTracker.sample(this.state)) this.launchArrow(shot, reducedMotion);

    for (let index = this.arrows.length - 1; index >= 0; index -= 1) {
      const arrow = this.arrows[index]!;
      arrow.elapsed += deltaSeconds;
      const progress = Math.min(1, arrow.elapsed / arrow.duration);
      const position = arrow.from.clone().lerp(arrow.to, progress);
      // A symmetric parabola: zero lift at both ends, peak at mid-flight.
      position.y += arrow.arc * 4 * progress * (1 - progress);
      // Point the shaft down the tangent by aiming a step ahead of itself.
      const ahead = Math.min(1, progress + 0.04);
      const next = arrow.from.clone().lerp(arrow.to, ahead);
      next.y += arrow.arc * 4 * ahead * (1 - ahead);
      arrow.mesh.position.copy(position);
      if (!next.equals(position)) arrow.mesh.lookAt(next);
      if (progress < 1) continue;

      this.arrowRoot.remove(arrow.mesh);
      this.disposeObject(arrow.mesh);
      this.arrows.splice(index, 1);
      this.spawnArrowImpact(arrow.to, arrow.killed);
    }
  }

  private launchArrow(shot: ArrowShot, reducedMotion: boolean): void {
    const from = worldToThree(shot.fromX, shot.fromY);
    const to = worldToThree(shot.toX, shot.toY);
    const target = this.state.raiders.find((raider) => raider.id === shot.targetId);
    const chest = target ? RAIDER_CHEST_HEIGHT[target.kindId] : 0.8;
    const start = new THREE.Vector3(from.x, shot.source === 'turret' ? TURRET_MUZZLE_Y : PLAYER_DRAW_Y, from.z);
    const end = new THREE.Vector3(to.x, chest, to.z);
    const distance = start.distanceTo(end);
    const mesh = createArrowMesh();
    mesh.position.copy(start);
    this.arrowRoot.add(mesh);
    this.arrows.push({
      mesh,
      from: start,
      to: end,
      // Reduced motion keeps the arrow, but on a flat, short hop rather than a
      // lobbed arc across the screen.
      arc: reducedMotion ? 0 : arrowArcHeight(distance),
      duration: reducedMotion ? 0.12 : arrowFlightSeconds(distance),
      killed: shot.killed,
      elapsed: 0,
    });
  }

  /** A short spark where the arrow lands; brighter and wider when it kills. */
  private spawnArrowImpact(at: THREE.Vector3, killed: boolean): void {
    this.combatEffects.emit({kind:'impact',at:performance.now(),duration:360,from:at,to:at,color:COMBAT_PALETTE.gold,critical:killed});
  }

  private updateCombatEffects(presentation:ThreePresentationState|null,time:number,reduced:boolean):void {
    const action=presentation?.playerAction;
    if(action&&action.id!==this.lastCombatActionId){
      this.lastCombatActionId=action.id;
      if(!action.arrowTracked){
        const from={x:this.playerRoot.position.x,y:1.05+this.actorRoot.position.y,z:this.playerRoot.position.z};
        const to={x:action.x/TILE_SIZE,y:1,z:action.y/TILE_SIZE};
        const start=time-action.progress*600;
        const color=action.kind==='magic'?COMBAT_PALETTE.arcane:COMBAT_PALETTE.ivory;
        if(action.kind==='magic')this.combatEffects.emit({kind:'charge',at:start,duration:170,from,to:from,color});
        this.combatEffects.emit({kind:action.kind==='magic'?'bolt':action.kind==='ranged'?'arrow':'slash',at:start+100,duration:180,from,to,color});
        this.combatEffects.emit({kind:'impact',at:start+280,duration:340,from:to,to,color});
      }
    }
    this.combatEffects.update(time,reduced);
  }

  private updateParticles(deltaSeconds: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]!;
      particle.age += deltaSeconds;
      if (particle.age >= particle.lifetime) {
        this.feedbackRoot.remove(particle.mesh);
        this.disposeObject(particle.mesh);
        this.particles.splice(index, 1);
        continue;
      }
      particle.velocity.y -= (particle.gravity ?? 3.4) * deltaSeconds;
      particle.mesh.position.addScaledVector(particle.velocity, deltaSeconds);
      particle.mesh.rotation.x += deltaSeconds * (particle.spinX ?? 7);
      particle.mesh.rotation.z += deltaSeconds * (particle.spinZ ?? 5);
      const fade = 1 - particle.age / particle.lifetime;
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = fade;
      if (particle.scaleFrom !== undefined && particle.scaleTo !== undefined && particle.baseScale) {
        const progress = particle.age / particle.lifetime;
        const scale = THREE.MathUtils.lerp(particle.scaleFrom, particle.scaleTo, progress);
        particle.mesh.scale.copy(particle.baseScale).multiplyScalar(scale);
      } else {
        particle.mesh.scale.setScalar(0.65 + fade * 0.5);
      }
    }
  }

  private updateAmbientMotion(
    time: number,
    reducedMotion: boolean,
    target: InteractionTargetPresentation | null,
    deltaSeconds: number,
  ): void {
    if (!reducedMotion) {
      for (const child of this.entityRoot.children) {
        const kind = child.userData.resourceKind as ResourceNodeState['kind'] | undefined;
        if (kind === 'tree' || kind === 'plant' || kind === 'berry-bush') {
          child.rotation.z = Math.sin(time * 0.00075 + child.position.x * 0.7 + child.position.z * 0.4) * (kind === 'tree' ? 0.012 : 0.025);
        }
      }
    }
    for (const wild of this.state.wildCreatures) {
      const id=wild.id,rig=this.creatureRigs.get(id);if(!rig)continue;
      const targeted = target?.kind === 'creature' && target.id === id;
      const phase = Number(rig.root.userData.idlePhase ?? 0);
      const x=wild.x/TILE_SIZE,z=wild.y/TILE_SIZE,dx=x-rig.root.position.x,dz=z-rig.root.position.z;
      const approach=Math.hypot(dx,dz)>3?1:1-Math.exp(-deltaSeconds*20);
      rig.root.position.x+=dx*approach;rig.root.position.z+=dz*approach;
      let heading=rig.root.rotation.y;
      if (targeted) {
        const dx = this.state.player.x / TILE_SIZE - rig.root.position.x;
        const dz = this.state.player.y / TILE_SIZE - rig.root.position.z;
        heading=Math.atan2(-dx,-dz);
      } else if(Math.hypot(dx,dz)>.005&&Math.hypot(dx,dz)<3)heading=Math.atan2(-dx,-dz);
      const frame=this.motionTracker.sample(rig.root,time,rig.root.position.x,rig.root.position.z,heading,creatureStride(wild.speciesId,this.motionTracker.speed(rig.root)));
      rig.root.rotation.y=reducedMotion?heading:turnTowards(rig.root.rotation.y,heading,deltaSeconds);
      const previousHp=rig.root.userData.animationHp as number|undefined;
      if(previousHp!==undefined&&wild.hp<previousHp)rig.root.userData.hurtAt=time;
      const previousAttack=rig.root.userData.animationAttackTick as number|undefined;
      if(previousAttack!==undefined&&wild.nextAttackTick>previousAttack&&wild.aggroUntilTick>this.state.tick)rig.root.userData.attackAt=time;
      rig.root.userData.animationHp=wild.hp;rig.root.userData.animationAttackTick=wild.nextAttackTick;
      const hurtProgress=(time-Number(rig.root.userData.hurtAt??Number.NEGATIVE_INFINITY))/380;
      const attackProgress=(time-Number(rig.root.userData.attackAt??Number.NEGATIVE_INFINITY))/550;
      rig.animate(time+phase*370,hurtProgress<1?'hit':attackProgress<1?'attack':(frame.speed??0)>2?'run':(frame.speed??0)>.04?'walk':targeted?'alert':'idle',
        reducedMotion,hurtProgress<1?{...frame,progress:hurtProgress}:attackProgress<1?{...frame,progress:attackProgress}:frame);
      if (!reducedMotion) this.maybeSpawnCreatureTrace(id, rig, time);
    }
    if (reducedMotion || time - this.lastFurnaceEffectAt < 480) return;
    const furnace = this.state.buildings.find((building) => building.definitionId === 'furnace' && (building.furnace?.queue.length ?? 0) > 0);
    if (!furnace) return;
    this.lastFurnaceEffectAt = time;
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.11, 0),
      new THREE.MeshBasicMaterial({ color: 0xb9aea0, transparent: true, opacity: 0.65 }),
    );
    mesh.position.set(furnace.tileX + 0.55, 1.35, furnace.tileY + 0.5);
    this.feedbackRoot.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3(0.08, 1.65, -0.04),
      age: 0,
      lifetime: 0.72,
    });
  }

  private readonly renderFrame = (time: number): void => {
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    if (!this.enabled || document.hidden) return;
    const presentation = this.presentationProvider?.() ?? null;
    // Keep the last world image as the journal's backdrop. Simulation continues,
    // while menu input and scrolling do not compete with world rendering.
    if(presentation?.journalOpen)return;
    const deltaSeconds = Math.min(0.05, Math.max(0, (time - this.lastFrameAt) / 1000));
    this.lastFrameAt = time;
    if (this.state.currentArea.key !== this.areaKey) this.rebuildWorld();
    if (time - this.lastSyncAt > 240) {
      this.lastSyncAt = time;
      this.syncEntities();
    }

    const player = worldToThree(this.state.player.x, this.state.player.y);
    const reducedMotion = presentation?.prefersReducedMotion ?? false;
    if (presentation?.interior) {
      this.renderInteriorFrame(presentation.interior, time, deltaSeconds, reducedMotion);
      return;
    }
    this.interiorStage.hide();
    this.previousInteriorPose = null;
    const battleSnapshot = captureBattleSnapshot(this.state);
    const battleActive = this.battleStage.update(battleSnapshot, time, reducedMotion);
    if (battleActive && !this.battleCameraActive) this.battleAnchor.set(player.x, 0, player.z);
    if (battleActive !== this.battleCameraActive) {
      this.battleCameraActive = battleActive;
    }
    this.battleStage.root.position.copy(this.battleAnchor);
    this.worldRoot.visible = !battleActive;
    this.contactShadows.mesh.visible = !battleActive;
    this.entityRoot.visible = !battleActive;
    this.raiderRoot.visible = !battleActive;
    this.workerRoot.visible = !battleActive;
    this.stormRoot.visible = !battleActive;
    this.arrowRoot.visible = !battleActive;
    this.combatEffects.root.visible=!battleActive;
    this.feedbackRoot.visible = !battleActive;
    this.protectionRoot.visible = !battleActive;
    this.playerRoot.visible = !battleActive;
    const activeTarget = battleActive || presentation?.placement ? null : presentation?.target ?? null;
    this.playerRoot.position.set(player.x, PLAYER_Y, player.z);
    const action=presentation?.playerAction;
    const facingTarget=action??(presentation?.gathering?presentation.target:null);
    const desiredFacing=facingTarget?Math.atan2(facingTarget.x/TILE_SIZE-player.x,facingTarget.y/TILE_SIZE-player.z):this.facingAngle();
    const playerFrame=this.motionTracker.sample(this.playerRig.root,time,player.x,player.z,desiredFacing,
      playerStride(this.motionTracker.speed(this.playerRig.root)));
    this.playerRoot.rotation.y=reducedMotion?desiredFacing:turnTowards(this.playerRoot.rotation.y,desiredFacing,deltaSeconds);
    const boating = (this.state.player.traversalMode ?? 'foot') === 'boat';
    this.boatHull.visible = boating;
    this.playerRing.visible = !boating;
    const gathering = presentation?.gathering ?? false;
    const gatheringNode = gathering && activeTarget?.kind === 'resource'
      ? this.state.resourceNodes.find((node) => node.id === activeTarget.id) ?? null
      : null;
    // Tools and combat use upper-body layers, so the rider stays in the saddle.
    this.syncMount(boating ? null : this.activeMountSpecies());
    const riding = this.mountRig !== null;
    const seat = riding && this.mountSpecies ? mountSeatOffset(this.mountSpecies) : null;
    this.actorRoot.position.set(0, boating ? 0.24 : seat ? seat.y - RIDER_HIP_HEIGHT : 0, seat ? -seat.z : 0);
    this.mountRoot.visible = riding;
    const mountFrame=this.mountRig&&this.mountSpecies?this.motionTracker.sample(this.mountRig.root,time,player.x,player.z,desiredFacing,creatureStride(this.mountSpecies,this.motionTracker.speed(this.mountRig.root))):null;
    this.mountRig?.animate(time,(mountFrame?.speed??0)>2?'run':(mountFrame?.speed??0)>.06?'walk':'idle',reducedMotion,mountFrame??undefined);
    if(riding&&seat&&this.mountRig)this.actorRoot.position.y=seat.y-RIDER_HIP_HEIGHT+this.mountRig.root.position.y+(this.mountRig.joints.body?.position.y??.5)-.5;
    const riderFrame=riding?{...(mountFrame??playerFrame),mounted:true}:playerFrame;
    const equipped = this.state.tools.find((tool) => tool.instanceId === this.state.equippedToolId);
    const holdingStaff = equipped !== undefined
      && equipped.durability > 0
      && gameToolDefinition(this.state, equipped.definitionId).kind === 'staff';
    if(gatheringNode)this.lastGatherKind=gatheringNode.kind;
    if(!gathering)this.lastGatherKind=null;
    this.playerRig.setGatherTool(action?.kind==='ranged'?'bow':action?.kind==='magic'?holdingStaff?'staff':'hands'
      :holdingStaff?'staff':gatherToolForNode(action?.kind==='melee'?'tree':this.lastGatherKind));
    if(Number.isFinite(this.previousPlayerHp)&&this.state.player.hp<this.previousPlayerHp&&!battleActive){
      this.playerHurtAt=time;
      const at={x:player.x,y:.85,z:player.z};
      this.combatEffects.emit({kind:'impact',at:time+70,duration:320,from:at,to:at,color:COMBAT_PALETTE.enemy});
    }
    this.previousPlayerHp=this.state.player.hp;
    const hurt=time-this.playerHurtAt<380;
    this.playerRig.animate(
      time,
      hurt?'hit':action? action.kind==='magic'?'cast':action.kind :gathering ? 'gather' : riding ? 'ride' : (playerFrame.speed??0)>.06
        ? (playerFrame.speed??0)>3.2?'run':'walk' : 'idle',
      reducedMotion,
      hurt?{...riderFrame,progress:(time-this.playerHurtAt)/380}:action?{...riderFrame,progress:action.progress}
        :gathering?{...riderFrame,progress:presentation?.gatherProgress??0}:riderFrame,
    );

    // In battle the camera tracks the fighter inside the arena, so backing off
    // the enemy keeps the player framed instead of sliding to the screen edge.
    const reveal = cameraRevealCue((time - this.areaRevealStartedAt) / 1000, reducedMotion);
    const desiredTarget = battleActive
      ? this.battleAnchor.clone().add(this.battleStage.focus)
      : new THREE.Vector3(player.x, 0, player.z);
    if (!battleActive && this.landmarkBeacon && reveal.targetLead > 0) {
      const landmarkPosition = this.landmarkBeacon.root.getWorldPosition(new THREE.Vector3());
      const towardLandmark = landmarkPosition.sub(desiredTarget).setY(0);
      if (towardLandmark.lengthSq() > 0.001) desiredTarget.add(towardLandmark.normalize().multiplyScalar(reveal.targetLead));
    }
    this.cameraTarget.lerp(desiredTarget, 1 - Math.pow(0.001, deltaSeconds));
    const placementActive = !battleActive && presentation?.placement != null;
    const overworldOffset = elarisCameraOffset(placementActive
      ? { yawDegrees: this.cameraOrientation.yawDegrees, pitchDegrees: Math.max(72, this.cameraOrientation.pitchDegrees) }
      : this.cameraOrientation);
    const desiredCamera = this.cameraTarget.clone().add(battleActive
      ? new THREE.Vector3(7.5, 8.5, 11)
      : new THREE.Vector3(overworldOffset.x, overworldOffset.y + reveal.lift, overworldOffset.z));
    this.camera.position.lerp(desiredCamera, 1 - Math.pow(0.002, deltaSeconds));
    const desiredZoom = battleActive ? 1.85 : placementActive ? Math.min(0.88, reveal.zoom) : reveal.zoom;
    if (Math.abs(this.camera.zoom - desiredZoom) > 0.0005) {
      this.camera.zoom = THREE.MathUtils.lerp(this.camera.zoom, desiredZoom, 1 - Math.pow(0.0005, deltaSeconds));
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.cameraTarget);
    this.placementRangeRing.visible = placementActive;
    if (placementActive) this.placementRangeRing.position.set(player.x, 0.035, player.z);
    const batch = battleActive ? [] : presentation?.batchPlacements ?? [];
    this.updatePlacementGhost(battleActive || batch.length ? null : presentation?.placement ?? null);
    this.updateBatchAndShelter(batch, battleActive ? null : presentation?.shelterGuide ?? null);
    this.updateJourneyWaypoint(battleActive ? null : presentation?.journeyWaypoint ?? null);
    this.updateSelectionHighlight(battleActive ? null : presentation?.selection ?? null);
    this.updateTargetStatus(activeTarget);
    if (battleActive) this.focusRing.visible = false;
    else this.updateFocusRing(time / 1000, activeTarget);
    if (!battleActive) this.updateAmbientMotion(time, reducedMotion, activeTarget,deltaSeconds);
    if (!battleActive) this.updateDoorSwings(player.x, player.z, deltaSeconds, reducedMotion);
    if (!battleActive) {
      // The raid runs alongside the world, not inside the battle stage: a
      // danger minute is real-time and never becomes a turn-based encounter.
      this.syncRaiders(time, deltaSeconds, reducedMotion);
      this.syncWorkerCreatures(time, reducedMotion);
      this.syncFollowerCreatures(time,reducedMotion,presentation?.gatherAssistance);
      this.syncArcaneStrikes(reducedMotion);
      this.updateArrows(deltaSeconds, reducedMotion);
      this.updateCombatEffects(presentation,time,reducedMotion);
      this.updateAmbientMotes(time, reducedMotion);
      this.entrance?.update(time, reducedMotion);
      this.vegetation?.update(player.x, player.z);
      this.contactShadows.update(this.state, this.workerRoot.children);
      updateStyledWater(time, reducedMotion);
      this.updateOccluders(player, deltaSeconds);
      this.updateAtmosphere(time, reducedMotion);
    }
    this.updateDangerOverlay(time, deltaSeconds, reducedMotion, battleActive);
    if (!battleActive) this.updatePurifierProtection(time);
    this.updateParticles(deltaSeconds);
    this.finish.render();
  };

  private renderInteriorFrame(
    frame: InteriorStageFrame,
    time: number,
    deltaSeconds: number,
    reducedMotion: boolean,
  ): void {
    this.battleCameraActive = false;
    this.battleStage.root.visible = false;
    this.contactShadows.mesh.visible = false;
    this.worldRoot.visible = false;
    this.entityRoot.visible = false;
    this.raiderRoot.visible = false;
    this.workerRoot.visible = false;
    this.stormRoot.visible = false;
    this.arrowRoot.visible = false;
    this.combatEffects.root.visible=false;
    this.feedbackRoot.visible = false;
    this.protectionRoot.visible = false;
    this.playerRoot.visible = true;
    this.focusRing.visible = false;
    this.updateTargetStatus(null);
    this.updatePlacementGhost(null);
    this.updateSelectionHighlight(null);
    const portrait = this.container.clientWidth / Math.max(1, this.container.clientHeight) < 0.7;
    this.interiorStage.show(frame, time, reducedMotion, portrait);

    const enteringInterior = this.previousInteriorPose === null;
    this.previousInteriorPose = { x: frame.pose.x, y: frame.pose.y };
    this.playerRoot.position.set(frame.pose.x, PLAYER_Y, frame.pose.y);
    const facing=this.facingAngleFor(frame.pose.facing);
    const animationFrame=this.motionTracker.sample(this.playerRig.root,time,frame.pose.x,frame.pose.y,facing);
    this.playerRoot.rotation.y=reducedMotion||enteringInterior?facing:turnTowards(this.playerRoot.rotation.y,facing,deltaSeconds);
    this.boatHull.visible = false;
    this.playerRing.visible = true;
    this.syncMount(null);
    this.mountRoot.visible = false;
    this.actorRoot.position.set(0, 0, 0);
    this.playerRig.setGatherTool('hands');
    this.playerRig.animate(time,(animationFrame.speed??0)>.06?'walk':'idle',reducedMotion,animationFrame);

    const cameraConfig = frame.definition.camera;
    const target = new THREE.Vector3(cameraConfig.target.tileX + 0.5, 0, cameraConfig.target.tileY + 0.5);
    if (portrait) target.x += 1;
    // Rooms only pick what to frame; the angle is the same published overworld
    // orientation, so stepping through a door never swings the view.
    const interiorOffset = elarisCameraOffset(this.cameraOrientation);
    const desiredCamera = new THREE.Vector3(
      target.x + interiorOffset.x,
      interiorOffset.y,
      target.z + interiorOffset.z,
    );
    const easing = reducedMotion || enteringInterior ? 1 : 1 - Math.pow(0.001, deltaSeconds);
    this.cameraTarget.lerp(target, easing);
    this.camera.position.lerp(desiredCamera, easing);
    this.camera.zoom = THREE.MathUtils.lerp(this.camera.zoom, portrait ? 1.72 : 2, easing);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraTarget);

    const ambience = frame.definition.ambience;
    this.scene.background = new THREE.Color(ambience.ambientColor).multiplyScalar(0.34);
    this.renderer.toneMappingExposure = frame.definition.buildingId === 'arena' ? 1.42 : 1.24;
    this.hemisphere.color.setHex(ambience.keyLightColor);
    this.hemisphere.groundColor.setHex(ambience.ambientColor);
    this.hemisphere.intensity = Math.max(1.15, ambience.ambientIntensity * 2.1);
    this.sun.color.setHex(ambience.keyLightColor);
    this.sun.intensity = ambience.keyLightIntensity;
    this.sun.position.set(target.x - 6, 11, target.z + 2);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    this.fill.color.setHex(0xff8150);
    this.fill.intensity = 0.88;
    this.playerLight.intensity = 0.72;
    this.updateDangerOverlay(time, deltaSeconds, reducedMotion, true);
    this.finish.render();
  }

  private facingAngle(): number {
    return this.facingAngleFor(this.state.player.facing);
  }

  private facingAngleFor(facing: GameState['player']['facing']): number {
    switch (facing) {
      case 'up': return Math.PI;
      case 'down': return 0;
      case 'left': return -Math.PI / 2;
      case 'right': return Math.PI / 2;
    }
  }

  private addModel(
    parent: THREE.Group,
    key: ModelAssetKey,
    position: { x: number; y: number; z: number },
    rotationY = 0,
    targetHeight?: number,
    tint?: number,
    scale?: { x: number; y: number; z: number },
  ): Promise<THREE.Group> {
    const revision = this.worldRevision;
    const options = targetHeight === undefined && tint === undefined
      ? {}
      : { ...(targetHeight === undefined ? {} : { targetHeight }), ...(tint === undefined ? {} : { tint }) };
    return this.models.instantiate(key, options).then((model) => {
      let ancestor: THREE.Object3D = parent;
      while (ancestor.parent) ancestor = ancestor.parent;
      if (revision !== this.worldRevision || ancestor !== this.scene) {
        this.disposeObject(model);
        return model;
      }
      model.position.set(position.x, position.y, position.z);
      model.rotation.y = rotationY;
      if (scale) model.scale.set(scale.x, scale.y, scale.z);
      parent.add(model);
      model.userData.modelAssetInstance = true;
      this.modelCount += 1;
      return model;
    }).catch((error: unknown) => {
      console.warn(`[3d] Unable to load ${key}; keeping procedural fallback.`, error);
      return new THREE.Group();
    });
  }

  private addOccludingModel(
    parent: THREE.Group,
    key: ModelAssetKey,
    position: { x: number; y: number; z: number },
    rotationY: number,
    targetHeight: number | undefined,
    radius: number,
    scope: SceneOccluder['scope'],
    scale?: { x: number; y: number; z: number },
  ): void {
    void this.addModel(parent, key, position, rotationY, targetHeight, undefined, scale).then((model) => {
      if (model.parent !== parent) return;
      const materials: THREE.Material[] = [];
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          if (!materials.includes(material)) materials.push(material);
        }
      });
      this.registerOccluder(model, radius, materials, 0.2, scope);
    });
  }

  private registerOccluder(
    object: THREE.Object3D,
    radius: number,
    materials: readonly THREE.Material[],
    minimumOpacity: number,
    scope: SceneOccluder['scope'],
  ): void {
    if (materials.length === 0) return;
    for (const material of materials) material.transparent = true;
    this.occluders.push({
      object,
      radius,
      minimumOpacity,
      materials,
      baseOpacity: materials.map((material) => material.opacity),
      opacity: 1,
      scope,
    });
  }

  private updateOccluders(player: { x: number; z: number }, deltaSeconds: number): void {
    const camera = { x: this.camera.position.x, z: this.camera.position.z };
    const easing = 1 - Math.pow(0.001, deltaSeconds);
    const worldPosition = new THREE.Vector3();
    for (const occluder of this.occluders) {
      occluder.object.getWorldPosition(worldPosition);
      const blocked = isGroundOccluder(worldPosition, occluder.radius, camera, player);
      const desired = blocked ? occluder.minimumOpacity : 1;
      occluder.opacity += (desired - occluder.opacity) * easing;
      for (let index = 0; index < occluder.materials.length; index += 1) {
        const material = occluder.materials[index]!;
        material.opacity = occluder.baseOpacity[index]! * occluder.opacity;
        material.depthWrite = occluder.opacity > 0.86;
      }
    }
  }

  private updateAmbientMotes(time: number, reducedMotion: boolean): void {
    if (!this.ambientMotes) return;
    const attribute = this.ambientMotes.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const motion = reducedMotion ? 0 : 1;
    for (let index = 0; index < this.ambientMotes.bases.length; index += 1) {
      const base = this.ambientMotes.bases[index]!;
      const phase = this.ambientMotes.phases[index]!;
      attribute.setXYZ(
        index,
        base.x + Math.sin(time * 0.00042 + phase) * 0.55 * motion,
        base.y + Math.sin(time * 0.0011 + phase * 1.7) * 0.32 * motion,
        base.z + Math.cos(time * 0.00037 + phase) * 0.45 * motion,
      );
    }
    attribute.needsUpdate = true;
    this.ambientMotes.points.material.opacity = reducedMotion ? 0.42 : 0.62 + Math.sin(time * 0.0007) * 0.1;
  }

  private updateAtmosphere(time: number, reducedMotion: boolean): void {
    const timer = survivalSchedule(this.state);
    const cue = atmosphereCue(timer, this.state.gameBalance.raid.safePhaseSeconds, this.dangerFogStrength);
    const pulse = reducedMotion ? 0 : Math.sin(time * 0.00018) * 0.055;
    const palette = this.areaPalette();
    const tintWeight = 0.16 + cue.twilight * 0.42 + cue.night * 0.5;
    const sky = new THREE.Color(palette.sky).lerp(new THREE.Color(cue.skyTint), tintWeight);
    this.scene.background = sky;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(sky);
      this.scene.fog.near = cue.fogNear;
      this.scene.fog.far = cue.fogFar;
    }
    this.renderer.toneMappingExposure = cue.exposure;
    this.sun.color.setHex(cue.sunColor);
    this.fill.color.setHex(cue.fillColor);
    this.sun.intensity = cue.sunIntensity + pulse;
    this.hemisphere.intensity = cue.hemisphereIntensity;
    this.hemisphere.color.copy(sky).lerp(new THREE.Color(0xe8f4dc), 0.28);
    this.hemisphere.groundColor.set(palette.ground).multiplyScalar(0.48 + cue.night * 0.16);
    this.fill.intensity = cue.fillIntensity - pulse * 0.35;
    this.playerLight.intensity = 0.28 + cue.twilight * 0.48 + cue.night * 1.08;
    this.sun.target.position.copy(this.cameraTarget);
    this.sun.position.set(
      this.cameraTarget.x - 24,
      34,
      this.cameraTarget.z - 18,
    );
    this.sun.target.updateMatrixWorld();
    this.updateLandmarkBeacon(time, reducedMotion, cue.night + cue.twilight * 0.3);
    this.animatePurifierProtection(time, reducedMotion);
  }

  private updateLandmarkBeacon(time: number, reducedMotion: boolean, darkness: number): void {
    const beacon = this.landmarkBeacon;
    if (!beacon) return;
    const pulse = reducedMotion ? 0 : Math.sin(time * 0.0014) * 0.16;
    beacon.beamMaterial.opacity = beacon.baseOpacity + darkness * 0.15 + pulse * 0.035;
    const haloMaterial = beacon.halo.material as THREE.MeshBasicMaterial;
    haloMaterial.opacity = 0.42 + darkness * 0.34 + pulse * 0.18;
    const scale = 1 + pulse * 0.16;
    beacon.halo.scale.setScalar(scale);
    if (!reducedMotion) beacon.root.rotation.y = time * 0.00008;
  }

  /**
   * Draw the hazard as a projected world mask. Unlike scene-wide lighting or
   * distance fog, this can punch safe rooms out while leaving the unsafe world
   * beyond them visibly affected.
   */
  private updateDangerOverlay(
    time: number,
    deltaSeconds: number,
    reducedMotion: boolean,
    battleActive: boolean,
  ): void {
    const timer = survivalSchedule(this.state);
    const active = timer.phase === 'danger' && !battleActive;
    const fadeSeconds = active ? DANGER_FOG_FADE_IN_SECONDS : DANGER_FOG_FADE_OUT_SECONDS;
    const strength = THREE.MathUtils.clamp(
      battleActive ? 0 : this.dangerFogStrength + (active ? deltaSeconds : -deltaSeconds) / fadeSeconds,
      0,
      1,
    );
    this.dangerFogStrength = strength;
    const context = this.dangerOverlayContext;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    context.clearRect(0, 0, width, height);
    if (battleActive) return;

    if (timer.threat !== this.dangerThreat) {
      this.dangerThreat = timer.threat;
      this.lastDangerMaskAt = Number.NEGATIVE_INFINITY;
    }
    if (time - this.lastDangerMaskAt > DANGER_MASK_REFRESH_MS) {
      this.lastDangerMaskAt = time;
      this.dangerMaskRects = dangerSafeRects(this.state, timer.threat);
    }

    if (strength === 0) return;

    const style = DANGER_PRESENTATION[timer.threat];
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = style.baseAlpha * strength;
    context.fillStyle = colorCss(style.baseColor);
    context.fillRect(0, 0, width, height);

    const seconds = reducedMotion ? 0 : time / 1000;
    for (let index = 0; index < 6; index += 1) {
      const radius = Math.max(width, height) * (0.24 + index * 0.025);
      const x = width * ((index * 0.31 + 0.12) % 1) + Math.sin(seconds * 0.08 + index) * 28;
      const y = height * ((index * 0.43 + 0.18) % 1) + Math.cos(seconds * 0.06 + index) * 22;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, colorCss(style.wispColors[index % style.wispColors.length]!, 0.34));
      gradient.addColorStop(1, colorCss(style.wispColors[index % style.wispColors.length]!, 0));
      context.globalAlpha = strength;
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    context.globalCompositeOperation = 'destination-out';
    context.globalAlpha = 1;
    context.fillStyle = '#fff';
    for (const rect of this.dangerMaskRects) this.punchDangerSafeRect(rect, width, height);
    context.globalCompositeOperation = 'source-over';
  }

  private maybeSpawnCreatureTrace(id: string, rig: CreatureRig, time: number): void {
    // Keep ambient flourishes near the player; distant wildlife still animates.
    const dx = rig.root.position.x - this.playerRoot.position.x;
    const dz = rig.root.position.z - this.playerRoot.position.z;
    if (dx * dx + dz * dz > 24 * 24 || this.particles.length >= 72) return;
    const speciesId = rig.root.userData.speciesId as SpeciesId | undefined;
    if (!speciesId) return;
    const style = creatureTraceStyle(speciesId);
    const lastAt = this.lastCreatureTraceAt.get(id) ?? Number.NEGATIVE_INFINITY;
    if (time - lastAt < style.intervalMs) return;
    this.lastCreatureTraceAt.set(id, time);
    const phase = Number(rig.root.userData.idlePhase ?? 0) + time * 0.001;
    const geometry = style.shape === 'sprout'
      ? new THREE.ConeGeometry(0.055, 0.24, 5)
      : style.shape === 'pebble'
        ? new THREE.OctahedronGeometry(0.1, 0)
        : style.shape === 'petal'
          ? new THREE.SphereGeometry(0.085, 6, 4)
          : new THREE.TetrahedronGeometry(0.1, 0);
    const material = new THREE.MeshBasicMaterial({
      color: style.color,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const trace = new THREE.Mesh(geometry, material);
    trace.name = `creature-trace.${style.shape}`;
    trace.position.set(
      rig.root.position.x + Math.cos(phase) * 0.42,
      style.shape === 'sprout' ? 0.12 : 0.1,
      rig.root.position.z + Math.sin(phase) * 0.42,
    );
    if (style.shape === 'petal' || style.shape === 'leaf') trace.scale.set(1.55, 0.45, 0.72);
    trace.rotation.set(phase * 0.3, phase, phase * 0.17);
    this.feedbackRoot.add(trace);
    this.particles.push({
      mesh: trace,
      velocity: new THREE.Vector3(Math.cos(phase) * 0.05, style.shape === 'pebble' ? 0.12 : 0.035, Math.sin(phase) * 0.05),
      age: 0,
      lifetime: style.shape === 'sprout' ? 1.65 : 1.15,
      gravity: style.shape === 'pebble' ? 0.16 : 0,
      spinX: style.shape === 'petal' ? 1.8 : 0.35,
      spinZ: style.shape === 'leaf' ? 2.4 : 0.5,
      scaleFrom: 0.5,
      scaleTo: style.shape === 'sprout' ? 1.15 : 0.72,
      baseScale: trace.scale.clone(),
    });
  }

  /** Rebuild clean-air domes only when purifier coverage changes. */
  private updatePurifierProtection(time: number): void {
    if (time - this.lastProtectionSyncAt < DANGER_MASK_REFRESH_MS) return;
    this.lastProtectionSyncAt = time;
    const rects = purifierProtectedRects(this.state);
    const signature = rects.map((rect) =>
      `${rect.tileX},${rect.tileY},${rect.tilesWide},${rect.tilesHigh}`).join('|');
    if (signature === this.protectionSignature) return;
    this.protectionSignature = signature;
    this.clearGroup(this.protectionRoot);
    this.protectionMaterials.length = 0;

    rects.forEach((rect, index) => {
      const centerX = rect.tileX + rect.tilesWide / 2;
      const centerZ = rect.tileY + rect.tilesHigh / 2;
      const phase = index * 1.73 + rect.tileX * 0.11 + rect.tileY * 0.07;
      const floorMaterial = new THREE.MeshBasicMaterial({
        color: PROTECTION_HIGHLIGHT_COLOR,
        transparent: true,
        opacity: PROTECTION_HIGHLIGHT_ALPHA,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const highlight = new THREE.Mesh(
        new THREE.PlaneGeometry(rect.tilesWide, rect.tilesHigh),
        floorMaterial,
      );
      highlight.name = `purifier-protection.${rect.tileX}.${rect.tileY}`;
      highlight.rotation.x = -Math.PI / 2;
      highlight.position.set(centerX, 0.075, centerZ);

      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xb9ffd5,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 36), ringMaterial);
      ring.name = 'purifier-protection.edge';
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(centerX, 0.092, centerZ);
      ring.scale.set(rect.tilesWide * 0.57, rect.tilesHigh * 0.57, 1);

      const domeMaterial = new THREE.MeshBasicMaterial({
        color: 0x79efc2,
        transparent: true,
        opacity: 0.025,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        domeMaterial,
      );
      dome.name = 'purifier-protection.dome';
      dome.position.set(centerX, 0.04, centerZ);
      dome.scale.set(rect.tilesWide * 0.62, 1.25 + Math.min(rect.tilesWide, rect.tilesHigh) * 0.25, rect.tilesHigh * 0.62);
      this.protectionRoot.add(highlight, ring, dome);
      this.protectionMaterials.push(
        { material: floorMaterial, baseOpacity: PROTECTION_HIGHLIGHT_ALPHA, dangerOpacity: 0.17, phase },
        { material: ringMaterial, baseOpacity: 0.16, dangerOpacity: 0.58, phase: phase + 1.1 },
        { material: domeMaterial, baseOpacity: 0.025, dangerOpacity: 0.12, phase: phase + 2.2 },
      );
    });
  }

  private animatePurifierProtection(time: number, reducedMotion: boolean): void {
    const timer = survivalSchedule(this.state);
    const danger = timer.phase === 'danger' && timer.threat === 'fog' ? this.dangerFogStrength : 0;
    for (const visual of this.protectionMaterials) {
      const pulse = reducedMotion ? 0 : Math.sin(time * 0.002 + visual.phase) * 0.12;
      visual.material.opacity = THREE.MathUtils.lerp(visual.baseOpacity, visual.dangerOpacity, danger)
        * (1 + pulse);
    }
  }

  private punchDangerSafeRect(rect: DangerSafeRect, width: number, height: number): void {
    const left = rect.tileX - 0.08;
    const right = rect.tileX + rect.tilesWide + 0.08;
    const top = rect.tileY - 0.08;
    const bottom = rect.tileY + rect.tilesHigh + 0.08;
    const points: ScreenPoint[] = [];
    for (const y of [0, 4.2]) {
      for (const [x, z] of [[left, top], [right, top], [right, bottom], [left, bottom]] as const) {
        const projected = new THREE.Vector3(x, y, z).project(this.camera);
        points.push({
          x: (projected.x + 1) * width / 2,
          y: (1 - projected.y) * height / 2,
        });
      }
    }
    const hull = convexHull(points);
    if (hull.length < 3) return;
    const context = this.dangerOverlayContext;
    const sum = hull.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
    const center = { x: sum.x / hull.length, y: sum.y / hull.length };
    const drawHull = (scale: number): void => {
      context.beginPath();
      context.moveTo(
        center.x + (hull[0]!.x - center.x) * scale,
        center.y + (hull[0]!.y - center.y) * scale,
      );
      for (const point of hull.slice(1)) {
        context.lineTo(center.x + (point.x - center.x) * scale, center.y + (point.y - center.y) * scale);
      }
      context.closePath();
      context.fill();
    };
    // Several faint expanded silhouettes form a soft pressure boundary, then
    // the authoritative safe volume is removed completely at its true edge.
    for (const [scale, alpha] of [[1.16, 0.08], [1.11, 0.12], [1.07, 0.2], [1.035, 0.34]] as const) {
      context.globalAlpha = alpha;
      drawHull(scale);
    }
    context.globalAlpha = 1;
    drawHull(1);
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      this.disposeObject(child);
    }
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
        return;
      }
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
        return;
      }
      if(child instanceof THREE.Line){child.geometry.dispose();
        for(const material of Array.isArray(child.material)?child.material:[child.material])material.dispose();return;}
      if (!(child instanceof THREE.Mesh)) return;
      child.customDepthMaterial?.dispose();child.customDistanceMaterial?.dispose();
      if (child instanceof THREE.InstancedMesh) child.dispose();
      if (!child.userData.sharedModelGeometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        const owned=material.userData.ownedTextures as THREE.Texture[]|undefined;
        if(owned)for(const texture of owned)texture.dispose();
        if (!child.userData.sharedModelTextures && 'map' in material && material.map instanceof THREE.Texture) material.map.dispose();
        material.dispose();
      }
    });
  }
}

/**
 * Burn a finished building shell down in place: soot every surface, kill any
 * light it was casting, and drop its height so the roofline reads as collapsed.
 * Working on the assembled group means a ruin needs no second set of models.
 */
function applyRuinAppearance(group: THREE.Object3D): void {
  group.scale.y = 0.62;
  group.traverse((child) => {
    if (child instanceof THREE.Light) {
      child.intensity = 0;
      return;
    }
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    child.material = materials.map((material) => {
      const ruined = material.clone() as THREE.MeshStandardMaterial;
      if (ruined.color) ruined.color.setHex(0x4b4038);
      if (ruined.emissive) ruined.emissive.setHex(0x000000);
      ruined.roughness = 1;
      return ruined;
    });
    if (!Array.isArray(child.material)) return;
    if (child.material.length === 1) child.material = child.material[0]!;
  });
}

function colorCss(color: number, alpha = 1): string {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Convex screen silhouette of a safe floor strip and the air above it. */
function convexHull(points: readonly ScreenPoint[]): ScreenPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower: ScreenPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: ScreenPoint[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
