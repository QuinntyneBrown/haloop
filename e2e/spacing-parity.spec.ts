// Spacing-Only Visual Parity Audit (Playwright CLI)
// Compares margins, padding, gaps, child spacing, and responsive bounding geometry
// between docs/mocks/ and http://localhost:4200 at Desktop (1280x800) and Mobile (390x844).

import { expect, test } from '@playwright/test';
import { installHuggingFaceFixture } from './support/hf-fixture';
import * as path from 'node:path';

const MOCK_ROOT = path.resolve(process.cwd(), 'docs/mocks');

interface SpacingMetrics {
  mainPadding: string;
  mainGap: string;
  mainDisplay: string;
  directChildGaps: number[];
  horizontalOverflowPx: number;
  contentHeight: number;
  topbarHeight: number;
  sidebarWidth: number;
}

async function measureSpacing(page: import('@playwright/test').Page): Promise<SpacingMetrics> {
  return page.evaluate(() => {
    const main = document.querySelector('main#main') as HTMLElement | null;
    const topbar = document.querySelector('.app-topbar') as HTMLElement | null;
    const sidebar = document.querySelector('.app-sidebar') as HTMLElement | null;
    const cs = main ? getComputedStyle(main) : null;

    // Inspect visible top-level layout blocks inside main (unwrapping Angular host if not display:contents)
    let blocks: Element[] = [];
    if (main) {
      const direct = Array.from(main.children).filter((el) => el.tagName !== 'ROUTER-OUTLET');
      if (direct.length === 1 && direct[0].tagName.startsWith('APP-') && getComputedStyle(direct[0]).display !== 'contents') {
        blocks = Array.from(direct[0].children);
      } else if (direct.length === 1 && direct[0].tagName.startsWith('APP-') && getComputedStyle(direct[0]).display === 'contents') {
        blocks = Array.from(direct[0].children);
      } else {
        blocks = direct;
      }
    }

    const visibleBlocks = blocks
      .filter((el) => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.position !== 'fixed' && el.getBoundingClientRect().height > 0;
      })
      .map((el) => el.getBoundingClientRect());

    const directChildGaps: number[] = [];
    for (let i = 1; i < visibleBlocks.length; i++) {
      directChildGaps.push(Math.round(visibleBlocks[i].top - visibleBlocks[i - 1].bottom));
    }

    return {
      mainPadding: cs?.padding ?? 'none',
      mainGap: cs?.gap ?? 'none',
      mainDisplay: cs?.display ?? 'none',
      directChildGaps,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      contentHeight: main ? Math.round(main.getBoundingClientRect().height) : 0,
      topbarHeight: topbar ? Math.round(topbar.getBoundingClientRect().height) : 0,
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
    };
  });
}

const PAGES = [
  { name: 'Today', mock: 'pages/today/default.html', route: '/' },
  { name: 'Train', mock: 'pages/train/default.html', route: '/train' },
  { name: 'Coach', mock: 'pages/coach/default.html', route: '/coach' },
  { name: 'History', mock: 'pages/history/default.html', route: '/history' },
  { name: 'Session Detail', mock: 'pages/session-detail/default.html', route: '/history/upper-body-core-2026-11-21' },
  { name: 'Devices', mock: 'pages/devices/default.html', route: '/devices' },
  { name: 'AI Lab', mock: 'pages/ai-lab/default.html', route: '/lab' },
  { name: 'Settings', mock: 'pages/settings/default.html', route: '/settings' },
  { name: 'Onboarding', mock: 'pages/onboarding/default.html', route: '/welcome' },
  { name: 'Offline', mock: 'pages/offline/default.html', route: '/offline' },
  { name: 'Not Found', mock: 'pages/not-found/default.html', route: '/404' },
  { name: 'Unsupported', mock: 'pages/unsupported-browser/default.html', route: '/unsupported' },
];

test('Spacing parity audit (Desktop 1280x800 & Mobile 390x844)', async ({ page }) => {
  await installHuggingFaceFixture(page);
  const diffs: string[] = [];

  for (const vp of [
    { label: 'Desktop', width: 1280, height: 800 },
    { label: 'Mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const p of PAGES) {
      await page.goto(`file://${path.join(MOCK_ROOT, p.mock)}?chrome=0`);
      const m = await measureSpacing(page);

      await page.goto(`http://localhost:4200${p.route}`);
      await page.waitForLoadState('networkidle');
      const a = await measureSpacing(page);

      if (m.mainPadding !== a.mainPadding) {
        diffs.push(`[${vp.label}][${p.name}] main.padding: mock="${m.mainPadding}" vs app="${a.mainPadding}"`);
      }
      if (m.mainGap !== a.mainGap) {
        diffs.push(`[${vp.label}][${p.name}] main.gap: mock="${m.mainGap}" vs app="${a.mainGap}"`);
      }
      if (JSON.stringify(m.directChildGaps) !== JSON.stringify(a.directChildGaps)) {
        diffs.push(
          `[${vp.label}][${p.name}] section-gaps: mock=${JSON.stringify(m.directChildGaps)} vs app=${JSON.stringify(a.directChildGaps)}`,
        );
      }
      if (a.horizontalOverflowPx > 0) {
        diffs.push(`[${vp.label}][${p.name}] horizontalOverflow=${a.horizontalOverflowPx}px`);
      }
      if (Math.abs(m.topbarHeight - a.topbarHeight) > 2) {
        diffs.push(`[${vp.label}][${p.name}] topbarHeight: mock=${m.topbarHeight}px vs app=${a.topbarHeight}px`);
      }
    }
  }

  console.log(`\n=== SPACING PARITY DIFFS (${diffs.length}) ===`);
  for (const d of diffs) {
    console.log(' -', d);
  }
  expect(diffs).toEqual([]);
});

test('Dialog spacing parity audit (Desktop 1280x800 & Mobile 390x844)', async ({ page }) => {
  await installHuggingFaceFixture(page);
  const diffs: string[] = [];
  const selectors = ['.dialog', '.dialog__panel', '.dialog__header', '.dialog__body', '.dialog__footer'];
  const dialogs = [
    { name: 'Finish workout', mock: 'dialogs/end-workout/default.html', route: '/train', trigger: 'train-finish' },
    { name: 'Search Scripture', mock: 'dialogs/verse-search/default.html', route: '/coach', trigger: 'coach-open-verse-search' },
    { name: 'Pair Bluetooth device', mock: 'dialogs/pair-device/default.html', route: '/devices', trigger: 'devices-open-pair' },
    { name: 'Enable Chrome built-in AI', mock: 'dialogs/chrome-flags/default.html', route: '/lab', trigger: 'ailab-writer-flag-btn' },
    { name: 'Remove cached model', mock: 'dialogs/remove-model/default.html', route: '/lab', trigger: 'ailab-remove-vitpose' },
  ];

  async function probeDialog(sel: string) {
    return page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        padding: cs.padding,
        margin: cs.margin,
        gap: cs.gap,
        overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    }, sel);
  }

  for (const vp of [
    { label: 'Desktop', width: 1280, height: 800 },
    { label: 'Mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const d of dialogs) {
      await page.goto(`file://${path.join(MOCK_ROOT, d.mock)}?chrome=0`);
      const mockVals: Record<string, Awaited<ReturnType<typeof probeDialog>>> = {};
      for (const s of selectors) mockVals[s] = await probeDialog(s);

      await page.goto(`http://localhost:4200${d.route}`);
      await page.getByTestId(d.trigger).click();
      await page.locator('.dialog__panel').waitFor({ state: 'visible' });

      for (const s of selectors) {
        const m = mockVals[s];
        const a = await probeDialog(s);
        if (!m || !a) continue;
        for (const prop of ['padding', 'margin', 'gap'] as const) {
          if (m[prop] !== a[prop]) {
            diffs.push(`[${vp.label}][Dialog:${d.name}] ${s}.${prop}: mock="${m[prop]}" vs app="${a[prop]}"`);
          }
        }
        if (a.overflowX > 0) {
          diffs.push(`[${vp.label}][Dialog:${d.name}] overflowX=${a.overflowX}px`);
        }
      }
    }
  }

  console.log(`\n=== DIALOG SPACING PARITY DIFFS (${diffs.length}) ===`);
  for (const d of diffs) {
    console.log(' -', d);
  }
  expect(diffs).toEqual([]);
});

test('Left rail never vertically scrolls on desktop (L2-004)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:4200/');
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.scrollTo(0, 600));
  const rail = await page.evaluate(() => {
    const el = document.querySelector('.app-sidebar') as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      position: cs.position,
      overflowY: cs.overflowY,
      top: Math.round(rect.top),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });

  expect(rail).not.toBeNull();
  expect(rail?.position).toBe('sticky');
  expect(rail?.overflowY).toBe('hidden');
  expect(rail?.top).toBe(0);
  expect(rail!.scrollHeight).toBeLessThanOrEqual(rail!.clientHeight);
});
