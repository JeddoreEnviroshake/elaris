import type { GameState } from '../simulation/state';
import {
  BLUEPRINTS,
  STATION_LABELS,
  blueprintGroups,
  isBlueprintUnlocked,
  type BlueprintEntry,
} from './blueprintCatalog';
import { claimAllBlueprintGrants } from '../simulation/blueprintGrants';
import {
  BLUEPRINT_QUALITY_COLORS, BLUEPRINT_QUALITY_LABELS, blueprintQuality,
} from '../content/blueprintQuality';
import { div, paletteSection, uiButton } from './controls';
import { stockedCostText } from './costs';
import { setUiIcon } from './icons';
import type { InventoryPanel } from './inventoryPanel';

/** What every undiscovered blueprint is called, wherever it is shown. */
export const UNKNOWN_BLUEPRINT_NAME = '????';

/**
 * The catalog name for a blueprint id. Grants carry ids, and a grant for a
 * recipe the catalog has since dropped still has to read as something, so the
 * id is spelled out rather than blanked.
 */
function blueprintName(unlockId: string): string {
  return BLUEPRINTS.find((entry) => entry.unlockId === unlockId)?.displayName
    ?? unlockId.replace(/-/g, ' ');
}

/**
 * The whole recipe catalog, known or not, grouped by material. Nothing is
 * bought here — blueprints are earned from level gates and quests, or found in
 * the field and registered at a workbench. Craft, the Build section, and the
 * work tables all show known blueprints only, so nothing there dead-ends.
 *
 * An unknown entry keeps its tile and its category but gives up its name, its
 * icon, and its cost. That is deliberate: the grid shows how many blueprints a
 * category still holds — the shape of what is missing — without spoiling what
 * they are.
 *
 * Entries are square 1:1 tiles rather than the wide cards the palettes use, so
 * a category fits on one screen; the sticky detail card above the grid carries
 * the description and materials for whichever tile is selected.
 */
export class BlueprintsPanel {
  private readonly panel: HTMLElement;
  private readonly points: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly detailTitle: HTMLElement;
  private readonly detailBody: HTMLDivElement;
  private readonly detailCost: HTMLDivElement;
  private readonly claimBanner: HTMLButtonElement;
  private readonly revealNote: HTMLDivElement;
  private readonly tiles = new Map<string, HTMLButtonElement>();
  /** Names revealed by the last Collect, kept until the tab is reopened. */
  private revealed: readonly string[] = [];
  private selectedKey: string | null = null;
  private menu: InventoryPanel | null = null;
  /** Lets the scene save and toast when blueprints are collected. */
  onClaimed: ((revealed: readonly string[]) => void) | null = null;

  constructor(private readonly state: GameState) {
    this.panel = document.createElement('section');
    Object.assign(this.panel.style, {
      width: '100%', color: '#e8f0ea', font: '13px system-ui, sans-serif', pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);
    this.panel.setAttribute('aria-label', 'Blueprints');

    // Sticky so the selected blueprint's details stay readable while the player
    // scrolls a long category instead of scrolling away from their selection.
    // The negative margin pulls it over the tab's top padding, which tiles
    // would otherwise scroll through above the pinned card.
    const header = div({
      position: 'sticky', top: '-12px', zIndex: '1',
      margin: '-12px 0 0', padding: '12px 0 8px',
      background: 'rgba(9,20,14,0.97)',
    });
    header.classList.add('elaris-blueprint-header');
    this.points = div({ color: '#ffe08a', fontSize: '12px' });
    this.detail = div({
      marginTop: '8px', padding: '10px 12px', borderRadius: '9px', lineHeight: '1.35',
      background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.1)',
    });
    this.detail.classList.add('elaris-blueprint-detail');
    this.detailTitle = document.createElement('strong');
    this.detailBody = div({ marginTop: '3px', fontSize: '12px', opacity: '0.76' });
    this.detailCost = div({ marginTop: '3px', fontSize: '12px', opacity: '0.86' });
    this.detail.append(this.detailTitle, this.detailBody, this.detailCost);
    // The claim banner sits above everything: an earned blueprint the player has
    // not collected is the one thing on this tab that wants acting on.
    this.claimBanner = uiButton('', () => {
      const revealed = claimAllBlueprintGrants(this.state);
      if (revealed[0]) this.selectedKey = revealed[0];
      // What the tap bought: the banner is replaced in place by the names, so
      // the answer to "what did I just unlock?" is where the question was asked
      // rather than only in the HUD banner the open menu is covering.
      this.revealed = revealed.map(blueprintName);
      this.onClaimed?.(revealed);
      this.refresh();
    });
    Object.assign(this.claimBanner.style, {
      width: '100%', marginTop: '8px', minHeight: '44px', background: '#7a6320', display: 'none',
    });
    this.revealNote = div({
      marginTop: '8px', padding: '8px 10px', borderRadius: '9px', display: 'none',
      background: 'rgba(122,99,32,0.28)', border: '1px solid rgba(255,210,63,0.45)',
      color: '#ffe9b0', fontSize: '12px', lineHeight: '1.35',
    });
    this.revealNote.dataset.testid = 'blueprint-claim-reveal';
    // Polite, not assertive: the HUD's unlock banner is the alert, and this is
    // the same news sitting still on the tab for as long as it is wanted.
    this.revealNote.setAttribute('role', 'status');
    header.append(this.points, this.claimBanner, this.revealNote, this.detail);
    this.panel.appendChild(header);

    for (const group of blueprintGroups()) {
      this.panel.appendChild(paletteSection(group.label));
      const grid = div({
        display: 'grid',
        // Square tiles that reflow: ~6 across on a wide panel, 3 on a phone.
        gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
        gap: '8px',
        marginTop: '8px',
      });
      for (const entry of group.entries) grid.appendChild(this.buildTile(entry));
      this.panel.appendChild(grid);
    }
    this.select(BLUEPRINTS[0]!.key);
  }

  attachToMenu(menu: InventoryPanel): void {
    this.menu = menu;
    // Reopening the tab clears the reveal: it is the receipt for a tap that just
    // happened, not a second permanent list of what is known.
    menu.registerTab('blueprints', 'Blueprints', this.panel, () => {
      this.revealed = [];
      this.refresh();
    });
  }

  /** Only the open Blueprints tab is worth rebuilding; the HUD refreshes often. */
  private get shown(): boolean {
    return (this.menu?.open ?? false) && this.panel.style.display !== 'none';
  }

  private buildTile(entry: BlueprintEntry): HTMLButtonElement {
    const tile = uiButton('', () => this.select(entry.key));
    tile.classList.add('elaris-blueprint-tile');
    Object.assign(tile.style, {
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '4px', aspectRatio: '1', width: '100%', minWidth: '0', minHeight: '0',
      padding: '6px 4px', textAlign: 'center', lineHeight: '1.15',
      background: 'rgba(30,48,37,0.94)', touchAction: 'pan-y',
    } satisfies Partial<CSSStyleDeclaration>);
    // Icon and name are filled in by refresh, not here: whether this tile shows
    // its blueprint or a `????` depends on state that changes while the tab is
    // open, so the tile has to be able to go from masked to revealed in place.
    const icon = div({ display: 'grid', placeItems: 'center', lineHeight: '1' });
    icon.dataset.blueprintIcon = '';
    const name = div({ fontSize: '11px', fontWeight: '600' });
    name.dataset.blueprintName = '';
    const badge = div({ fontSize: '10px', opacity: '0.78' });
    badge.dataset.blueprintBadge = '';
    tile.append(icon, name, badge);
    this.tiles.set(entry.key, tile);
    return tile;
  }

  private select(key: string): void {
    this.selectedKey = key;
    this.refresh();
  }

  refresh(): void {
    if (!this.shown) return;
    const known = BLUEPRINTS.filter((entry) => isBlueprintUnlocked(this.state, entry)).length;
    this.points.textContent = `${known}/${BLUEPRINTS.length} blueprints known`;

    const pending = this.state.pendingBlueprintGrantIds.length;
    this.claimBanner.style.display = pending > 0 ? 'block' : 'none';
    if (pending > 0) {
      const label = `Collect ${pending} earned blueprint${pending === 1 ? '' : 's'}`;
      this.claimBanner.textContent = label;
      this.claimBanner.setAttribute('aria-label', label);
    } else {
      // Cleared rather than left stale: a hidden button that still answers to
      // its old name is an action a screen reader would offer and nothing does.
      this.claimBanner.textContent = '';
      this.claimBanner.removeAttribute('aria-label');
    }

    if (this.revealed.length > 0) {
      const note = `Unlocked: ${this.revealed.join(', ')}`;
      this.revealNote.textContent = note;
      this.revealNote.setAttribute('aria-label', note);
      this.revealNote.style.display = 'block';
    } else {
      this.revealNote.textContent = '';
      this.revealNote.removeAttribute('aria-label');
      this.revealNote.style.display = 'none';
    }

    for (const entry of BLUEPRINTS) {
      const tile = this.tiles.get(entry.key)!;
      const unlocked = isBlueprintUnlocked(this.state, entry);
      const selected = entry.key === this.selectedKey;
      tile.dataset.known=String(unlocked);

      const icon = tile.querySelector<HTMLElement>('[data-blueprint-icon]')!;
      setUiIcon(icon, unlocked ? entry.icon : 'blueprint', 18);
      const name = tile.querySelector<HTMLElement>('[data-blueprint-name]')!;
      name.textContent = unlocked ? entry.displayName : UNKNOWN_BLUEPRINT_NAME;
      const badge = tile.querySelector<HTMLElement>('[data-blueprint-badge]')!;
      // Quality is shown only once a blueprint is known. On an unknown tile it
      // would be a hint about what is hiding there, and the whole point of the
      // mask is that the tab says how much is missing, never what.
      const quality = entry.unlockId ? blueprintQuality(entry.unlockId) : 'common';
      badge.textContent = unlocked ? BLUEPRINT_QUALITY_LABELS[quality] : 'Undiscovered';
      badge.style.color = unlocked ? BLUEPRINT_QUALITY_COLORS[quality] : '#ffd18a';

      tile.style.opacity = unlocked ? '1' : '0.62';
      tile.style.borderColor = selected ? '#ffe08a' : 'rgba(255,255,255,0.16)';
      tile.setAttribute('aria-pressed', selected ? 'true' : 'false');
      tile.setAttribute(
        'aria-label',
        unlocked
          ? `${entry.displayName}, ${BLUEPRINT_QUALITY_LABELS[quality]}, known, made at ${STATION_LABELS[entry.station]}`
          : 'Undiscovered blueprint',
      );
    }

    const entry = BLUEPRINTS.find((candidate) => candidate.key === this.selectedKey);
    if (!entry) return;
    if (!isBlueprintUnlocked(this.state, entry)) {
      this.detailTitle.textContent = UNKNOWN_BLUEPRINT_NAME;
      this.detailTitle.style.color = '';
      this.detailBody.textContent = 'You have not discovered this blueprint yet.';
      this.detailCost.textContent = '';
      return;
    }
    const quality = entry.unlockId ? blueprintQuality(entry.unlockId) : 'common';
    this.detailTitle.textContent = `${entry.displayName} · ${STATION_LABELS[entry.station]}`;
    this.detailTitle.style.color = BLUEPRINT_QUALITY_COLORS[quality];
    this.detailBody.textContent = `${BLUEPRINT_QUALITY_LABELS[quality]} · ${entry.description}`;
    this.detailCost.textContent = `Materials: ${stockedCostText(this.state, entry.cost) || 'none'}`;
  }

  destroy(): void {
    this.panel.remove();
  }
}
