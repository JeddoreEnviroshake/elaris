import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/simulation/state';
import {
  beginPlayerDefeat,
  chooseRespawn,
} from '../../src/simulation/survivalCycle';
import { RespawnPanel } from '../../src/ui/respawnPanel';

beforeEach(() => {
  const context = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.getElementById('elaris-respawn-styles')?.remove();
});

describe('RespawnPanel', () => {
  it('blocks on persisted defeat and offers Elaris plus every surviving Bed', () => {
    const state = createInitialState(123);
    state.buildings.push({ id: 'bed-panel', definitionId: 'bed', tileX: 20, tileY: 20 });
    const panel = new RespawnPanel(document.body, state, (destinationId) => chooseRespawn(state, destinationId));

    expect(document.querySelector<HTMLElement>('[data-respawn-overlay]')!.style.display).not.toBe('flex');
    beginPlayerDefeat(state, 'raider');
    panel.refresh(true);

    const overlay = document.querySelector<HTMLElement>('[data-respawn-overlay]')!;
    expect(overlay.style.display).toBe('flex');
    expect(overlay.textContent).toContain('Choose where to awaken');
    expect(overlay.textContent).toContain('Raiders cut you down');
    expect(overlay.textContent).toContain('Elaris Sanctuary');
    expect(overlay.textContent).toContain('Bed 1 — Elaris');
    expect(overlay.textContent).toContain('Exposed bed');
    // The starting berries and arrows went into the cache, so the screen names
    // the beacon and the deadline rather than reporting a flat loss.
    expect(overlay.textContent).toContain('dropped at the beacon in Elaris');
    expect(overlay.textContent).toContain('10:00 to recover them');

    const buttons = [...overlay.querySelectorAll<HTMLButtonElement>('button')];
    buttons.at(-1)!.focus();
    const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
    overlay.dispatchEvent(forwardTab);
    expect(forwardTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    overlay.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(state.pendingRespawn).not.toBeNull();

    buttons[0]!.click();
    expect(state.pendingRespawn).toBeNull();
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(overlay.style.display).toBe('none');
    panel.destroy();
  });
});
