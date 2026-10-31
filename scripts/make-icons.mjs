/**
 * Makes the installable web app's icons from web/public/favicon.svg, the one source of the Practy mark.
 * After changing the SVG, run `node scripts/make-icons.mjs` and commit what it writes. It renders with the
 * Chromium that Playwright already uses for the browser tests, and needs no network.
 *
 *   web/public/icons/icon-192.png, icon-512.png  "any": the rounded tile with clear corners
 *   web/public/icons/icon-maskable-512.png      "maskable": full-bleed tile, the mark shrunk into the safe zone
 *   web/public/apple-touch-icon.png             iPhone Home Screen: 180 x 180 and opaque (iOS rounds the corners)
 *   web/public/favicon.ico                      16 and 32 pixel PNGs, for browsers without SVG favicons
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const pub = (name) => fileURLToPath(new URL(`../web/public/${name}`, import.meta.url));
const svg = readFileSync(pub("favicon.svg"), "utf8");
const tile = /<rect id="tile"[^>]*\sfill="(#[0-9a-fA-F]{6})"/.exec(svg)?.[1];
if (!tile) throw new Error('favicon.svg needs <rect id="tile" ... fill="#rrggbb">: the maskable and Apple icons fill their corners with it');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** The mark at `size` pixels, scaled by `scale` about the centre, on `background` (clear when omitted). */
async function render(size, { background, scale = 1 } = {}) {
  const inner = Math.round(size * scale);
  const offset = (size - inner) / 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html style="background:${background ?? "transparent"}"><body style="margin:0">` +
      `<img src="${src}" width="${inner}" height="${inner}" style="display:block;position:absolute;left:${offset}px;top:${offset}px"></body></html>`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: !background });
}

/** An .ico file holding PNG images (supported by every browser in use). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size, at);
    head.writeUInt8(size, at + 1);
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

const out = {
  "icons/icon-192.png": await render(192),
  "icons/icon-512.png": await render(512),
  // The maskable safe zone is the centre circle, 80% of the width across; the mark sits well inside it.
  "icons/icon-maskable-512.png": await render(512, { background: tile, scale: 0.8 }),
  "apple-touch-icon.png": await render(180, { background: tile }),
  "favicon.ico": ico([
    { size: 16, png: await render(16) },
    { size: 32, png: await render(32) },
  ]),
};
await browser.close();
for (const [name, bytes] of Object.entries(out)) {
  writeFileSync(pub(name), bytes);
  console.log(`web/public/${name} (${bytes.length} bytes)`);
}
