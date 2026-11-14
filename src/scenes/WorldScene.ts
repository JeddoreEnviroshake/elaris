import Phaser from 'phaser';
import { generateWorldTextures } from '../art/proceduralTextures';
import { creatureTextureKey, raiderTextureKey, townBuildingTextureKey, TextureKeys } from '../art/textureKeys';
import { preloadArtAssets } from '../art/assetManifest';
import { AnimationKeys, playerAnimationKey, registerWorldAnimations, type Facing } from '../art/animations';
import { gameToolDefinition, INTERACTION_RANGE_PX, TAMING_RANGE_PX, toolDefinition } from '../config/balance';
import { DEFAULT_WORLD_SEED, FIXED_STEP_MS, WORLD_PX, WORLD_TILES } from '../config/platform';
import { computeLayout } from '../platform/responsiveLayout';
import type { MoveIntent } from '../simulation/commands';
import {
  createGridMovementState,
  NO_MOVE,
  resetGridMovement,
  stepMovement,
} from '../simulation/commands';
import { FixedStepLoop } from '../simulation/fixedStep';
import {
  buildableById,
  FACILITY_INTERACTION_RANGE_PX,
  attackFacedWall,
  collectNearestGroundDrop,
  depositResourceStackInFieldCache,
  depositToolInFieldCache,
  dropResourceStack,
  selectCompanionAbility,
  setBattleCompanion,
  setCreatureRole,
  craftTool,
  craftRowboat,
  equipBareHands,
  equippedBow,
  equipTool,
  gatherNearest,
  isStructureDamaged,
  nearestFacedWall,
  repairStructure,
  nearestLiveNode,
  nearestUsableFacility,
  nearestWildCreature,
  structureHp,
  structureMaxHp,
  repairTool,
  dropTool,
  splitResourceStack,
  withdrawFromFieldCache,
  withdrawResourceStackFromFieldCache,
  withdrawToolFromFieldCache,
  removeBuilding,
  rowboatActionLabel,
  toggleRowboat,
  type CommandResult,
} from '../simulation/gameplayCommands';
import { craftArrows, craftClothMask, craftReinforcedSnare, craftTamingSnare, resolveEncounterAction, startNearestEncounter, throwSnareAtCreature, type EncounterAction } from '../simulation/encounters';
import { describeGardenBed, harvestGardenBed, nearestGardenBed } from '../simulation/gardenBeds';
import { describeWoodlotPlanter, harvestWoodlotPlanter, nearestWoodlotPlanter } from '../simulation/woodlotPlanters';
import type { BuildingState, GameState, GroundDropState, RaiderState, ResourceNodeState, WildCreatureState } from '../simulation/state';
import type { ResourceId, WorldContainerKind } from '../simulation/state';
import { nearestUnopenedContainer, openNearestContainer } from '../simulation/worldContainers';

/** One ground-drop sprite per Bag item, including handcrafted supplies. */
const DROP_TEXTURE_KEYS: Readonly<Record<ResourceId, string>> = {
  wood: TextureKeys.DropWood,
  stone: TextureKeys.DropStone,
  fiber: TextureKeys.DropFiber,
  'iron-ore': TextureKeys.DropIronOre,
  'iron-ingot': TextureKeys.DropIronIngot,
  'taming-snare': TextureKeys.DropTamingSnare,
  'reinforced-snare': TextureKeys.DropReinforcedSnare,
  berry: TextureKeys.DropBerry,
  arrow: TextureKeys.DropArrow,
  'cloth-mask': TextureKeys.DropClothMask,
  'safeguard-charm': TextureKeys.DropSafeguardCharm,
  'draft-parchment': TextureKeys.DropSafeguardCharm,
  'tuftle-down': TextureKeys.DropTuftleDown,
  'craghopper-shell': TextureKeys.DropCraghopperShell,
  'stag-antler': TextureKeys.DropStagAntler,
  'snarlfox-pelt': TextureKeys.DropSnarlfoxPelt,
  'masonmole-claw': TextureKeys.DropMasonmoleClaw,
  'boar-tusk': TextureKeys.DropBoarTusk,
  'quillfinch-quill': TextureKeys.DropQuillfinchQuill,
  'mistmoth-scale': TextureKeys.DropMistmothScale,
  'slingtail-stone': TextureKeys.DropSlingtailStone,
};

/** One sprite per container kind; opened ones are the same art, faded. */
const CONTAINER_TEXTURE_KEYS: Readonly<Record<WorldContainerKind, string>> = {
  'hollow-log': TextureKeys.ContainerHollowLog,
  'supply-cache': TextureKeys.ContainerSupplyCache,
  'collapsed-cellar': TextureKeys.ContainerCollapsedCellar,
  'storm-cache': TextureKeys.ContainerStormCache,
};
const OPENED_CONTAINER_ALPHA = 0.45;
/** One tool silhouette lies in the world; its tier is carried by the tint. */
const TOOL_DROP_TIER_TINTS: Readonly<Record<'wooden' | 'stone' | 'iron', number>> = {
  wooden: 0xd9a066,
  stone: 0x9aa1a8,
  iron: 0xcfd8e3,
};
import { NO_SHOT_TARGET_MESSAGE, firePlayerShot, loadTurretAmmo, nearestRaiderInRange, playerShotRangePx, strikeRaiderMelee, unloadTurretAmmo, type AbsentBaseRaidReport } from '../simulation/raids';
import {
  NO_SHOT_CREATURE_MESSAGE, fireCreatureShot, nearestCreatureInRange, nearestHuntableCreature, strikeCreatureMelee,
  type CreatureStrikeResult,
} from '../simulation/creatureStrike';
import { strikeReachPx } from '../simulation/strike';
import { createInitialState } from '../simulation/state';
import { claimQuestReward, reconcileQuestProgress } from '../simulation/progression';
import { spendAttributePoint, spendAttributePoints } from '../simulation/characterProgression';
import { buildingCenterPx, effectiveBuildingDimensions } from '../simulation/buildingGeometry';
import { BuildModeController } from './buildMode';
import { DangerAtmosphereOverlay } from './dangerAtmosphere';
import { ArcaneStormOverlay } from './arcaneStormOverlay';
import type { PlaceResult } from './buildPlacement';
import { BuildMenu } from '../ui/buildMenu';
import { GameplayHud } from '../ui/gameplayHud';
import { Hotbar, HOTBAR_SLOTS } from '../ui/hotbar';
import { InventoryPanel } from '../ui/inventoryPanel';
import { BlueprintsPanel } from '../ui/blueprintsPanel';
import {
  draftBlueprintFromParchment, dropCarriedBlueprint, registerCarriedBlueprint, scrapCarriedBlueprint,
} from '../simulation/carriedBlueprints';
import { TouchJoystick } from '../ui/touchControls';
import { WorldNavigator } from '../ui/worldNavigator';
import { RespawnPanel } from '../ui/respawnPanel';
import { travelViaWaystone, type WaystoneTravelResult } from '../simulation/waystones';
import { EncounterPanel } from '../ui/encounterPanel';
import { OpeningPartnershipPanel } from '../ui/openingPartnershipPanel';
import { ShelterGuide } from '../ui/shelterGuide';
import { PaddockGuide } from '../ui/paddockGuide';
import { SupplyRunGuide } from '../ui/supplyRunGuide';
import { GardenGuide } from '../ui/gardenGuide';
import { acknowledgeOpeningJourney, harvestOpeningGarden, moveOpeningGardenPlan, openingGardenAvailable, registerOpeningDiscovery } from '../simulation/openingGarden';
import { beginOpeningGuardPractice, claimOpeningDiscovery, openOpeningSideCache, recoverOpeningSupplies } from '../simulation/openingSupplyRun';
import { claimPaddockSupplies, collectOpeningOutput, followOpeningCompanion, movePaddockPlan, startOpeningWork } from '../simulation/openingPaddock';
import { acknowledgeOpeningFog } from '../simulation/openingFog';
import { claimShelterSupplies, moveShelterPlan } from '../simulation/openingShelter';
import { isOpeningTuftle } from '../content/onboarding';
import { actOpeningTrust, beginOpeningTrust, nameOpeningCompanion, nearbyOpeningTuftle } from '../simulation/onboarding';
import { coordinateHash, mountainElevationBand, starterBiomeAt } from '../simulation/biomes';
import { TILE_SIZE } from '../config/platform';
import { creatureDefinition } from '../content/creatures';
import { regionalIdentityForArea, regionalIdentityForLandmark } from '../content/regions';
import { areaPalette, isElaris } from '../simulation/areas';
import { BuildingItemMenu } from '../ui/buildingItemMenu';
import {
  isRuinedTownBuilding,
  outsideDoorTile,
  townBuildingDoorTiles,
  townBuildingsInArea,
  townBuildingById,
  type TownBuildingId,
  type TownBuildingDefinition,
} from '../content/townBuildings';
import { areaDisplayName, hasElarisFallen } from '../simulation/elarisFall';
import { PERMANENT_AIR_PURIFIER, TOWN_AIR_PURIFIERS, TOWN_PERIMETER_SEGMENTS } from '../content/townDefences';
import {
  ELARIS_PUBLIC_WORKBENCH_SIZE,
  ELARIS_PUBLIC_WORKBENCH_TILE,
  elarisPublicWorkbenchContains,
  elarisPublicWorkbenchFacility,
  isElarisPublicWorkbenchId,
} from '../simulation/elarisWorkbench';
import { BLUEPRINT_QUALITY_COLORS, blueprintQuality } from '../content/blueprintQuality';
import { ELARIS_WATER_TEMPLE } from '../content/elarisWaters';
import {
  nearestTownBuildingDoor,
  positionPlayerInDoorway,
  positionPlayerOutsideDoor,
  recoverPlayerOutsideTownDoor,
} from '../simulation/town';
import { NpcServiceOverlay } from '../ui/npcServiceOverlay';
import { collectFurnaceOutput, enqueueIronSmelt } from '../simulation/processing';
import { orderTrainedCreature } from '../simulation/economy';
import { collectWorkerFacilityBin, releaseCreature } from '../simulation/workerHousing';
import { linkCartDockStorage } from '../simulation/cartDocks';
import { clearLogisticsRoute, setLogisticsRoute } from '../simulation/logistics';
import { AdminPanel, type AdminSystemControls } from '../ui/adminPanel';
import { globalBalanceService, type GlobalBalanceService } from '../platform/globalBalance';
import { DurationWindow, type DurationStats } from '../platform/durationWindow';
import { interpolateRenderPoint, mountedActorDepths, mountTransformForFacing } from './renderMotion';
import { prioritizeTerrainChunks, terrainChunkLayout, type TerrainChunk } from './terrainChunks';
import { CombatOverlay } from './combatOverlay';
import {
  loadoutStrikeStyle,
  resolveCombatTarget,
  type CombatTarget,
  type ResolvedCombatTarget,
  type StrikeStyle,
} from './combatPresentation';
import {
  activeEntityChunkKeys,
  entityChunkKey,
  EntityChunkIndex,
  type EntityActivationCounts,
} from './entityChunks';
import {
  chooseRespawn,
  type PlayerDefeatResult,
  type RespawnCommandResult,
} from '../simulation/survivalCycle';
import type {
  InteractionTargetPresentation,
  ThreePresentationState,
} from '../three/presentationState';
import {
  captureBattleSnapshot,
  resolvedBattleSnapshot,
  type BattleRoundPresentation,
} from '../three/battleState';
import { cameraOrientationFromTenths, screenToCameraWorldIntent } from '../three/cameraControls';
import { terrainAt } from '../simulation/landscape';
import { InteriorSessionController, type GameplayMode } from '../presentation/interiorSession';
import { interiorDefinitionById, interiorDefinitionForBuilding } from '../content/interiors';
import { nearestInteriorHotspot, stepInteriorMovement } from '../presentation/interiorMovement';
import { InteriorFallback } from '../ui/interiorFallback';
import { InteriorTransitionOverlay } from '../ui/interiorTransition';
import { NpcDialogueController, type DialogueChoiceResult } from '../presentation/npcDialogue';
import { NpcBarkController } from '../presentation/npcBarks';
import { workerCreaturePlacements, workerCreaturePose } from '../presentation/workerCreatures';
import { followerCreaturePlacements, followerAssistanceLift } from '../presentation/followerCreatures';
import { NpcDialogue } from '../ui/npcDialogue';
import { NpcBark } from '../ui/npcBark';
import { npcDefinition, type NpcId, type NpcService } from '../content/npcs';
import { InteriorAudioRouter } from '../audio/interiorAudio';

export interface WorldSceneData {
  state?: GameState;
  /** Ordinary mutations debounce; critical mutations save immediately. */
  onStateChanged?: (kind: 'ordinary' | 'critical') => void;
  /** Cancel pending ordinary persistence before a transition paints. */
  onTransitionStarted?: () => void;
  globalBalance?: GlobalBalanceService;
  is3DPresentation?: () => boolean;
  onBattleRound?: (round: BattleRoundPresentation) => void;
  /** System-level controls surfaced inside the Admin menu. */
  system?: AdminSystemControls;
}

export interface WorldPerformanceSnapshot {
  frameTimes: DurationStats;
  areaTransitions: DurationStats;
  terrainChunks: { visible: number; total: number };
  entities: EntityActivationCounts & {
    resources: EntityActivationCounts;
    drops: EntityActivationCounts;
    creatures: EntityActivationCounts;
    structures: EntityActivationCounts;
  };
  interactionQueries: {
    durations: DurationStats;
    candidates: number;
    total: number;
  };
}

interface MovementKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  slow: Phaser.Input.Keyboard.Key;
}

/** Where the player stood before a frame's simulation, per movement surface. */
interface QueuedStepPose {
  x: number;
  y: number;
  interiorX: number;
  interiorY: number;
}

/**
 * How long a d-pad tap keeps asking for its tile. Long enough to outlast the
 * tile already in flight when the tap landed, short enough that a step into a
 * wall stops asking almost immediately.
 */
const QUEUED_STEP_TIMEOUT_MS = 600;

interface NearbyTargets {
  node: ResourceNodeState | null;
  drop: GroundDropState | null;
  creature: WildCreatureState | null;
  facility: BuildingState | null;
  bed: BuildingState | null;
  planter: BuildingState | null;
  door: TownBuildingDefinition | null;
}

/** Facilities with a focused walk-up panel, opened by clicking the structure. */
const FACILITY_PANEL_DEFINITIONS: ReadonlySet<string> = new Set([
  'field-cache', 'workbench', 'furnace', 'war-table', 'turret',
  'farm-counter', 'small-pen', 'barn', 'stone-yard', 'cart-dock',
]);
const HIGHLIGHT_TINT = 0xffe08a;
const OVERLAY_DEPTH = 999_000;
const TOWN_GATE_OPEN_RADIUS = TILE_SIZE * 1.35;
const TOWN_GATE_SWING_MS = 180;
const TOWN_GATE_SWING_FRAMES = [
  TextureKeys.GateWood, TextureKeys.GateWoodSwing1, TextureKeys.GateWoodSwing2,
  TextureKeys.GateWoodSwing3, TextureKeys.GateWoodSwing4,
] as const;
const HUD_REFRESH_INTERVAL_MS = 500;

/** Viewport coordinates for a pointer, used to anchor DOM menus to the click. */
function clientPointOf(pointer: Phaser.Input.Pointer): { x: number; y: number } {
  const event = pointer.event as PointerEvent | undefined;
  return { x: event?.clientX ?? pointer.x, y: event?.clientY ?? pointer.y };
}
const AREA_TRANSITION_SPLASH_MS = 1_000;
/** How long the character keeps pulsing gold after a level up. */
const LEVEL_UP_CELEBRATION_MS = 5_000;
/** Pulses per second of the level-up glow. Fast enough to read as a fanfare. */
const LEVEL_UP_PULSE_HZ = 3;
const LEVEL_UP_GOLD = 0xffd23f;
const LEVEL_UP_SPARKLE_INTERVAL_MS = 130;
type ChunkedSprite = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

export class WorldScene extends Phaser.Scene {
  state!: GameState;
  private readonly interiorSession = new InteriorSessionController();
  private readonly npcDialogueController = new NpcDialogueController();
  private readonly npcBarkController = new NpcBarkController();
  private recentNpcPurchase: { npcId: NpcId; service: NpcService } | null = null;
  private onMoved: () => void = () => {};
  private onCriticalChanged: () => void = () => {};
  private onTransitionStarted: () => void = () => {};
  private globalBalance = globalBalanceService;
  private is3DPresentation: () => boolean = () => false;
  private onBattleRound: (round: BattleRoundPresentation) => void = () => {};
  private systemControls: AdminSystemControls = {};
  private areaSplash: HTMLDivElement | null = null;
  private transitioningArea = false;
  private transitionAreaKey: string | null = null;
  private transitionFrameA: number | null = null;
  private transitionFrameB: number | null = null;
  private transitionFinishTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private loop!: FixedStepLoop;
  private player!: Phaser.GameObjects.Sprite;
  private boatHull!: Phaser.GameObjects.Ellipse;
  private mount: Phaser.GameObjects.Image | null = null;
  private cameraTarget: Phaser.GameObjects.Zone | null = null;
  private previousPlayerX = 0;
  private previousPlayerY = 0;
  /** Last level the presentation has already celebrated. 0 means "not yet seeded". */
  private lastCelebratedLevel = 0;
  private levelUpEndsAt = 0;
  /** Aura pieces that ride along with the character for the celebration. */
  private levelUpAura: Phaser.GameObjects.Arc[] = [];
  private levelUpSparkleTimer: Phaser.Time.TimerEvent | null = null;
  private hudDirty = true;
  private lastHudRefreshAt = Number.NEGATIVE_INFINITY;
  private joystick!: TouchJoystick;
  private keys: MovementKeys | null = null;
  private altKeys: MovementKeys | null = null;
  private intent: MoveIntent = NO_MOVE;
  private interiorIntent: MoveIntent = NO_MOVE;
  private readonly gridMovement = createGridMovementState();
  private readonly interiorGridMovement = createGridMovementState();
  /**
   * One tile of travel asked for by a d-pad tap. It is held as intent until the
   * simulation actually starts a tile — it only starts one when the previous
   * finishes — and dropped the moment it does, so a tap can never become a
   * walk. The deadline releases a step the world refuses (a wall, a sealed area
   * edge) instead of shoving against it forever.
   */
  private queuedStep: { x: number; y: number; expiresAt: number } | null = null;
  private actionKey: Phaser.Input.Keyboard.Key | null = null;
  private altActionKey: Phaser.Input.Keyboard.Key | null = null;
  private readonly onActionShortcut = (): void => {
    if (!this.state.pendingRespawn && !this.state.activeEncounter && !this.interiorSession.ownsOverlayInput) this.performInteractAction();
  };
  private craftKey: Phaser.Input.Keyboard.Key | null = null;
  private buildKey: Phaser.Input.Keyboard.Key | null = null;
  private inventoryKey: Phaser.Input.Keyboard.Key | null = null;
  private hotbarKeys: Phaser.Input.Keyboard.Key[] = [];
  private readonly hotbarShortcutHandlers = Array.from({ length: HOTBAR_SLOTS }, (_, slot) =>
    () => { if (!this.state.pendingRespawn && this.interiorSession.allowsWorldInteraction) this.hotbar.select(slot); },
  );
  private bareHandsKey: Phaser.Input.Keyboard.Key | null = null;
  private readonly onBareHandsShortcut = (): void => {
    if (!this.state.pendingRespawn && this.interiorSession.allowsWorldInteraction) this.hotbar.selectBareHands();
  };
  private cancelKey: Phaser.Input.Keyboard.Key | null = null;
  private confirmKey: Phaser.Input.Keyboard.Key | null = null;
  private rotateKey: Phaser.Input.Keyboard.Key | null = null;
  private hud!: GameplayHud;
  private buildMenu!: BuildMenu;
  private buildMode!: BuildModeController;
  private buildingItemMenu!: BuildingItemMenu;
  private hotbar!: Hotbar;
  private inventoryPanel!: InventoryPanel;
  private blueprintsPanel!: BlueprintsPanel;
  private navigator!: WorldNavigator;
  private respawnPanel!: RespawnPanel;
  private encounterPanel!: EncounterPanel;
  private openingPanel!: OpeningPartnershipPanel;
  private shelterGuide!: ShelterGuide;
  private paddockGuide!: PaddockGuide;
  private supplyRunGuide!: SupplyRunGuide;
  private gardenGuide!: GardenGuide;
  private journeyOutline: Phaser.GameObjects.Graphics | null = null;
  private shelterOutline: Phaser.GameObjects.Graphics | null = null;
  private npcServiceOverlay!: NpcServiceOverlay;
  private interiorFallback!: InteriorFallback;
  private interiorTransition!: InteriorTransitionOverlay;
  private interiorAudio!: InteriorAudioRouter;
  private npcDialogue!: NpcDialogue;
  private npcBark!: NpcBark;
  private adminPanel!: AdminPanel;
  private readonly resourceSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly dropSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly blueprintDropSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly toolDropSprites = new Map<string, Phaser.GameObjects.Image>();
  /** Containers are drawn directly: an area holds a handful, never enough to chunk. */
  private readonly containerSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly creatureSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly resourceNodesById = new Map<string, ResourceNodeState>();
  private readonly dropsById = new Map<string, GroundDropState>();
  private readonly creaturesById = new Map<string, WildCreatureState>();
  /** Raiders are drawn directly; a wave is far too small to need chunking. */
  private readonly raiderSprites = new Map<string, Phaser.GameObjects.Image>();
  /** Owned creatures on Work duty, ambling around the facility they staff. */
  private readonly workerCreatureSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly followerCreatureSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private gatherAssistance: { creatureId: string; x: number; y: number; startedAt: number } | null = null;
  /**
   * "Lv N" plates above wild creatures and raiders, keyed by entity id.
   *
   * Kept beside the sprites rather than parented to them: creature sprites go
   * through chunk activation, and a label that inherited that visibility would
   * still have to be positioned every frame anyway. One map, one pass, and the
   * plate mirrors whatever its sprite is currently doing.
   */
  private readonly levelPlates = new Map<string, Phaser.GameObjects.Text>();
  private readonly buildingsById = new Map<string, BuildingState>();
  private readonly resourceChunks = new EntityChunkIndex();
  private readonly dropChunks = new EntityChunkIndex();
  private readonly creatureChunks = new EntityChunkIndex();
  private readonly buildingChunks = new EntityChunkIndex();
  private readonly activeResourceIds = new Set<string>();
  private readonly activeDropIds = new Set<string>();
  private readonly activeCreatureIds = new Set<string>();
  private entityActivation: WorldPerformanceSnapshot['entities'] = {
    active: 0,
    total: 0,
    resources: { active: 0, total: 0 },
    drops: { active: 0, total: 0 },
    creatures: { active: 0, total: 0 },
    structures: { active: 0, total: 0 },
  };
  private entityActivationDirty = true;
  private activeChunkSignature: string | null = null;
  private readonly townBuildingSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly townPropSprites = new Map<string, Phaser.GameObjects.Image[]>();
  private readonly townGateSprites = new Map<string, {
    sprite: Phaser.GameObjects.Image;
    centerX: number;
    centerY: number;
    openness: number;
  }>();
  private readonly terrainChunkSprites: Phaser.GameObjects.Image[] = [];
  private readonly terrainTextureKeys: string[] = [];
  private pendingTerrainChunks: TerrainChunk[] = [];
  private terrainBuildFrame: number | null = null;
  private readonly frameTimes = new DurationWindow(240);
  private readonly areaTransitionTimes = new DurationWindow(30);
  private readonly interactionQueryTimes = new DurationWindow(240);
  private lastInteractionCandidateCount = 0;
  private facing: Facing = 'down';
  private activeEffectCount = 0;
  private ambientLeafSequence = 0;
  private gatheringUntil = 0;
  private playerActionVisual:{kind:StrikeStyle;startedAt:number;x:number;y:number}|null=null;
  /**
   * Walls are never an ambient target and never highlight on approach, but a
   * damaged one carries a health bar until it is repaired or destroyed.
   */
  private wallHpBar!: Phaser.GameObjects.Graphics;
  /** Ids and health of the bars currently drawn, so we only redraw on change. */
  private damagedWallSignature = '';
  private dangerAtmosphere!: DangerAtmosphereOverlay;
  private arcaneStorm!: ArcaneStormOverlay;
  private highlightedId: string | null = null;
  private lastTargetKey: string | null = null;
  private presentationTarget: InteractionTargetPresentation | null = null;
  /**
   * Sticky combat lock. Presentation-only and deliberately outside GameState:
   * a lock is one client's viewing choice, and the resolved target carries
   * fractional distances the canonical state hash would reject.
   */
  private stickyTarget: CombatTarget | null = null;
  private combatOverlay!: CombatOverlay;

  constructor() {
    super('world');
  }

  /** Read-only bridge used by the 3D presentation layer. */
  get3DPresentationState(): ThreePresentationState {
    const pose = this.interiorSession.pose;
    const buildingId = this.interiorSession.buildingId;
    return {
      placement: this.buildMode?.getPresentationState() ?? null,
      selection: this.buildMode?.getSelectionPresentationState() ?? null,
      batchPlacements: this.buildMode?.getBatchPresentationStates() ?? [],
      shelterGuide: this.paddockGuide?.visibleSite ?? this.shelterGuide?.visibleSite ?? null,
      journeyWaypoint: openingGardenAvailable(this.state) ? this.gardenGuide?.visibleWaypoint ?? null : this.supplyRunGuide?.visibleWaypoint ?? null,
      target: this.presentationTarget,
      gathering: this.time.now < this.gatheringUntil,
      gatherProgress: Math.max(0,Math.min(1,1-(this.gatheringUntil-this.time.now)/280)),
      playerAction:this.playerActionVisual&&this.time.now-this.playerActionVisual.startedAt<600
        ?{kind:this.playerActionVisual.kind,progress:Math.max(0,(this.time.now-this.playerActionVisual.startedAt)/600),x:this.playerActionVisual.x,y:this.playerActionVisual.y}:null,
      gatherAssistance: this.gatherAssistance && this.time.now - this.gatherAssistance.startedAt < 900
        ? { ...this.gatherAssistance, progress: Math.max(0, (this.time.now - this.gatherAssistance.startedAt) / 900) } : null,
      prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      interior: pose && buildingId
        ? {
            definition: interiorDefinitionForBuilding(buildingId),
            pose,
            focusedHotspotId: this.interiorSession.focusedHotspotId,
            transition: this.interiorSession.transition,
          }
        : null,
    };
  }

  /** Renderer-neutral interaction ownership for future interior presentations. */
  getGameplayMode(): GameplayMode {
    return this.interiorSession.mode;
  }

  /** Read-only diagnostics used by the browser release checks. */
  getInteriorAudioSnapshot(): ReturnType<InteriorAudioRouter['getSnapshot']> {
    return this.interiorAudio.getSnapshot();
  }

  /** Dev-only composition entry point for deterministic room screenshot QA. */
  previewTownInteriorForQa(buildingId: TownBuildingId): void {
    if (!import.meta.env.DEV) throw new Error('interior previews are available only in development builds');
    if (this.interiorSession.isActive) {
      if (this.interiorSession.mode.kind === 'dialogue') {
        this.npcDialogue.close();
        this.npcDialogueController.close();
        this.interiorSession.resumeInterior();
      } else if (this.interiorSession.mode.kind === 'service') {
        this.npcServiceOverlay.close();
      }
      this.interiorAudio.leave();
      this.interiorSession.recoverToWorld();
      this.interiorFallback.close();
    }
    this.enterTownBuilding(townBuildingById(buildingId));
  }

  init(data: WorldSceneData): void {
    // Interior pose is intentionally transient. A scene restart or loaded save
    // always resumes at the authoritative exterior position.
    this.interiorSession.recoverToWorld();
    resetGridMovement(this.interiorGridMovement);
    this.state = data.state ?? createInitialState(DEFAULT_WORLD_SEED);
    recoverPlayerOutsideTownDoor(this.state);
    this.globalBalance = data.globalBalance ?? globalBalanceService;
    if (data.onStateChanged) {
      this.onMoved = () => data.onStateChanged?.('ordinary');
      this.onCriticalChanged = () => data.onStateChanged?.('critical');
    }
    this.onTransitionStarted = data.onTransitionStarted ?? (() => {});
    this.is3DPresentation = data.is3DPresentation ?? (() => false);
    this.onBattleRound = data.onBattleRound ?? (() => {});
    this.systemControls = data.system ?? {};
  }

  preload(): void {
    preloadArtAssets(this);
  }

  create(): void {
    this.cameras.main.setVisible(!this.is3DPresentation());
    this.gatherAssistance = null;
    this.hudDirty = true;
    this.lastHudRefreshAt = Number.NEGATIVE_INFINITY;
    generateWorldTextures(this);
    registerWorldAnimations(this);
    this.buildGround();
    this.buildTownBuildings();
    this.buildResourceNodes();
    this.syncWildCreatures();
    this.syncGroundDrops();
    this.syncItemDrops();
    this.syncContainers();
    this.wallHpBar = this.add.graphics().setDepth(OVERLAY_DEPTH);
    this.combatOverlay = new CombatOverlay(this, OVERLAY_DEPTH);

    this.player = this.add
      .sprite(this.state.player.x, this.state.player.y, TextureKeys.PlayerIdleDown)
      .setOrigin(0.5, 0.875);
    this.boatHull = this.add
      .ellipse(this.state.player.x, this.state.player.y + 2, 24, 11, 0x8b5d38, 1)
      .setStrokeStyle(2, 0x3f2b22, 1)
      .setVisible((this.state.player.traversalMode ?? 'foot') === 'boat');
    this.player.play(AnimationKeys.PlayerIdleDown);
    this.previousPlayerX = this.state.player.x;
    this.previousPlayerY = this.state.player.y;
    this.syncMountAppearance();

    this.setupCamera();
    this.dangerAtmosphere = new DangerAtmosphereOverlay(this, this.state, OVERLAY_DEPTH - 1);
    // Above the atmospheric wash and every structure, below the HUD: a marker
    // the player has three seconds to read must never sit under a roof.
    this.arcaneStorm = new ArcaneStormOverlay(this, this.state, OVERLAY_DEPTH - 1);
    this.setupForestAmbience();
    this.setupInput();
    const parent = document.getElementById('app') ?? document.body;
    this.openingPanel = new OpeningPartnershipPanel(parent, this.state, {
      onAction: (action) => {
        const result = actOpeningTrust(this.state, action);
        this.onCriticalChanged();
        if (this.state.onboarding.completedMilestoneIds.includes('befriend-tuftle')) {
          this.stickyTarget = null;
          this.syncWildCreatures();
          this.openingPanel.openName();
        } else this.openingPanel.refresh(result.message);
        this.refreshHudNow();
      },
      onName: (name) => {
        const result = nameOpeningCompanion(this.state, name);
        this.openingPanel.refresh(result.message);
        if (result.ok) this.onCriticalChanged();
        this.refreshHudNow();
        return result.ok;
      },
      onClose: () => { this.intent = NO_MOVE; this.refreshHudNow(); },
    });
    this.hud = new GameplayHud(parent, this.state, {
      onAction: () => this.performInteractAction(),
      onThrowSnare: () => this.performSnareThrow(),
      onCraftTool: (definitionId) => this.performCraft(definitionId),
      onCraftRowboat: () => this.performToolCommand(() => craftRowboat(this.state), true),
      onDraftBlueprint: () => this.performToolCommand(
        () => draftBlueprintFromParchment(this.state), true,
      ),
      onCraftSnare: () => this.performToolCommand(() => craftTamingSnare(this.state), true),
      onCraftArrows: () => this.performToolCommand(() => craftArrows(this.state), true),
      onCraftReinforcedSnare: () => this.performToolCommand(() => craftReinforcedSnare(this.state), true),
      onCraftClothMask: () => this.performToolCommand(() => craftClothMask(this.state), true),
      onEnqueueIronSmelt: (furnaceId) => this.performToolCommand(() => enqueueIronSmelt(this.state, furnaceId), true),
      onCollectFurnace: (furnaceId) => this.performToolCommand(() => collectFurnaceOutput(this.state, furnaceId), true),
      onOrderTrainedCreature: (speciesId) => this.performToolCommand(() => orderTrainedCreature(this.state, speciesId), true),
      onCollectHousingBin: (housingId, resource) => this.performToolCommand(() => collectWorkerFacilityBin(this.state, housingId, resource), true),
      onLinkCartDockStorage: (cartDockId, storageId) => this.performToolCommand(() => linkCartDockStorage(this.state, cartDockId, storageId), true),
      onSetLogisticsRoute: (hubId, sourceWorkerId, destinationIds) => this.performToolCommand(
        () => setLogisticsRoute(this.state, hubId, sourceWorkerId, destinationIds), true,
      ),
      onClearLogisticsRoute: (hubId, sourceWorkerId) => this.performToolCommand(
        () => clearLogisticsRoute(this.state, hubId, sourceWorkerId), true,
      ),
      onReleaseCreature: (creatureId) => this.performToolCommand(() => releaseCreature(this.state, creatureId, true), true),
      onEquipTool: (toolId) => this.performToolCommand(() => equipTool(this.state, toolId), false),
      onSetCreatureRole: (creatureId, role) => this.performCreatureRole(creatureId, role),
      onSetBattleCompanion: (creatureId) => this.performToolCommand(() => setBattleCompanion(this.state, creatureId), true),
      onSelectCompanionAbility: (creatureId, abilityId) => this.performCompanionAbilitySelection(abilityId, creatureId),
      onWithdrawFromCache: (resource, cacheId) => this.performToolCommand(() => withdrawFromFieldCache(this.state, resource, cacheId), true),
      onDepositResourceToCache: (resource, stackIndex, cacheId) => this.performToolCommand(
        () => depositResourceStackInFieldCache(this.state, resource, stackIndex, cacheId), true,
      ),
      onWithdrawResourceFromCache: (resource, stackIndex, cacheId) => this.performToolCommand(
        () => withdrawResourceStackFromFieldCache(this.state, resource, stackIndex, cacheId), true,
      ),
      onDepositToolToCache: (toolId, cacheId) => this.performToolCommand(
        () => depositToolInFieldCache(this.state, toolId, cacheId), true,
      ),
      onWithdrawToolFromCache: (toolId, cacheId) => this.performToolCommand(
        () => withdrawToolFromFieldCache(this.state, toolId, cacheId), true,
      ),
      onSpendAttribute: (attribute) => {
        const ok = spendAttributePoint(this.state, attribute);
        this.hud.showFeedback(ok ? `${attribute[0]!.toUpperCase()}${attribute.slice(1)} increased` : 'No attribute points available', ok);
        if (ok) this.onCriticalChanged();
        this.refreshHudNow();
      },
      onApplyAttributes: (allocation) => {
        const ok = spendAttributePoints(this.state, allocation);
        this.hud.showFeedback(ok ? 'Attribute points applied' : 'Attribute points could not be applied', ok);
        if (ok) this.onCriticalChanged();
        this.refreshHudNow();
      },
      onClaimQuestReward: (questId) => this.claimQuestReward(questId),
      onCraftOpened: () => {
        this.inventoryPanel.toggleTab('craft');
      },
      onLoadTurretAmmo: (turretId, amount) => this.performTurretAmmo(loadTurretAmmo(this.state, turretId, amount)),
      onUnloadTurretAmmo: (turretId, amount) => this.performTurretAmmo(unloadTurretAmmo(this.state, turretId, amount)),
    });
    this.buildMode = new BuildModeController(this, this.state, {
      onBatchPreview: (preview) => this.buildMenu?.setBatchPreview(preview),
      onValidity: (check) => this.buildMenu.setValidity(check),
      onPlaced: (result) => this.onPlacementAttempt(result),
      onUndo: (result) => this.onPlacementUndo(result),
      onUndoAvailable: (available) => this.buildMenu.setUndoAvailable(available),
      onBuildingLongPress: (building) => this.enterDeleteModeOn(building),
      onDeleteTarget: (building) => this.buildMenu.setDeleteTarget(building),
    });
    this.syncBuildingQueryIndex();
    this.buildingItemMenu = new BuildingItemMenu(parent, this.state, {
      onDelete: (buildingId) => this.deleteBuilding(buildingId),
      onRepair: (buildingId) => this.repairWallById(buildingId),
      onClosed: () => this.buildMode.setSelectedBuilding(null),
    });
    this.buildMenu = new BuildMenu(parent, this.state, {
      onShapeChanged: (shape) => this.buildMode.setShape(shape),
      onStartPlacing: (id) => {
        this.inventoryPanel.close();
        this.buildMode.startPlacing(id);
      },
      onConfirm: () => this.buildMode.confirm(),
      onRotate: () => this.buildMode.toggleRotation(),
      onUndo: () => this.buildMode.undoLastPlacement(),
      onMarkerKindChanged: (kind) => this.buildMode.setMarkerKind(kind),
      onPlacingCancelled: () => this.buildMode.cancel(),
      onStartDeleting: () => {
        this.inventoryPanel.close();
        this.buildingItemMenu.close();
        this.buildMode.startDeleting();
      },
      onDeleteConfirm: () => this.deleteSelectedBuilding(),
      onDeletingCancelled: () => this.buildMode.stopDeleting(),
      onOpened: () => {
        this.inventoryPanel.toggleTab('craft');
      },
    });
    this.hotbar = new Hotbar(parent, this.state, {
      onEquipTool: (toolId) => this.performToolCommand(() => equipTool(this.state, toolId), false),
      onEquipBareHands: () => this.performToolCommand(() => equipBareHands(this.state), false),
    });
    this.inventoryPanel = new InventoryPanel(parent, this.state, {
      onEquipTool: (toolId) => this.performToolCommand(() => equipTool(this.state, toolId), false),
      onAssignHotbar: (toolId) => this.hotbar.assign(toolId),
      isOnHotbar: (toolId) => this.hotbar.isAssigned(toolId),
      onSplitStack: (resource, stackIndex, amount) => this.performToolCommand(
        () => splitResourceStack(this.state, resource, stackIndex, amount), true,
      ),
      onDropStack: (resource, stackIndex) => this.performToolCommand(
        () => dropResourceStack(this.state, resource, stackIndex), true,
      ),
      onRepairTool: (toolId) => this.performToolCommand(() => repairTool(this.state, toolId), true),
      onDropTool: (toolId) => this.performToolCommand(() => dropTool(this.state, toolId), true),
      onRegisterBlueprint: (instanceId) => this.performToolCommand(
        () => registerCarriedBlueprint(this.state, instanceId), true,
      ),
      onDropBlueprint: (instanceId) => this.performToolCommand(
        () => dropCarriedBlueprint(this.state, instanceId), true,
      ),
      onScrapBlueprint: (instanceId) => this.performToolCommand(
        () => scrapCarriedBlueprint(this.state, instanceId), true,
      ),
      onOpened: () => {
        this.buildMenu.close();
      },
    });
    this.adminPanel = new AdminPanel(parent, this.state, () => {
      this.snapRenderPoseToState();
      this.onCriticalChanged();
      this.refreshHudNow();
    }, this.globalBalance, this.systemControls);
    this.hud.attachToMenu(this.inventoryPanel);
    // Build is a section of the Craft tab now, so the palette mounts on the HUD.
    this.buildMenu.attachToMenu(this.hud);
    this.blueprintsPanel = new BlueprintsPanel(this.state);
    this.blueprintsPanel.onClaimed = (revealed) => {
      if (revealed.length === 0) return;
      // The unlock banner names what was learned, so a toast saying the same
      // thing at the same moment would only fight it for attention.
      this.onCriticalChanged();
      this.refreshHudNow();
    };
    this.blueprintsPanel.attachToMenu(this.inventoryPanel);
    this.shelterGuide = new ShelterGuide(this.state, {
      onPreview: (requests) => {
        if (!requests.length) return;
        this.inventoryPanel.close();
        this.buildMenu.beginPlacement(requests[0]!.definitionId);
        this.buildMode.setBatchRequests(requests);
      },
      onMove: (dx, dy) => this.performToolCommand(() => moveShelterPlan(this.state, dx, dy), true),
      onSupplies: () => this.performToolCommand(() => claimShelterSupplies(this.state), true),
      onFogAcknowledged: () => this.performToolCommand(() => acknowledgeOpeningFog(this.state), true),
    });
    this.shelterGuide.attachToMenu(this.inventoryPanel);
    this.paddockGuide = new PaddockGuide(this.state, {
      onPreview: (requests) => {
        if (!requests.length) return;
        this.inventoryPanel.close(); this.buildMenu.beginPlacement(requests[0]!.definitionId); this.buildMode.setBatchRequests(requests);
      },
      onMove: (dx, dy) => this.performToolCommand(() => movePaddockPlan(this.state, dx, dy), true),
      onSupplies: () => this.performToolCommand(() => claimPaddockSupplies(this.state), true),
      onWork: () => this.performToolCommand(() => startOpeningWork(this.state), true),
      onCollect: () => this.performToolCommand(() => collectOpeningOutput(this.state), true),
      onFollow: () => this.performToolCommand(() => followOpeningCompanion(this.state), true),
    });
    this.paddockGuide.attachToMenu(this.inventoryPanel);
    this.supplyRunGuide = new SupplyRunGuide(this.state, {
      onPractice: () => {
        const result = beginOpeningGuardPractice(this.state);
        if (result.ok) { this.inventoryPanel.close(); this.syncWildCreatures(); }
        this.applyEncounterResult(result);
      },
      onRecover: () => { this.performToolCommand(() => recoverOpeningSupplies(this.state), true); this.syncContainers(); },
      onClaim: () => this.performToolCommand(() => claimOpeningDiscovery(this.state), true),
      onSideCache: () => { this.performToolCommand(() => openOpeningSideCache(this.state), true); this.syncContainers(); },
    });
    this.supplyRunGuide.attachToMenu(this.inventoryPanel);
    this.gardenGuide = new GardenGuide(this.state, {
      onRegister: () => this.performToolCommand(() => registerOpeningDiscovery(this.state), true),
      onPreview: (requests) => {
        if (!requests.length) return;
        this.inventoryPanel.close(); this.buildMenu.beginPlacement(requests[0]!.definitionId); this.buildMode.setBatchRequests(requests);
      },
      onMove: (dx, dy) => this.performToolCommand(() => moveOpeningGardenPlan(this.state, dx, dy), true),
      onHarvest: () => this.performToolCommand(() => harvestOpeningGarden(this.state), true),
      onContinue: (goal) => this.performToolCommand(() => acknowledgeOpeningJourney(this.state, goal), true),
    });
    this.gardenGuide.attachToMenu(this.inventoryPanel);
    this.navigator = new WorldNavigator(
      parent,
      this.state,
      this.hud.coinBadge,
      (destinationAreaKey) => this.performWaystoneTravel(destinationAreaKey),
      () => this.inventoryPanel.openTab('shelter'),
      () => this.inventoryPanel.openTab('paddock'),
      () => this.inventoryPanel.openTab('supply-run'),
      () => this.inventoryPanel.openTab('garden'),
    );
    this.respawnPanel = new RespawnPanel(parent, this.state, (destinationId) => this.performRespawn(destinationId));
    this.encounterPanel = new EncounterPanel(
      parent,
      this.state,
      (action) => this.performEncounterAction(action),
      (abilityId) => this.performCompanionAbilitySelection(abilityId),
    );
    this.encounterPanel.refresh();
    // The 2D room paints the scene's own generated pixel art, so an interior is
    // made of the same textures as the world outside its door.
    this.interiorFallback = new InteriorFallback(parent, (key) => (
      this.textures.exists(key) ? this.textures.getBase64(key) : null
    ));
    this.interiorTransition = new InteriorTransitionOverlay(parent);
    this.interiorAudio = new InteriorAudioRouter();
    this.npcDialogue = new NpcDialogue(parent, {
      onChoice: (choiceId) => this.performDialogueChoice(choiceId),
      onClose: () => this.closeNpcDialogue(),
    });
    this.npcBark = new NpcBark(parent);
    this.npcServiceOverlay = new NpcServiceOverlay(parent, this.state, (_result) => {
      const mode = this.interiorSession.mode;
      if (mode.kind === 'service') this.recentNpcPurchase = { npcId: mode.npcId, service: townBuildingsInArea(this.state.currentArea.key).find((building) => building.id === mode.buildingId)?.service ?? 'weaponsmith' };
      this.onCriticalChanged();
      this.syncMountAppearance();
      this.refreshHudNow();
    }, (building) => {
      if (this.interiorSession.isActive) {
        this.interiorSession.resumeInterior();
        if (this.recentNpcPurchase?.npcId === building.npcId) this.showNpcBark(building.npcId, 'afterService');
        this.refreshHudNow();
        return;
      }
      this.interiorSession.beginExit();
      this.interiorSession.completeTransition();
      positionPlayerOutsideDoor(this.state, building);
      this.snapRenderPoseToState();
      this.onCriticalChanged();
      this.refreshHudNow();
    });
    this.showAreaSplash(parent);

    this.loop = new FixedStepLoop(FIXED_STEP_MS, (stepMs) => {
      if (this.openingPanel.isOpen) return;
      this.previousPlayerX = this.state.player.x;
      this.previousPlayerY = this.state.player.y;
      this.hudDirty = true;
      const discoveriesBefore = this.state.regionalProgress.discoveredLandmarkIds.length;
      if (stepMovement(
        this.state,
        this.intent,
        stepMs,
        this.gridMovement,
        (result) => this.onExposureDefeat(result),
        (reports) => this.onAbsentBaseRaids(reports),
        (damage) => this.combatOverlay.reportPlayerDamage(this.state.player.x, this.state.player.y, damage),
      )) {
        this.syncResourceTextures();
        this.syncGroundDrops();
    this.syncItemDrops();
        this.buildMode.syncPlaced(); // a finished Garden Bed batch swaps its texture
        this.onCriticalChanged();
      }
      if (this.state.regionalProgress.discoveredLandmarkIds.length > discoveriesBefore) {
        const landmarkId = this.state.regionalProgress.discoveredLandmarkIds.at(-1);
        const definition = landmarkId ? regionalIdentityForLandmark(landmarkId) : null;
        if (definition) {
          this.hud.showFeedback(
            `Discovered ${definition.landmark.name} · +${definition.discoveryReward.coins} coins`,
            true,
          );
          this.navigator.refresh(true);
        }
      }
    });

    this.applyLayout();
    this.updateEntityChunkActivation();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    if (this.state.onboarding.trustSession && nearbyOpeningTuftle(this.state)) {
      this.areaSplash?.remove();
      this.areaSplash = null;
      this.openingPanel.openTrust();
      this.refreshHudNow();
    }
  }

  private onExposureDefeat(result: PlayerDefeatResult): void {
    const loss = result.lostItemCount > 0 ? ' Carried inventory lost; storage boxes are safe.' : '';
    const cause = result.cause === 'raider'
      ? 'Raiders cut you down.'
      : result.cause === 'creature'
        ? 'A wild creature defeated you.'
        : 'Exposure reduced your health to 0.';
    this.hud.showFeedback(`${cause} Choose where to awaken.${loss}`, false);
    resetGridMovement(this.gridMovement);
    this.onCriticalChanged();
    this.respawnPanel.refresh(true);
    this.refreshHudNow();
  }

  private performRespawn(destinationId: string): RespawnCommandResult {
    const previousAreaKey = this.state.currentArea.key;
    const result = chooseRespawn(this.state, destinationId);
    if (!result.ok) return result;

    this.encounterPanel.dismiss();
    this.respawnPanel.refresh(true);
    resetGridMovement(this.gridMovement);
    this.snapRenderPoseToState();
    this.hud.showFeedback(result.message, true);
    this.onCriticalChanged();
    this.refreshHudNow();
    if (this.state.currentArea.key !== previousAreaKey) this.beginAreaTransition();
    return result;
  }

  private performWaystoneTravel(destinationAreaKey: string): WaystoneTravelResult {
    if (!this.interiorSession.allowsWorldInteraction) return { ok: false, message: 'Leave the building before using a waystone.' };
    const previousAreaKey = this.state.currentArea.key;
    const result = travelViaWaystone(this.state, destinationAreaKey);
    this.hud.showFeedback(result.message, result.ok);
    if (!result.ok) return result;

    resetGridMovement(this.gridMovement);
    this.intent = NO_MOVE;
    this.snapRenderPoseToState();
    this.onCriticalChanged();
    this.refreshHudNow();
    if (this.state.currentArea.key !== previousAreaKey) this.beginAreaTransition();
    return result;
  }

  /**
   * A base lost while the player was somewhere else must never be a silent
   * loss, so the round's off-screen outcome is reported the moment it settles.
   */
  private onAbsentBaseRaids(reports: readonly AbsentBaseRaidReport[]): void {
    const losses = reports.filter((report) => report.destroyed.length > 0);
    if (losses.length === 0) return;
    const detail = losses
      .map((report) => `${report.areaName} lost ${report.destroyed.join(', ')}`)
      .join(' · ');
    this.hud.showFeedback(`Raiders hit your other bases. ${detail}`, false);
  }

  override update(time: number, deltaMs: number): void {
    this.respawnPanel.refresh();
    this.frameTimes.record(deltaMs);
    if (this.transitioningArea) {
      this.intent = NO_MOVE;
      this.queuedStep = null;
      return;
    }
    const localInterior = this.interiorSession.mode.kind === 'interior';
    const inputBlocked = this.state.pendingRespawn || this.state.activeEncounter || this.openingPanel.isOpen || this.adminPanel.open || this.navigator.largeMapOpen;
    this.interiorIntent = !inputBlocked && localInterior && this.interiorSession.allowsLocalMovement
      ? this.alignInteriorIntentToPresentation(this.gatherRawInput())
      : NO_MOVE;
    this.intent = inputBlocked
      ? NO_MOVE
      : this.interiorSession.allowsWorldInteraction
        ? this.gatherInput()
        : NO_MOVE;
    const areaKeyBeforeMovement = this.state.currentArea.key;
    const movingBefore = this.gridMovement.moving || this.interiorGridMovement.moving;
    const poseBefore = this.queuedStepPose();
    const alpha = this.loop.advance(deltaMs);
    if (this.state.currentArea.key !== areaKeyBeforeMovement) {
      this.beginAreaTransition();
      return;
    }
    if (localInterior) this.updateInteriorExploration(deltaMs);
    this.retireQueuedStep(movingBefore, poseBefore);
    if (this.interiorSession.allowsWorldInteraction && (this.intent.x !== 0 || this.intent.y !== 0)) this.onMoved();
    if (!inputBlocked) this.updateSustainedFire();

    // Doors swing open as the player walks up and shut behind them.
    this.buildMode.updateOpeningAnimations(this.state.player.x, this.state.player.y, deltaMs);
    this.updateTownGateAnimations(deltaMs);

    // Walking changes range/overlap validity while a ghost is out.
    if (this.buildMode.placing) this.buildMode.refreshValidity();
    // The placement action bar owns the bottom-center while a ghost (or a
    // delete cursor) is out, and the d-pad's arrows aim it instead of walking.
    const aiming = this.buildMode.placing || this.buildMode.deleteMode;
    this.hotbar.setSuppressed(aiming);
    this.hud.setBuildMode(aiming);
    this.joystick.setPlacementMode(aiming);

    this.watchForLevelUp();
    this.renderPlayerPose(alpha);
    this.updateLevelUpCelebration();
    this.updateTerrainChunkVisibility();
    this.updateEntityChunkActivation();
    this.dangerAtmosphere.update(deltaMs);
    this.arcaneStorm.update();
    this.syncRaiders();
    this.syncWildCreaturePositions();
    this.syncLevelPlates();
    this.syncWorkerCreatures(time);
    this.syncFollowerCreatures();
    this.navigator.refresh();
    this.updateShelterOutline();
    this.updateTargetIndicators();
    this.updateCombatOverlay(deltaMs);
    this.updateDamagedWallBars();
    this.syncFacilityInteraction();
    this.refreshHudIfDue();
  }

  private buildGround(): void {
    this.destroyTerrainChunks();
    const palette = areaPalette(this.state.currentArea.theme);
    this.add
      .tileSprite(0, 0, WORLD_PX, WORLD_PX, TextureKeys.Ground)
      .setOrigin(0, 0)
      .setDepth(-WORLD_PX);

    const prioritizedChunks = prioritizeTerrainChunks(
      terrainChunkLayout(WORLD_TILES),
      this.state.player.x / TILE_SIZE,
      this.state.player.y / TILE_SIZE,
    );

    const buildChunk = (chunk: TerrainChunk): void => {
      const biomeLayer = this.add.graphics();
      for (let localTileY = 0; localTileY < chunk.tilesHigh; localTileY += 1) {
        for (let localTileX = 0; localTileX < chunk.tilesWide; localTileX += 1) {
          const tileX = chunk.tileX + localTileX;
          const tileY = chunk.tileY + localTileY;
          const worldX = tileX * TILE_SIZE;
          const worldY = tileY * TILE_SIZE;
          const x = localTileX * TILE_SIZE;
          const y = localTileY * TILE_SIZE;
          const isStarterForest = this.state.currentArea.theme === 'elaris'
            && starterBiomeAt(this.state.currentArea.seed, worldX + 8, worldY + 8) === 'forest';
          const isForest = this.state.currentArea.theme === 'forest' || isStarterForest;
          const noise = coordinateHash(this.state.currentArea.seed ^ 0x6f6f_7265, tileX, tileY);
          const isMountain = this.state.currentArea.theme === 'mountain';
          const elevation = isMountain ? mountainElevationBand(this.state.currentArea.seed, tileX, tileY) : 0;
          const mountainShade = elevation === 2 ? 0x59665a : elevation === 1 ? 0x4a5947 : 0x3d493e;
          const shade = isMountain
            ? mountainShade
            : isForest
              ? (noise > 0.64 ? 0x2b4a37 : 0x243f30)
              : noise > 0.67 ? palette.alternate : palette.base;
          biomeLayer.fillStyle(shade, isMountain || isForest ? 0.96 : 0.68).fillRect(x, y, TILE_SIZE, TILE_SIZE);
          if (isMountain) {
            const aboveElevation = mountainElevationBand(this.state.currentArea.seed, tileX, tileY - 1);
            if (aboveElevation !== elevation) {
              biomeLayer.fillStyle(aboveElevation < elevation ? 0x929b96 : 0x24292b, 0.92).fillRect(x, y, TILE_SIZE, 1);
              biomeLayer.fillStyle(0x303a37, 0.74).fillRect(x + (noise > 0.5 ? 2 : 0), y + 1, TILE_SIZE - 2, 2);
            }
            const screeNoise = coordinateHash(this.state.currentArea.seed ^ 0x5343_5245, tileX, tileY);
            if (screeNoise > 0.69) {
              biomeLayer.fillStyle(elevation === 2 ? 0x929b96 : 0x697375, 0.75)
                .fillRect(x + 3 + (tileX % 5), y + 8, 3, 2)
                .fillRect(x + 10, y + 4 + (tileY % 6), 2, 1);
              biomeLayer.fillStyle(0x24292b, 0.55).fillRect(x + 5 + (tileY % 4), y + 10, 2, 1);
            }
            if (screeNoise > 0.958) {
              biomeLayer.fillStyle(0x8f4f32, 0.9)
                .fillRect(x + 2, y + 11, 5, 1)
                .fillRect(x + 6, y + 9, 7, 2);
              biomeLayer.fillStyle(0xd08b54, 0.86).fillRect(x + 8, y + 9, 3, 1);
            }
          } else if (isForest) {
            const forestDetail = coordinateHash(this.state.currentArea.seed ^ 0x464f_5245, tileX, tileY);
            if (forestDetail > 0.64) {
              biomeLayer.fillStyle(forestDetail > 0.91 ? 0x78a365 : 0x356246, 0.88)
                .fillRect(x + 1 + (tileX % 6), y + 4 + (tileY % 4), 5, 2)
                .fillRect(x + 8, y + 9, 4, 2);
              biomeLayer.fillStyle(0x4e7955, 0.7).fillRect(x + 3, y + 3 + (tileX % 3), 3, 1);
            }
            if (forestDetail > 0.86) {
              biomeLayer.fillStyle(0x513a29, 0.9)
                .fillRect(x, y + 11, 8, 3)
                .fillRect(x + 6, y + 9, 6, 2)
                .fillRect(x + 11, y + 7, 4, 2);
              biomeLayer.fillStyle(0x7a5435, 0.76).fillRect(x + 2, y + 10, 9, 1);
            }
            if (forestDetail > 0.955) {
              biomeLayer.fillStyle(0xa9794a, 0.86)
                .fillRect(x + 3, y + 4, 2, 1)
                .fillRect(x + 11, y + 8, 2, 2);
              biomeLayer.fillStyle(0xd0a466, 0.75).fillRect(x + 7, y + 6, 1, 1);
            }
          } else if (noise > 0.875) {
            biomeLayer.fillStyle(palette.detail, 0.7);
            biomeLayer.fillRect(x + 3 + (tileX % 7), y + 4 + (tileY % 6), 1, 2);
            if (noise > 0.965) biomeLayer.fillStyle(0xd5ae58, 0.85).fillRect(x + 9, y + 7, 1, 1);
          }
          const terrain = terrainAt(this.state.seed, this.state.currentArea, tileX, tileY);
          if (terrain === 'shallow-water' || terrain === 'deep-water') {
            biomeLayer.fillStyle(terrain === 'deep-water' ? 0x256b7d : 0x3d9296, 0.98)
              .fillRect(x, y, TILE_SIZE, TILE_SIZE);
            const ripple = coordinateHash(this.state.seed ^ 0x5741_5645, tileX, tileY);
            if (ripple > 0.46) {
              biomeLayer.fillStyle(terrain === 'deep-water' ? 0x65aab3 : 0x86c5bc, 0.48)
                .fillRect(x + 2 + (tileY % 4), y + 4 + (tileX % 5), 7, 1);
            }
          } else if (terrain === 'bridge') {
            biomeLayer.fillStyle(0x765238, 1).fillRect(x, y, TILE_SIZE, TILE_SIZE);
            biomeLayer.fillStyle(0xa77b4b, 0.9).fillRect(x, y + 2, TILE_SIZE, 2).fillRect(x, y + 10, TILE_SIZE, 2);
            biomeLayer.fillStyle(0x3d2b21, 0.82).fillRect(x + 7, y, 1, TILE_SIZE);
          } else if (terrain === 'rock-wall') {
            biomeLayer.fillStyle(0x2d3332, 0.72).fillRect(x + 1, y + 4, TILE_SIZE - 1, TILE_SIZE - 3);
            biomeLayer.fillStyle(isMountain ? 0x7e8982 : 0x626c66, 1).fillRect(x, y, TILE_SIZE - 1, TILE_SIZE - 5);
            biomeLayer.fillStyle(0xa4aca4, 0.72).fillRect(x + 2, y + 1, 8, 2);
          }
        }
      }
      if (townBuildingsInArea(this.state.currentArea.key).length > 0) this.drawTownPaths(biomeLayer, chunk);

      const textureKey = `terrain-chunk-${chunk.tileX}-${chunk.tileY}`;
      if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
      biomeLayer.generateTexture(
        textureKey,
        chunk.tilesWide * TILE_SIZE,
        chunk.tilesHigh * TILE_SIZE,
      );
      biomeLayer.destroy();

      this.terrainTextureKeys.push(textureKey);
      this.terrainChunkSprites.push(this.add
        .image(chunk.tileX * TILE_SIZE, chunk.tileY * TILE_SIZE, textureKey)
        .setOrigin(0, 0)
        .setDepth(-WORLD_PX + 1));
    };

    // The player can see at most the current and neighboring chunks. Build
    // those before the first destination frame, then spread the rest across
    // later frames so a transition never pays for the whole 160x160 map.
    for (const chunk of prioritizedChunks.immediate) buildChunk(chunk);
    this.pendingTerrainChunks = prioritizedChunks.deferred;

    const areaKey = this.state.currentArea.key;
    const buildNextChunk = (): void => {
      this.terrainBuildFrame = null;
      if (!this.sys.isActive() || this.state.currentArea.key !== areaKey) return;
      const chunk = this.pendingTerrainChunks.shift();
      if (!chunk) return;
      buildChunk(chunk);
      this.updateTerrainChunkVisibility();
      this.terrainBuildFrame = requestAnimationFrame(buildNextChunk);
    };
    if (this.pendingTerrainChunks.length > 0) {
      this.terrainBuildFrame = requestAnimationFrame(buildNextChunk);
    }
    this.cameras.main.setBackgroundColor(palette.background);
  }

  private drawTownPaths(layer: Phaser.GameObjects.Graphics, chunk: TerrainChunk): void {
    for (let tileY = 83; tileY <= 86; tileY += 1) {
      if (tileY < chunk.tileY || tileY >= chunk.tileY + chunk.tilesHigh) continue;
      const startX = chunk.tileX;
      const endX = chunk.tileX + chunk.tilesWide;
      for (let tileX = startX; tileX < endX; tileX += 1) {
        const x = (tileX - chunk.tileX) * TILE_SIZE;
        const y = (tileY - chunk.tileY) * TILE_SIZE;
        layer.fillStyle((tileX + tileY) % 3 === 0 ? 0x805b3c : 0x76543a, 0.96)
          .fillRect(x, y, TILE_SIZE, TILE_SIZE);
        if ((tileX + tileY) % 7 === 0) layer.fillStyle(0xa9794a, 0.68).fillRect(x + 2, y + 3, 7, 1);
      }
    }
    for (const building of townBuildingsInArea(this.state.currentArea.key)) {
      const primaryOutside = outsideDoorTile(building);
      const stepX = primaryOutside.tileX - building.door.tileX;
      const stepY = primaryOutside.tileY - building.door.tileY;
      for (const door of townBuildingDoorTiles(building)) {
        const outside = { tileX: door.tileX + stepX, tileY: door.tileY + stepY };
        for (let offset = 0; offset < 4; offset += 1) {
          const tileX = outside.tileX + stepX * offset;
          const tileY = outside.tileY + stepY * offset;
          if (
            tileX < chunk.tileX || tileX >= chunk.tileX + chunk.tilesWide
            || tileY < chunk.tileY || tileY >= chunk.tileY + chunk.tilesHigh
          ) continue;
          const x = (tileX - chunk.tileX) * TILE_SIZE;
          const y = (tileY - chunk.tileY) * TILE_SIZE;
          layer.fillStyle(offset % 2 === 0 ? 0x76543a : 0x805b3c, 0.96).fillRect(x, y, TILE_SIZE, TILE_SIZE);
          layer.fillStyle(0xa9794a, 0.7).fillRect(x + 2, y + 2, 7, 1);
          layer.fillStyle(0x513a29, 0.7).fillRect(x + 11, y + 10, 2, 2);
        }
      }
    }
  }

  private destroyTerrainChunks(): void {
    if (this.terrainBuildFrame !== null) cancelAnimationFrame(this.terrainBuildFrame);
    this.terrainBuildFrame = null;
    this.pendingTerrainChunks.length = 0;
    for (const sprite of this.terrainChunkSprites) sprite.destroy();
    this.terrainChunkSprites.length = 0;
    for (const textureKey of this.terrainTextureKeys) {
      if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
    }
    this.terrainTextureKeys.length = 0;
  }

  /** Restrained deterministic leaf drift; presentation-only and visibility aware. */
  private setupForestAmbience(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.time.addEvent({ delay: 1400, loop: true, callback: () => {
      if (document.hidden || this.activeEffectCount >= 16) return;
      const view = this.cameras.main.worldView;
      const centerX = view.centerX;
      const centerY = view.centerY;
      const inForest = this.state.currentArea.theme === 'forest'
        || (this.state.currentArea.theme === 'elaris'
          && starterBiomeAt(this.state.currentArea.seed, centerX, centerY) === 'forest');
      if (!inForest) return;

      const sequence = this.ambientLeafSequence++;
      const horizontal = coordinateHash(this.state.currentArea.seed ^ 0x4c45_4146, sequence, 1);
      const drift = coordinateHash(this.state.currentArea.seed ^ 0x4452_4946, sequence, 2);
      const x = view.left + 24 + horizontal * Math.max(1, view.width - 48);
      const y = view.top + 18 + drift * Math.max(1, view.height * 0.28);
      this.activeEffectCount += 1;
      const leaf = this.add.rectangle(x, y, sequence % 2 === 0 ? 3 : 2, 2, sequence % 3 === 0 ? 0xd0a466 : 0x78a365, 0.8)
        .setAngle(sequence % 2 === 0 ? 24 : -18)
        .setDepth(OVERLAY_DEPTH - 4);
      this.tweens.add({
        targets: leaf,
        x: x + 18 + drift * 16,
        y: y + 48 + horizontal * 24,
        angle: leaf.angle + 150,
        alpha: 0,
        duration: 2200,
        ease: 'Sine.easeInOut',
        onComplete: () => { leaf.destroy(); this.activeEffectCount -= 1; },
      });
    } });
  }

  /** Phaser does not spatially cull ordinary images, so hide distant chunks. */
  private updateTerrainChunkVisibility(): void {
    const view = this.cameras.main.worldView;
    if (view.width <= 0 || view.height <= 0) return;
    const padding = TILE_SIZE * 2;

    for (const chunk of this.terrainChunkSprites) {
      const visible = chunk.x + chunk.width >= view.left - padding
        && chunk.x <= view.right + padding
        && chunk.y + chunk.height >= view.top - padding
        && chunk.y <= view.bottom + padding;
      if (chunk.visible !== visible) chunk.setVisible(visible);
    }
  }

  getPerformanceSnapshot(): WorldPerformanceSnapshot {
    return {
      frameTimes: this.frameTimes.snapshot(33.33),
      areaTransitions: this.areaTransitionTimes.snapshot(),
      terrainChunks: {
        visible: this.terrainChunkSprites.reduce((count, chunk) => count + (chunk.visible ? 1 : 0), 0),
        total: this.terrainChunkSprites.length,
      },
      entities: {
        ...this.entityActivation,
        resources: { ...this.entityActivation.resources },
        drops: { ...this.entityActivation.drops },
        creatures: { ...this.entityActivation.creatures },
        structures: { ...this.entityActivation.structures },
      },
      interactionQueries: {
        durations: this.interactionQueryTimes.snapshot(),
        candidates: this.lastInteractionCandidateCount,
        total: this.resourceChunks.size + this.dropChunks.size + this.creatureChunks.size + this.buildingChunks.size,
      },
    };
  }

  private updateEntityChunkActivation(): void {
    const view = this.cameras.main.worldView;
    if (view.width <= 0 || view.height <= 0 || !this.buildMode) return;
    const activeChunks = activeEntityChunkKeys(view, 1);
    const signature = [...activeChunks].join('|');
    if (!this.entityActivationDirty && signature === this.activeChunkSignature) return;
    const resources = this.applyChunkActivation(
      this.resourceChunks,
      this.resourceSprites,
      this.activeResourceIds,
      activeChunks,
      (id, sprite) => {
        const node = this.resourceNodesById.get(id);
        if (node && sprite.texture.key !== this.nodeTexture(node)) sprite.setTexture(this.nodeTexture(node));
      },
    );
    const drops = this.applyChunkActivation(this.dropChunks, this.dropSprites, this.activeDropIds, activeChunks);
    const creatures = this.applyChunkActivation(this.creatureChunks, this.creatureSprites, this.activeCreatureIds, activeChunks);
    const structures = this.buildMode.updateChunkActivation(activeChunks);
    this.entityActivation = {
      active: resources.active + drops.active + creatures.active + structures.active,
      total: resources.total + drops.total + creatures.total + structures.total,
      resources,
      drops,
      creatures,
      structures,
    };
    this.activeChunkSignature = signature;
    this.entityActivationDirty = false;
  }

  private applyChunkActivation<T extends ChunkedSprite>(
    index: EntityChunkIndex,
    sprites: ReadonlyMap<string, T>,
    activeIds: Set<string>,
    activeChunks: ReadonlySet<string>,
    onActivate?: (id: string, sprite: T) => void,
  ): EntityActivationCounts {
    const nextActiveIds = index.idsInChunks(activeChunks);
    for (const id of activeIds) {
      if (!nextActiveIds.has(id)) sprites.get(id)?.setActive(false).setVisible(false);
    }
    for (const id of nextActiveIds) {
      if (activeIds.has(id)) continue;
      const sprite = sprites.get(id);
      if (!sprite) continue;
      onActivate?.(id, sprite);
      sprite.setActive(true).setVisible(true);
    }
    activeIds.clear();
    for (const id of nextActiveIds) activeIds.add(id);
    return { active: nextActiveIds.size, total: index.size };
  }

  private addForgeAmbience(building: TownBuildingDefinition): void {
    const { footprint } = building;
    const chimneyX = (footprint.tileX + footprint.tilesWide - 1.15) * TILE_SIZE;
    const chimneyY = (footprint.tileY + 0.2) * TILE_SIZE;
    const glow = this.add.rectangle(
      (building.door.tileX + building.doorWidth / 2) * TILE_SIZE,
      (building.door.tileY + 0.55) * TILE_SIZE,
      12,
      9,
      0xe66a32,
      0.28,
    ).setDepth((footprint.tileY + footprint.tilesHigh) * TILE_SIZE);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.tweens.add({ targets: glow, alpha: { from: 0.18, to: 0.38 }, duration: 900, yoyo: true, repeat: -1 });
      this.time.addEvent({ delay: 720, loop: true, callback: () => {
        if (document.hidden || this.activeEffectCount >= 24) return;
        this.activeEffectCount += 1;
        const smoke = this.add.rectangle(chimneyX, chimneyY, 3, 3, 0xb9c7ba, 0.42).setDepth(OVERLAY_DEPTH - 2);
        this.tweens.add({ targets: smoke, x: chimneyX - 4, y: chimneyY - 13, alpha: 0, scale: 1.7, duration: 1250,
          onComplete: () => { smoke.destroy(); this.activeEffectCount -= 1; } });
      } });
    }
  }

  private buildResourceNodes(): void {
    this.resourceSprites.clear();
    this.resourceNodesById.clear();
    this.resourceChunks.clear();
    this.activeResourceIds.clear();
    this.entityActivationDirty = true;
    for (const node of this.state.resourceNodes) {
      const sprite = this.add
        .image(node.x, node.y, this.nodeTexture(node))
        .setOrigin(0.5, 0.875)
        .setDepth(node.y)
        .setActive(false)
        .setVisible(false);
      this.resourceSprites.set(node.id, sprite);
      this.resourceNodesById.set(node.id, node);
      this.resourceChunks.upsert(node.id, node.x, node.y);
    }
  }

  private buildTownBuildings(): void {
    const fallen = hasElarisFallen(this.state);
    if (isElaris(this.state)) {
      TOWN_PERIMETER_SEGMENTS.forEach((segment, index) => {
        // Every third piece of a fallen perimeter is simply gone. The gaps are
        // the visual promise that the fence no longer stops anything, which is
        // exactly what the simulation now does.
        if (fallen && index % 3 === 0) return;
        const dx = segment.end.x - segment.start.x;
        const dy = segment.end.y - segment.start.y;
        const sprite = this.add.image(
          (segment.start.x + segment.end.x) * TILE_SIZE / 2,
          (segment.start.y + segment.end.y) * TILE_SIZE / 2,
          segment.kind === 'gate' ? TextureKeys.GateWood : TextureKeys.FenceWood,
        )
          .setOrigin(0.5)
          .setAngle(Phaser.Math.RadToDeg(Math.atan2(dy, dx)))
          .setScale(Math.hypot(dx, dy), 1)
          .setDepth(Math.max(segment.start.y, segment.end.y) * TILE_SIZE);
        if (fallen) {
          sprite.setTint(0x5a4c40).setAlpha(0.7);
          return;
        }
        if (segment.kind === 'gate') {
          this.townGateSprites.set(`town-gate-${index}`, {
            sprite,
            centerX: (segment.start.x + segment.end.x) * TILE_SIZE / 2,
            centerY: (segment.start.y + segment.end.y) * TILE_SIZE / 2,
            openness: 0,
          });
        }
      });
      // Cold purifiers are removed rather than drawn dark: their sprite is the
      // player's cue for "you can breathe here", and it must not lie.
      // The permanent column is the exception, and it is drawn by the same rule:
      // it is still running, so it is still shown.
      const purifiers = fallen ? [PERMANENT_AIR_PURIFIER] : [...TOWN_AIR_PURIFIERS, PERMANENT_AIR_PURIFIER];
      for (const purifier of purifiers) {
        this.add.image(
          (purifier.x + 0.5) * TILE_SIZE,
          (purifier.y + 0.5) * TILE_SIZE,
          TextureKeys.AirPurifier,
        ).setOrigin(0.5).setDepth((purifier.y + 1) * TILE_SIZE);
      }
      // The town's public workbench, where a new character registers blueprints
      // before they can build a bench of their own. Unlike the purifiers it is
      // drawn even after the fall: a ruined bench you can walk up to and fail
      // to use is how a player learns that registering is now their problem.
      const bench = this.add.image(
        ELARIS_PUBLIC_WORKBENCH_TILE.tileX * TILE_SIZE,
        ELARIS_PUBLIC_WORKBENCH_TILE.tileY * TILE_SIZE,
        TextureKeys.Workbench,
      ).setOrigin(0, 0).setDepth(
        (ELARIS_PUBLIC_WORKBENCH_TILE.tileY + ELARIS_PUBLIC_WORKBENCH_SIZE.tilesHigh) * TILE_SIZE - 1,
      );
      if (fallen) bench.setTint(0x4b4038).setAlpha(0.82);
      this.buildWaterTemple();
    }
    for (const building of townBuildingsInArea(this.state.currentArea.key)) {
      const ruined = isRuinedTownBuilding(building, fallen);
      const { footprint } = building;
      const x = footprint.tileX * TILE_SIZE;
      const y = footprint.tileY * TILE_SIZE;
      const sprite = this.add.image(x, y, townBuildingTextureKey(building.id))
        .setOrigin(0, 0)
        .setDepth((footprint.tileY + footprint.tilesHigh) * TILE_SIZE - 1);
      // A ruin is the same silhouette burned down to soot: the player should
      // recognise which building they lost from across the square.
      if (ruined) sprite.setTint(0x4b4038).setAlpha(0.82);
      this.townBuildingSprites.set(building.id, sprite);
      const labelX = (footprint.tileX + footprint.tilesWide / 2) * TILE_SIZE;
      const labelY = footprint.tileY * TILE_SIZE - 3;
      const label = this.add.text(labelX, labelY, ruined ? `${building.displayName} (ruined)` : building.displayName, {
        fontFamily: 'system-ui, sans-serif', fontSize: '9px', color: ruined ? '#8e8378' : '#fff3c4',
        stroke: '#09140e', strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(OVERLAY_DEPTH);
      label.setData('town-label', true);
      if (ruined) {
        this.addRuinRubble(building);
        continue;
      }
      this.addTownContextProps(building);
      if (building.id === 'weaponsmith') this.addForgeAmbience(building);
    }
    this.buildRegionalLandmark();
  }

  /** Matching top-down silhouette for the optional Phaser presentation. */
  private buildWaterTemple(): void {
    const x = (ELARIS_WATER_TEMPLE.tileX + 0.5) * TILE_SIZE;
    const y = (ELARIS_WATER_TEMPLE.tileY + 0.5) * TILE_SIZE;
    this.add.ellipse(x, y + 8, 176, 116, 0x466a55).setStrokeStyle(5, 0x78977a).setDepth(y - 48);
    this.add.ellipse(x, y + 8, 112, 72, 0x58747a).setStrokeStyle(4, 0xc9d8cf).setDepth(y - 42);
    this.add.rectangle(x, y - 5, 86, 58, 0xc9d8cf).setStrokeStyle(3, 0x58747a).setDepth(y - 36);
    for (const columnX of [x - 31, x + 31]) {
      this.add.rectangle(columnX, y - 18, 9, 48, 0xe1e9df).setStrokeStyle(2, 0x58747a).setDepth(y + 18);
    }
    this.add.triangle(x, y - 69, 0, 54, 50, 0, 100, 54, 0x4ab3b2)
      .setStrokeStyle(4, 0x245f78).setDepth(y + 20);
    this.add.ellipse(x, y + 8, 31, 19, 0x63d8d4).setStrokeStyle(4, 0x58747a).setDepth(y + 23);
    this.add.circle(x, y - 4, 7, 0xbafff4).setStrokeStyle(2, 0x328f95).setDepth(y + 25);
    this.add.text(x, y - 78, 'Water Temple', {
      fontFamily: 'system-ui, sans-serif', fontSize: '10px', color: '#aefaf0', stroke: '#102a2d', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(OVERLAY_DEPTH);
  }

  private buildRegionalLandmark(): void {
    const definition = regionalIdentityForArea(this.state.currentArea.key);
    if (!definition) return;
    const x = (definition.landmark.tileX + 0.5) * TILE_SIZE;
    const y = (definition.landmark.tileY + 0.5) * TILE_SIZE;
    const depth = y + TILE_SIZE * 2;

    if (definition.landmark.kind === 'sunwheel-orchard') {
      this.add.circle(x, y + 7, 24, 0x3b662f, 0.34).setDepth(y - 2);
      for (let point = 0; point < 8; point += 1) {
        const angle = point / 8 * Math.PI * 2;
        const treeX = x + Math.cos(angle) * 18;
        const treeY = y + Math.sin(angle) * 12;
        this.add.rectangle(treeX, treeY + 5, 3, 10, 0x76512c).setDepth(treeY + 6);
        this.add.circle(treeX, treeY, 7, point % 2 === 0 ? 0xb8c94d : 0x82a83f)
          .setStrokeStyle(1, 0x38592e).setDepth(treeY + 7);
      }
      this.add.circle(x, y, 8, 0xf4cf62).setStrokeStyle(3, 0x8b622b).setDepth(depth);
    } else {
      this.add.circle(x, y + 8, 20, 0x356d78, 0.75).setStrokeStyle(3, 0x8fd7d2).setDepth(y - 1);
      this.add.rectangle(x, y - 5, 8, 30, 0x745da5).setStrokeStyle(2, 0xc9a6ff).setDepth(depth);
      this.add.triangle(x, y - 25, 0, 14, 9, 0, 18, 14, 0xd8c6ff)
        .setStrokeStyle(2, 0x6f4ea0).setDepth(depth + 1);
    }

    this.add.text(x, y - 34, definition.landmark.name, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '9px',
      color: definition.landmark.color,
      stroke: '#09140e',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(OVERLAY_DEPTH);
  }

  /** Match the authored town gates to the proximity-driven door animation. */
  private updateTownGateAnimations(deltaMs: number): void {
    const step = deltaMs / TOWN_GATE_SWING_MS;
    for (const gate of this.townGateSprites.values()) {
      const target = Math.hypot(
        this.state.player.x - gate.centerX,
        this.state.player.y - gate.centerY,
      ) <= TOWN_GATE_OPEN_RADIUS ? 1 : 0;
      gate.openness = target > gate.openness
        ? Math.min(target, gate.openness + step)
        : Math.max(target, gate.openness - step);
      const frame = TOWN_GATE_SWING_FRAMES[Math.round(gate.openness * (TOWN_GATE_SWING_FRAMES.length - 1))]
        ?? TOWN_GATE_SWING_FRAMES[0];
      if (gate.sprite.texture.key !== frame) gate.sprite.setTexture(frame);
    }
  }

  /**
   * Charred debris around a ruined footprint. Deterministic from the footprint
   * so the same wreck is drawn every time the area is entered.
   */
  private addRuinRubble(building: TownBuildingDefinition): void {
    const { footprint } = building;
    const bottom = footprint.tileY + footprint.tilesHigh;
    const props: Phaser.GameObjects.Image[] = [];
    for (let index = 0; index < 5; index += 1) {
      const tileX = footprint.tileX + 0.6 + (footprint.tilesWide - 1.2) * (index / 4);
      const tileY = bottom - 0.15 - (index % 2) * 0.45;
      props.push(this.add
        .image(tileX * TILE_SIZE, tileY * TILE_SIZE, TextureKeys.TownBarrel)
        .setOrigin(0.5, 1)
        .setDepth(bottom * TILE_SIZE)
        .setTint(0x3d342c)
        .setAlpha(0.8)
        .setAngle(index % 2 === 0 ? 74 : -63)
        .setScale(0.85));
    }
    this.townPropSprites.set(building.id, props);
  }

  private addTownContextProps(building: TownBuildingDefinition): void {
    const { footprint } = building;
    const bottom = footprint.tileY + footprint.tilesHigh;
    const specs = building.id === 'weaponsmith'
      ? [
        { key: TextureKeys.TownAnvil, tileX: footprint.tileX + 1.15, tileY: bottom - 0.15 },
        { key: TextureKeys.TownBarrel, tileX: footprint.tileX + footprint.tilesWide - 0.85, tileY: bottom - 0.15 },
      ]
      : building.id === 'farm'
        ? [
          { key: TextureKeys.TownHayBale, tileX: footprint.tileX + 0.9, tileY: bottom - 0.15 },
          { key: TextureKeys.TownHayBale, tileX: footprint.tileX + footprint.tilesWide - 0.9, tileY: bottom - 0.15 },
          { key: TextureKeys.TownBarrel, tileX: footprint.tileX + footprint.tilesWide - 1.85, tileY: bottom - 0.15 },
        ]
        : building.id === 'market'
          ? [
          { key: TextureKeys.TownProduceCrate, tileX: footprint.tileX + 1.1, tileY: footprint.tileY + 2.2 },
          { key: TextureKeys.TownProduceCrate, tileX: footprint.tileX + footprint.tilesWide - 1.1, tileY: footprint.tileY + 2.2 },
          { key: TextureKeys.TownBarrel, tileX: footprint.tileX + footprint.tilesWide - 1.9, tileY: footprint.tileY + 2.2 },
          ]
          : [
            { key: TextureKeys.TownBarrel, tileX: footprint.tileX + 0.9, tileY: bottom - 0.15 },
            { key: TextureKeys.TownBarrel, tileX: footprint.tileX + footprint.tilesWide - 0.9, tileY: bottom - 0.15 },
          ];
    const props = specs.map(({ key, tileX, tileY }) => this.add
      .image(tileX * TILE_SIZE, tileY * TILE_SIZE, key)
      .setOrigin(0.5, 1)
      .setDepth(bottom * TILE_SIZE));
    this.townPropSprites.set(building.id, props);
  }

  /** Worker automation changes node HP off-screen, so reconcile their art too. */
  private syncResourceTextures(): void {
    for (const id of this.activeResourceIds) {
      const node = this.resourceNodesById.get(id);
      if (!node) continue;
      const sprite = this.resourceSprites.get(id);
      if (sprite && sprite.texture.key !== this.nodeTexture(node)) sprite.setTexture(this.nodeTexture(node));
    }
  }

  /** Depleted nodes stay visible as remains — they still occupy their tile. */
  private nodeTexture(node: ResourceNodeState): string {
    if (node.kind === 'tree') return node.hp > 0 ? (coordinateHash(this.state.seed, Math.round(node.x), Math.round(node.y)) > 0.5 ? TextureKeys.TreeAlt : TextureKeys.Tree) : TextureKeys.Stump;
    if (node.kind === 'stone') return node.hp > 0 ? (coordinateHash(this.state.seed ^ 0x51a7, Math.round(node.x), Math.round(node.y)) > 0.5 ? TextureKeys.RockAlt : TextureKeys.Rock) : TextureKeys.Rubble;
    if (node.kind === 'metal') return node.hp > 0 ? TextureKeys.IronVein : TextureKeys.IronRubble;
    if (node.kind === 'berry-bush') return node.hp > 0 ? TextureKeys.BerryBush : TextureKeys.BerryRemains;
    return node.hp > 0 ? TextureKeys.Plant : TextureKeys.PlantRemains;
  }

  /**
   * Draw blueprints and put-down tools lying in the world.
   *
   * Kept out of the chunked ground-drop pipeline on purpose: there are only
   * ever a handful, they carry a hard ten-minute expiry, and a corpse run fails
   * outright if the thing being run back for is not on screen. They are drawn
   * with the blueprint icon tinted to their quality so a player can tell from a
   * distance whether the sprint is worth it; a dropped tool is tinted to its
   * material tier for the same reason.
   */
  private syncItemDrops(): void {
    for (const [id, sprite] of this.toolDropSprites) {
      if (!this.state.toolDrops.some((drop) => drop.id === id)) {
        sprite.destroy();
        this.toolDropSprites.delete(id);
      }
    }
    for (const drop of this.state.toolDrops) {
      const existing = this.toolDropSprites.get(drop.id);
      if (existing) {
        existing.setPosition(drop.x, drop.y).setDepth(drop.y);
        continue;
      }
      const sprite = this.add.image(drop.x, drop.y, TextureKeys.DropTool)
        .setOrigin(0.5, 0.9)
        .setDepth(drop.y);
      sprite.setTint(TOOL_DROP_TIER_TINTS[toolDefinition(drop.tool.definitionId).tier]);
      this.toolDropSprites.set(drop.id, sprite);
    }
    for (const [id, sprite] of this.blueprintDropSprites) {
      if (!this.state.blueprintDrops.some((drop) => drop.id === id)) {
        sprite.destroy();
        this.blueprintDropSprites.delete(id);
      }
    }
    for (const drop of this.state.blueprintDrops) {
      const existing = this.blueprintDropSprites.get(drop.id);
      if (existing) {
        existing.setPosition(drop.x, drop.y).setDepth(drop.y);
        continue;
      }
      const sprite = this.add.image(drop.x, drop.y, TextureKeys.DropSafeguardCharm)
        .setOrigin(0.5, 0.9)
        .setDepth(drop.y);
      const quality = blueprintQuality(drop.blueprintId);
      sprite.setTint(Number.parseInt(BLUEPRINT_QUALITY_COLORS[quality].slice(1), 16));
      this.blueprintDropSprites.set(drop.id, sprite);
    }
  }

  private syncGroundDrops(): void {
    this.entityActivationDirty = true;
    for (const [id, sprite] of this.dropSprites) {
      if (!this.state.groundDrops.some((drop) => drop.id === id)) {
        sprite.destroy();
        this.dropSprites.delete(id);
        this.dropChunks.delete(id);
        this.activeDropIds.delete(id);
        this.dropsById.delete(id);
      }
    }
    for (const drop of this.state.groundDrops) {
      this.dropsById.set(drop.id, drop);
      const existing = this.dropSprites.get(drop.id);
      if (existing) {
        existing.setPosition(drop.x, drop.y).setDepth(drop.y);
        this.dropChunks.upsert(drop.id, drop.x, drop.y);
        continue;
      }
      const key = DROP_TEXTURE_KEYS[drop.resource];
      const sprite = this.add.image(drop.x, drop.y, key)
        .setOrigin(0.5, 0.9)
        .setDepth(drop.y)
        .setActive(false)
        .setVisible(false);
      this.dropSprites.set(drop.id, sprite);
      this.dropChunks.upsert(drop.id, drop.x, drop.y);
    }
  }

  /**
   * Draw the current area's containers. An opened one keeps its sprite at
   * reduced alpha rather than vanishing, so a player can read at a glance which
   * caches in a region they have already cleared.
   */
  private syncContainers(): void {
    for (const [id, sprite] of this.containerSprites) {
      if (!this.state.containers.some((container) => container.id === id)) {
        sprite.destroy();
        this.containerSprites.delete(id);
      }
    }
    for (const container of this.state.containers) {
      const existing = this.containerSprites.get(container.id);
      if (existing) {
        existing.setAlpha(container.opened ? OPENED_CONTAINER_ALPHA : 1);
        continue;
      }
      const sprite = this.add.image(container.x, container.y, CONTAINER_TEXTURE_KEYS[container.kind])
        .setOrigin(0.5, 0.85)
        .setDepth(container.y)
        .setAlpha(container.opened ? OPENED_CONTAINER_ALPHA : 1);
      this.containerSprites.set(container.id, sprite);
    }
  }

  private syncFollowerCreatures(): void {
    const placements = followerCreaturePlacements(this.state);
    const assistance = this.get3DPresentationState().gatherAssistance;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [id, sprite] of this.followerCreatureSprites) {
      if (placements.some((placement) => placement.id === id)) continue;
      sprite.destroy();
      this.followerCreatureSprites.delete(id);
    }
    for (const placement of placements) {
      let sprite = this.followerCreatureSprites.get(placement.id);
      if (!sprite) {
        sprite = this.add.sprite(placement.x, placement.y, creatureTextureKey(placement.speciesId)).setOrigin(0.5, 0.875);
        if (placement.speciesId === 'tuftle') sprite.play(AnimationKeys.TuftleIdle);
        this.followerCreatureSprites.set(placement.id, sprite);
      }
      sprite.setPosition(placement.x, placement.y - followerAssistanceLift(placement.id, assistance, reducedMotion) * TILE_SIZE)
        .setDepth(placement.y).setVisible(!this.interiorSession.isActive && !this.state.activeEncounter);
    }
  }

  private syncWildCreatures(): void {
    this.entityActivationDirty = true;
    for (const [id, sprite] of this.creatureSprites) {
      if (!this.state.wildCreatures.some((creature) => creature.id === id)) {
        sprite.destroy();
        this.creatureSprites.delete(id);
        this.creatureChunks.delete(id);
        this.activeCreatureIds.delete(id);
        this.creaturesById.delete(id);
      }
    }
    for (const creature of this.state.wildCreatures) {
      this.creaturesById.set(creature.id, creature);
      const existing = this.creatureSprites.get(creature.id);
      if (existing) {
        existing.setPosition(creature.x, creature.y).setDepth(creature.y);
        this.creatureChunks.upsert(creature.id, creature.x, creature.y);
        continue;
      }
      const sprite = this.add.sprite(creature.x, creature.y, creatureTextureKey(creature.speciesId))
        .setOrigin(0.5, 0.875)
        .setDepth(creature.y)
        .setActive(false)
        .setVisible(false);
      if (creature.speciesId === 'tuftle') sprite.play(AnimationKeys.TuftleIdle);
      if (creature.speciesId === 'craghopper') sprite.play(AnimationKeys.CraghopperIdle);
      if (creature.speciesId === 'glade-stag') sprite.play(AnimationKeys.GladeStagIdle);
      this.creatureSprites.set(creature.id, sprite);
      this.creatureChunks.upsert(creature.id, creature.x, creature.y);
    }
  }

  /**
   * Follow moving creatures each frame.
   *
   * `syncWildCreatures` only runs when the roster changes, which was fine while
   * a creature stood on its spawn point for its whole life. Now that they wander
   * and chase, a sprite left at its last synced position meant the world
   * simulated movement no player ever saw — a creature could bite from the far
   * side of the screen. Deliberately narrower than the full sync: no creation,
   * no destruction, just the pose and the chunk index for the handful of
   * creatures an area holds.
   */
  private syncWildCreaturePositions(): void {
    for (const creature of this.state.wildCreatures) {
      const sprite = this.creatureSprites.get(creature.id);
      if (!sprite || sprite.x === creature.x && sprite.y === creature.y) continue;
      // Facing follows travel, so an ambling creature does not moonwalk across
      // its patch. Vertical-only movement leaves the last horizontal facing.
      if (creature.x !== sprite.x) sprite.setFlipX(creature.x < sprite.x);
      // Reindexed only on a chunk crossing. Marking activation dirty on every
      // pixel of movement would rerun the whole-world activation pass each
      // frame for the sake of six creatures.
      const crossedChunk = entityChunkKey(sprite.x, sprite.y) !== entityChunkKey(creature.x, creature.y);
      sprite.setPosition(creature.x, creature.y).setDepth(creature.y);
      if (crossedChunk) {
        this.creatureChunks.upsert(creature.id, creature.x, creature.y);
        this.entityActivationDirty = true;
      }
    }
  }

  /**
   * Raiders are few and short-lived — at most one wave, for one minute — so
   * they are drawn directly rather than going through the chunk activation the
   * thousands of static world entities need. They also draw above the danger
   * fog, because a raider you cannot see through the fog is not a fair fight.
   */
  private syncRaiders(): void {
    for (const [id, sprite] of this.raiderSprites) {
      if (!this.state.raiders.some((raider) => raider.id === id)) {
        sprite.destroy();
        this.raiderSprites.delete(id);
      }
    }
    for (const raider of this.state.raiders) {
      const existing = this.raiderSprites.get(raider.id);
      if (existing) {
        existing.setPosition(raider.x, raider.y).setDepth(OVERLAY_DEPTH - 1 + raider.y / WORLD_PX);
        continue;
      }
      this.raiderSprites.set(raider.id, this.add
        .image(raider.x, raider.y, raiderTextureKey(raider.kindId))
        .setOrigin(0.5, 0.875)
        .setDepth(OVERLAY_DEPTH - 1 + raider.y / WORLD_PX));
    }
  }

  /**
   * The "Lv N" plate over every wild creature and raider.
   *
   * Levels are the one thing about an enemy a player has to know before they
   * commit — health bars only appear once the fight has started, by which point
   * the decision is made. So the plate is drawn for everything hostile-capable,
   * not just for what is currently angry.
   *
   * Runs every frame over the few dozen entities an area holds, because both
   * populations move: a creature that ambles away from its plate would be worse
   * than no plate at all.
   */
  private syncLevelPlates(): void {
    const live = new Set<string>();
    for (const creature of this.state.wildCreatures) {
      const sprite = this.creatureSprites.get(creature.id);
      // Chunk activation decides whether a creature is drawn at all; the plate
      // follows that decision rather than making its own.
      if (!sprite?.visible) continue;
      live.add(creature.id);
      this.positionLevelPlate(creature.id, creature.level, creature.x, creature.y, creature.y + 1);
    }
    for (const raider of this.state.raiders) {
      live.add(raider.id);
      this.positionLevelPlate(
        raider.id,
        raider.level,
        raider.x,
        raider.y,
        OVERLAY_DEPTH - 1 + raider.y / WORLD_PX + 0.001,
      );
    }
    for (const [id, plate] of this.levelPlates) {
      if (live.has(id)) continue;
      plate.destroy();
      this.levelPlates.delete(id);
    }
  }

  private positionLevelPlate(id: string, level: number, x: number, y: number, depth: number): void {
    let plate = this.levelPlates.get(id);
    if (!plate) {
      plate = this.add.text(x, y, `Lv ${level}`, {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '10px',
        color: '#f5ecd6',
        backgroundColor: 'rgba(11, 18, 14, 0.72)',
        padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1);
      plate.name = `level-plate-${id}`;
      this.levelPlates.set(id, plate);
    } else if (plate.text !== `Lv ${level}`) {
      plate.setText(`Lv ${level}`);
    }
    // Above the sprite's head: sprites use a 0.875 origin, so their art rises
    // roughly a tile and a half above the anchor point.
    plate.setPosition(x, y - TILE_SIZE * 2).setDepth(depth);
  }

  /**
   * Creatures set to Work amble around the facility they staff. Like raiders
   * these are a handful of sprites that move every frame, so they skip chunk
   * activation; unlike raiders they are pure presentation — the wander path is
   * derived from the creature id and the clock, never from simulation state.
   */
  private syncWorkerCreatures(time: number): void {
    const placements = workerCreaturePlacements(this.state);
    for (const [id, sprite] of this.workerCreatureSprites) {
      if (!placements.some((placement) => placement.id === id)) {
        sprite.destroy();
        this.workerCreatureSprites.delete(id);
      }
    }
    for (const placement of placements) {
      const pose = workerCreaturePose(placement, time);
      let sprite = this.workerCreatureSprites.get(placement.id);
      if (!sprite) {
        sprite = this.add.sprite(pose.x, pose.y, creatureTextureKey(placement.speciesId)).setOrigin(0.5, 0.875);
        if (placement.speciesId === 'tuftle') sprite.play(AnimationKeys.TuftleIdle);
        if (placement.speciesId === 'craghopper') sprite.play(AnimationKeys.CraghopperIdle);
        if (placement.speciesId === 'glade-stag') sprite.play(AnimationKeys.GladeStagIdle);
        this.workerCreatureSprites.set(placement.id, sprite);
      }
      // Facing only changes while it is actually walking, so a dawdling worker
      // does not flip back and forth on the spot.
      if (pose.dirX !== 0) sprite.setFlipX(pose.dirX < 0);
      sprite.setPosition(pose.x, pose.y).setDepth(pose.y);
    }
  }

  private performTurretAmmo(result: CommandResult): void {
    this.hud.showFeedback(result.message, !result.ok);
    if (!result.ok) return;
    this.buildMode.syncPlaced(); // an emptied turret swaps to its dry texture
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  /** Raider whose sprite is under the pointer, nearest hit-box wins. */
  private raiderAtWorld(worldX: number, worldY: number): RaiderState | null {
    let best: RaiderState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const raider of this.state.raiders) {
      const sprite = this.raiderSprites.get(raider.id);
      if (!sprite) continue;
      const bounds = sprite.getBounds();
      if (
        worldX < bounds.x - 4 || worldX > bounds.right + 4 ||
        worldY < bounds.y - 4 || worldY > bounds.bottom + 4
      ) continue;
      const distance = Math.hypot(bounds.centerX - worldX, bounds.centerY - worldY);
      if (distance < bestDistance) {
        best = raider;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Shoot a raider. Deliberately separate from performEncounterStartOn: a raid
   * is real-time, and clicking a raider must never open the turn-based panel.
   */
  private performPlayerShot(raiderId?: string): void {
    // Health before the swing, so damage can be derived here rather than made
    // part of the simulation's return contract. Either command can pick its own
    // target when none is named, so every raider is snapshotted.
    const before = new Map(this.state.raiders.map((raider) => [raider.id, raider.hp]));

    // The bow stays the primary answer whenever it can actually fire — it hits
    // far harder than an axe used as a club. Melee is the fallback for the
    // player caught with no bow, no arrows, or a raider already on top of them.
    let style: StrikeStyle = 'ranged';
    let result = firePlayerShot(this.state, raiderId);
    if (!result.ok) {
      const swing = strikeRaiderMelee(this.state, raiderId);
      if (swing.ok) {
        style = 'melee';
        result = swing;
      } else {
        // Both refused. The melee complaint is the useful one only when the
        // raider is close enough to swing at; otherwise the shot explains why —
        // except when the shot had nothing to aim at, which needs no complaint.
        // Pressing the action with empty ground ahead is how the player checks
        // that nothing is there, and a toast for it would fire on every press
        // and on every frame of a held button.
        const target = nearestRaiderInRange(this.state, strikeReachPx(this.state));
        if (target) this.hud.showFeedback(swing.message, true);
        else if (result.message !== NO_SHOT_TARGET_MESSAGE) this.hud.showFeedback(result.message, true);
        return;
      }
    }

    this.hud.showFeedback(result.message, false);
    // The lock follows whatever was actually struck, exactly as the resource
    // path does. Without this a hostile engaged from the action button — rather
    // than by tapping its sprite — would never light up or name itself.
    if (result.raiderId && !result.killed) this.stickyTarget = { kind: 'raider', id: result.raiderId };
    // Reported before syncRaiders, which destroys a killed raider's sprite and
    // would leave the hit-stop with nothing to shake.
    this.reportRaiderHit(result.raiderId, before, style);
    this.syncRaiders();
    this.syncGroundDrops();
    this.syncItemDrops();
    this.refreshHudNow();
  }

  /**
   * Keep firing while the action input is held down.
   *
   * The bow was never gated on standing still, but every arrow needed its own
   * press — which at a walk meant stopping, tapping, and setting off again,
   * because a press that lands inside the shot cooldown is silently eaten. A
   * held press repeats on the shot's own cadence instead, so the player can
   * hold a direction and the action together and keep hitting while moving.
   *
   * Gathering repeats too: chopping a tree down took a tap per swing, which is
   * the same stop-and-tap rhythm for no gain, since a node stands still and the
   * player already committed to felling it by holding the button. Melee still
   * stays one swing per press.
   */
  private updateSustainedFire(): void {
    if (!this.actionInputHeld()) return;
    if (this.state.activeEncounter || !this.interiorSession.allowsWorldInteraction) return;
    if (this.buildMode.placing || this.buildMode.deleteMode || this.interiorSession.ownsOverlayInput) return;
    // Repeating before the cooldown clears would replace the hit message with
    // "Not ready yet" on every frame and nothing else.
    if (this.state.tick < this.state.actionCooldownUntilTick) return;
    // Bow only, and only with arrows: without this the repeat would quietly
    // fall through performPlayerShot's melee branch and swing a held tool.
    const bow = this.state.tools.find((tool) => tool.instanceId === this.state.equippedToolId);
    if (bow && gameToolDefinition(this.state, bow.definitionId).kind === 'bow') {
      if (this.state.inventory.arrow <= 0) return;
      const target = this.sustainedFireTarget();
      if (!target) return;
      if (target.kind === 'raider') this.performPlayerShot(target.id);
      else this.performCreatureAttack(target.id);
      return;
    }

    // The held swing runs the whole context action rather than gathering
    // directly, so a repeat animates, reports, and locks on exactly like the
    // first press. `sustainedGatherNode` is what keeps that safe: it only says
    // yes when the press would land on a resource node, so holding the button
    // never re-opens a door or a container behind it.
    if (this.sustainedGatherNode()) this.performContextAction();
  }

  /**
   * The node a held button keeps hitting, or null when the press would resolve
   * to anything else.
   *
   * This mirrors the branches `performContextAction` walks before it reaches
   * the node strike. Everything that outranks gathering is one-shot or a fight
   * the player picks deliberately — a door, a container, a ready harvest, a
   * raider, a locked or hostile creature — and none of those should fire again
   * just because a thumb stayed down.
   */
  private sustainedGatherNode(): ResourceNodeState | null {
    if (equippedBow(this.state)) return null;
    if (nearestRaiderInRange(this.state)) return null;
    if (this.stickyTarget?.kind === 'raider'
      && this.state.raiders.some((raider) => raider.id === this.stickyTarget!.id)) return null;
    if (this.stickyTarget?.kind === 'creature'
      && this.state.wildCreatures.some((creature) => creature.id === this.stickyTarget!.id)) return null;
    if (nearestHuntableCreature(this.state, this.playerEngageRangePx())) return null;
    if (nearestTownBuildingDoor(this.state)) return null;
    if (nearestUnopenedContainer(this.state)) return null;
    const nearby = this.findNearbyTargets();
    if ((nearby.bed?.garden?.readyFiber ?? 0) > 0) return null;
    if ((nearby.planter?.woodlot?.readyWood ?? 0) > 0) return null;
    return nearby.node;
  }

  /**
   * What a held trigger keeps firing at: the locked target while it stays in
   * bow range, else the nearest raider, else the nearest hostile creature.
   *
   * Raiders come first because they are the ones shooting back. A creature is
   * only auto-acquired when it is already hostile — holding the trigger while
   * walking past a herd must not empty the quiver into it.
   */
  private sustainedFireTarget(): CombatTarget | null {
    const rangePx = playerShotRangePx(this.state);
    const inRange = (entity: { x: number; y: number }): boolean =>
      Math.hypot(entity.x - this.state.player.x, entity.y - this.state.player.y) <= rangePx;

    if (this.stickyTarget?.kind === 'raider') {
      const locked = this.state.raiders.find((raider) => raider.id === this.stickyTarget!.id);
      if (locked && inRange(locked)) return { kind: 'raider', id: locked.id };
    } else if (this.stickyTarget?.kind === 'creature') {
      const locked = this.state.wildCreatures.find((creature) => creature.id === this.stickyTarget!.id);
      if (locked && locked.hp > 0 && inRange(locked)) return { kind: 'creature', id: locked.id };
    }

    const raider = nearestRaiderInRange(this.state);
    if (raider) return { kind: 'raider', id: raider.id };
    const creature = nearestHuntableCreature(this.state, rangePx);
    return creature ? { kind: 'creature', id: creature.id } : null;
  }

  /** Action held on any input: the thumb button, E, or Space. */
  private actionInputHeld(): boolean {
    return this.hud.actionPressed || this.actionKey?.isDown === true || this.altActionKey?.isDown === true;
  }

  /** Float a damage number and refresh the health bar for a struck node. */
  private reportNodeHit(node: ResourceNodeState, previousHp: number): void {
    const damage = Math.max(0, previousHp - node.hp);
    if (damage <= 0) return;
    this.combatOverlay.reportHit(node.id, node.x, node.y, node.hp, node.maxHp, damage, 'melee', 'hit');
    const sprite = this.resourceSprites.get(node.id);
    if (sprite) this.combatOverlay.playHitStop(sprite);
  }

  /** Float a damage number and refresh the health bar for a struck raider. */
  private reportRaiderHit(
    raiderId: string | undefined,
    before: ReadonlyMap<string, number>,
    style: StrikeStyle,
  ): void {
    if (!raiderId) return;
    const previous = before.get(raiderId);
    if (previous === undefined) return;
    const raider = this.state.raiders.find((candidate) => candidate.id === raiderId);
    const sprite = this.raiderSprites.get(raiderId);
    // A killed raider is already out of state, so its remaining health is zero
    // and its last known position is the sprite still standing on screen.
    const hp = raider?.hp ?? 0;
    const maxHp = raider?.maxHp ?? Math.max(1, previous);
    const x = raider?.x ?? sprite?.x ?? this.state.player.x;
    const y = raider?.y ?? sprite?.y ?? this.state.player.y;
    const damage = Math.max(0, previous - hp);
    if (damage <= 0) return;
    this.playerActionVisual={kind:style,startedAt:this.time.now,x,y};
    this.combatOverlay.reportHit(raiderId, x, y, hp, maxHp, damage, style, 'hit');
    if (sprite) this.combatOverlay.playHitStop(sprite);
  }

  private syncBuildingQueryIndex(): void {
    this.buildingChunks.clear();
    this.buildingsById.clear();
    for (const building of this.state.buildings) {
      const dimensions = effectiveBuildingDimensions(building);
      const centerX = (building.tileX + dimensions.tilesWide / 2) * TILE_SIZE;
      const centerY = (building.tileY + dimensions.tilesHigh / 2) * TILE_SIZE;
      this.buildingChunks.upsert(building.id, centerX, centerY);
      this.buildingsById.set(building.id, building);
    }
    this.entityActivationDirty = true;
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_PX, WORLD_PX);
    cam.setRoundPixels(true);
    this.cameraTarget = this.add.zone(this.state.player.x, this.state.player.y, 1, 1).setVisible(false);
    // The target receives the interpolated render pose. Full-strength follow
    // avoids adding a second, frame-rate-dependent smoothing layer.
    cam.startFollow(this.cameraTarget, true, 1, 1);
  }

  private renderPlayerPose(alpha: number): void {
    const position = interpolateRenderPoint(
      { x: this.previousPlayerX, y: this.previousPlayerY },
      this.state.player,
      alpha,
    );
    const boating = (this.state.player.traversalMode ?? 'foot') === 'boat';
    const mounted = this.mount !== null && !boating;
    const depths = mountedActorDepths(position.y);
    const mountTransform = mountTransformForFacing(this.state.player.facing);
    this.mount
      ?.setVisible(!boating)
      ?.setPosition(position.x, position.y)
      .setDepth(depths.mount)
      .setAngle(mountTransform.angle)
      .setFlipX(mountTransform.flipX);
    this.boatHull
      .setVisible(boating)
      .setPosition(position.x, position.y + 2)
      .setDepth(position.y - 0.5)
      .setAngle(this.state.player.facing === 'left' || this.state.player.facing === 'right' ? 90 : 0);
    this.player.setPosition(position.x, position.y - (mounted ? 4 : boating ? 3 : 0));
    this.player.setDepth(mounted ? depths.player : position.y);
    this.cameraTarget?.setPosition(position.x, position.y);
    this.syncPlayerAnimation();
    this.syncBuildingOcclusion();
  }

  private syncPlayerAnimation(): void {
    if (this.time.now < this.gatheringUntil) return;
    const moving = this.gridMovement.moving;
    this.facing = this.state.player.facing;
    this.player.setFlipX(this.facing === 'left');
    const key = playerAnimationKey(this.facing, moving);
    if (this.player.anims.currentAnim?.key !== key) this.player.play(key);
  }

  private syncBuildingOcclusion(): void {
    for (const building of townBuildingsInArea(this.state.currentArea.key)) {
      const sprite = this.townBuildingSprites.get(building.id);
      if (!sprite) continue;
      const left = building.footprint.tileX * TILE_SIZE;
      const right = (building.footprint.tileX + building.footprint.tilesWide) * TILE_SIZE;
      const top = (building.footprint.tileY + 2) * TILE_SIZE;
      const bottom = (building.footprint.tileY + building.footprint.tilesHigh) * TILE_SIZE + 10;
      const behindFacade = this.state.player.x >= left && this.state.player.x <= right
        && this.state.player.y >= top && this.state.player.y <= bottom;
      sprite.setAlpha(behindFacade ? 0.42 : 1);
      for (const prop of this.townPropSprites.get(building.id) ?? []) prop.setAlpha(behindFacade ? 0.42 : 1);
    }
  }

  /** Prevent interpolation across teleports, admin edits, and door exits. */
  private snapRenderPoseToState(): void {
    resetGridMovement(this.gridMovement);
    this.previousPlayerX = this.state.player.x;
    this.previousPlayerY = this.state.player.y;
    this.renderPlayerPose(1);
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        up: kb.addKey(K.W),
        down: kb.addKey(K.S),
        left: kb.addKey(K.A),
        right: kb.addKey(K.D),
        slow: kb.addKey(K.SHIFT),
      };
      this.altKeys = {
        up: kb.addKey(K.UP),
        down: kb.addKey(K.DOWN),
        left: kb.addKey(K.LEFT),
        right: kb.addKey(K.RIGHT),
        slow: kb.addKey(K.SHIFT),
      };
      this.actionKey = kb.addKey(K.E);
      this.altActionKey = kb.addKey(K.SPACE);
      this.craftKey = kb.addKey(K.C);
      this.buildKey = kb.addKey(K.B);
      this.inventoryKey = kb.addKey(K.I);
      const digits = [K.ONE, K.TWO, K.THREE, K.FOUR, K.FIVE];
      this.hotbarKeys = digits.slice(0, HOTBAR_SLOTS).map((code) => kb.addKey(code));
      this.bareHandsKey = kb.addKey(K.ZERO);
      this.cancelKey = kb.addKey(K.ESC);
      this.confirmKey = kb.addKey(K.ENTER);
      this.rotateKey = kb.addKey(K.R);

      // Shortcuts are event-driven so a quick tap cannot begin and end
      // between two render frames. Movement stays polled.
      this.actionKey.on('down', this.onActionShortcut);
      this.altActionKey.on('down', this.onActionShortcut);
      this.craftKey.on('down', this.onCraftShortcut);
      this.buildKey.on('down', this.onBuildShortcut);
      this.inventoryKey.on('down', this.onInventoryShortcut);
      this.cancelKey.on('down', this.onCancelShortcut);
      this.confirmKey.on('down', this.onConfirmShortcut);
      this.rotateKey.on('down', this.onRotateShortcut);
      this.hotbarKeys.forEach((key, slot) => key.on('down', this.hotbarShortcutHandlers[slot]!));
      this.bareHandsKey.on('down', this.onBareHandsShortcut);
    }

    const parent = document.getElementById('app') ?? document.body;
    // Taps inside the movement zone keep working as the context action; the
    // zone otherwise sits over the canvas and would swallow them.
    this.joystick = new TouchJoystick(parent, {
      onTap: () => {
        if (this.state.pendingRespawn || this.buildMode.placing || this.buildMode.deleteMode) return;
        if (!this.interiorSession.ownsOverlayInput) this.performInteractAction();
      },
      // The d-pad nudges whatever the tap is aiming: the placement ghost while
      // building, the character otherwise. Dragging off it still walks.
      onStep: (dx, dy) => {
        if (this.state.pendingRespawn) return;
        if (this.buildMode.placing) this.buildMode.stepGhost(dx, dy);
        // Delete mode aims the same way: the arrows hop the red cursor between
        // placed parts, and Delete is the only thing that takes one down.
        else if (this.buildMode.deleteMode) this.buildMode.stepDeleteSelection(dx, dy);
        else this.queueStep(dx, dy);
      },
    });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerAction);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp);
  }

  private onPointerAction = (pointer: Phaser.Input.Pointer): void => {
    if (this.state.pendingRespawn || !this.interiorSession.allowsWorldInteraction) return;
    if (this.is3DPresentation()) return;
    if (this.buildMode.placing) {
      this.buildMode.handlePointerDown(pointer);
      return;
    }
    if (this.buildMode.aimDeleteAtWorld(pointer.worldX, pointer.worldY)) return;
    if (!pointer.leftButtonDown()) return;
    if (this.buildMode.beginBuildingPress(pointer)) return;
    this.buildingItemMenu.close();
    this.performWorldAction(pointer.worldX, pointer.worldY, clientPointOf(pointer));
  };

  /** World coordinates resolved against the visible Three.js ground plane. */
  handle3DWorldPointer(
    worldX: number,
    worldY: number,
    intent: 'tap' | 'long-press' | 'hover' | 'paint-start' | 'paint-move' | 'paint-end',
    clientX: number,
    clientY: number,
  ): void {
    if (this.state.pendingRespawn || !this.is3DPresentation() || !this.interiorSession.allowsWorldInteraction) return;
    if (intent === 'hover') {
      if (this.buildMode.placing) this.buildMode.handleWorldPointerMove(worldX, worldY);
      return;
    }
    if (intent === 'paint-start') {
      if (this.buildMode.placing) this.buildMode.handleWorldPointerDown(worldX, worldY, 0);
      return;
    }
    if (intent === 'paint-move') {
      if (this.buildMode.placing) this.buildMode.handleWorldPointerMove(worldX, worldY, 0);
      return;
    }
    // Releasing a drag leaves the ghost where it was aimed; nothing to commit.
    if (intent === 'paint-end') return;
    if (intent === 'long-press') {
      if (!this.buildMode.placing) this.buildMode.openBuildingAtWorld(worldX, worldY, clientX, clientY);
      return;
    }
    if (this.buildMode.placing) {
      this.buildMode.handleWorldPointerDown(worldX, worldY, 0);
      return;
    }
    if (this.buildMode.aimDeleteAtWorld(worldX, worldY)) return;
    this.buildingItemMenu.close();
    this.performWorldAction(worldX, worldY, { x: clientX, y: clientY });
  }

  private onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.buildMode.handlePointerMove(pointer);
  };

  private onPointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (this.state.pendingRespawn) return;
    // A ghost (or a delete cursor) is only ever aimed by the pointer, so a
    // release has nothing left to do.
    if (this.buildMode.placing || this.buildMode.deleteMode) return;
    // A short press over a building resolves here (a long press already opened
    // the item menu), so a tap on a facility routes through the same world
    // action as a tap on empty ground or a creature.
    if (this.buildMode.finishBuildingPress(pointer)) {
      this.performWorldAction(pointer.worldX, pointer.worldY, clientPointOf(pointer));
    }
  };

  /** E, Space, and the Gather button confirm an active placement ghost. */
  private performInteractAction(): void {
    if (this.openingPanel.isOpen) return;
    if (this.interiorSession.mode.kind === 'interior' && this.interiorSession.allowsLocalMovement) {
      this.performInteriorAction();
      return;
    }
    if (!this.interiorSession.allowsWorldInteraction) return;
    if (this.buildMode.placing) {
      this.buildMode.confirm();
      return;
    }
    // Delete is deliberately not on the context button: demolishing is only
    // ever the Delete control, never the same press that gathers.
    if (this.buildMode.deleteMode) return;
    this.performContextAction();
  }

  /**
   * Route a world click by what it lands on. Clicking a creature or a facility
   * targets that specific entity — so competing nearby targets never share one
   * button — while a click on empty ground (or a resource) falls back to the
   * nearest-target context action.
   */
  private performWorldAction(worldX: number, worldY: number, client?: { x: number; y: number }): void {
    if (this.openingPanel.isOpen) return;
    if (this.state.activeEncounter || !this.interiorSession.allowsWorldInteraction) return;
    // Raiders are checked before wild creatures: during a raid they are drawn
    // on top, and a click on one must shoot rather than start an encounter.
    const raider = this.raiderAtWorld(worldX, worldY);
    if (raider) {
      // Tapping a raider both locks it and fires: the first tap should never
      // feel like it did nothing, and every later press of the action button
      // then goes to the raider the player picked.
      this.stickyTarget = { kind: 'raider', id: raider.id };
      this.performPlayerShot(raider.id);
      return;
    }
    const townBuilding = this.townBuildingAtWorld(worldX, worldY);
    if (townBuilding) {
      if (nearestTownBuildingDoor(this.state)?.id === townBuilding.id) this.enterTownBuilding(townBuilding);
      else this.hud.showFeedback(`Move closer to the ${townBuilding.displayName} door`, false);
      return;
    }
    const creature = this.creatureAtWorld(worldX, worldY);
    if (creature) {
      if (isOpeningTuftle(this.state, creature.id)) { this.performOpeningTrust(); return; }
      // Every creature answers a tap the same way a raider does: locked, then
      // hit with whatever is in hand. Temperament decides whether something
      // fights back, never whether the player is allowed to swing at it.
      // Taming is no longer what a tap means — a snare throw is (see
      // performSnareThrow), which is why a grazing Tuftle can be tapped without
      // that being a promise to keep it.
      this.stickyTarget = { kind: 'creature', id: creature.id };
      this.performCreatureAttack(creature.id);
      return;
    }
    // The town's bench answers a tap exactly as a player's own workbench does.
    // It is town content rather than a placed building, so it is hit-tested by
    // footprint here instead of coming back from buildingAtWorld.
    if (elarisPublicWorkbenchContains(worldX, worldY)) {
      const townBench = elarisPublicWorkbenchFacility(this.state);
      if (townBench) {
        this.openFacilityInteraction(townBench);
        return;
      }
    }
    const building = this.buildMode.buildingAtWorld(worldX, worldY);
    if (building && FACILITY_PANEL_DEFINITIONS.has(building.definitionId)) {
      this.openFacilityInteraction(building);
      return;
    }
    // Clicking a damaged wall offers the repair without needing the long-press
    // menu. An intact wall stays inert and falls through to the context action.
    if (building && client && isStructureDamaged(building)) {
      this.openBuildingItemMenu(building, client.x, client.y);
      return;
    }
    // A tap on a resource locks it, so the action button keeps hitting the tree
    // the player chose even when a closer one comes into range. A tap on bare
    // ground is the deliberate way to let go of a lock.
    const node = this.resourceAtWorld(worldX, worldY);
    this.stickyTarget = node ? { kind: 'resource', id: node.id } : null;
    this.performContextAction();
  }

  /** Resource node whose sprite is under the pointer, nearest hit-box wins. */
  private resourceAtWorld(worldX: number, worldY: number): ResourceNodeState | null {
    let best: ResourceNodeState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const id of this.activeResourceIds) {
      const sprite = this.resourceSprites.get(id);
      if (!sprite?.visible) continue;
      const node = this.resourceNodesById.get(id);
      if (!node || node.hp <= 0) continue;
      const bounds = sprite.getBounds();
      if (
        worldX < bounds.x - 4 || worldX > bounds.right + 4 ||
        worldY < bounds.y - 4 || worldY > bounds.bottom + 4
      ) continue;
      const distance = Math.hypot(bounds.centerX - worldX, bounds.centerY - worldY);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Wild creature whose sprite is under the pointer, nearest hit-box wins. */
  private creatureAtWorld(worldX: number, worldY: number): WildCreatureState | null {
    let best: WildCreatureState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const id of this.activeCreatureIds) {
      const sprite = this.creatureSprites.get(id);
      if (!sprite?.visible) continue;
      const bounds = sprite.getBounds();
      if (
        worldX < bounds.x - 4 || worldX > bounds.right + 4 ||
        worldY < bounds.y - 4 || worldY > bounds.bottom + 4
      ) continue;
      const distance = Math.hypot(bounds.centerX - worldX, bounds.centerY - worldY);
      if (distance < bestDistance) {
        best = this.creaturesById.get(id) ?? null;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Open a clicked facility's panel when the player is close enough to use it. */
  private openFacilityInteraction(building: BuildingState): void {
    const inRange = nearestUsableFacility(this.state, FACILITY_INTERACTION_RANGE_PX, [building]);
    if (!inRange) {
      this.hud.showFeedback(`Move closer to the ${buildableById(building.definitionId).displayName}`, false);
      return;
    }
    this.buildMenu.close();
    this.inventoryPanel.close();
    this.hud.openFacility(building);
  }

  /** Close the open facility panel once the player walks out of usable range. */
  private syncFacilityInteraction(): void {
    const openId = this.hud.getOpenFacilityId();
    if (!openId) return;
    const building = isElarisPublicWorkbenchId(openId)
      ? elarisPublicWorkbenchFacility(this.state)
      : this.buildingsById.get(openId);
    const stillUsable = building
      ? nearestUsableFacility(this.state, FACILITY_INTERACTION_RANGE_PX, [building])
      : null;
    if (!stillUsable) this.hud.closeFacility();
  }

  /**
   * Context action, in deterministic priority: harvest a ready Garden Bed,
   * gather the nearest live node, pick up a nearby drop, else report the
   * nearby bed's growing/blocked/suspended status.
   */
  private performContextAction(): void {
    if (this.openingPanel.isOpen) return;
    if (nearbyOpeningTuftle(this.state)) { this.performOpeningTrust(); return; }
    if (this.state.activeEncounter || !this.interiorSession.allowsWorldInteraction) return;
    const inventoryBefore = { ...this.state.inventory };
    // A raider in range outranks every peacetime action: during the danger
    // minute the action button is the player's weapon, not their sickle.
    if (nearestRaiderInRange(this.state)) {
      this.performPlayerShot();
      return;
    }
    // A lock the player walked out of bow range of says so, rather than letting
    // the press fall through to "Move closer to a resource" — the button is
    // still labelled with that raider, and the two must agree.
    if (this.stickyTarget?.kind === 'raider' && this.state.raiders.some((raider) => raider.id === this.stickyTarget!.id)) {
      this.hud.showFeedback('Too far to shoot — move closer', false);
      return;
    }
    // A creature the player deliberately locked keeps the button, in range or
    // not — the label already names it, and silently gathering a bush instead
    // would contradict what the button says it will do.
    if (this.stickyTarget?.kind === 'creature'
      && this.state.wildCreatures.some((creature) => creature.id === this.stickyTarget!.id)) {
      this.performCreatureAttack(this.stickyTarget.id);
      return;
    }
    // A creature that is already hostile outranks peacetime actions for the
    // same reason a raider does: the button is a weapon while something is
    // biting you. Placid creatures are excluded by isHuntable, so walking past
    // a herd with a sword equipped never turns the button into a slaughter —
    // tapping one is still the only way to pick a fight with it.
    if (nearestHuntableCreature(this.state, this.playerEngageRangePx())) {
      this.performCreatureAttack();
      return;
    }
    const door = nearestTownBuildingDoor(this.state);
    if (door) {
      this.enterTownBuilding(door);
      return;
    }
    // A container outranks gathering: it is one-shot and the player walked to
    // it deliberately, so a tree behind it must never eat the press.
    if (nearestUnopenedContainer(this.state)) {
      const opened = openNearestContainer(this.state);
      if (opened.ok) {
        this.syncContainers();
        this.syncGroundDrops();
    this.syncItemDrops();
        this.onCriticalChanged();
      }
      if (opened.ok) this.reportResourceCollection(inventoryBefore);
      this.hud.showFeedback(opened.message, opened.ok);
      this.refreshHudNow();
      return;
    }
    const nearby = this.findNearbyTargets();
    const bed = nearby.bed;
    const bedReady = bed !== null && (bed.garden?.readyFiber ?? 0) > 0;
    const planter = nearby.planter;
    const planterReady = planter !== null && (planter.woodlot?.readyWood ?? 0) > 0;
    const node = nearby.node;

    // With a bow in hand the button is a trigger, which is what its label now
    // says. A bow's damage table has only a raider row, so every branch below
    // this would have spent the press on a swing that cannot chop, mine, or
    // harvest anything. The three things a player walks up to on purpose still
    // outrank it — a ready harvest and a drop underfoot are not misfires — and
    // when nothing is in range the shot explains itself rather than silently
    // falling through to a no-op.
    if (equippedBow(this.state) && !bedReady && !planterReady && !nearby.drop) {
      this.performPlayerShot();
      return;
    }

    let result: CommandResult;
    let wallStruck = false;
    if (bed && bedReady) {
      result = harvestGardenBed(this.state, bed.id);
      if (result.ok) {
        this.buildMode.syncPlaced();
        this.onCriticalChanged();
      }
    } else if (planter && planterReady) {
      result = harvestWoodlotPlanter(this.state, planter.id);
      if (result.ok) {
        this.buildMode.syncPlaced();
        this.onCriticalChanged();
      }
    } else if (node) {
      const previousHp = node.hp;
      result = gatherNearest(this.state);
      if (result.ok) {
        // The lock follows what was actually struck. `gatherNearest` still
        // picks the nearest node on its own, so pointing the ring anywhere
        // else would put a label on the screen that the swing does not honour.
        // Phase 2's targeted strike makes the lock authoritative instead.
        this.stickyTarget = { kind: 'resource', id: node.id };
        this.reportNodeHit(node, previousHp);
      }
    } else {
      result = collectNearestGroundDrop(this.state);
      if (!result.ok && !result.targetId) {
        // A wall is only ever hit deliberately: the player must be facing it
        // within melee reach, and nothing above it in this chain was actionable.
        // It still outranks the bed/planter fallbacks, which are status text.
        const wall = nearestFacedWall(this.state);
        if (wall) {
          const previousWallHp = structureHp(wall, this.state.gameBalance) ?? 0;
          result = attackFacedWall(this.state, wall.id);
          wallStruck = result.ok && result.depleted !== true;
          if (result.ok) this.onWallDamaged(wall, result.depleted === true, previousWallHp);
        } else {
          result = bed
            ? { ok: false, message: describeGardenBed(this.state, bed).message, targetId: bed.id }
            : planter
              ? { ok: false, message: describeWoodlotPlanter(this.state, planter).message, targetId: planter.id }
              : rowboatActionLabel(this.state)
                ? toggleRowboat(this.state)
                : { ...result, message: 'Move closer to a resource' };
        }
      }
    }

    // Resource and wall hits already have world-space animation and an HP bar.
    // Keep the central feedback toast for other interactions, but do not cover
    // play with hit/cooldown messages such as "Not ready yet" while striking.
    if (!wallStruck && !(node && !bedReady && !planterReady)) this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      if (result.critical) this.onCriticalChanged();
      else this.onMoved();
      if (node && !bedReady && result.targetId) {
        this.gatheringUntil = this.time.now + 280;
        this.player.setFlipX(node.x < this.state.player.x);
        this.player.play(AnimationKeys.PlayerGather, true);
        this.spawnGatherEffect(node);
        this.flashNodeHit(result.targetId);
        if (result.depleted) this.onNodeDepleted(result.targetId);
      }
      this.syncGroundDrops();
    this.syncItemDrops();
    }
    if (result.ok) this.reportResourceCollection(inventoryBefore);
    if (result.gatherAssistance && node) {
      const assistance = result.gatherAssistance;
      this.gatherAssistance = { creatureId: assistance.creatureId, x: node.x, y: node.y, startedAt: this.time.now };
      const message = `${assistance.creatureName} helped: +${assistance.bonusUnits} ${assistance.resource}`
        + (assistance.openingCompleted ? ' · Shelter recipes learned: Air Purifier and Storage Box are ready to build.' : '');
      this.hud.showGatherAssistance(message, assistance.openingCompleted);
      this.spawnFloatingText(node.x, node.y, `${assistance.creatureName} +${assistance.bonusUnits}`);
    }
    this.refreshHudNow();
  }

  private enterTownBuilding(building: TownBuildingDefinition): void {
    this.intent = NO_MOVE;
    resetGridMovement(this.interiorGridMovement);
    // A tile move still in flight would walk the doorway pose straight back off
    // the door tile, and with it the shelter the doorway represents.
    resetGridMovement(this.gridMovement);
    this.npcBark.hide();
    this.buildMode.cancel();
    this.buildMenu.close();
    this.inventoryPanel.close();
    this.buildingItemMenu.close();
    const interior = interiorDefinitionById(building.interiorId);
    // The visit is presentation, but being indoors is not: the storm and the
    // raid both read the exterior position, so a visitor stands in the doorway
    // until they leave through it.
    positionPlayerInDoorway(this.state, building);
    this.snapRenderPoseToState();
    this.interiorAudio.enter(interior.ambience.soundscape);
    this.interiorSession.enter(building.id, {
      x: interior.playerSpawn.tileX + 0.5,
      y: interior.playerSpawn.tileY + 0.5,
      facing: interior.playerSpawn.facing,
    });
    if (!this.is3DPresentation()) this.interiorFallback.open(interior);
    this.interiorTransition.enter(
      () => {
        this.interiorSession.completeTransition();
        this.showNpcBark(building.npcId, 'arrival');
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    this.updateInteriorExploration(0);
  }

  private updateInteriorExploration(deltaMs: number): void {
    const buildingId = this.interiorSession.buildingId;
    const pose = this.interiorSession.pose;
    if (!buildingId || !pose) return;
    const interior = interiorDefinitionForBuilding(buildingId);
    if (this.interiorSession.mode.kind === 'interior' && this.interiorSession.allowsLocalMovement && deltaMs > 0) {
      this.interiorSession.updatePose(stepInteriorMovement(
        interior,
        pose,
        this.interiorIntent,
        deltaMs,
        this.interiorGridMovement,
      ));
    }
    const updatedPose = this.interiorSession.pose;
    if (!updatedPose) return;
    if (this.interiorSession.mode.kind === 'interior' && this.interiorSession.allowsLocalMovement) {
      this.interiorSession.focusHotspot(nearestInteriorHotspot(interior, updatedPose)?.id ?? null);
    }
    if (!this.is3DPresentation()) {
      this.interiorFallback.open(interior);
      this.interiorFallback.update(updatedPose, this.interiorSession.focusedHotspotId);
    } else this.interiorFallback.close();
  }

  private performInteriorAction(): void {
    const buildingId = this.interiorSession.buildingId;
    const pose = this.interiorSession.pose;
    if (!buildingId || !pose) return;
    const interior = interiorDefinitionForBuilding(buildingId);
    const hotspot = nearestInteriorHotspot(interior, pose);
    if (!hotspot) {
      this.hud.showFeedback(`Move closer to an interaction point in ${interior.displayName}`, false);
      return;
    }
    if (hotspot.kind === 'exit') {
      this.leavePlayableInterior();
      return;
    }
    if (hotspot.kind === 'examine') {
      this.hud.showFeedback(hotspot.text, true);
      return;
    }
    const building = townBuildingsInArea(this.state.currentArea.key).find((candidate) => candidate.id === buildingId);
    if (!building) return;
    this.openNpcDialogue(hotspot.npcId);
  }

  private openNpcDialogue(npcId: NpcId): void {
    this.interiorSession.beginDialogue(npcId);
    const recentPurchaseService = this.recentNpcPurchase?.npcId === npcId
      ? this.recentNpcPurchase.service
      : undefined;
    const view = this.npcDialogueController.start(
      this.state,
      npcId,
      recentPurchaseService ? { recentPurchaseService } : {},
    );
    if (recentPurchaseService) this.recentNpcPurchase = null;
    this.npcBark.hide();
    this.npcDialogue.open(view);
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  private performDialogueChoice(choiceId: string): void {
    this.handleDialogueResult(this.npcDialogueController.choose(choiceId));
  }

  private handleDialogueResult(result: DialogueChoiceResult): void {
    if (result.kind === 'view') {
      this.npcDialogue.update(result.view);
      this.onCriticalChanged();
      return;
    }
    if (result.kind === 'close') {
      this.closeNpcDialogue();
      return;
    }
    const buildingId = this.interiorSession.buildingId;
    const building = townBuildingsInArea(this.state.currentArea.key).find((candidate) => candidate.id === buildingId);
    if (!building || building.service !== result.service) return;
    this.npcDialogue.close();
    this.npcDialogueController.close();
    this.interiorSession.openService(result.npcId);
    const interior = interiorDefinitionForBuilding(building.id);
    this.npcServiceOverlay.open(building, {
      closeLabel: `Back to ${interior.displayName}`,
      closeAriaLabel: `Return to ${interior.displayName}`,
      closeHint: `Press Escape or choose Back to ${interior.displayName} to continue exploring`,
    });
  }

  private closeNpcDialogue(): void {
    if (this.interiorSession.mode.kind !== 'dialogue') return;
    this.npcDialogue.close();
    this.npcDialogueController.close();
    this.interiorSession.resumeInterior();
    this.refreshHudNow();
  }

  private showNpcBark(npcId: NpcId, kind: 'arrival' | 'nearby' | 'afterService'): void {
    const bark = this.npcBarkController.request(npcId, kind, performance.now());
    if (bark) this.npcBark.show(bark);
  }

  private leavePlayableInterior(): void {
    resetGridMovement(this.interiorGridMovement);
    const buildingId = this.interiorSession.buildingId;
    const building = townBuildingsInArea(this.state.currentArea.key).find((candidate) => candidate.id === buildingId);
    if (!building) {
      this.interiorAudio.leave();
      this.interiorSession.recoverToWorld();
      this.interiorFallback.close();
      return;
    }
    this.interiorAudio.leave();
    this.interiorSession.beginExit();
    this.npcBark.hide();
    this.interiorTransition.exit(() => {
      this.interiorSession.completeTransition();
      this.interiorFallback.close();
      positionPlayerOutsideDoor(this.state, building);
      this.snapRenderPoseToState();
      this.onCriticalChanged();
      this.refreshHudNow();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  private townBuildingAtWorld(worldX: number, worldY: number): TownBuildingDefinition | null {
    return townBuildingsInArea(this.state.currentArea.key).find(({ footprint }) =>
      worldX >= footprint.tileX * TILE_SIZE
      && worldX < (footprint.tileX + footprint.tilesWide) * TILE_SIZE
      && worldY >= footprint.tileY * TILE_SIZE
      && worldY < (footprint.tileY + footprint.tilesHigh) * TILE_SIZE,
    ) ?? null;
  }

  /** Nearest-creature encounter kept for the 3D presentation harness. */
  performEncounterStart(): void {
    this.applyEncounterResult(startNearestEncounter(this.state));
  }

  /**
   * Throw a snare at the locked creature, which is the way into taming now that
   * a tap on a creature is a swing. Deliberately an explicit, separate press:
   * the whole point of the split is that wanting something dead and wanting it
   * alive can never be the same gesture.
   */
  private performSnareThrow(): void {
    // The lock wins when it is close enough to snare; otherwise the creature
    // the player is standing next to does. A swing scatters skittish species,
    // so requiring a lock here would mean the only creatures that could be
    // tamed are the ones that never ran.
    const locked = this.stickyTarget?.kind === 'creature'
      ? this.state.wildCreatures.find((creature) => creature.id === this.stickyTarget!.id) ?? null
      : null;
    const inSnareRange = locked
      && Math.hypot(locked.x - this.state.player.x, locked.y - this.state.player.y) <= TAMING_RANGE_PX;
    const target = inSnareRange ? locked : nearestWildCreature(this.state, TAMING_RANGE_PX);
    if (!target) {
      this.hud.showFeedback('Move closer to a wild creature', false);
      return;
    }
    this.applyEncounterResult(throwSnareAtCreature(this.state, target.id));
  }

  /**
   * Attack a wild creature in the overworld: shoot it if a bow can reach, and
   * swing otherwise. Exactly the order performPlayerShot uses on a raider — the
   * bow hits harder and further, and melee is the answer for the player with no
   * bow, no arrows, or something already on top of them.
   */
  private performOpeningTrust(): void {
    if (this.openingPanel.isOpen || !this.interiorSession.allowsWorldInteraction) return;
    const result = beginOpeningTrust(this.state);
    if (!result.ok) { this.hud.showFeedback(result.message, false); return; }
    this.buildMode.cancel();
    this.buildMenu.close();
    this.inventoryPanel.close();
    this.hud.closeCraft();
    this.hud.closeFacility();
    this.intent = NO_MOVE;
    this.queuedStep = null;
    resetGridMovement(this.gridMovement);
    this.areaSplash?.remove();
    this.areaSplash = null;
    this.openingPanel.openTrust();
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  private performCreatureAttack(creatureId?: string): void {
    if (this.openingPanel.isOpen) return;
    if (creatureId && isOpeningTuftle(this.state, creatureId)) { this.performOpeningTrust(); return; }
    const before = new Map(this.state.wildCreatures.map((creature) => [creature.id, creature.hp]));

    let style: StrikeStyle = 'ranged';
    let result = fireCreatureShot(this.state, creatureId);
    if (!result.ok) {
      const swing = strikeCreatureMelee(this.state, creatureId);
      if (swing.ok) {
        style = 'melee';
        result = swing;
      } else {
        // Both refused. The swing's complaint is the useful one whenever
        // something is close enough to swing at; otherwise the shot explains
        // itself — except when it had nothing to aim at at all, which is an
        // ordinary press over empty ground and deserves no toast.
        const inReach = creatureId
          ? this.state.wildCreatures.some((creature) => creature.id === creatureId)
          : nearestCreatureInRange(this.state, strikeReachPx(this.state)) !== null;
        if (inReach) this.hud.showFeedback(swing.message, true);
        else if (result.message !== NO_SHOT_CREATURE_MESSAGE) this.hud.showFeedback(result.message, true);
        return;
      }
    }
    this.reportCreatureAttack(result, before, style);
  }

  /** Feedback, lock follow-through, and damage numbers for a landed attack. */
  private reportCreatureAttack(
    result: CreatureStrikeResult,
    before: ReadonlyMap<string, number>,
    style: StrikeStyle,
  ): void {
    this.hud.showFeedback(result.message, result.ok);
    if (!result.ok) return;
    const struck=result.creatureId?this.state.wildCreatures.find(creature=>creature.id===result.creatureId)??this.creatureSprites.get(result.creatureId):null;
    if(struck)this.playerActionVisual={kind:style,startedAt:this.time.now,x:struck.x,y:struck.y};

    // The lock follows what was actually struck, exactly as the raider and
    // resource paths do, so a creature engaged from the action button still
    // lights up and names itself.
    if (result.creatureId && !result.killed) {
      this.stickyTarget = { kind: 'creature', id: result.creatureId };
    } else if (result.killed && this.stickyTarget?.id === result.creatureId) {
      this.stickyTarget = null;
    }

    // Reported before syncCreatures, which destroys a killed creature's sprite
    // and would leave the damage number with nowhere to spawn.
    for (const creature of this.state.wildCreatures) {
      const previous = before.get(creature.id);
      if (previous !== undefined && creature.hp < previous) {
        this.combatOverlay.reportHit(
          creature.id, creature.x, creature.y, creature.hp, creature.maxHp,
          previous - creature.hp, style, 'hit',
        );
      }
    }
    this.syncWildCreatures();
    // A defeat with a full bag spills its loot onto the ground, exactly as a
    // raider's does, so the drops have to be synced or the pile is invisible.
    this.syncGroundDrops();
    this.syncItemDrops();
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  private applyEncounterResult(result: CommandResult): void {
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.onCriticalChanged();
      this.encounterPanel.refresh();
    }
    this.refreshHudNow();
  }

  private performEncounterAction(action: EncounterAction): void {
    const inventoryBefore = { ...this.state.inventory };
    const before = captureBattleSnapshot(this.state);
    const result = resolveEncounterAction(this.state, action);
    if (before && result.ok) {
      this.onBattleRound({
        action,
        result,
        before,
        resolved: resolvedBattleSnapshot(before, this.state, result),
      });
    }
    if (!result.ok) this.hud.showFeedback(result.message, false);
    this.syncWildCreatures();
    if (result.tamed) this.spawnFloatingText(this.state.player.x, this.state.player.y, 'New creature joined you!');
    if (result.ok) this.reportResourceCollection(inventoryBefore);
    if (result.ok) this.onCriticalChanged();
    // The battle screen animates the structured result itself and owns its
    // own end-of-battle outro, so success feedback stays inside the arena.
    this.encounterPanel.playResult(action, result);
    if (result.playerDefeated) this.respawnPanel.refresh(true);
    this.refreshHudNow();
  }

  private performCompanionAbilitySelection(abilityId: import('../simulation/state').CompanionAbilityId, creatureId?: string): void {
    const result = selectCompanionAbility(this.state, abilityId, creatureId);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) this.onCriticalChanged();
    this.encounterPanel?.refresh();
    this.refreshHudNow();
  }

  private performCreatureRole(creatureId: string, role: import('../simulation/state').CreatureRole): void {
    const result = setCreatureRole(this.state, creatureId, role);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.syncMountAppearance();
      this.onCriticalChanged();
    }
    this.refreshHudNow();
  }

  /** A mount is an active follower with mount mode; strongest wins if content adds more later. */
  private syncMountAppearance(): void {
    const activeMount = this.state.ownedCreatures
      .filter((creature) => creature.role === 'follow' && creatureDefinition(creature.speciesId).followMode === 'mount')
      .sort((left, right) =>
        creatureDefinition(right.speciesId).travelSpeedMultiplier - creatureDefinition(left.speciesId).travelSpeedMultiplier,
      )[0];
    if (!activeMount) {
      this.mount?.destroy();
      this.mount = null;
      return;
    }
    const texture = creatureTextureKey(activeMount.speciesId);
    if (!this.mount) this.mount = this.add.image(this.state.player.x, this.state.player.y, texture).setOrigin(0.5, 0.9);
    else this.mount.setTexture(texture);
  }

  private onNodeDepleted(nodeId: string): void {
    const node = this.state.resourceNodes.find((item) => item.id === nodeId);
    if (!node) return;
    this.resourceSprites.get(nodeId)?.setTexture(this.nodeTexture(node)).clearTint().setScale(1);
  }

  /** Swing at a struck wall; its health bar is picked up by the next redraw. */
  private onWallDamaged(wall: BuildingState, destroyed: boolean, previousHp: number): void {
    const center = buildingCenterPx(wall);
    const maxHp = structureMaxHp(wall, this.state.gameBalance) ?? Math.max(1, previousHp);
    const hp = destroyed ? 0 : structureHp(wall, this.state.gameBalance) ?? 0;
    const damage = Math.max(0, previousHp - hp);
    if (damage > 0) {
      this.combatOverlay.reportHit(wall.id, center.x, center.y, hp, maxHp, damage, 'melee', 'hit');
    }
    this.gatheringUntil = this.time.now + 280;
    this.player.setFlipX(center.x < this.state.player.x);
    this.player.play(AnimationKeys.PlayerGather, true);
    if (destroyed) {
      this.spawnFloatingText(center.x, center.y, 'Destroyed');
      this.buildMode.syncPlaced();
      this.syncBuildingQueryIndex();
    } else {
      this.buildMode.flashBuildingHit(wall.id);
    }
    this.onCriticalChanged();
  }

  /**
   * A hold on a placed floor, wall, or utility drops straight into Delete mode
   * with that part already lit: the thing under the thumb is what the player
   * meant, and the d-pad can still walk the cursor onto its neighbours before
   * Delete commits.
   */
  private enterDeleteModeOn(building: BuildingState): void {
    this.buildMenu.enterDeleteMode();
    this.buildMode.focusDeleteTarget(building);
  }

  /** Open the repair prompt for a damaged wall the player tapped. */
  private openBuildingItemMenu(building: BuildingState, clientX: number, clientY: number): void {
    this.inventoryPanel.close();
    this.buildMenu.close();
    this.buildMode.setSelectedBuilding(building.id);
    this.buildingItemMenu.open(building, clientX, clientY);
  }

  /** Restore a damaged wall to full for the price of a new one. */
  private repairWallById(buildingId: string): boolean {
    const result = repairStructure(this.state, buildingId);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      const wall = this.state.buildings.find((building) => building.id === buildingId);
      if (wall) {
        const center = buildingCenterPx(wall);
        this.spawnFloatingText(center.x, center.y, 'Repaired');
      }
      this.onCriticalChanged();
      this.refreshHudNow();
    }
    return result.ok;
  }

  /**
   * A bar sits above every damaged wall for as long as it stays damaged, so the
   * player can see what needs repairing without hunting for it. Redrawn only
   * when the damaged set or its health actually changes.
   */
  /**
   * Health bars over anything a raid has chewed on. Facilities are included as
   * well as walls: at 0 they are destroyed outright, so the player needs to see
   * what is about to be lost while there is still time to repair it.
   */
  private updateDamagedWallBars(): void {
    const balance = this.state.gameBalance;
    const damaged = this.state.buildings.filter((building) => isStructureDamaged(building, balance));
    const signature = damaged.map((wall) => `${wall.id}:${wall.hp}`).join('|');
    if (signature === this.damagedWallSignature) return;
    this.damagedWallSignature = signature;

    this.wallHpBar.clear();
    for (const wall of damaged) {
      const center = buildingCenterPx(wall);
      const ratio = structureHp(wall, balance)! / structureMaxHp(wall, balance)!;
      const color = ratio > 0.5 ? 0x4cc07f : ratio > 0.25 ? 0xc9a227 : 0xd9534f;
      this.wallHpBar.fillStyle(0x09140e, 0.85).fillRect(center.x - 9, center.y - 22, 18, 4);
      this.wallHpBar.fillStyle(color, 1).fillRect(center.x - 8, center.y - 21, Math.max(1, Math.round(16 * ratio)), 2);
    }
  }

  private flashNodeHit(nodeId: string): void {
    const sprite = this.resourceSprites.get(nodeId);
    if (!sprite) return;
    sprite.setTintFill(0xffffff);
    this.tweens.add({ targets: sprite, x: sprite.x + 1, duration: 40, yoyo: true, repeat: 2 });
    this.time.delayedCall(90, () => {
      if (!sprite.active) return;
      if (this.highlightedId === nodeId) sprite.setTint(HIGHLIGHT_TINT);
      else sprite.clearTint();
    });
  }

  private spawnGatherEffect(node: ResourceNodeState): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || this.activeEffectCount >= 20) return;
    const color = node.kind === 'tree' ? 0xa9794a
      : node.kind === 'stone' || node.kind === 'metal' ? 0x929b96
        : node.kind === 'berry-bush' ? 0xbd5c52 : 0xa7b96a;
    for (let index = 0; index < 4 && this.activeEffectCount < 24; index += 1) {
      this.activeEffectCount += 1;
      const chip = this.add.rectangle(node.x, node.y - 10, index % 2 === 0 ? 2 : 1, 2, color, 1).setDepth(OVERLAY_DEPTH - 1);
      const direction = index < 2 ? -1 : 1;
      this.tweens.add({
        targets: chip,
        x: node.x + direction * (5 + index * 2),
        y: node.y - 17 - (index % 2) * 5,
        alpha: 0,
        duration: 380,
        ease: 'Cubic.easeOut',
        onComplete: () => { chip.destroy(); this.activeEffectCount -= 1; },
      });
    }
  }

  private spawnFloatingText(x: number, y: number, text: string): void {
    const label = this.add
      .text(x, y - 18, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '10px',
        color: '#ffe08a',
        stroke: '#09140e',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(OVERLAY_DEPTH + 1);
    this.tweens.add({
      targets: label,
      y: y - 34,
      alpha: 0,
      duration: 1000,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  /** Report only positive Bag deltas from one player-triggered action. */
  private reportResourceCollection(before: Readonly<GameState['inventory']>): void {
    const gains = (Object.keys(this.state.inventory) as ResourceId[])
      .map((resource) => ({
        resource,
        amount: this.state.inventory[resource] - before[resource],
        total: this.state.inventory[resource],
      }))
      .filter(({ amount }) => amount > 0);
    if (gains.length === 0) return;

    gains.forEach(({ resource, amount }, index) => {
      const label = resource.replaceAll('-', ' ');
      this.spawnFloatingText(
        this.state.player.x,
        this.state.player.y - index * 9,
        `+${amount} ${label}`,
      );
    });
    this.hud.showResourceTotals(gains.map(({ resource, total }) =>
      `${total} ${resource.replaceAll('-', ' ')}`,
    ));
  }

  /**
   * The simulation grants levels deep inside command handlers, so the scene
   * watches the player's level instead of threading a callback through each of
   * them. Loads and admin edits can move the level down; those only reseed.
   */
  private watchForLevelUp(): void {
    const level = this.state.player.level;
    if (level > this.lastCelebratedLevel && this.lastCelebratedLevel > 0) this.playLevelUpCelebration(level);
    this.lastCelebratedLevel = level;
  }

  private playLevelUpCelebration(level: number): void {
    this.levelUpEndsAt = this.time.now + LEVEL_UP_CELEBRATION_MS;
    const { x, y } = this.player;

    // Rings burst outward from the character's feet on a repeating beat.
    for (let ring = 0; ring < 3; ring += 1) {
      const arc = this.add
        .circle(x, y, 14)
        .setStrokeStyle(2, LEVEL_UP_GOLD, 1)
        .setDepth(OVERLAY_DEPTH)
        .setScale(0.3)
        .setAlpha(0);
      this.levelUpAura.push(arc);
      this.tweens.add({
        targets: arc,
        scale: { from: 0.3, to: 2.6 },
        alpha: { from: 0.9, to: 0 },
        delay: ring * 220,
        duration: 900,
        repeat: Math.floor(LEVEL_UP_CELEBRATION_MS / 1_100),
        repeatDelay: 200,
        ease: 'Cubic.easeOut',
      });
    }

    // A trail of sparkles keeps rising for the whole five seconds.
    this.levelUpSparkleTimer?.remove();
    this.levelUpSparkleTimer = this.time.addEvent({
      delay: LEVEL_UP_SPARKLE_INTERVAL_MS,
      repeat: Math.floor(LEVEL_UP_CELEBRATION_MS / LEVEL_UP_SPARKLE_INTERVAL_MS) - 1,
      callback: () => this.spawnLevelUpSparkle(),
    });

    const banner = this.add
      .text(x, y - 30, `LEVEL UP\nLEVEL ${level}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffe9a3',
        stroke: '#3a2400',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(OVERLAY_DEPTH + 2)
      .setScale(0.4);
    this.tweens.add({ targets: banner, scale: 1, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: banner,
      y: y - 58,
      alpha: 0,
      delay: 1_100,
      duration: 900,
      ease: 'Cubic.easeIn',
      onComplete: () => banner.destroy(),
    });
    this.hud.showFeedback(`Level Up! You are now level ${level}.`, true);
  }

  private spawnLevelUpSparkle(): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 6 + Math.random() * 12;
    const x = this.player.x + Math.cos(angle) * radius;
    const y = this.player.y + Math.sin(angle) * radius * 0.5;
    const sparkle = this.add.circle(x, y, 1 + Math.random() * 1.5, LEVEL_UP_GOLD, 1).setDepth(OVERLAY_DEPTH + 1);
    this.tweens.add({
      targets: sparkle,
      y: y - (18 + Math.random() * 16),
      alpha: 0,
      duration: 600 + Math.random() * 300,
      ease: 'Sine.easeOut',
      onComplete: () => sparkle.destroy(),
    });
  }

  /** Drive the gold pulse and keep the aura centred on the moving character. */
  private updateLevelUpCelebration(): void {
    if (this.levelUpEndsAt === 0) return;
    const remaining = this.levelUpEndsAt - this.time.now;
    if (remaining <= 0) {
      this.stopLevelUpCelebration();
      return;
    }
    for (const arc of this.levelUpAura) arc.setPosition(this.player.x, this.player.y + 4);
    // Cosine wave so the glow swells and settles rather than strobing, easing
    // off toward the end of the five seconds.
    const wave = 0.5 - 0.5 * Math.cos((this.time.now / 1_000) * Math.PI * 2 * LEVEL_UP_PULSE_HZ);
    const strength = wave * (0.45 + 0.55 * (remaining / LEVEL_UP_CELEBRATION_MS));
    const blend = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0xffffff),
      Phaser.Display.Color.ValueToColor(LEVEL_UP_GOLD),
      100,
      strength * 100,
    );
    this.player.setTint(Phaser.Display.Color.GetColor(blend.r, blend.g, blend.b));
    this.player.setScale(1 + 0.14 * strength);
  }

  private stopLevelUpCelebration(): void {
    this.levelUpEndsAt = 0;
    this.levelUpSparkleTimer?.remove();
    this.levelUpSparkleTimer = null;
    for (const arc of this.levelUpAura) {
      this.tweens.killTweensOf(arc);
      arc.destroy();
    }
    this.levelUpAura = [];
    this.player.clearTint();
    this.player.setScale(1);
  }

  private performCraft(definitionId: import('../simulation/state').ToolDefinitionId): void {
    const result = craftTool(this.state, definitionId);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) this.onCriticalChanged();
    this.refreshHudNow();
  }

  private performToolCommand(command: () => CommandResult, critical: boolean): void {
    const inventoryBefore = { ...this.state.inventory };
    const result = command();
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.buildMode.syncPlaced();
      this.syncGroundDrops();
    this.syncItemDrops();
      if (critical) this.onCriticalChanged();
      else this.onMoved();
      this.reportResourceCollection(inventoryBefore);
    }
    this.refreshHudNow();
  }

  private onPlacementAttempt(result: PlaceResult): void {
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.pruneRetiredResourceNodes();
      this.syncBuildingQueryIndex();
      // Buildings now persist to state.buildings — save the structural change now.
      this.onCriticalChanged();
      this.refreshHudNow();
    }
  }

  private onPlacementUndo(result: CommandResult): void {
    this.hud.showFeedback(result.message, result.ok);
    if (!result.ok) return;
    this.syncBuildingQueryIndex();
    this.syncGroundDrops();
    this.syncItemDrops();
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  /**
   * Building over a knocked-down node retires it from the sim, so its stump or
   * rubble sprite has to go with it instead of lingering under the structure
   * until the next area rebuild.
   */
  private pruneRetiredResourceNodes(): void {
    for (const [id, sprite] of this.resourceSprites) {
      if (this.state.resourceNodes.some((node) => node.id === id)) continue;
      sprite.destroy();
      this.resourceSprites.delete(id);
      this.resourceChunks.delete(id);
      this.activeResourceIds.delete(id);
      this.resourceNodesById.delete(id);
      if (this.highlightedId === id) this.highlightedId = null;
      this.entityActivationDirty = true;
    }
  }

  private deleteBuilding(buildingId: string): boolean {
    const result = removeBuilding(this.state, buildingId);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.buildMode.syncPlaced();
      this.syncBuildingQueryIndex();
      this.syncGroundDrops();
    this.syncItemDrops();
      this.onCriticalChanged();
      this.refreshHudNow();
    }
    return result.ok;
  }

  /**
   * Demolish whatever the Delete-mode cursor is lighting, then re-anchor the
   * cursor so a row of walls comes down with repeated Delete presses.
   */
  private deleteSelectedBuilding(): boolean {
    const target = this.buildMode.deleteTarget;
    if (!target) return false;
    const removed = this.deleteBuilding(target.id);
    this.buildMode.refreshDeleteSelection();
    return removed;
  }

  /**
   * Pay out a quest the player tapped. The reward is only credited here, so
   * the coins land while the celebration is on screen.
   */
  private claimQuestReward(questId: string): boolean {
    if (!claimQuestReward(this.state, questId)) return false;
    this.onCriticalChanged();
    this.refreshHudNow();
    return true;
  }

  /** Push current inventory/tool/target data into the DOM HUD after a command. */
  private refreshHudNow(): void {
    const openingStatus = this.state.onboarding.status;
    const wildCount = this.state.wildCreatures.length;
    if (reconcileQuestProgress(this.state)) {
      this.syncContainers();
      if (openingStatus !== this.state.onboarding.status || wildCount !== this.state.wildCreatures.length) this.syncWildCreatures();
      for (const node of this.state.resourceNodes) {
        if (this.resourceNodesById.has(node.id)) continue;
        const sprite = this.add.image(node.x, node.y, this.nodeTexture(node)).setOrigin(.5, .875).setDepth(node.y).setActive(false).setVisible(false);
        this.resourceSprites.set(node.id, sprite);
        this.resourceNodesById.set(node.id, node);
        this.resourceChunks.upsert(node.id, node.x, node.y);
        this.entityActivationDirty = true;
      }
      this.onCriticalChanged();
    }
    const nearby = this.findNearbyTargets();
    this.hud.refresh(nearby.node, nearby.node ? null : nearby.drop, nearby.creature);
    this.buildMenu.refreshAffordability();
    this.hotbar.refresh();
    this.inventoryPanel.refresh();
    this.blueprintsPanel.refresh();
    if (this.state.onboarding.status === 'active' || this.inventoryPanel.open) this.shelterGuide?.refresh();
    if (this.state.onboarding.status === 'active' || this.inventoryPanel.open) this.paddockGuide?.refresh();
    if (this.state.onboarding.supplyRun?.site || this.inventoryPanel.open) this.supplyRunGuide?.refresh();
    if (openingGardenAvailable(this.state) || this.inventoryPanel.open) this.gardenGuide?.refresh();
    this.encounterPanel.refresh();
    this.respawnPanel.refresh();
    const battling = this.encounterPanel.isOpen || this.openingPanel.isOpen;
    this.hud.setBattleMode(battling);
    this.navigator.setBattleMode(battling);
    this.hudDirty = false;
    this.lastHudRefreshAt = this.time.now;
    this.lastTargetKey = null; // force indicator re-sync next frame
  }

  private refreshHudIfDue(): void {
    if (!this.hudDirty || this.time.now - this.lastHudRefreshAt < HUD_REFRESH_INTERVAL_MS) return;
    this.refreshHudNow();
  }

  private updateShelterOutline(): void {
    if (!this.journeyOutline?.active) this.journeyOutline = this.add.graphics().setDepth(999_001);
    this.journeyOutline.clear();
    const waypoint = openingGardenAvailable(this.state) ? this.gardenGuide?.visibleWaypoint : this.supplyRunGuide?.visibleWaypoint;
    if (waypoint && !this.interiorSession.isActive && !this.state.activeEncounter) this.journeyOutline.lineStyle(2, 0x8de4ed, .95).strokeCircle((waypoint.tileX + .5) * TILE_SIZE, (waypoint.tileY + .5) * TILE_SIZE, 10);
    const garden = this.gardenGuide?.visibleSite;
    if (garden && !this.interiorSession.isActive && !this.state.activeEncounter) this.journeyOutline.lineStyle(1, 0x8de4ed, .8).strokeRect(garden.tileX * TILE_SIZE, garden.tileY * TILE_SIZE, 2 * TILE_SIZE, TILE_SIZE);
    if (!this.shelterOutline?.active) this.shelterOutline = this.add.graphics().setDepth(999_000);
    this.shelterOutline.clear();
    const site = this.paddockGuide.visibleSite ?? this.shelterGuide.visibleSite;
    if (!site || this.interiorSession.isActive || this.state.activeEncounter) return;
    this.shelterOutline.lineStyle(1, 0xffdb83, .8);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) this.shelterOutline.strokeRect((site.tileX + x) * TILE_SIZE, (site.tileY + y) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }

  private nearestDropInRange(candidates: Iterable<GroundDropState>): GroundDropState | null {
    let nearest: GroundDropState | null = null;
    let nearestDistance = INTERACTION_RANGE_PX;
    for (const drop of candidates) {
      const distance = Math.hypot(drop.x - this.state.player.x, drop.y - this.state.player.y);
      if (distance <= nearestDistance) {
        nearest = drop;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private findNearbyTargets(): NearbyTargets {
    const startedAt = globalThis.performance.now();
    // Gathering reaches as far as the equipped tool's Range, so the chunk sweep
    // has to widen with it or a long-reach tool would find nothing to hit.
    const gatherRange = strikeReachPx(this.state);
    const queryRange = Math.max(INTERACTION_RANGE_PX, TAMING_RANGE_PX, FACILITY_INTERACTION_RANGE_PX, gatherRange);
    const { x, y } = this.state.player;
    const chunkKeys = activeEntityChunkKeys({
      left: x - queryRange,
      right: x + queryRange,
      top: y - queryRange,
      bottom: y + queryRange,
    }, 0);
    const resources = this.valuesInChunks(this.resourceChunks, this.resourceNodesById, chunkKeys);
    const drops = this.valuesInChunks(this.dropChunks, this.dropsById, chunkKeys);
    const creatures = this.valuesInChunks(this.creatureChunks, this.creaturesById, chunkKeys);
    const buildings = this.valuesInChunks(this.buildingChunks, this.buildingsById, chunkKeys);
    this.lastInteractionCandidateCount = resources.length + drops.length + creatures.length + buildings.length;
    // The town bench is not in the building chunks — it is town content — so it
    // is offered as a walk-up facility alongside whatever the sweep found.
    const townBench = elarisPublicWorkbenchFacility(this.state);

    const targets: NearbyTargets = {
      node: nearestLiveNode(this.state, gatherRange, resources),
      drop: this.nearestDropInRange(drops),
      creature: nearestWildCreature(this.state, TAMING_RANGE_PX, creatures),
      facility: nearestUsableFacility(
        this.state,
        FACILITY_INTERACTION_RANGE_PX,
        [
          ...buildings.filter((building) => building.definitionId === 'field-cache'
            || building.definitionId === 'workbench'
            || building.definitionId === 'furnace'
            || building.definitionId === 'farm-counter'
            || building.definitionId === 'small-pen'
            || building.definitionId === 'barn'
            || building.definitionId === 'stone-yard'
            || building.definitionId === 'cart-dock'),
          ...(townBench ? [townBench] : []),
        ],
      ),
      bed: nearestGardenBed(this.state, INTERACTION_RANGE_PX, buildings),
      planter: nearestWoodlotPlanter(this.state, INTERACTION_RANGE_PX, buildings),
      door: nearestTownBuildingDoor(this.state),
    };
    this.interactionQueryTimes.record(globalThis.performance.now() - startedAt);
    return targets;
  }

  private valuesInChunks<T>(
    index: EntityChunkIndex,
    valuesById: ReadonlyMap<string, T>,
    chunkKeys: ReadonlySet<string>,
  ): T[] {
    const values: T[] = [];
    for (const id of index.idsInChunks(chunkKeys)) {
      const value = valuesById.get(id);
      if (value !== undefined) values.push(value);
    }
    return values;
  }

  private updateTargetIndicators(): void {
    if (this.interiorSession.mode.kind !== 'world') {
      this.presentationTarget = null;
      if (this.interiorSession.mode.kind === 'interior') {
        const buildingId = this.interiorSession.buildingId;
        const interior = buildingId ? interiorDefinitionForBuilding(buildingId) : null;
        const hotspot = interior?.hotspots.find(({ id }) => id === this.interiorSession.focusedHotspotId) ?? null;
        const label = hotspot?.kind === 'service'
          ? `Talk to ${npcDefinition(hotspot.npcId).name}`
          : hotspot?.kind === 'exit'
            ? hotspot.label
            : hotspot?.label ?? null;
        this.hud.setContextActionOverride(label, hotspot?.label ?? `Explore ${interior?.displayName ?? 'the interior'}`);
      } else {
        this.hud.setContextActionOverride(null);
      }
      return;
    }
    const opening = nearbyOpeningTuftle(this.state);
    if (opening && !this.buildMode.placing && !this.buildMode.deleteMode) {
      this.hud.setContextActionOverride('Help Tuftle', 'A nervous Tuftle waits by the road · E / Space');
      this.presentationTarget = { kind: 'creature', id: opening.id, x: opening.x, y: opening.y, label: 'Help Tuftle' };
      return;
    }
    const nearby = this.findNearbyTargets();
    const target = nearby.node;
    const drop = target ? null : nearby.drop;
    const creature = nearby.creature;
    const facility = nearby.facility;
    const bed = nearby.bed;
    const planter = nearby.planter;
    const door = nearby.door;
    this.hud.setContextActionOverride(
      door ? `Enter ${door.displayName}` : null,
      door ? `${door.displayName} · E / Space` : '',
    );
    this.presentationTarget = door
      ? {
          kind: 'door', id: door.id,
          x: (door.door.tileX + 0.5) * TILE_SIZE, y: (door.door.tileY + 0.5) * TILE_SIZE,
          label: `Enter ${door.displayName}`,
        }
      : target
      ? {
          kind: 'resource', id: target.id, x: target.x, y: target.y,
          label: target.kind === 'berry-bush' ? 'Berry bush' : target.kind[0]!.toUpperCase() + target.kind.slice(1),
          value: target.hp, maxValue: target.maxHp,
        }
      : drop
        ? { kind: 'drop', id: drop.id, x: drop.x, y: drop.y, label: `Pick up ${drop.amount} ${drop.resource}` }
        : creature
          ? { kind: 'creature', id: creature.id, x: creature.x, y: creature.y, label: 'Attack or snare' }
          : facility
            ? {
                kind: 'facility', id: facility.id,
                x: (facility.tileX + 0.5) * TILE_SIZE, y: (facility.tileY + 0.5) * TILE_SIZE,
                label: facility.definitionId === 'field-cache' ? 'Open storage' : `Use ${facility.definitionId}`,
              }
            : bed
              ? {
                  kind: 'garden', id: bed.id,
                  x: (bed.tileX + 1) * TILE_SIZE, y: (bed.tileY + 0.5) * TILE_SIZE,
                  label: (bed.garden?.readyFiber ?? 0) > 0 ? 'Harvest fiber' : 'Garden growing',
                }
              : planter
                ? {
                    kind: 'woodlot', id: planter.id,
                    x: (planter.tileX + 1) * TILE_SIZE, y: (planter.tileY + 1) * TILE_SIZE,
                    label: (planter.woodlot?.readyWood ?? 0) > 0 ? 'Harvest wood' : 'Saplings growing',
                  }
                : null;
    // The lock joins the cache key: its label and in-range state change as the
    // player walks, and a stale key would freeze the action button's wording.
    const locked = this.resolveStickyTarget();
    // The snare button appears at taming range, which is shorter than any
    // attack reach, so the lock's own in-range flag cannot stand in for it.
    const snarable = locked?.kind === 'creature' && locked.distancePx <= TAMING_RANGE_PX;
    const key = `${door?.id ?? ''}|${target?.id ?? ''}|${target?.hp ?? ''}|${drop?.id ?? ''}|${creature?.id ?? ''}|${facility?.id ?? ''}`
      + `|${locked?.id ?? ''}|${locked?.inRange ?? ''}|${snarable}`;
    if (key === this.lastTargetKey) return;
    this.lastTargetKey = key;

    const nextHighlight = target?.id ?? null;
    if (nextHighlight !== this.highlightedId) {
      if (this.highlightedId) this.resourceSprites.get(this.highlightedId)?.clearTint().setScale(1);
      this.highlightedId = nextHighlight;
      if (this.highlightedId) {
        this.resourceSprites.get(this.highlightedId)?.setTint(HIGHLIGHT_TINT).setScale(1.12);
      }
    }

    this.hud.refreshTargets(target, drop, creature, locked);
  }

  /**
   * Style the current loadout strikes with — read off the tool in hand rather
   * than off what is locked.
   *
   * It used to be inferred from the lock (raider meant ranged), which was wrong
   * in both directions the moment a bow could shoot wildlife: a stag lock drew
   * a fist-sized ring around a six-tile shot, and a raider lock drew a six-tile
   * ring for a player holding nothing but an axe. Resources are always swung
   * at, whatever is in hand.
   */
  private currentStrikeStyle(): StrikeStyle {
    return loadoutStrikeStyle(this.state, this.stickyTarget);
  }

  /** How far the current loadout can start a fight: bow range, or a swing. */
  private playerEngageRangePx(): number {
    return Math.max(strikeReachPx(this.state), this.currentStrikeStyle() === 'ranged' ? playerShotRangePx(this.state) : 0);
  }

  /** Resolve the lock, dropping it when its subject is gone or out of leash. */
  private resolveStickyTarget(): ResolvedCombatTarget | null {
    const resolved = resolveCombatTarget(this.state, this.stickyTarget, this.currentStrikeStyle());
    if (!resolved) this.stickyTarget = null;
    return resolved;
  }

  private updateCombatOverlay(deltaMs: number): void {
    // Raiders walk every tick and nodes can respawn, so tracked bars re-read
    // their subject each frame. Only recently-damaged entities are tracked,
    // which keeps this loop to a handful of lookups.
    for (const id of this.combatOverlay.trackedIds()) {
      const node = this.resourceNodesById.get(id);
      if (node) {
        this.combatOverlay.observe(id, node.x, node.y, node.hp, node.maxHp);
        continue;
      }
      const raider = this.state.raiders.find((candidate) => candidate.id === id);
      if (raider) {
        this.combatOverlay.observe(id, raider.x, raider.y, raider.hp, raider.maxHp);
        continue;
      }
      const creature = this.state.wildCreatures.find((candidate) => candidate.id === id);
      if (creature) {
        // Only while it is actually on screen: chunk activation can hide a
        // creature mid-fight, and a bar left hanging over an empty patch of
        // grass reads as a bug. Dropping it is safe — the next hit re-adds it.
        if (this.creatureSprites.get(id)?.visible) {
          this.combatOverlay.observe(id, creature.x, creature.y, creature.hp, creature.maxHp);
          continue;
        }
      }
      const building = this.state.buildings.find((candidate) => candidate.id === id);
      if (building) {
        const center = buildingCenterPx(building);
        const hp = structureHp(building, this.state.gameBalance);
        const maxHp = structureMaxHp(building, this.state.gameBalance);
        if (hp !== null && maxHp !== null) {
          this.combatOverlay.observe(id, center.x, center.y, hp, maxHp);
          continue;
        }
      }
      this.combatOverlay.forget(id);
    }
    this.combatOverlay.draw(this.resolveStickyTarget(), deltaMs);
  }

  private gatherInput(): MoveIntent {
    return this.alignIntentToPresentation(this.gatherRawInput());
  }

  /** A d-pad tap outside Build: exactly one tile in that direction. */
  private queueStep(x: number, y: number): void {
    this.queuedStep = { x, y, expiresAt: performance.now() + QUEUED_STEP_TIMEOUT_MS };
  }

  /**
   * Drop a queued step once the tile it asked for is under way (or already
   * done — a short tile can start and finish inside one frame). A move that was
   * still running when the tap landed is not that tile, so the queue waits it
   * out. The deadline covers a step nothing ever accepted.
   */
  private retireQueuedStep(movingBefore: boolean, poseBefore: QueuedStepPose): void {
    if (!this.queuedStep) return;
    const accepted = !movingBefore
      && (this.gridMovement.moving
        || this.interiorGridMovement.moving
        || this.state.player.x !== poseBefore.x
        || this.state.player.y !== poseBefore.y
        || (this.interiorSession.pose?.x ?? 0) !== poseBefore.interiorX
        || (this.interiorSession.pose?.y ?? 0) !== poseBefore.interiorY);
    if (accepted || performance.now() >= this.queuedStep.expiresAt) this.queuedStep = null;
  }

  private queuedStepPose(): QueuedStepPose {
    return {
      x: this.state.player.x,
      y: this.state.player.y,
      interiorX: this.interiorSession.pose?.x ?? 0,
      interiorY: this.interiorSession.pose?.y ?? 0,
    };
  }

  private gatherRawInput(): MoveIntent {
    // The Sprint toggle applies to stick and keyboard travel alike.
    const sprint = this.hud.sprinting;
    // A queued tile outranks the stick and keys: the stick is at rest during a
    // tap anyway, and the queue clears the instant the tile starts.
    if (this.queuedStep) return { x: this.queuedStep.x, y: this.queuedStep.y, slow: false, sprint };
    const stick = this.joystick.getVector();
    if (stick.magnitude > 0.05) {
      return { x: stick.x, y: stick.y, slow: false, sprint };
    }

    let x = 0;
    let y = 0;
    let slow = false;
    for (const set of [this.keys, this.altKeys]) {
      if (!set) continue;
      if (set.left.isDown) x -= 1;
      if (set.right.isDown) x += 1;
      if (set.up.isDown) y -= 1;
      if (set.down.isDown) y += 1;
      if (set.slow.isDown) slow = true;
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    return { x, y, slow, sprint };
  }

  private alignIntentToPresentation(intent: MoveIntent): MoveIntent {
    if (!this.is3DPresentation()) return intent;
    // The published camera angle is what the player is looking through, so the
    // stick is rotated onto the ground plane by that same yaw.
    const yaw = cameraOrientationFromTenths(this.state.gameBalance.camera).yawDegrees;
    return screenToCameraWorldIntent(intent, yaw);
  }

  private alignInteriorIntentToPresentation(intent: MoveIntent): MoveIntent {
    if (!this.is3DPresentation()) return intent;
    if (!this.interiorSession.buildingId) return intent;
    // Interiors are shot from the overworld orientation, so the stick rotates
    // by exactly the same yaw indoors as it does outside.
    return this.alignIntentToPresentation(intent);
  }

  private applyLayout = (): void => {
    const layout = computeLayout({
      width: this.scale.gameSize.width,
      height: this.scale.gameSize.height,
    });
    this.cameras.main.setZoom(layout.zoom);
  };

  /** Paint travel feedback first, then replace only area-owned Phaser objects. */
  private beginAreaTransition(): void {
    if (this.transitioningArea) return;
    this.transitioningArea = true;
    this.transitionAreaKey = this.state.currentArea.key;
    this.intent = NO_MOVE;
    resetGridMovement(this.gridMovement);
    this.buildMenu.close();
    this.inventoryPanel.close();
    this.buildingItemMenu.close();
    this.hud.closeCraft();
    this.hud.closeFacility();
    this.showTravelOverlay(document.getElementById('app') ?? document.body);
    this.onTransitionStarted();
    if (this.terrainBuildFrame !== null) cancelAnimationFrame(this.terrainBuildFrame);
    this.terrainBuildFrame = null;
    this.pendingTerrainChunks.length = 0;
    const startedAt = performance.now();

    // Two animation frames are deliberate: the first commits the overlay and
    // the second starts synchronous nearby-terrain work after it has painted.
    this.transitionFrameA = requestAnimationFrame(() => {
      this.transitionFrameA = null;
      this.transitionFrameB = requestAnimationFrame(() => {
        this.transitionFrameB = null;
        if (!this.sys.isActive() || this.transitionAreaKey !== this.state.currentArea.key) return;
        this.rebuildAreaWorld();

        // Keep the cover through the destination's first rendered frame, then
        // fade it away and persist after the animation is safely on screen.
        this.transitionFrameB = requestAnimationFrame(() => {
          this.transitionFrameB = null;
          this.areaTransitionTimes.record(performance.now() - startedAt);
          const finishTransition = (): void => {
            this.transitionFinishTimer = null;
            this.transitioningArea = false;
            this.transitionAreaKey = null;
            const splash = this.areaSplash;
            if (splash) splash.style.opacity = '0';
            window.setTimeout(() => {
              splash?.remove();
              if (this.areaSplash === splash) this.areaSplash = null;
            }, 240);
            this.transitionSaveTimer = setTimeout(() => {
              this.transitionSaveTimer = null;
              if (this.sys.isActive()) this.onCriticalChanged();
            }, 260);
          };
          const remainingSplashMs = Math.max(0, AREA_TRANSITION_SPLASH_MS - (performance.now() - startedAt));
          if (remainingSplashMs > 0) {
            this.transitionFinishTimer = setTimeout(finishTransition, remainingSplashMs);
          } else {
            finishTransition();
          }
        });
      });
    });
  }

  /** Rebuild the map layer while retaining DOM HUD, input, and scene systems. */
  private rebuildAreaWorld(): void {
    this.cameras.main.stopFollow();
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.buildMode.clearForAreaSwap();
    this.destroyTerrainChunks();
    this.dangerAtmosphere.destroy();
    this.arcaneStorm.destroy();
    this.children.removeAll(true);
    this.shelterOutline = null;

    this.mount = null;
    this.cameraTarget = null;
    this.activeEffectCount = 0;
    this.gatheringUntil = 0;
    this.playerActionVisual=null;
    this.gatherAssistance = null;
    this.lastInteractionCandidateCount = 0;
    this.hudDirty = true;
    this.highlightedId = null;
    // Nothing in the new area can be the thing the player locked in the old one.
    this.stickyTarget = null;
    this.damagedWallSignature = '';
    this.lastTargetKey = null;
    this.activeChunkSignature = null;
    this.entityActivationDirty = true;
    this.resourceSprites.clear();
    this.dropSprites.clear();
    this.containerSprites.clear();
    this.creatureSprites.clear();
    this.raiderSprites.clear();
    this.workerCreatureSprites.clear();
    this.followerCreatureSprites.clear();
    this.levelPlates.clear();
    this.resourceNodesById.clear();
    this.dropsById.clear();
    this.creaturesById.clear();
    this.buildingsById.clear();
    this.resourceChunks.clear();
    this.dropChunks.clear();
    this.creatureChunks.clear();
    this.buildingChunks.clear();
    this.activeResourceIds.clear();
    this.activeDropIds.clear();
    this.activeCreatureIds.clear();
    this.townBuildingSprites.clear();
    this.townPropSprites.clear();
    this.townGateSprites.clear();

    this.buildGround();
    this.buildTownBuildings();
    this.buildResourceNodes();
    this.syncWildCreatures();
    this.syncGroundDrops();
    this.syncItemDrops();
    this.syncContainers();
    this.wallHpBar = this.add.graphics().setDepth(OVERLAY_DEPTH);
    this.combatOverlay = new CombatOverlay(this, OVERLAY_DEPTH);
    this.player = this.add
      .sprite(this.state.player.x, this.state.player.y, TextureKeys.PlayerIdleDown)
      .setOrigin(0.5, 0.875);
    this.player.play(playerAnimationKey(this.state.player.facing, false));
    this.previousPlayerX = this.state.player.x;
    this.previousPlayerY = this.state.player.y;
    this.facing = this.state.player.facing;
    this.syncMountAppearance();
    this.setupCamera();
    this.dangerAtmosphere = new DangerAtmosphereOverlay(this, this.state, OVERLAY_DEPTH - 1);
    // Above the atmospheric wash and every structure, below the HUD: a marker
    // the player has three seconds to read must never sit under a roof.
    this.arcaneStorm = new ArcaneStormOverlay(this, this.state, OVERLAY_DEPTH - 1);
    this.setupForestAmbience();
    this.buildMode.syncPlaced();
    this.syncBuildingQueryIndex();
    this.applyLayout();
    this.updateTerrainChunkVisibility();
    this.updateEntityChunkActivation();
    this.navigator.refresh(true);
    this.encounterPanel.refresh();
    this.hotbar.setSuppressed(false);
    this.refreshHudNow();
  }

  private showTravelOverlay(parent: HTMLElement): void {
    this.areaSplash?.remove();
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    Object.assign(overlay.style, {
      position: 'absolute', inset: '0', display: 'grid', placeItems: 'center',
      padding: '24px', background: 'rgba(5, 12, 9, 0.76)', backdropFilter: 'blur(2px)',
      color: '#fff3c4', pointerEvents: 'all', opacity: '1',
      transition: 'opacity 220ms ease', zIndex: '1000000',
    } satisfies Partial<CSSStyleDeclaration>);
    const card = document.createElement('div');
    Object.assign(card.style, {
      minWidth: 'min(280px, 78vw)', padding: '18px 22px', borderRadius: '14px',
      textAlign: 'center', background: 'rgba(8, 17, 13, 0.94)',
      border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 12px 36px rgba(0,0,0,0.42)',
      font: '700 19px system-ui, sans-serif', letterSpacing: '0.02em',
    } satisfies Partial<CSSStyleDeclaration>);
    const label = document.createElement('div');
    label.textContent = 'Travelling to';
    Object.assign(label.style, { fontSize: '11px', textTransform: 'uppercase', opacity: '0.68', letterSpacing: '0.12em' });
    const name = document.createElement('div');
    name.textContent = areaDisplayName(this.state);
    name.style.marginTop = '5px';
    const detail = document.createElement('div');
    detail.textContent = 'Preparing the nearby terrain…';
    Object.assign(detail.style, { marginTop: '8px', fontSize: '12px', fontWeight: '500', opacity: '0.72' });
    card.append(label, name, detail);
    overlay.appendChild(card);
    parent.appendChild(overlay);
    this.areaSplash = overlay;
  }

  private showAreaSplash(parent: HTMLElement): void {
    this.areaSplash?.remove();
    const splash = document.createElement('div');
    splash.dataset.areaSplash = '';
    splash.textContent = `Entering ${areaDisplayName(this.state)}`;
    splash.setAttribute('role', 'status');
    Object.assign(splash.style, {
      position: 'absolute', left: '50%', top: '18%', transform: 'translate(-50%, -12px)',
      padding: '12px 22px', borderRadius: '12px', background: 'rgba(8, 17, 13, 0.88)',
      border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 8px 28px rgba(0,0,0,0.38)',
      color: '#fff3c4', font: '700 19px system-ui, sans-serif', letterSpacing: '0.03em',
      opacity: '0', transition: 'opacity 220ms ease, transform 220ms ease', pointerEvents: 'none', zIndex: '1000000',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(splash);
    this.areaSplash = splash;
    requestAnimationFrame(() => {
      splash.style.opacity = '1'; splash.style.transform = 'translate(-50%, 0)';
    });
    window.setTimeout(() => {
      splash.style.opacity = '0'; splash.style.transform = 'translate(-50%, -8px)';
      window.setTimeout(() => { splash.remove(); if (this.areaSplash === splash) this.areaSplash = null; }, 240);
    }, 1350);
  }

  private onCraftShortcut = (): void => { if (!this.state.pendingRespawn && this.interiorSession.allowsWorldInteraction) this.inventoryPanel.toggleTab('craft'); };
  private onBuildShortcut = (): void => { if (!this.state.pendingRespawn && this.interiorSession.allowsWorldInteraction) this.inventoryPanel.toggleTab('craft'); };
  private onInventoryShortcut = (): void => { if (!this.state.pendingRespawn && this.interiorSession.allowsWorldInteraction) this.inventoryPanel.toggle(); };
  private onConfirmShortcut = (): void => {
    if (!this.state.pendingRespawn && this.interiorSession.allowsWorldInteraction && this.buildMode.placing) this.buildMode.confirm();
  };
  private onRotateShortcut = (): void => {
    if (!this.state.pendingRespawn && this.interiorSession.allowsWorldInteraction && this.buildMode.placing) {
      this.buildMode.toggleRotation();
    }
  };
  private onCancelShortcut = (): void => {
    if (this.openingPanel.isOpen) { this.openingPanel.close(); return; }
    if (this.state.pendingRespawn) return;
    if (this.interiorSession.isActive) {
      if (this.interiorSession.mode.kind === 'dialogue') {
        this.closeNpcDialogue();
        return;
      }
      if (this.interiorSession.mode.kind === 'service') {
        this.npcServiceOverlay.close();
        return;
      }
      this.leavePlayableInterior();
      return;
    }
    this.buildMenu.close();
    this.hud.closeCraft();
    this.hud.closeFacility();
    this.inventoryPanel.close();
  };

  private teardown(): void {
    this.openingPanel.destroy();
    this.shelterGuide.destroy();
    this.paddockGuide.destroy();
    this.supplyRunGuide.destroy();
    this.gardenGuide.destroy();
    this.interiorAudio.dispose();
    this.interiorSession.recoverToWorld();
    resetGridMovement(this.interiorGridMovement);
    this.stopLevelUpCelebration();
    this.dangerAtmosphere.destroy();
    this.arcaneStorm.destroy();
    if (this.transitionFrameA !== null) cancelAnimationFrame(this.transitionFrameA);
    if (this.transitionFrameB !== null) cancelAnimationFrame(this.transitionFrameB);
    if (this.transitionFinishTimer !== null) clearTimeout(this.transitionFinishTimer);
    if (this.transitionSaveTimer !== null) clearTimeout(this.transitionSaveTimer);
    this.transitionFrameA = null;
    this.transitionFrameB = null;
    this.transitionFinishTimer = null;
    this.transitionSaveTimer = null;
    this.transitioningArea = false;
    this.transitionAreaKey = null;
    this.areaSplash?.remove();
    this.areaSplash = null;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerAction);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp);
    this.actionKey?.off('down', this.onActionShortcut);
    this.altActionKey?.off('down', this.onActionShortcut);
    this.craftKey?.off('down', this.onCraftShortcut);
    this.buildKey?.off('down', this.onBuildShortcut);
    this.inventoryKey?.off('down', this.onInventoryShortcut);
    this.cancelKey?.off('down', this.onCancelShortcut);
    this.confirmKey?.off('down', this.onConfirmShortcut);
    this.rotateKey?.off('down', this.onRotateShortcut);
    this.bareHandsKey?.off('down', this.onBareHandsShortcut);
    // A restart triggered from a DOM button (Admin's Reset Game) can reach
    // shutdown after the camera manager is already down; the throw used to abort
    // teardown here and leave the old HUD/panels in the page beside the new ones.
    this.cameras?.main?.stopFollow();
    this.cameraTarget = null;
    this.hotbarKeys.forEach((key, slot) => key.off('down', this.hotbarShortcutHandlers[slot]!));
    this.joystick.destroy();
    this.hud.destroy();
    this.buildMenu.destroy();
    this.buildMode.destroy();
    this.buildingItemMenu.destroy();
    this.hotbar.destroy();
    this.inventoryPanel.destroy();
    this.blueprintsPanel.destroy();
    this.navigator.destroy();
    this.respawnPanel.destroy();
    this.encounterPanel.destroy();
    this.npcServiceOverlay.destroy();
    this.interiorFallback.destroy();
    this.interiorTransition.destroy();
    this.npcDialogue.destroy();
    this.npcBark.destroy();
    this.adminPanel.destroy();
    this.followerCreatureSprites.clear();
    this.destroyTerrainChunks();
    this.resourceSprites.clear();
    this.dropSprites.clear();
    this.containerSprites.clear();
    this.creatureSprites.clear();
    this.raiderSprites.clear();
    this.workerCreatureSprites.clear();
    this.levelPlates.clear();
    this.resourceNodesById.clear();
    this.dropsById.clear();
    this.creaturesById.clear();
    this.buildingsById.clear();
    this.resourceChunks.clear();
    this.dropChunks.clear();
    this.creatureChunks.clear();
    this.buildingChunks.clear();
    this.activeResourceIds.clear();
    this.activeDropIds.clear();
    this.activeCreatureIds.clear();
    this.townBuildingSprites.clear();
    this.townGateSprites.clear();
    for (const props of this.townPropSprites.values()) for (const prop of props) prop.destroy();
    this.townPropSprites.clear();
  }
}
