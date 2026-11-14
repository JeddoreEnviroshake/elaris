import { afterEach, describe, expect, it, vi } from 'vitest';
import { readyGarden } from '../helpers/openingJourney';
import { GardenGuide } from '../../src/ui/gardenGuide';
import type { InventoryPanel } from '../../src/ui/inventoryPanel';
import { openingGardenBuildRequest, registerOpeningDiscovery } from '../../src/simulation/openingGarden';
import { reconcileQuestProgress } from '../../src/simulation/progression';
import { placeBuildBatch } from '../../src/simulation/batchBuilding';
import { advanceGardenBeds } from '../../src/simulation/gardenBeds';
import { GARDEN_BED_GROW_TICKS } from '../../src/config/balance';

afterEach(() => document.body.replaceChildren());
describe('Garden guide live growth', () => {
  it('keeps the harvest control, focus, and scroll position stable as the timer and output change', () => {
    const state = readyGarden(); registerOpeningDiscovery(state); reconcileQuestProgress(state);
    const plan = state.onboarding.garden!.plan!; state.player.x = (plan.tileX + 1.5) * 16; state.player.y = (plan.tileY + 1.5) * 16;
    expect(placeBuildBatch(state, openingGardenBuildRequest(state)).ok).toBe(true); reconcileQuestProgress(state);
    const actions = { onRegister: vi.fn(), onPreview: vi.fn(), onMove: vi.fn(), onHarvest: vi.fn(), onContinue: vi.fn() };
    const guide = new GardenGuide(state, actions);
    guide.attachToMenu({ registerTab: (_id, _label, panel, onActivate) => { document.body.append(panel); onActivate?.(); } } as InventoryPanel);
    const panel = document.querySelector<HTMLElement>('[aria-label="Garden and journey"]')!;
    const harvest = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Collect garden fiber')!;
    expect(harvest.disabled).toBe(true); panel.scrollTop = 250;
    for (let i = 0; i < 60; i++) { state.tick++; advanceGardenBeds(state); }
    guide.refresh();
    expect(harvest.isConnected).toBe(true); expect(panel.scrollTop).toBe(250); expect(panel.textContent).toContain('fiber in 59s');
    for (let i = 60; i < GARDEN_BED_GROW_TICKS; i++) { state.tick++; advanceGardenBeds(state); }
    guide.refresh(); expect(harvest.isConnected).toBe(true); expect(harvest.disabled).toBe(false);
    expect(panel.textContent).toContain('Stored 5/15'); harvest.focus(); guide.refresh(); expect(document.activeElement).toBe(harvest);
    harvest.click(); expect(actions.onHarvest).toHaveBeenCalledOnce(); guide.destroy();
  });
});
