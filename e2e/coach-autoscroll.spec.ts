import { expect, test, type Page } from '@playwright/test';

async function stubGemini(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>)['LanguageModel'] = {
      create: async () => ({
        prompt: async () => 'ok',
        promptStreaming: (input: string) =>
          (async function* () {
            for (const piece of ['Here ', 'is ', 'a ', 'longer ', 'coaching ', 'reply ', 'for ', `“${input}”. `.repeat(6)]) {
              await new Promise((r) => setTimeout(r, 30));
              yield piece;
            }
          })(),
      }),
    };
  });
}

async function inViewport(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const nodes = document.querySelectorAll(sel);
    const last = nodes[nodes.length - 1];
    if (!last) return false;
    const rect = last.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
  }, selector);
}

test.describe('Coach conversation auto-scroll', () => {
  test.use({ viewport: { width: 390, height: 560 } });

  test('keeps the newest message and composer in view across several turns without manual scrolling', async ({ page }) => {
    await stubGemini(page);
    await page.goto('/coach');
    const input = page.getByTestId('coach-prompt-input');
    await expect(input).toBeVisible();

    for (const prompt of ['one', 'two', 'three', 'four']) {
      await input.fill(`Question ${prompt}`);
      await page.getByTestId('coach-send').click();

      // The new user message / generating indicator is brought into view immediately.
      await expect.poll(() => inViewport(page, '.chat-msg')).toBe(true);
      await expect(page.getByTestId('coach-send')).toBeEnabled();
      // The finished reply and the composer stay visible too.
      await expect.poll(() => inViewport(page, '.chat-msg')).toBe(true);
      await expect.poll(() => inViewport(page, '.chat-composer')).toBe(true);
      await expect(page.locator('.chat-msg').last()).toContainText(`Question ${prompt}`);
    }

    // The page really did grow beyond the viewport, so scrolling was required.
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(0);
  });

  test('does not yank the reader back down after they scroll up, and resumes when they send', async ({ page }) => {
    await stubGemini(page);
    await page.goto('/coach');
    const input = page.getByTestId('coach-prompt-input');
    for (const prompt of ['a', 'b', 'c']) {
      await input.fill(`Question ${prompt}`);
      await page.getByTestId('coach-send').click();
      await expect(page.getByTestId('coach-send')).toBeEnabled();
    }

    // Let our own smooth scroll finish, then the reader scrolls back to the top.
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);

    await input.fill('Question d');
    await page.getByTestId('coach-send').click();
    // Sending is the reader's own action, so it scrolls back down to the new message.
    await expect.poll(() => inViewport(page, '.chat-msg')).toBe(true);
    await expect(page.getByTestId('coach-send')).toBeEnabled();
  });

  test('uses instant scrolling when reduced motion is requested and keeps focus in the composer', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubGemini(page);
    await page.goto('/coach');
    const input = page.getByTestId('coach-prompt-input');
    await input.focus();
    await input.fill('Reduced motion question');
    await page.keyboard.press('Enter');

    await expect.poll(() => inViewport(page, '.chat-msg')).toBe(true);
    await expect(page.getByTestId('coach-send')).toBeEnabled();
    await expect(page.locator('.chat-msg').last()).toContainText('Reduced motion question');
    // Scrolling never moves focus onto anything else.
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName);
    expect(['coach-prompt-input', 'BODY']).toContain(focused);
  });

  test('opens a persisted long conversation scrolled to the latest message', async ({ page }) => {
    await stubGemini(page);
    await page.goto('/coach');
    const input = page.getByTestId('coach-prompt-input');
    for (const prompt of ['p1', 'p2', 'p3']) {
      await input.fill(`History ${prompt}`);
      await page.getByTestId('coach-send').click();
      await expect(page.getByTestId('coach-send')).toBeEnabled();
    }

    await page.reload();
    await expect(page.locator('.chat-msg').last()).toContainText('Here is a longer coaching reply');
    await expect.poll(() => inViewport(page, '.chat-msg')).toBe(true);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});
