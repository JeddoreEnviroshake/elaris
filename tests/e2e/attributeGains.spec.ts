import { openAdmin } from './menu';
import { expect, test } from '@playwright/test';
import { openApp } from './app';

/**
 * Global Values owns what one attribute point is worth. The card's own heading
 * is the readout — it is generated from the staged values by the same function
 * the character sheet uses, so an edit that does not move the sentence means
 * the editor and the simulation have come apart.
 */
test('edits the per-point value an attribute grants', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);
  await page.getByRole('tab', { name: 'Global Values' }).click();

  const speed = page.locator('[data-testid="admin-attribute-gains-speed"]');
  await speed.scrollIntoViewIfNeeded();
  await expect(speed).toContainText('Each point adds 10 px/s movement speed');

  await speed.locator('summary').click();
  const perPoint = speed.getByLabel('Walk speed per point (px/s)');
  await perPoint.fill('');
  await perPoint.pressSequentially('25');

  await expect(speed).toContainText('Each point adds 25 px/s movement speed');
});

/**
 * Regeneration is stored in hundredths so the save stays whole-numbered, but
 * the editor has to accept and echo the decimal the player is promised —
 * a rate that could only be typed as a whole number is what made the stat
 * overpowered in the first place.
 */
test('tunes health regeneration in decimals', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);
  await page.getByRole('tab', { name: 'Global Values' }).click();

  const regen = page.locator('[data-testid="admin-attribute-gains-healthRegen"]');
  await regen.scrollIntoViewIfNeeded();
  await expect(regen).toContainText('Each point recovers 0.25 more health per second');

  await regen.locator('summary').click();
  const perPoint = regen.getByLabel('HP per second, per point');
  await perPoint.fill('');
  await perPoint.pressSequentially('0.5');

  await expect(regen).toContainText('Each point recovers 0.5 more health per second');
});
