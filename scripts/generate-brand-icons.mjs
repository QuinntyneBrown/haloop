/**
 * Generates the Haloop favicon set from the official brand mark (docs/assets/haloop-logo-dark.svg):
 * a rounded #0f1217 badge carrying the #e9a83a halo and cream broken ring, so it stays legible on both light and
 * dark browser chrome. Run with `node scripts/generate-brand-icons.mjs`; outputs are committed under public/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const out = resolve(import.meta.dirname, '..', 'public');
const BADGE = '#0f1217';
const HALO = '#e9a83a';
const RING = '#f5f2ea';

// The brand mark on a 64x64 canvas, scaled up and nudged so it fills the badge (the mark is optically bottom-heavy).
const mark = `
  <g transform="translate(32 33) scale(1.12) translate(-32 -33)">
    <ellipse cx="32" cy="12" rx="14" ry="4.25" stroke="${HALO}" stroke-width="4.6"/>
    <circle cx="32" cy="39" r="17" stroke="${RING}" stroke-width="8.2" stroke-linecap="round"
            stroke-dasharray="88 18.8" transform="rotate(-38 32 39)"/>
  </g>`;

const svg = (radius) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="${radius}" fill="${BADGE}"/>${mark}
</svg>`;

const png = (size, radius = 14) => sharp(Buffer.from(svg(radius)), { density: 384 }).resize(size, size).png().toBuffer();

/** ICO container whose entries are PNG images (supported by every current browser and by Windows). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await mkdir(out, { recursive: true });
const sizes = [16, 32, 48];
await writeFile(resolve(out, 'favicon.ico'), ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(size, size <= 32 ? 12 : 14) })))));
await writeFile(resolve(out, 'favicon.svg'), svg(14));
await writeFile(resolve(out, 'apple-touch-icon.png'), await png(180, 0)); // iOS applies its own mask
await writeFile(resolve(out, 'icon-192.png'), await png(192));
await writeFile(resolve(out, 'icon-512.png'), await png(512));
console.log('Wrote favicon.ico (16/32/48), favicon.svg, apple-touch-icon.png, icon-192.png, icon-512.png');
