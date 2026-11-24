// Acceptance Test
// Traces to: L2-001, L2-002, L2-004, L2-005, L2-006, L2-007, L2-009, L2-010, L2-011, L2-012, L2-014, L2-015, L2-016, L2-017, L2-018, L2-019, L2-020, L2-021, L2-022, L2-023, L2-024, L2-025, L2-027, L2-028, L2-031, L2-032, L2-033, L2-034
// Description: Full end-to-end Playwright CLI walkthrough exercising every Haloop feature and recording a video demonstration.

import { expect, test } from '@playwright/test';

test('Haloop complete feature walkthrough with video recording', async ({ page }) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('http://localhost:4200') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      externalRequests.push(url);
    }
  });

  // Headless Chromium has no Bluetooth chooser, so stand in a heart-rate strap that streams 138 bpm.
  await page.addInitScript(() => {
    const characteristic = (bytes: number[]) => {
      const target = new EventTarget() as EventTarget & { value?: DataView; startNotifications(): Promise<unknown>; readValue(): Promise<DataView> };
      target.value = new DataView(new Uint8Array(bytes).buffer);
      target.startNotifications = async () => {
        setTimeout(() => target.dispatchEvent(new Event('characteristicvaluechanged')), 50);
        return target;
      };
      target.readValue = async () => new DataView(new Uint8Array([87]).buffer);
      return target;
    };
    const hr = characteristic([0x00, 138]);
    const battery = characteristic([87]);
    const gatt = {
      connected: false,
      connect: async () => gatt,
      disconnect: () => undefined,
      getPrimaryService: async (service: string) => ({
        getCharacteristic: async (name: string) => {
          if (service === 'heart_rate' && name === 'heart_rate_measurement') return hr;
          if (service === 'battery_service' && name === 'battery_level') return battery;
          throw new DOMException('not found', 'NotFoundError');
        },
      }),
    };
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        getAvailability: async () => true,
        requestDevice: async () => Object.assign(new EventTarget(), { id: 'e2e-strap', name: 'E2E Strap', gatt }),
      },
    });
  });

  // 1. Onboarding (/welcome) — validation & completion (L2-002)
  await page.goto('/welcome');
  await expect(page.getByRole('heading', { name: 'Welcome to Haloop' })).toBeVisible();
  await page.waitForTimeout(500);

  await page.getByTestId('onboarding-name-input').fill('   ');
  await page.getByTestId('onboarding-continue').click();
  await expect(page.getByTestId('onboarding-error-summary')).toBeVisible();
  await page.waitForTimeout(500);

  await page.getByTestId('onboarding-name-input').fill('Micah Osei');
  await page.getByTestId('onboarding-continue').click();
  await expect(page.getByTestId('onboarding-success')).toContainText('You’re ready, Micah');
  await page.waitForTimeout(600);

  // 2. Today dashboard (/) (L2-007)
  await page.getByRole('link', { name: 'Open Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByText('Isaiah 40:31')).toBeVisible();
  await expect(page.getByText('Morning Strength & Mobility')).toBeVisible();
  await page.waitForTimeout(700);

  // 3. Live Workout Studio (/train) + Finish workout dialog (L2-009, L2-010, L2-011)
  await page.getByTestId('today-start-session').click();
  await expect(page.getByText('Camera local · never uploaded')).toBeVisible();
  await page.getByTestId('train-log-rep').click();
  await page.getByTestId('train-log-rep').click();
  await expect(page.getByTestId('train-reps')).toContainText('10 / 12');
  await page.waitForTimeout(500);

  await page.getByTestId('train-pause').click();
  await expect(page.getByTestId('train-paused-banner')).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByTestId('train-resume').click();

  await page.getByTestId('train-finish').click();
  await expect(page.getByTestId('end-workout-dialog')).toBeVisible();
  await page.getByTestId('end-workout-note').fill('x'.repeat(285));
  await page.getByTestId('end-workout-save').click();
  await expect(page.getByTestId('end-workout-note-error')).toContainText('280 characters');
  await page.waitForTimeout(500);

  await page.getByTestId('end-workout-note').fill('Steady morning session with smooth depth.');
  await page.getByTestId('end-workout-save').click();

  // 4. Session detail (/history/:id) & History (/history) (L2-015, L2-016, L2-017)
  await expect(page).toHaveURL(/\/history\/morning-strength-/);
  await expect(page.getByText('Steady morning session with smooth depth.')).toBeVisible();
  await page.waitForTimeout(700);

  await page.getByRole('link', { name: 'History', exact: true }).first().click();
  await expect(page.getByText('Weekly recap · Chrome Summarizer')).toBeVisible();
  await page.getByTestId('history-filter-run').click();
  await page.waitForTimeout(400);
  await page.getByTestId('history-search').fill('kettlebell');
  await expect(page.getByTestId('history-no-results')).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByTestId('history-clear-filters').click();
  await expect(page.getByText('Upper Body & Core')).toBeVisible();
  await page.waitForTimeout(500);

  // 5. Coach (/coach) & Semantic Scripture Search dialog (L2-012, L2-014)
  await page.getByRole('link', { name: 'Coach', exact: true }).first().click();
  await expect(page.getByText('On-device · Private')).toBeVisible();
  await page.getByTestId('coach-open-verse-search').click();
  await expect(page.getByTestId('verse-search-dialog')).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByTestId('verse-insert-btn').first().click();
  await page.getByTestId('coach-send').click();
  await expect(page.getByText('Hebrews 12:1 — run with patience')).toBeVisible();
  // Gemini Nano is absent and Qwen2.5-0.5B-Instruct is not cached here, so the reply is the labelled last resort.
  await expect(page.getByText('Haloop Coach · Deterministic fallback')).toBeVisible();
  await page.waitForTimeout(600);

  // 6. Web Bluetooth Devices (/devices) & Pair dialog + Toast (L2-018, L2-019, L2-020)
  await page.getByRole('link', { name: 'Devices', exact: true }).first().click();
  await expect(page.getByText('Polar H10')).toBeVisible();
  await page.getByTestId('devices-open-pair').click();
  await expect(page.getByTestId('pair-device-dialog')).toBeVisible();
  await page.getByTestId('pair-device-label').fill('  ');
  await page.getByTestId('pair-device-submit').click();
  await expect(page.getByTestId('pair-device-error')).toBeVisible();
  await page.getByTestId('pair-device-label').fill('Wahoo TICKR Fit');
  await page.getByTestId('pair-device-submit').click();
  await expect(page.getByTestId('device-toast')).toContainText('Wahoo TICKR Fit connected');
  await page.waitForTimeout(600);

  // 7. AI Lab (/lab) — Chrome flags, Download, Remove model & Toasts (L2-021, L2-022, L2-023)
  await page.getByRole('link', { name: 'AI Lab', exact: true }).first().click();
  await expect(page.getByText('286 MB cached')).toBeVisible();
  await page.getByTestId('ailab-writer-flag-btn').click();
  await expect(page.getByTestId('chrome-flags-dialog')).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByTestId('chrome-flags-recheck').click();
  await page.waitForTimeout(400);

  // The Qwen2.5-0.5B-Instruct row performs a real ~480 MB Hugging Face download, so this hermetic walkthrough
  // exercises the Remove and Download flows on a core model and leaves the Coach fallback uncached.
  await expect(page.getByTestId('ailab-download-qwen')).toBeVisible();
  await page.getByTestId('ailab-remove-minilm').click();
  await expect(page.getByTestId('remove-model-dialog')).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByTestId('remove-model-confirm').click();
  await expect(page.getByText('263 MB cached')).toBeVisible();
  await page.waitForTimeout(500);

  await page.getByTestId('ailab-download-minilm').click();
  await expect(page.getByText('286 MB cached')).toBeVisible();
  await page.waitForTimeout(500);

  // 8. Settings (/settings) — < 512 MB validation + Spanish translation + Save (L2-024)
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await page.getByTestId('settings-cache-budget').fill('256');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-budget-error')).toContainText('at least 512 MB');
  await page.waitForTimeout(500);

  await page.getByTestId('settings-cache-budget').fill('2048');
  await page.getByTestId('settings-language').selectOption('es');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-success')).toContainText('Preferences saved on this device');
  await page.waitForTimeout(500);

  // 9. Dark theme, Offline (/offline), 404 (/404), Unsupported (/unsupported) (L2-001, L2-006, L2-025, L2-033)
  await page.getByTestId('theme-toggle').click();
  await page.waitForTimeout(500);
  await page.goto('/');
  await expect(page.getByText('nuevas fuerzas')).toBeVisible();
  await page.waitForTimeout(500);

  await page.goto('/offline');
  await expect(page.getByText('You’re offline—Haloop still works')).toBeVisible();
  await page.waitForTimeout(500);

  await page.goto('/does-not-exist');
  await expect(page.getByText('We couldn’t find that page')).toBeVisible();
  await page.waitForTimeout(500);

  await page.goto('/unsupported');
  await expect(page.getByText('Chrome is recommended for Haloop')).toBeVisible();
  await page.waitForTimeout(500);

  // 10. Mobile responsive viewport (< 576px, L2-032) & XSS safety (L2-028)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.phone-tabs')).toBeVisible();
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await page.waitForTimeout(500);

  await page.goto('/settings');
  await page.getByTestId('settings-display-name').fill('<script>alert(1)</script>Micah');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-success')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('<script>alert(1)</script>Micah')).toBeVisible();
  await page.waitForTimeout(400);

  // Zero console errors and zero outbound third-party network calls (L2-027)
  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
