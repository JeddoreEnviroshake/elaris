import { adminMenuEnabled } from '../config/adminAccess';
import {
  AREA_THEME_IDS,
  BAG_ITEM_IDS, BAG_ITEM_LABELS, BAG_WEIGHT_SCALE, RESOURCE_NODE_KINDS, STRIKE_TARGETS, STRUCTURE_FACILITY_IDS, TICKS_PER_SECOND,
  type StrikeTarget,
  TOOL_DEFINITIONS, TOOL_TIER_RANK, VARIANT_TOOL_GRADES, WALL_MATERIAL_IDS,
  variantToolGrade, type ToolDefinition,
} from '../config/balance';
import { CREATURE_DEFINITIONS } from '../content/creatures';
import {
  DANGER_ONBOARDING_THREATS, DANGER_ROTATION_THREATS, DANGER_THREAT_IDS, DANGER_THREAT_NAMES,
} from '../content/dangerThreats';
import { RAIDER_DEFINITIONS, raiderBounty } from '../content/raiders';
import { TILE_SIZE, WORLD_PX } from '../config/platform';
import type { GlobalBalanceService } from '../platform/globalBalance';
import {
  ATTRIBUTE_GAIN_FIELDS, ATTRIBUTE_GAIN_SCALE, ATTRIBUTE_IDS, ATTRIBUTE_LABELS, attributePointDetail,
} from '../simulation/characterProgression';
import { applyGameBalance, applyLocalAdminUpdate, createAdminDraft, validateGameBalance, type AdminDraft } from '../simulation/admin';
import { scaleByLevel } from '../simulation/enemyLevels';
import type { Facing, GameState, GatherableResourceId, RaidTargetPriority } from '../simulation/state';
import { startDangerPhaseNow, survivalSchedule } from '../simulation/survivalCycle';
import {
  CAMERA_TENTHS_PER_DEGREE, ELARIS_CAMERA_DEFAULT_TENTHS, ELARIS_CAMERA_PITCH_RANGE, ELARIS_CAMERA_YAW_RANGE,
  cameraOrientationFromTenths,
  type ElarisCameraOrientation, type ElarisCameraTenths,
} from '../three/cameraControls';
import { BLUEPRINT_ITEM_IDS } from '../simulation/blueprintKnowledge';
import { div, uiButton, wireDisclosure } from './controls';
import type { InventoryPanel } from './inventoryPanel';

/** System-level controls the Admin menu hosts (previously top-of-screen chrome). */
export interface AdminSystemControls {
  /**
   * Preview the live 3D overworld camera while a Global Values slider moves.
   * The published angles are the authority; this only shows an edit in flight.
   */
  camera?: { set: (orientation: ElarisCameraOrientation) => void };
  /** Whether the service worker has precached the app for offline launch. */
  getOfflineReady?: () => boolean;
  /** Open the About/Diagnostics panel (build id, live metrics, save actions). */
  openDiagnostics?: () => void;
  /** Wipe the save and restart the world from a fresh character. */
  resetGame?: () => void | Promise<void>;
  /** Save and close the current local session. */
  quitToMenu?: () => void | Promise<void>;
}

const GATHERABLE_RESOURCE_IDS: readonly GatherableResourceId[] = ['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot'];
const TARGET_LABELS: Readonly<Record<StrikeTarget, string>> = {
  tree: 'Tree → wood', stone: 'Stone → stone', metal: 'Metal → iron ore',
  plant: 'Plant → fiber', 'berry-bush': 'Berry Bush → fiber + berries',
  raider: 'Raider (combat)', creature: 'Wild Creature (combat)',
  structure: 'Structure (walls, facilities)',
};

type AdminView = 'local' | 'global';

/** Save-backed, staged editor for authoritative character and equipment data. */
export class AdminPanel {
  private readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly pushButton: HTMLButtonElement;
  private readonly systemBar: HTMLDivElement;
  private cameraCard: HTMLElement | undefined;
  private readonly cameraSliders: ((tenths: ElarisCameraTenths) => void)[] = [];
  private readonly hideWhilePeeking: { element: HTMLElement; display: string }[] = [];
  private readonly hiddenContent = new Map<HTMLElement, string>();
  private peekTimer: number | undefined;
  private peekSource: HTMLElement | undefined;
  private readonly nav = new Map<AdminView, HTMLButtonElement>();
  private draft: AdminDraft;
  private activeView: AdminView = 'local';
  private systemTimer: number | undefined;
  /** Titles of the cards left open, so a re-render does not close them. */
  private readonly openDetails = new Set<string>();
  private offlineDot: HTMLDivElement | undefined;
  private offlineLabel: HTMLSpanElement | undefined;
  private raidButton: HTMLButtonElement | undefined;
  private menu: InventoryPanel | undefined;
  private firebaseAccessCard: HTMLDivElement | undefined;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly onPushed: () => void,
    private readonly globalBalance: GlobalBalanceService,
    private readonly system: AdminSystemControls = {},
  ) {
    this.draft = createAdminDraft(state);
    this.root = div({ position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '30' });
    this.button = uiButton('Admin', () => {
      this.menu?.close();
      this.toggle();
    });
    this.button.style.minHeight = '44px';
    this.button.style.background = 'rgba(99,56,32,0.96)';

    this.overlay = div({
      position: 'fixed', inset: '0', display: 'none', placeItems: 'center', padding: '12px',
      boxSizing: 'border-box', background: 'rgba(0,0,0,0.58)', pointerEvents: 'auto', zIndex: '1',
    });
    this.panel = div({
      display: 'flex', flexDirection: 'column', width: 'min(920px, 100%)', height: 'min(760px, 94vh)',
      border: '1px solid rgba(255,255,255,0.2)', borderRadius: '14px', overflow: 'hidden',
      boxShadow: '0 18px 60px rgba(0,0,0,0.55)', background: 'rgba(9,20,14,0.99)', color: '#e8f0ea',
      font: '14px system-ui, sans-serif',
    });
    this.panel.classList.add('elaris-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', 'Admin stat editor');
    wireDisclosure(this.button, this.panel, 'admin-panel');

    const title = document.createElement('strong');
    title.textContent = 'Admin · Local and global values';
    Object.assign(title.style, { fontSize: '17px', flex: '1' });
    const close = uiButton('Close', () => this.close());
    close.style.minHeight = '42px';
    const header = div({ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.12)' });
    header.append(title, close);

    this.systemBar = div({
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px',
      padding: '10px 14px 0',
    });
    const nav = div({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '10px 14px 0' });
    for (const [view, label] of [['local', 'Local Values'], ['global', 'Global Values']] as const) {
      const tab = uiButton(label, () => this.showView(view));
      tab.setAttribute('role', 'tab');
      tab.style.minHeight = '42px';
      this.nav.set(view, tab);
      nav.appendChild(tab);
    }
    this.content = div({ flex: '1', overflowY: 'auto', overscrollBehavior: 'contain', padding: '12px 14px 18px' });
    this.status = div({ flex: '1', minHeight: '20px', fontSize: '12px', lineHeight: '1.4', color: '#c9d6cc' });
    const reset = uiButton('Discard changes', () => {
      this.draft = createAdminDraft(this.state);
      // The camera previews unpublished angles live, so dropping the draft has
      // to put the world back on the published ones.
      this.previewCamera(this.draft.gameBalance.camera);
      this.render();
      this.setStatus('Staged changes discarded', true);
    });
    reset.style.background = '#4e514f';
    this.pushButton = uiButton('Push Local Values', () => { void this.push(); });
    this.pushButton.style.background = '#765d28';
    this.pushButton.style.fontWeight = '700';
    const footer = div({ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(15,31,22,0.98)' });
    footer.append(this.status, reset, this.pushButton);
    this.panel.append(header, this.systemBar, nav, this.content, footer);
    // Peeking hides everything but the camera sliders so the angle can be judged
    // against the live world instead of a menu.
    for (const section of [header, this.systemBar, nav, footer]) {
      this.hideWhilePeeking.push({ element: section, display: section.style.display });
    }
    this.overlay.appendChild(this.panel);
    this.root.append(this.overlay);
    parent.appendChild(this.root);
    this.overlay.addEventListener('click', (event) => { if (event.target === this.overlay) this.close(); });
  }

  get open(): boolean { return this.overlay.style.display !== 'none'; }
  get worldPreviewActive(): boolean { return this.peekSource !== undefined; }

  attachToMenu(menu: InventoryPanel): void {
    this.menu = menu;
    if (adminMenuEnabled()) menu.addHeaderAction(this.button);
  }

  toggle(): void { if (this.open) this.close(); else this.openPanel(); }

  private openPanel(): void {
    this.draft = createAdminDraft(this.state);
    this.overlay.style.display = 'grid';
    this.button.setAttribute('aria-expanded', 'true');
    this.setStatus('Changes are staged until you push the update', true);
    this.render();
    this.renderSystemBar();
    // Offline readiness settles after the panel opens, and the cycle phase moves
    // on its own; poll so both labels stay honest without reopening the panel.
    if (this.systemTimer === undefined) {
      this.systemTimer = window.setInterval(() => this.syncSystemBar(), 1000);
    }
    void this.globalBalance.waitForAuth().then(() => {
      if (this.open && this.activeView === 'global') this.renderFirebaseAccess();
    });
  }

  close(): void {
    this.setPeeking(false);
    // A camera angle dragged but never published was only ever a preview.
    this.previewCamera(this.state.gameBalance.camera);
    this.overlay.style.display = 'none';
    this.button.setAttribute('aria-expanded', 'false');
    if (this.systemTimer !== undefined) {
      window.clearInterval(this.systemTimer);
      this.systemTimer = undefined;
    }
  }

  /**
   * Build the system strip once: offline-readiness status and
   * the immediate raid trigger. Built rather than re-rendered because the strip
   * refreshes on a one-second poll, and replacing a live button every second
   * would drop the press the user is in the middle of making.
   */
  private renderSystemBar(): void {
    if (this.systemBar.childElementCount > 0) { this.syncSystemBar(); return; }

    if (this.system.getOfflineReady) {
      const status = div({
        display: 'flex', alignItems: 'center', gap: '7px', flex: '1', minWidth: '140px',
        fontSize: '12px', color: '#c9d6cc',
      });
      this.offlineDot = div({ width: '9px', height: '9px', borderRadius: '50%', flex: '0 0 auto' });
      this.offlineLabel = document.createElement('span');
      status.append(this.offlineDot, this.offlineLabel);
      this.systemBar.appendChild(status);
    }

    // Skip the wait for the next danger minute. Testing raids, turrets, or wall
    // damage otherwise means sitting through a whole safe phase, so this acts on
    // the live simulation immediately rather than staging into the draft.
    const raid = uiButton('Start Raid Now', () => {
      const result = startDangerPhaseNow(this.state);
      this.setStatus(result.message, result.ok);
      if (result.ok) this.onPushed();
      this.syncSystemBar();
    });
    raid.dataset.testid = 'admin-start-raid';
    raid.setAttribute('aria-label', 'Start the danger phase now');
    raid.style.minHeight = '42px';
    this.raidButton = raid;
    this.systemBar.appendChild(raid);

    if (this.system.openDiagnostics) {
      const openDiagnostics = this.system.openDiagnostics;
      const diagnostics = uiButton('Diagnostics', () => openDiagnostics());
      diagnostics.setAttribute('aria-label', 'App status and diagnostics');
      diagnostics.style.minHeight = '42px';
      diagnostics.style.background = 'rgba(30,48,37,0.94)';
      this.systemBar.appendChild(diagnostics);
    }
    this.syncSystemBar();
  }

  /** Refresh the strip's labels against state that moves on its own. */
  private syncSystemBar(): void {
    if (this.offlineDot && this.offlineLabel && this.system.getOfflineReady) {
      const ready = this.system.getOfflineReady();
      this.offlineDot.style.background = ready ? '#4cc07f' : '#c9a227';
      this.offlineLabel.textContent = ready ? 'Ready offline' : 'Online only';
    }
    if (this.raidButton) {
      const timer = survivalSchedule(this.state);
      const running = timer.phase === 'danger';
      this.raidButton.textContent = timer.openingPhase !== null ? 'Finish Fog Lesson First' : running ? 'Raid Running' : 'Start Raid Now';
      this.raidButton.disabled = running || timer.openingPhase !== null;
      this.raidButton.style.background = running ? 'rgba(30,48,37,0.94)' : '#8a3a2a';
    }
  }

  /**
   * Camera angle as a Global Value: how the game is framed is one decision for
   * everyone, published with the rest of the balance rather than kept per
   * device. Edits preview live so the tilt can be judged, but only a publish
   * makes them the angle every client loads.
   */
  private renderCameraValues(): void {
    const camera = this.draft.gameBalance.camera;
    this.content.append(this.heading('Camera angle (3D world)'));

    const card = div({
      display: 'grid', gap: '10px', padding: '11px 12px', borderRadius: '11px',
      border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(20,38,28,0.97)',
    });
    this.cameraCard = card;
    const title = div({ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' });
    const reset = uiButton('Reset', () => {
      camera.yawTenths = ELARIS_CAMERA_DEFAULT_TENTHS.yawTenths;
      camera.pitchTenths = ELARIS_CAMERA_DEFAULT_TENTHS.pitchTenths;
      this.previewCamera(camera);
      this.syncCameraSliders();
      this.setStatus('Camera angle staged at the default tilt — publish to apply it everywhere', true);
    });
    reset.dataset.testid = 'admin-camera-reset';
    reset.style.minHeight = '36px';
    reset.style.background = 'rgba(30,48,37,0.94)';

    const help = div({ flex: '1', minWidth: '200px', fontSize: '12px', lineHeight: '1.45', opacity: '0.78' });
    help.textContent = 'How far the camera sits around and above the character, for every player. '
      + 'Side angle is the tilt you feel walking left or right — 0° looks straight down the map so the view slides flat across, '
      + 'and the default 20° is what makes the world lean. Higher overhead angle is closer to top-down. '
      + 'Dragging previews the angle on this screen; Publish Global Values sends it to every client.';

    title.append(help, reset);
    card.append(title);
    card.appendChild(this.cameraSlider(
      'Side angle (left/right tilt)', 'admin-camera-yaw',
      ELARIS_CAMERA_YAW_RANGE.min, ELARIS_CAMERA_YAW_RANGE.max,
      (tenths) => tenths.yawTenths,
      (yawTenths) => { camera.yawTenths = yawTenths; this.previewCamera(camera); },
    ));
    card.appendChild(this.cameraSlider(
      'Overhead angle (pitch)', 'admin-camera-pitch',
      ELARIS_CAMERA_PITCH_RANGE.min, ELARIS_CAMERA_PITCH_RANGE.max,
      (tenths) => tenths.pitchTenths,
      (pitchTenths) => { camera.pitchTenths = pitchTenths; this.previewCamera(camera); },
    ));
    this.content.appendChild(card);
    this.syncCameraSliders();
  }

  /**
   * One angle: a slider for sweeping and a number box for an exact value. Both
   * read and write whole degrees — the stored tenths exist so the default
   * 47.4° pitch survives a save, not so an admin can dial a tenth of a degree.
   */
  private cameraSlider(
    label: string,
    testid: string,
    minDegrees: number,
    maxDegrees: number,
    read: (tenths: ElarisCameraTenths) => number,
    write: (tenths: number) => void,
  ): HTMLElement {
    const min = minDegrees; const max = maxDegrees; const step = 1;
    const row = div({ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(120px, 2fr) 78px', gap: '9px', alignItems: 'center' });
    const name = div({ fontSize: '12px', color: 'rgba(232,240,234,0.86)' });
    name.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min); slider.max = String(max); slider.step = String(step);
    slider.dataset.testid = testid;
    slider.setAttribute('aria-label', label);
    Object.assign(slider.style, { width: '100%', minHeight: '40px', accentColor: '#ffe08a', touchAction: 'none' });

    const exact = document.createElement('input');
    exact.type = 'number';
    exact.min = String(min); exact.max = String(max); exact.step = String(step);
    exact.setAttribute('aria-label', `${label} in degrees`);
    Object.assign(exact.style, this.inputStyle(), { textAlign: 'right' });

    const apply = (raw: string, source: HTMLInputElement): void => {
      if (raw === '') return;
      const degrees = Math.max(min, Math.min(max, Number(raw)));
      if (!Number.isFinite(degrees)) return;
      write(Math.round(degrees * CAMERA_TENTHS_PER_DEGREE));
      const other = source === slider ? exact : slider;
      other.value = String(degrees);
    };
    slider.addEventListener('input', () => apply(slider.value, slider));
    exact.addEventListener('input', () => apply(exact.value, exact));
    // Dragging is the only way to judge a tilt, and the tilt is behind the menu.
    const startPeek = (): void => { this.peekSource = slider; this.setPeeking(true); };
    slider.addEventListener('pointerdown', startPeek);
    slider.addEventListener('pointerup', () => this.schedulePeekEnd());
    slider.addEventListener('pointercancel', () => this.schedulePeekEnd());
    slider.addEventListener('keydown', startPeek);
    slider.addEventListener('keyup', () => this.schedulePeekEnd());
    // Only the slider that opened the peek may close it: pressing one angle
    // blurs the other, and that blur lands after the new drag has begun.
    slider.addEventListener('blur', () => { if (this.peekSource === slider) this.setPeeking(false); });

    // Snap to the slider's own step: the default pitch is 47.4°, and a range
    // input silently rounds that, leaving the two boxes disagreeing on open.
    this.cameraSliders.push((tenths) => {
      const value = Math.round(read(tenths) / CAMERA_TENTHS_PER_DEGREE / step) * step;
      slider.value = String(value);
      exact.value = String(value);
    });
    row.append(name, slider, exact);
    return row;
  }

  private syncCameraSliders(): void {
    const camera = this.draft.gameBalance.camera;
    for (const sync of this.cameraSliders) sync(camera);
  }

  /** Show a staged angle on the running world without publishing it. */
  private previewCamera(tenths: ElarisCameraTenths): void {
    this.system.camera?.set(cameraOrientationFromTenths(tenths));
  }

  /**
   * Fade everything but the camera sliders so the angle being dragged is judged
   * against the running world rather than described in a help line.
   */
  private setPeeking(peeking: boolean): void {
    if (this.peekTimer !== undefined) { window.clearTimeout(this.peekTimer); this.peekTimer = undefined; }
    if (!peeking) this.peekSource = undefined;
    for (const section of this.hideWhilePeeking) section.element.style.display = peeking ? 'none' : section.display;
    this.overlay.style.background = peeking ? 'transparent' : 'rgba(0,0,0,0.58)';
    this.overlay.style.placeItems = peeking ? 'start center' : 'center';
    this.panel.style.height = peeking ? 'auto' : 'min(760px, 94vh)';
    this.panel.style.background = peeking ? 'transparent' : 'rgba(9,20,14,0.99)';
    this.panel.style.border = peeking ? 'none' : '1px solid rgba(255,255,255,0.2)';
    this.panel.style.boxShadow = peeking ? 'none' : '0 18px 60px rgba(0,0,0,0.55)';
    // The sliders now live inside the scrolling Global Values list, so the rest
    // of that list is what has to get out of the way — hiding `content` itself
    // would take the sliders with it. Rows carry inline `display: grid`, so the
    // original value is remembered rather than cleared.
    if (peeking) {
      this.hiddenContent.clear();
      for (const child of Array.from(this.content.children) as HTMLElement[]) {
        if (child === this.cameraCard) continue;
        this.hiddenContent.set(child, child.style.display);
        child.style.display = 'none';
      }
    } else {
      for (const [child, display] of this.hiddenContent) child.style.display = display;
      this.hiddenContent.clear();
    }
    this.content.style.overflowY = peeking ? 'visible' : 'auto';
  }

  /** Hold the peek briefly after a drag so the settled camera can be judged. */
  private schedulePeekEnd(): void {
    if (this.peekTimer !== undefined) window.clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => { this.peekTimer = undefined; this.setPeeking(false); }, 1200);
  }

  private showView(view: AdminView): void { this.activeView = view; this.render(); }

  private render(): void {
    this.content.replaceChildren();
    // The camera card and the rows peeking hides are both rebuilt below.
    this.cameraCard = undefined;
    this.hiddenContent.clear();
    this.cameraSliders.length = 0;
    for (const [view, button] of this.nav) {
      const selected = view === this.activeView;
      button.setAttribute('aria-selected', String(selected));
      button.style.background = selected ? '#2f6b43' : 'rgba(30,48,37,0.94)';
      button.style.borderColor = selected ? '#ffe08a' : 'rgba(255,255,255,0.16)';
    }
    this.pushButton.textContent = this.activeView === 'local' ? 'Push Local Values' : 'Publish Global Values';
    if (this.activeView === 'local') this.renderLocalValues(); else this.renderGlobalValues();
  }

  private renderLocalValues(): void {
    const player = this.draft.player;
    const help = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'These values immediately affect this character only.';
    this.content.appendChild(help);
    this.content.append(this.heading('Vitals & progression'));
    const vitals = this.grid();
    vitals.append(
      this.numberField('HP', player.hp, (v) => { player.hp = v; }, 0),
      this.numberField('Max HP', player.maxHp, (v) => { player.maxHp = v; }, 1),
      this.numberField('Stamina', player.stamina, (v) => { player.stamina = v; }, 0),
      this.numberField('Max stamina', player.maxStamina, (v) => { player.maxStamina = v; }, 1),
      this.numberField('Mana', player.mana, (v) => { player.mana = v; }, 0),
      this.numberField('Max mana', player.maxMana, (v) => { player.maxMana = v; }, 1),
      this.numberField('Level', player.level, (v) => { player.level = v; }, 1),
      this.numberField('XP', player.xp, (v) => { player.xp = v; }, 0),
      this.numberField('Attribute points', player.attributePoints, (v) => { player.attributePoints = v; }, 0),
    );
    this.content.appendChild(vitals);

    this.content.append(this.heading('Attributes'));
    const attributes = this.grid();
    for (const id of ATTRIBUTE_IDS) attributes.appendChild(this.numberField(ATTRIBUTE_LABELS[id], player.attributes[id], (v) => { player.attributes[id] = v; }, 0));
    this.content.appendChild(attributes);

    this.content.append(this.heading('Position'));
    const position = this.grid();
    position.append(
      this.numberField('X', player.x, (v) => { player.x = v; }, 0, WORLD_PX),
      this.numberField('Y', player.y, (v) => { player.y = v; }, 0, WORLD_PX),
      this.selectField('Facing', player.facing, ['up', 'down', 'left', 'right'], (v) => { player.facing = v as Facing; }),
    );
    this.content.appendChild(position);

    this.content.append(this.heading('Inventory & currency'));
    const inventory = this.grid();
    for (const item of BAG_ITEM_IDS) inventory.appendChild(this.numberField(BAG_ITEM_LABELS[item], this.draft.inventory[item], (v) => { this.draft.inventory[item] = v; }, 0));
    inventory.append(
      this.numberField('Coins', this.draft.coins, (v) => { this.draft.coins = v; }, 0),
    );
    this.content.appendChild(inventory);

    this.content.append(this.heading('Known blueprints'));
    const unlocks = this.grid();
    for (const id of BLUEPRINT_ITEM_IDS) {
      unlocks.appendChild(this.checkboxField(this.pretty(id), this.draft.unlockedItemIds.includes(id), (checked) => {
        this.draft.unlockedItemIds = checked
          ? [...new Set([...this.draft.unlockedItemIds, id])]
          : this.draft.unlockedItemIds.filter((candidate) => candidate !== id);
      }));
    }
    this.content.appendChild(unlocks);

    this.renderResetGame();
  }

  /**
   * The one Local Value that cannot be staged and pushed: it throws the save
   * away, so it acts immediately and asks first.
   */
  private renderResetGame(): void {
    const resetGame = this.system.resetGame;
    if (!resetGame) return;
    this.content.append(this.heading('Reset game'));
    const card = div({
      display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px',
      padding: '11px 12px', borderRadius: '11px',
      border: '1px solid rgba(255,140,120,0.35)', background: 'rgba(48,22,18,0.97)',
    });
    const help = div({ flex: '1', minWidth: '200px', fontSize: '12px', lineHeight: '1.45', opacity: '0.82' });
    help.textContent = 'Permanently clears this save — character, inventory, blueprints, buildings, and the world — '
      + 'and starts a brand new game. Staged changes are discarded. This cannot be undone.';
    const button = uiButton('Reset Game', () => { void this.confirmResetGame(resetGame); });
    button.dataset.testid = 'admin-reset-game';
    button.setAttribute('aria-label', 'Reset the entire game');
    button.style.minHeight = '42px';
    button.style.background = '#8a3a2a';
    button.style.fontWeight = '700';
    card.append(help, button);
    this.content.appendChild(card);
  }

  private async confirmResetGame(resetGame: () => void | Promise<void>): Promise<void> {
    if (!window.confirm('Reset the entire game? This permanently clears this character, everything built, and all progress. This cannot be undone.')) {
      this.setStatus('Game reset cancelled', true);
      return;
    }
    this.setStatus('Resetting the game…', true);
    try {
      await resetGame();
    } catch (error) {
      this.setStatus(`Reset failed: ${error instanceof Error ? error.message : String(error)}`, false);
      return;
    }
    // The old draft points at wiped values, and the scene restarts underneath.
    this.draft = createAdminDraft(this.state);
    this.close();
  }

  private renderGlobalValues(): void {
    this.renderFirebaseAccess();
    const defaults = this.draft.gameBalance.characterDefaults;
    const globalHelp = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    globalHelp.textContent = 'These values are shared by all characters. Starting values apply when a character is created; Walk Speed, the Sprint values, the camera angle, and equipment/object tuning apply immediately. Sprint Speed is in tenths of walking speed — 15 is 1.5x.';
    this.content.appendChild(globalHelp);
    this.renderCameraValues();
    this.content.append(this.heading('Character starting values'));
    const startingValues = this.grid();
    startingValues.append(
      this.numberField('Starting HP', defaults.startingHp, (v) => { defaults.startingHp = v; }, 1),
      this.numberField('Starting Stamina', defaults.startingStamina, (v) => { defaults.startingStamina = v; }, 1),
      this.numberField('Starting Mana', defaults.startingMana, (v) => { defaults.startingMana = v; }, 1),
      this.numberField('Starting Attribute Points', defaults.startingAttributePoints, (v) => { defaults.startingAttributePoints = v; }, 0),
      this.scaledField('Base HP Regen (per second)', defaults.hpRegenBaseHundredths, ATTRIBUTE_GAIN_SCALE, (v) => { defaults.hpRegenBaseHundredths = v; }),
      this.scaledField('Base SP Regen (per second)', defaults.staminaRegenBaseHundredths, ATTRIBUTE_GAIN_SCALE, (v) => { defaults.staminaRegenBaseHundredths = v; }),
      this.scaledField('Base MP Regen (per second)', defaults.manaRegenBaseHundredths, ATTRIBUTE_GAIN_SCALE, (v) => { defaults.manaRegenBaseHundredths = v; }),
      this.numberField('Walk Speed (px/s)', defaults.walkSpeed, (v) => { defaults.walkSpeed = v; }, 1),
      this.numberField('Sprint Speed (tenths of walk speed)', defaults.sprintSpeedTenths, (v) => { defaults.sprintSpeedTenths = v; }, 1),
      this.numberField('Sprint SP per second', defaults.sprintStaminaPerSecond, (v) => { defaults.sprintStaminaPerSecond = v; }, 0),
    );
    this.content.appendChild(startingValues);

    this.content.append(this.heading('On level up'));
    const levelUp = this.draft.gameBalance.levelUp;
    const levelUpHelp = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    levelUpHelp.textContent = 'Applied once per level gained. Automatic points increase every attribute; spendable points and gold are granted to the player.';
    this.content.appendChild(levelUpHelp);
    const levelUpValues = this.grid();
    levelUpValues.append(
      this.numberField('Points added to every attribute', levelUp.attributePointsPerStat, (v) => { levelUp.attributePointsPerStat = v; }, 0),
      this.numberField('Spendable Attribute Points', levelUp.spendableAttributePoints, (v) => { levelUp.spendableAttributePoints = v; }, 0),
      this.numberField('Gold', levelUp.coins, (v) => { levelUp.coins = v; }, 0),
    );
    this.content.appendChild(levelUpValues);

    this.renderAttributeGainValues();

    this.content.append(this.heading('Bag weight'));
    const bagWeights = this.grid();
    const weightBalance = this.draft.gameBalance.bagWeight;
    bagWeights.appendChild(this.weightField('Weight Limit', weightBalance.capacityHundredths, (v) => { weightBalance.capacityHundredths = v; }, 0.01));
    for (const item of BAG_ITEM_IDS) {
      bagWeights.appendChild(this.weightField(`${BAG_ITEM_LABELS[item]} Weight`, weightBalance.itemHundredths[item], (v) => {
        weightBalance.itemHundredths[item] = v;
      }));
    }
    this.content.appendChild(bagWeights);

    this.renderRaidValues();
    this.renderCreatureValues();
    this.renderBlueprintValues();
    this.renderOutlandsValues();

    this.content.append(this.heading('Resource objects'));
    const help = div({ margin: '6px 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'Tier 0 = Bare Hands, 1 = Wooden, 2 = Stone, 3 = Iron. Damage 0 disables a target relationship. '
      + `Range is in world pixels, where one tile is ${TILE_SIZE}px — it is how far a tool reaches to strike or gather, `
      + 'and for the Bow how far it can shoot.';
    this.content.appendChild(help);
    const tiers = this.grid();
    for (const kind of RESOURCE_NODE_KINDS) {
      const object = this.draft.gameBalance.objects[kind];
      const details = this.details(TARGET_LABELS[kind], `${object.resource} · ${object.maxHp} HP`);
      const body = details.querySelector('[data-body]')!;
      const values = this.grid();
      values.append(
        this.selectField('Drops', object.resource, GATHERABLE_RESOURCE_IDS, (v) => { object.resource = v as GatherableResourceId; }),
        this.numberField('Max HP', object.maxHp, (v) => { object.maxHp = v; }, 1),
        this.numberField('Minimum yield', object.yieldMin, (v) => { object.yieldMin = v; }, 0),
        this.numberField('Maximum yield', object.yieldMax, (v) => { object.yieldMax = v; }, 0),
        this.numberField('Worker yield', object.yieldAmount, (v) => { object.yieldAmount = v; }, 0),
        this.numberField('Respawn ticks', object.respawnTicks, (v) => { object.respawnTicks = v; }, 0),
        this.numberField('Hardness', object.hardness, (v) => { object.hardness = v; }, 1),
        this.numberField('Minimum tool tier', object.minimumToolTier, (v) => { object.minimumToolTier = v; }, 0, 3),
        this.numberField('Bonus berries', object.berryYield, (v) => { object.berryYield = v; }, 0),
      );
      body.appendChild(values);
      tiers.appendChild(details);
    }
    this.content.appendChild(tiers);

    this.content.append(this.heading('Bare Hands'));
    const hands = this.details('Bare Hands', `Speed ${this.draft.gameBalance.hands.actionTicks} ticks`);
    const handBody = hands.querySelector('[data-body]')!;
    handBody.appendChild(this.numberField('Action ticks (lower is faster)', this.draft.gameBalance.hands.actionTicks, (v) => { this.draft.gameBalance.hands.actionTicks = v; }, 1));
    handBody.appendChild(this.numberField('Range (pixels)', this.draft.gameBalance.hands.rangePx, (v) => { this.draft.gameBalance.hands.rangePx = v; }, 1));
    for (const kind of STRIKE_TARGETS) handBody.appendChild(this.targetEditor(kind, this.draft.gameBalance.hands.damageByTarget[kind], 0, (damage) => {
      this.draft.gameBalance.hands.damageByTarget[kind] = damage;
    }, false));
    this.content.appendChild(hands);

    // Base tiers first, then one heading per variant grade. Variants all carry
    // the Iron tier so they gate like Iron tools, but folding fifteen of them
    // into the Iron list would bury the four rows anyone actually retunes.
    const sections: { label: string; tools: readonly ToolDefinition[] }[] = [
      ...(['wooden', 'stone', 'iron'] as const).map((tier) => ({
        label: `${this.pretty(tier)} tier`,
        tools: TOOL_DEFINITIONS.filter(
          (candidate) => candidate.tier === tier && variantToolGrade(candidate.definitionId) === null,
        ),
      })),
      ...VARIANT_TOOL_GRADES.map((grade) => ({
        label: `${grade.label} variants`,
        tools: TOOL_DEFINITIONS.filter(
          (candidate) => variantToolGrade(candidate.definitionId) === grade.quality,
        ),
      })),
    ];
    for (const section of sections) {
      this.content.append(this.heading(section.label));
      for (const definition of section.tools) {
        const editable = this.draft.gameBalance.tools[definition.definitionId];
        const details = this.details(definition.displayName, `${definition.kind} · tier ${TOOL_TIER_RANK[definition.tier]}`);
        const body = details.querySelector('[data-body]')!;
        const basics = this.grid();
        basics.append(
          this.numberField('Max durability', editable.maxDurability, (v) => { editable.maxDurability = v; }, 1),
          this.numberField('Action ticks (lower is faster)', editable.actionTicks, (v) => { editable.actionTicks = v; }, 1),
          this.numberField('Base wear per hit', editable.wearPerHit, (v) => { editable.wearPerHit = v; }, 0),
          // The Bow's Range is the distance it can shoot; every other tool's is
          // how far its swing reaches, which is also how far it gathers from.
          this.numberField(
            definition.kind === 'bow' ? 'Shot range (pixels)' : 'Range (pixels)',
            editable.rangePx,
            (v) => { editable.rangePx = v; },
            1,
          ),
        );
        body.appendChild(basics);
        body.appendChild(this.subheading('Crafting cost'));
        const costs = this.grid();
        for (const resource of GATHERABLE_RESOURCE_IDS) costs.appendChild(this.numberField(this.pretty(resource), editable.craftCost[resource], (v) => { editable.craftCost[resource] = v; }, 0));
        body.appendChild(costs);
        body.appendChild(this.subheading('Valid objects, damage & target wear'));
        for (const kind of STRIKE_TARGETS) body.appendChild(this.targetEditor(
          kind, editable.damageByTarget[kind], editable.wearMultiplierByTarget[kind],
          (damage, wear) => { editable.damageByTarget[kind] = damage; editable.wearMultiplierByTarget[kind] = wear; },
        ));
        this.content.appendChild(details);
      }
    }
  }

  /**
   * What one attribute point is worth. Every per-point number sits next to the
   * sentence the character sheet shows the player, and that sentence is built
   * from these values, so the promise and the simulation cannot disagree.
   */
  private renderAttributeGainValues(): void {
    const gains = this.draft.gameBalance.attributeGains;
    this.content.append(this.heading('Per attribute point'));
    const help = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'What one point spent on an attribute buys. Chance values are basis points, where 100 is 1%, '
      + 'and each has a maximum that caps the bonus however many points go in. '
      + 'Regeneration and carry weight accept decimals; 0.25 health a second is one health every four seconds. '
      + 'Damage, chance, walk speed, regeneration, and carry weight apply immediately. '
      + 'Max HP, stamina, and mana are granted as a point is spent, so changing those affects the next point rather than points already spent.';
    this.content.appendChild(help);

    for (const attribute of ATTRIBUTE_IDS) {
      const fields = ATTRIBUTE_GAIN_FIELDS.filter((field) => field.attribute === attribute);
      if (fields.length === 0) continue;
      const details = this.details(ATTRIBUTE_LABELS[attribute], attributePointDetail(this.draft.gameBalance, attribute));
      details.dataset.testid = `admin-attribute-gains-${attribute}`;
      const summary = details.querySelector('summary')!;
      // The staged sentence is the readout: it says what the values in this card
      // will actually grant once they are published.
      const refresh = (): void => {
        summary.textContent = `${ATTRIBUTE_LABELS[attribute]} · ${attributePointDetail(this.draft.gameBalance, attribute)}`;
      };
      const body = details.querySelector('[data-body]')!;
      const values = this.grid();
      for (const field of fields) {
        const set = (value: number): void => { gains[field.key] = value; refresh(); };
        values.appendChild(field.scale && field.scale > 1
          ? this.scaledField(field.label, gains[field.key], field.scale, set)
          : this.numberField(field.label, gains[field.key], set, 0));
      }
      body.appendChild(values);
      this.content.appendChild(details);
    }
  }

  /**
   * The storm's metronome. The readout below the fields spells the schedule out
   * in seconds, because the interesting question — how many impacts fit in the
   * phase, and does the last one land before it ends — is not visible in any
   * single field.
   */
  private renderArcaneStormValues(): void {
    const storm = this.draft.gameBalance.storm;
    this.content.append(this.heading(DANGER_THREAT_NAMES.storm));
    const help = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'Strikes mark where you are standing and land a few seconds later. Nothing built protects '
      + 'against them — only Elaris does — so these values decide how much room the player has to move, not how '
      + 'much they had to prepare.';
    this.content.appendChild(help);

    const values = this.grid();
    const schedule = div({ margin: '8px 0 0', opacity: '0.72', fontSize: '12px', lineHeight: '1.45' });
    const refresh = (): void => {
      const phase = this.draft.gameBalance.raid.dangerPhaseSecondsByThreat.storm;
      const impacts = storm.intervalSeconds > 0 && storm.firstImpactSeconds < phase
        ? Math.floor((phase - 1 - storm.firstImpactSeconds) / storm.intervalSeconds) + 1
        : 0;
      const rewards = storm.rewardEveryStrikes > 0 ? Math.floor(impacts / storm.rewardEveryStrikes) : 0;
      schedule.textContent = `${impacts} impacts in a ${phase}s storm, first at ${storm.firstImpactSeconds}s`
        + ` and every ${storm.intervalSeconds}s after`
        + ` · ${storm.telegraphSeconds}s to leave a ${storm.impactRadiusTiles}-tile ring`
        + ` · ${rewards} of them drop ${storm.rewardIronOre} iron ore`;
    };
    values.append(
      this.numberField('First impact (seconds)', storm.firstImpactSeconds, (v) => { storm.firstImpactSeconds = v; refresh(); }, 1),
      this.numberField('Seconds between impacts', storm.intervalSeconds, (v) => { storm.intervalSeconds = v; refresh(); }, 1),
      this.numberField('Telegraph (seconds)', storm.telegraphSeconds, (v) => { storm.telegraphSeconds = v; refresh(); }, 1),
      this.numberField('Impact radius (tiles)', storm.impactRadiusTiles, (v) => { storm.impactRadiusTiles = v; refresh(); }, 1),
      this.numberField('Damage per impact', storm.playerDamage, (v) => { storm.playerDamage = v; refresh(); }, 0),
      this.numberField('Reward every N strikes', storm.rewardEveryStrikes, (v) => { storm.rewardEveryStrikes = v; refresh(); }, 1),
      this.numberField('Iron ore per reward', storm.rewardIronOre, (v) => { storm.rewardIronOre = v; refresh(); }, 0),
    );
    refresh();
    this.content.append(values, schedule);
  }

  /**
   * How often blueprints are found and how good they are.
   *
   * The readouts under each group are the point of this card. A target of 20
   * with 2000 jitter is two numbers that mean nothing on their own; "16–24
   * trees" is the thing an admin is actually deciding, and the rare share only
   * becomes legible when the fog-night figure is printed beside the base one.
   */
  private renderBlueprintValues(): void {
    const blueprints = this.draft.gameBalance.blueprints;
    this.content.append(this.heading('Blueprint finds'));
    const help = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'Every source counts its own work and pays a blueprint when the count is reached, so a find is '
      + 'owed rather than rolled. Each payout picks a fresh target inside the jitter band, which is what stops players '
      + 'counting to it — set jitter to 0 to make the counters exact. A target of 0 switches that source off entirely. '
      + 'Node counters are kept per region, so marsh trees and forest trees are separate counts.';
    this.content.appendChild(help);

    const band = (base: number): string => {
      if (base <= 0) return 'off';
      const spread = Math.floor((base * blueprints.jitterBps) / 10_000);
      return spread > 0 ? `${Math.max(1, base - spread)}–${base + spread}` : `exactly ${base}`;
    };

    this.content.appendChild(this.subheading('How much work per blueprint'));
    const counters = this.grid();
    const bands = div({ margin: '8px 0 0', opacity: '0.72', fontSize: '12px', lineHeight: '1.45' });
    const refreshBands = (): void => {
      bands.textContent = [
        ...RESOURCE_NODE_KINDS.map((kind) => `${TARGET_LABELS[kind]} ${band(blueprints.nodeTargets[kind])}`),
        `raiders ${band(blueprints.raiderTarget)}`,
        `creatures ${band(blueprints.creatureTarget)}`,
      ].join(' · ');
    };
    counters.append(
      ...RESOURCE_NODE_KINDS.map((kind) => this.numberField(
        `${TARGET_LABELS[kind]} per blueprint`,
        blueprints.nodeTargets[kind],
        (v) => { blueprints.nodeTargets[kind] = v; refreshBands(); },
        0,
      )),
      this.numberField('Raiders per blueprint', blueprints.raiderTarget, (v) => { blueprints.raiderTarget = v; refreshBands(); }, 0),
      this.numberField('Creature defeats per blueprint', blueprints.creatureTarget, (v) => { blueprints.creatureTarget = v; refreshBands(); }, 0),
      this.numberField('Jitter (basis points)', blueprints.jitterBps, (v) => { blueprints.jitterBps = v; refreshBands(); }, 0, 10_000),
    );
    refreshBands();
    this.content.append(counters, bands);

    this.content.appendChild(this.subheading('Rarity by region'));
    const rarityHelp = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    rarityHelp.textContent = 'Odds a node find comes out Rare rather than Common, in basis points where 100 is 1%. '
      + 'Gathering never produces better than Rare however these are set — Epic comes from raiders and creatures, '
      + 'Legendary only from arcane storm caches. Poison fog multiplies the region value up to the maximum.';
    this.content.appendChild(rarityHelp);
    const rarity = this.grid();
    const fogged = div({ margin: '8px 0 0', opacity: '0.72', fontSize: '12px', lineHeight: '1.45' });
    const refreshFog = (): void => {
      fogged.textContent = `In ${DANGER_THREAT_NAMES.fog}: ${AREA_THEME_IDS.map((theme) => {
        const base = blueprints.rareShareBpsByTheme[theme];
        const raised = Math.min(
          Math.floor((base * blueprints.fogRareMultiplierBps) / 10_000),
          blueprints.rareShareMaxBps,
        );
        return `${theme} ${(raised / 100).toFixed(1)}%`;
      }).join(' · ')}`;
    };
    rarity.append(
      ...AREA_THEME_IDS.map((theme) => this.numberField(
        `${this.pretty(theme)} rare share (bps)`,
        blueprints.rareShareBpsByTheme[theme],
        (v) => { blueprints.rareShareBpsByTheme[theme] = v; refreshFog(); },
        0,
        10_000,
      )),
      this.numberField(
        `${DANGER_THREAT_NAMES.fog} multiplier (bps)`,
        blueprints.fogRareMultiplierBps,
        (v) => { blueprints.fogRareMultiplierBps = v; refreshFog(); },
        0,
      ),
      this.numberField('Rare share maximum (bps)', blueprints.rareShareMaxBps, (v) => { blueprints.rareShareMaxBps = v; refreshFog(); }, 0, 10_000),
    );
    refreshFog();
    this.content.append(rarity, fogged);

    this.content.appendChild(this.subheading('Tier weights'));
    const weightHelp = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    weightHelp.textContent = 'Relative shares, not percentages: a tier\'s share is fixed and the recipes inside it split '
      + 'it evenly, so adding recipes to a tier never changes how often that tier comes up. Tiers with nothing left to '
      + 'learn are skipped before the roll.';
    this.content.appendChild(weightHelp);
    const weights = this.grid();
    const raiderWeights = blueprints.raiderTierWeights;
    const cacheWeights = blueprints.stormCacheTierWeights;
    weights.append(
      this.numberField('Raider · Common weight', raiderWeights.common, (v) => { raiderWeights.common = v; }, 0),
      this.numberField('Raider · Rare weight', raiderWeights.rare, (v) => { raiderWeights.rare = v; }, 0),
      this.numberField('Raider · Epic weight', raiderWeights.epic, (v) => { raiderWeights.epic = v; }, 0),
      this.numberField('Arcane cache · Rare weight', cacheWeights.rare, (v) => { cacheWeights.rare = v; }, 0),
      this.numberField('Arcane cache · Epic weight', cacheWeights.epic, (v) => { cacheWeights.epic = v; }, 0),
      this.numberField('Arcane cache · Legendary weight', cacheWeights.legendary, (v) => { cacheWeights.legendary = v; }, 0),
    );
    this.content.appendChild(weights);

    this.content.appendChild(this.subheading('Arcane storm caches'));
    const cacheHelp = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    cacheHelp.textContent = `Caches are scattered where the player is standing when a ${DANGER_THREAT_NAMES.storm} `
      + 'begins and swept away when it ends, opened or not. They are the only routine source of a Legendary blueprint, '
      + 'and the odds below are per cache — set them to 10000 to make every cache carry one.';
    this.content.appendChild(cacheHelp);
    const caches = this.grid();
    caches.append(
      this.numberField('Caches per storm', blueprints.stormCachesPerStorm, (v) => { blueprints.stormCachesPerStorm = v; }, 0),
      this.numberField('Odds a cache holds one (bps)', blueprints.stormCacheBlueprintBps, (v) => { blueprints.stormCacheBlueprintBps = v; }, 0, 10_000),
    );
    this.content.appendChild(caches);
  }

  /**
   * Field sites: the guarded ruins that are the only source of salvage. The
   * refill rhythm is in survival cycles so a player learns one clock, and the
   * search times are in ticks (60 a second).
   */
  private renderOutlandsValues(): void {
    const outlands = this.draft.gameBalance.outlands;
    this.content.append(this.heading('Field sites'));
    const help = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'Sites refill every N survival cycles. Searching takes the ticks below (60 = 1 s) and is '
      + 'interrupted by moving or taking damage. Guards return with the loot, never before. Changing sites per '
      + 'area moves no existing site; it adds or hides the highest-numbered ones.';
    this.content.appendChild(help);
    const grid = this.grid();
    grid.append(
      this.numberField('Cycles between refills', outlands.restockCycles, (v) => { outlands.restockCycles = v; }, 1),
      this.numberField('Sites per area', outlands.sitesPerArea, (v) => { outlands.sitesPerArea = v; }, 0, 6),
      this.numberField('Search ticks', outlands.searchTicks, (v) => { outlands.searchTicks = v; }, 1),
      this.numberField('Strongbox search ticks', outlands.strongboxSearchTicks, (v) => { outlands.strongboxSearchTicks = v; }, 1),
      this.numberField('Guards per site', outlands.guardsPerSite, (v) => { outlands.guardsPerSite = v; }, 0, 6),
      this.numberField('Guard leash (tiles)', outlands.guardLeashTiles, (v) => { outlands.guardLeashTiles = v; }, 1),
      this.numberField('Strongbox blueprint odds (bps)', outlands.strongboxBlueprintBps, (v) => { outlands.strongboxBlueprintBps = v; }, 0, 10_000),
      this.numberField('Danger bonus loot rolls', outlands.dangerBonusRolls, (v) => { outlands.dangerBonusRolls = v; }, 0),
    );
    this.content.appendChild(grid);
  }

  /**
   * The danger minute: when a raid arrives, how big it is, what it aims at, and
   * how fast being caught outside kills you. Grouped together because tuning any
   * one of them in isolation is what makes a raid feel unfair.
   */
  private renderRaidValues(): void {
    const raid = this.draft.gameBalance.raid;
    this.content.append(this.heading('Raid & danger phase'));
    const help = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'Exposure starts at the first value and climbs by the ramp each further second, up to the maximum. '
      + 'Target priority decides what a wave chews through first — leading with the Air Purifier ends shelter, and losing shelter is what kills the player.';
    this.content.appendChild(help);

    this.content.appendChild(this.subheading('Danger phase length'));
    const lengths = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    lengths.textContent = `Each danger element runs for its own length. A new world opens with ${
      DANGER_ONBOARDING_THREATS.map((threat) => DANGER_THREAT_NAMES[threat]).join(', ')
    }, then repeats ${
      DANGER_ROTATION_THREATS.map((threat) => DANGER_THREAT_NAMES[threat]).join(', ')
    } forever — so a cycle lasts the safe phase plus whichever one is next.`;
    this.content.appendChild(lengths);
    const phases = this.grid();
    phases.append(...DANGER_THREAT_IDS.map((threat) => this.numberField(
      `${DANGER_THREAT_NAMES[threat]} phase (seconds)`,
      raid.dangerPhaseSecondsByThreat[threat],
      (v) => { raid.dangerPhaseSecondsByThreat[threat] = v; },
      1,
    )));
    this.content.appendChild(phases);

    this.content.appendChild(this.subheading('Timing & exposure'));
    const timing = this.grid();
    timing.append(
      this.numberField('Safe phase (seconds)', raid.safePhaseSeconds, (v) => { raid.safePhaseSeconds = v; }, 1),
      this.numberField('Raider spawn delay (seconds)', raid.spawnDelaySeconds, (v) => { raid.spawnDelaySeconds = v; }, 0),
      this.numberField('Grace before exposure (seconds)', raid.graceSeconds, (v) => { raid.graceSeconds = v; }, 0),
      this.numberField('Exposure HP/s at first', raid.exposureDamagePerSecond, (v) => { raid.exposureDamagePerSecond = v; }, 0),
      this.numberField('Exposure ramp HP/s', raid.exposureRampPerSecond, (v) => { raid.exposureRampPerSecond = v; }, 0),
      this.numberField('Exposure HP/s maximum', raid.exposureMaxDamagePerSecond, (v) => { raid.exposureMaxDamagePerSecond = v; }, 0),
    );
    this.content.appendChild(timing);

    this.content.appendChild(this.subheading('Wave size'));
    const wave = this.grid();
    wave.append(
      this.numberField('Raiders in the first wave', raid.waveBaseSize, (v) => { raid.waveBaseSize = v; }, 1),
      this.numberField('Maximum raiders per wave', raid.waveMaxSize, (v) => { raid.waveMaxSize = v; }, 1),
      this.numberField('Extra raiders per cycle (tenths)', raid.waveGrowthTenths, (v) => { raid.waveGrowthTenths = v; }, 0),
      this.numberField('Extra per Homestead Rating (tenths)', raid.waveRatingTenths, (v) => { raid.waveRatingTenths = v; }, 0),
      this.selectField('Target priority', raid.targetPriority, ['purifier-last', 'purifier-first', 'nearest', 'player-first'], (v) => {
        raid.targetPriority = v as RaidTargetPriority;
      }),
    );
    this.content.appendChild(wave);

    this.renderArcaneStormValues();

    this.content.append(this.heading('Raiders'));
    for (const definition of RAIDER_DEFINITIONS) {
      const editable = this.draft.gameBalance.raiders[definition.kindId];
      const details = this.details(definition.displayName, `${editable.maxHp} HP · ${editable.damage} damage`);
      const body = details.querySelector('[data-body]')!;
      const note = div({ marginTop: '8px', fontSize: '12px', opacity: '0.72', lineHeight: '1.45' });
      // The level 2 row is the sanity read: the multiplier is entered in basis
      // points, and seeing what a single level actually buys is faster than
      // doing the arithmetic to find out that 250 was a typo for 2500.
      const refresh = (): void => {
        const bps = editable.levelMultiplierBps;
        note.textContent = `Hits about every ${(editable.attackCooldownTicks / TICKS_PER_SECOND).toFixed(1)}s`
          + ` · ${Math.floor(editable.damage * editable.wallDamagePercent / 100)} damage against walls`
          + ` · worth ${raiderBounty(editable)} coins`
          + ` · chases from ${(editable.aggroRangePx / TILE_SIZE).toFixed(1)} tiles`
          + ` · level 2: ${scaleByLevel(editable.maxHp, 2, bps)} HP`
          + `, ${scaleByLevel(editable.playerDamage, 2, bps)} damage to you`
          + `, ${raiderBounty({ maxHp: scaleByLevel(editable.maxHp, 2, bps) })} coins`;
      };
      const values = this.grid();
      values.append(
        this.numberField('Max HP', editable.maxHp, (v) => { editable.maxHp = v; refresh(); }, 1),
        this.numberField('Speed (px/tick)', editable.speedPxPerTick, (v) => { editable.speedPxPerTick = v; }, 1),
        this.numberField('Damage per hit', editable.damage, (v) => { editable.damage = v; refresh(); }, 0),
        this.numberField('Damage to you', editable.playerDamage, (v) => { editable.playerDamage = v; refresh(); }, 0),
        this.numberField('Attack cooldown (ticks)', editable.attackCooldownTicks, (v) => { editable.attackCooldownTicks = v; refresh(); }, 1),
        this.numberField('Wall damage (%)', editable.wallDamagePercent, (v) => { editable.wallDamagePercent = v; refresh(); }, 0),
        this.numberField('First raid it appears', editable.unlockCycle, (v) => { editable.unlockCycle = v; }, 0),
        this.numberField('Aggro range (px, 0 = never)', editable.aggroRangePx, (v) => { editable.aggroRangePx = v; refresh(); }, 0),
        this.numberField('Level Multiplier (bps)', editable.levelMultiplierBps, (v) => { editable.levelMultiplierBps = v; refresh(); }, 0),
      );
      body.appendChild(values);
      refresh();
      body.appendChild(note);
      this.content.appendChild(details);
    }

    this.content.append(this.heading('Defences'));
    const defense = this.draft.gameBalance.defense;
    const defenceValues = this.grid();
    defenceValues.append(
      this.numberField('Turret damage', defense.turretDamage, (v) => { defense.turretDamage = v; }, 0),
      this.numberField('Turret cooldown (ticks)', defense.turretCooldownTicks, (v) => { defense.turretCooldownTicks = v; }, 1),
      this.numberField('Turret range (tiles)', defense.turretRangeTiles, (v) => { defense.turretRangeTiles = v; }, 1),
      this.numberField('Turret arrow capacity', defense.turretAmmoCapacity, (v) => { defense.turretAmmoCapacity = v; }, 1),
      this.numberField('Turret shots when away', defense.turretAbsentRoundShots, (v) => { defense.turretAbsentRoundShots = v; }, 0),
      this.numberField('Your shot damage', defense.playerShotDamage, (v) => { defense.playerShotDamage = v; }, 0),
      this.numberField('Your shot cooldown (ticks)', defense.playerShotCooldownTicks, (v) => { defense.playerShotCooldownTicks = v; }, 1),
      this.numberField('Raider aggro range (tiles)', defense.raiderAggroRangeTiles, (v) => { defense.raiderAggroRangeTiles = v; }, 1),
      this.numberField('Roamer leash (tiles)', defense.roamerLeashTiles, (v) => { defense.roamerLeashTiles = v; }, 1),
      this.numberField('Roamers per area', defense.roamersPerArea, (v) => { defense.roamersPerArea = v; }, 0),
      this.numberField('Roamer respawn (ticks)', defense.roamerRespawnTicks, (v) => { defense.roamerRespawnTicks = v; }, 1),
    );
    this.content.appendChild(defenceValues);

    this.renderWorldValues();

    this.content.append(this.heading('Structure health'));
    const structures = this.draft.gameBalance.structures;
    const structureValues = this.grid();
    for (const material of WALL_MATERIAL_IDS) {
      structureValues.appendChild(this.numberField(`${this.pretty(material)} wall HP`, structures.wallHp[material], (v) => {
        structures.wallHp[material] = v;
      }, 1));
    }
    for (const id of STRUCTURE_FACILITY_IDS) {
      structureValues.appendChild(this.numberField(`${this.pretty(id)} HP`, structures.facilityHp[id], (v) => {
        structures.facilityHp[id] = v;
      }, 1));
    }
    this.content.appendChild(structureValues);
  }

  /**
   * How far out the world gets dangerous, and how thickly it is stocked.
   *
   * Kept as its own section rather than folded into Defences because it is the
   * one place the difficulty curve is described: these four numbers decide what
   * level a player meets where, and everything else on the page only decides
   * what a given level is worth.
   */
  private renderWorldValues(): void {
    const world = this.draft.gameBalance.world;
    this.content.append(this.heading('Enemy levels & population'));
    const help = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    const summary = div({ margin: '8px 0 0', opacity: '0.72', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'Levels come from distance, never from your character level: every band of tiles out from '
      + 'the middle of an area adds one, and every ring of areas away from home adds more on top. '
      + 'A creature or raider is stamped with its level when it spawns and keeps it — changing these '
      + 'values re-ranks what generates next, not what is already standing in the world.';
    this.content.appendChild(help);

    const refresh = (): void => {
      // The far corner is the number worth seeing: it is what a player actually
      // walks into at the edge of the home area, and it moves fast when the
      // band tiles are tightened.
      const halfDiagonalTiles = Math.round(Math.hypot(WORLD_PX / 2, WORLD_PX / 2) / TILE_SIZE);
      const corner = Math.min(
        Math.max(1, world.maxEnemyLevel),
        1 + Math.floor(halfDiagonalTiles / Math.max(1, world.levelBandTiles)),
      );
      summary.textContent = `Town is level 1 · the far corner of the home area is level ${corner}`
        + ` · one ring out adds ${world.levelsPerAreaRing}`
        + ` · nothing ever passes level ${world.maxEnemyLevel}`;
    };

    const values = this.grid();
    values.append(
      this.numberField('Tiles per level band', world.levelBandTiles, (v) => { world.levelBandTiles = v; refresh(); }, 1),
      this.numberField('Levels per area ring', world.levelsPerAreaRing, (v) => { world.levelsPerAreaRing = v; refresh(); }, 0),
      this.numberField('Maximum enemy level', world.maxEnemyLevel, (v) => { world.maxEnemyLevel = v; refresh(); }, 1),
      this.numberField('Creatures per area', world.creaturesPerArea, (v) => { world.creaturesPerArea = v; }, 0),
    );
    this.content.appendChild(values);
    refresh();
    this.content.appendChild(summary);
  }

  /** Wild-creature battle stats; identity, abilities, and roles stay in content. */
  private renderCreatureValues(): void {
    this.content.append(this.heading('Creatures'));
    const help = div({ margin: '0 0 10px', opacity: '0.76', fontSize: '12px', lineHeight: '1.45' });
    help.textContent = 'Battle stats for wild creatures. Tame ease and dodge are basis points, where 10000 is 100%. '
      + 'Already-tamed companions keep the species stats, so these apply to both sides of a battle. '
      + 'Level Multiplier is what one level adds, also in basis points: 2500 is a quarter of base per level, '
      + 'applied to health and damage only — a levelled creature is a longer fight, never a faster one.';
    this.content.appendChild(help);

    for (const definition of CREATURE_DEFINITIONS) {
      const editable = this.draft.gameBalance.creatures[definition.speciesId];
      const details = this.details(definition.displayName, `${definition.temperament} · ${editable.maxHp} HP`);
      const body = details.querySelector('[data-body]')!;
      const note = div({ marginTop: '8px', fontSize: '12px', opacity: '0.72', lineHeight: '1.45' });
      const refresh = (): void => {
        const bps = editable.levelMultiplierBps;
        note.textContent = editable.aggroRangePx > 0
          ? `Chases from ${(editable.aggroRangePx / TILE_SIZE).toFixed(1)} tiles`
            + ` · level 2: ${scaleByLevel(editable.maxHp, 2, bps)} HP,`
            + ` ${scaleByLevel(editable.attackPower, 2, bps)} attack`
          : `Never attacks unprovoked · level 2: ${scaleByLevel(editable.maxHp, 2, bps)} HP,`
            + ` ${scaleByLevel(editable.attackPower, 2, bps)} attack`;
      };
      const values = this.grid();
      values.append(
        this.numberField('Max HP', editable.maxHp, (v) => { editable.maxHp = v; refresh(); }, 1),
        this.numberField('Attack power', editable.attackPower, (v) => { editable.attackPower = v; refresh(); }, 0),
        this.numberField('Defense', editable.defense, (v) => { editable.defense = v; }, 0),
        this.numberField('Tame ease (bps)', editable.tameEaseBps, (v) => { editable.tameEaseBps = v; }, 0, 10_000),
        this.numberField('Dodge chance (bps)', editable.dodgeBps, (v) => { editable.dodgeBps = v; }, 0, 10_000),
        this.numberField('Move speed', editable.moveSpeed, (v) => { editable.moveSpeed = v; }, 1),
        this.numberField('Attack range', editable.attackRange, (v) => { editable.attackRange = v; }, 1),
        this.numberField('World speed (px/tick)', editable.speedPxPerTick, (v) => { editable.speedPxPerTick = v; }, 1),
        this.numberField('World attack range (px)', editable.attackRangePx, (v) => { editable.attackRangePx = v; }, 1),
        this.numberField('Attack interval (ticks)', editable.attackIntervalTicks, (v) => { editable.attackIntervalTicks = v; }, 1),
        this.numberField('Aggro range (px, 0 = never)', editable.aggroRangePx, (v) => { editable.aggroRangePx = v; refresh(); }, 0),
        this.numberField('Leash (px)', editable.leashPx, (v) => { editable.leashPx = v; }, 1),
        this.numberField('Kite distance (px)', editable.preferredRangePx, (v) => { editable.preferredRangePx = v; }, 0),
        this.numberField('Level Multiplier (bps)', editable.levelMultiplierBps, (v) => { editable.levelMultiplierBps = v; refresh(); }, 0),
      );
      body.appendChild(values);
      refresh();
      body.appendChild(note);
      this.content.appendChild(details);
    }
  }

  private targetEditor(
    kind: StrikeTarget,
    initialDamage: number,
    initialWear: number,
    set: (damage: number, wear: number) => void,
    showWear = true,
  ): HTMLElement {
    const row = div({ display: 'grid', gridTemplateColumns: 'minmax(145px, 1.2fr) 1fr 1fr', gap: '8px', alignItems: 'end', marginTop: '8px', padding: '9px', borderRadius: '9px', background: 'rgba(255,255,255,0.045)' });
    let damage = initialDamage; let wear = initialWear;
    const enabled = this.checkboxField(TARGET_LABELS[kind], damage > 0, (checked) => {
      damage = checked ? Math.max(1, damage) : 0;
      if (checked) wear = Math.max(1, wear);
      damageInput.value = String(damage); wearInput.value = String(wear);
      damageInput.disabled = !checked; wearInput.disabled = !checked || !showWear;
      set(damage, wear);
    });
    const damageField = this.numberField('Damage', damage, (v) => { damage = v; set(damage, wear); }, 0);
    const damageInput = damageField.querySelector('input')!;
    const wearField = this.numberField('Wear multiplier', wear, (v) => { wear = v; set(damage, wear); }, 0);
    const wearInput = wearField.querySelector('input')!;
    damageInput.disabled = damage <= 0;
    wearInput.disabled = damage <= 0 || !showWear;
    if (!showWear) wearField.style.visibility = 'hidden';
    row.append(enabled, damageField, wearField);
    return row;
  }

  private renderFirebaseAccess(): void {
    const card = div({ margin: '0 0 12px', padding: '10px', borderRadius: '9px', background: 'rgba(255,255,255,0.055)', display: 'grid', gap: '8px' });
    const source = this.globalBalance.source === 'local-fallback'
      ? 'Local last-known-good fallback (Firebase not loaded)'
      : `${this.globalBalance.source === 'firebase' ? 'Firebase' : 'Firebase offline cache'} revision ${this.globalBalance.revision}`;
    const summary = div({ fontSize: '12px', lineHeight: '1.45', color: '#c9d6cc' });
    summary.textContent = `Global source: ${source}`;
    // `load` reports the failure that chose the source; without it a timeout, a
    // missing config, and a document that failed validation all look identical.
    const detail = div({
      fontSize: '11px', lineHeight: '1.4',
      color: this.globalBalance.source === 'local-fallback' ? '#ffbd9c' : 'rgba(201,214,204,0.72)',
    });
    detail.textContent = this.globalBalance.detail;
    const summaryText = div({ display: 'grid', gap: '3px', flex: '1', minWidth: '190px' });
    summaryText.append(summary, detail);
    const reload = uiButton('Reload from Firebase', () => { void this.reloadGlobal(reload); });
    reload.style.minHeight = '38px';
    reload.dataset.testid = 'admin-reload-global';
    const summaryRow = div({ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' });
    summaryRow.append(summaryText, reload);
    card.appendChild(summaryRow);

    if (!this.globalBalance.configured) {
      const warning = div({ color: '#ffbd9c', fontSize: '12px' });
      warning.textContent = 'Firebase web configuration is missing. Add the VITE_FIREBASE_* values before publishing.';
      card.appendChild(warning);
    } else if (this.globalBalance.signedInEmail) {
      const row = div({ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' });
      const identity = div({ flex: '1', fontSize: '12px' });
      identity.textContent = `Signed in as ${this.globalBalance.signedInEmail}`;
      const signOut = uiButton('Sign out', () => {
        void this.globalBalance.signOut().then(() => { this.setStatus('Signed out', true); this.render(); });
      });
      row.append(identity, signOut); card.appendChild(row);
    } else {
      const form = div({ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(150px, 1fr) auto', gap: '8px', alignItems: 'end' });
      const email = this.textField('Admin email', 'email');
      const password = this.textField('Password', 'password');
      const signIn = uiButton('Sign in', () => {
        signIn.disabled = true;
        void this.globalBalance.signIn(email.input.value, password.input.value)
          .then(() => { this.setStatus('Admin signed in', true); this.render(); })
          .catch((error: unknown) => { this.setStatus(this.errorMessage(error), false); signIn.disabled = false; });
      });
      form.append(email.wrapper, password.wrapper, signIn); card.appendChild(form);
    }
    const previous = this.firebaseAccessCard;
    if (previous?.isConnected) {
      const hiddenDisplay = this.hiddenContent.get(previous);
      if (hiddenDisplay !== undefined) {
        this.hiddenContent.delete(previous);
        this.hiddenContent.set(card, hiddenDisplay);
        card.style.display = 'none';
      }
      previous.replaceWith(card);
    } else this.content.prepend(card);
    this.firebaseAccessCard = card;
  }

  /**
   * Re-run the boot-time global load so a stale tab can publish again. Publish
   * compares the revision this tab loaded against the live document, and `load`
   * is the only thing that moves that number, so without this the sole cure for
   * "Firebase is at revision N" is a full page reload.
   */
  private async reloadGlobal(reload: HTMLButtonElement): Promise<void> {
    reload.disabled = true;
    this.pushButton.disabled = true;
    this.setStatus('Reloading global values from Firebase…', true);
    try {
      // The live balance is the fallback so a failed reload leaves the running
      // game on the values it already had.
      const loaded = await this.globalBalance.load(this.state.gameBalance);
      if (loaded.source === 'local-fallback') {
        this.setStatus(`Firebase reload failed: ${loaded.detail}`, false);
        return;
      }
      const applied = applyGameBalance(this.state, loaded.values);
      if (!applied.ok) throw new Error(applied.message);
      this.previewCamera(this.state.gameBalance.camera);
      // Staged global edits were made against the revision just replaced;
      // republishing them would overwrite whoever moved the document. Local
      // staged edits are independent of the global document, so they survive.
      this.draft.gameBalance = createAdminDraft(this.state).gameBalance;
      this.onPushed();
      this.setStatus(`${loaded.detail} · staged global edits were discarded`, true);
    } catch (error) {
      this.setStatus(this.errorMessage(error), false);
    } finally {
      this.pushButton.disabled = false;
      this.render();
    }
  }

  private async push(): Promise<void> {
    if (this.activeView === 'local') {
      const result = applyLocalAdminUpdate(this.state, this.draft);
      this.setStatus(result.message, result.ok);
      if (!result.ok) return;
      this.draft = createAdminDraft(this.state);
      this.onPushed();
      this.render();
      return;
    }

    const validationError = validateGameBalance(this.draft.gameBalance);
    if (validationError) { this.setStatus(validationError, false); return; }
    this.pushButton.disabled = true;
    this.setStatus('Publishing global values to Firebase…', true);
    try {
      const revision = await this.globalBalance.publish(this.draft.gameBalance);
      const applied = applyGameBalance(this.state, this.draft.gameBalance);
      if (!applied.ok) throw new Error(applied.message);
      this.previewCamera(this.state.gameBalance.camera);
      this.draft = createAdminDraft(this.state);
      this.onPushed();
      this.setStatus(`Firebase revision ${revision} published and applied`, true);
      this.render();
    } catch (error) {
      this.setStatus(this.errorMessage(error), false);
    } finally {
      this.pushButton.disabled = false;
    }
  }

  private textField(label: string, type: 'email' | 'password'): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
    const wrapper = document.createElement('label');
    Object.assign(wrapper.style, { display: 'grid', gap: '5px', fontSize: '12px', color: 'rgba(232,240,234,0.8)' });
    const input = document.createElement('input');
    input.type = type; input.autocomplete = type === 'email' ? 'username' : 'current-password';
    Object.assign(input.style, this.inputStyle());
    wrapper.append(label, input);
    return { wrapper, input };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Firebase operation failed';
  }

  private weightField(label: string, hundredths: number, set: (value: number) => void, min = 0): HTMLLabelElement {
    return this.scaledField(label, hundredths, BAG_WEIGHT_SCALE, set, min);
  }

  /**
   * A decimal editor over a fixed-point value. The field shows and accepts the
   * number the player is promised — 0.25 health a second — while what is staged
   * stays the whole number the save has to hold.
   */
  private scaledField(label: string, stored: number, scale: number, set: (value: number) => void, min = 0): HTMLLabelElement {
    return this.numberField(label, stored / scale, (value) => {
      set(Math.round(value * scale));
    }, min, 9_999_999, 1 / scale);
  }

  private numberField(label: string, value: number, set: (value: number) => void, min: number, max = 999_999_999, step = 1): HTMLLabelElement {
    const wrapper = document.createElement('label');
    Object.assign(wrapper.style, { display: 'grid', gap: '5px', minWidth: '0', fontSize: '12px', color: 'rgba(232,240,234,0.8)' });
    const input = document.createElement('input');
    input.type = 'number'; input.step = String(step); input.min = String(min); input.max = String(max); input.value = String(value);
    Object.assign(input.style, this.inputStyle());
    input.addEventListener('input', () => { if (input.value !== '') set(Number(input.value)); });
    wrapper.append(label, input);
    return wrapper;
  }

  private selectField(label: string, value: string, options: readonly string[], set: (value: string) => void): HTMLLabelElement {
    const wrapper = document.createElement('label');
    Object.assign(wrapper.style, { display: 'grid', gap: '5px', fontSize: '12px', color: 'rgba(232,240,234,0.8)' });
    const select = document.createElement('select');
    Object.assign(select.style, this.inputStyle());
    for (const option of options) { const element = document.createElement('option'); element.value = option; element.textContent = this.pretty(option); select.appendChild(element); }
    select.value = value; select.addEventListener('change', () => set(select.value));
    wrapper.append(label, select); return wrapper;
  }

  private checkboxField(label: string, checked: boolean, set: (checked: boolean) => void): HTMLLabelElement {
    const wrapper = document.createElement('label');
    Object.assign(wrapper.style, { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '42px', padding: '6px 9px', boxSizing: 'border-box', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', background: 'rgba(255,255,255,0.035)', fontSize: '12px' });
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', () => set(input.checked)); wrapper.append(input, label); return wrapper;
  }

  /**
   * A collapsible card, remembering whether it was open.
   *
   * The panel rebuilds its whole content on render, and it renders again when
   * Firebase auth settles — which used to slam every open card shut underneath
   * whoever was reading it. The open set is keyed by title, so a card reopens
   * itself wherever it lands in the rebuilt list.
   */
  private details(title: string, summary: string): HTMLDetailsElement {
    const details = document.createElement('details');
    Object.assign(details.style, { marginTop: '8px', border: '1px solid rgba(255,255,255,0.13)', borderRadius: '10px', background: 'rgba(255,255,255,0.035)', overflow: 'hidden' });
    const heading = document.createElement('summary'); heading.textContent = `${title} · ${summary}`;
    Object.assign(heading.style, { cursor: 'pointer', padding: '12px', fontWeight: '700', touchAction: 'manipulation' });
    const body = div({ padding: '0 12px 12px' }); body.dataset['body'] = '';
    details.append(heading, body);
    details.open = this.openDetails.has(title);
    details.addEventListener('toggle', () => {
      if (details.open) this.openDetails.add(title); else this.openDetails.delete(title);
    });
    return details;
  }

  private grid(): HTMLDivElement { return div({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '9px' }); }
  private heading(label: string): HTMLDivElement { const h = this.subheading(label); h.style.marginTop = this.content.childElementCount === 0 ? '0' : '20px'; h.style.color = '#ffe08a'; return h; }
  private subheading(label: string): HTMLDivElement { const h = div({ margin: '14px 0 8px', fontSize: '12px', fontWeight: '800', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(232,240,234,0.7)' }); h.textContent = label; return h; }
  private inputStyle(): Partial<CSSStyleDeclaration> { return { width: '100%', minHeight: '40px', padding: '8px', boxSizing: 'border-box', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '7px', background: '#18271e', color: '#f2f6f3', font: '14px system-ui, sans-serif' }; }
  private pretty(value: string): string { return value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  private setStatus(message: string, ok: boolean): void { this.status.textContent = message; this.status.style.color = ok ? '#b9dfc2' : '#ffb3a7'; }
  destroy(): void {
    if (this.systemTimer !== undefined) window.clearInterval(this.systemTimer);
    if (this.peekTimer !== undefined) window.clearTimeout(this.peekTimer);
    this.button.remove();
    this.root.remove();
  }
}
