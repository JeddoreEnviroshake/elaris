import type { Page } from '@playwright/test';

/**
 * Route long journeys with single-tile DOM input. Deliver each press/release
 * together so test-driver latency cannot turn a tap into a held repeat. The
 * separate d-pad browser tests exercise trusted mouse hit-testing as well.
 */
export async function stepDpad(page: Page, direction: 'up' | 'down' | 'left' | 'right'): Promise<void> {
  await page.locator(`[data-dpad-arrow="${direction}"]`).evaluate((arrow) => {
    const box = arrow.getBoundingClientRect();
    const clientX = box.x + box.width / 2;
    const clientY = box.y + box.height / 2;
    const zone = arrow.closest('[data-dpad-base]')!.parentElement!;
    if (document.elementFromPoint(clientX, clientY) !== zone) throw new Error('Movement pad is covered');
    const init = { pointerId: 901, pointerType: 'touch', bubbles: true, clientX, clientY, button: 0 };
    zone.dispatchEvent(new PointerEvent('pointerdown', init));
    zone.dispatchEvent(new PointerEvent('pointerup', init));
  });
}
