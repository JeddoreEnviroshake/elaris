import { expect, test } from '@playwright/test';
import { openAppInStarterGrove } from './gather';

/**
 * Holding the action button keeps swinging at a resource, so felling a grove
 * tree takes one press instead of one press per hit.
 *
 * State-driven, like every other gathering test: the target hint carries the
 * struck node's HP, and the toast is deliberately suppressed while striking.
 */
test('keeps hitting a resource for as long as the action button is held', async ({ page }) => {
  await openAppInStarterGrove(page);
  const action = page.locator('[data-action-button]');
  await expect(action).toBeVisible();

  const hint = page.locator('[data-target-hint]');
  await expect(hint).toHaveAttribute('data-resource-target-id', /.+/);
  const before = await hint.evaluate((element) => ({
    id: (element as HTMLElement).dataset.resourceTargetId!,
    hp: Number((element as HTMLElement).dataset.resourceTargetHp),
  }));

  // One press, held: no clicks in between, so anything that lands after the
  // first swing came from the hold itself.
  const box = (await action.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();

  // Either the node took more than the single swing a tap would land, or it
  // fell outright and the lock moved on — both prove the repeat fired.
  const after = await hint.evaluate((element, id) => {
    const data = (element as HTMLElement).dataset;
    return data.resourceTargetId === id ? Number(data.resourceTargetHp) : 0;
  }, before.id);
  expect(after).toBeLessThan(before.hp - 1);

  // Releasing stops it: the HP must hold still once the thumb is up.
  const settled = await hint.evaluate((element, id) => {
    const data = (element as HTMLElement).dataset;
    return data.resourceTargetId === id ? Number(data.resourceTargetHp) : 0;
  }, before.id);
  await page.waitForTimeout(1500);
  const stillSettled = await hint.evaluate((element, id) => {
    const data = (element as HTMLElement).dataset;
    return data.resourceTargetId === id ? Number(data.resourceTargetHp) : 0;
  }, before.id);
  expect(stillSettled).toBe(settled);
});
