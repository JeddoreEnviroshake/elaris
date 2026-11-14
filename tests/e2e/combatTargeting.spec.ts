import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { gatherNearestResource, openAppInStarterGrove } from './gather';

/**
 * Phase 1 of the combat overhaul: one action button that locks on to a target
 * and names it. The lock itself is presentation-only and never reaches the
 * save, so everything here is asserted through the button's own DOM hooks
 * rather than by polling IndexedDB.
 */

const actionButton = '[data-action-button]';

test('the action button starts unlocked and reads Gather', async ({ page }) => {
  await openApp(page);
  const action = page.locator(actionButton);
  await expect(action).toBeVisible();
  await expect(action).toHaveText('Gather');
  await expect(action).toHaveAttribute('data-combat-target', '');
});

test('striking a resource locks it and renames the action button after it', async ({ page }) => {
  await openAppInStarterGrove(page);
  const action = page.locator(actionButton);
  await expect(action).toBeVisible();

  // One connected hit is enough to establish the lock; the helper keeps
  // swinging until the node's health actually moves.
  const hint = page.locator('[data-target-hint]');
  await expect(hint).toHaveAttribute('data-resource-target-kind', 'tree');
  await action.click();

  await expect(action).toHaveAttribute('data-combat-target', /^resource:/);
  await expect(action).toHaveAttribute('data-combat-target-in-range', 'true');
  // The verb names the target, which is what lets one button serve every kind.
  await expect(action).toHaveText('Chop Tree');
  await expect(action).toHaveAttribute('aria-label', 'Chop Tree');
});

test('the lock clears when its node is depleted', async ({ page }) => {
  await openAppInStarterGrove(page);
  const action = page.locator(actionButton);
  await expect(action).toBeVisible();

  await gatherNearestResource(page, 'tree');

  // A depleted node is not a target: the ring would sit over bare ground.
  await expect(action).toHaveAttribute('data-combat-target', '');
});

test('SP and MP bars stay in the DOM but hide themselves while idle', async ({ page }) => {
  await openApp(page);
  const stamina = page.locator('[data-player-stamina]');
  const mana = page.locator('[data-player-mana]');

  // Present and reachable by assistive tech's own rules — hidden, never removed,
  // so the layout slot is reserved and the hooks keep resolving.
  await expect(stamina).toHaveCount(1);
  await expect(mana).toHaveCount(1);
  await expect(stamina).toHaveAttribute('data-vital-hidden', 'true');
  await expect(mana).toHaveAttribute('data-vital-hidden', 'true');
});

test('the SP bar appears once gathering spends stamina', async ({ page }) => {
  await openAppInStarterGrove(page);
  const stamina = page.locator('[data-player-stamina]');
  await expect(stamina).toHaveAttribute('data-vital-hidden', 'true');

  // Every swing costs stamina, so one connected hit is enough to reveal it.
  await page.locator('[data-action-button]').click();

  await expect(stamina).toHaveAttribute('data-vital-hidden', 'false');
  await expect(stamina).toHaveAttribute('aria-hidden', 'false');
  const spacing = await page.evaluate(() => {
    const xp = document.querySelector<HTMLElement>('[data-player-xp]')!.getBoundingClientRect();
    const sp = document.querySelector<HTMLElement>('[data-player-stamina]')!.getBoundingClientRect();
    return { xpBottom: xp.bottom, staminaTop: sp.top };
  });
  // HP is hidden here, so SP must close the stack directly beneath XP rather
  // than keeping an empty HP-sized slot between the two visible bars.
  expect(spacing.staminaTop - spacing.xpBottom).toBeGreaterThanOrEqual(0);
  expect(spacing.staminaTop - spacing.xpBottom).toBeLessThanOrEqual(8);
});

test('the SP bar stays up through regeneration and hides once the value settles', async ({ page }) => {
  await openAppInStarterGrove(page);
  const stamina = page.locator('[data-player-stamina]');

  await page.locator('[data-action-button]').click();
  await expect(stamina).toHaveAttribute('data-vital-hidden', 'false');

  // Regeneration is activity: while stamina is climbing back the bar has to
  // stay up, which is the whole point of watching it refill. Only once the
  // value has stopped moving does the idle window start running.
  await expect(stamina).toHaveAttribute('data-vital-hidden', 'true', { timeout: 20_000 });
});
