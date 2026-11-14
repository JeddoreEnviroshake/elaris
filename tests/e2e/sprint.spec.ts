import { expect, test } from '@playwright/test';
import { openApp } from './app';

/**
 * The Sprint toggle is presentation state — the scene reads it each frame to
 * build the move intent — so it is asserted through the button's own DOM hooks.
 * How far a sprint travels and what it costs in stamina are covered by the
 * deterministic movement unit tests.
 */

const sprint = '[data-sprint-toggle]';

test('offers a Sprint toggle that starts off', async ({ page }) => {
  await openApp(page);
  const button = page.locator(sprint);
  await expect(button).toBeVisible();
  await expect(button).toHaveText('Sprint');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAttribute('data-sprint-active', 'false');
  // The published values reach the player without opening the character sheet.
  await expect(button).toHaveAttribute('title', 'Sprint: 1.5x walking speed for 2 SP per second');
});

test('turns sprinting on and off again', async ({ page }) => {
  await openApp(page);
  const button = page.locator(sprint);
  await expect(button).toBeVisible();

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('data-sprint-active', 'true');

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAttribute('data-sprint-active', 'false');
});
