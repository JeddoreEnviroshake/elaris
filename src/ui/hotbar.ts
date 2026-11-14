import { toolDefinition } from '../config/balance';
import type { GameState } from '../simulation/state';
import { durabilityColor, inventorySlotEntries, type SlotEntry } from './inventorySlots';
import { createUiIcon, setUiIcon } from './icons';

export const HOTBAR_SLOTS = 5;

/** Hold duration before a slot drops its tool, matching the world long-press. */
const REMOVE_HOLD_MS = 550;
/** Preference-sized, so localStorage rather than the save repository. */
const LAYOUT_STORAGE_KEY = 'elaris.hotbar-layout';

export interface HotbarActions {
  /** A slot holding a tool was selected (tap/click or 1–5 key). */
  onEquipTool: (toolId: string) => void;
  /** An empty slot or the dedicated 0 shortcut was selected. */
  onEquipBareHands: () => void;
}

/**
 * Bottom-center 1–5 hotbar mirroring the first HOTBAR_SLOTS tool slots of the
 * inventory. Selecting a slot equips its tool (explicit, like everywhere
 * else); pressing and holding a slot removes that tool from the bar, letting
 * the tools behind it slide up. Removal only hides the tool here — it stays in
 * the inventory, and equipping it there puts it back on the bar. Slots shrink
 * via CSS clamp on narrow phones so the strip clears the joystick and the
 * Gather button; it hides while a build ghost is out because the placement
 * action bar owns that screen region.
 */
interface SlotElements {
  slot: HTMLButtonElement;
  icon: HTMLSpanElement;
  bar: HTMLSpanElement;
  fill: HTMLSpanElement;
}

export class Hotbar {
  private readonly column: HTMLDivElement;
  private readonly root: HTMLDivElement;
  /** Arrow readout above the strip; only on screen while a Bow is equipped. */
  private readonly quiver: HTMLDivElement;
  private readonly quiverCount: HTMLSpanElement;
  private readonly slots: SlotElements[] = [];
  private suppressed = false;
  /** Tool instance ids the player long-pressed off the bar. */
  private readonly hidden: Set<string>;
  /** Tool instance ids assigned from the Bag, in slot order. */
  private assigned: string[];
  private holdTimer = 0;
  private holdSlot: HTMLButtonElement | null = null;
  /** Set when a hold fired, so the trailing click does not also equip. */
  private removedByHold = false;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: HotbarActions,
  ) {
    const layout = readLayout();
    this.hidden = new Set(layout.hidden);
    this.assigned = layout.assigned.slice(0, HOTBAR_SLOTS);
    this.column = document.createElement('div');
    Object.assign(this.column.style, {
      position: 'absolute',
      left: '50%',
      bottom: 'calc(env(safe-area-inset-bottom) + 12px)',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      zIndex: '11',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.quiver = document.createElement('div');
    this.quiver.classList.add('elaris-panel');
    this.quiver.dataset.quiverCount = '';
    Object.assign(this.quiver.style, {
      display: 'none',
      alignItems: 'center',
      gap: '5px',
      padding: '3px 8px',
      borderRadius: '9px',
      color: '#e8f0ea',
      font: '600 12px system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>);
    this.quiverCount = document.createElement('span');
    this.quiver.append(createUiIcon('bow', 14), this.quiverCount);
    this.column.appendChild(this.quiver);

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      display: 'flex',
      gap: '6px',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Hotbar');
    this.root.classList.add('elaris-panel');
    this.root.style.padding = '4px';

    for (let index = 0; index < HOTBAR_SLOTS; index += 1) {
      const slot = document.createElement('button');
      slot.classList.add('elaris-button');
      Object.assign(slot.style, {
        position: 'relative',
        width: 'clamp(30px, calc((100vw - 240px) / 5), 46px)',
        aspectRatio: '1',
        padding: '0',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: '9px',
        color: '#e8f0ea',
        background: 'rgba(9,20,14,0.82)',
        font: '600 11px system-ui, sans-serif',
        pointerEvents: 'auto',
        touchAction: 'none',
        cursor: 'pointer',
      } satisfies Partial<CSSStyleDeclaration>);

      const key = document.createElement('span');
      key.textContent = String(index + 1);
      Object.assign(key.style, {
        position: 'absolute',
        top: '2px',
        left: '4px',
        fontSize: '9px',
        opacity: '0.65',
      } satisfies Partial<CSSStyleDeclaration>);

      const icon = document.createElement('span');
      Object.assign(icon.style, { fontSize: '15px', lineHeight: '1' } satisfies Partial<CSSStyleDeclaration>);

      const bar = document.createElement('span');
      Object.assign(bar.style, {
        position: 'absolute',
        left: '4px',
        right: '4px',
        bottom: '3px',
        height: '3px',
        borderRadius: '2px',
        background: 'rgba(255,255,255,0.14)',
        overflow: 'hidden',
        display: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      const fill = document.createElement('span');
      Object.assign(fill.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        bottom: '0',
        borderRadius: '2px',
      } satisfies Partial<CSSStyleDeclaration>);
      bar.appendChild(fill);

      slot.append(key, icon, bar);
      slot.addEventListener('click', (event) => {
        event.stopPropagation();
        if (this.removedByHold) return;
        this.select(index);
      });
      slot.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        this.beginHold(index);
      });
      for (const done of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
        slot.addEventListener(done, () => this.cancelHold());
      }
      this.slots.push({ slot, icon, bar, fill });
      this.root.appendChild(slot);
    }

    this.column.appendChild(this.root);
    parent.appendChild(this.column);
    this.refresh();
  }

  /** Equip the tool in the given 0-based slot, or bare hands when it is empty. */
  select(index: number): void {
    const entry = this.toolEntries()[index];
    if (entry) this.actions.onEquipTool(entry.tool.instanceId);
    else this.selectBareHands();
  }

  /** Switch to bare hands without targeting a particular hotbar slot. */
  selectBareHands(): void {
    this.actions.onEquipBareHands();
  }

  /**
   * Drop the tool in the given 0-based slot off the bar. The tool itself is
   * untouched; the Bag's "Assign to Hotbar" action puts it back.
   */
  removeSlot(index: number): void {
    const entry = this.toolEntries()[index];
    if (!entry) return;
    if (entry.equipped) this.actions.onEquipBareHands();
    this.assigned = this.assigned.filter((id) => id !== entry.tool.instanceId);
    this.hidden.add(entry.tool.instanceId);
    this.persist();
    this.refresh();
  }

  /**
   * Put a tool on the bar from the Bag. It takes the first slot rather than
   * appending, because a tool sitting past the fifth auto-filled slot would
   * otherwise be "assigned" and still nowhere on screen.
   */
  assign(instanceId: string): void {
    this.hidden.delete(instanceId);
    this.assigned = [instanceId, ...this.assigned.filter((id) => id !== instanceId)].slice(0, HOTBAR_SLOTS);
    this.persist();
    this.refresh();
  }

  /** Whether the tool currently occupies one of the visible slots. */
  isAssigned(instanceId: string): boolean {
    return this.toolEntries().some((entry) => entry.tool.instanceId === instanceId);
  }

  private beginHold(index: number): void {
    this.cancelHold();
    this.removedByHold = false;
    if (!this.toolEntries()[index]) return;
    this.holdSlot = this.slots[index]!.slot;
    // Shrinks over the hold so the wait reads as a deliberate gesture.
    this.holdSlot.style.transition = `transform ${REMOVE_HOLD_MS}ms linear`;
    this.holdSlot.style.transform = 'scale(0.82)';
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = 0;
      this.removedByHold = true;
      this.cancelHold();
      this.removeSlot(index);
    }, REMOVE_HOLD_MS);
  }

  private cancelHold(): void {
    if (this.holdTimer) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = 0;
    }
    if (!this.holdSlot) return;
    this.holdSlot.style.transition = 'transform 120ms ease-out';
    this.holdSlot.style.transform = '';
    this.holdSlot = null;
  }

  refresh(): void {
    const tools = this.toolEntries();
    this.refreshQuiver();
    for (let index = 0; index < HOTBAR_SLOTS; index += 1) {
      const { slot, icon, bar, fill } = this.slots[index]!;
      const entry = tools[index];
      if (!entry) {
        slot.disabled = false;
        slot.style.opacity = '0.5';
        slot.style.borderColor = 'rgba(255,255,255,0.16)';
        slot.setAttribute('aria-pressed', 'false');
        slot.setAttribute('aria-label', `Hotbar slot ${index + 1}: empty`);
        icon.replaceChildren();
        bar.style.display = 'none';
        continue;
      }
      const { tool, equipped } = entry;
      slot.disabled = false;
      slot.style.opacity = tool.durability > 0 ? '1' : '0.7';
      slot.style.borderColor = equipped ? '#ffe08a' : 'rgba(255,255,255,0.16)';
      slot.setAttribute('aria-pressed', equipped ? 'true' : 'false');
      slot.setAttribute(
        'aria-label',
        `Hotbar slot ${index + 1}: ${toolDefinition(tool.definitionId).displayName} ${tool.durability}/${tool.maxDurability}. Hold to remove from the bar.`,
      );
      setUiIcon(icon, toolDefinition(tool.definitionId).kind, 19);
      bar.style.display = 'block';
      const ratio = tool.durability / tool.maxDurability;
      fill.style.width = `${Math.round(ratio * 100)}%`;
      fill.style.background = durabilityColor(ratio);
    }
  }

  /**
   * Ammunition left, shown only while a Bow is equipped — the one loadout whose
   * next attack can fail for a reason the durability bars cannot show. It reads
   * off the whole inventory rather than the visible slots so a bow equipped
   * from beyond the five hotbar slots still counts.
   */
  private refreshQuiver(): void {
    const bowEquipped = inventorySlotEntries(this.state).some((entry) => entry.kind === 'tool'
      && entry.equipped
      && toolDefinition(entry.tool.definitionId).kind === 'bow');
    this.quiver.style.display = bowEquipped ? 'flex' : 'none';
    if (!bowEquipped) return;
    const arrows = this.state.inventory.arrow;
    this.quiverCount.textContent = `${arrows} ${arrows === 1 ? 'arrow' : 'arrows'}`;
    // Empty is a blocked shot, not a low warning: colour it like a failed cost.
    this.quiver.style.color = arrows > 0 ? '#e8f0ea' : '#ff9d8a';
    this.quiver.dataset.quiverCount = String(arrows);
  }

  /** Hide while build placement's action bar occupies the bottom-center. */
  setSuppressed(suppressed: boolean): void {
    if (suppressed === this.suppressed) return;
    this.suppressed = suppressed;
    this.column.style.display = suppressed ? 'none' : 'flex';
  }

  /**
   * Slot order: tools the player assigned from the Bag first, then the tools
   * they never touched, so a fresh save still auto-fills the bar and a removed
   * tool stays off it until it is assigned again.
   */
  private toolEntries(): Array<Extract<SlotEntry, { kind: 'tool' }>> {
    const tools = inventorySlotEntries(this.state)
      .filter((entry): entry is Extract<SlotEntry, { kind: 'tool' }> => entry.kind === 'tool');
    this.forgetUnownedTools(tools);
    const byId = new Map(tools.map((entry) => [entry.tool.instanceId, entry]));
    const assigned = this.assigned.map((id) => byId.get(id)!).filter(Boolean);
    const rest = tools.filter((entry) => !this.assigned.includes(entry.tool.instanceId)
      && !this.hidden.has(entry.tool.instanceId));
    return [...assigned, ...rest].slice(0, HOTBAR_SLOTS);
  }

  /** Ids for tools the player no longer owns, so neither list grows unbounded. */
  private forgetUnownedTools(tools: Array<Extract<SlotEntry, { kind: 'tool' }>>): void {
    if (!this.hidden.size && !this.assigned.length) return;
    const owned = new Set(tools.map((entry) => entry.tool.instanceId));
    const kept = this.assigned.filter((id) => owned.has(id));
    let changed = kept.length !== this.assigned.length;
    this.assigned = kept;
    for (const id of [...this.hidden]) {
      if (owned.has(id)) continue;
      this.hidden.delete(id);
      changed = true;
    }
    if (changed) this.persist();
  }

  private persist(): void {
    try {
      if (!this.hidden.size && !this.assigned.length) window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
      else {
        window.localStorage.setItem(
          LAYOUT_STORAGE_KEY,
          JSON.stringify({ hidden: [...this.hidden], assigned: this.assigned }),
        );
      }
    } catch {
      // Private-mode storage failures only cost the preference across reloads.
    }
  }

  destroy(): void {
    this.cancelHold();
    this.column.remove();
  }
}

interface HotbarLayout {
  /** Tools long-pressed off the bar. */
  hidden: string[];
  /** Tools assigned from the Bag, in slot order. */
  assigned: string[];
}

function readLayout(): HotbarLayout {
  const empty: HotbarLayout = { hidden: [], assigned: [] };
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    const record = parsed as Partial<Record<keyof HotbarLayout, unknown>>;
    return { hidden: stringList(record.hidden), assigned: stringList(record.assigned) };
  } catch {
    return empty;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}
