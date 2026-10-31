/** Installing Practy on a phone: the manifest, icons and head tags, and what stays behind sign-in. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { usersOf } from "../src/admin/commands.js";
import { DevOidcProvider } from "../src/auth/oidc.js";
import { AuthService } from "../src/auth/service.js";
import { createHttpServer, INSTALL_HEAD } from "../src/server/http.js";
import { setup, TENANT, users } from "./helpers.js";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

/** A server whose web app directory holds web/public as built (Vite copies it to dist/web) and a stand-in index.html. */
async function start() {
  const webDir = mkdtempSync(join(tmpdir(), "practy-web-"));
  cpSync("web/public", webDir, { recursive: true });
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Practy</title>");
  cleanup.push(() => rmSync(webDir, { recursive: true, force: true }));

  const t = setup();
  const u = users.solicitor;
  usersOf(t.app.store).set({ id: u.userId, tenantId: TENANT, email: "u-sol@soullegal.com.au", displayName: u.displayName, roles: u.roles, active: true, createdAt: "2026-01-01T00:00:00Z" });
  const probe = createServer().listen(0);
  await new Promise((r) => probe.once("listening", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const auth = new AuthService(t.app.store, new Map([["dev", new DevOidcProvider()]]), { baseUrl: base });
  const server = createHttpServer(t.app, { auth, baseUrl: base, webDir }).listen(port);
  cleanup.push(() => server.close());
  await new Promise((r) => server.once("listening", r));
  return { base };
}

const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init });

async function signIn(base: string): Promise<string> {
  const login = await get(`${base}/auth/login/dev`);
  const state = new URL(login.headers.get("location")!, base).searchParams.get("state")!;
  const cb = await get(`${base}/auth/callback/dev?state=${state}&code=${encodeURIComponent("u-sol@soullegal.com.au")}`);
  return cb.headers.get("set-cookie")!.split(";")[0]!;
}

/** Width and height from a PNG's header. */
function pngSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** The install-related <link> and <meta> tags in an HTML page, as attribute maps. */
function installTags(html: string): Record<string, string>[] {
  const tags = [...html.matchAll(/<(link|meta)\s([^>]*?)\s*\/?>/g)].map(([, , attrs]) => Object.fromEntries([...attrs!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k!, v!])));
  return tags.filter((t) => /^(manifest|icon|apple-touch-icon)$/.test(t.rel ?? "") || /^(theme-color|apple-mobile-web-app-[\w-]+)$/.test(t.name ?? ""));
}

const manifest = JSON.parse(readFileSync("web/public/manifest.webmanifest", "utf8"));

describe("installing Practy on a phone", () => {
  it("has a manifest that phones install as Practy, with icons of the stated sizes", () => {
    expect(manifest).toMatchObject({ id: "/", name: "Practy", short_name: "Practy", start_url: "/#/", scope: "/", display: "standalone" });
    // The splash screen and title bar match the app (web/styles.css: --bg, and --surface behind the phone top bar).
    const css = readFileSync("web/styles.css", "utf8");
    expect(css).toMatch(new RegExp(`--bg: ${manifest.background_color};`));
    expect(css).toMatch(new RegExp(`--surface: ${manifest.theme_color};`));
    expect(manifest.icons.map((i: any) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(pngSize(readFileSync(`web/public${icon.src}`)).join("x")).toBe(icon.sizes);
    }
    expect(pngSize(readFileSync("web/public/apple-touch-icon.png"))).toEqual([180, 180]);

    const ico = readFileSync("web/public/favicon.ico");
    expect([ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([1, 2]);
    const sizes = [0, 1].map((i) => {
      const [length, offset] = [ico.readUInt32LE(6 + 16 * i + 8), ico.readUInt32LE(6 + 16 * i + 12)];
      return pngSize(ico.subarray(offset, offset + length));
    });
    expect(sizes).toEqual([[16, 16], [32, 32]]);
  });

  it("puts the same install tags on the app and on the sign-in page", async () => {
    const index = readFileSync("web/index.html", "utf8");
    expect(index).toMatch(/name="viewport" content="[^"]*viewport-fit=cover/);
    const expected = installTags(index);
    expect(expected.map((t) => t.rel ?? t.name)).toEqual(["manifest", "icon", "icon", "apple-touch-icon", "theme-color", "theme-color", "apple-mobile-web-app-title", "apple-mobile-web-app-status-bar-style"]);
    expect(expected.find((t) => t.name === "apple-mobile-web-app-title")?.content).toBe("Practy");
    expect(installTags(INSTALL_HEAD)).toEqual(expected);

    const { base } = await start();
    const signInPage = await (await get(`${base}/auth/login?returnTo=%2F`)).text();
    expect(installTags(signInPage)).toEqual(expected);
    // Every file the tags point at is in web/public.
    for (const t of expected.filter((t) => t.href)) expect(() => readFileSync(`web/public${t.href}`)).not.toThrow();
  });

  it("serves the manifest, icons and favicon without a session, with their types and caching", async () => {
    const { base } = await start();
    const files: [string, string, string][] = [
      ["/manifest.webmanifest", "application/manifest+json", "no-cache"],
      ["/favicon.ico", "image/vnd.microsoft.icon", "public, max-age=86400"],
      ["/favicon.svg", "image/svg+xml", "public, max-age=86400"],
      ["/apple-touch-icon.png", "image/png", "public, max-age=86400"],
      ...manifest.icons.map((i: any): [string, string, string] => [i.src, "image/png", "public, max-age=86400"]),
    ];
    for (const [path, type, cache] of files) {
      const res = await get(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toMatch(new RegExp(`^${type.replace(/[+.]/g, "\\$&")}\\b`));
      expect(res.headers.get("cache-control"), path).toBe(cache);
      expect(res.headers.get("set-cookie"), path).toBeNull();
      expect(Buffer.from(await res.arrayBuffer()).equals(readFileSync(`web/public${path}`)), path).toBe(true);
    }
    expect(await (await get(`${base}/manifest.webmanifest`)).json()).toEqual(manifest);
  });

  it("keeps the app and the API behind sign-in, and tells browsers not to keep API answers", async () => {
    const { base } = await start();
    for (const path of ["/", "/matters", "/favicon.png", "/icons/", "/icons/other.png"]) {
      const res = await get(`${base}${path}`);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe(`/auth/login?returnTo=${encodeURIComponent(path)}`);
    }
    const signedOut: [string, string][] = [
      ["GET", "/api/session"],
      ["GET", "/api/commands"],
      ["POST", "/api/commands/list_matters"],
      ["GET", "/api/matters/m1/documents/d1/download"],
      ["POST", "/api/chat"],
    ];
    for (const [method, path] of signedOut) {
      const res = await get(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.headers.get("cache-control"), `${method} ${path}`).toBe("no-store");
    }

    const cookie = await signIn(base);
    const session = await get(`${base}/api/session`, { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(session.headers.get("cache-control")).toBe("no-store");
    const app = await get(`${base}/`, { headers: { cookie } });
    expect(app.status).toBe(200);
  });
});
