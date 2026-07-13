import Phaser from 'phaser';
import { creatureTextureKey, generateWorldTextures, npcTextureKey, TextureKeys } from '../art/proceduralTextures';
import { INTERACTION_RANGE_PX, RESOURCE_BALANCE } from '../config/balance';
import { DEFAULT_WORLD_SEED, FIXED_STEP_MS, WORLD_PX } from '../config/platform';
import { computeLayout } from '../platform/responsiveLayout';
import type { MoveIntent } from '../simulation/commands';
import { NO_MOVE, stepMovement } from '../simulation/commands';
import { FixedStepLoop } from '../simulation/fixedStep';
import {
  collectNearestGroundDrop,
  setCreatureRole,
  craftTool,
  equipTool,
  gatherNearest,
  nearestLiveNode,
  nearestWildCreature,
  repairTool,
  withdrawFromFieldCache,
  type CommandResult,
} from '../simulation/gameplayCommands';
import { craftArrows, craftTamingSnare, resolveEncounterAction, startNearestEncounter, type EncounterAction } from '../simulation/encounters';
import { describeGardenBed, harvestGardenBed, nearestGardenBed } from '../simulation/gardenBeds';
import { describeWoodlotPlanter, harvestWoodlotPlanter, nearestWoodlotPlanter } from '../simulation/woodlotPlanters';
import type { GameState, GroundDropState, ResourceNodeState, WildCreatureState } from '../simulation/state';
import { createInitialState } from '../simulation/state';
import { reconcileQuestProgress } from '../simulation/progression';
import { spendAttributePoint } from '../simulation/characterProgression';
import { BuildModeController } from './buildMode';
import type { PlaceResult } from './buildPlacement';
import { BuildMenu } from '../ui/buildMenu';
import { GameplayHud } from '../ui/gameplayHud';
import { Hotbar, HOTBAR_SLOTS } from '../ui/hotbar';
import { InventoryPanel } from '../ui/inventoryPanel';
import { TouchJoystick } from '../ui/touchControls';
import { WorldNavigator } from '../ui/worldNavigator';
import { EncounterPanel } from '../ui/encounterPanel';
import { coordinateHash, starterBiomeAt } from '../simulation/biomes';
import { TILE_SIZE } from '../config/platform';
import { creatureDefinition } from '../content/creatures';
import { NPC_DEFINITIONS } from '../content/npcs';
import { nearestNpc } from '../simulation/npcs';
import { NpcPanel } from '../ui/npcPanel';

export interface WorldSceneData {
  state?: GameState;
  /** Ordinary mutations debounce; critical mutations save immediately. */
  onStateChanged?: (kind: 'ordinary' | 'critical') => void;
}

interface MovementKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  slow: Phaser.Input.Keyboard.Key;
}

const HIGHLIGHT_TINT = 0xffe08a;
const OVERLAY_DEPTH = 999_000;

export class WorldScene extends Phaser.Scene {
  state!: GameState;
  private onMoved: () => void = () => {};
  private onCriticalChanged: () => void = () => {};
  private loop!: FixedStepLoop;
  private player!: Phaser.GameObjects.Image;
  private mount: Phaser.GameObjects.Image | null = null;
  private joystick!: TouchJoystick;
  private keys: MovementKeys | null = null;
  private altKeys: MovementKeys | null = null;
  private intent: MoveIntent = NO_MOVE;
  private actionKey: Phaser.Input.Keyboard.Key | null = null;
  private altActionKey: Phaser.Input.Keyboard.Key | null = null;
  private craftKey: Phaser.Input.Keyboard.Key | null = null;
  private buildKey: Phaser.Input.Keyboard.Key | null = null;
  private inventoryKey: Phaser.Input.Keyboard.Key | null = null;
  private hotbarKeys: Phaser.Input.Keyboard.Key[] = [];
  private readonly hotbarShortcutHandlers = Array.from({ length: HOTBAR_SLOTS }, (_, slot) =>
    () => this.hotbar.select(slot),
  );
  private cancelKey: Phaser.Input.Keyboard.Key | null = null;
  private hud!: GameplayHud;
  private buildMenu!: BuildMenu;
  private buildMode!: BuildModeController;
  private hotbar!: Hotbar;
  private inventoryPanel!: InventoryPanel;
  private navigator!: WorldNavigator;
  private encounterPanel!: EncounterPanel;
  private npcPanel!: NpcPanel;
  private readonly resourceSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly dropSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly creatureSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly npcSprites = new Map<string, Phaser.GameObjects.Image>();
  private hpBar!: Phaser.GameObjects.Graphics;
  private highlightedId: string | null = null;
  private lastTargetKey: string | null = null;

  constructor() {
    super('world');
  }

  init(data: WorldSceneData): void {
    this.state = data.state ?? createInitialState(DEFAULT_WORLD_SEED);
    if (data.onStateChanged) {
      this.onMoved = () => data.onStateChanged?.('ordinary');
      this.onCriticalChanged = () => data.onStateChanged?.('critical');
    }
  }

  create(): void {
    generateWorldTextures(this);
    this.buildGround();
    this.buildResourceNodes();
    this.buildNpcs();
    this.syncWildCreatures();
    this.syncGroundDrops();
    this.hpBar = this.add.graphics().setDepth(OVERLAY_DEPTH);

    this.player = this.add
      .image(this.state.player.x, this.state.player.y, TextureKeys.Player)
      .setOrigin(0.5, 0.9);
    this.syncMountAppearance();

    this.setupCamera();
    this.setupInput();
    const parent = document.getElementById('app') ?? document.body;
    this.hud = new GameplayHud(parent, this.state, {
      onAction: () => this.performContextAction(),
      onCraftTool: (definitionId) => this.performCraft(definitionId),
      onCraftSnare: () => this.performToolCommand(() => craftTamingSnare(this.state), true),
      onCraftArrows: () => this.performToolCommand(() => craftArrows(this.state), true),
      onRepairTool: (toolId) => this.performToolCommand(() => repairTool(this.state, toolId), true),
      onEquipTool: (toolId) => this.performToolCommand(() => equipTool(this.state, toolId), false),
      onTameCreature: () => this.performEncounterStart(),
      onSetCreatureRole: (creatureId, role) => this.performCreatureRole(creatureId, role),
      onWithdrawFromCache: (resource) => this.performToolCommand(() => withdrawFromFieldCache(this.state, resource), true),
      onSpendAttribute: (attribute) => {
        const ok = spendAttributePoint(this.state, attribute);
        this.hud.showFeedback(ok ? `${attribute[0]!.toUpperCase()}${attribute.slice(1)} increased` : 'No attribute points available', ok);
        if (ok) this.onCriticalChanged();
        this.refreshHudNow();
      },
      onCraftOpened: () => {
        this.inventoryPanel.toggleTab('craft');
      },
    });
    this.buildMode = new BuildModeController(this, this.state, {
      onValidity: (check) => this.buildMenu.setValidity(check),
      onPlaced: (result) => this.onPlacementAttempt(result),
    });
    this.buildMenu = new BuildMenu(parent, this.state, {
      onStartPlacing: (id) => {
        this.inventoryPanel.close();
        this.buildMode.startPlacing(id);
      },
      onConfirm: () => this.buildMode.confirm(),
      onPlacingCancelled: () => this.buildMode.cancel(),
      onOpened: () => {
        this.inventoryPanel.toggleTab('build');
      },
    });
    this.hotbar = new Hotbar(parent, this.state, {
      onEquipTool: (toolId) => this.performToolCommand(() => equipTool(this.state, toolId), false),
    });
    this.inventoryPanel = new InventoryPanel(parent, this.state, {
      onEquipTool: (toolId) => this.performToolCommand(() => equipTool(this.state, toolId), false),
      onOpened: () => {
        this.buildMenu.close();
      },
    });
    this.hud.attachToMenu(this.inventoryPanel);
    this.buildMenu.attachToMenu(this.inventoryPanel);
    this.navigator = new WorldNavigator(parent, this.state);
    this.encounterPanel = new EncounterPanel(parent, this.state, (action) => this.performEncounterAction(action));
    this.encounterPanel.refresh();
    this.npcPanel = new NpcPanel(parent);

    this.loop = new FixedStepLoop(FIXED_STEP_MS, (stepMs) => {
      if (stepMovement(this.state, this.intent, stepMs)) {
        this.syncResourceTextures();
        this.buildMode.syncPlaced(); // a finished Garden Bed batch swaps its texture
        this.onCriticalChanged();
        this.refreshHudNow();
      }
    });

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
  }

  override update(_time: number, deltaMs: number): void {
    this.intent = this.state.activeEncounter || this.npcPanel.isOpen ? NO_MOVE : this.gatherInput();
    this.loop.advance(deltaMs);
    if (this.intent.x !== 0 || this.intent.y !== 0) this.onMoved();

    if (
      !this.state.activeEncounter && (
        (this.actionKey && Phaser.Input.Keyboard.JustDown(this.actionKey)) ||
        (this.altActionKey && Phaser.Input.Keyboard.JustDown(this.altActionKey))
      )
    ) {
      if (this.buildMode.placing) this.buildMode.confirm();
      else this.performContextAction();
    }
    // Walking changes range/overlap validity while a ghost is out.
    if (this.buildMode.placing) this.buildMode.refreshValidity();
    // The placement action bar owns the bottom-center while a ghost is out.
    this.hotbar.setSuppressed(this.buildMode.placing);

    const { x, y } = this.state.player;
    const mounted = this.mount !== null;
    this.mount?.setPosition(Math.round(x), Math.round(y)).setDepth(y);
    this.player.setPosition(Math.round(x), Math.round(y - (mounted ? 4 : 0)));
    this.player.setDepth(y + (mounted ? 0.1 : 0));
    this.navigator.refresh();
    if (this.state.tick % 30 === 0) this.refreshHudNow();
    this.updateTargetIndicators();
  }

  private buildGround(): void {
    this.add
      .tileSprite(0, 0, WORLD_PX, WORLD_PX, TextureKeys.Ground)
      .setOrigin(0, 0)
      .setDepth(-WORLD_PX);
    const biomeLayer = this.add.graphics().setDepth(-WORLD_PX + 1);
    const chunkTiles = 4;
    const chunkPx = TILE_SIZE * chunkTiles;
    for (let y = 0; y < WORLD_PX; y += chunkPx) {
      for (let x = 0; x < WORLD_PX; x += chunkPx) {
        if (starterBiomeAt(this.state.seed, x + chunkPx / 2, y + chunkPx / 2) !== 'forest') continue;
        const shade = coordinateHash(this.state.seed ^ 0x6f6f_7265, x / chunkPx, y / chunkPx) > 0.52
          ? 0x244b32 : 0x294f35;
        biomeLayer.fillStyle(shade, 0.82).fillRect(x, y, chunkPx, chunkPx);
        biomeLayer.fillStyle(0x1d3f2a, 0.55).fillRect(x + 7, y + 11, 2, 2);
        biomeLayer.fillStyle(0x416344, 0.45).fillRect(x + chunkPx - 13, y + 23, 2, 3);
      }
    }
    this.cameras.main.setBackgroundColor('#1a2c22');
  }

  private buildResourceNodes(): void {
    this.resourceSprites.clear();
    for (const node of this.state.resourceNodes) {
      const sprite = this.add
        .image(node.x, node.y, this.nodeTexture(node))
        .setOrigin(0.5, 0.9)
        .setDepth(node.y);
      this.resourceSprites.set(node.id, sprite);
    }
  }

  private buildNpcs(): void {
    this.npcSprites.clear();
    for (const npc of NPC_DEFINITIONS) {
      const sprite = this.add.image(npc.x, npc.y, npcTextureKey(npc.id)).setOrigin(0.5, 0.95).setDepth(npc.y);
      const label = this.add.text(npc.x, npc.y - 25, npc.name, {
        fontFamily: 'system-ui, sans-serif', fontSize: '9px', color: '#fff3c4',
        stroke: '#09140e', strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(OVERLAY_DEPTH);
      label.setData('npc-label', true);
      this.npcSprites.set(npc.id, sprite);
    }
  }

  /** Worker automation changes node HP off-screen, so reconcile their art too. */
  private syncResourceTextures(): void {
    for (const node of this.state.resourceNodes) {
      const sprite = this.resourceSprites.get(node.id);
      if (sprite && sprite.texture.key !== this.nodeTexture(node)) sprite.setTexture(this.nodeTexture(node));
    }
  }

  /** Depleted nodes stay visible as remains — they still occupy their tile. */
  private nodeTexture(node: ResourceNodeState): string {
    if (node.kind === 'tree') return node.hp > 0 ? TextureKeys.Tree : TextureKeys.Stump;
    if (node.kind === 'stone') return node.hp > 0 ? TextureKeys.Rock : TextureKeys.Rubble;
    return node.hp > 0 ? TextureKeys.Plant : TextureKeys.PlantRemains;
  }

  private syncGroundDrops(): void {
    for (const [id, sprite] of this.dropSprites) {
      if (!this.state.groundDrops.some((drop) => drop.id === id)) {
        sprite.destroy();
        this.dropSprites.delete(id);
      }
    }
    for (const drop of this.state.groundDrops) {
      if (this.dropSprites.has(drop.id)) continue;
      const key = drop.resource === 'wood'
        ? TextureKeys.DropWood
        : drop.resource === 'stone' ? TextureKeys.DropStone : TextureKeys.DropFiber;
      const sprite = this.add.image(drop.x, drop.y, key).setOrigin(0.5, 0.9).setDepth(drop.y);
      this.dropSprites.set(drop.id, sprite);
    }
  }

  private syncWildCreatures(): void {
    for (const [id, sprite] of this.creatureSprites) {
      if (!this.state.wildCreatures.some((creature) => creature.id === id)) {
        sprite.destroy();
        this.creatureSprites.delete(id);
      }
    }
    for (const creature of this.state.wildCreatures) {
      if (this.creatureSprites.has(creature.id)) continue;
      this.creatureSprites.set(creature.id, this.add.image(creature.x, creature.y, creatureTextureKey(creature.speciesId)).setOrigin(0.5, 0.9).setDepth(creature.y));
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_PX, WORLD_PX);
    cam.setRoundPixels(true);
    cam.startFollow(this.player, true, 0.15, 0.15);
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
      this.cancelKey = kb.addKey(K.ESC);

      // UI shortcuts are event-driven so a quick tap cannot begin and end
      // between two render frames. Movement and context actions stay polled.
      this.craftKey.on('down', this.onCraftShortcut);
      this.buildKey.on('down', this.onBuildShortcut);
      this.inventoryKey.on('down', this.onInventoryShortcut);
      this.cancelKey.on('down', this.onCancelShortcut);
      this.hotbarKeys.forEach((key, slot) => key.on('down', this.hotbarShortcutHandlers[slot]!));
    }

    const parent = document.getElementById('app') ?? document.body;
    // Taps inside the movement zone keep working as the context action; the
    // zone otherwise sits over the canvas and would swallow them.
    this.joystick = new TouchJoystick(parent, {
      onTap: () => {
        if (!this.buildMode.placing) this.performContextAction();
      },
    });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerAction);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
  }

  private onPointerAction = (pointer: Phaser.Input.Pointer): void => {
    if (this.buildMode.placing) {
      this.buildMode.handlePointerDown(pointer);
      return;
    }
    if (pointer.leftButtonDown()) this.performContextAction();
  };

  private onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.buildMode.handlePointerMove(pointer);
  };

  /**
   * Context action, in deterministic priority: harvest a ready Garden Bed,
   * gather the nearest live node, pick up a nearby drop, else report the
   * nearby bed's growing/blocked/suspended status.
   */
  private performContextAction(): void {
    if (this.state.activeEncounter || this.npcPanel.isOpen) return;
    const bed = nearestGardenBed(this.state);
    const bedReady = bed !== null && (bed.garden?.readyFiber ?? 0) > 0;
    const planter = nearestWoodlotPlanter(this.state);
    const planterReady = planter !== null && (planter.woodlot?.readyWood ?? 0) > 0;
    const npc = nearestNpc(this.state);
    const node = nearestLiveNode(this.state);
    let result: CommandResult;
    if (bed && bedReady) {
      result = harvestGardenBed(this.state, bed.id);
      if (result.ok) {
        this.buildMode.syncPlaced();
        this.spawnFloatingText(this.state.player.x, this.state.player.y, result.message);
        this.onCriticalChanged();
      }
    } else if (planter && planterReady) {
      result = harvestWoodlotPlanter(this.state, planter.id);
      if (result.ok) {
        this.buildMode.syncPlaced();
        this.spawnFloatingText(this.state.player.x, this.state.player.y, result.message);
        this.onCriticalChanged();
      }
    } else if (npc) {
      this.npcPanel.open(npc);
      result = { ok: true, message: `Talking with ${npc.name}`, targetId: npc.id };
    } else if (node) {
      result = gatherNearest(this.state);
    } else {
      result = collectNearestGroundDrop(this.state);
      if (!result.ok && !result.targetId) {
        result = bed
          ? { ok: false, message: describeGardenBed(this.state, bed).message, targetId: bed.id }
          : planter
            ? { ok: false, message: describeWoodlotPlanter(this.state, planter).message, targetId: planter.id }
            : { ...result, message: 'Move closer to a resource' };
      }
    }

    this.hud.showFeedback(result.message, result.ok);
    if (result.ok && !npc) {
      this.onMoved();
      if (node && !bedReady && result.targetId) {
        this.flashNodeHit(result.targetId);
        if (result.depleted) this.onNodeDepleted(result.targetId, result.message);
      }
      this.syncGroundDrops();
    }
    this.refreshHudNow();
  }

  private performEncounterStart(): void {
    const result = startNearestEncounter(this.state);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      this.onCriticalChanged();
      this.encounterPanel.refresh();
    }
    this.refreshHudNow();
  }

  private performEncounterAction(action: EncounterAction): void {
    const result = resolveEncounterAction(this.state, action);
    if (!result.ok) this.hud.showFeedback(result.message, false);
    this.syncWildCreatures();
    if (result.tamed) this.spawnFloatingText(this.state.player.x, this.state.player.y, 'New creature joined you!');
    if (result.ok) this.onCriticalChanged();
    // The battle screen animates the structured result itself and owns its
    // own end-of-battle outro, so success feedback stays inside the arena.
    this.encounterPanel.playResult(action, result);
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

  private onNodeDepleted(nodeId: string, message: string): void {
    const node = this.state.resourceNodes.find((item) => item.id === nodeId);
    if (!node) return;
    this.resourceSprites.get(nodeId)?.setTexture(this.nodeTexture(node)).clearTint().setScale(1);
    // Yield text only when it entered the inventory (sim message starts with +).
    if (message.startsWith('+')) {
      const drop = RESOURCE_BALANCE[node.kind];
      this.spawnFloatingText(node.x, node.y, `+${drop.yieldAmount} ${drop.resource}`);
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
      duration: 750,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private performCraft(definitionId: import('../simulation/state').ToolDefinitionId): void {
    const result = craftTool(this.state, definitionId);
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) this.onCriticalChanged();
    this.refreshHudNow();
  }

  private performToolCommand(command: () => CommandResult, critical: boolean): void {
    const result = command();
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      if (critical) this.onCriticalChanged();
      else this.onMoved();
    }
    this.refreshHudNow();
  }

  private onPlacementAttempt(result: PlaceResult): void {
    this.hud.showFeedback(result.message, result.ok);
    if (result.ok) {
      if (result.building?.definitionId !== 'palisade-wall') this.buildMenu.close();
      // Buildings now persist to state.buildings — save the structural change now.
      this.onCriticalChanged();
      this.refreshHudNow();
    }
  }

  /** Push current inventory/tool/target data into the DOM HUD after a command. */
  private refreshHudNow(): void {
    if (reconcileQuestProgress(this.state)) this.onCriticalChanged();
    const npc = nearestNpc(this.state);
    const target = npc ? null : nearestLiveNode(this.state);
    this.hud.refresh(target, target ? null : this.nearestDropInRange(), npc ? null : this.nearestCreatureInRange(), npc);
    this.buildMenu.refreshAffordability();
    this.hotbar.refresh();
    this.inventoryPanel.refresh();
    this.encounterPanel.refresh();
    this.lastTargetKey = null; // force indicator re-sync next frame
  }

  private nearestDropInRange(): GroundDropState | null {
    let nearest: GroundDropState | null = null;
    let nearestDistance = INTERACTION_RANGE_PX;
    for (const drop of this.state.groundDrops) {
      const distance = Math.hypot(drop.x - this.state.player.x, drop.y - this.state.player.y);
      if (distance <= nearestDistance) {
        nearest = drop;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private nearestCreatureInRange(): WildCreatureState | null {
    return nearestWildCreature(this.state);
  }

  private updateTargetIndicators(): void {
    const npc = nearestNpc(this.state);
    const target = npc ? null : nearestLiveNode(this.state);
    const drop = target ? null : this.nearestDropInRange();
    const creature = npc ? null : this.nearestCreatureInRange();
    const key = `${npc?.id ?? ''}|${target?.id ?? ''}|${target?.hp ?? ''}|${drop?.id ?? ''}|${creature?.id ?? ''}`;
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

    for (const [id, sprite] of this.npcSprites) {
      if (id === npc?.id) sprite.setTint(HIGHLIGHT_TINT).setScale(1.12);
      else sprite.clearTint().setScale(1);
    }

    this.drawTargetHpBar(target);
    this.hud.refresh(target, drop, creature, npc);
  }

  /** Compact world-space HP bar above the targeted node once it has taken damage. */
  private drawTargetHpBar(node: ResourceNodeState | null): void {
    this.hpBar.clear();
    if (!node || node.hp >= node.maxHp) return;
    const ratio = node.hp / node.maxHp;
    const color = ratio > 0.5 ? 0x4cc07f : ratio > 0.25 ? 0xc9a227 : 0xd9534f;
    this.hpBar.fillStyle(0x09140e, 0.85).fillRect(node.x - 9, node.y - 22, 18, 4);
    this.hpBar.fillStyle(color, 1).fillRect(node.x - 8, node.y - 21, Math.max(1, Math.round(16 * ratio)), 2);
  }

  private gatherInput(): MoveIntent {
    const stick = this.joystick.getVector();
    if (stick.magnitude > 0.05) {
      return { x: stick.x, y: stick.y, slow: false };
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
    return { x, y, slow };
  }

  private applyLayout = (): void => {
    const layout = computeLayout({
      width: this.scale.gameSize.width,
      height: this.scale.gameSize.height,
    });
    this.cameras.main.setZoom(layout.zoom);
  };

  private onCraftShortcut = (): void => this.inventoryPanel.toggleTab('craft');
  private onBuildShortcut = (): void => this.inventoryPanel.toggleTab('build');
  private onInventoryShortcut = (): void => this.inventoryPanel.toggle();
  private onCancelShortcut = (): void => {
    if (this.npcPanel.isOpen) {
      this.npcPanel.close();
      return;
    }
    this.buildMenu.close();
    this.hud.closeCraft();
    this.inventoryPanel.close();
  };

  private teardown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerAction);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
    this.craftKey?.off('down', this.onCraftShortcut);
    this.buildKey?.off('down', this.onBuildShortcut);
    this.inventoryKey?.off('down', this.onInventoryShortcut);
    this.cancelKey?.off('down', this.onCancelShortcut);
    this.hotbarKeys.forEach((key, slot) => key.off('down', this.hotbarShortcutHandlers[slot]!));
    this.joystick.destroy();
    this.hud.destroy();
    this.buildMenu.destroy();
    this.buildMode.destroy();
    this.hotbar.destroy();
    this.inventoryPanel.destroy();
    this.navigator.destroy();
    this.encounterPanel.destroy();
    this.npcPanel.destroy();
    this.resourceSprites.clear();
    this.dropSprites.clear();
    this.creatureSprites.clear();
    this.npcSprites.clear();
  }
}
