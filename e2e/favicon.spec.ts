import { expect, test } from '@playwright/test';

test.describe('Haloop favicon and app icons', () => {
  test('serves the custom multi-size favicon.ico, not the Angular default', async ({ request }) => {
    const response = await request.get('/favicon.ico');
    expect(response.status()).toBe(200);
    const bytes = await response.body();

    // ICO header: reserved 0, type 1, then one directory entry per embedded size.
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    const count = bytes.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => bytes.readUInt8(6 + i * 16)).sort((a, b) => a - b);
    expect(sizes).toEqual([16, 32, 48]);
    // The stock Angular CLI favicon is 15 086 bytes and 1 entry; ours is a different, smaller file.
    expect(bytes.length).not.toBe(15086);
    // Each entry embeds a PNG.
    const firstOffset = bytes.readUInt32LE(6 + 12);
    expect(bytes.subarray(firstOffset, firstOffset + 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  test('links the icons from index.html and serves each one without errors', async ({ page, request }) => {
    const failures: string[] = [];
    const consoleErrors: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    await page.goto('/');

    const links = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => ({
        rel: l.getAttribute('rel'),
        href: (l as HTMLLinkElement).href,
      })),
    );
    expect(links.map((l) => new URL(l.href).pathname).sort()).toEqual(['/apple-touch-icon.png', '/favicon.ico', '/favicon.svg']);
    for (const link of links) {
      const response = await request.get(link.href);
      expect(response.status(), link.href).toBe(200);
      expect(response.headers()['content-type'], link.href).toMatch(/image\//);
    }

    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons as { src: string }[]) {
      expect((await request.get(`/${icon.src}`)).status(), icon.src).toBe(200);
    }

    expect(failures).toEqual([]);
    expect(consoleErrors.filter((e) => /icon|favicon|Content Security Policy/i.test(e))).toEqual([]);
  });

  test('is a dark rounded badge so it reads on both light and dark browser chrome', async ({ page }) => {
    await page.goto('/favicon.svg');
    const svg = await page.content();
    expect(svg).toContain('#0f1217'); // badge background
    expect(svg).toContain('#e9a83a'); // halo
    expect(svg).toContain('#f5f2ea'); // ring
  });
});
