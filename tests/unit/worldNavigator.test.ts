import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldNavigator, worldCoordinates } from '../../src/ui/worldNavigator';
import { createInitialState } from '../../src/simulation/state';
import { enterWorldArea } from '../../src/simulation/areas';
import { REGIONAL_IDENTITIES } from '../../src/content/regions';
import { ELARIS_SANCTUARY_TILE } from '../../src/simulation/survivalCycle';
import { TILE_SIZE } from '../../src/config/platform';

beforeEach(() => {
  const context = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('worldCoordinates', () => {
  it('maps source-pixel positions to the 160-tile navigation grid', () => {
    expect(worldCoordinates(0, 0)).toEqual({ x: 0, y: 0 });
    expect(worldCoordinates(1280, 1280)).toEqual({ x: 80, y: 80 });
    expect(worldCoordinates(2560, 2560)).toEqual({ x: 160, y: 160 });
  });

  it('clamps out-of-bounds positions to the displayed world edges', () => {
    expect(worldCoordinates(-12, 3000)).toEqual({ x: 0, y: 160 });
  });
});

describe('quest disclosure', () => {
  it('shows only the active quest below the mini map and collapses to a translucent label', () => {
    const state = createInitialState(123);
    state.onboarding.status = 'legacy';
    const navigator = new WorldNavigator(document.body, state);
    const map = document.querySelector<HTMLElement>('[aria-label="Toggle world map"]')!;
    const panel = document.querySelector<HTMLElement>('[aria-label="Active quests"]')!;
    const button = panel.querySelector<HTMLButtonElement>('button')!;

    expect(panel.textContent).toContain('Quests');
    expect(map.parentElement!.style.top).toContain('safe-area-inset-top');
    expect(map.parentElement!.style.top).toContain('8px');
    expect(map.nextElementSibling).toBe(panel);
    expect(panel.textContent).toContain('First Materials');
    expect(panel.textContent).not.toContain('A Better Tool');
    expect(button.getAttribute('aria-expanded')).toBe('true');

    button.click();

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Show active quest');
    expect(document.getElementById('active-quest-list')!.style.display).toBe('none');
    expect(panel.style.opacity).toBe('0.42');

    navigator.destroy();
  });

  it('refreshes the displayed quest as progression changes', () => {
    const state = createInitialState(123);
    state.onboarding.status = 'legacy';
    const navigator = new WorldNavigator(document.body, state);
    state.completedQuestIds.push('gather-fiber');

    navigator.refresh();

    const panel = document.querySelector<HTMLElement>('[aria-label="Active quests"]')!;
    expect(panel.textContent).toContain('A Better Tool');
    expect(panel.textContent).not.toContain('First Materials');

    navigator.destroy();
  });

  it('opens a dedicated large map from the button attached to the mini map', () => {
    const state = createInitialState(123);
    const navigator = new WorldNavigator(document.body, state);
    const button = document.querySelector<HTMLButtonElement>('[aria-label="Open large map"]')!;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="large-world-map-title"]')!;
    const overlay = document.querySelector<HTMLElement>('[data-world-map-overlay]')!;

    expect(button).not.toBeNull();
    expect(overlay.style.display).toBe('none');
    button.click();

    expect(overlay.style.display).toBe('flex');
    expect(dialog.textContent).toContain('The Lands of Elaris');
    expect(dialog.textContent).toContain('Elaris');
    expect(dialog.textContent).toContain('Elaris → Verdant Reach → Sylvaren');
    expect(dialog.textContent).toContain('Next journey: Verdant Reach');

    document.querySelector<HTMLButtonElement>('[aria-label="Close large map"]')!.click();
    expect(overlay.style.display).toBe('none');
    navigator.destroy();
  });

  it('shows regional identity, landmark discovery, and cycle contract status', () => {
    const state = createInitialState(456);
    enterWorldArea(state, 1, 0);
    const navigator = new WorldNavigator(document.body, state);

    const questPanel = document.querySelector<HTMLElement>('[aria-label="Active quests"]')!;
    expect(questPanel.textContent).toContain('Fiber Run 0/12 fiber');
    expect(questPanel.textContent).toContain('Landmark: undiscovered');

    document.querySelector<HTMLButtonElement>('[aria-label="Open large map"]')!.click();
    const regions = document.querySelector<HTMLElement>('[aria-label="Regional discoveries and repeatable activities"]')!;
    expect(regions.textContent).toContain('Verdant Reach');
    expect(regions.textContent).toContain('Sungrass Fiber');
    expect(regions.textContent).toContain('Tuftle herds');
    expect(regions.textContent).toContain('Fiber Run: 0/12 fiber');
    expect(regions.textContent).toContain('Mastery: Unknown');

    navigator.destroy();
  });

  it('plots raiders as red dots on the mini map', () => {
    const fills: { color: unknown; rect: number[] }[] = [];
    const recorder = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn((...rect: number[]) => { fills.push({ color: recorder.fillStyle, rect }); }),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D & { fillStyle: string };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(recorder);

    const state = createInitialState(321);
    state.raiders.push({
      id: 'raider-1',
      kindId: 'scavenger',
      x: 40 * TILE_SIZE,
      y: 80 * TILE_SIZE,
      hp: 12,
      maxHp: 12,
      level: 1,
      targetBuildingId: null,
      nextAttackTick: 0,
    });
    const navigator = new WorldNavigator(document.body, state);

    expect(fills.some((entry) => entry.color === '#ff4136')).toBe(true);
    navigator.destroy();
  });

  it('offers an earned waystone route from the sanctuary and reports the selected destination', () => {
    const state = createInitialState(789);
    const verdant = REGIONAL_IDENTITIES.find((entry) => entry.areaKey === '1,0')!;
    state.regionalProgress.discoveredLandmarkIds.push(verdant.landmark.id);
    state.regionalProgress.contractCompletionCounts[verdant.contract.id] = 3;
    state.player.x = (ELARIS_SANCTUARY_TILE.x + 0.5) * TILE_SIZE;
    state.player.y = (ELARIS_SANCTUARY_TILE.y + 0.5) * TILE_SIZE;
    const travel = vi.fn(() => ({ ok: true, message: 'Travelled' }));
    const navigator = new WorldNavigator(document.body, state, undefined, travel);

    document.querySelector<HTMLButtonElement>('[aria-label="Open large map"]')!.click();
    const button = document.querySelector<HTMLButtonElement>(
      '[aria-label="Use waystone to travel to Verdant Reach"]',
    )!;
    expect(button).not.toBeNull();
    button.click();

    expect(travel).toHaveBeenCalledWith('1,0');
    expect(document.querySelector<HTMLElement>('[data-world-map-overlay]')!.style.display).toBe('none');
    navigator.destroy();
  });
});
