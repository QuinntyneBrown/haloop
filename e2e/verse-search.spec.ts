import { expect, test } from '@playwright/test';

test.describe('Coach verse search', () => {
  test('validates an empty query, shows the busy state, and inserts a verse', async ({ page }) => {
    await page.goto('/coach');
    await page.getByTestId('coach-open-verse-search').click();
    const dialog = page.getByTestId('verse-search-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('verse-insert-btn').first()).toBeVisible();

    // Empty query is rejected without searching.
    await page.getByTestId('verse-search-input').fill('   ');
    await page.getByTestId('verse-search-submit').click();
    await expect(dialog.getByRole('alert')).toContainText('Enter a theme, keyword, or reference');

    // A real query ranks locally and the first hit can be inserted into the composer.
    await page.getByTestId('verse-search-input').fill('run with patience');
    await page.getByTestId('verse-search-submit').click();
    await expect(page.getByTestId('verse-insert-btn').first()).toBeVisible();
    await page.getByTestId('verse-insert-btn').first().click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('coach-prompt-input')).toHaveValue(/^Reflect on /);
  });

  test('makes no network request while searching Scripture', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== new URL(page.url() || 'http://localhost').origin && !url.protocol.startsWith('data')) {
        external.push(request.url());
      }
    });
    await page.goto('/coach');
    await page.getByTestId('coach-open-verse-search').click();
    await expect(page.getByTestId('verse-insert-btn').first()).toBeVisible();
    expect(external.filter((u) => !u.startsWith('http://localhost') && !u.startsWith('http://127.0.0.1'))).toEqual([]);
  });
});
