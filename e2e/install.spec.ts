/**
 * Installing Practy on a phone ("Add to Home Screen", docs/IPHONE.md route A). Browsers fetch the manifest without
 * cookies and staff usually start signed out, so the manifest and icons must load without a session, and the sign-in
 * page must carry the same tags as the app. Nothing else becomes public.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const INSTALL_TAGS = [
  { tag: "link", rel: "manifest", href: "/manifest.webmanifest" },
  { tag: "link", rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  { tag: "link", rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { tag: "link", rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { tag: "meta", name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
  { tag: "meta", name: "theme-color", content: "#181c21", media: "(prefers-color-scheme: dark)" },
  { tag: "meta", name: "apple-mobile-web-app-title", content: "Practy" },
  { tag: "meta", name: "apple-mobile-web-app-status-bar-style", content: "default" },
];

/** The install tags in the page's head, with their attributes. */
const installTags = (page: Page) =>
  page.evaluate(() =>
    [...document.head.querySelectorAll('link[rel="manifest"], link[rel="icon"], link[rel="apple-touch-icon"], meta[name="theme-color"], meta[name^="apple-mobile-web-app-"]')].map((el) => ({
      tag: el.localName,
      ...Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])),
    })),
  );

/** The manifest as Chromium reads it from the page: its parse errors, and the values it will install with. */
async function chromiumManifest(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { url, errors, manifest } = await cdp.send("Page.getAppManifest");
  await cdp.detach();
  const path = (u?: string) => u && new URL(u).pathname + new URL(u).hash;
  return {
    url: path(url),
    errors: errors.map((e) => e.message),
    name: manifest?.name,
    id: path(manifest?.id),
    startUrl: path(manifest?.startUrl),
    scope: path(manifest?.scope),
    display: manifest?.display,
    icons: manifest?.icons?.map((i) => `${path(i.url)} ${i.sizes}`),
  };
}

const CHROMIUM_READS = {
  url: "/manifest.webmanifest",
  errors: [],
  name: "Practy",
  id: "/",
  startUrl: "/#/",
  scope: "/",
  display: "kStandalone",
  icons: ["/icons/icon-192.png 192x192", "/icons/icon-512.png 512x512", "/icons/icon-maskable-512.png 512x512"],
};

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the manifest, icons and favicon load without signing in, at the stated sizes", async ({ page, request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^application\/manifest\+json/);
    const manifest = await res.json();
    expect(manifest).toMatchObject({ id: "/", name: "Practy", short_name: "Practy", start_url: "/#/", scope: "/", display: "standalone", background_color: "#f6f7f9", theme_color: "#ffffff" });
    expect(manifest.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);

    const images: { src: string; type: RegExp; size: number; opaque?: boolean }[] = [
      { src: "/icons/icon-192.png", type: /^image\/png$/, size: 192, opaque: false },
      { src: "/icons/icon-512.png", type: /^image\/png$/, size: 512, opaque: false },
      { src: "/icons/icon-maskable-512.png", type: /^image\/png$/, size: 512, opaque: true },
      { src: "/apple-touch-icon.png", type: /^image\/png$/, size: 180, opaque: true },
      { src: "/favicon.ico", type: /^image\/(vnd\.microsoft\.icon|x-icon)$/, size: 32 },
      { src: "/favicon.svg", type: /^image\/svg\+xml/, size: 512 },
    ];
    for (const image of images) {
      const r = await request.get(image.src, { maxRedirects: 0 });
      expect(r.status(), image.src).toBe(200);
      expect(r.headers()["content-type"], image.src).toMatch(image.type);
    }

    // Decode each image the way the browser will, on the sign-in page (the page a signed-out phone is on).
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth\/login/);
    const decoded = await page.evaluate(
      (srcs) =>
        Promise.all(
          srcs.map(async (src) => {
            const img = new Image();
            img.src = src;
            await img.decode();
            const canvas = document.createElement("canvas");
            [canvas.width, canvas.height] = [img.naturalWidth, img.naturalHeight];
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data.filter((_, i) => i % 4 === 3);
            return { src, width: img.naturalWidth, height: img.naturalHeight, opaque: alpha.every((a) => a === 255) };
          }),
        ),
      images.map((i) => i.src),
    );
    expect(decoded).toEqual(images.map(({ src, size, opaque }) => ({ src, width: size, height: size, opaque: opaque ?? expect.any(Boolean) })));
  });

  test("the sign-in page carries the install tags, so installing from it installs Practy", async ({ page }) => {
    await page.goto("/#/");
    await expect(page).toHaveURL(/\/auth\/login\?returnTo=%2F/);
    expect(await installTags(page)).toEqual(INSTALL_TAGS);
    expect(await chromiumManifest(page)).toEqual(CHROMIUM_READS);
  });

  test("the app and the API still need sign-in, and API answers are not kept", async ({ request }) => {
    for (const path of ["/", "/matters", "/icons/", "/favicon.png"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(302);
      expect(res.headers().location, path).toBe(`/auth/login?returnTo=${encodeURIComponent(path)}`);
    }
    const calls = [
      request.get("/api/session"),
      request.get("/api/commands"),
      request.post("/api/commands/list_matters", { data: {} }),
      request.get("/api/matters/m1/documents/d1/download"),
      request.post("/api/chat", { data: {} }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status(), res.url()).toBe(401);
      expect(res.headers()["cache-control"], res.url()).toBe("no-store");
    }
  });
});

test("the app carries the same install tags, and Chromium reads the manifest without errors", async ({ page, request }) => {
  await page.goto("/#/");
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  expect(await installTags(page)).toEqual(INSTALL_TAGS);
  expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");
  expect(await chromiumManifest(page)).toEqual(CHROMIUM_READS);
  // Signed in, API answers still carry no-store.
  expect((await request.get("/api/session")).headers()["cache-control"]).toBe("no-store");
});
