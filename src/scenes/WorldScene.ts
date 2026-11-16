import { entityAtWorld } from '../presentation/worldHitTests';
import Phaser from 'phaser';

import { gameToolDefinition, INTERACTION_RANGE_PX, SNARE_THROW_RANGE_PX, TAMING_RANGE_PX } from '../config/balance';
import { DEFAULT_WORLD_SEED, FIXED_STEP_MS } from '../config/platform';

import type { MoveIntent } from '../simulation/commands';
import {
  createGridMovementState,
  NO_MOVE,
  resetGridMovement,
  stepMovement,
} from '../simulation/commands';
import { FixedStepLoop } from '../simulation/fixedStep';
import { buildableById, FACILITY_INTERACTION_RANGE_PX, attackFacedWall, collectNearestGroundDrop, depositResourceStackInFieldCache, depositToolInFieldCache, dropResourceStack, selectCompanionAbility, setBattleCompanion, setCreatureRole, craftTool, craftRowboat, equipBareHands, equippedBow, equipTool, gatherNearest, isStructureDamaged, nearestFacedWall, repairStructure, nearestLiveNode, nearestUsableFacility, nearestWildCreature, repairTool, dropTool, splitResourceStack, withdrawFromFieldCache, withdrawResourceStackFromFieldCache, withdrawToolFromFieldCache, removeBuilding, rowboatActionLabel, toggleRowboat, type CommandResult } from '../simulation/gameplayCommands';
import { craftArrows, craftClothMask, craftReinforcedSnare, craftTamingSnare } from '../simulation/supplyCrafting';
import { isEating, isStaggered, tameChance } from '../simulation/tameChance';
import { useHotbarItem } from '../simulation/hotbarItems';
import { describeGardenBed, harvestGardenBed, nearestGardenBed } from '../simulation/gardenBeds';
import { describeWoodlotPlanter, harvestWoodlotPlanter, nearestWoodlotPlanter } from '../simulation/woodlotPlanters';
import type { BuildingState, GameState, GroundDropState, RaiderState, ResourceNodeState, WildCreatureState } from '../simulation/state';
import type { ResourceId } from '../simulation/state';
import { nearestUnopenedContainer, openNearestContainer } from '../simulation/worldContainers';

import { NO_SHOT_TARGET_MESSAGE, firePlayerShot, loadTurretAmmo, nearestRaiderInRange, playerShotRangePx, strikeRaiderMelee, unloadTurretAmmo, type AbsentBaseRaidReport } from '../simulation/raids';
import {
  NO_SHOT_CREATURE_MESSAGE, fireCreatureShot, nearestCreatureInRange, nearestHuntableCreature, strikeCreatureMelee,
  type CreatureStrikeResult,
} from '../simulation/creatureStrike';
import { strikeReachPx } from '../simulation/strike';
import { gatherResource } from '../simulation/gameplayCommands';
import { createInitialState } from '../simulation/state';
import { claimQuestReward, reconcileQuestProgress } from '../simulation/progression';
import { spendAttributePoint, spendAttributePoints } from '../simulation/characterProgression';
import { buildingCenterPx, effectiveBuildingDimensions } from '../simulation/buildingGeometry';
import { BuildModeController } from './buildMode';

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
import { OpeningPartnershipPanel } from '../ui/openingPartnershipPanel';
import { ShelterGuide } from '../ui/shelterGuide';
import { PaddockGuide } from '../ui/paddockGuide';
import { SupplyRunGuide } from '../ui/supplyRunGuide';
import { GardenGuide } from '../ui/gardenGuide';
import { acknowledgeOpeningJourney, harvestOpeningGarden, moveOpeningGardenPlan, openingGardenAvailable, registerOpeningDiscovery } from '../simulation/openingGarden';
import { claimOpeningDiscovery, openOpeningSideCache, recoverOpeningSupplies } from '../simulation/openingSupplyRun';
import { claimPaddockSupplies, collectOpeningOutput, followOpeningCompanion, movePaddockPlan, startOpeningWork } from '../simulation/openingPaddock';
import { acknowledgeOpeningFog } from '../simulation/openingFog';
import { claimShelterSupplies, moveShelterPlan } from '../simulation/openingShelter';
import { isOpeningTuftle } from '../content/onboarding';
import { beginOpeningTrust, nameOpeningCompanion, nearbyOpeningTuftle } from '../simulation/onboarding';

import { TILE_SIZE } from '../config/platform';

import { regionalIdentityForLandmark } from '../content/regions';

import { BuildingItemMenu } from '../ui/buildingItemMenu';
import { townBuildingsInArea, townBuildingById, type TownBuildingId, type TownBuildingDefinition } from '../content/townBuildings';
import { areaDisplayName } from '../simulation/elarisFall';

import { elarisPublicWorkbenchContains, elarisPublicWorkbenchFacility, isElarisPublicWorkbenchId } from '../simulation/elarisWorkbench';

import { recoverPlayerFromTownWalls, townBuildingAroundPlayer } from '../simulation/town';
import { NpcServiceOverlay } from '../ui/npcServiceOverlay';
import { collectFurnaceOutput, enqueueIronSmelt } from '../simulation/processing';
import { orderTrainedCreature } from '../simulation/economy';
import { collectWorkerFacilityBin, releaseCreature } from '../simulation/workerHousing';
import { linkCartDockStorage } from '../simulation/cartDocks';
import { clearLogisticsRoute, setLogisticsRoute } from '../simulation/logistics';
import { AdminPanel, type AdminSystemControls } from '../ui/adminPanel';
import { globalBalanceService, type GlobalBalanceService } from '../platform/globalBalance';
import { DurationWindow, type DurationStats } from '../platform/durationWindow';
import { interpolateRenderPoint } from './renderMotion';

import {
  loadoutStrikeStyle,
  resolveCombatTarget,
  type CombatTarget,
  type ResolvedCombatTarget,
  type StrikeStyle,
} from './combatPresentation';
import {
  activeEntityChunkKeys,
  chunkViewRectAround,
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
import { cameraOrientationFromTenths, screenToCameraWorldIntent } from '../three/cameraControls';
import {
  FIRST_PERSON_VIEW_RADIUS_TILES, KEYBOARD_TURN_DEGREES_PER_SECOND, firstPersonView, groundForward,
} from '../three/firstPersonView';
import { FirstPersonHud } from '../ui/firstPersonHud';
import { CompassStrip, SearchProgressRing } from '../ui/compassStrip';
import { upgradeFacility } from '../simulation/facilityLevels';
import { roomUpgradeIds, upgradeBuildingBatch, upgradeBuildingMaterial } from '../simulation/partUpgrades';
import { scrapTool, temperTool } from '../simulation/economy';
import { compassMarks, compassPips } from '../presentation/compass';
import { compassTargets } from '../presentation/siteViews';
import {
  beginSiteSearch, containerLabelFor, currentSiteProgress, liveAreaSites, nearestSearchableContainer,
  siteSearchProgress, type SiteSearchResult,
} from '../simulation/sites';
import { pickCrosshairTarget, type CrosshairCandidate } from '../presentation/crosshairTarget';
import { creatureDefinition } from '../content/creatures';

import { InteriorSessionController, type GameplayMode } from '../presentation/interiorSession';
import {
  INTERIOR_INTERACTION_RANGE_TILES, interiorDefinitionById, interiorDefinitionForBuilding, nearestInteriorHotspot,
  shellThreshold, townBuildingShell, type InteriorHotspot,
} from '../content/interiors';

import { NpcDialogueController, type DialogueChoiceResult } from '../presentation/npcDialogue';
import { NpcBarkController } from '../presentation/npcBarks';

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
  /** System-level controls surfaced inside the Admin menu. */
  system?: AdminSystemControls;
}

export interface WorldPerformanceSnapshot {
  frameTimes: DurationStats;
  areaTransitions: DurationStats;
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
  hotspot: TownHotspotTarget | null;
}

/** A keeper, or something to examine, inside the town building the player stands in. */
interface TownHotspotTarget {
  readonly building: TownBuildingDefinition;
  readonly hotspot: InteriorHotspot;
  /** World pixels. */
  readonly x: number;
  readonly y: number;
}

function townHotspotLabel(hotspot: InteriorHotspot): string {
  return hotspot.kind === 'service' ? `Talk to ${npcDefinition(hotspot.npcId).name}` : hotspot.label;
}

/** Facilities with a focused walk-up panel, opened by clicking the structure. */
const FACILITY_PANEL_DEFINITIONS: ReadonlySet<string> = new Set([
  'field-cache', 'workbench', 'furnace', 'war-table', 'turret',
  'farm-counter', 'small-pen', 'barn', 'stone-yard', 'cart-dock',
  // Levelled facilities open to show and buy their level.
  'warehouse', 'air-purifier',
]);

const HUD_REFRESH_INTERVAL_MS = 500;

const AREA_TRANSITION_SPLASH_MS = 1_000;

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

  private systemControls: AdminSystemControls = {};
  private areaSplash: HTMLDivElement | null = null;
  private transitioningArea = false;
  private transitionAreaKey: string | null = null;
  private transitionFrameA: number | null = null;
  private transitionFrameB: number | null = null;
  private transitionFinishTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private loop!: FixedStepLoop;

  private previousPlayerX = 0;
  private previousPlayerY = 0;
  private renderPlayerPosition = { x: 0, y: 0 };
  private simulationVisualsDirty = false;
  /** Last level the presentation has already celebrated. 0 means "not yet seeded". */
  private lastCelebratedLevel = 0;

  private hudDirty = true;
  private lastHudRefreshAt = Number.NEGATIVE_INFINITY;
  private joystick!: TouchJoystick;
  private keys: MovementKeys | null = null;
  private altKeys: MovementKeys | null = null;
  private intent: MoveIntent = NO_MOVE;
  private readonly gridMovement = createGridMovementState();
  /** First-person HUD furniture (rail toggle, crosshair, inspect button). */
  private firstPersonHud: FirstPersonHud | null = null;
  /** First-person bearing strip for discovered sites, the cache and the bed. */
  private compassStrip: CompassStrip | null = null;
  /** Search progress, at the crosshair or over the character. */
  private searchRing: SearchProgressRing | null = null;
  /** Whether last frame was in first person, to notice the mode starting and ending. */
  private wasFirstPerson = false;
  /** The look is aimed down the overhead camera's "up" once per toggle into first person. */
  private firstPersonLookPrimed = false;
  /** What sits under the first-person crosshair this frame, if anything. */
  private crosshairTarget: CrosshairCandidate | null = null;
  /** The town building the player was last standing inside, for its ambience and greeting. */
  private townVisitKey: string | null = null;
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
    if (!this.state.pendingRespawn && !this.interiorSession.ownsOverlayInput) this.performInteractAction();
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
  private openingPanel!: OpeningPartnershipPanel;
  private shelterGuide!: ShelterGuide;
  private paddockGuide!: PaddockGuide;
  private supplyRunGuide!: SupplyRunGuide;
  private gardenGuide!: GardenGuide;

  private npcServiceOverlay!: NpcServiceOverlay;

  private interiorAudio!: InteriorAudioRouter;
  private npcDialogue!: NpcDialogue;
  private npcBark!: NpcBark;
  private adminPanel!: AdminPanel;

  private readonly resourceNodesById = new Map<string, ResourceNodeState>();
  private readonly dropsById = new Map<string, GroundDropState>();
  private readonly creaturesById = new Map<string, WildCreatureState>();

  private gatherAssistance: { creatureId: string; x: number; y: number; startedAt: number } | null = null;

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

  private readonly frameTimes = new DurationWindow(240);
  private readonly areaTransitionTimes = new DurationWindow(30);
  private readonly interactionQueryTimes = new DurationWindow(240);
  private lastInteractionCandidateCount = 0;

  private gatheringUntil = 0;
  private gatheringKind: ResourceNodeState['kind'] | null = null;
  private playerActionVisual:{kind:StrikeStyle;startedAt:number;x:number;y:number;arrowTracked:boolean}|null=null;
  /** The last snare throw, replayed by the renderer as an arc and a wrap or burst. */
  private tameThrowVisual:{id:number;outcome:'tamed'|'missed';x:number;y:number}|null=null;
  /** Last non-zero movement direction; the aim for a hotbar snare with no lock. */
  private lastAim: { x: number; y: number } = { x: 0, y: 1 };

  private lastTargetKey: string | null = null;
  private presentationTarget: InteractionTargetPresentation | null = null;
  /**
   * Sticky combat lock. Presentation-only and deliberately outside GameState:
   * a lock is one client's viewing choice, and the resolved target carries
   * fractional distances the canonical state hash would reject.
   */
  private stickyTarget: CombatTarget | null = null;

  constructor() {
    super('world');
  }

  /** Read-only bridge used by the 3D presentation layer. */
  get3DPresentationState(): ThreePresentationState {
    return {
      playerPosition: this.transitioningArea ? this.state.player : this.renderPlayerPosition,
      journalOpen:this.inventoryPanel?.open??false,
      worldBackdrop: this.adminPanel?.open === true && !this.adminPanel.worldPreviewActive,
      placement: this.buildMode?.getPresentationState() ?? null,
      selection: this.buildMode?.getSelectionPresentationState() ?? null,
      batchPlacements: this.buildMode?.getBatchPresentationStates() ?? [],
      shelterGuide: this.paddockGuide?.visibleSite ?? this.shelterGuide?.visibleSite ?? null,
      journeyWaypoint: openingGardenAvailable(this.state) ? this.gardenGuide?.visibleWaypoint ?? null : this.supplyRunGuide?.visibleWaypoint ?? null,
      target: this.presentationTarget,
      gathering: this.time.now < this.gatheringUntil,
      gatherKind: this.time.now < this.gatheringUntil ? this.gatheringKind : null,
      gatherProgress: Math.max(0,Math.min(1,1-(this.gatheringUntil-this.time.now)/280)),
      playerAction:this.playerActionVisual&&this.time.now-this.playerActionVisual.startedAt<600
        ?{id:this.playerActionVisual.startedAt,arrowTracked:this.playerActionVisual.arrowTracked,kind:this.playerActionVisual.kind,progress:Math.max(0,(this.time.now-this.playerActionVisual.startedAt)/600),x:this.playerActionVisual.x,y:this.playerActionVisual.y}:null,
      tameThrow: this.tameThrowVisual && this.time.now - this.tameThrowVisual.id < 1200 ? this.tameThrowVisual : null,
      gatherAssistance: this.gatherAssistance && this.time.now - this.gatherAssistance.startedAt < 900
        ? { ...this.gatherAssistance, progress: Math.max(0, (this.time.now - this.gatherAssistance.startedAt) / 900) } : null,
      prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }

  /**
   * A wild creature's floating label: its tame chance, drawn as a bar, plus
   * whatever state is feeding it right now. The words are the telegraph —
   * "Staggered" is the cue to throw.
   */
  private creatureTargetPresentation(creature: WildCreatureState): InteractionTargetPresentation {
    const chance = tameChance(this.state, creature).chanceBps;
    const status = isStaggered(this.state, creature) ? ' · Staggered!' : isEating(this.state, creature) ? ' · Eating' : '';
    return {
      kind: 'creature', id: creature.id, x: creature.x, y: creature.y,
      label: `Tame ${Math.floor(chance / 100)}%${status}`,
      value: creature.hp, maxValue: creature.maxHp, tameBps: chance,
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

  /**
   * Dev-only composition entry point for deterministic room screenshot QA:
   * stands the player just inside the doorway of a building in this area.
   */
  previewTownInteriorForQa(buildingId: TownBuildingId): void {
    if (!import.meta.env.DEV) throw new Error('interior previews are available only in development builds');
    if (this.interiorSession.isActive) {
      this.npcDialogue.close();
      this.npcDialogueController.close();
      this.npcServiceOverlay.close();
      this.interiorSession.recoverToWorld();
    }
    const building = townBuildingsInArea(this.state.currentArea.key).find((candidate) => candidate.id === buildingId)
      ?? townBuildingById(buildingId);
    const threshold = shellThreshold(townBuildingShell(building));
    resetGridMovement(this.gridMovement);
    this.state.player.x = Math.round((building.footprint.tileX + threshold.x) * TILE_SIZE);
    this.state.player.y = Math.round((building.footprint.tileY + threshold.y) * TILE_SIZE);
    this.snapRenderPoseToState();
    this.onCriticalChanged();
  }

  init(data: WorldSceneData): void {
    // Interior pose is intentionally transient. A scene restart or loaded save
    // always resumes at the authoritative exterior position.
    this.interiorSession.recoverToWorld();
    this.townVisitKey = null;
    this.state = data.state ?? createInitialState(DEFAULT_WORLD_SEED);
    recoverPlayerFromTownWalls(this.state);
    this.globalBalance = data.globalBalance ?? globalBalanceService;
    if (data.onStateChanged) {
      this.onMoved = () => data.onStateChanged?.('ordinary');
      this.onCriticalChanged = () => data.onStateChanged?.('critical');
    }
    this.onTransitionStarted = data.onTransitionStarted ?? (() => {});
    this.systemControls = data.system ?? {};
  }

  create(): void {
    this.gatherAssistance = null;
    this.hudDirty = true;
    this.lastHudRefreshAt = Number.NEGATIVE_INFINITY;
    this.buildResourceNodes();
    this.syncWildCreatures();
    this.syncGroundDrops();

    this.previousPlayerX = this.state.player.x;
    this.previousPlayerY = this.state.player.y;

    // Above the atmospheric wash and every structure, below the HUD: a marker
    // the player has three seconds to read must never sit under a roof.
    this.setupInput();
    const parent = document.getElementById('app') ?? document.body;
    this.openingPanel = new OpeningPartnershipPanel(parent, this.state, {
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
      onUpgradeFacility: (buildingId) => this.performBaseUpgrade(upgradeFacility(this.state, buildingId)),
      onTemperTool: (toolId, axis) => this.performBaseUpgrade(temperTool(this.state, toolId, axis)),
      onScrapTool: (toolId) => this.performBaseUpgrade(scrapTool(this.state, toolId)),
      onUnloadTurretAmmo: (turretId, amount) => this.performTurretAmmo(unloadTurretAmmo(this.state, turretId, amount)),
    });
    this.buildMode = new BuildModeController(this.state, {
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
      onStartUpgrading: () => {
        this.inventoryPanel.close();
        this.buildingItemMenu.close();
        this.buildMode.startDeleting('upgrade');
      },
      onUpgradeConfirm: () => this.upgradeSelectedPart(false),
      onUpgradeRoomConfirm: () => this.upgradeSelectedPart(true),
      onOpened: () => {
        this.inventoryPanel.toggleTab('craft');
      },
    });
    this.hotbar = new Hotbar(parent, this.state, {
      onEquipTool: (toolId) => this.performToolCommand(() => equipTool(this.state, toolId), false),
      onEquipBareHands: () => this.performToolCommand(() => equipBareHands(this.state), false),
      onUseItem: (resource) => this.performHotbarItem(resource),
    });
    this.inventoryPanel = new InventoryPanel(parent, this.state, {
      onEquipTool: (toolId) => this.performToolCommand(() => equipTool(this.state, toolId), false),
      onAssignHotbar: (toolId) => this.hotbar.assign(toolId),
      isOnHotbar: (toolId) => this.hotbar.isAssigned(toolId),
      onAssignHotbarItem: (resource) => this.hotbar.assignItem(resource),
      isItemOnHotbar: (resource) => this.hotbar.isItemAssigned(resource),
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
      onQuitToMenu: () => this.systemControls.quitToMenu?.(),
    });
    this.adminPanel = new AdminPanel(parent, this.state, () => {
      this.snapRenderPoseToState();
      this.onCriticalChanged();
      this.refreshHudNow();
    }, this.globalBalance, this.systemControls);
    this.adminPanel.attachToMenu(this.inventoryPanel);
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
      onClaim: () => this.performToolCommand(() => claimOpeningDiscovery(this.state), true),
      onRecover: () => this.performToolCommand(() => recoverOpeningSupplies(this.state), true),
      onSideCache: () => this.performToolCommand(() => openOpeningSideCache(this.state), true),
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
      this.refreshHudNow();
    }, (building) => {
      // Closing the service panel leaves the player standing at the counter.
      this.interiorSession.endConversation();
      if (this.recentNpcPurchase?.npcId === building.npcId) this.showNpcBark(building.npcId, 'afterService');
      this.refreshHudNow();
    });
    this.showAreaSplash(parent);

    this.loop = new FixedStepLoop(FIXED_STEP_MS, (stepMs) => {
      if (this.openingPanel.isOpen) return;
      this.previousPlayerX = this.state.player.x;
      this.previousPlayerY = this.state.player.y;
      const acceptingQueuedStep = this.queuedStep !== null && !this.gridMovement.moving;
      this.hudDirty = true;
      const discoveriesBefore = this.state.regionalProgress.discoveredLandmarkIds.length;
      if (stepMovement(
        this.state,
        this.intent,
        stepMs,
        this.gridMovement,
        (result) => this.onExposureDefeat(result),
        (reports) => this.onAbsentBaseRaids(reports),
        undefined,
        (result) => this.onSiteSearch(result),
      )) {
        // Wildlife can change every tick. Batch visual work after all catch-up
        // steps and use ordinary autosaves for these ongoing simulation changes.
        this.simulationVisualsDirty = true;
      }
      if (acceptingQueuedStep && (this.gridMovement.moving
        || this.state.player.x !== this.previousPlayerX || this.state.player.y !== this.previousPlayerY)) {
        this.queuedStep = null;
        this.intent = { ...NO_MOVE, sprint: this.intent.sprint === true };
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

    this.updateEntityChunkActivation();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
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
    if (!this.interiorSession.allowsWorldInteraction) return { ok: false, message: 'Finish your conversation before using a waystone.' };
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

  override update(_time: number, deltaMs: number): void {
    this.respawnPanel.refresh();
    this.frameTimes.record(deltaMs);
    if (this.transitioningArea) {
      this.intent = NO_MOVE;
      this.queuedStep = null;
      return;
    }
    const inputBlocked = this.state.pendingRespawn || this.openingPanel.isOpen || this.adminPanel.open || this.navigator.largeMapOpen;
    this.updateFirstPersonMode(deltaMs, Boolean(inputBlocked));
    this.intent = inputBlocked
      ? NO_MOVE
      : this.interiorSession.allowsWorldInteraction
        ? this.gatherInput()
        : NO_MOVE;
    // The last direction the player moved is where a snare goes when nothing
    // is locked: "in front of the character" in the free-movement sense.
    if (this.intent.x !== 0 || this.intent.y !== 0) this.lastAim = { x: this.intent.x, y: this.intent.y };
    const areaKeyBeforeMovement = this.state.currentArea.key;
    const movingBefore = this.gridMovement.moving;
    const poseBefore = this.queuedStepPose();
    const alpha = this.loop.advance(deltaMs);
    if (this.state.currentArea.key !== areaKeyBeforeMovement) {
      this.beginAreaTransition();
      return;
    }
    if (this.simulationVisualsDirty) {
      this.simulationVisualsDirty = false;
      this.syncResourceIndex();
      this.syncGroundDrops();
      this.buildMode.syncPlaced();
      this.onMoved();
    }
    this.updateTownVisit();
    this.retireQueuedStep(movingBefore, poseBefore);
    if (this.interiorSession.allowsWorldInteraction
      && (this.state.player.x !== poseBefore.x || this.state.player.y !== poseBefore.y)) this.onMoved();
    if (!inputBlocked) this.updateSustainedFire();

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
    this.updateEntityChunkActivation();
    this.syncWildCreaturePositions();
    this.navigator.refresh();
    this.updateTargetIndicators();
    this.updateCrosshairTarget();
    this.updateSiteHud();
    this.syncFacilityInteraction();
    this.refreshHudIfDue();
  }

  /**
   * First person is what the player asked for, unless something that needs
   * the overhead view is open: build mode, an interior, or the taming stage.
   * The request survives those, so the view comes back when they close.
   */
  private updateFirstPersonMode(deltaMs: number, inputBlocked: boolean): void {
    const active = firstPersonView.requested === 'first-person'
      && !this.transitioningArea
      && !this.buildMode.placing
      && !this.buildMode.deleteMode
      && !this.state.pendingRespawn;
    if (active && !this.firstPersonLookPrimed) {
      // Look down the overhead view's "up", so the first step forward goes the
      // way the stick went a moment ago.
      firstPersonView.look.yawDegrees = cameraOrientationFromTenths(this.state.gameBalance.camera).yawDegrees;
      firstPersonView.look.pitchDegrees = 0;
      this.firstPersonLookPrimed = true;
    }
    if (active !== this.wasFirstPerson) this.entityActivationDirty = true;
    this.wasFirstPerson = active;
    firstPersonView.active = active;
    // Keyboard fallback for desktop: E is the action key, so the arrows turn.
    // The turn is applied directly from the held key, with no easing.
    if (active && !inputBlocked && this.altKeys) {
      const turn = (this.altKeys.left.isDown ? 1 : 0) - (this.altKeys.right.isDown ? 1 : 0);
      if (turn !== 0) firstPersonView.look.turnBy(turn * KEYBOARD_TURN_DEGREES_PER_SECOND * Math.min(deltaMs, 100) / 1000);
    }
  }

  /** Pick what the crosshair is on and hand it to the HUD and the focus ring. */
  private updateCrosshairTarget(): void {
    if (!firstPersonView.active) {
      this.crosshairTarget = null;
      this.firstPersonHud?.update(false, null, null);
      return;
    }
    const target = pickCrosshairTarget(
      this.state.player,
      groundForward(firstPersonView.look.yawDegrees),
      this.crosshairCandidates(),
    );
    this.crosshairTarget = target;
    if (target?.kind === 'resource') {
      const node = this.resourceNodesById.get(target.id) ?? null;
      this.hud.setContextActionOverride(null);
      this.hud.refreshTargets(node, null, null, resolveCombatTarget(this.state, { kind: 'resource', id: target.id }, 'melee'));
    }
    if (target && target.kind !== 'raider' && target.kind !== 'building') {
      this.presentationTarget = { kind: target.kind, id: target.id, x: target.x, y: target.y, label: target.label };
    } else if (target) {
      this.presentationTarget = { kind: 'creature', id: target.id, x: target.x, y: target.y, label: target.label };
    }
    const building = target?.kind === 'building' || target?.kind === 'facility' ? this.buildingsById.get(target.id) ?? null : null;
    this.firstPersonHud?.update(true, target?.label ?? null, building
      ? {
          label: isStructureDamaged(building) ? 'Repair' : 'Inspect',
          run: () => this.openBuildingItemMenu(building, window.innerWidth / 2, window.innerHeight / 2),
        }
      : null);
  }

  /** Everything a tap could have meant, as ground points with a reach. */
  private *crosshairCandidates(): Generator<CrosshairCandidate> {
    const strikeReach = strikeReachPx(this.state);
    const combatReach = Math.max(strikeReach, TAMING_RANGE_PX, TILE_SIZE * 8);
    for (const raider of this.state.raiders) {
      yield { kind: 'raider', id: raider.id, x: raider.x, y: raider.y, label: 'Raider', reachPx: combatReach };
    }
    for (const creature of this.state.wildCreatures) {
      yield {
        kind: 'creature', id: creature.id, x: creature.x, y: creature.y,
        label: creatureDefinition(creature.speciesId).displayName, reachPx: combatReach,
      };
    }
    for (const node of this.state.resourceNodes) {
      if (node.hp <= 0) continue;
      yield {
        kind: 'resource', id: node.id, x: node.x, y: node.y,
        label: node.kind === 'berry-bush' ? 'Berry bush' : node.kind[0]!.toUpperCase() + node.kind.slice(1),
        reachPx: strikeReach,
      };
    }
    for (const drop of this.state.groundDrops) {
      yield { kind: 'drop', id: drop.id, x: drop.x, y: drop.y, label: `Pick up ${drop.amount} ${drop.resource}`, reachPx: INTERACTION_RANGE_PX };
    }
    for (const site of liveAreaSites(this.state)) {
      const searched = currentSiteProgress(this.state, site.id).searched;
      for (const container of site.containers) {
        if (searched.includes(container.index)) continue;
        yield {
          kind: 'site-container', id: `${site.id}#${container.index}`, x: container.x, y: container.y,
          label: `Search ${containerLabelFor(container)}`, reachPx: INTERACTION_RANGE_PX,
        };
      }
    }
    for (const building of this.buildingsById.values()) {
      const facility = FACILITY_PANEL_DEFINITIONS.has(building.definitionId);
      yield {
        kind: facility ? 'facility' : 'building', id: building.id,
        x: (building.tileX + 0.5) * TILE_SIZE, y: (building.tileY + 0.5) * TILE_SIZE,
        label: buildableById(building.definitionId).displayName,
        reachPx: facility ? FACILITY_INTERACTION_RANGE_PX : TILE_SIZE * 3,
      };
    }
    const townBench = elarisPublicWorkbenchFacility(this.state);
    if (townBench) {
      yield {
        kind: 'facility', id: townBench.id,
        x: (townBench.tileX + 0.5) * TILE_SIZE, y: (townBench.tileY + 0.5) * TILE_SIZE,
        label: 'Workbench', reachPx: FACILITY_INTERACTION_RANGE_PX,
      };
    }
    // Keepers and things to examine, in the building the player stands in.
    const building = townBuildingAroundPlayer(this.state);
    if (building) {
      for (const hotspot of interiorDefinitionForBuilding(building.id).hotspots) {
        yield {
          kind: 'town-hotspot', id: `${building.id}:${hotspot.id}`,
          x: Math.round((building.footprint.tileX + hotspot.x) * TILE_SIZE),
          y: Math.round((building.footprint.tileY + hotspot.y) * TILE_SIZE),
          label: townHotspotLabel(hotspot), reachPx: INTERIOR_INTERACTION_RANGE_TILES * TILE_SIZE,
        };
      }
    }
  }

  /**
   * What the action button says near a site: "Searching…" while a search runs,
   * else "Search Crate" for the crate under the crosshair (first person) or the
   * nearest crate in reach (overhead).
   */
  private siteContextAction(): { label: string; hint: string } | null {
    if (this.state.activeSearch) return { label: 'Searching…', hint: 'Hold still · moving or a hit stops the search' };
    if (firstPersonView.active) {
      return this.crosshairTarget?.kind === 'site-container'
        ? { label: this.crosshairTarget.label, hint: `${this.crosshairTarget.label} · E / Space` }
        : null;
    }
    const nearest = nearestSearchableContainer(this.state);
    if (!nearest) return null;
    const label = `Search ${containerLabelFor(nearest.container)}`;
    return { label, hint: `${label} · E / Space` };
  }

  /** An unsearched site container under an overhead tap, if any. */
  private siteContainerAtWorld(worldX: number, worldY: number): { siteId: string; index: number } | null {
    for (const site of liveAreaSites(this.state)) {
      const searched = currentSiteProgress(this.state, site.id).searched;
      for (const container of site.containers) {
        if (searched.includes(container.index)) continue;
        if (Math.abs(worldX - container.x) <= TILE_SIZE * 0.75 && Math.abs(worldY - container.y) <= TILE_SIZE * 0.75) {
          return { siteId: site.id, index: container.index };
        }
      }
    }
    return null;
  }

  private performSiteSearch(siteId: string, containerIndex: number): void {
    const result = beginSiteSearch(this.state, siteId, containerIndex);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) this.simulationVisualsDirty = true;
    this.refreshHudNow();
  }

  /** A search finished or was cut short this tick. */
  private onSiteSearch(result: SiteSearchResult): void {
    if (result.kind === 'interrupted') {
      this.hud.showFeedback(result.message, false);
      return;
    }
    this.hud.showFeedback(result.message, true);
    result.gains.forEach(([resource, amount], index) => {
      this.spawnFloatingText(this.state.player.x, this.state.player.y - index * 9, `+${amount} ${resource.replaceAll('-', ' ')}`);
    });
    this.hud.showResourceTotals(result.gains.map(([resource]) => `${this.state.inventory[resource]} ${resource.replaceAll('-', ' ')}`));
    if (result.spilled.length > 0) this.syncGroundDrops();
    this.simulationVisualsDirty = true;
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  /** Compass strip and search ring; both are placed straight from state, no easing. */
  private updateSiteHud(): void {
    const firstPerson = firstPersonView.active;
    if (this.compassStrip) {
      if (firstPerson) {
        // Unrounded, so the strip turns exactly with the view rather than in whole-degree steps.
        const heading = ((-firstPersonView.look.yawDegrees % 360) + 360) % 360;
        this.compassStrip.update(true, compassMarks(heading), compassPips(this.state.player, heading, compassTargets(this.state), TILE_SIZE));
      } else {
        this.compassStrip.update(false, [], []);
      }
    }
    this.searchRing?.update(siteSearchProgress(this.state), firstPerson);
  }

  /** The action button in first person: act on the crosshair target exactly as a tap on it would. */
  private performCrosshairAction(target: CrosshairCandidate): void {
    switch (target.kind) {
      case 'raider':
        this.stickyTarget = { kind: 'raider', id: target.id };
        this.performPlayerShot(target.id);
        return;
      case 'creature':
        if (isOpeningTuftle(this.state, target.id)) { this.performOpeningTrust(); return; }
        this.stickyTarget = { kind: 'creature', id: target.id };
        this.performCreatureAttack(target.id);
        return;
      case 'resource':
        this.stickyTarget = { kind: 'resource', id: target.id };
        this.performContextAction(target.id);
        return;
      case 'facility': {
        const building = this.buildingsById.get(target.id) ?? elarisPublicWorkbenchFacility(this.state);
        if (building) this.openFacilityInteraction(building);
        return;
      }
      case 'site-container': {
        const split = target.id.lastIndexOf('#');
        this.performSiteSearch(target.id.slice(0, split), Number(target.id.slice(split + 1)));
        return;
      }
      case 'town-hotspot': {
        const hotspot = this.townHotspotById(target.id);
        if (hotspot) this.performTownHotspot(hotspot);
        return;
      }
      default:
        this.performContextAction();
    }
  }

  getPerformanceSnapshot(): WorldPerformanceSnapshot {
    return {
      frameTimes: this.frameTimes.snapshot(33.33),
      areaTransitions: this.areaTransitionTimes.snapshot(),
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
    const {x,y} = this.state.player;
    // First person sees out to its fog in every direction, not a view rectangle.
    const extent = TILE_SIZE * (firstPersonView.active ? FIRST_PERSON_VIEW_RADIUS_TILES : 24);
    const chunks = activeEntityChunkKeys(chunkViewRectAround(x, y, extent),1);
    const signature = [...chunks].join('|');
    if (!this.entityActivationDirty && signature === this.activeChunkSignature) return;
    const activate = (index: EntityChunkIndex, ids: Set<string>): EntityActivationCounts => {
      ids.clear(); for (const id of index.idsInChunks(chunks)) ids.add(id);
      return {active:ids.size,total:index.size};
    };
    const resources=activate(this.resourceChunks,this.activeResourceIds), drops=activate(this.dropChunks,this.activeDropIds), creatures=activate(this.creatureChunks,this.activeCreatureIds);
    const structures={active:this.buildingChunks.idsInChunks(chunks).size,total:this.buildingChunks.size};
    this.entityActivation={resources,drops,creatures,structures,active:resources.active+drops.active+creatures.active+structures.active,total:resources.total+drops.total+creatures.total+structures.total};
    this.activeChunkSignature=signature; this.entityActivationDirty=false;
  }

  private buildResourceNodes(): void {
    this.resourceChunks.clear(); this.resourceNodesById.clear();
    for (const node of this.state.resourceNodes) { this.resourceNodesById.set(node.id,node); this.resourceChunks.upsert(node.id,node.x,node.y); }
    this.entityActivationDirty = true;
  }

  private syncResourceIndex(): void { this.buildResourceNodes(); }

  private syncGroundDrops(): void {
    this.dropChunks.clear(); this.dropsById.clear();
    for (const drop of this.state.groundDrops) { this.dropsById.set(drop.id,drop); this.dropChunks.upsert(drop.id,drop.x,drop.y); }
    this.entityActivationDirty = true;
  }

  private syncWildCreatures(): void {
    this.creatureChunks.clear(); this.creaturesById.clear();
    for (const creature of this.state.wildCreatures) { this.creaturesById.set(creature.id,creature); this.creatureChunks.upsert(creature.id,creature.x,creature.y); }
    this.entityActivationDirty = true;
  }

  private syncWildCreaturePositions(): void {
    for (const creature of this.state.wildCreatures) {
      const previousChunk = this.creatureChunks.chunkOf(creature.id);
      this.creatureChunks.upsert(creature.id,creature.x,creature.y);
      if (previousChunk !== entityChunkKey(creature.x,creature.y)) this.entityActivationDirty = true;
    }
  }

  /** Facility levels, tempering and scrapping: save at once, and redraw the levelled mesh. */
  private performBaseUpgrade(result: { ok: boolean; message: string }): void {
    this.hud.showFeedback(result.message, result.ok);
    if (!result.ok) return;
    this.buildMode.syncPlaced();
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  private performTurretAmmo(result: CommandResult): void {
    this.hud.showFeedback(result.message, !result.ok);
    if (!result.ok) return;
    this.buildMode.syncPlaced();
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  private raiderAtWorld(x: number, y: number): RaiderState | null { return entityAtWorld(this.state.raiders,x,y); }

  /**
   * Shoot a raider. A raid is real-time; clicking a raider always shoots.
   */
  private performPlayerShot(raiderId?: string): void {
    const swingStyle = this.heldStrikeVisualStyle();
    // Health before the swing, so damage can be derived here rather than made
    // part of the simulation's return contract. Either command can pick its own
    // target when none is named, so every raider is snapshotted.
    const before = new Map(this.state.raiders.map(raider => [raider.id, { ...raider }]));

    // The bow stays the primary answer whenever it can actually fire — it hits
    // far harder than an axe used as a club. Melee is the fallback for the
    // player caught with no bow, no arrows, or a raider already on top of them.
    let style: StrikeStyle = 'ranged';
    let result = firePlayerShot(this.state, raiderId);
    if (!result.ok) {
      const swing = strikeRaiderMelee(this.state, raiderId);
      if (swing.ok) {
        style = swingStyle;
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
    // than by tapping its model — would never light up or name itself.
    if (result.raiderId && !result.killed) this.stickyTarget = { kind: 'raider', id: result.raiderId };
    this.reportRaiderHit(result.raiderId, before, style);
    this.syncGroundDrops();
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
    if (!this.interiorSession.allowsWorldInteraction) return;
    if (this.buildMode.placing || this.buildMode.deleteMode || this.interiorSession.ownsOverlayInput) return;
    // Repeating before the cooldown clears would replace the hit message with
    // "Not ready yet" on every frame and nothing else.
    if (this.state.tick < this.state.actionCooldownUntilTick) return;
    if (firstPersonView.active && this.crosshairTarget?.kind === 'resource') {
      if (!equippedBow(this.state)) this.performContextAction(this.crosshairTarget.id);
      return;
    }
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
    if (!firstPersonView.active && this.sustainedGatherNode()) this.performContextAction();
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
    if (this.nearbyTownHotspot()) return null;
    if (nearestUnopenedContainer(this.state)) return null;
    if (this.state.activeSearch || nearestSearchableContainer(this.state)) return null;
    const nearby = this.findNearbyTargets();
    if ((nearby.bed?.garden?.readyFiber ?? 0) > 0) return null;
    if ((nearby.planter?.woodlot?.readyWood ?? 0) > 0) return null;
    if (this.stickyTarget?.kind === 'resource') {
      const locked = this.resourceNodesById.get(this.stickyTarget.id);
      return locked && locked.hp > 0 && Math.hypot(locked.x - this.state.player.x, locked.y - this.state.player.y) <= strikeReachPx(this.state) ? locked : null;
    }
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

  /** Snapshot the held weapon's visual style before a hit can break it. */
  private heldStrikeVisualStyle(): StrikeStyle {
    const tool = this.state.tools.find(tool => tool.instanceId === this.state.equippedToolId);
    return tool && gameToolDefinition(this.state, tool.definitionId).kind === 'staff' ? 'magic' : 'melee';
  }

  /** Float a damage number and refresh the health bar for a struck raider. */
  private reportRaiderHit(raiderId: string | undefined, before: ReadonlyMap<string, RaiderState>, style: StrikeStyle): void {
    const struck = raiderId ? before.get(raiderId) : undefined;
    if (struck) this.playerActionVisual={kind:style,startedAt:this.time.now,x:struck.x,y:struck.y,arrowTracked:style==='ranged'};
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

  private renderPlayerPose(alpha: number): void {
    this.renderPlayerPosition=interpolateRenderPoint({x:this.previousPlayerX,y:this.previousPlayerY},this.state.player,alpha);
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
    this.compassStrip?.destroy();
    this.compassStrip = new CompassStrip(parent);
    this.searchRing?.destroy();
    this.searchRing = new SearchProgressRing(parent);
    this.firstPersonHud?.destroy();
    this.firstPersonHud = new FirstPersonHud(parent, firstPersonView, () => {
      if (firstPersonView.requested === 'first-person') this.firstPersonLookPrimed = false;
      this.entityActivationDirty = true;
    });
  }

  /** World coordinates resolved against the visible Three.js ground plane. */
  handle3DWorldPointer(
    worldX: number,
    worldY: number,
    intent: 'tap' | 'long-press' | 'hover' | 'paint-start' | 'paint-move' | 'paint-end',
    clientX: number,
    clientY: number,
  ): void {
    if (this.state.pendingRespawn || !this.interiorSession.allowsWorldInteraction) return;
    // First person has no world taps: the canvas is the look pad, and the
    // action button acts on the crosshair instead.
    if (firstPersonView.active) return;
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

  /** E, Space, and the Gather button confirm an active placement ghost. */
  private performInteractAction(): void {
    if (this.openingPanel.isOpen) return;
    if (!this.interiorSession.allowsWorldInteraction) return;
    if (this.buildMode.placing) {
      this.buildMode.confirm();
      return;
    }
    // Delete is deliberately not on the context button: demolishing is only
    // ever the Delete control, never the same press that gathers.
    if (this.buildMode.deleteMode) return;
    if (firstPersonView.active && this.crosshairTarget) {
      this.performCrosshairAction(this.crosshairTarget);
      return;
    }
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
    if (!this.interiorSession.allowsWorldInteraction) return;
    // Raiders are checked before wild creatures: during a raid they are drawn
    // on top, and a click on one must shoot rather than strike the creature.
    const raider = this.raiderAtWorld(worldX, worldY);
    if (raider) {
      // Tapping a raider both locks it and fires: the first tap should never
      // feel like it did nothing, and every later press of the action button
      // then goes to the raider the player picked.
      this.stickyTarget = { kind: 'raider', id: raider.id };
      this.performPlayerShot(raider.id);
      return;
    }
    const tappedCrate = this.siteContainerAtWorld(worldX, worldY);
    if (tappedCrate) {
      this.performSiteSearch(tappedCrate.siteId, tappedCrate.index);
      return;
    }
    // A tap on a keeper (or the thing to examine) inside the player's
    // building talks to them; a tap anywhere else in the room is a floor tap.
    const tappedHotspot = this.townHotspotAtWorld(worldX, worldY);
    if (tappedHotspot) {
      this.performTownHotspot(tappedHotspot);
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

  private resourceAtWorld(x: number, y: number): ResourceNodeState | null { return entityAtWorld(this.state.resourceNodes.filter(node=>node.hp>0),x,y); }

  private creatureAtWorld(x: number, y: number): WildCreatureState | null { return entityAtWorld(this.state.wildCreatures,x,y); }

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
  private performContextAction(targetResourceId?: string): void {
    if (this.openingPanel.isOpen) return;
    const resourceId = targetResourceId ?? (this.stickyTarget?.kind === 'resource' ? this.stickyTarget.id : undefined);
    if (!resourceId && nearbyOpeningTuftle(this.state)) { this.performOpeningTrust(); return; }
    if (!this.interiorSession.allowsWorldInteraction) return;
    const inventoryBefore = { ...this.state.inventory };
    // A raider in range outranks every peacetime action: during the danger
    // minute the action button is the player's weapon, not their sickle.
    if (!resourceId && nearestRaiderInRange(this.state)) {
      this.performPlayerShot();
      return;
    }
    // A lock the player walked out of bow range of says so, rather than letting
    // the press fall through to "Move closer to a resource" — the button is
    // still labelled with that raider, and the two must agree.
    if (!resourceId && this.stickyTarget?.kind === 'raider' && this.state.raiders.some((raider) => raider.id === this.stickyTarget!.id)) {
      this.hud.showFeedback('Too far to shoot — move closer', false);
      return;
    }
    // A creature the player deliberately locked keeps the button, in range or
    // not — the label already names it, and silently gathering a bush instead
    // would contradict what the button says it will do.
    if (!resourceId && this.stickyTarget?.kind === 'creature'
      && this.state.wildCreatures.some((creature) => creature.id === this.stickyTarget!.id)) {
      this.performCreatureAttack(this.stickyTarget.id);
      return;
    }
    // A creature that is already hostile outranks peacetime actions for the
    // same reason a raider does: the button is a weapon while something is
    // biting you. Placid creatures are excluded by isHuntable, so walking past
    // a herd with a sword equipped never turns the button into a slaughter —
    // tapping one is still the only way to pick a fight with it.
    if (!resourceId && nearestHuntableCreature(this.state, this.playerEngageRangePx())) {
      this.performCreatureAttack();
      return;
    }
    const townHotspot = resourceId ? null : this.nearbyTownHotspot();
    if (townHotspot) {
      this.performTownHotspot(townHotspot);
      return;
    }
    // A site crate outranks gathering for the same reason a cache does.
    const siteContainer = resourceId ? null : nearestSearchableContainer(this.state);
    if (siteContainer) {
      this.performSiteSearch(siteContainer.site.id, siteContainer.container.index);
      return;
    }
    // A container outranks gathering: it is one-shot and the player walked to
    // it deliberately, so a tree behind it must never eat the press.
    if (!resourceId && nearestUnopenedContainer(this.state)) {
      const opened = openNearestContainer(this.state);
      if (opened.ok) {
        this.syncGroundDrops();
        this.onCriticalChanged();
      }
      if (opened.ok) this.reportResourceCollection(inventoryBefore);
      this.hud.showFeedback(opened.message, opened.ok);
      this.refreshHudNow();
      return;
    }
    const nearby = this.findNearbyTargets();
    const bed = nearby.bed;
    const bedReady = !resourceId && bed !== null && (bed.garden?.readyFiber ?? 0) > 0;
    const planter = nearby.planter;
    const planterReady = !resourceId && planter !== null && (planter.woodlot?.readyWood ?? 0) > 0;
    const node = resourceId ? this.state.resourceNodes.find(node => node.id === resourceId) ?? null : nearby.node;
    if (resourceId && !node) {
      this.hud.showFeedback('That resource is no longer available', false);
      return;
    }

    // With a bow in hand the button is a trigger, which is what its label now
    // says. A bow's damage table has only a raider row, so every branch below
    // this would have spent the press on a swing that cannot chop, mine, or
    // harvest anything. The three things a player walks up to on purpose still
    // outrank it — a ready harvest and a drop underfoot are not misfires — and
    // when nothing is in range the shot explains itself rather than silently
    // falling through to a no-op.
    if (!resourceId && equippedBow(this.state) && !bedReady && !planterReady && !nearby.drop) {
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
      result = resourceId ? gatherResource(this.state, resourceId) : gatherNearest(this.state);
      if (result.ok) {
        this.stickyTarget = { kind: 'resource', id: result.targetId ?? node.id };
      }
    } else {
      result = collectNearestGroundDrop(this.state);
      if (!result.ok && !result.targetId) {
        // A wall is only ever hit deliberately: the player must be facing it
        // within melee reach, and nothing above it in this chain was actionable.
        // It still outranks the bed/planter fallbacks, which are status text.
        const wall = nearestFacedWall(this.state);
        if (wall) {
          result = attackFacedWall(this.state, wall.id);
          wallStruck = result.ok && result.depleted !== true;
          if (result.ok) this.onWallDamaged(wall, result.depleted === true);
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
    const blockedGather = !result.ok && result.message !== 'Not ready yet';
    if (blockedGather || (!wallStruck && !(node && !bedReady && !planterReady))) this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      if (result.critical) this.onCriticalChanged();
      else this.onMoved();
      if (node && !bedReady && result.targetId) {
        this.gatheringKind = node.kind;
        this.gatheringUntil = this.time.now + 280;
      }
      this.syncGroundDrops();
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

  /**
   * Notice the player stepping through a doorway: the room's soundscape takes
   * over and the keeper greets them; stepping back out restores the world's.
   * Nothing moves the player — walking in and out is ordinary walking.
   */
  private updateTownVisit(): void {
    const building = townBuildingAroundPlayer(this.state);
    const key = building ? `${building.areaKey}:${building.id}` : null;
    if (key === this.townVisitKey) return;
    this.townVisitKey = key;
    this.interiorAudio.leave();
    if (!building) {
      this.npcBark.hide();
      return;
    }
    this.interiorAudio.enter(interiorDefinitionById(building.interiorId).ambience.soundscape);
    this.showNpcBark(building.npcId, 'arrival');
  }

  /** The nearest hotspot in reach inside the building the player stands in. */
  private nearbyTownHotspot(): TownHotspotTarget | null {
    const building = townBuildingAroundPlayer(this.state);
    if (!building) return null;
    const interior = interiorDefinitionForBuilding(building.id);
    const hotspot = nearestInteriorHotspot(interior,
      this.state.player.x / TILE_SIZE - building.footprint.tileX,
      this.state.player.y / TILE_SIZE - building.footprint.tileY);
    return hotspot ? this.townHotspotTarget(building, hotspot) : null;
  }

  private townHotspotTarget(building: TownBuildingDefinition, hotspot: InteriorHotspot): TownHotspotTarget {
    return {
      building, hotspot,
      x: Math.round((building.footprint.tileX + hotspot.x) * TILE_SIZE),
      y: Math.round((building.footprint.tileY + hotspot.y) * TILE_SIZE),
    };
  }

  /** Resolve a `${buildingId}:${hotspotId}` target id in the player's building. */
  private townHotspotById(id: string): TownHotspotTarget | null {
    const building = townBuildingAroundPlayer(this.state);
    if (!building || !id.startsWith(`${building.id}:`)) return null;
    const hotspotId = id.slice(building.id.length + 1);
    const hotspot = interiorDefinitionForBuilding(building.id).hotspots.find((candidate) => candidate.id === hotspotId);
    return hotspot ? this.townHotspotTarget(building, hotspot) : null;
  }

  /** The hotspot a world tap landed on, inside the building the player stands in. */
  private townHotspotAtWorld(worldX: number, worldY: number): TownHotspotTarget | null {
    const building = townBuildingAroundPlayer(this.state);
    if (!building) return null;
    const interior = interiorDefinitionForBuilding(building.id);
    const tapped = nearestInteriorHotspot(interior,
      worldX / TILE_SIZE - building.footprint.tileX,
      worldY / TILE_SIZE - building.footprint.tileY, 0.85);
    return tapped ? this.townHotspotTarget(building, tapped) : null;
  }

  private performTownHotspot(target: TownHotspotTarget): void {
    const distance = Math.hypot(target.x - this.state.player.x, target.y - this.state.player.y) / TILE_SIZE;
    if (distance > INTERIOR_INTERACTION_RANGE_TILES + 0.05) {
      this.hud.showFeedback(target.hotspot.kind === 'service'
        ? `Move closer to ${npcDefinition(target.hotspot.npcId).name}`
        : `Move closer to ${target.hotspot.label.toLowerCase()}`, false);
      return;
    }
    if (target.hotspot.kind === 'examine') {
      this.hud.showFeedback(target.hotspot.text, true);
      return;
    }
    this.openNpcDialogue(target.building.id, target.hotspot.npcId);
  }

  private openNpcDialogue(buildingId: TownBuildingId, npcId: NpcId): void {
    resetGridMovement(this.gridMovement);
    this.intent = NO_MOVE;
    this.interiorSession.beginDialogue(buildingId, npcId);
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
    this.npcBark.hide();
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
    this.interiorSession.endConversation();
    this.refreshHudNow();
  }

  private showNpcBark(npcId: NpcId, kind: 'arrival' | 'nearby' | 'afterService'): void {
    const bark = this.npcBarkController.request(npcId, kind, performance.now());
    if (bark) this.npcBark.show(bark);
  }

  /**
   * Throw a snare at the locked creature, which is the way into taming now that
   * a tap on a creature is a swing. Deliberately an explicit, separate press:
   * the whole point of the split is that wanting something dead and wanting it
   * alive can never be the same gesture.
   */
  /**
   * The creature both taming buttons act on: the lock while it is within
   * throwing range, otherwise the nearest one that is. It does not insist on a
   * lock, because a tap is a swing — and a swing sends a skittish creature
   * running, so "select it first" would be the one way to lose a stag.
   */
  private tameCandidate(): WildCreatureState | null {
    if (this.openingPanel?.isOpen || this.state.pendingRespawn) return null;
    const crosshairCreatureId = firstPersonView.active && this.crosshairTarget?.kind === 'creature'
      ? this.crosshairTarget.id
      : null;
    const lockedId = crosshairCreatureId ?? (this.stickyTarget?.kind === 'creature' ? this.stickyTarget.id : null);
    const locked = lockedId
      ? this.state.wildCreatures.find((creature) => creature.id === lockedId) ?? null
      : null;
    if (locked && locked.hp > 0
      && Math.hypot(locked.x - this.state.player.x, locked.y - this.state.player.y) <= SNARE_THROW_RANGE_PX) return locked;
    const nearest = nearestWildCreature(this.state, SNARE_THROW_RANGE_PX);
    return nearest && !isOpeningTuftle(this.state, nearest.id) ? nearest : null;
  }

  /**
   * Use a food or snare slot from the hotbar. Food goes to the creature close
   * enough to feed; a snare is thrown in front of the character — at the lock
   * when there is one in range, otherwise along the first-person look or the
   * last direction moved — and resolves on whatever it hits.
   */
  private performHotbarItem(resource: ResourceId): void {
    if (this.openingPanel.isOpen || this.state.pendingRespawn || !this.interiorSession.allowsWorldInteraction) return;
    const crosshairCreatureId = firstPersonView.active && this.crosshairTarget?.kind === 'creature' ? this.crosshairTarget.id : null;
    const lockedCreatureId = crosshairCreatureId ?? (this.stickyTarget?.kind === 'creature' ? this.stickyTarget.id : null);
    const forward = firstPersonView.active ? groundForward(firstPersonView.look.yawDegrees) : this.lastAim;
    const inventoryBefore = { ...this.state.inventory };
    const wasBefriended = this.state.onboarding.completedMilestoneIds.includes('befriend-tuftle');
    const result = useHotbarItem(this.state, resource, {
      dirX: Math.round(forward.x * 1_000), dirY: Math.round(forward.y * 1_000), lockedCreatureId,
    });
    this.hud.showFeedback(result.message, result.ok && !result.missed && !result.landed);
    if (!result.ok) { this.refreshHudNow(); return; }
    if (result.thrownTo) {
      this.tameThrowVisual = { id: this.time.now, outcome: result.tamed ? 'tamed' : 'missed', ...result.thrownTo };
      if (!result.landed) this.spawnFloatingText(result.thrownTo.x, result.thrownTo.y, result.tamed ? 'Tamed!' : 'Broke free!');
    }
    if (result.fed && result.creatureId) {
      const fed = this.state.wildCreatures.find((wild) => wild.id === result.creatureId);
      if (fed) this.spawnFloatingText(fed.x, fed.y, 'Eating…');
    }
    if (result.tamed) { this.stickyTarget = null; this.syncWildCreatures(); }
    if (result.landed) this.syncGroundDrops();
    this.reportResourceCollection(inventoryBefore);
    this.onCriticalChanged();
    if (!wasBefriended && this.state.onboarding.completedMilestoneIds.includes('befriend-tuftle')) this.openingPanel.openName();
    this.refreshHudNow();
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
    this.hud.showFeedback(result.message, result.ok);
    if (!result.ok) return;
    this.areaSplash?.remove();
    this.areaSplash = null;
    this.syncGroundDrops();
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  private performCreatureAttack(creatureId?: string): void {
    const swingStyle = this.heldStrikeVisualStyle();
    if (this.openingPanel.isOpen) return;
    if (creatureId && isOpeningTuftle(this.state, creatureId)) { this.performOpeningTrust(); return; }
    const before = new Map(this.state.wildCreatures.map(creature => [creature.id, { ...creature }]));

    let style: StrikeStyle = 'ranged';
    let result = fireCreatureShot(this.state, creatureId);
    if (!result.ok) {
      const swing = strikeCreatureMelee(this.state, creatureId);
      if (swing.ok) {
        style = swingStyle;
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
    before: ReadonlyMap<string, WildCreatureState>,
    style: StrikeStyle,
  ): void {
    this.hud.showFeedback(result.message, result.ok);
    if (!result.ok) return;
    const struck = result.creatureId ? before.get(result.creatureId) : undefined;
    if(struck)this.playerActionVisual={kind:style,startedAt:this.time.now,x:struck.x,y:struck.y,arrowTracked:false};

    // The lock follows what was actually struck, exactly as the raider and
    // resource paths do, so a creature engaged from the action button still
    // lights up and names itself.
    if (result.creatureId && !result.killed) {
      this.stickyTarget = { kind: 'creature', id: result.creatureId };
    } else if (result.killed && this.stickyTarget?.id === result.creatureId) {
      this.stickyTarget = null;
    }

    this.syncWildCreatures();
    // A defeat with a full bag spills its loot onto the ground, exactly as a
    // raider's does, so the drops have to be synced or the pile is invisible.
    this.syncGroundDrops();
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  private performCompanionAbilitySelection(abilityId: import('../simulation/state').CompanionAbilityId, creatureId?: string): void {
    const result = selectCompanionAbility(this.state, abilityId, creatureId);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) this.onCriticalChanged();
    this.refreshHudNow();
  }

  private performCreatureRole(creatureId: string, role: import('../simulation/state').CreatureRole): void {
    const result = setCreatureRole(this.state, creatureId, role);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.onCriticalChanged();
    }
    this.refreshHudNow();
  }

  /** Swing at a struck wall; its health bar is picked up by the next redraw. */
  private onWallDamaged(wall: BuildingState, destroyed: boolean): void {
    const center = buildingCenterPx(wall);
    this.playerActionVisual={kind:'melee',startedAt:this.time.now,x:center.x,y:center.y,arrowTracked:false};
    this.gatheringKind = null;
    this.gatheringUntil = this.time.now + 280;
    if (destroyed) {
      this.spawnFloatingText(center.x, center.y, 'Destroyed');
      this.buildMode.syncPlaced();
      this.syncBuildingQueryIndex();
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

  private spawnFloatingText(_x: number, _y: number, text: string): void { this.hud.showFeedback(text,true); }

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

  private playLevelUpCelebration(level: number): void { this.hud.showFeedback(`Level Up! You are now level ${level}.`,true); }

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
    this.onCriticalChanged();
    this.refreshHudNow();
  }

  /** Reconcile interaction indexes after construction retires resource nodes. */
  private pruneRetiredResourceNodes(): void { this.buildResourceNodes(); }

  private deleteBuilding(buildingId: string): boolean {
    const result = removeBuilding(this.state, buildingId);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.buildMode.syncPlaced();
      this.syncBuildingQueryIndex();
      this.syncGroundDrops();
      this.onCriticalChanged();
      this.refreshHudNow();
    }
    return result.ok;
  }

  /**
   * Demolish whatever the Delete-mode cursor is lighting, then re-anchor the
   * cursor so a row of walls comes down with repeated Delete presses.
   */
  /** Upgrade the part the Upgrade-mode cursor lights, or every wall and door of its room. */
  private upgradeSelectedPart(wholeRoom: boolean): void {
    const target = this.buildMode.deleteTarget;
    if (!target) return;
    const result = wholeRoom
      ? upgradeBuildingBatch(this.state, roomUpgradeIds(this.state, target))
      : upgradeBuildingMaterial(this.state, target.id);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.buildMode.syncPlaced();
      this.onCriticalChanged();
      this.refreshHudNow();
    }
    // Re-read the lit part: its material and price just changed.
    this.buildMode.refreshDeleteSelection();
  }

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
      if (openingStatus !== this.state.onboarding.status || wildCount !== this.state.wildCreatures.length) this.syncWildCreatures();
      for (const node of this.state.resourceNodes) {
        if (this.resourceNodesById.has(node.id)) continue;
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
    this.respawnPanel.refresh();
    const battling = this.openingPanel.isOpen;
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
      hotspot: this.nearbyTownHotspot(),
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
      this.hud.setContextActionOverride(null);
      return;
    }
    const opening = nearbyOpeningTuftle(this.state);
    if (opening && !this.buildMode.placing && !this.buildMode.deleteMode) {
      this.hud.setContextActionOverride('Help Tuftle', this.state.onboarding.completedMilestoneIds.includes('meet-tuftle')
        ? 'Hotbar: Berry first, then Snare'
        : 'A nervous Tuftle waits by the road · E / Space');
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
    const townHotspot = nearby.hotspot;
    const siteAction = townHotspot ? null : this.siteContextAction();
    this.hud.setContextActionOverride(
      townHotspot ? townHotspotLabel(townHotspot.hotspot) : siteAction?.label ?? null,
      townHotspot ? `${townHotspot.building.displayName} · E / Space` : siteAction?.hint ?? '',
    );
    this.presentationTarget = townHotspot
      ? {
          kind: 'town-hotspot', id: `${townHotspot.building.id}:${townHotspot.hotspot.id}`,
          x: townHotspot.x, y: townHotspot.y,
          label: townHotspotLabel(townHotspot.hotspot),
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
          ? this.creatureTargetPresentation(creature)
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
    // The tame candidate's whole chance joins the key: hp, food, stagger and
    // noticing all move it, and the Snare button has to show the live number.
    const tame = this.tameCandidate();
    const tameKey = tame
      ? `${tame.id}:${tameChance(this.state, tame).chanceBps}:${isEating(this.state, tame)}:${Math.round(tame.x / 8)}:${Math.round(tame.y / 8)}`
      : '';
    const key = `${townHotspot?.hotspot.id ?? ''}|${target?.id ?? ''}|${target?.hp ?? ''}|${drop?.id ?? ''}|${creature?.id ?? ''}|${facility?.id ?? ''}`
      + `|${locked?.id ?? ''}|${locked?.inRange ?? ''}|${tameKey}|${this.state.inventory['taming-snare']}|${this.state.inventory['reinforced-snare']}|${this.state.inventory.berry}`;
    if (key === this.lastTargetKey) return;
    this.lastTargetKey = key;

    this.hud.refreshTargets(target, drop, creature, locked, tame);
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
        || this.state.player.x !== poseBefore.x
        || this.state.player.y !== poseBefore.y);
    if (accepted || performance.now() >= this.queuedStep.expiresAt) this.queuedStep = null;
  }

  private queuedStepPose(): QueuedStepPose {
    return {
      x: this.state.player.x,
      y: this.state.player.y,
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
      return { x: stick.x, y: stick.y, slow: false, sprint, continuous: true };
    }

    let x = 0;
    let y = 0;
    let slow = false;
    for (const set of [this.keys, this.altKeys]) {
      if (!set) continue;
      // In first person the left/right arrows turn the view instead.
      const turnsInstead = set === this.altKeys && firstPersonView.active;
      if (set.left.isDown && !turnsInstead) x -= 1;
      if (set.right.isDown && !turnsInstead) x += 1;
      if (set.up.isDown) y -= 1;
      if (set.down.isDown) y += 1;
      if (set.slow.isDown) slow = true;
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    return { x, y, slow, sprint, continuous: true };
  }

  private alignIntentToPresentation(intent: MoveIntent): MoveIntent {
    if (firstPersonView.active) {
      // The stick is relative to where the player is looking, and the heading
      // keeps the character facing the view while strafing.
      return {
        ...screenToCameraWorldIntent(intent, firstPersonView.look.yawDegrees),
        heading: firstPersonView.look.heading(),
      };
    }
    // The published camera angle is what the player is looking through, so the
    // stick is rotated onto the ground plane by that same yaw.
    const yaw = cameraOrientationFromTenths(this.state.gameBalance.camera).yawDegrees;
    return screenToCameraWorldIntent(intent, yaw);
  }

  /** Paint travel feedback before reconciling the destination area. */
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
    const startedAt = performance.now();

    // Two animation frames are deliberate: the first commits the overlay and
    // the second reconciles the area after it has painted.
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

  private rebuildAreaWorld(): void {
    this.time.removeAllEvents();
    this.buildMode.clearForAreaSwap();
    this.gatheringUntil=0; this.playerActionVisual=null; this.gatherAssistance=null;
    this.stickyTarget=null; this.lastTargetKey=null; this.activeChunkSignature=null;
    this.entityActivationDirty=true; this.hudDirty=true;
    this.buildResourceNodes(); this.syncWildCreatures(); this.syncGroundDrops(); this.syncBuildingQueryIndex();
    this.previousPlayerX=this.state.player.x; this.previousPlayerY=this.state.player.y; this.renderPlayerPose(1);
    this.navigator.refresh(true); this.hotbar.setSuppressed(false); this.refreshHudNow();
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
      return;
    }
    this.buildMenu.close();
    this.hud.closeCraft();
    this.hud.closeFacility();
    this.inventoryPanel.close();
  };

  private teardown(): void {
    this.firstPersonHud?.destroy();
    this.firstPersonHud = null;
    this.compassStrip?.destroy();
    this.compassStrip = null;
    this.searchRing?.destroy();
    this.searchRing = null;
    firstPersonView.active = false;
    this.openingPanel.destroy();
    this.shelterGuide.destroy();
    this.paddockGuide.destroy();
    this.supplyRunGuide.destroy();
    this.gardenGuide.destroy();
    this.interiorAudio.dispose();
    this.interiorSession.recoverToWorld();
    this.townVisitKey = null;
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
    this.npcServiceOverlay.destroy();
    this.npcDialogue.destroy();
    this.npcBark.destroy();
    this.adminPanel.destroy();
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
  }
}
