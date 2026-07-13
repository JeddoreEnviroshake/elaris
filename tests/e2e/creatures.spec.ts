import { expect, test } from '@playwright/test';
import { createInitialState } from '../../src/simulation/state';

test('tames, assigns, and restores a Tuftle through reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();

  const state = createInitialState(123);
  const wild = state.wildCreatures.find((creature) => creature.speciesId === 'tuftle')!;
  // Keep this encounter fixture away from the protected service NPCs, which
  // intentionally take context-action priority when they are nearby.
  wild.x = state.player.x + 300;
  wild.y = state.player.y;
  state.player.x = wild.x;
  state.player.y = wild.y;
  // Three full-HP Tuftle snares fill the capture meter (3500 + 3500 + 3000 bps).
  state.inventory.wood = 3;
  state.inventory.fiber = 6;
  state.buildings.push(
    { id: 'cache-fixture', definitionId: 'field-cache', tileX: 2, tileY: 2, storage: { wood: 0, stone: 0, fiber: 0 } },
    { id: 'planter-fixture', definitionId: 'woodlot-planter', tileX: 34, tileY: 27 },
  );
  state.nextEntityId = 3;
  const fixture = {
    meta: { saveVersion: 10, worldGenVersion: 3, contentVersion: 9, appVersion: 'e2e', savedAt: Date.now() },
    state,
  };

  await page.getByRole('button', { name: 'App status and diagnostics' }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import save' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'tuftle-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Start encounter' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await page.getByRole('button', { name: 'Craft Taming Snare' }).click();
  await page.getByRole('button', { name: 'Craft Taming Snare' }).click();
  await page.getByRole('button', { name: 'Craft Taming Snare' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Start encounter' }).click();
  await expect(page.getByRole('dialog', { name: 'Wild creature encounter' })).toBeVisible();
  await page.getByRole('button', { name: 'Throw Snare' }).click();
  await page.getByRole('button', { name: 'Throw Snare' }).click();
  await page.getByRole('button', { name: 'Throw Snare' }).click();
  await expect(page.getByText(/joined you/)).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Creatures' }).click();
  await expect(page.getByText('Creature roster', { exact: true })).toBeVisible();
  await expect(page.getByText('Travels with you · Improves nearby plant gathering')).toBeVisible();
  await expect(page.getByText('Automatically gathers fiber at the nearest eligible worksite.')).toBeVisible();
  await expect(page.getByText('Stops following or working and remains inactive.')).toBeVisible();
  await page.getByRole('button', { name: 'Work selected creature' }).click();
  await expect(page.getByText(/Tuftle assigned to/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Select Tuftle, Tuftle, currently work/ })).toBeVisible();

  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Creatures' }).click();
  await expect(page.getByRole('button', { name: /Select Tuftle, Tuftle, currently work/ })).toBeVisible();
  await expect(page.getByText(/Worksite: woodlot-planter/)).toBeVisible();
});
