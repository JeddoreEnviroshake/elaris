import {
  BUILDABLES,
  buildableLockedReason,
  describeBuildable,
  missingCost,
  type BuildableId,
  type PlacementCheck,
} from '../scenes/buildPlacement';
import type { BuildingState, GameState } from '../simulation/state';
import type { EnvironmentKind } from '../simulation/state';
import { buildableById } from '../content/buildingParts';
import { demolitionRefund } from '../simulation/gameplayCommands';
import { AREA_TIERS } from '../config/areaGates';
import { RAIL_BOTTOMS, div, railButton, uiButton, wireDisclosure } from './controls';
import { stockedCostText } from './costs';
import type { PlacementShape } from '../simulation/batchBuilding';
import type { BatchPreview } from '../scenes/buildMode';

export interface BuildMenuActions {
  onShapeChanged?: (shape: PlacementShape) => void;
  /** A palette entry was chosen; the scene spawns the placement ghost. */
  onStartPlacing: (id: BuildableId) => void;
  /** The Place button was pressed; the scene confirms at the ghost tile. */
  onConfirm: () => void;
  onRotate: () => void;
  onUndo: () => void;
  onMarkerKindChanged: (kind: EnvironmentKind) => void;
  /** Placement was cancelled from the UI; the scene removes the ghost. */
  onPlacingCancelled: () => void;
  /** Delete mode was entered; the scene lights the nearest placed part. */
  onStartDeleting: () => void;
  /** The Delete button was pressed; the scene demolishes the lit part. */
  onDeleteConfirm: () => void;
  /** Delete mode was left; the scene drops the red cursor. */
  onDeletingCancelled: () => void;
  /** The palette opened; the scene brings the Craft tab that hosts it forward. */
  onOpened: () => void;
}

/** The Craft tab hosts the build palette; see GameplayHud.mountBuildSection. */
export interface BuildSectionHost {
  mountBuildSection: (section: HTMLElement, onCraftTabOpened: () => void) => void;
}

export type BuildMenuMode = 'closed' | 'palette' | 'placing' | 'deleting';

/**
 * Palette grouping is presentation only: players shop by where a part goes,
 * not by the occupancy layer the simulation stores it on.
 */
const CATEGORY_HEADINGS = {
  indoor: 'Indoor',
  outdoor: 'Outdoor',
  utilities: 'Utilities',
  facilities: 'Facilities',
} as const;

type PaletteCategory = keyof typeof CATEGORY_HEADINGS;

const CATEGORY_ORDER = Object.keys(CATEGORY_HEADINGS) as PaletteCategory[];

/**
 * Material families drive the quick-swap row. Picking Thatch Wall almost
 * always means the next few parts are Thatch too — floor, door, fence — so
 * those siblings ride along on the action bar instead of costing a trip back
 * through the Craft tab for each one.
 */
const MATERIALS = ['thatch', 'wood', 'stone', 'metal'] as const;

function materialOf(id: BuildableId): (typeof MATERIALS)[number] | null {
  return MATERIALS.find((material) => id.startsWith(`${material}-`)) ?? null;
}

/** Thumb-sized and pinned to the bottom-right stack. */
function thumbButton(button: HTMLButtonElement, size: number, bottom: string, right: string): HTMLButtonElement {
  Object.assign(button.style, {
    position: 'absolute',
    right: `calc(env(safe-area-inset-right) + ${right})`,
    bottom: `calc(env(safe-area-inset-bottom) + ${bottom})`,
    width: `${size}px`,
    height: `${size}px`,
    minWidth: '0',
    minHeight: '0',
    padding: '4px',
    fontSize: '12px',
    fontWeight: '600',
  } satisfies Partial<CSSStyleDeclaration>);
  return button;
}

/**
 * The pixel-art theme sets button colours with `!important`, so the selected
 * chip has to shout at the same volume to be seen at all.
 */
function markSelected(button: HTMLButtonElement, selected: boolean): void {
  if (!selected) return;
  button.style.setProperty('background', 'linear-gradient(#e2c15a, #c39d33)', 'important');
  button.style.setProperty('color', '#14210f', 'important');
  button.style.setProperty('border-color', '#fff0a8', 'important');
}

/** "Thatch Wall" reads as "Wall" once the row itself is all one material. */
function shortName(displayName: string): string {
  for (const material of MATERIALS) {
    const prefix = `${material[0]!.toUpperCase()}${material.slice(1)} `;
    if (displayName.startsWith(prefix)) return displayName.slice(prefix.length);
  }
  return displayName;
}

/** Standalone props and small stations; the larger yards/sheds are Facilities. */
const UTILITY_FACILITY_IDS = new Set<BuildableId>([
  'field-cache',
  'workbench',
  'furnace',
  'farm-counter',
  'bed',
  'air-purifier',
  'garden-bed',
  'woodlot-planter',
  'war-table',
  'turret',
]);

function paletteCategory(def: (typeof BUILDABLES)[number]): PaletteCategory {
  if (def.surfaceKind) return def.surfaceKind === 'floor' ? 'indoor' : 'outdoor';
  if (def.boundaryClass) {
    return def.boundaryClass === 'wall' || def.boundaryClass === 'door' ? 'indoor' : 'outdoor';
  }
  // Bridges and water shape the open world, so they sit with the outdoor parts.
  if (def.footprintKind === 'landscape') return 'outdoor';
  return UTILITY_FACILITY_IDS.has(def.id) ? 'utilities' : 'facilities';
}

/**
 * DOM side of build mode: the structure palette (now a section of the merged
 * Craft tab) and the placement action bar. Placement is aim-then-build: a
 * world tap and the d-pad both only move the ghost, Place is the single thing
 * that spends materials, and Undo restores the full cost.
 *
 * The palette lists owned blueprints only. Locked structures live in the
 * Blueprints tab, which lists every blueprint the game holds.
 */
export class BuildMenu {
  private readonly root: HTMLDivElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly palette: HTMLDivElement;
  private readonly entries = new Map<BuildableId, HTMLButtonElement>();
  private readonly entryDetails = new Map<BuildableId, HTMLDivElement>();
  private readonly entryCosts = new Map<BuildableId, HTMLSpanElement>();
  private readonly sections: Array<{ heading: HTMLDivElement; ids: BuildableId[] }> = [];
  private readonly points: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly actionBar: HTMLDivElement;
  private readonly buttonCluster: HTMLDivElement;
  private readonly placingTitle: HTMLDivElement;
  private readonly quickRow: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly placeButton: HTMLButtonElement;
  private readonly rotateButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly markerKind: HTMLSelectElement;
  private readonly deleteModeButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private currentMode: BuildMenuMode = 'closed';
  private placingId: BuildableId | null = null;
  private embedded = false;
  private readonly shapeSelect: HTMLSelectElement;
  private batchPreview: BatchPreview | null = null;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: BuildMenuActions,
  ) {
    this.root = div({ position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '12' });

    this.buildButton = railButton('build', 'Build', () => this.toggle());
    this.buildButton.style.bottom = RAIL_BOTTOMS.build;

    this.palette = div({
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 94px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 94px)',
      width: 'min(280px, calc(100vw - 120px))',
      maxHeight: '46vh',
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
    this.palette.setAttribute('aria-label', 'Build palette');
    this.palette.setAttribute('role', 'group');
    wireDisclosure(this.buildButton, this.palette, 'build-palette');
    const heading = document.createElement('strong');
    heading.textContent = 'Build';
    this.points = div({ marginTop: '4px', color: '#ffe08a', fontSize: '12px' });
    this.empty = div({ marginTop: '8px', fontSize: '12px', opacity: '0.72', display: 'none' });
    this.empty.textContent = 'No structure blueprints yet — level up or find one in the field.';
    // Removal is the other half of building, so it starts from the same palette
    // rather than from a hold on the exact structure the player wants gone.
    this.deleteModeButton = uiButton('Delete Mode', () => this.enterDeleteMode());
    this.deleteModeButton.dataset['deleteMode'] = '';
    this.deleteModeButton.title = 'Pick a placed structure with the d-pad and remove it';
    Object.assign(this.deleteModeButton.style, {
      display: 'block', width: '100%', marginTop: '10px', background: '#8b3434',
      color: '#fff1f1', fontWeight: '700',
    } satisfies Partial<CSSStyleDeclaration>);
    this.palette.append(heading, this.points, this.deleteModeButton, this.empty);
    const palettable = BUILDABLES.filter((candidate) => candidate.availableInPalette !== false);
    for (const category of CATEGORY_ORDER) {
      const members = palettable.filter((candidate) => paletteCategory(candidate) === category);
      if (members.length === 0) continue;
      const section = div({ marginTop: '12px', opacity: '0.65', font: '700 11px system-ui, sans-serif', textTransform: 'uppercase', letterSpacing: '0.6px' });
      section.textContent = CATEGORY_HEADINGS[category];
      this.palette.appendChild(section);
      const current = { heading: section, ids: [] as BuildableId[] };
      this.sections.push(current);
      for (const def of members) {
        current.ids.push(def.id);
        const entry = uiButton(def.displayName, () => this.select(def.id));
        Object.assign(entry.style, {
          display: 'block',
          width: '100%',
          minWidth: '0',
          marginTop: '10px',
          textAlign: 'left',
          background: 'rgba(30,48,37,0.94)',
          touchAction: 'pan-y',
        });
        entry.textContent = '';
        const title = div({ display: 'flex', justifyContent: 'space-between', gap: '10px' });
        const name = document.createElement('strong');
        name.textContent = def.displayName;
        // Filled by refreshAffordability so the carried amounts track the bag.
        const cost = document.createElement('span');
        cost.style.opacity = '0.85';
        this.entryCosts.set(def.id, cost);
        title.append(name, cost);
        const detail = div({ marginTop: '3px', opacity: '0.72', fontSize: '12px' });
        detail.textContent = describeBuildable(def.id);
        entry.append(title, detail);
        this.entries.set(def.id, entry);
        this.entryDetails.set(def.id, detail);
        this.palette.appendChild(entry);
      }
    }

    // The readout sits above the d-pad's corner rather than across the middle
    // of the screen: the tiles the player is aiming at are the one thing a
    // build UI must never cover.
    this.actionBar = div({
      position: 'absolute',
      left: '50%',
      bottom: 'calc(env(safe-area-inset-bottom) + 160px)',
      transform: 'translateX(-50%)',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '7px',
      pointerEvents: 'none',
    });
    // What is on the end of the d-pad right now, and what it will cost. The
    // palette that answered both is hidden while placing.
    this.placingTitle = div({
      padding: '5px 11px',
      borderRadius: '8px',
      background: 'rgba(9,20,14,0.9)',
      border: '1px solid rgba(255,255,255,0.16)',
      font: '700 13px system-ui, sans-serif',
      textAlign: 'center',
    });
    this.placingTitle.dataset.placingTitle = '';
    // One line that scrolls, not a wrapping block: a row that grows taller as
    // more of a material is unlocked would keep eating the view.
    this.quickRow = div({
      display: 'flex',
      gap: '6px',
      flexWrap: 'nowrap',
      overflowX: 'auto',
      overscrollBehavior: 'contain',
      justifyContent: 'flex-start',
      maxWidth: 'min(520px, calc(100vw - 24px))',
      padding: '2px',
      pointerEvents: 'auto',
    });
    this.quickRow.setAttribute('aria-label', 'Related parts');
    this.quickRow.setAttribute('role', 'group');
    this.hint = div({
      padding: '5px 10px',
      borderRadius: '8px',
      background: 'rgba(9,20,14,0.85)',
      font: '12px system-ui, sans-serif',
      whiteSpace: 'normal',
      textAlign: 'center',
      maxWidth: 'min(520px, calc(100vw - 24px))',
    });
    this.markerKind = document.createElement('select');
    this.markerKind.setAttribute('aria-label', 'Environment kind');
    Object.assign(this.markerKind.style, {
      minHeight: '44px', borderRadius: '8px', padding: '0 8px', display: 'none', pointerEvents: 'auto',
    });
    for (const [value, label] of [['indoor', 'Indoor'], ['workYard', 'Work Yard'], ['paddock', 'Paddock']] as const) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; this.markerKind.appendChild(option);
    }
    this.markerKind.addEventListener('change', () => actions.onMarkerKindChanged(this.markerKind.value as EnvironmentKind));
    this.shapeSelect = document.createElement('select');
    this.shapeSelect.setAttribute('aria-label', 'Placement shape');
    Object.assign(this.shapeSelect.style, { minHeight: '44px', pointerEvents: 'auto', font: 'inherit', padding: '6px 10px', borderRadius: '6px' });
    for (const [value, label] of [['single', 'Single part'], ['area', 'Floor area'], ['line', 'Wall line']]) {
      const option = document.createElement('option'); option.value = value!; option.textContent = label!; this.shapeSelect.append(option);
    }
    this.shapeSelect.addEventListener('change', () => this.actions.onShapeChanged?.(this.shapeSelect.value as PlacementShape));
    this.actionBar.append(this.placingTitle, this.quickRow, this.shapeSelect, this.hint, this.markerKind);

    /**
     * One thumb per job. The d-pad owns the bottom-left, so the placement
     * controls take the bottom-right — the exact circles Gather and Sprint
     * vacate on entering build mode, so Place lands under the thumb that was
     * already there.
     */
    this.buttonCluster = div({ position: 'absolute', inset: '0', display: 'none', pointerEvents: 'none' });
    // Cancel leaves build mode and returns directly to normal gameplay.
    const cancel = uiButton('Cancel', () => this.close());
    this.undoButton = uiButton('Undo', actions.onUndo);
    this.undoButton.disabled = true;
    this.undoButton.title = 'Undo the latest placement and restore its full cost';
    this.rotateButton = uiButton('Rotate', actions.onRotate);
    this.rotateButton.title = 'Rotate the placement (R)';
    this.placeButton = uiButton('Place', actions.onConfirm);
    thumbButton(this.placeButton, 72, '34px', '18px');
    Object.assign(this.placeButton.style, { fontWeight: '700', fontSize: '14px' });
    markSelected(this.placeButton, true);
    // Delete takes the same thumb circle Place owns, since the two modes never
    // run at once and the commit should always be under the same finger.
    this.deleteButton = uiButton('Delete', actions.onDeleteConfirm);
    this.deleteButton.dataset['deleteStructure'] = '';
    thumbButton(this.deleteButton, 72, '34px', '18px');
    Object.assign(this.deleteButton.style, {
      display: 'none', fontWeight: '700', fontSize: '14px',
      background: '#8b3434', color: '#fff1f1',
    } satisfies Partial<CSSStyleDeclaration>);
    thumbButton(this.rotateButton, 58, '42px', '100px');
    thumbButton(cancel, 58, '120px', '18px');
    thumbButton(this.undoButton, 58, '120px', '100px');
    this.buttonCluster.append(this.undoButton, this.rotateButton, cancel, this.placeButton, this.deleteButton);

    this.root.append(this.buildButton, this.palette, this.actionBar, this.buttonCluster);
    parent.appendChild(this.root);
  }

  get mode(): BuildMenuMode {
    return this.currentMode;
  }

  /**
   * Move the palette into the Craft tab, which now owns both making surfaces;
   * the placement controls stay in-world.
   */
  attachToMenu(host: BuildSectionHost): void {
    this.buildButton.remove();
    this.embedded = true;
    Object.assign(this.palette.style, {
      position: 'static', right: 'auto', bottom: 'auto', width: 'auto', maxHeight: 'none',
      overflowY: 'visible', marginTop: '20px', padding: '0', borderRadius: '0',
      background: 'transparent', border: '0', boxShadow: 'none', display: 'block',
    } satisfies Partial<CSSStyleDeclaration>);
    host.mountBuildSection(this.palette, () => this.openEmbeddedPalette());
  }

  /** Tell the scene to drop whatever the previous mode had out in the world. */
  private leaveActiveMode(): void {
    if (this.currentMode === 'placing') this.actions.onPlacingCancelled();
    else if (this.currentMode === 'deleting') this.actions.onDeletingCancelled();
  }

  private openEmbeddedPalette(): void {
    this.leaveActiveMode();
    this.currentMode = 'palette';
    this.placingId = null;
    this.refreshAffordability();
    this.actionBar.style.display = 'none';
    this.buttonCluster.style.display = 'none';
  }

  /** Build button / B key: closed → palette; anything open → fully closed. */
  toggle(): void {
    if (this.currentMode === 'closed') this.openPalette();
    else this.close();
  }

  openPalette(): void {
    this.leaveActiveMode();
    this.currentMode = 'palette';
    this.placingId = null;
    this.refreshAffordability();
    this.palette.style.display = 'block';
    this.actionBar.style.display = 'none';
    this.buttonCluster.style.display = 'none';
    this.buildButton.setAttribute('aria-expanded', 'true');
    this.actions.onOpened();
  }

  /** Esc / toggle-off: leave build mode entirely, cancelling any ghost. */
  close(): void {
    this.leaveActiveMode();
    this.currentMode = 'closed';
    this.placingId = null;
    // Embedded, the palette's visibility belongs to the Craft tab that hosts it.
    if (!this.embedded) this.palette.style.display = 'none';
    this.actionBar.style.display = 'none';
    this.buttonCluster.style.display = 'none';
    this.buildButton.setAttribute('aria-expanded', 'false');
  }

  /**
   * Delete mode reuses the placement furniture wholesale: the readout names
   * what is lit, the d-pad steers between placed parts instead of tiles, and
   * the thumb circle under Place becomes the only thing that demolishes.
   *
   * Public because a hold on a placed part in the world drops straight in here,
   * not only the palette's own button.
   */
  enterDeleteMode(): void {
    this.shapeSelect.style.display = 'none';
    this.leaveActiveMode();
    this.currentMode = 'deleting';
    this.placingId = null;
    if (!this.embedded) this.palette.style.display = 'none';
    this.buildButton.setAttribute('aria-expanded', 'false');
    this.actionBar.style.display = 'flex';
    this.buttonCluster.style.display = 'block';
    this.quickRow.style.display = 'none';
    this.markerKind.style.display = 'none';
    this.rotateButton.style.display = 'none';
    this.undoButton.style.display = 'none';
    this.placeButton.style.display = 'none';
    this.deleteButton.style.display = 'block';
    this.actions.onStartDeleting();
  }

  /** Name the lit structure and what demolishing it hands back. */
  setDeleteTarget(building: BuildingState | null): void {
    if (this.currentMode !== 'deleting') return;
    this.deleteButton.disabled = building === null;
    if (!building) {
      this.placingTitle.textContent = 'Nothing placed nearby';
      this.hint.textContent = 'Build something first — there is nothing to remove';
      this.hint.style.color = '#ffd18a';
      return;
    }
    const def = buildableById(building.definitionId);
    const refund = demolitionRefund(def)
      .map(([resource, amount]) => `+${amount} ${resource}`)
      .join(' · ');
    this.placingTitle.textContent = refund ? `${def.displayName} · ${refund}` : def.displayName;
    this.hint.textContent = 'D-pad picks the next part · Delete removes it';
    this.hint.style.color = '#e8f0ea';
  }

  /** Reflect ghost validity on the Place button and hint line. */
  setValidity(check: PlacementCheck): void {
    this.placeButton.disabled = !check.ok;
    if (check.ok) {
      this.hint.textContent = this.batchPreview
        ? this.batchPreview.anchored ? 'Aim the group · total cost shown above · Build commits the whole group' : 'Aim first corner · Set start · aim opposite corner · Build commits'
        : 'D-pad nudges · drag it to walk · Place builds';
      this.hint.style.color = '#e8f0ea';
    } else {
      this.hint.textContent = check.message;
      this.hint.style.color = '#ffd18a';
    }
  }

  setUndoAvailable(available: boolean): void {
    this.undoButton.disabled = !available;
  }

  beginPlacement(id: BuildableId): void { this.select(id); }

  setBatchPreview(preview: BatchPreview | null): void {
    this.batchPreview = preview;
    this.placeButton.textContent = preview ? preview.anchored ? `Build ${preview.count}` : 'Set start' : 'Place';
    this.rotateButton.disabled = preview?.anchored ?? false;
    this.shapeSelect.disabled = preview?.fixed ?? false;
    if (preview && this.placingId) this.placingTitle.textContent = `${preview.count || 'Choose'} parts · Total: ${stockedCostText(this.state, preview.cost) || 'choose an area'}`;
  }

  /**
   * Name and price the ghost, then offer its family as one-tap swaps. Rebuilt
   * per selection so a part unlocked (or paid for) mid-session shows up without
   * leaving placement.
   */
  private refreshPlacingBar(id: BuildableId): void {
    const active = BUILDABLES.find((candidate) => candidate.id === id);
    if (!active) return;
    this.placingId = id;
    this.placingTitle.textContent = `${active.displayName} · ${stockedCostText(this.state, active.cost)}`;
    for (const option of Array.from(this.shapeSelect.options)) {
      option.disabled = option.value === 'area' ? active.layer !== 'surface'
        : option.value === 'line' ? active.layer !== 'boundary' || active.tilesWide !== 1 || active.tilesHigh !== 1 : false;
    }
    if (this.batchPreview) this.setBatchPreview(this.batchPreview);

    const material = materialOf(id);
    const category = paletteCategory(active);
    const siblings = BUILDABLES.filter((candidate) => {
      if (candidate.availableInPalette === false) return false;
      if (buildableLockedReason(this.state, candidate.id)) return false;
      const candidateMaterial = materialOf(candidate.id);
      // Material families group by material; everything else falls back to the
      // palette category it already lives under, which keeps the row coherent
      // for one-off facilities that have no siblings by name.
      return material ? candidateMaterial === material : candidateMaterial === null && paletteCategory(candidate) === category;
    });

    this.quickRow.textContent = '';
    this.quickRow.style.display = siblings.length > 1 ? 'flex' : 'none';
    if (siblings.length <= 1) return;
    for (const sibling of siblings) {
      const label = material ? shortName(sibling.displayName) : sibling.displayName;
      const button = uiButton(label, () => this.select(sibling.id));
      const short = missingCost(this.state, sibling.cost);
      button.disabled = short !== null && sibling.id !== id;
      button.title = short
        ? `${sibling.displayName} · short ${short.amount} ${short.resource}`
        : `${sibling.displayName} · ${stockedCostText(this.state, sibling.cost)}`;
      Object.assign(button.style, {
        minHeight: '42px', minWidth: '0', padding: '6px 10px', fontSize: '12px',
        fontWeight: '600', flex: '0 0 auto',
      } satisfies Partial<CSSStyleDeclaration>);
      markSelected(button, sibling.id === id);
      button.setAttribute('aria-pressed', String(sibling.id === id));
      this.quickRow.appendChild(button);
    }
  }

  /** List owned blueprints only, greying out the ones the bag cannot pay for. */
  refreshAffordability(): void {
    const bestTier = AREA_TIERS.find((candidate) => candidate.area === this.state.highestAreaTierEver);
    const bestArea = bestTier ? `${bestTier.label} (${bestTier.area} tiles)` : 'None (0 tiles)';
    this.points.textContent = `Best enclosed area: ${bestArea} · Workbench target: Shelter (8 tiles)`;
    let owned = 0;
    for (const def of BUILDABLES.filter((candidate) => candidate.availableInPalette !== false)) {
      const entry = this.entries.get(def.id);
      const detail = this.entryDetails.get(def.id);
      const cost = this.entryCosts.get(def.id);
      if (!entry || !detail || !cost) continue;
      const locked = buildableLockedReason(this.state, def.id);
      entry.style.display = locked ? 'none' : 'block';
      if (locked) continue;
      owned += 1;
      entry.disabled = missingCost(this.state, def.cost) !== null;
      cost.textContent = stockedCostText(this.state, def.cost);
      detail.textContent = describeBuildable(def.id);
    }
    // A section heading with every entry hidden would read as an empty group.
    for (const section of this.sections) {
      const anyOwned = section.ids.some((id) => this.entries.get(id)?.style.display !== 'none');
      section.heading.style.display = anyOwned ? 'block' : 'none';
    }
    this.empty.style.display = owned === 0 ? 'block' : 'none';
    // Spending materials on a placement re-prices the quick-swap row too.
    if (this.currentMode === 'placing' && this.placingId) this.refreshPlacingBar(this.placingId);
  }

  private select(id: BuildableId): void {
    this.shapeSelect.style.display = 'block';
    this.shapeSelect.value = 'single';
    // Swapping parts mid-placement must keep its undo history, so only a
    // standing delete cursor is torn down here.
    if (this.currentMode === 'deleting') this.actions.onDeletingCancelled();
    this.currentMode = 'placing';
    this.deleteButton.style.display = 'none';
    this.placeButton.style.display = 'block';
    this.undoButton.style.display = 'block';
    if (!this.embedded) this.palette.style.display = 'none';
    // The disclosure tracks the palette itself, which placing mode hides.
    this.buildButton.setAttribute('aria-expanded', 'false');
    this.actionBar.style.display = 'flex';
    this.buttonCluster.style.display = 'block';
    this.markerKind.style.display = id === 'environment-marker' ? 'block' : 'none';
    const definition = BUILDABLES.find((candidate) => candidate.id === id);
    this.rotateButton.style.display = definition && (definition.layer === 'boundary' || definition.tilesWide !== definition.tilesHigh)
      ? 'block'
      : 'none';
    this.refreshPlacingBar(id);
    if (id === 'environment-marker') this.actions.onMarkerKindChanged(this.markerKind.value as EnvironmentKind);
    this.actions.onStartPlacing(id);
  }

  destroy(): void {
    this.root.remove();
  }
}
