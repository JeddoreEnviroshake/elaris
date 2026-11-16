import { openAdmin } from './menu';
import { expect, test, type Locator } from '@playwright/test';
import { openApp } from './app';

/**
 * The raid dials are the ones reached for after a raid goes badly, so they are
 * checked end to end: every one has to be reachable, labelled, and showing the
 * live value.
 *
 * These assert shape rather than specific numbers. Global values come from the
 * published Firebase document when one is reachable, so any exact figure here
 * would fail the moment somebody retunes the game — which is the whole point of
 * the panel.
 */
async function expectWholeNumber(field: Locator): Promise<number> {
  // Scrolled to first, the way a player reaches a field: the panel is a long
  // scrolling list, and on a phone viewport a card's last rows sit below the
  // fold. Asserting visibility without scrolling measures the viewport height
  // rather than whether the dial is there. Scrolled through the DOM rather
  // than with `scrollIntoViewIfNeeded`, whose actionability checks trip over
  // the panel's own scroll container.
  await field.evaluate((element) => { element.scrollIntoView({ block: 'center' }); });
  await expect(field).toBeVisible();
  const value = Number(await field.inputValue());
  expect(Number.isFinite(value)).toBe(true);
  return value;
}

test('Admin exposes raid timing, wave size, and exposure tuning', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);
  await page.getByRole('tab', { name: 'Global Values' }).click();

  // Every danger element carries its own length, and each one has to be reachable.
  await expectWholeNumber(page.getByLabel('Poison Fog phase (seconds)'));
  const raidNight = await expectWholeNumber(page.getByLabel('Night Raid phase (seconds)'));
  const delay = await expectWholeNumber(page.getByLabel('Raider spawn delay (seconds)'));
  // The warning window has to fit inside the raid night, or no wave ever lands.
  expect(delay).toBeLessThan(raidNight);

  await expectWholeNumber(page.getByLabel('Safe phase (seconds)'));
  await expectWholeNumber(page.getByLabel('Grace before exposure (seconds)'));
  const first = await expectWholeNumber(page.getByLabel('Exposure HP/s at first'));
  await expectWholeNumber(page.getByLabel('Exposure ramp HP/s'));
  const ceiling = await expectWholeNumber(page.getByLabel('Exposure HP/s maximum'));
  expect(first).toBeLessThanOrEqual(ceiling);

  const base = await expectWholeNumber(page.getByLabel('Raiders in the first wave'));
  const max = await expectWholeNumber(page.getByLabel('Maximum raiders per wave'));
  expect(base).toBeLessThanOrEqual(max);
  await expect(page.getByLabel('Target priority')).toHaveValue(/purifier-last|purifier-first|nearest/);
});

test('Admin exposes per-raider, defence, structure, and creature stats', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);
  await page.getByRole('tab', { name: 'Global Values' }).click();

  await page.getByText(/^Breaker ·/).click();
  const breaker = page.locator('details', { has: page.getByText(/^Breaker ·/) });
  for (const label of [
    'Max HP', 'Speed (px/tick)', 'Damage per hit', 'Damage to you',
    'Attack cooldown (ticks)', 'Wall damage (%)', 'First raid it appears',
    'Aggro range (px, 0 = never)', 'Level Multiplier (bps)',
  ]) await expectWholeNumber(breaker.getByLabel(label));

  for (const label of [
    'Turret damage', 'Turret cooldown (ticks)', 'Turret range (tiles)', 'Turret arrow capacity',
    'Turret shots when away', 'Your shot damage', 'Your shot cooldown (ticks)', 'Your shot range (tiles)',
    'Raider aggro range (tiles)',
  ]) await expectWholeNumber(page.getByLabel(label));

  const wood = await expectWholeNumber(page.getByLabel('Wood wall HP'));
  const thatch = await expectWholeNumber(page.getByLabel('Thatch wall HP'));
  expect(wood).toBeGreaterThan(thatch);
  await expectWholeNumber(page.getByLabel('Air Purifier HP'));
  await expectWholeNumber(page.getByLabel('Turret HP'));

  await page.getByText(/^Snarlfox ·/).click();
  const snarlfox = page.locator('details', { has: page.getByText(/^Snarlfox ·/) });
  for (const label of [
    'Max HP', 'Attack power', 'Defense', 'Tame ease (bps)', 'Dodge chance (bps)',
    'Aggro range (px, 0 = never)', 'Level Multiplier (bps)',
  ]) await expectWholeNumber(snarlfox.getByLabel(label));

  // The bands that decide what level a player meets where, and how thickly the
  // world is stocked, are dials like any other.
  for (const label of [
    'Tiles per level band', 'Levels per area ring', 'Maximum enemy level', 'Creatures per area',
  ]) await expectWholeNumber(page.getByLabel(label));
});
