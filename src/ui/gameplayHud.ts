import { ARROWS_CRAFT_COST, ARROWS_PER_CRAFT, CRAFTABLE_TOOL_DEFINITIONS, IRON_SMELT_INPUTS, CLOTH_MASK_CRAFT_COST, CLOTH_MASK_PROTECTION_SECONDS, REINFORCED_SNARE_CRAFT_COST, REINFORCED_SNARES_PER_CRAFT, TAMING_SNARE_CRAFT_COST, gameToolDefinition, isHandcraftTool, leveledRaiderDefinition, INVENTORY_SLOTS, toolDefinition } from '../config/balance';
import { CREATURE_DEFINITIONS, MAX_ACTIVE_FOLLOWERS, creatureDefinition } from '../content/creatures';
import { isOpeningTuftle } from '../content/onboarding';
import { creatureWorkPassive, type CreatureWorkPassiveDefinition } from '../content/creatureWorkPassives';
import { producerForSpecies } from '../content/producers';
import { FOLLOWER_ACTION_SPEED_CAP_BPS } from '../simulation/creatureRoles';
import { creatureBondLevel } from '../content/companionAbilities';
import { eligibleCreatureWorksites, fieldCache, ROWBOAT_CRAFT_COST, rowboatActionLabel, toolUnlockReason, usedInventorySlots } from '../simulation/gameplayCommands';
import { homesteadRating } from '../simulation/scoring';
import { snareThrowBlockedReason } from '../simulation/encounters';
import { TAMING_RANGE_PX } from '../config/balance';
import {
  ATTRIBUTE_DESCRIPTIONS,
  ATTRIBUTE_IDS,
  ATTRIBUTE_LABELS,
  attributePointDetail,
  canIncreaseAttribute,
  dodgeChanceBps,
  doubleDropChanceBps,
  healthRegeneration,
  hitChanceBonusBps,
  magicDamageBonus,
  manaRegeneration,
  meleeDamageBonus,
  movementSpeed,
  rangedDamageBonus,
  canSprint,
  sprintSpeedMultiplier,
  sprintStaminaPerSecond,
  staminaRegeneration,
  tamingChanceBonusBps,
  xpToNextLevel,
} from '../simulation/characterProgression';
import type { AttributeId, BasicResourceId, BuildingDefinitionId, BuildingState, CompanionAbilityId, CreatureRole, GameState, GroundDropState, ResourceId, ResourceNodeState, ToolDefinitionId, WildCreatureState } from '../simulation/state';
import { buildableById, type ResourceAmounts } from '../content/buildingParts';
import { canAffordCost, stockedCostText, useCostLabel } from './costs';
import { RAIL_BOTTOMS, div, paletteCard, paletteSection, railButton, uiButton, wireDisclosure } from './controls';
import { ProgressionGuide } from './progressionGuide';
import { QuestCelebration } from './questCelebration';
import { BlueprintCelebration } from './blueprintCelebration';
import { hasPendingBlueprintGrants } from '../simulation/blueprintGrants';
import type { InventoryPanel } from './inventoryPanel';
import { knowsBlueprint } from '../simulation/blueprintKnowledge';
import { BLUEPRINT_DRAFT_COST, draftBlockedReason } from '../simulation/carriedBlueprints';
import { deathCacheInReach, deathCacheView } from '../simulation/deathCache';
import { effectiveToolActionTicks, effectiveToolDamage, farmOrderBlockedReason } from '../simulation/economy';
import { FARM_ORDER_COSTS } from '../content/economy';
import { availableHousing, housingBinCapacity, housingBinCount, housingCapacityForBuilding, housingOperationGate, workerFacilityBinCapacity, workerFacilityBinCount } from '../simulation/workerHousing';
import { cartDockStorageCandidates } from '../simulation/cartDocks';
import { inventorySlotEntries, storageBoxSlotEntries, type SlotEntry } from './inventorySlots';
import { storageContainerSlots, usedStorageBoxSlots } from '../simulation/storageBox';
import { logisticsRouteLabel, logisticsStorageCandidates, logisticsWorkerCandidates } from '../simulation/logistics';
import { setUiIcon } from './icons';
import {characterPortrait} from './portraits';
import { coinScore } from '../simulation/coins';
import { effectiveBagCapacityHundredths, formatWeight } from '../simulation/bagWeight';
import { clothMaskSecondsRemaining, dangerGraceTimer, exposureDamagePerSecond, formatCountdown, isPlayerEnclosed, isPlayerSheltered, raidNumberFor, survivalSchedule } from '../simulation/survivalCycle';
import { nextStormImpactView, stormStrikeSchedule } from '../simulation/arcaneStorm';
import { DANGER_SANCTUARY_BADGE, DANGER_THREAT_COPY } from '../content/dangerThreats';
import { isElarisTownSafeZone } from '../simulation/town';
import { nearestRaiderInRange, raidWaveFor } from '../simulation/raids';
import { spawnLevel } from '../simulation/enemyLevels';
import { raiderBounty, raiderDefinition } from '../content/raiders';
import { equippedBow, isStructureDamaged } from '../simulation/gameplayCommands';
import { combatActionLabel, loadoutStrikeStyle, type ResolvedCombatTarget } from '../scenes/combatPresentation';
import { VitalBarActivity, vitalBarHidden, vitalBarOpacity } from './vitalBars';


/**
 * Recipes a facility exposes when you walk up to it. Stone and Iron tools are
 * crafted at the workbench rather than by hand, so they live here instead of the
 * handcraft menu; the Wooden starters and the handcraft-flagged exceptions (the
 * Bow) stay freely handcraftable.
 */
const WORKBENCH_TOOL_IDS: readonly ToolDefinitionId[] = CRAFTABLE_TOOL_DEFINITIONS
  .filter((definition) => !isHandcraftTool(definition))
  .map((definition) => definition.definitionId);
const FACILITY_RECIPES: Partial<Record<BuildingDefinitionId, readonly ToolDefinitionId[]>> = {
  'field-cache': [],
  warehouse: [],
  'logistics-hub': [],
  workbench: WORKBENCH_TOOL_IDS,
  furnace: [],
  'farm-counter': [],
  'small-pen': [],
  barn: [],
  'stone-yard': [],
  'cart-dock': [],
  // Defence facilities expose no tool recipes; they own their own panel modes.
  'war-table': [],
  turret: [],
};

/** Arrows moved per Load/Unload press, so a full turret takes a few taps. */
const TURRET_AMMO_STEP = 10;

/** "15s" / "1m 30s"; assignment cadences are always whole seconds. */
function durationText(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const remainder = seconds % 60;
  return remainder === 0 ? `${seconds / 60}m` : `${Math.floor(seconds / 60)}m ${remainder}s`;
}

function worksiteNames(ids: readonly BuildingDefinitionId[]): string {
  return ids.map((id) => buildableById(id).displayName).join(' or ');
}

/**
 * What one application of a passive actually moves.
 *
 * The passive's own `amount` is a bare number whose unit differs per job —
 * hit points, damage, arrows, tiles — so the sentence has to be written per
 * passive rather than derived, or the button would read "4 per 5s".
 */
function passiveEffectText(passive: CreatureWorkPassiveDefinition): string {
  switch (passive.id) {
    case 'rebuild-walls':
      return `repairs ${passive.amount} HP on one damaged structure`;
    case 'defend-base':
      return `hits one raider for ${passive.amount} damage`;
    case 'restock-turrets':
      return `carries ${passive.amount} arrows into a low turret`;
    case 'purified-zone':
      return `holds ${passive.amount} tiles of clean air`;
    case 'throw-rocks':
      return `throws a stone for ${passive.amount} damage`;
  }
}

/**
 * The Assignment button's sentence, then its numbers.
 *
 * Split out of the HUD class because it is pure content: every line here reads
 * a definition, and none of it touches state. The first entry is the plain
 * description; the rest are the mechanics the player needs to compare one
 * assignment against another (rate, reach, what it costs to keep).
 */
function assignmentDescriptionLines(
  role: CreatureRole,
  definition?: ReturnType<typeof creatureDefinition>,
): readonly string[] {
  if (role === 'rest') {
    return [
      'Stops following or working and remains inactive.',
      'Frees its follower slot and its worksite, and stops all production. Bond level, abilities and housing are kept, so re-assigning later costs nothing.',
    ];
  }
  if (role === 'follow') {
    if (!definition) return ['Travels with you and provides a species bonus.'];
    const mechanics: string[] = [];
    if (definition.followMode === 'mount') {
      mechanics.push(`Ride it for ${definition.travelSpeedMultiplier}× travel speed.`);
    }
    for (const modifier of definition.followerModifiers) {
      if (modifier.stat === 'gatherYield') {
        mechanics.push(`+${modifier.amountBps / 100}% ${modifier.targets.join(' and ')} from plants within ${modifier.rangePx / 16} tiles of you. Best helper only; fractional gains carry forward.`);
        continue;
      }
      if (modifier.stat !== 'actionSpeed') continue;
      // Only the strongest modifier in a stacking group counts, and the total is
      // capped — a player who tames three miners deserves to know that before
      // spending three follower slots on them.
      mechanics.push(
        `+${modifier.amountBps / 100}% ${modifier.targets.join(' and ')} gathering speed`
        + ` (best bonus per group only, +${FOLLOWER_ACTION_SPEED_CAP_BPS / 100}% cap).`,
      );
    }
    mechanics.push(`Uses 1 of ${MAX_ACTIVE_FOLLOWERS} follower slots. Only a follower can be set as your Battle Companion.`);
    return [`Travels with you · ${definition.followRole}`, ...mechanics];
  }
  if (!definition?.work) return ['Automatically gathers resources at an eligible worksite.'];
  const sites = worksiteNames(definition.work.eligibleWorksites);
  const producer = producerForSpecies(definition.speciesId);
  if (definition.work.resource) {
    const output = Object.entries(producer?.outputPerCycle ?? {})
      .map(([resource, amount]) => `${amount} ${resource}`)
      .join(' and ');
    return [
      `Produces ${definition.work.resource} at the nearest ${sites}.`,
      producer && output ? `About ${output} every ${durationText(producer.cycleMs / 1000)} into that building's bin — collect it there.` : '',
      'Needs a free housing slot, and pauses once the bin is full. Keeps producing while you are away.',
    ].filter((line) => line !== '');
  }
  // A passive species does something specific enough that "works at the nearest
  // Turret" would tell the player nothing about why they would want to, so its
  // own sentence wins.
  if (definition.work.passive) {
    const passive = creatureWorkPassive(definition.work.passive);
    return [
      `${passive.description} Assign at a ${sites}.`,
      passive.id === 'purified-zone'
        // The zone is a square anchored on the worksite's own tile rather than a
        // radius, so a reach in tiles would describe the wrong shape.
        ? `Refreshed every ${durationText(passive.intervalTicks / 60)}; ${passiveEffectText(passive)} on and around the worksite tile.`
        : `Every ${durationText(passive.intervalTicks / 60)} it ${passiveEffectText(passive)} within ${passive.rangeTiles} tiles of the worksite.`,
      'Anchored to the building, not to you — it keeps working while you are elsewhere, and needs a free housing slot.',
    ];
  }
  return [
    `Works at the nearest ${sites}.`,
    'Needs a free housing slot and an operational worksite.',
  ];
}

export interface GameplayHudActions {
  onAction: () => void;
  /** Throw a snare at the locked creature — the way into a taming session. */
  onThrowSnare?: () => void;
  onCraftTool: (definitionId: ToolDefinitionId) => void;
  onCraftRowboat?: () => void;
  /** Spend Draft Parchment at a workbench for a random unowned blueprint. */
  onDraftBlueprint?: () => void;
  onCraftSnare: () => void;
  onCraftReinforcedSnare: () => void;
  onCraftArrows: () => void;
  onCraftClothMask: () => void;
  onEnqueueIronSmelt: (furnaceId: string) => void;
  onCollectFurnace: (furnaceId: string) => void;
  onOrderTrainedCreature?: (speciesId: import('../simulation/state').SpeciesId) => void;
  onCollectHousingBin?: (housingId: string, resource: 'fiber' | 'berry' | 'stone') => void;
  onLinkCartDockStorage?: (cartDockId: string, storageId: string | null) => void;
  onSetLogisticsRoute?: (hubId: string, sourceWorkerId: string, destinationIds: readonly string[]) => void;
  onClearLogisticsRoute?: (hubId: string, sourceWorkerId: string) => void;
  onReleaseCreature?: (creatureId: string) => void;
  onEquipTool: (toolId: string) => void;
  onSetCreatureRole: (creatureId: string, role: CreatureRole) => void;
  onSetBattleCompanion: (creatureId: string | null) => void;
  onSelectCompanionAbility: (creatureId: string, abilityId: CompanionAbilityId) => void;
  onWithdrawFromCache: (resource: BasicResourceId, cacheId?: string) => void;
  onDepositResourceToCache?: (resource: ResourceId, stackIndex: number, cacheId: string) => void;
  onWithdrawResourceFromCache?: (resource: ResourceId, stackIndex: number, cacheId: string) => void;
  onDepositToolToCache?: (toolId: string, cacheId: string) => void;
  onWithdrawToolFromCache?: (toolId: string, cacheId: string) => void;
  onSpendAttribute: (attribute: AttributeId) => void;
  onApplyAttributes?: (allocation: Readonly<Partial<Record<AttributeId, number>>>) => void;
  onLoadTurretAmmo?: (turretId: string, amount: number) => void;
  onUnloadTurretAmmo?: (turretId: string, amount: number) => void;
  /** Pay out a finished quest; returns false when the credit was refused. */
  onClaimQuestReward: (questId: string) => boolean;
  /** The craft panel opened; the scene closes competing panels (build). */
  onCraftOpened: () => void;
}

/** Compact inventory, context action, and first-recipe crafting UI. */
export class GameplayHud {
  private readonly root: HTMLDivElement;
  private readonly statusStack: HTMLDivElement;
  private readonly healthBar: HTMLDivElement;
  private readonly healthBarFill: HTMLDivElement;
  private readonly healthBarValue: HTMLSpanElement;
  private readonly staminaBar: HTMLDivElement;
  private readonly staminaBarFill: HTMLDivElement;
  private readonly staminaBarValue: HTMLSpanElement;
  private readonly manaBar: HTMLDivElement;
  private readonly manaBarFill: HTMLDivElement;
  private readonly manaBarValue: HTMLSpanElement;
  /**
   * When each vital last moved, so an idle bar can fade out while one the
   * player is spending or regenerating stays up. Presentation-only: never saved.
   */
  private readonly vitalActivity = new VitalBarActivity();
  private readonly xpBar: HTMLDivElement;
  private readonly xpBarFill: HTMLDivElement;
  private readonly xpBarValue: HTMLSpanElement;
  private readonly blueprintClaim: HTMLButtonElement;
  private readonly coinScoreBadge: HTMLDivElement;
  private readonly coinScoreValue: HTMLSpanElement;
  private readonly survivalTimer: HTMLDivElement;
  private readonly dangerGraceTimer: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private readonly craftPanel: HTMLDivElement;
  private readonly craftButton: HTMLButtonElement;
  private readonly throwSnareButton: HTMLButtonElement;
  private readonly reinforcedSnareButton: HTMLButtonElement;
  private readonly arrowsButton: HTMLButtonElement;
  private readonly clothMaskButton: HTMLButtonElement;
  private readonly actionButton: HTMLButtonElement;
  private readonly snareButton: HTMLButtonElement;
  private readonly sprintButton: HTMLButtonElement;
  private battleMode = false;
  private buildMode = false;
  /** Presentation-only: the scene reads it each frame to build the move intent. */
  private sprintEnabled = false;
  /** Presentation-only: the scene reads it each frame to repeat the shot. */
  private actionHeld = false;
  private contextActionOverride: { label: string; hint: string } | null = null;
  private readonly facilityPanel: HTMLDivElement;
  private readonly facilityHeading: HTMLElement;
  private readonly facilityRecipes: HTMLDivElement;
  private readonly facilityStorage: HTMLDivElement;
  private readonly facilityBagGrid: HTMLDivElement;
  private readonly facilityBoxGrid: HTMLDivElement;
  private readonly facilityBagCount: HTMLSpanElement;
  private readonly facilityBoxCount: HTMLSpanElement;
  private readonly facilityRecipeButtons = new Map<ToolDefinitionId, HTMLButtonElement>();
  private readonly facilityRecipesEmpty: HTMLDivElement;
  private readonly facilityDraftButton: HTMLButtonElement;
  private readonly facilityRowboatButton: HTMLButtonElement;
  private readonly facilityFurnace: HTMLDivElement;
  private readonly facilityDefence: HTMLDivElement;
  private readonly facilityDefenceStatus: HTMLDivElement;
  private readonly facilityLoadAmmoButton: HTMLButtonElement;
  private readonly facilityUnloadAmmoButton: HTMLButtonElement;
  private readonly facilityFurnaceStatus: HTMLDivElement;
  private readonly facilitySmeltButton: HTMLButtonElement;
  private readonly facilityCollectFurnaceButton: HTMLButtonElement;
  private readonly facilityFarm: HTMLDivElement;
  private readonly facilityHousing: HTMLDivElement;
  private readonly facilityWorker: HTMLDivElement;
  private currentFacility: BuildingState | null = null;
  private readonly creatureButton: HTMLButtonElement;
  private readonly creaturePanel: HTMLDivElement;
  private readonly creatureRoster: HTMLDivElement;
  private readonly creatureStatus: HTMLDivElement;
  private readonly statsButton: HTMLButtonElement;
  private readonly statsPanel: HTMLDivElement;
  private readonly statsSummary: HTMLDivElement;
  private readonly statsGrid: HTMLDivElement;
  private readonly attributeRows = new Map<AttributeId, {
    level: HTMLDivElement;
    stats: HTMLDivElement;
    decrease: HTMLButtonElement;
    increase: HTMLButtonElement;
    info: HTMLButtonElement;
    details: HTMLDivElement;
  }>();
  private readonly attributeAllocationSummary: HTMLDivElement;
  private readonly attributeApplyButton: HTMLButtonElement;
  private readonly pendingAttributes: Record<AttributeId, number> = {
    strength: 0, dexterity: 0, magic: 0, luck: 0, speed: 0,
    health: 0, healthRegen: 0, stamina: 0, staminaRegen: 0, carryWeight: 0, mana: 0, manaRegen: 0,
  };
  private readonly assignmentButtons = new Map<CreatureRole, HTMLButtonElement>();
  private readonly battleCompanionButton: HTMLButtonElement;
  private readonly releaseCreatureButton: HTMLButtonElement;
  private readonly creatureAbilities: HTMLDivElement;
  private readonly withdrawButtons = new Map<BasicResourceId, HTMLButtonElement>();
  private readonly recipeButtons = new Map<ToolDefinitionId, HTMLButtonElement>();
  private readonly craftEmpty: HTMLDivElement;
  private readonly toolsSection: HTMLDivElement;
  private readonly toolsList: HTMLDivElement;
  /** Reflows the build palette the Craft tab hosts; set by mountBuildSection. */
  private buildSectionOpened: (() => void) | null = null;
  private readonly feedback: HTMLDivElement;
  private readonly gatherFeedback: HTMLDivElement;
  private gatherFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly progressionGuide: ProgressionGuide;
  private readonly questCelebration: QuestCelebration;
  private readonly blueprintCelebration: BlueprintCelebration;
  private menu: InventoryPanel | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resourceFlash: HTMLDivElement;
  private resourceFlashTimer: ReturnType<typeof setTimeout> | null = null;
  private selectedCreatureId: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: GameplayHudActions,
  ) {
    this.root = div({ position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '11' });

    this.statusStack = div({
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 8px)',
      right: 'calc(env(safe-area-inset-right) + 8px)',
      width: 'min(184px, calc(50vw - 12px))',
      minWidth: '136px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '7px',
    });
    this.statusStack.dataset.hudStatusStack = '';

    this.resourceFlash = div({
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 8px)',
      right: 'calc(env(safe-area-inset-right) + 8px)',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '2px',
      minWidth: '112px',
      padding: '7px 10px',
      borderRadius: '7px',
      color: '#fff0a8',
      background: 'rgba(9,20,14,0.94)',
      border: '1px solid rgba(255,224,138,0.7)',
      boxShadow: '0 3px 14px rgba(0,0,0,0.45)',
      font: '900 13px system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      transition: 'opacity 150ms ease-out, transform 150ms ease-out',
      zIndex: '2',
    });
    this.resourceFlash.dataset.resourceTotalFlash = '';
    this.resourceFlash.setAttribute('role', 'status');
    this.resourceFlash.setAttribute('aria-live', 'polite');

    // HP, SP, and MP are the same control three times over, so they are built
    // once. SP and MP only became worth showing when combat started spending
    // them; before that they were a character-sheet number.
    const health = this.buildVitalBar('HP', 'playerHealth', '#59c879');
    this.healthBar = health.root;
    this.healthBarFill = health.fill;
    this.healthBarValue = health.value;
    const stamina = this.buildVitalBar('SP', 'playerStamina', '#e2c15a');
    this.staminaBar = stamina.root;
    this.staminaBarFill = stamina.fill;
    this.staminaBarValue = stamina.value;
    const mana = this.buildVitalBar('MP', 'playerMana', '#6fa8e8');
    this.manaBar = mana.root;
    this.manaBarFill = mana.fill;
    this.manaBarValue = mana.value;

    this.xpBar = div({
      width: '100%',
      minHeight: '34px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '5px 9px',
      borderRadius: '18px',
      color: '#f5efff',
      background: 'rgba(9,20,14,0.9)',
      border: '1px solid rgba(196,166,255,0.42)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
      boxSizing: 'border-box',
      font: '800 12px system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
    });
    this.xpBar.dataset.playerXp = '';
    this.xpBar.setAttribute('role', 'progressbar');
    const xpLabel = document.createElement('span');
    xpLabel.textContent = 'XP';
    const xpTrack = div({
      position: 'relative',
      flex: '1',
      height: '10px',
      overflow: 'hidden',
      borderRadius: '5px',
      background: 'rgba(0,0,0,0.52)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
    });
    this.xpBarFill = div({
      width: '0%',
      height: '100%',
      borderRadius: 'inherit',
      background: '#a97ae8',
      transition: 'width 120ms ease-out',
    });
    this.xpBarFill.dataset.playerXpFill = '';
    xpTrack.appendChild(this.xpBarFill);
    this.xpBarValue = document.createElement('span');
    this.xpBarValue.style.whiteSpace = 'nowrap';
    this.xpBar.append(xpLabel, xpTrack, this.xpBarValue);
    // The XP bar is the readout for everything the Character tab explains, so
    // tapping it is the shortest path there.
    this.xpBar.style.pointerEvents = 'auto';
    this.xpBar.style.cursor = 'pointer';
    this.xpBar.tabIndex = 0;
    this.xpBar.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openCharacterMenu();
    });
    this.xpBar.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      this.openCharacterMenu();
    });

    // An earned blueprint the player has not collected is the one thing in the
    // status stack that wants acting on, so it sits directly under the XP bar
    // that announced the level and flashes the same gold until it is tapped.
    this.blueprintClaim = document.createElement('button');
    this.blueprintClaim.type = 'button';
    this.blueprintClaim.dataset.testid = 'blueprint-claim-strip';
    Object.assign(this.blueprintClaim.style, {
      width: '100%',
      minHeight: '34px',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '7px',
      padding: '5px 9px',
      borderRadius: '18px',
      color: '#fff0a8',
      background: 'rgba(43,31,6,0.92)',
      border: '1px solid rgba(255,210,63,0.52)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
      boxSizing: 'border-box',
      font: '800 12px system-ui, sans-serif',
      letterSpacing: '0.04em',
      cursor: 'pointer',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      webkitTapHighlightColor: 'transparent',
    });
    this.blueprintClaim.textContent = 'Claim Blueprint';
    this.blueprintClaim.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openBlueprintsMenu();
    });

    this.coinScoreBadge = div({
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '7px',
      minHeight: '32px',
      padding: '4px 8px',
      borderRadius: '7px',
      color: '#fff0a8',
      background: 'rgba(9,20,14,0.9)',
      border: '1px solid rgba(255,255,255,0.16)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.3)',
      boxSizing: 'border-box',
      font: '800 14px system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    });
    this.coinScoreBadge.classList.add('elaris-panel');
    this.coinScoreBadge.dataset.coinScore = '';
    this.coinScoreBadge.setAttribute('aria-live', 'polite');
    const coinIcon = document.createElement('span');
    setUiIcon(coinIcon, 'coin', 21);
    const coinLabel = document.createElement('span');
    coinLabel.textContent = 'Gold';
    this.coinScoreValue = document.createElement('span');
    this.coinScoreBadge.append(coinIcon, coinLabel, this.coinScoreValue);

    this.survivalTimer = div({
      width: '100%',
      minHeight: '34px',
      display: 'grid',
      placeItems: 'center',
      padding: '4px 12px',
      borderRadius: '18px',
      color: '#e8f0ea',
      background: 'rgba(9,20,14,0.92)',
      border: '1px solid rgba(255,255,255,0.28)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
      boxSizing: 'border-box',
      font: '800 13px system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: '0.04em',
      whiteSpace: 'normal',
      textAlign: 'center',
      lineHeight: '1.25',
    });
    this.survivalTimer.dataset.survivalTimer = '';
    this.survivalTimer.setAttribute('role', 'timer');
    this.survivalTimer.setAttribute('aria-live', 'polite');

    this.dangerGraceTimer = div({
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 50px)',
      left: '50%',
      transform: 'translateX(-50%)',
      minWidth: '154px',
      minHeight: '30px',
      display: 'none',
      placeItems: 'center',
      padding: '3px 11px',
      borderRadius: '15px',
      color: '#ff6b6b',
      background: 'rgba(58,5,5,0.96)',
      border: '1px solid #ff4d4d',
      boxShadow: '0 3px 14px rgba(80,0,0,0.5)',
      font: '900 14px system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    });
    this.dangerGraceTimer.dataset.dangerGraceTimer = '';
    this.dangerGraceTimer.setAttribute('role', 'timer');
    this.dangerGraceTimer.setAttribute('aria-live', 'assertive');

    this.target = div({
      position: 'absolute',
      left: '50%',
      bottom: 'calc(env(safe-area-inset-bottom) + 72px)',
      transform: 'translateX(-50%)',
      padding: '6px 10px',
      borderRadius: '8px',
      background: 'rgba(9,20,14,0.78)',
      font: '13px system-ui, sans-serif',
      whiteSpace: 'nowrap',
      display: 'none',
    });
    this.target.dataset.targetHint = '';

    // The single thumb action. It hits whatever is currently targeted and names
    // that target — "Chop Tree", "Strike Scavenger" — so one button can serve
    // gathering and combat without the label ever being ambiguous. Creatures and
    // facilities are still engaged by clicking them directly.
    //
    // `data-action-button` is the stable handle for tests: the accessible name
    // moves with the target by design, so it is not something to select on.
    this.actionButton = uiButton('Gather', () => this.actions.onAction());
    this.actionButton.setAttribute('aria-label', 'Gather');
    this.actionButton.dataset.actionButton = '';
    // Held state, not just clicks: the bow fires and a resource keeps taking
    // swings for as long as the thumb stays down, which is what makes shooting
    // on the move and felling a tree possible without machine-gunning the
    // button between steps. `pointercancel` and `pointerleave` matter — a thumb
    // that slides off the button must stop the repeat, or the player keeps
    // swinging after letting go.
    this.actionButton.addEventListener('pointerdown', this.onActionPressStart);
    for (const event of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.actionButton.addEventListener(event, this.onActionPressEnd);
    }
    Object.assign(this.actionButton.style, {
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 18px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 34px)',
      width: '72px',
      height: '72px',
      borderRadius: '50%',
      background: 'rgba(47,107,67,0.92)',
      fontWeight: '700',
    });

    // Sprint sits directly above the thumb action rather than on the menu rail:
    // it is held on during travel, so it has to be reachable without opening
    // anything. Stacking it above the action button — rather than beside it —
    // keeps the space to the left of the thumb clear for the world.
    this.sprintButton = uiButton('Sprint', () => this.toggleSprint());
    this.sprintButton.dataset.sprintToggle = '';
    this.sprintButton.setAttribute('aria-pressed', 'false');
    Object.assign(this.sprintButton.style, {
      position: 'absolute',
      // Centred on the 72px action button: 18 + (72 - 58) / 2.
      right: 'calc(env(safe-area-inset-right) + 25px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 114px)',
      width: '58px',
      height: '48px',
      minHeight: '48px',
      borderRadius: '24px',
      padding: '4px',
      fontSize: '12px',
      fontWeight: '700',
      lineHeight: '1.2',
    });

    // Throw Snare sits to the left of the thumb action, and only while a
    // creature is locked and close enough to snare. A tap on a creature is an
    // attack now, so this button is the entire taming path — it has to be
    // impossible to miss when it is available, and absent when it is not.
    this.throwSnareButton = uiButton('Snare', () => this.actions.onThrowSnare?.());
    this.throwSnareButton.dataset.snareButton = '';
    // Deliberately not "Throw Snare": that name belongs to the button inside a
    // taming session, and two controls sharing an accessible name is a trap for
    // both screen readers and tests.
    this.throwSnareButton.setAttribute('aria-label', 'Throw snare at creature');
    Object.assign(this.throwSnareButton.style, {
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 100px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 46px)',
      width: '84px',
      minHeight: '48px',
      borderRadius: '24px',
      padding: '4px 8px',
      fontSize: '12px',
      fontWeight: '700',
      lineHeight: '1.2',
      background: 'rgba(122,89,44,0.94)',
      display: 'none',
    });

    this.craftButton = railButton('craft', 'Craft', () => this.toggleCraft());
    this.craftButton.style.bottom = RAIL_BOTTOMS.craft;

    this.creatureButton = railButton('creature', 'Creatures', () => this.toggleCreatures());
    this.creatureButton.style.bottom = RAIL_BOTTOMS.creatures;
    this.creatureButton.style.display = 'none';
    this.creaturePanel = div({
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 94px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 94px)',
      width: 'min(270px, calc(100vw - 110px))',
      padding: '14px',
      borderRadius: '12px',
      background: 'rgba(9,20,14,0.97)',
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
      display: 'none',
      pointerEvents: 'auto',
      font: '14px system-ui, sans-serif',
    });
    this.creaturePanel.classList.add('elaris-panel');
    this.creaturePanel.setAttribute('role', 'dialog');
    this.creaturePanel.setAttribute('aria-label', 'Creature roster and assignments');
    wireDisclosure(this.creatureButton, this.creaturePanel, 'creature-panel');
    const workerHeading = document.createElement('strong');
    workerHeading.textContent = 'Creature roster';
    this.creatureRoster = div({ marginTop: '2px' });
    this.creatureRoster.dataset.creatureRoster='';
    this.creatureStatus = div({
      marginTop: '12px', padding: '10px 12px', borderRadius: '9px',
      background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.1)',
      fontSize: '12px', lineHeight: '1.45', opacity: '0.9',
    });
    this.creatureStatus.dataset.creatureStatus='';
    const assignments = div({ display: 'grid', gap: '7px', marginTop: '4px' });
    for (const role of ['follow', 'work', 'rest'] as const) {
      const button = uiButton('', () => this.assignSelectedCreature(role));
      Object.assign(button.style, {
        minWidth: '0', minHeight: '58px', padding: '8px 10px',
        background: 'rgba(30,48,37,0.94)', textAlign: 'left', lineHeight: '1.25',
      });
      // The aria-label is written with the content, so it carries the same
      // detail the sighted player reads off the button.
      this.setAssignmentButtonContent(button, role);
      this.assignmentButtons.set(role, button);
      assignments.appendChild(button);
    }
    this.battleCompanionButton = uiButton('Set as Battle Companion', () => {
      const creatureId = this.selectedCreatureId;
      if (creatureId) this.actions.onSetBattleCompanion(this.state.battleCompanionId === creatureId ? null : creatureId);
    });
    Object.assign(this.battleCompanionButton.style, { width: '100%', minHeight: '44px', background: '#5c4a7d' });
    this.releaseCreatureButton = uiButton('Release creature', () => {
      const creature = this.state.ownedCreatures.find((candidate) => candidate.id === this.selectedCreatureId);
      if (creature && globalThis.confirm(`Release ${creature.name}? This cannot be undone.`)) {
        this.actions.onReleaseCreature?.(creature.id);
      }
    });
    Object.assign(this.releaseCreatureButton.style, { width: '100%', minHeight: '44px', background: '#6b3131' });
    this.releaseCreatureButton.dataset.tone='danger';
    this.creatureAbilities = div({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '7px' });
    const withdraw = div({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px', marginTop: '4px' });
    for (const resource of ['wood', 'stone', 'fiber'] as const) {
      const button = uiButton(`Take ${resource}`, () => this.actions.onWithdrawFromCache(resource));
      Object.assign(button.style, { minWidth: '0', minHeight: '44px', padding: '6px 3px', fontSize: '11px', background: 'rgba(30,48,37,0.94)' });
      this.withdrawButtons.set(resource, button);
      withdraw.appendChild(button);
    }
    this.creaturePanel.append(
      workerHeading, this.creatureRoster, this.creatureStatus,
      paletteSection('Assignment'), assignments,
      paletteSection('Battle Companion'), this.battleCompanionButton,
      paletteSection('Battle Abilities'), this.creatureAbilities,
      paletteSection('Roster'), this.releaseCreatureButton,
      paletteSection('Storage Box (small)'), withdraw,
    );

    this.statsButton = railButton('character', 'Character', () => this.toggleStats());
    this.statsButton.style.bottom = RAIL_BOTTOMS.stats;
    this.statsPanel = div({
      position: 'absolute', right: 'calc(env(safe-area-inset-right) + 94px)',
      top: 'calc(env(safe-area-inset-top) + 64px)', width: 'min(430px, calc(100vw - 110px))',
      maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', padding: '14px', borderRadius: '12px',
      background: 'rgba(9,20,14,0.97)', border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 22px rgba(0,0,0,0.4)', display: 'none', pointerEvents: 'auto',
      font: '14px system-ui, sans-serif', boxSizing: 'border-box', zIndex: '3',
    });
    this.statsPanel.classList.add('elaris-panel');
    this.statsPanel.setAttribute('role', 'dialog');
    this.statsPanel.setAttribute('aria-label', 'Character stats');
    wireDisclosure(this.statsButton, this.statsPanel, 'stats-panel');
    const statsHeading = document.createElement('strong');
    statsHeading.textContent = 'Character';
    this.statsSummary = div({
      marginTop: '10px', padding: '10px 12px', borderRadius: '9px', lineHeight: '1.5',
      background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.1)', opacity: '0.92',
    });
    const characterHero=div({});characterHero.className='elaris-character-hero';characterHero.dataset.characterSummary='';
    const characterIdentity=div({});const characterName=document.createElement('h2');characterName.textContent='Woodland Warden';
    characterIdentity.append(characterName,this.statsSummary);characterHero.append(characterPortrait('player',90),characterIdentity);
    this.statsGrid = div({
      display: 'grid', gap: '8px', marginTop: '8px',
    });
    this.statsGrid.setAttribute('role', 'group');
    this.statsGrid.setAttribute('aria-label', 'Maximum stats and attributes');
    this.attributeAllocationSummary = div({
      marginTop: '10px', color: '#ffe08a', fontSize: '12px', fontWeight: '700',
    });
    this.attributeAllocationSummary.setAttribute('aria-live', 'polite');
    this.attributeApplyButton = uiButton('Apply', () => this.applyPendingAttributes());
    this.attributeApplyButton.dataset.tone='primary';
    Object.assign(this.attributeApplyButton.style, {
      width: '100%', minHeight: '48px', marginTop: '10px', fontWeight: '800',
    });
    this.statsPanel.append(
      statsHeading,
      characterHero,
      paletteSection('Maximum stats & attributes'),
      this.statsGrid,
      this.attributeAllocationSummary,
      this.attributeApplyButton,
    );
    for (const attribute of ATTRIBUTE_IDS) {
      const row = div({
        minWidth: '0', padding: '10px', borderRadius: '9px',
        background: 'rgba(30,48,37,0.94)', border: '1px solid rgba(255,255,255,0.12)',
      });
      row.dataset.attributeRow = attribute;
      const main = div({ display: 'flex', alignItems: 'center', gap: '8px' });
      const copy = div({ flex: '1', minWidth: '0' });
      const heading = div({ display: 'flex', alignItems: 'baseline', gap: '7px', flexWrap: 'wrap' });
      const name = div({ fontWeight: '800' });
      name.textContent = ATTRIBUTE_LABELS[attribute];
      const level = div({ fontSize: '11px', color: '#ffe08a', fontWeight: '700' });
      heading.append(name, level);
      const stats = div({ marginTop: '3px', fontSize: '12px', lineHeight: '1.4', opacity: '0.82' });
      copy.append(heading, stats);
      const info = uiButton('i', () => this.toggleAttributeDetails(attribute));
      info.dataset.attributeInfo = attribute;
      info.setAttribute('aria-label', `More about ${ATTRIBUTE_LABELS[attribute]}`);
      info.setAttribute('aria-expanded', 'false');
      Object.assign(info.style, {
        minWidth: '32px', width: '32px', minHeight: '32px', height: '32px', padding: '0',
        borderRadius: '50%', background: 'rgba(255,255,255,0.08)', fontWeight: '900', fontStyle: 'italic',
      });
      const decrease = uiButton('−', () => this.adjustPendingAttribute(attribute, -1));
      decrease.dataset.attributeDecrease = attribute;
      decrease.setAttribute('aria-label', `Remove one pending ${ATTRIBUTE_LABELS[attribute]} point`);
      Object.assign(decrease.style, { minWidth: '38px', width: '38px', minHeight: '38px', height: '38px', padding: '0', fontSize: '22px', background: '#39483d' });
      const increase = uiButton('+', () => this.adjustPendingAttribute(attribute, 1));
      increase.dataset.attributeIncrease = attribute;
      increase.setAttribute('aria-label', `Add one ${ATTRIBUTE_LABELS[attribute]} point`);
      Object.assign(increase.style, { minWidth: '38px', width: '38px', minHeight: '38px', height: '38px', padding: '0', fontSize: '20px' });
      main.append(copy, info, decrease, increase);
      const details = div({
        display: 'none', marginTop: '9px', paddingTop: '9px',
        borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: '12px', lineHeight: '1.45', opacity: '0.86',
      });
      details.id = `attribute-${attribute}-details`;
      // Filled on every sync so a published change to the per-point values
      // reaches an already-built row.
      details.textContent = ATTRIBUTE_DESCRIPTIONS[attribute];
      info.setAttribute('aria-controls', details.id);
      row.append(main, details);
      this.attributeRows.set(attribute, { level, stats, decrease, increase, info, details });
      this.statsGrid.appendChild(row);
    }

    this.craftPanel = div({
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 94px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 94px)',
      width: 'min(280px, calc(100vw - 110px))',
      maxHeight: '58vh',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      padding: '14px',
      borderRadius: '12px',
      background: 'rgba(9,20,14,0.97)',
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
      display: 'none',
      pointerEvents: 'auto',
      font: '14px system-ui, sans-serif',
    });
    this.craftPanel.classList.add('elaris-panel');
    this.craftPanel.setAttribute('aria-label', 'Handcraft');
    wireDisclosure(this.craftButton, this.craftPanel, 'craft-panel');
    const heading = document.createElement('strong');
    heading.textContent = 'Handcraft';
    // Locked recipes are hidden rather than greyed out: the Blueprints tab is
    // the one place a recipe is bought, so nothing here can dead-end.
    this.craftEmpty = div({ marginTop: '8px', fontSize: '12px', opacity: '0.72', display: 'none' });
    this.craftEmpty.textContent = 'No tool blueprints yet — level up or find one in the field.';
    const recipe = div({ marginTop: '2px', lineHeight: '1.4' });
    this.craftPanel.append(heading, this.craftEmpty);
    for (const definition of CRAFTABLE_TOOL_DEFINITIONS) {
      if (WORKBENCH_TOOL_IDS.includes(definition.definitionId)) continue;
      const recipeButton = paletteCard(uiButton('', () => actions.onCraftTool(definition.definitionId)));
      this.recipeButtons.set(definition.definitionId, recipeButton);
      recipe.appendChild(recipeButton);
    }
    // Card faces are filled by refreshConsumableRecipes, which also disables
    // them, so stock counts and craftability never drift from the bag.
    this.snareButton = paletteCard(uiButton('', () => actions.onCraftSnare()));
    this.snareButton.setAttribute('aria-label', 'Craft Taming Snare');
    recipe.appendChild(this.snareButton);
    this.reinforcedSnareButton = paletteCard(uiButton('', () => actions.onCraftReinforcedSnare()));
    this.reinforcedSnareButton.setAttribute('aria-label', 'Craft Reinforced Snare');
    recipe.appendChild(this.reinforcedSnareButton);
    this.arrowsButton = paletteCard(uiButton('', () => actions.onCraftArrows()));
    this.arrowsButton.setAttribute('aria-label', 'Craft Arrows');
    recipe.appendChild(this.arrowsButton);
    this.clothMaskButton = paletteCard(uiButton('', () => actions.onCraftClothMask()));
    this.clothMaskButton.setAttribute('aria-label', 'Craft Cloth Mask');
    recipe.appendChild(this.clothMaskButton);
    this.toolsList = div({ marginTop: '2px' });
    this.toolsSection = paletteSection('Your tools');
    this.craftPanel.append(recipe, this.toolsSection, this.toolsList);

    // Facilities are opened by clicking the Storage Box, Workbench, or Furnace
    // itself (see WorldScene.performWorldAction) rather than a proximity button,
    // so competing nearby targets never fight for the same button slot.
    this.facilityPanel = div({
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(320px, calc(100vw - 24px))',
      maxHeight: 'min(520px, calc(100vh - 24px))',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      padding: '14px',
      borderRadius: '12px',
      background: 'rgba(9,20,14,0.97)',
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
      display: 'none',
      pointerEvents: 'auto',
      font: '14px system-ui, sans-serif',
    });
    this.facilityPanel.classList.add('elaris-panel');
    this.facilityPanel.dataset.facilitySurface='';
    this.facilityPanel.setAttribute('role', 'dialog');
    this.facilityPanel.setAttribute('aria-label', 'Facility actions');
    this.facilityHeading = document.createElement('strong');
    const facilityHeader = div({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
    const facilityCloseButton = uiButton('Close', () => this.closeFacility());
    Object.assign(facilityCloseButton.style, {
      minHeight: '40px',
      padding: '6px 14px',
      background: 'rgba(30,48,37,0.94)',
    });
    facilityHeader.append(this.facilityHeading, facilityCloseButton);
    this.facilityRecipes = div({ lineHeight: '1.4' });
    this.facilityRecipesEmpty = div({ marginTop: '8px', fontSize: '12px', opacity: '0.72', display: 'none' });
    this.facilityRecipesEmpty.dataset.facilityRecipesEmpty = '';
    this.facilityRecipesEmpty.textContent = 'No blueprints for this station yet — level up or find one in the field.';
    this.facilityRecipes.append(paletteSection('Recipes'), this.facilityRecipesEmpty);
    // A work table shows the blueprints the player owns; locked ones are bought
    // in the Blueprints tab, so no card here ever dead-ends on "Locked" text.
    for (const definitionId of WORKBENCH_TOOL_IDS) {
      const card = paletteCard(uiButton('', () => actions.onCraftTool(definitionId)));
      card.dataset.facilityRecipe = definitionId;
      this.facilityRecipeButtons.set(definitionId, card);
      this.facilityRecipes.appendChild(card);
    }
    this.facilityRowboatButton = paletteCard(uiButton('', () => actions.onCraftRowboat?.()));
    this.facilityRowboatButton.style.minWidth = '0';
    this.facilityRecipes.appendChild(this.facilityRowboatButton);
    // The drafting table: parchment from scrapped duplicates back into a
    // blueprint you do not own. Workbench-only, like every other irreversible
    // thing that can happen to a blueprint.
    this.facilityDraftButton = paletteCard(uiButton('', () => actions.onDraftBlueprint?.()));
    this.facilityDraftButton.style.minWidth = '0';
    this.facilityRecipes.appendChild(this.facilityDraftButton);
    this.facilityStorage = div({ display: 'none' });
    const transferHint = div({ marginTop: '5px', fontSize: '12px', opacity: '0.72' });
    transferHint.textContent = 'Select an item to move its stack to the other inventory.';
    const transferLayout = div({ display: 'grid', gap: '14px', marginTop: '10px' });
    transferLayout.classList.add('storage-transfer-layout');

    // Storage is first in DOM order so it naturally appears on top for mobile.
    const boxPane = div({ minWidth: '0' });
    boxPane.classList.add('storage-box-pane');
    boxPane.setAttribute('aria-label', 'Storage Box (small) inventory');
    const boxHeading = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' });
    const boxTitle = document.createElement('strong');
    boxTitle.textContent = 'Storage Box (small)';
    this.facilityBoxCount = document.createElement('span');
    Object.assign(this.facilityBoxCount.style, { fontSize: '12px', opacity: '0.72' });
    boxHeading.append(boxTitle, this.facilityBoxCount);
    this.facilityBoxGrid = div({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', marginTop: '8px' });
    boxPane.append(boxHeading, this.facilityBoxGrid);

    const bagPane = div({ minWidth: '0' });
    bagPane.classList.add('storage-bag-pane');
    bagPane.setAttribute('aria-label', 'Bag inventory');
    const bagHeading = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' });
    const bagTitle = document.createElement('strong');
    bagTitle.textContent = 'Bag';
    this.facilityBagCount = document.createElement('span');
    Object.assign(this.facilityBagCount.style, { fontSize: '12px', opacity: '0.72' });
    bagHeading.append(bagTitle, this.facilityBagCount);
    this.facilityBagGrid = div({ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px', marginTop: '8px' });
    bagPane.append(bagHeading, this.facilityBagGrid);
    transferLayout.append(boxPane, bagPane);
    this.facilityStorage.append(transferHint, transferLayout);
    this.facilityFurnace = div({ display: 'none' });
    this.facilityFurnaceStatus = div({ marginTop: '10px', fontSize: '12px', lineHeight: '1.4', opacity: '0.82' });
    this.facilitySmeltButton = paletteCard(uiButton('Smelt iron ingot', () => {
      const furnace = this.currentFacility?.definitionId === 'furnace' ? this.currentFacility : null;
      if (furnace) actions.onEnqueueIronSmelt(furnace.id);
    }));
    this.facilitySmeltButton.setAttribute('aria-label', 'Smelt iron ingot');
    this.facilityCollectFurnaceButton = paletteCard(uiButton('Collect iron ingots', () => {
      const furnace = this.currentFacility?.definitionId === 'furnace' ? this.currentFacility : null;
      if (furnace) actions.onCollectFurnace(furnace.id);
    }));
    this.facilityCollectFurnaceButton.setAttribute('aria-label', 'Collect iron ingots');
    this.facilityFurnace.append(
      paletteSection('2 iron ore + 1 wood'),
      this.facilityFurnaceStatus,
      this.facilitySmeltButton,
      this.facilityCollectFurnaceButton,
    );
    this.facilityFarm = div({ display: 'none' });
    this.facilityHousing = div({ display: 'none' });
    this.facilityWorker = div({ display: 'none' });
    // Defence: the War Table reports the coming raid, a Turret takes arrows.
    this.facilityDefence = div({ display: 'none' });
    this.facilityDefenceStatus = div({ marginTop: '10px', fontSize: '12px', lineHeight: '1.5', opacity: '0.86' });
    this.facilityLoadAmmoButton = paletteCard(uiButton(`Load ${TURRET_AMMO_STEP} arrows`, () => {
      const turret = this.currentFacility?.definitionId === 'turret' ? this.currentFacility : null;
      if (turret) actions.onLoadTurretAmmo?.(turret.id, TURRET_AMMO_STEP);
    }));
    this.facilityLoadAmmoButton.setAttribute('aria-label', 'Load arrows into turret');
    this.facilityUnloadAmmoButton = paletteCard(uiButton(`Unload ${TURRET_AMMO_STEP} arrows`, () => {
      const turret = this.currentFacility?.definitionId === 'turret' ? this.currentFacility : null;
      if (turret) actions.onUnloadTurretAmmo?.(turret.id, TURRET_AMMO_STEP);
    }));
    this.facilityUnloadAmmoButton.setAttribute('aria-label', 'Unload arrows from turret');
    this.facilityDefence.append(
      this.facilityDefenceStatus,
      this.facilityLoadAmmoButton,
      this.facilityUnloadAmmoButton,
    );
    this.facilityPanel.append(
      facilityHeader, this.facilityRecipes, this.facilityStorage, this.facilityFurnace,
      this.facilityFarm, this.facilityHousing, this.facilityWorker, this.facilityDefence,
    );

    this.feedback = div({
      position: 'absolute',
      left: '50%',
      top: '22%',
      transform: 'translateX(-50%)',
      maxWidth: '86vw',
      padding: '8px 12px',
      borderRadius: '8px',
      background: 'rgba(9,20,14,0.9)',
      opacity: '0',
      transition: 'opacity 0.15s',
      font: '600 14px system-ui, sans-serif',
      lineHeight: '1.35',
      textAlign: 'center',
    });
    this.feedback.setAttribute('role', 'status');
    this.feedback.setAttribute('aria-live', 'polite');
    this.gatherFeedback = div({
      position: 'absolute', left: '50%', bottom: 'calc(env(safe-area-inset-bottom) + 190px)',
      transform: 'translateX(-50%)', width: 'min(360px, calc(100vw - 32px))',
      padding: '12px 14px', boxSizing: 'border-box', border: '2px solid #a7c778', borderRadius: '8px',
      background: 'rgba(12,30,19,.97)', color: '#f2f9de', font: '700 14px system-ui,sans-serif',
      lineHeight: '1.45', textAlign: 'center', pointerEvents: 'none', display: 'none', zIndex: '3',
      boxShadow: '0 4px 18px rgba(0,0,0,.45)',
    });
    this.gatherFeedback.dataset.gatherAssistance = '';
    this.gatherFeedback.setAttribute('role', 'status');
    this.gatherFeedback.setAttribute('aria-live', 'polite');

    // Timer and XP are the permanent anchors. Transient vitals stay after XP
    // in priority order, so any one bar (or several together) forms one
    // uninterrupted stack beneath the always-visible pair.
    this.statusStack.append(
      this.survivalTimer, this.xpBar, this.blueprintClaim,
      this.healthBar, this.staminaBar, this.manaBar,
    );
    this.root.append(this.statusStack, this.resourceFlash, this.dangerGraceTimer, this.target, this.actionButton, this.throwSnareButton, this.sprintButton, this.facilityPanel, this.craftButton, this.creatureButton, this.statsButton, this.craftPanel, this.creaturePanel, this.statsPanel, this.feedback);
    this.root.append(this.gatherFeedback);
    parent.appendChild(this.root);
    this.progressionGuide = new ProgressionGuide(this.root, this.state, (questId) => this.claimQuestReward(questId));
    this.questCelebration = new QuestCelebration(this.root, this.state, (questId) => this.claimQuestReward(questId));
    this.blueprintCelebration = new BlueprintCelebration(
      this.root,
      this.state,
      () => this.openBlueprintsMenu(),
      () => this.blueprintBannerTop(),
    );
    this.refresh(null);
  }

  /**
   * Both payout surfaces — the banner and the quest log's Collect button —
   * route through the scene so the credit is saved like any other command.
   */
  private claimQuestReward(questId: string): boolean {
    return this.actions.onClaimQuestReward(questId);
  }

  /** The gold readout, mounted by the navigator so it stacks above the mini map. */
  get coinBadge(): HTMLDivElement {
    return this.coinScoreBadge;
  }

  /**
   * The battle screen owns the display while it is up, so the overworld status
   * readouts (survival timer, HP, XP) step aside instead of overlapping it.
   */
  setBattleMode(active: boolean): void {
    this.battleMode = active;
    this.statusStack.style.display = active ? 'none' : 'flex';
    this.questCelebration.setHidden(active);
    this.blueprintCelebration.setHidden(active);
    this.refreshThumbControls();
    if (active) this.dangerGraceTimer.style.display = 'none';
  }

  /**
   * Build mode owns the thumbs. Sprint and the action button both do nothing
   * useful while a ghost is out — the ghost is steered with the d-pad and
   * committed with Place — and they sit exactly where the placement bar and
   * the pad need the room, so they step aside for the duration.
   */
  setBuildMode(active: boolean): void {
    if (this.buildMode === active) return;
    this.buildMode = active;
    this.refreshThumbControls();
    if (active) this.target.style.display = 'none';
  }

  private refreshThumbControls(): void {
    const hidden = this.battleMode || this.buildMode;
    this.sprintButton.style.display = hidden ? 'none' : 'block';
    this.actionButton.style.display = this.buildMode ? 'none' : 'block';
    if (hidden) this.throwSnareButton.style.display = 'none';
  }

  /**
   * Offer the snare throw for a creature within snaring distance: the locked
   * one when it is that close, and otherwise simply the nearest.
   *
   * It does not insist on a lock, because a tap is a swing — and a swing sends
   * a skittish creature running, which would make "select it first" the one
   * thing guaranteed to put a stag out of snaring reach. Walking up to
   * something is selection enough for the snare.
   *
   * Disabled rather than hidden when the throw would be refused: an empty bag
   * or a full roster is something the player needs told, and a button that
   * simply vanishes teaches them nothing.
   */
  private refreshSnareButton(
    lockedTarget: ResolvedCombatTarget | null,
    nearestCreature: WildCreatureState | null,
  ): void {
    const locked = lockedTarget?.kind === 'creature' && lockedTarget.distancePx <= TAMING_RANGE_PX
      ? lockedTarget
      : null;
    const targetId = locked?.id ?? nearestCreature?.id ?? null;
    const eligible = targetId !== null && !isOpeningTuftle(this.state, targetId) && !this.battleMode && !this.buildMode && !this.state.activeEncounter;
    this.throwSnareButton.style.display = eligible ? 'block' : 'none';
    this.throwSnareButton.dataset.snareTarget = eligible ? targetId : '';
    if (!eligible) return;
    const blocked = snareThrowBlockedReason(this.state, targetId);
    const label = locked?.label
      ?? (nearestCreature ? creatureDefinition(nearestCreature.speciesId).displayName : 'creature');
    this.throwSnareButton.disabled = blocked !== null;
    this.throwSnareButton.style.opacity = blocked ? '0.55' : '1';
    this.throwSnareButton.title = blocked ?? `Open a taming session with the ${label}`;
  }

  /**
   * Whether the player is asking to sprint. The toggle stays on when stamina
   * runs dry — the simulation simply stops honouring it — so travel resumes at
   * a sprint as soon as the bar recovers rather than needing a second tap.
   */
  get sprinting(): boolean {
    return this.sprintEnabled;
  }

  /**
   * Whether the thumb action is being held down. The scene repeats the shot
   * while this is true, so a bow keeps firing during a walk instead of asking
   * the player to stop and tap once per arrow.
   */
  get actionPressed(): boolean {
    return this.actionHeld;
  }

  private readonly onActionPressStart = (): void => {
    this.actionHeld = true;
  };

  private readonly onActionPressEnd = (): void => {
    this.actionHeld = false;
  };

  private toggleSprint(): void {
    this.sprintEnabled = !this.sprintEnabled;
    const cost = sprintStaminaPerSecond(this.state);
    this.showFeedback(
      this.sprintEnabled
        ? `Sprinting · ${sprintSpeedMultiplier(this.state)}x speed · ${cost} SP/s`
        : 'Sprint off',
      true,
    );
    this.refreshSprint();
  }

  /** Colour and label the toggle: on, on-but-out-of-stamina, or off. */
  private refreshSprint(): void {
    const multiplier = sprintSpeedMultiplier(this.state);
    const cost = sprintStaminaPerSecond(this.state);
    const winded = this.sprintEnabled && !canSprint(this.state);
    this.sprintButton.textContent = winded ? 'Winded' : 'Sprint';
    this.sprintButton.style.background = this.sprintEnabled
      ? winded ? 'rgba(120,84,26,0.92)' : 'rgba(226,193,90,0.92)'
      : 'rgba(30,48,37,0.94)';
    this.sprintButton.style.color = this.sprintEnabled && !winded ? '#14210f' : '#e8f0ea';
    this.sprintButton.setAttribute('aria-pressed', String(this.sprintEnabled));
    this.sprintButton.setAttribute('aria-label', 'Sprint');
    this.sprintButton.title = `Sprint: ${multiplier}x walking speed for ${cost} SP per second`;
    this.sprintButton.dataset.sprintActive = String(this.sprintEnabled && !winded);
  }

  /** Move the former standalone panels into the shared gameplay menu. */
  attachToMenu(menu: InventoryPanel): void {
    this.menu = menu;
    this.craftButton.remove();
    this.creatureButton.remove();
    this.statsButton.remove();
    menu.registerTab('craft', 'Craft', this.craftPanel, () => {
      this.craftPanel.style.display = 'block';
      this.refreshTools();
      this.buildSectionOpened?.();
    });
    this.progressionGuide.attachToMenu(menu);
    menu.registerTab('creatures', 'Creatures', this.creaturePanel, () => {
      this.creaturePanel.style.display = 'block';
      this.refreshCreatures();
    });
    menu.registerTab('character', 'Character', this.statsPanel, () => {
      this.statsPanel.style.display = 'block';
      this.refreshStats();
    });
  }

  /**
   * Host the Build palette inside the Craft tab. Craft and Build were two tabs
   * over the same question — "what can I make?" — so they now share one, with
   * handcraft recipes above the structure palette.
   */
  mountBuildSection(section: HTMLElement, onCraftTabOpened: () => void): void {
    this.buildSectionOpened = onCraftTabOpened;
    // Ahead of "Your tools", which is a bag readout rather than a recipe list.
    this.craftPanel.insertBefore(section, this.toolsSection);
  }

  /**
   * One vital bar: pill, label, track, fill, and readout. `datasetKey` is the
   * stable hook e2e and screen readers use, so it must not change with state.
   */
  private buildVitalBar(
    label: string,
    datasetKey: string,
    fillColor: string,
  ): { root: HTMLDivElement; fill: HTMLDivElement; value: HTMLSpanElement } {
    const root = div({
      width: '100%',
      height: '34px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '5px 9px',
      borderRadius: '18px',
      color: '#f6fff8',
      background: 'rgba(9,20,14,0.9)',
      border: '1px solid rgba(255,255,255,0.28)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
      boxSizing: 'border-box',
      font: '800 12px system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      // Fades and collapses rather than unmounting. The node always stays in
      // the DOM so the e2e hooks and aria labels keep resolving; what changes
      // is its height, animated so the stack slides instead of jumping. A
      // reserved-but-empty slot was the other option and it just left holes.
      overflow: 'hidden',
      maxHeight: '34px',
      transition: 'opacity 260ms ease-out, max-height 260ms ease-out,'
        + ' margin-top 260ms ease-out, padding 260ms ease-out',
    });
    root.dataset[datasetKey] = '';
    root.dataset.vitalKind=label;
    root.style.setProperty('--vital-dark',label==='HP'?'#577c53':label==='SP'?'#a58d47':'#558b98');
    root.style.setProperty('--vital-light',label==='HP'?'#acd08a':label==='SP'?'#e0c77c':'#a0d3d6');
    root.setAttribute('role', 'progressbar');
    const caption = document.createElement('span');
    caption.textContent = label;
    const track = div({
      position: 'relative',
      flex: '1',
      height: '10px',
      overflow: 'hidden',
      borderRadius: '5px',
      background: 'rgba(0,0,0,0.52)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
    });
    const fill = div({
      width: '100%',
      height: '100%',
      borderRadius: 'inherit',
      background: fillColor,
      transition: 'width 80ms linear, background-color 120ms linear',
    });
    fill.dataset[`${datasetKey}Fill`] = '';
    fill.dataset.vitalFill='';
    track.appendChild(fill);
    const value = document.createElement('span');
    value.style.whiteSpace = 'nowrap';
    root.append(caption, track, value);
    return { root, fill, value };
  }

  /** Apply value, colour, a11y, and the idle-hide policy to one bar. */
  private refreshVitalBar(
    bar: HTMLDivElement,
    fill: HTMLDivElement,
    value: HTMLSpanElement,
    key: string,
    label: string,
    current: number,
    max: number,
    color: (ratio: number) => string,
  ): void {
    const ratio = Math.max(0, Math.min(1, current / Math.max(1, max)));
    fill.style.width = `${ratio * 100}%`;
    fill.style.background = color(ratio);
    value.textContent = `${current}/${max}`;
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(max));
    bar.setAttribute('aria-valuenow', String(current));
    bar.setAttribute('aria-label', `${label} ${current} of ${max}`);

    const now = performance.now();
    const opacity = vitalBarOpacity({
      max,
      lastChangedAtMs: this.vitalActivity.record(key, current, max, now),
      nowMs: now,
    });
    bar.style.opacity = String(opacity);
    const hidden = vitalBarHidden(opacity);
    // Collapsed to nothing, including the flex gap it would otherwise still
    // claim, so a hidden bar costs no space at all.
    bar.style.maxHeight = hidden ? '0px' : '34px';
    bar.style.marginTop = hidden ? '-7px' : '0px';
    bar.style.paddingTop = hidden ? '0px' : '5px';
    bar.style.paddingBottom = hidden ? '0px' : '5px';
    bar.style.borderWidth = hidden ? '0px' : '1px';
    // Hidden from assistive tech as well as the eye, but still in the tree.
    bar.setAttribute('aria-hidden', String(hidden));
    bar.dataset.vitalHidden = String(hidden);
  }

  refresh(
    targetNode: ResourceNodeState | null,
    targetDrop: GroundDropState | null = null,
    targetCreature: WildCreatureState | null = null,
  ): void {
    const player = this.state.player;
    this.refreshVitalBar(
      this.healthBar, this.healthBarFill, this.healthBarValue, 'hp', 'Health',
      player.hp, player.maxHp,
      (ratio) => (ratio > 0.5 ? '#59c879' : ratio > 0.25 ? '#f0b94f' : '#ef6464'),
    );
    this.refreshVitalBar(
      this.staminaBar, this.staminaBarFill, this.staminaBarValue, 'sp', 'Stamina',
      player.stamina, player.maxStamina, () => '#e2c15a',
    );
    this.refreshVitalBar(
      this.manaBar, this.manaBarFill, this.manaBarValue, 'mp', 'Mana',
      player.mana, player.maxMana, () => '#6fa8e8',
    );
    const xpMax = xpToNextLevel(this.state.player.level);
    const xpRatio = Math.max(0, Math.min(1, this.state.player.xp / Math.max(1, xpMax)));
    this.xpBarFill.style.width = `${xpRatio * 100}%`;
    this.xpBarValue.textContent = `${this.state.player.xp}/${xpMax}`;
    this.xpBar.setAttribute('aria-valuemin', '0');
    this.xpBar.setAttribute('aria-valuemax', String(xpMax));
    this.xpBar.setAttribute('aria-valuenow', String(this.state.player.xp));
    this.xpBar.setAttribute('aria-label', `Level ${this.state.player.level} experience ${this.state.player.xp} of ${xpMax} · open Character`);
    const hasUnspentAttributePoints = this.state.player.attributePoints > 0;
    this.xpBar.classList.toggle('elaris-xp-points-ready', hasUnspentAttributePoints);
    this.xpBar.dataset.unspentAttributePoints = String(this.state.player.attributePoints);
    this.xpBar.title = hasUnspentAttributePoints
      ? `${this.state.player.attributePoints} attribute point${this.state.player.attributePoints === 1 ? '' : 's'} ready to spend · opens Character`
      : 'Opens Character';
    this.refreshBlueprintClaim();

    const raid = this.state.gameBalance.raid;
    const timer = survivalSchedule(this.state);
    // Each danger asks for different preparation — filters and a purified room,
    // arrows and a loaded turret, or nothing but room to move — so the timer
    // names which one is coming rather than saying "DANGER" and leaving the
    // player to guess. Every label comes from one exhaustive table, because a
    // ternary here silently mislabels whatever threat is added next.
    const copy = DANGER_THREAT_COPY[timer.threat];
    // Fog is survived behind a filter; a raid and a storm behind walls — an
    // enclosed room is cover from both, whether or not anything runs inside it.
    const safeIndoors = copy.cover === null
      ? isElarisTownSafeZone(this.state)
      : timer.threat === 'fog'
        ? isPlayerSheltered(this.state)
        : isPlayerEnclosed(this.state);
    const covered = timer.phase === 'danger' && safeIndoors;
    const coverLabel = copy.cover?.badge ?? DANGER_SANCTUARY_BADGE;
    const coverSpoken = copy.cover?.spoken ?? 'in sanctuary';
    const impact = timer.phase === 'danger' && timer.threat === 'storm'
      ? nextStormImpactView(this.state)
      : null;
    const grace = dangerGraceTimer(this.state);
    // Masks are spent automatically, so the badge is the only place the player
    // can see one working — and see how long they have before the next is drawn.
    const maskSeconds = clothMaskSecondsRemaining(this.state);
    this.survivalTimer.textContent = timer.openingPhase === 'waiting' ? 'FIRST FOG · BUILD SHELTER'
      : timer.openingPhase === 'preparing' ? `FIRST FOG IN  ${timer.label}` : timer.phase === 'safe'
      ? `${copy.timerLabel} IN  ${timer.label}`
      : `${copy.timerLabel}  ${timer.label}${covered ? `  ·  ${coverLabel}` : ''}`;
    this.survivalTimer.style.color = timer.phase === 'safe' ? '#d7f3df' : covered ? '#fff0a8' : '#ffd1d1';
    this.survivalTimer.style.background = timer.phase === 'safe'
      ? 'rgba(9,20,14,0.92)'
      : covered ? 'rgba(83,64,18,0.95)' : 'rgba(92,18,18,0.96)';
    this.survivalTimer.style.borderColor = timer.phase === 'safe'
      ? 'rgba(125,205,147,0.42)'
      : covered ? 'rgba(255,224,138,0.62)' : 'rgba(255,106,106,0.78)';
    this.survivalTimer.setAttribute('aria-label', timer.openingPhase === 'waiting' ? 'First fog waits for a working shelter'
      : timer.openingPhase === 'preparing' ? `First fog preparation, poison fog in ${timer.label}` : timer.phase === 'safe'
      ? `Safe phase, ${copy.spokenName} in ${timer.label}`
      : `${copy.spokenNameCapitalized}, ${timer.label} remaining, ${covered ? coverSpoken : 'exposed'}`);
    // The storm has no exposure clock, so the secondary badge carries the one
    // number that matters instead: how long until the ring underfoot lands.
    const secondary = grace !== null || impact !== null;
    this.dangerGraceTimer.style.display = secondary ? 'grid' : 'none';
    this.dangerGraceTimer.textContent = impact
      ? `IMPACT  ${formatCountdown(impact.secondsRemaining)}  ·  ${
        impact.playerInsideRadius ? 'MOVE OUT OF THE RING' : 'CLEAR'}${
        impact.strike.rewardIronOre > 0 ? '  ·  CHARGED ORE' : ''}`
      : grace
        ? grace.secondsRemaining > 0
          ? `GET TO SAFETY  ${grace.label}`
          : maskSeconds > 0
            ? `CLOTH MASK  ${maskSeconds}s  ·  ${this.state.inventory['cloth-mask']} left`
            : `EXPOSURE  ·  -${exposureDamagePerSecond(raid, 1)}+ HP/s`
        : '';
    if (impact) {
      this.dangerGraceTimer.setAttribute('aria-label', `Arcane impact in ${impact.secondsRemaining} seconds, ${
        impact.playerInsideRadius ? 'you are inside the ring, move out' : 'you are clear of the ring'}${
        impact.strike.rewardIronOre > 0 ? `, drops ${impact.strike.rewardIronOre} charged iron ore` : ''}`);
    } else if (grace) {
      this.dangerGraceTimer.setAttribute('aria-label', grace.secondsRemaining > 0
        ? `${grace.secondsRemaining} seconds to get to safety`
        : maskSeconds > 0
          ? `Cloth Mask filtering for ${maskSeconds} more seconds, ${this.state.inventory['cloth-mask']} spare`
          : `Exposure draining ${exposureDamagePerSecond(raid, 1)} health per second and rising`);
    } else this.dangerGraceTimer.removeAttribute('aria-label');
    const coins = coinScore(this.state);
    this.coinScoreValue.textContent = coins.toLocaleString('en-US');
    this.coinScoreBadge.setAttribute('aria-label', `Gold: ${coins}`);
    let ownedRecipes = 0;
    for (const definition of CRAFTABLE_TOOL_DEFINITIONS) {
      if (WORKBENCH_TOOL_IDS.includes(definition.definitionId)) continue;
      const currentDefinition = gameToolDefinition(this.state, definition.definitionId);
      const recipeButton = this.recipeButtons.get(definition.definitionId)!;
      const owned = knowsBlueprint(this.state, definition.definitionId);
      recipeButton.style.display = owned ? 'block' : 'none';
      if (!owned) continue;
      ownedRecipes += 1;
      const missing = this.costLabel(currentDefinition.craftCost);
      const locked = toolUnlockReason(this.state, definition.definitionId);
      recipeButton.disabled = locked !== null || !this.canAfford(currentDefinition.craftCost);
      recipeButton.replaceChildren(
        this.cardTitle(definition.displayName, missing || 'No materials'),
        this.cardDetail(locked ?? `${definition.kind[0]!.toUpperCase() + definition.kind.slice(1)} · ${currentDefinition.maxDurability} durability · ${useCostLabel(currentDefinition.useCost)} · equips on creation`),
      );
      if (definition.definitionId === 'wooden-pick') {
        recipeButton.setAttribute('aria-label', 'Craft & equip');
        recipeButton.title = `Wooden Pick: ${missing}`;
      } else {
        recipeButton.removeAttribute('aria-label');
        recipeButton.title = '';
      }
    }
    this.craftEmpty.style.display = ownedRecipes === 0 ? 'block' : 'none';
    this.refreshSprint();
    this.refreshConsumableRecipes();
    this.refreshTools();
    this.progressionGuide.refresh();
    this.questCelebration.sync();
    this.blueprintCelebration.sync();
    this.refreshTargets(targetNode, targetDrop, targetCreature);
    this.refreshCreatures();
    this.refreshStats();
  }

  /**
   * Update only the walk-up actions that can change while the player moves.
   * Keeping this separate avoids rebuilding recipes, roster cards, and stats
   * whenever the nearest world target changes.
   */
  refreshTargets(
    targetNode: ResourceNodeState | null,
    targetDrop: GroundDropState | null = null,
    targetCreature: WildCreatureState | null = null,
    lockedTarget: ResolvedCombatTarget | null = null,
  ): void {
    this.refreshAction(targetNode, targetDrop, targetCreature, lockedTarget);
    this.refreshSnareButton(lockedTarget, targetCreature);
    this.refreshOpenFacility();
  }

  /** Let renderer-neutral contexts such as doors and interiors own the action prompt. */
  setContextActionOverride(label: string | null, hint = ''): void {
    const next = label ? { label, hint } : null;
    if (this.contextActionOverride?.label === next?.label && this.contextActionOverride?.hint === next?.hint) return;
    this.contextActionOverride = next;
    this.refreshAction(null, null, null, null);
  }

  /** Open the focused panel for a facility the player clicked. */
  openFacility(building: BuildingState): void {
    if (!FACILITY_RECIPES[building.definitionId]) return;
    this.currentFacility = building;
    this.facilityHeading.textContent = buildableById(building.definitionId).displayName;
    this.menu?.close();
    this.facilityPanel.style.display = 'block';
    this.refreshFacilityPanel();
  }

  /** The building id whose facility panel is open, or null when closed. */
  getOpenFacilityId(): string | null {
    return this.facilityPanel.style.display !== 'none' ? this.currentFacility?.id ?? null : null;
  }

  /** Keep the open facility panel's affordability/storage/furnace state current. */
  private refreshOpenFacility(): void {
    if (this.facilityPanel.style.display === 'none' || !this.currentFacility) return;
    this.refreshFacilityPanel();
  }

  private refreshFacilityPanel(): void {
    this.refreshFacilityRecipes();
    const cache = this.currentFacility && (this.currentFacility.definitionId === 'field-cache' || this.currentFacility.definitionId === 'warehouse')
      ? this.currentFacility : null;
    const furnace = this.currentFacility?.definitionId === 'furnace' ? this.currentFacility : null;
    const turret = this.currentFacility?.definitionId === 'turret' ? this.currentFacility : null;
    const warTable = this.currentFacility?.definitionId === 'war-table' ? this.currentFacility : null;
    const farmCounter = this.currentFacility?.definitionId === 'farm-counter' ? this.currentFacility : null;
    const housing = this.currentFacility?.definitionId === 'small-pen' || this.currentFacility?.definitionId === 'barn'
      ? this.currentFacility : null;
    const workerFacility = this.currentFacility?.definitionId === 'stone-yard' || this.currentFacility?.definitionId === 'cart-dock'
      ? this.currentFacility : null;
    const logisticsHub = this.currentFacility?.definitionId === 'logistics-hub' ? this.currentFacility : null;
    const defence = turret ?? warTable;
    this.facilityRecipes.style.display = cache || furnace || farmCounter || housing || workerFacility || logisticsHub || defence ? 'none' : 'block';
    this.facilityStorage.style.display = cache ? 'block' : 'none';
    this.facilityFurnace.style.display = furnace ? 'block' : 'none';
    this.facilityDefence.style.display = defence ? 'block' : 'none';
    this.facilityFarm.style.display = farmCounter ? 'block' : 'none';
    this.facilityHousing.style.display = housing ? 'block' : 'none';
    this.facilityWorker.style.display = workerFacility || logisticsHub ? 'block' : 'none';
    if (defence) this.refreshDefenceControls(turret);
    this.applyFacilityPanelLayout(cache !== null);
    if (cache) this.refreshStorageTransfer(cache);
    if (furnace) this.refreshFurnaceControls(
      furnace,
      this.facilityFurnaceStatus,
      this.facilitySmeltButton,
      this.facilityCollectFurnaceButton,
    );
    if (farmCounter) this.refreshFarmCounter();
    if (housing) this.refreshHousing(housing);
    if (workerFacility) {
      delete this.facilityWorker.dataset.logisticsSignature;
      this.refreshWorkerFacility(workerFacility);
    }
    if (logisticsHub) this.refreshLogisticsHub(logisticsHub);
  }

  private refreshFarmCounter(): void {
    const heading = paletteSection('Trained creature orders');
    const purse = div({ marginTop: '6px', fontSize: '12px', color: '#ffe08a' });
    purse.textContent = `${this.state.coins} coins · Requires a discovered species, Rating 250, and free housing.`;
    const rows = CREATURE_DEFINITIONS.map((definition) => {
      const blocked = farmOrderBlockedReason(this.state, definition.speciesId);
      const button = paletteCard(uiButton('', () => this.actions.onOrderTrainedCreature?.(definition.speciesId)));
      button.replaceChildren(
        this.cardTitle(definition.displayName, `${FARM_ORDER_COSTS[definition.speciesId]} coins`),
        this.cardDetail(blocked ?? 'Order into the next free Pen/Barn slot.'),
      );
      button.disabled = blocked !== null;
      button.setAttribute('aria-label', `Order trained ${definition.displayName}`);
      return button;
    });
    this.facilityFarm.replaceChildren(heading, purse, ...rows);
  }

  private refreshHousing(housing: BuildingState): void {
    const view = housingCapacityForBuilding(this.state, housing);
    const bin = housing.housing?.bin ?? { fiber: 0, berry: 0 };
    const status = div({ marginTop: '8px', fontSize: '12px', lineHeight: '1.5', opacity: '0.86' });
    const gate = view ? null : housingOperationGate(this.state, housing);
    status.textContent = view
      ? `Paddock ${view.area} tiles · Housing ${view.assigned}/${view.capacity} · Bin ${housingBinCount(housing)}/${housingBinCapacity(housing)}`
      : `Housing suspended · ${gate?.message || 'repair the enclosed prepared-ground paddock'}.`;
    const fiber = paletteCard(uiButton(`Collect fiber (${bin.fiber})`, () => this.actions.onCollectHousingBin?.(housing.id, 'fiber')));
    const berry = paletteCard(uiButton(`Collect berries (${bin.berry})`, () => this.actions.onCollectHousingBin?.(housing.id, 'berry')));
    fiber.disabled = bin.fiber <= 0;
    berry.disabled = bin.berry <= 0;
    fiber.setAttribute('aria-label', 'Collect worker fiber');
    berry.setAttribute('aria-label', 'Collect worker berries');
    this.facilityHousing.replaceChildren(paletteSection('Housing and collection bin'), status, fiber, berry);
  }

  private refreshWorkerFacility(facility: BuildingState): void {
    if (facility.definitionId === 'stone-yard') {
      const stone = facility.producer?.bin.stone ?? 0;
      const status = div({ marginTop: '8px', fontSize: '12px', lineHeight: '1.5', opacity: '0.86' });
      status.textContent = `Stone bin ${workerFacilityBinCount(facility)}/${workerFacilityBinCapacity(facility)} Â· assign a housed Craghopper to work here.`;
      const collect = paletteCard(uiButton(`Collect stone (${stone})`, () => this.actions.onCollectHousingBin?.(facility.id, 'stone')));
      collect.disabled = stone <= 0;
      collect.setAttribute('aria-label', 'Collect worker stone');
      this.facilityWorker.replaceChildren(paletteSection('Craghopper stone delivery'), status, collect);
      return;
    }
    const status = div({ marginTop: '8px', fontSize: '12px', lineHeight: '1.5', opacity: '0.86' });
    const linked = facility.cartDock?.linkedStorageId ?? null;
    const assigned = this.state.ownedCreatures.find((creature) => creature.speciesId === 'glade-stag'
      && creature.role === 'work' && creature.worksiteId === facility.id);
    status.textContent = `${assigned ? `${assigned.name} assigned` : 'No Glade Stag assigned'} Â· ${facility.cartDock?.lastTransferMessage ?? 'Choose a destination, then re-enter this work yard to unload.'}`;
    const clear = paletteCard(uiButton('Clear storage link', () => this.actions.onLinkCartDockStorage?.(facility.id, null)));
    clear.disabled = linked === null;
    const destinations = cartDockStorageCandidates(this.state).map((storage) => {
      const button = paletteCard(uiButton(`Storage Box ${storage.id}`, () => this.actions.onLinkCartDockStorage?.(facility.id, storage.id)));
      button.disabled = storage.id === linked;
      button.setAttribute('aria-pressed', storage.id === linked ? 'true' : 'false');
      return button;
    });
    this.facilityWorker.replaceChildren(paletteSection('Glade Stag cart transfer'), status, ...destinations, clear);
  }

  private refreshLogisticsHub(hub: BuildingState): void {
    const workers = logisticsWorkerCandidates(this.state);
    const destinations = logisticsStorageCandidates(this.state);
    const signature = JSON.stringify({
      workers: workers.map((worker) => [worker.id, worker.name, worker.worksiteId]),
      destinations: destinations.map((destination) => [destination.id, destination.definitionId]),
      routes: hub.logistics?.routes ?? [],
      message: hub.logistics?.lastRoutingMessage ?? null,
    });
    if (this.facilityWorker.dataset.logisticsSignature === signature) return;
    this.facilityWorker.dataset.logisticsSignature = signature;
    const status = div({ marginTop: '8px', fontSize: '12px', lineHeight: '1.5', opacity: '0.86' });
    status.textContent = hub.logistics?.lastRoutingMessage ?? 'Choose a worker, then destinations in priority order.';
    const rows: HTMLElement[] = [];
    for (const worker of workers) {
      const route = hub.logistics?.routes.find((candidate) => candidate.sourceWorkerId === worker.id);
      const heading = div({ marginTop: '10px', fontWeight: '700', fontSize: '12px' });
      heading.textContent = route ? logisticsRouteLabel(this.state, route) : `${worker.name} · no route`;
      rows.push(heading);
      for (const destination of destinations) {
        const current = route?.destinationContainerIds ?? [];
        const priority = current.indexOf(destination.id);
        const label = `${priority >= 0 ? `${priority + 1}. ` : 'Add '}${buildableById(destination.definitionId).displayName} ${destination.id}`;
        const button = paletteCard(uiButton(label, () => {
          const latest = hub.logistics?.routes.find((candidate) => candidate.sourceWorkerId === worker.id)?.destinationContainerIds ?? [];
          if (!latest.includes(destination.id)) this.actions.onSetLogisticsRoute?.(hub.id, worker.id, [...latest, destination.id]);
        }));
        button.disabled = priority >= 0;
        rows.push(button);
      }
      if (route) {
        const clear = paletteCard(uiButton('Clear worker route', () => this.actions.onClearLogisticsRoute?.(hub.id, worker.id)));
        rows.push(clear);
      }
    }
    if (workers.length === 0) {
      const empty = div({ marginTop: '10px', fontSize: '12px', opacity: '0.75' });
      empty.textContent = 'Assign a housed Tuftle or Craghopper to a producing worksite first.';
      rows.push(empty);
    } else if (destinations.length === 0) {
      const empty = div({ marginTop: '10px', fontSize: '12px', opacity: '0.75' });
      empty.textContent = 'Build a Storage Box or Warehouse destination.';
      rows.push(empty);
    }
    this.facilityWorker.replaceChildren(paletteSection('Ordered worker routes'), status, ...rows);
  }

  private applyFacilityPanelLayout(storageOpen: boolean): void {
    Object.assign(this.facilityPanel.style, {
      width: storageOpen ? 'min(760px, calc(100vw - 24px))' : 'min(320px, calc(100vw - 24px))',
      maxHeight: storageOpen ? 'min(680px, calc(100vh - 24px))' : 'min(520px, calc(100vh - 24px))',
    });
  }

  private refreshStorageTransfer(cache: BuildingState): void {
    this.facilityBagCount.textContent = `${usedInventorySlots(this.state)}/${INVENTORY_SLOTS} spaces`;
    this.facilityBoxCount.textContent = `${usedStorageBoxSlots(cache)}/${storageContainerSlots(cache)} spaces`;
    this.facilityBagGrid.replaceChildren();
    for (const entry of inventorySlotEntries(this.state)) {
      this.facilityBagGrid.appendChild(this.transferCell(entry, 'bag', cache));
    }
    this.facilityBoxGrid.replaceChildren();
    for (const entry of storageBoxSlotEntries(cache)) {
      this.facilityBoxGrid.appendChild(this.transferCell(entry, 'box', cache));
    }
  }

  private transferCell(entry: SlotEntry, source: 'bag' | 'box', cache: BuildingState): HTMLElement {
    // Storage Boxes take blueprints in a later phase, along with the raider heat
    // that follows them in. For now a carried blueprint shows in the grid but
    // is not transferable, so it can never be silently parked out of reach.
    const actionable = entry.kind !== 'empty' && entry.kind !== 'blueprint';
    const cell = document.createElement(actionable ? 'button' : 'div');
    Object.assign(cell.style, {
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      aspectRatio: '1', minWidth: '0', padding: '3px', border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: '9px', color: '#e8f0ea', background: 'rgba(30,48,37,0.94)',
      font: '600 11px system-ui, sans-serif', cursor: actionable ? 'pointer' : 'default',
      touchAction: 'manipulation', opacity: actionable ? '1' : '0.35',
    } satisfies Partial<CSSStyleDeclaration>);
    if (entry.kind === 'empty') return cell;
    if (entry.kind === 'blueprint') {
      cell.setAttribute('aria-label', `Blueprint: ${entry.carried.blueprintId.replace(/-/g, ' ')}`);
      const icon = div({ display: 'grid', placeItems: 'center' });
      setUiIcon(icon, 'blueprint', 20);
      const label = div({ fontSize: '10px', marginTop: '3px', textAlign: 'center' });
      label.textContent = 'Blueprint';
      cell.append(icon, label);
      return cell;
    }
    if (entry.kind === 'resource') {
      const destination = source === 'bag' ? 'Storage Box (small)' : 'Bag';
      cell.setAttribute('aria-label', `Move ${entry.resource} stack, ${entry.amount}, to ${destination}`);
      const name = div({ fontSize: '11px', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' });
      name.textContent = entry.resource;
      const amount = div({ fontSize: '11px', opacity: '0.8' });
      amount.textContent = `×${entry.amount}`;
      cell.append(name, amount);
      cell.addEventListener('click', () => {
        if (source === 'bag') this.actions.onDepositResourceToCache?.(entry.resource, entry.stackIndex, cache.id);
        else this.actions.onWithdrawResourceFromCache?.(entry.resource, entry.stackIndex, cache.id);
      });
      return cell;
    }
    const name = toolDefinition(entry.tool.definitionId).displayName;
    cell.setAttribute('aria-label', `Move ${name} to ${source === 'bag' ? 'Storage Box (small)' : 'Bag'}`);
    const icon = div({ display: 'grid', placeItems: 'center' });
    setUiIcon(icon, toolDefinition(entry.tool.definitionId).kind, 20);
    const label = div({ fontSize: '10px', marginTop: '3px', textAlign: 'center' });
    label.textContent = name;
    cell.append(icon, label);
    cell.addEventListener('click', () => {
      if (source === 'bag') this.actions.onDepositToolToCache?.(entry.tool.instanceId, cache.id);
      else this.actions.onWithdrawToolFromCache?.(entry.tool.instanceId, cache.id);
    });
    return cell;
  }

  /** Stock, cost, and craftability for the handcraft consumables. */
  private refreshConsumableRecipes(): void {
    const snareKnown = knowsBlueprint(this.state, 'taming-snare');
    this.snareButton.style.display = snareKnown ? 'block' : 'none';
    this.snareButton.disabled = !snareKnown || !this.canAfford(TAMING_SNARE_CRAFT_COST);
    this.snareButton.replaceChildren(
      this.cardTitle('Taming Snare', this.costLabel(TAMING_SNARE_CRAFT_COST)),
      this.cardDetail(`Tame weakened creatures during encounters. ${this.state.inventory['taming-snare']} in bag.`),
    );
    const reinforcedSnareKnown = knowsBlueprint(this.state, 'reinforced-snare');
    this.reinforcedSnareButton.style.display = reinforcedSnareKnown ? 'block' : 'none';
    this.reinforcedSnareButton.disabled = !reinforcedSnareKnown || !this.canAfford(REINFORCED_SNARE_CRAFT_COST);
    this.reinforcedSnareButton.replaceChildren(
      this.cardTitle(`Reinforced Snare ×${REINFORCED_SNARES_PER_CRAFT}`, this.costLabel(REINFORCED_SNARE_CRAFT_COST)),
      this.cardDetail(
        'Trophy snare, far likelier to hold. Thrown before a basic snare. '
        + `${this.state.inventory['reinforced-snare']} in bag.`,
      ),
    );
    const arrowsKnown = knowsBlueprint(this.state, 'arrow');
    this.arrowsButton.style.display = arrowsKnown ? 'block' : 'none';
    this.arrowsButton.disabled = !arrowsKnown || !this.canAfford(ARROWS_CRAFT_COST);
    this.arrowsButton.replaceChildren(
      this.cardTitle(`Arrows ×${ARROWS_PER_CRAFT}`, this.costLabel(ARROWS_CRAFT_COST)),
      this.cardDetail(`Ammunition for ranged encounter actions. ${this.state.inventory.arrow} in bag.`),
    );
    const clothMaskKnown = knowsBlueprint(this.state, 'cloth-mask');
    this.clothMaskButton.style.display = clothMaskKnown ? 'block' : 'none';
    this.clothMaskButton.disabled = !clothMaskKnown || !this.canAfford(CLOTH_MASK_CRAFT_COST);
    this.clothMaskButton.replaceChildren(
      this.cardTitle('Cloth Mask', this.costLabel(CLOTH_MASK_CRAFT_COST)),
      this.cardDetail(`Filters poison fog for ${CLOTH_MASK_PROTECTION_SECONDS}s. Stacks; one is used automatically.`),
    );
  }

  /** Craftability + lock text for the current facility's recipe cards. */
  private refreshFacilityRecipes(): void {
    const recipes = this.currentFacility ? FACILITY_RECIPES[this.currentFacility.definitionId] : undefined;
    let ownedRecipes = 0;
    for (const [definitionId, button] of this.facilityRecipeButtons) {
      const exposed = (recipes?.includes(definitionId) ?? false)
        && knowsBlueprint(this.state, definitionId);
      button.style.display = exposed ? 'block' : 'none';
      if (!exposed) continue;
      ownedRecipes += 1;
      const base = toolDefinition(definitionId);
      const definition = gameToolDefinition(this.state, definitionId);
      const missing = this.costLabel(definition.craftCost);
      const locked = toolUnlockReason(this.state, definitionId);
      button.disabled = locked !== null || !this.canAfford(definition.craftCost);
      button.replaceChildren(
        this.cardTitle(base.displayName, missing || 'No materials'),
        this.cardDetail(locked ?? `${base.kind[0]!.toUpperCase() + base.kind.slice(1)} · ${definition.maxDurability} durability · ${useCostLabel(definition.useCost)} · equips on creation`),
      );
    }
    const workbenchOpen = this.currentFacility?.definitionId === 'workbench';
    // Only stations that actually offer recipes explain an empty recipe list.
    this.facilityRecipesEmpty.style.display = (recipes?.length ?? 0) > 0 && ownedRecipes === 0 ? 'block' : 'none';
    // Found like any other blueprint, so the card is hidden until it is known.
    // An owner keeps seeing it because that card is where "you already have one,
    // launch it from a shoreline" is written.
    const rowboatExposed = workbenchOpen
      && (knowsBlueprint(this.state, 'rowboat') || this.state.rowboatOwned === true);
    this.facilityRowboatButton.style.display = rowboatExposed ? 'block' : 'none';
    if (rowboatExposed) {
      const cost = this.costLabel(ROWBOAT_CRAFT_COST);
      this.facilityRowboatButton.disabled = this.state.rowboatOwned || !this.canAfford(ROWBOAT_CRAFT_COST);
      this.facilityRowboatButton.replaceChildren(
        this.cardTitle('Rowboat', cost),
        this.cardDetail(this.state.rowboatOwned ? 'Owned · face a shoreline and use E / Space' : 'Travel across rivers and lakes.'),
      );
      this.facilityRowboatButton.setAttribute('aria-label', 'Craft Rowboat');
    }
    this.facilityDraftButton.style.display = workbenchOpen ? 'block' : 'none';
    if (workbenchOpen) {
      const held = this.state.inventory['draft-parchment'];
      const blocked = draftBlockedReason(this.state);
      this.facilityDraftButton.disabled = blocked !== null;
      this.facilityDraftButton.replaceChildren(
        this.cardTitle('Create Blueprint', `${held}/${BLUEPRINT_DRAFT_COST} Draft Parchment`),
        this.cardDetail(blocked
          ?? 'Draws a blueprint you do not own. Rarer tiers are far less likely.'),
      );
      this.facilityDraftButton.setAttribute('aria-label', 'Create Blueprint');
    }
  }

  closeFacility(): void {
    this.facilityPanel.style.display = 'none';
  }

  /**
   * One panel body for both defence facilities. A Turret shows its magazine and
   * the load controls; the War Table shows what the next raid will meet — how
   * many turrets are actually loaded, and what is damaged and still repairable.
   * Repair matters here because at 0 health a structure is gone for good.
   */
  private refreshDefenceControls(turret: BuildingState | null): void {
    const balance = this.state.gameBalance;
    const defense = balance.defense;
    const loadable = turret !== null;
    this.facilityLoadAmmoButton.style.display = loadable ? 'block' : 'none';
    this.facilityUnloadAmmoButton.style.display = loadable ? 'block' : 'none';

    if (turret) {
      const ammo = turret.turret?.ammo ?? 0;
      this.facilityLoadAmmoButton.disabled = this.state.inventory.arrow <= 0 || ammo >= defense.turretAmmoCapacity;
      this.facilityUnloadAmmoButton.disabled = ammo <= 0;
      this.facilityDefenceStatus.textContent = ammo > 0
        ? `Loaded ${ammo}/${defense.turretAmmoCapacity} arrows · ${defense.turretDamage} damage per shot · ${this.state.inventory.arrow} arrows in your bag`
        : `Empty · load arrows or this turret sits out the raid · ${this.state.inventory.arrow} arrows in your bag`;
      return;
    }

    const timer = survivalSchedule(this.state);
    const armed = this.state.buildings.filter(
      (building) => building.definitionId === 'turret' && (building.turret?.ammo ?? 0) > 0,
    ).length;
    const placed = this.state.buildings.filter((building) => building.definitionId === 'turret').length;
    const damaged = this.state.buildings.filter((building) => isStructureDamaged(building, balance)).length;
    // Raids fall on every other cycle now, so the War Table reports the danger
    // phase actually coming next. Previewing a raid during a fog cycle would be
    // telling the player to stock arrows for a night that wants filters.
    const cycleIndex = survivalSchedule(this.state).cycleIndex;
    const wave = timer.threat === 'raid'
      ? raidWaveFor(
        this.state.seed,
        this.state.currentArea.key,
        raidNumberFor(cycleIndex),
        Math.max(0, Math.round(homesteadRating(this.state.buildings).total * 10)),
        balance,
      )
      : [];
    // Bounties are the reason to open the door, so they are quoted up front
    // rather than discovered after the first kill. Levelled at the base's own
    // ground, the way the wave that arrives will be — quoting base-rank coins
    // for a far-flung outpost would undersell the night it is about to have.
    const level = spawnLevel(
      this.state.currentArea.key,
      Math.round(this.state.player.x),
      Math.round(this.state.player.y),
      balance.world,
    );
    const bounty = wave.reduce(
      (sum, kindId) => sum + raiderBounty(leveledRaiderDefinition(this.state, { kindId, level })),
      0,
    );

    const storm = balance.storm;
    const stormOre = stormStrikeSchedule(storm, balance.raid.dangerPhaseSecondsByThreat.storm)
      .reduce((sum, slot) => sum + slot.rewardIronOre, 0);
    // Walls are the storm's only defence, and saying so is the point: a player
    // who reads "turrets" here will load one and then stand still and die.
    const headline = timer.openingPhase === 'waiting' ? 'First fog waits for a working shelter. Open the Shelter guide.' : timer.threat === 'storm'
      ? timer.phase === 'danger'
        ? `Arcane storm · ${timer.label} remaining · get inside walls or keep moving, turrets and purifiers do nothing`
        : `Arcane storm in ${timer.label} · close a room to wait it out · up to ${stormOre} iron ore for dodging close outside`
      : timer.threat === 'fog'
        ? timer.phase === 'danger'
          ? `Poison fog · ${timer.label} remaining · stay in a purified room`
          : `Poison fog in ${timer.label} · check the Air Purifier, not the turrets`
        : timer.phase === 'danger'
          ? `Night raid · ${timer.label} remaining · ${bounty} coins still out there`
          : `Night raid in ${timer.label} · expect ${wave.length} raiders worth ${bounty} coins`;

    this.facilityDefenceStatus.replaceChildren(
      defenceLine(headline),
      defenceLine(`Turrets: ${armed}/${placed} loaded`),
      defenceLine(damaged > 0
        ? `${damaged} damaged structure${damaged === 1 ? '' : 's'} · repair before the raid, because anything destroyed is gone for good`
        : 'Nothing damaged.'),
    );
  }

  private refreshFurnaceControls(
    furnace: BuildingState | undefined | null,
    status: HTMLElement,
    smeltButton: HTMLButtonElement,
    collectButton: HTMLButtonElement,
  ): void {
    const queue = furnace?.furnace?.queue ?? [];
    const completed = queue.reduce((sum, item) => sum + item.completedOutput, 0);
    const active = queue.find((item) => item.completedOutput === 0);
    status.textContent = !furnace
      ? 'Place an unlocked Furnace inside a valid indoor room.'
      : active?.blocked
        ? `Output full · ${completed} ready · collect to resume`
        : active
          ? `${completed} ready · ${active.remainingWorkMs} ms remaining · queue ${queue.length}/4`
          : completed > 0 ? `${completed} iron ingot ready` : 'Queue empty';
    // Priced like a recipe card: the inputs were invisible before, so a full
    // bag of nothing looked like a furnace that simply refused to work.
    smeltButton.textContent = `Smelt iron ingot (${this.costLabel(IRON_SMELT_INPUTS)})`;
    smeltButton.disabled = !furnace || queue.length >= 4 || !this.canAfford(IRON_SMELT_INPUTS);
    collectButton.disabled = !furnace || completed <= 0;
  }

  private refreshAction(
    targetNode: ResourceNodeState | null,
    targetDrop: GroundDropState | null,
    targetCreature: WildCreatureState | null,
    lockedTarget: ResolvedCombatTarget | null = null,
  ): void {
    // The placement bar owns the bottom-center while a ghost is out; a target
    // prompt underneath it would just be two things fighting for one strip.
    if (this.buildMode) {
      this.clearResourceTargetData();
      this.target.style.display = 'none';
      return;
    }
    this.actionButton.disabled = false;
    this.actionButton.style.opacity = '1';

    // A raider in range takes over the action button, matching the same
    // priority the scene's context action uses, so the label never lies.
    const raider = nearestRaiderInRange(this.state);
    // A lock names its subject outright — "Chop Tree", "Strike Scavenger" —
    // which is the whole reason one button can serve every target type.
    // A bow in hand makes Shoot the default, not just the raid-time exception.
    // The bow's damage table has a raider row and nothing else, so labelling the
    // button "Gather" while a bow is equipped promised a swing that could never
    // harvest anything — the tool the player chose decides what the button does.
    const fallback = raider || equippedBow(this.state) ? 'Shoot' : 'Gather';
    const actionLabel = combatActionLabel(lockedTarget, fallback, loadoutStrikeStyle(this.state, lockedTarget));
    if (this.actionButton.textContent !== actionLabel) {
      this.actionButton.textContent = actionLabel;
      this.actionButton.setAttribute('aria-label', actionLabel);
    }
    this.actionButton.dataset.combatTarget = lockedTarget ? `${lockedTarget.kind}:${lockedTarget.id}` : '';
    this.actionButton.dataset.combatTargetInRange = lockedTarget ? String(lockedTarget.inRange) : '';
    if (raider) {
      this.clearResourceTargetData();
      const name = raiderDefinition(raider.kindId).displayName;
      this.target.textContent = this.state.inventory.arrow > 0
        ? `${name} ${raider.hp}/${raider.maxHp} · ${this.state.inventory.arrow} arrows left`
        : `${name} closing in · out of arrows`;
      this.target.style.display = 'block';
      return;
    }
    if (this.contextActionOverride) {
      const { label, hint } = this.contextActionOverride;
      this.actionButton.textContent = label;
      this.actionButton.setAttribute('aria-label', label);
      this.actionButton.dataset.combatTarget = '';
      this.actionButton.dataset.combatTargetInRange = '';
      this.clearResourceTargetData();
      this.target.textContent = hint || `${label} · E / Space`;
      this.target.style.display = 'block';
      return;
    }

    // The cache you dropped when you died, once you are standing on it. Read
    // from state rather than passed in: it is a single durable thing, not one
    // of the many world entities the scene sweeps for each frame.
    const cache = deathCacheInReach(this.state) ? deathCacheView(this.state) : null;

    // Resource health already appears above a damaged world object, so nearby
    // resources do not add a second text prompt beneath the quick-select bar.
    if (targetNode) {
      this.target.textContent = '';
      this.target.style.display = 'none';
      this.target.dataset.resourceTargetId = targetNode.id;
      this.target.dataset.resourceTargetKind = targetNode.kind;
      this.target.dataset.resourceTargetHp = String(targetNode.hp);
      this.target.dataset.resourceTargetMaxHp = String(targetNode.maxHp);
    } else if (cache) {
      // Above the loose-drop prompt because the collect command answers the
      // cache first: the label has to name what the button will actually take.
      this.clearResourceTargetData();
      this.target.textContent = `Your cache · ${cache.itemCount} item${cache.itemCount === 1 ? '' : 's'} · ${cache.label} left · E / Space`;
      this.target.style.display = 'block';
    } else if (targetDrop) {
      this.clearResourceTargetData();
      this.target.textContent = `${targetDrop.resource} ×${targetDrop.amount} on the ground · E / Space`;
      this.target.style.display = 'block';
    } else if (targetCreature) {
      this.clearResourceTargetData();
      // A tap attacks now, so the prompt names both halves of the choice: the
      // snare is the only thing that takes a creature alive.
      this.target.textContent = `Wild ${creatureDefinition(targetCreature.speciesId).displayName} · tap to attack · snare to tame`;
      this.target.style.display = 'block';
    } else if (rowboatActionLabel(this.state)) {
      this.clearResourceTargetData();
      this.target.textContent = rowboatActionLabel(this.state)!;
      this.target.style.display = 'block';
    } else {
      this.clearResourceTargetData();
      this.target.style.display = 'none';
    }
  }

  private clearResourceTargetData(): void {
    delete this.target.dataset.resourceTargetId;
    delete this.target.dataset.resourceTargetKind;
    delete this.target.dataset.resourceTargetHp;
    delete this.target.dataset.resourceTargetMaxHp;
  }

  /** Per-tool durability rows with explicit Repair/Equip (never implicit). */
  private refreshTools(): void {
    this.toolsList.textContent = '';
    if (this.state.tools.length === 0) {
      const empty = div({
        marginTop: '10px', padding: '12px', borderRadius: '9px',
        background: 'rgba(255,255,255,0.045)', opacity: '0.68', fontSize: '12px',
      });
      empty.textContent = 'Craft a tool and it will appear here for equipping. Repair it from its card in the Bag.';
      this.toolsList.appendChild(empty);
    }
    for (const tool of this.state.tools) {
      const row = div({
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '10px', padding: '10px 12px',
        border: '1px solid rgba(255,255,255,0.16)', borderRadius: '9px',
        background: 'rgba(30,48,37,0.94)',
      });
      const label = div({ flex: '1', fontSize: '13px', lineHeight: '1.3' });
      const equipped = tool.instanceId === this.state.equippedToolId;
      const definition = toolDefinition(tool.definitionId);
      label.textContent = `${definition.displayName} ${tool.durability}/${tool.maxDurability} · ${effectiveToolDamage(this.state, tool)} power · ${effectiveToolActionTicks(this.state, tool)} ticks/action · ${useCostLabel(definition.useCost)}${equipped ? ' · equipped' : ''}`;
      const equip = uiButton('Equip', () => this.actions.onEquipTool(tool.instanceId));
      equip.style.minHeight = '44px';
      equip.disabled = equipped || tool.durability <= 0;
      // Repair moved to the tool's card in the Bag, where the tool itself is:
      // this list is now only the loadout question, "which one am I holding?"
      row.append(label, equip);
      this.toolsList.appendChild(row);
    }
  }

  toggleCraft(): void {
    const opening = this.craftPanel.style.display === 'none';
    this.craftPanel.style.display = opening ? 'block' : 'none';
    this.craftButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) this.actions.onCraftOpened();
  }

  closeCraft(): void {
    this.craftPanel.style.display = 'none';
    this.craftButton.setAttribute('aria-expanded', 'false');
  }

  /** Open the Character tab, falling back to the standalone panel pre-menu. */
  private openCharacterMenu(): void {
    if (this.menu) {
      this.menu.openTab('character');
      return;
    }
    if (this.statsPanel.style.display === 'none') this.toggleStats();
  }

  /**
   * Where a blueprint unlock banner may start, in root-relative pixels: clear
   * of the status readouts and of any quest reward still waiting to be tapped.
   * The banner is 320px wide on a phone, so it cannot dodge the stack sideways.
   */
  private blueprintBannerTop(): number {
    const rootTop = this.root.getBoundingClientRect().top;
    const stackBottom = this.statusStack.style.display === 'none'
      ? 0
      : this.statusStack.getBoundingClientRect().bottom;
    const below = Math.max(stackBottom, this.questCelebration.cardBottom) - rootTop;
    // The 108px floor is where the quest banner sits; jsdom and a first frame
    // that has not laid out yet both measure zero, and neither should pin the
    // banner to the top of the screen.
    return Math.max(108, below + 10);
  }

  /**
   * The flashing "Claim Blueprint" strip. It says only that, whatever is
   * waiting: naming the blueprint here would spoil the reveal the Blueprints
   * tab is holding back, and the count belongs to the banner on that tab.
   */
  private refreshBlueprintClaim(): void {
    const pending = this.state.pendingBlueprintGrantIds.length;
    const ready = hasPendingBlueprintGrants(this.state);
    this.blueprintClaim.style.display = ready ? 'flex' : 'none';
    this.blueprintClaim.classList.toggle('elaris-quest-ready', ready);
    this.blueprintClaim.dataset.pendingBlueprints = String(pending);
    if (!ready) {
      // A hidden control that still answers to its old name is an action a
      // screen reader would offer and nothing does.
      this.blueprintClaim.removeAttribute('aria-label');
      this.blueprintClaim.title = '';
      return;
    }
    const label = `Claim Blueprint · ${pending} earned blueprint${pending === 1 ? '' : 's'} waiting · opens Blueprints`;
    this.blueprintClaim.setAttribute('aria-label', label);
    this.blueprintClaim.title = label;
  }

  /**
   * Open the Blueprints tab — where every unlock, earned or found, is collected
   * and read. Both the claim strip and the unlock banner point here.
   */
  private openBlueprintsMenu(): void {
    this.menu?.openTab('blueprints');
  }

  private toggleStats(): void {
    const opening = this.statsPanel.style.display === 'none';
    this.statsPanel.style.display = opening ? 'block' : 'none';
    this.statsButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) this.refreshStats();
  }

  private refreshStats(): void {
    const player = this.state.player;
    this.reconcilePendingAttributes();
    const pendingTotal = this.pendingAttributeTotal();
    const remaining = player.attributePoints - pendingTotal;
    this.statsSummary.textContent = `Level ${player.level} · XP ${player.xp}/${xpToNextLevel(player.level)} · ${player.attributePoints} attribute point${player.attributePoints === 1 ? '' : 's'} available`;
    this.attributeAllocationSummary.textContent = pendingTotal > 0
      ? `${pendingTotal} selected · ${remaining} remaining until Apply`
      : `${remaining} point${remaining === 1 ? '' : 's'} ready to allocate`;
    this.attributeApplyButton.disabled = pendingTotal === 0;
    this.attributeApplyButton.textContent = pendingTotal > 0 ? `Apply ${pendingTotal} point${pendingTotal === 1 ? '' : 's'}` : 'Apply';

    for (const attribute of ATTRIBUTE_IDS) {
      const controls = this.attributeRows.get(attribute)!;
      const pending = this.pendingAttributes[attribute];
      const currentLevel = player.attributes[attribute];
      controls.level.textContent = pending > 0 ? `Attribute ${currentLevel} → ${currentLevel + pending}` : `Attribute ${currentLevel}`;
      controls.details.textContent = `${ATTRIBUTE_DESCRIPTIONS[attribute]} ${attributePointDetail(this.state.gameBalance, attribute)}`;
      const currentLines = this.attributeStatLines(this.state, attribute);
      const projectedLines = pending > 0
        ? this.attributeStatLines(this.projectedAttributeState(attribute, pending), attribute)
        : currentLines;
      controls.stats.textContent = currentLines.map(([label, current], index) => {
        const projected = projectedLines[index]![1];
        return pending > 0 ? `${label} ${current} → ${projected}` : `${label} ${current}`;
      }).join(' · ');
      controls.decrease.disabled = pending <= 0;
      controls.increase.disabled = remaining <= 0
        || !canIncreaseAttribute(this.projectedAttributeState(attribute, pending), attribute);
      controls.increase.title = remaining <= 0 ? 'No unallocated attribute points remaining' : '';
      controls.stats.parentElement?.parentElement?.parentElement?.setAttribute(
        'aria-label',
        `${ATTRIBUTE_LABELS[attribute]}, attribute ${currentLevel}${pending > 0 ? `, ${pending} pending` : ''}. ${controls.stats.textContent}`,
      );
    }
  }

  private pendingAttributeTotal(): number {
    return ATTRIBUTE_IDS.reduce((total, attribute) => total + this.pendingAttributes[attribute], 0);
  }

  private reconcilePendingAttributes(): void {
    let excess = this.pendingAttributeTotal() - this.state.player.attributePoints;
    if (excess <= 0) return;
    for (const attribute of [...ATTRIBUTE_IDS].reverse()) {
      const removed = Math.min(excess, this.pendingAttributes[attribute]);
      this.pendingAttributes[attribute] -= removed;
      excess -= removed;
      if (excess === 0) return;
    }
  }

  private adjustPendingAttribute(attribute: AttributeId, amount: -1 | 1): void {
    if (amount < 0) {
      if (this.pendingAttributes[attribute] <= 0) return;
      this.pendingAttributes[attribute] -= 1;
    } else {
      if (this.pendingAttributeTotal() >= this.state.player.attributePoints) return;
      if (!canIncreaseAttribute(this.projectedAttributeState(attribute, this.pendingAttributes[attribute]), attribute)) return;
      this.pendingAttributes[attribute] += 1;
    }
    this.refreshStats();
  }

  private applyPendingAttributes(): void {
    if (this.pendingAttributeTotal() <= 0) return;
    const allocation: Partial<Record<AttributeId, number>> = {};
    for (const attribute of ATTRIBUTE_IDS) {
      const amount = this.pendingAttributes[attribute];
      if (amount > 0) allocation[attribute] = amount;
      this.pendingAttributes[attribute] = 0;
    }
    if (this.actions.onApplyAttributes) this.actions.onApplyAttributes(allocation);
    else {
      for (const attribute of ATTRIBUTE_IDS) {
        for (let count = 0; count < (allocation[attribute] ?? 0); count += 1) {
          this.actions.onSpendAttribute(attribute);
        }
      }
    }
    this.refreshStats();
  }

  private toggleAttributeDetails(attribute: AttributeId): void {
    const controls = this.attributeRows.get(attribute)!;
    const opening = controls.details.style.display === 'none';
    controls.details.style.display = opening ? 'block' : 'none';
    controls.info.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }

  /**
   * What the sheet would read after `amount` points. The maximums come from the
   * published `attributeGains`, never a constant: a hard-coded 10 promised a
   * bonus the simulation had been retuned away from, so the preview and the
   * point actually spent have to read the same knob.
   */
  private projectedAttributeState(attribute: AttributeId, amount: number): GameState {
    const player = this.state.player;
    const gains = this.state.gameBalance.attributeGains;
    return {
      ...this.state,
      player: {
        ...player,
        attributes: { ...player.attributes, [attribute]: player.attributes[attribute] + amount },
        maxHp: player.maxHp + (attribute === 'health' ? amount * gains.healthMaxHp : 0),
        maxStamina: player.maxStamina + (attribute === 'stamina' ? amount * gains.staminaMaxStamina : 0),
        maxMana: player.maxMana + (attribute === 'mana' ? amount * gains.manaMaxMana : 0),
      },
    };
  }

  private attributeStatLines(state: GameState, attribute: AttributeId): readonly [label: string, value: string][] {
    switch (attribute) {
      // Damage is what the weapon deals plus what the attribute adds, so the
      // sheet shows the part the attribute owns. A total would be a lie the
      // moment the player swapped what was in hand.
      case 'strength': return [['Melee Damage', `+${meleeDamageBonus(state)}`]];
      case 'dexterity': return [['Ranged Damage', `+${rangedDamageBonus(state)}`]];
      case 'magic': return [['Magic Damage', `+${magicDamageBonus(state)}`]];
      case 'luck': return [
        ['Hit', this.formatBasisPoints(hitChanceBonusBps(state))],
        ['Dodge', this.formatBasisPoints(dodgeChanceBps(state))],
        ['Taming', this.formatBasisPoints(tamingChanceBonusBps(state))],
        ['Double Drop', this.formatBasisPoints(doubleDropChanceBps(state))],
      ];
      case 'speed': return [
        ['Walk Speed', `${movementSpeed(state)} px/s`],
        ['Sprint Speed', `${movementSpeed(state, true)} px/s · ${sprintStaminaPerSecond(state)} SP/s`],
      ];
      case 'health': return [['Health', String(state.player.maxHp)]];
      case 'healthRegen': return [['Health Regen', `${healthRegeneration(state)} HP/s`]];
      case 'stamina': return [['Stamina', String(state.player.maxStamina)]];
      case 'staminaRegen': return [['Stamina Regen', `${staminaRegeneration(state)} SP/s`]];
      case 'carryWeight': return [['Carry Weight', formatWeight(effectiveBagCapacityHundredths(state))]];
      case 'mana': return [['Mana', String(state.player.maxMana)]];
      case 'manaRegen': return [['Mana Regen', `${manaRegeneration(state)} MP/s`]];
    }
  }

  private formatBasisPoints(basisPoints: number): string {
    return `+${basisPoints / 100}%`;
  }

  private toggleCreatures(): void {
    const opening = this.creaturePanel.style.display === 'none';
    this.creaturePanel.style.display = opening ? 'block' : 'none';
    this.creatureButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) this.refreshCreatures();
  }

  private assignSelectedCreature(role: CreatureRole): void {
    const creature = this.state.ownedCreatures.find((candidate) => candidate.id === this.selectedCreatureId);
    if (creature) this.actions.onSetCreatureRole(creature.id, role);
  }

  private refreshCreatures(): void {
    const owned = this.state.ownedCreatures;
    if (!owned.some((creature) => creature.id === this.selectedCreatureId)) {
      this.selectedCreatureId = owned[0]?.id ?? null;
    }
    const creature = owned.find((candidate) => candidate.id === this.selectedCreatureId);
    this.creatureButton.style.display = creature ? 'flex' : 'none';
    if (!creature) {
      this.creatureRoster.replaceChildren();
      this.creatureStatus.textContent = 'No creatures tamed yet. Encounter a wild creature to add it to your roster.';
      for (const button of this.assignmentButtons.values()) button.disabled = true;
      this.battleCompanionButton.disabled = true;
      this.releaseCreatureButton.disabled = true;
      this.creatureAbilities.replaceChildren();
      for (const button of this.withdrawButtons.values()) button.disabled = true;
      return;
    }
    this.creatureRoster.replaceChildren();
    for (const rosterCreature of owned) {
      const rosterDefinition = creatureDefinition(rosterCreature.speciesId);
      const selected = rosterCreature.id === creature.id;
      const button = uiButton(`${rosterCreature.name} · ${rosterDefinition.displayName} · ${rosterCreature.role}`, () => {
        this.selectedCreatureId = rosterCreature.id;
        this.refreshCreatures();
      });
      paletteCard(button);
      button.classList.add('elaris-companion-tile');
      const identity=div({});const name=document.createElement('strong');name.textContent=rosterCreature.name;
      const species=document.createElement('small');species.textContent=rosterDefinition.displayName;
      const role=document.createElement('span');role.className='elaris-companion-role';role.textContent=rosterCreature.role==='follow'?'Following':rosterCreature.role==='work'?'At work':'Resting';
      identity.append(name,species,role);button.replaceChildren(characterPortrait(rosterCreature.speciesId),identity);
      button.style.borderColor = selected ? '#ffe08a' : 'rgba(255,255,255,0.16)';
      button.style.background = selected ? 'rgba(47,107,67,0.96)' : 'rgba(30,48,37,0.94)';
      button.setAttribute('aria-label', `Select ${rosterCreature.name}, ${rosterDefinition.displayName}, currently ${rosterCreature.role}`);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      this.creatureRoster.appendChild(button);
    }
    const cache = fieldCache(this.state);
    const storage = cache?.storage ?? { wood: 0, stone: 0, fiber: 0 };
    const worksite = creature.worksiteId ? this.state.buildings.find((building) => building.id === creature.worksiteId) : null;
    const reservedHousing = creature.housingId ? this.state.buildings.find((building) => building.id === creature.housingId) : null;
    const definition = creatureDefinition(creature.speciesId);
    const followers = owned.filter((candidate) => candidate.role === 'follow').length;
    const activeAbility = creature.role === 'follow' && definition.followMode === 'mount'
      ? ` · Mounted (${definition.travelSpeedMultiplier}× speed)`
      : '';
    const bondLevel = creatureBondLevel(creature);
    const isBattleCompanion = this.state.battleCompanionId === creature.id;
    this.creatureStatus.textContent = `${definition.followRole}${activeAbility}${isBattleCompanion ? ' · Battle Companion' : ''} · Bond ${bondLevel} · Followers ${followers}/${MAX_ACTIVE_FOLLOWERS}${reservedHousing ? ` · Housing: ${buildableById(reservedHousing.definitionId).displayName}` : ' · Unhoused'}${worksite ? ` · Worksite: ${worksite.definitionId}` : ''} · Storage: ${storage.wood} wood, ${storage.stone} stone, ${storage.fiber} fiber`;
    this.battleCompanionButton.textContent = isBattleCompanion ? 'Clear Battle Companion' : 'Set as Battle Companion';
    this.battleCompanionButton.disabled = !isBattleCompanion && creature.role !== 'follow';
    this.battleCompanionButton.title = creature.role !== 'follow' ? 'Assign this creature to Follow first' : '';
    this.battleCompanionButton.setAttribute('aria-pressed', isBattleCompanion ? 'true' : 'false');
    this.releaseCreatureButton.disabled = false;
    this.releaseCreatureButton.setAttribute('aria-label', `Release ${creature.name}`);
    this.creatureAbilities.replaceChildren(...definition.encounter.battleAbilities.map((ability) => {
      const unlocked = bondLevel >= ability.unlockBondLevel;
      const selected = creature.selectedBattleAbilityId === ability.id;
      const button = uiButton('', () => this.actions.onSelectCompanionAbility(creature.id, ability.id));
      const title = div({ fontWeight: '700', fontSize: '12px' });
      title.textContent = ability.displayName;
      const detail = div({ marginTop: '3px', fontSize: '10px', opacity: '0.78', lineHeight: '1.3' });
      detail.textContent = unlocked ? `${ability.description} · CD ${ability.cooldownTurns}` : `Locked · Bond ${ability.unlockBondLevel}`;
      button.append(title, detail);
      Object.assign(button.style, { minWidth: '0', minHeight: '58px', padding: '7px', textAlign: 'left', background: selected ? '#2f6b43' : 'rgba(30,48,37,0.94)', borderColor: selected ? '#ffe08a' : 'rgba(255,255,255,0.16)' });
      button.disabled = !unlocked;
      button.setAttribute('aria-label', `${ability.displayName}. ${unlocked ? ability.description : `Requires Bond ${ability.unlockBondLevel}`}`);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      return button;
    }));
    for (const [id, button] of this.assignmentButtons) {
      this.setAssignmentButtonContent(button, id, definition);
      const currentHousingWorks = reservedHousing ? housingOperationGate(this.state, reservedHousing).ok : false;
      const canWork = definition.work !== null
        && (currentHousingWorks || availableHousing(this.state) !== null)
        && eligibleCreatureWorksites(this.state, creature.id).length > 0;
      button.disabled = id === 'work' && !canWork;
      button.title = id === 'work' && !definition.work
        ? 'Work role unlocks with a later facility'
        : id === 'work' && !canWork ? 'Build or repair housing and this species\' worksite' : '';
      button.style.borderColor = creature.role === id ? '#ffe08a' : 'rgba(255,255,255,0.16)';
      button.style.background = creature.role === id ? '#2f6b43' : 'rgba(30,48,37,0.94)';
    }
    for (const [resource, button] of this.withdrawButtons) {
      const amount = storage[resource];
      button.textContent = `Take ${resource} (${amount})`;
      button.disabled = !cache || amount === 0;
    }
  }

  private setAssignmentButtonContent(
    button: HTMLButtonElement,
    role: CreatureRole,
    definition?: ReturnType<typeof creatureDefinition>,
  ): void {
    const label = role === 'follow' && definition?.followMode === 'mount'
      ? 'Mount'
      : role[0]!.toUpperCase() + role.slice(1);
    const lines = assignmentDescriptionLines(role, definition);
    const title = div({ fontWeight: '700', fontSize: '13px' });
    title.textContent = label;
    const detail = div({ marginTop: '3px', fontWeight: '400', fontSize: '11px', opacity: '0.82' });
    detail.textContent = lines[0]!;
    // The second line is the numbers — rate, reach, slot cost. Kept visually
    // quieter than the sentence above it so the button still reads at a glance,
    // but present, because "Repairs walls" never told a player whether it was
    // worth a housing slot.
    const mechanics = div({ marginTop: '2px', fontWeight: '400', fontSize: '10px', opacity: '0.62', lineHeight: '1.35' });
    mechanics.textContent = lines.slice(1).join(' ');
    button.replaceChildren(title, detail, ...(mechanics.textContent ? [mechanics] : []));
    button.setAttribute('aria-label', `${role[0]!.toUpperCase() + role.slice(1)} selected creature. ${lines.join(' ')}`);
  }

  showGatherAssistance(message: string, unlocked: boolean): void {
    if (this.gatherFeedbackTimer) clearTimeout(this.gatherFeedbackTimer);
    this.gatherFeedback.textContent = message;
    this.gatherFeedback.style.display = 'block';
    this.gatherFeedbackTimer = setTimeout(() => {
      this.gatherFeedback.style.display = 'none';
      this.gatherFeedbackTimer = null;
    }, unlocked ? 5000 : 2200);
  }

  showFeedback(message: string, success: boolean): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedback.textContent = message;
    this.feedback.style.color = success ? '#e8f0ea' : '#ffd18a';
    this.feedback.style.opacity = '1';
    this.feedbackTimer = setTimeout(() => {
      this.feedback.style.opacity = '0';
      this.feedbackTimer = null;
    }, 1300);
  }

  /** Brief Bag totals for the resources the player just collected. */
  showResourceTotals(lines: readonly string[]): void {
    if (lines.length === 0) return;
    if (this.resourceFlashTimer) clearTimeout(this.resourceFlashTimer);
    this.resourceFlash.replaceChildren(...lines.map((line) => {
      const row = document.createElement('span');
      row.textContent = line;
      return row;
    }));
    this.resourceFlash.style.display = 'flex';
    this.resourceFlash.style.opacity = '1';
    this.resourceFlash.style.transform = 'translateY(0)';
    this.resourceFlashTimer = setTimeout(() => {
      this.resourceFlash.style.opacity = '0';
      this.resourceFlash.style.transform = 'translateY(-5px)';
      this.resourceFlashTimer = setTimeout(() => {
        this.resourceFlash.style.display = 'none';
        this.resourceFlashTimer = null;
      }, 170);
    }, 950);
  }

  /** "12/1 wood + 0/1 stone" for the current bag; see ui/costs.ts. */
  private costLabel(cost: ResourceAmounts): string {
    return stockedCostText(this.state, cost);
  }

  private canAfford(cost: ResourceAmounts): boolean {
    return canAffordCost(this.state, cost);
  }

  private cardTitle(nameText: string, metaText: string): HTMLDivElement {
    const title = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' });
    const name = document.createElement('strong');
    name.textContent = nameText;
    const meta = document.createElement('span');
    meta.textContent = metaText;
    Object.assign(meta.style, { opacity: '0.82', fontSize: '12px', fontWeight: '400', textAlign: 'right' });
    title.append(name, meta);
    return title;
  }

  private cardDetail(text: string): HTMLDivElement {
    const detail = div({ marginTop: '3px', opacity: '0.72', fontSize: '12px', fontWeight: '400' });
    detail.textContent = text;
    return detail;
  }

  destroy(): void {
    this.actionHeld = false;
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    if (this.gatherFeedbackTimer) clearTimeout(this.gatherFeedbackTimer);
    if (this.resourceFlashTimer) clearTimeout(this.resourceFlashTimer);
    this.progressionGuide.destroy();
    this.questCelebration.destroy();
    this.blueprintCelebration.destroy();
    this.root.remove();
  }
}

/** One line of War Table intel; kept plain so the panel stays scannable. */
function defenceLine(text: string): HTMLDivElement {
  const line = div({ marginTop: '4px' });
  line.textContent = text;
  return line;
}
