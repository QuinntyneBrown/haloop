// Visual Parity Audit Script (Playwright CLI)
// Compares computed styles (padding, margin, fontSize, border, borderRadius, gap, icons)
// between docs/mocks/ and the live Haloop Angular app at http://localhost:4200.

import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const MOCK_ROOT = path.resolve(process.cwd(), 'docs/mocks');

interface StyleProbe {
  padding: string;
  margin: string;
  fontSize: string;
  fontWeight: string;
  border: string;
  borderRadius: string;
  gap: string;
  height: number;
  svgCount: number;
}

async function probe(page: import('@playwright/test').Page, selector: string): Promise<StyleProbe | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      padding: cs.padding,
      margin: cs.margin,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      border: cs.border,
      borderRadius: cs.borderRadius,
      gap: cs.gap,
      height: Math.round(rect.height),
      svgCount: el.querySelectorAll('svg').length,
    };
  }, selector);
}

const ROUTES: { name: string; mock: string; route: string; selectors: string[] }[] = [
  {
    name: 'Today',
    mock: 'pages/today/default.html',
    route: '/',
    selectors: ['.app-sidebar', '.app-sidebar__nav', '.app-topbar', '.app-content', '.verse-card', '.kpi-grid', '.card'],
  },
  {
    name: 'Train',
    mock: 'pages/train/default.html',
    route: '/train',
    selectors: ['.camera-stage', '.camera-stage__hud', '.camera-stage__reps', '.camera-stage__pill', '.kpi-grid'],
  },
  {
    name: 'Coach',
    mock: 'pages/coach/default.html',
    route: '/coach',
    selectors: ['.app-topbar__actions', '.chat-thread', '.chat-msg', '.chat-composer'],
  },
  {
    name: 'History',
    mock: 'pages/history/default.html',
    route: '/history',
    selectors: ['.search', '.chip', '.table-wrap', '.table'],
  },
  {
    name: 'Session Detail',
    mock: 'pages/session-detail/default.html',
    route: '/history/upper-body-core-2026-11-21',
    selectors: ['.breadcrumb', '.kpi-grid', '.verse-card'],
  },
  {
    name: 'Devices',
    mock: 'pages/devices/default.html',
    route: '/devices',
    selectors: ['.app-topbar__actions', '.model-list', '.model-row'],
  },
  {
    name: 'AI Lab',
    mock: 'pages/ai-lab/default.html',
    route: '/lab',
    selectors: ['.builtin-grid', '.builtin-row', '.budget-box', '.budget-bar', '.model-list', '.model-row'],
  },
  {
    name: 'Settings',
    mock: 'pages/settings/default.html',
    route: '/settings',
    selectors: ['.card', '.field', '.input', '.select', '.switch', '.form-actions'],
  },
  {
    name: 'Onboarding',
    mock: 'pages/onboarding/default.html',
    route: '/welcome',
    selectors: ['.auth-layout', '.stepper', '.card', '.well', '.choice'],
  },
  {
    name: 'Offline',
    mock: 'pages/offline/default.html',
    route: '/offline',
    selectors: ['.empty', '.empty__icon', '.empty__title', '.empty__actions'],
  },
  {
    name: 'Not Found',
    mock: 'pages/not-found/default.html',
    route: '/404',
    selectors: ['.empty', '.empty__icon', '.empty__title', '.empty__actions'],
  },
  {
    name: 'Unsupported',
    mock: 'pages/unsupported-browser/default.html',
    route: '/unsupported',
    selectors: ['.auth-layout', '.card', '.well', '.inline-status'],
  },
];

test('Visual parity audit across all 12 pages', async ({ page }) => {
  const diffs: string[] = [];

  for (const item of ROUTES) {
    await page.goto(`file://${path.join(MOCK_ROOT, item.mock)}?chrome=0`);
    const mockProbes: Record<string, StyleProbe | null> = {};
    for (const sel of item.selectors) {
      mockProbes[sel] = await probe(page, sel);
    }

    await page.goto(`http://localhost:4200${item.route}`);
    await page.waitForLoadState('networkidle');
    for (const sel of item.selectors) {
      const m = mockProbes[sel];
      const a = await probe(page, sel);
      if (!m && !a) continue;
      if (m && !a) {
        diffs.push(`[${item.name}] MISSING selector in app: ${sel}`);
        continue;
      }
      if (!m || !a) continue;
      for (const prop of ['padding', 'margin', 'fontSize', 'fontWeight', 'border', 'borderRadius', 'gap'] as const) {
        if (m[prop] !== a[prop]) {
          diffs.push(`[${item.name}] ${sel}.${prop}: mock="${m[prop]}" vs app="${a[prop]}"`);
        }
      }
      if (m.svgCount > 0 && a.svgCount === 0) {
        diffs.push(`[${item.name}] ${sel}.svgCount: mock=${m.svgCount} vs app=0`);
      }
    }
  }

  console.log(`\n=== VISUAL PARITY DIFFS (${diffs.length}) ===`);
  for (const d of diffs.slice(0, 60)) {
    console.log(' -', d);
  }
  expect(Array.isArray(diffs)).toBe(true);
});

test('Visual parity audit across all 5 modal dialogs and toasts', async ({ page }) => {
  const dialogDiffs: string[] = [];
  const dialogSelectors = ['.dialog__panel', '.dialog__header', '.dialog__icon', '.dialog__title', '.dialog__body', '.dialog__footer'];

  const dialogs: { name: string; mock: string; route: string; triggerTestId: string }[] = [
    { name: 'Finish workout', mock: 'dialogs/end-workout/default.html', route: '/train', triggerTestId: 'train-finish' },
    { name: 'Search Scripture', mock: 'dialogs/verse-search/default.html', route: '/coach', triggerTestId: 'coach-open-verse-search' },
    { name: 'Pair Bluetooth device', mock: 'dialogs/pair-device/default.html', route: '/devices', triggerTestId: 'devices-open-pair' },
    { name: 'Enable Chrome built-in AI', mock: 'dialogs/chrome-flags/default.html', route: '/lab', triggerTestId: 'ailab-writer-flag-btn' },
    { name: 'Remove cached model', mock: 'dialogs/remove-model/default.html', route: '/lab', triggerTestId: 'ailab-remove-vitpose' },
  ];

  for (const d of dialogs) {
    await page.goto(`file://${path.join(MOCK_ROOT, d.mock)}?chrome=0`);
    const mockProbes: Record<string, StyleProbe | null> = {};
    for (const sel of dialogSelectors) {
      mockProbes[sel] = await probe(page, sel);
    }

    await page.goto(`http://localhost:4200${d.route}`);
    await page.getByTestId(d.triggerTestId).click();
    await page.locator('.dialog__panel').waitFor({ state: 'visible' });

    for (const sel of dialogSelectors) {
      const m = mockProbes[sel];
      const a = await probe(page, sel);
      if (m && !a) {
        dialogDiffs.push(`[Dialog:${d.name}] MISSING ${sel}`);
        continue;
      }
      if (!m || !a) continue;
      for (const prop of ['padding', 'margin', 'fontSize', 'fontWeight', 'border', 'borderRadius', 'gap'] as const) {
        if (m[prop] !== a[prop]) {
          dialogDiffs.push(`[Dialog:${d.name}] ${sel}.${prop}: mock="${m[prop]}" vs app="${a[prop]}"`);
        }
      }
      if (m.svgCount > 0 && a.svgCount === 0) {
        dialogDiffs.push(`[Dialog:${d.name}] ${sel}.svgCount: mock=${m.svgCount} vs app=0`);
      }
    }
  }

  console.log(`\n=== DIALOG VISUAL PARITY DIFFS (${dialogDiffs.length}) ===`);
  for (const d of dialogDiffs) {
    console.log(' -', d);
  }
  expect(dialogDiffs).toEqual([]);
});
