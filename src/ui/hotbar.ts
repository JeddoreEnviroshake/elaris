import { toolDefinition } from '../config/balance';
import type { GameState } from '../simulation/state';
import { durabilityColor, inventorySlotEntries, type SlotEntry } from './inventorySlots';

export const HOTBAR_SLOTS = 5;

export interface HotbarActions {
  /** A slot holding a tool was selected (tap/click or 1–5 key). */
  onEquipTool: (toolId: string) => void;
}

/**
 * Bottom-center 1–5 hotbar mirroring the first HOTBAR_SLOTS tool slots of the
 * inventory. Selecting a slot equips its tool (explicit, like everywhere
 * else). Slots shrink via CSS clamp on narrow phones so the strip clears the
 * joystick and the Gather button; it hides while a build ghost is out because
 * the placement action bar owns that screen region.
 */
interface SlotElements {
  slot: HTMLButtonElement;
  icon: HTMLSpanElement;
  bar: HTMLSpanElement;
  fill: HTMLSpanElement;
}

export class Hotbar {
  private readonly root: HTMLDivElement;
  private readonly slots: SlotElements[] = [];
  private suppressed = false;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: HotbarActions,
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '50%',
      bottom: 'calc(env(safe-area-inset-bottom) + 52px)',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: '6px',
      zIndex: '11',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Hotbar');

    for (let index = 0; index < HOTBAR_SLOTS; index += 1) {
      const slot = document.createElement('button');
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
        this.select(index);
      });
      this.slots.push({ slot, icon, bar, fill });
      this.root.appendChild(slot);
    }

    parent.appendChild(this.root);
    this.refresh();
  }

  /** Equip the tool in the given 0-based slot; empty slots are inert. */
  select(index: number): void {
    const entry = this.toolEntries()[index];
    if (entry) this.actions.onEquipTool(entry.tool.instanceId);
  }

  refresh(): void {
    const tools = this.toolEntries();
    for (let index = 0; index < HOTBAR_SLOTS; index += 1) {
      const { slot, icon, bar, fill } = this.slots[index]!;
      const entry = tools[index];
      if (!entry) {
        slot.disabled = true;
        slot.style.opacity = '0.5';
        slot.style.borderColor = 'rgba(255,255,255,0.16)';
        slot.setAttribute('aria-pressed', 'false');
        slot.setAttribute('aria-label', `Hotbar slot ${index + 1}: empty`);
        icon.textContent = '';
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
        `Hotbar slot ${index + 1}: ${toolDefinition(tool.definitionId).displayName} ${tool.durability}/${tool.maxDurability}`,
      );
      icon.textContent = toolDefinition(tool.definitionId).kind === 'axe' ? '🪓' : toolDefinition(tool.definitionId).kind === 'pick' ? '⛏' : '⌁';
      bar.style.display = 'block';
      const ratio = tool.durability / tool.maxDurability;
      fill.style.width = `${Math.round(ratio * 100)}%`;
      fill.style.background = durabilityColor(ratio);
    }
  }

  /** Hide while build placement's action bar occupies the bottom-center. */
  setSuppressed(suppressed: boolean): void {
    if (suppressed === this.suppressed) return;
    this.suppressed = suppressed;
    this.root.style.display = suppressed ? 'none' : 'flex';
  }

  private toolEntries(): Array<Extract<SlotEntry, { kind: 'tool' }>> {
    return inventorySlotEntries(this.state)
      .filter((entry): entry is Extract<SlotEntry, { kind: 'tool' }> => entry.kind === 'tool')
      .slice(0, HOTBAR_SLOTS);
  }

  destroy(): void {
    this.root.remove();
  }
}
