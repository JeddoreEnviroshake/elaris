import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hotbar } from '../../src/ui/hotbar';
import { createInitialState, type GameState, type ToolDefinitionId } from '../../src/simulation/state';

function addTool(state: GameState, instanceId: string, definitionId: ToolDefinitionId): void {
  state.tools.push({
    instanceId, definitionId, durability: 96, maxDurability: 96,
    powerRank: 0, speedRank: 0, durabilityRank: 0,
  });
}

function slots(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')];
}

function press(slot: HTMLButtonElement): void {
  slot.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function release(slot: HTMLButtonElement): void {
  slot.dispatchEvent(new Event('pointerup', { bubbles: true }));
  slot.dispatchEvent(new Event('click', { bubbles: true }));
}

describe('hotbar press-and-hold removal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    window.localStorage.clear();
  });

  it('drops the held tool off the bar and slides the rest up, without equipping it', () => {
    const state = createInitialState(7);
    addTool(state, 'axe-1', 'stone-axe');
    addTool(state, 'pick-1', 'stone-pick');
    const onEquipTool = vi.fn();
    const hotbar = new Hotbar(document.body, state, { onEquipTool, onEquipBareHands: vi.fn() });

    press(slots()[0]!);
    vi.advanceTimersByTime(600);
    release(slots()[0]!);

    expect(onEquipTool).not.toHaveBeenCalled();
    expect(slots()[0]!.getAttribute('aria-label')).toContain('Stone Pick');
    hotbar.destroy();
  });

  it('equips normally when the press is released before the hold completes', () => {
    const state = createInitialState(7);
    addTool(state, 'axe-1', 'stone-axe');
    const onEquipTool = vi.fn();
    const hotbar = new Hotbar(document.body, state, { onEquipTool, onEquipBareHands: vi.fn() });

    press(slots()[0]!);
    vi.advanceTimersByTime(200);
    release(slots()[0]!);

    expect(onEquipTool).toHaveBeenCalledWith('axe-1');
    hotbar.destroy();
  });

  it('unequips a tool removed while it was in hand', () => {
    const state = createInitialState(7);
    addTool(state, 'axe-1', 'stone-axe');
    state.equippedToolId = 'axe-1';
    const onEquipBareHands = vi.fn(() => {
      state.equippedToolId = null;
    });
    const hotbar = new Hotbar(document.body, state, { onEquipTool: vi.fn(), onEquipBareHands });

    press(slots()[0]!);
    vi.advanceTimersByTime(600);

    expect(onEquipBareHands).toHaveBeenCalled();
    expect(slots()[0]!.getAttribute('aria-label')).toContain('empty');
    hotbar.destroy();
  });

  it('shows the arrow count above the bar only while the Bow is in hand', () => {
    const state = createInitialState(7);
    addTool(state, 'axe-1', 'stone-axe');
    addTool(state, 'bow-1', 'bow');
    state.inventory.arrow = 4;
    const hotbar = new Hotbar(document.body, state, { onEquipTool: vi.fn(), onEquipBareHands: vi.fn() });
    const quiver = document.querySelector<HTMLElement>('[data-quiver-count]')!;

    expect(quiver.style.display).toBe('none');

    state.equippedToolId = 'bow-1';
    hotbar.refresh();
    expect(quiver.style.display).toBe('flex');
    expect(quiver.textContent).toContain('4 arrows');

    state.inventory.arrow = 1;
    hotbar.refresh();
    expect(quiver.textContent).toContain('1 arrow');

    state.equippedToolId = 'axe-1';
    hotbar.refresh();
    expect(quiver.style.display).toBe('none');
    hotbar.destroy();
  });

  it('keeps a removal across a reload until the tool is assigned again', () => {
    const state = createInitialState(7);
    addTool(state, 'axe-1', 'stone-axe');
    addTool(state, 'pick-1', 'stone-pick');
    const first = new Hotbar(document.body, state, { onEquipTool: vi.fn(), onEquipBareHands: vi.fn() });
    press(slots()[0]!);
    vi.advanceTimersByTime(600);
    first.destroy();

    const second = new Hotbar(document.body, state, { onEquipTool: vi.fn(), onEquipBareHands: vi.fn() });
    expect(slots()[0]!.getAttribute('aria-label')).toContain('Stone Pick');
    expect(second.isAssigned('axe-1')).toBe(false);

    second.assign('axe-1');
    expect(second.isAssigned('axe-1')).toBe(true);
    expect(slots()[0]!.getAttribute('aria-label')).toContain('Stone Axe');
    second.destroy();
  });

  it('pulls an assigned tool onto the bar from beyond the five auto-filled slots', () => {
    const state = createInitialState(7);
    for (let index = 0; index < 6; index += 1) addTool(state, `axe-${index}`, 'stone-axe');
    addTool(state, 'pick-late', 'stone-pick');
    const hotbar = new Hotbar(document.body, state, { onEquipTool: vi.fn(), onEquipBareHands: vi.fn() });

    expect(hotbar.isAssigned('pick-late')).toBe(false);
    hotbar.assign('pick-late');

    expect(slots()[0]!.getAttribute('aria-label')).toContain('Stone Pick');
    expect(hotbar.isAssigned('pick-late')).toBe(true);
    hotbar.destroy();
  });

  it('survives assigning more tools than the bar holds', () => {
    const state = createInitialState(7);
    for (let index = 0; index < 7; index += 1) addTool(state, `axe-${index}`, 'stone-axe');
    const hotbar = new Hotbar(document.body, state, { onEquipTool: vi.fn(), onEquipBareHands: vi.fn() });

    for (let index = 0; index < 7; index += 1) hotbar.assign(`axe-${index}`);

    // Newest first, so the seventh assignment pushed the first two off the bar.
    expect(hotbar.isAssigned('axe-6')).toBe(true);
    expect(hotbar.isAssigned('axe-0')).toBe(false);
    expect(slots().filter((slot) => !slot.getAttribute('aria-label')?.includes('empty'))).toHaveLength(5);
    hotbar.destroy();
  });
});
