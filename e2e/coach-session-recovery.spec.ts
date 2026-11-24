// Acceptance Test
// Traces to: L2-012, L2-013
// Description: Verify the Coach "Gemini Nano session interrupted" recovery flow (Restart session, Open AI Lab)
// and live token streaming on /coach using a stubbed Chrome Prompt API.

import { expect, test } from '@playwright/test';

test.describe('Coach Gemini Nano streaming and session recovery', () => {
  test('streams tokens live and recovers from an interrupted session via Restart session', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      let broken = false;
      w['__breakGemini'] = () => {
        broken = true;
      };
      w['__fixGemini'] = () => {
        broken = false;
      };
      w['LanguageModel'] = {
        create: async () => ({
          prompt: async () => 'Keep it light today.',
          promptStreaming: (input: string) =>
            (async function* () {
              if (broken) throw new DOMException('session destroyed', 'InvalidStateError');
              for (const piece of ['Keep ', 'it ', 'light ', `today (${input.length}).`]) {
                await new Promise((r) => setTimeout(r, 120));
                yield piece;
              }
            })(),
        }),
      };
    });

    await page.goto('/coach');
    await expect(page.getByTestId('coach-prompt-input')).toBeVisible();

    // Live streaming: partial text shows before the reply completes.
    await page.getByTestId('coach-prompt-input').fill('Pace my run');
    await page.getByTestId('coach-send').click();
    await expect(page.getByTestId('coach-send')).toBeDisabled();
    await expect(page.getByTestId('coach-streaming-text')).toContainText('Keep');
    await expect(page.getByText('Keep it light today (11).')).toBeVisible();
    await expect(page.getByTestId('coach-send')).toBeEnabled();

    // An interrupted session surfaces recovery actions.
    await page.evaluate(() => (window as unknown as { __breakGemini: () => void }).__breakGemini());
    await page.getByTestId('coach-prompt-input').fill('Still there?');
    await page.getByTestId('coach-send').click();
    const alert = page.getByRole('alert').filter({ hasText: 'Gemini Nano session interrupted' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Restart session' })).toBeVisible();
    await expect(alert.getByRole('link', { name: 'Open AI Lab' })).toHaveAttribute('href', '/lab');

    // Restart session recovers cleanly.
    await page.evaluate(() => (window as unknown as { __fixGemini: () => void }).__fixGemini());
    await alert.getByRole('button', { name: 'Restart session' }).click();
    await expect(page.getByText('Gemini Nano session interrupted')).toBeHidden();
    await page.getByTestId('coach-prompt-input').fill('Back again');
    await page.getByTestId('coach-send').click();
    await expect(page.getByText('Keep it light today (10).')).toBeVisible();
  });

  test('Open AI Lab from the interrupted state navigates to /lab', async ({ page }) => {
    await page.addInitScript(() => {
      let used = false;
      (window as unknown as Record<string, unknown>)['LanguageModel'] = {
        create: async () => ({
          prompt: async () => {
            if (used) throw new DOMException('session destroyed', 'InvalidStateError');
            used = true;
            return 'First reply works.';
          },
        }),
      };
    });
    await page.goto('/coach');
    await page.getByTestId('coach-prompt-input').fill('One');
    await page.getByTestId('coach-send').click();
    await expect(page.getByText('First reply works.')).toBeVisible();
    await page.getByTestId('coach-prompt-input').fill('Two');
    await page.getByTestId('coach-send').click();
    await page.getByRole('link', { name: 'Open AI Lab' }).click();
    await expect(page).toHaveURL(/\/lab$/);
  });
});
