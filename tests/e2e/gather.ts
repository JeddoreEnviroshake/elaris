import { expect, type Page } from '@playwright/test';

/** Deplete the nearest untouched starter tree and wait for every hit to land. */
export async function gatherStarterTree(page: Page): Promise<void> {
  const gather = page.getByRole('button', { name: 'Gather' });
  const feedback = page.getByRole('status');
  await expect(gather).toBeVisible();
  await expect(page.getByText(/^Tree 30\/30/)).toBeVisible();

  for (const remainingHp of [25, 20, 15, 10, 5]) {
    await expect(async () => {
      await gather.click();
      await expect(feedback).toHaveText(`Tree ${remainingHp}/30`, { timeout: 1_000 });
    }).toPass({ timeout: 15_000, intervals: [250, 500] });
  }

  await expect(async () => {
    await gather.click();
    await expect(feedback).toHaveText('+4 wood', { timeout: 1_000 });
  }).toPass({ timeout: 15_000, intervals: [250, 500] });
}
