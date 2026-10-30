import { createHash, randomBytes } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { usersOf } from "../src/admin/commands.js";
import { settingsFor, type TenantSettings } from "../src/admin/settings.js";
import { DevOidcProvider } from "../src/auth/oidc.js";
import { AuthService, safeReturnTo } from "../src/auth/service.js";
import { createHttpServer } from "../src/server/http.js";
import { setup, TENANT, users } from "./helpers.js";

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start() {
  const t = setup();
  for (const u of [users.solicitor, users.principal]) {
    usersOf(t.app.store).set({ id: u.userId, tenantId: TENANT, email: `${u.userId}@soullegal.com.au`, displayName: u.displayName, roles: u.roles, active: true, createdAt: "2026-01-01T00:00:00Z" });
  }
  // OAuth metadata embeds absolute URLs, so reserve a port before building the server.
  const probe = createServer().listen(0);
  await new Promise((r) => probe.once("listening", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const auth = new AuthService(t.app.store, new Map([["dev", new DevOidcProvider()]]), { baseUrl: base });
  const real = createHttpServer(t.app, { auth, baseUrl: base, devTokens: new Map([["tok", { actor: users.solicitor, surface: "ui" as const }]]) }).listen(port);
  servers.push(real);
  await new Promise((r) => real.once("listening", r));
  return { ...t, base, auth };
}

const get = (url: string, cookie?: string) => fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });

async function signIn(base: string, email: string): Promise<string> {
  const login = await get(`${base}/auth/login/dev?returnTo=/matters`);
  const devUrl = new URL(login.headers.get("location")!, base);
  const state = devUrl.searchParams.get("state")!;
  const cb = await get(`${base}/auth/callback/dev?state=${state}&code=${encodeURIComponent(email)}`);
  expect(cb.status).toBe(302);
  expect(cb.headers.get("location")).toBe("/matters");
  return cb.headers.get("set-cookie")!.split(";")[0]!;
}

describe("REST with dev tokens", () => {
  it("serves commands with bearer auth and maps errors", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/commands`)).status).toBe(401);
    const list = await (await fetch(`${base}/api/commands`, { headers: { Authorization: "Bearer tok" } })).json();
    expect(list.find((c: any) => c.name === "create_matter").inputSchema.type).toBe("object");
    const bad = await fetch(`${base}/api/commands/get_matter`, { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ matterId: "nope" }) });
    expect(bad.status).toBe(404);
  });
});

describe("staff sign-in", () => {
  it("creates a session via the IdP flow and enforces CSRF on writes", async () => {
    const { base } = await start();
    const cookie = await signIn(base, "u-sol@soullegal.com.au");
    const session = await (await get(`${base}/api/session`, cookie)).json();
    expect(session.user.email).toBe("u-sol@soullegal.com.au");

    const body = JSON.stringify({});
    const noCsrf = await fetch(`${base}/api/commands/whoami`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body });
    expect(noCsrf.status).toBe(403);
    const ok = await fetch(`${base}/api/commands/whoami`, { method: "POST", headers: { cookie, "Content-Type": "application/json", "x-practy-csrf": session.csrf }, body });
    expect((await ok.json()).result).toMatchObject({ userId: users.solicitor.userId, surface: "ui" });

    await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie } });
    expect((await get(`${base}/api/session`, cookie)).status).toBe(401);
  });

  it("refuses unknown users and open redirects", async () => {
    const { base } = await start();
    const login = await get(`${base}/auth/login/dev?returnTo=//evil.example`);
    const state = new URL(login.headers.get("location")!, base).searchParams.get("state")!;
    const refused = await get(`${base}/auth/callback/dev?state=${state}&code=stranger@example.com`);
    expect(refused.status).toBe(403);
    const cookie = await signIn(base, "u-sol@soullegal.com.au");
    expect(cookie).toMatch(/^practy_session=/);
  });

  it("keeps post-login redirects on this origin, including backslash tricks", async () => {
    for (const bad of ["//evil.example", "/\\evil.example", "/\\/evil.example", "\\evil.example", "/\tevil", "https://evil.example", "", "evil", 7]) {
      expect(safeReturnTo(bad)).toBe("/");
    }
    for (const ok of ["/", "/matters", "/matters/m1?tab=trust#x"]) expect(safeReturnTo(ok)).toBe(ok);

    const { base } = await start();
    const login = await get(`${base}/auth/login/dev?returnTo=${encodeURIComponent("/\\evil.example/session-expired")}`);
    const state = new URL(login.headers.get("location")!, base).searchParams.get("state")!;
    const cb = await get(`${base}/auth/callback/dev?state=${state}&code=${encodeURIComponent("u-sol@soullegal.com.au")}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/");
  });
});

describe("MCP OAuth for external AI clients", () => {
  it("registers a client, gets consent, issues tokens and limits tools to the firm's max tier", async () => {
    const { base, app } = await start();
    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(meta.registration_endpoint).toBe(`${base}/register`);

    const reg = await (await fetch(`${base}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["http://localhost:7777/cb"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) })).json();
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizeUrl = `${base}/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("http://localhost:7777/cb")}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`;

    const consentFor = async (cookie: string) => {
      const a = await get(authorizeUrl);
      const consentPath = a.headers.get("location")!;
      expect(consentPath).toMatch(/^\/oauth\/consent\?request=/);
      expect((await get(`${base}${consentPath}`)).headers.get("location")).toMatch(/^\/auth\/login\?returnTo=/);
      const page = await (await get(`${base}${consentPath}`, cookie)).text();
      expect(page).toContain("Connect Claude to Practy?");
      expect(page).toContain("<strong>localhost:7777</strong>");
      expect(page).not.toContain("Unverified client");
      const session = await (await get(`${base}/api/session`, cookie)).json();
      const request = new URL(consentPath, base).searchParams.get("request")!;
      const decided = await fetch(`${base}/oauth/consent`, { method: "POST", redirect: "manual", headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request, csrf: session.csrf, decision: "approve" }) });
      return new URL(decided.headers.get("location")!);
    };

    const cookie = await signIn(base, "u-sol@soullegal.com.au");
    const denied = await consentFor(cookie);
    expect(denied.searchParams.get("error")).toBe("access_denied");

    const settings = app.store.collection<TenantSettings>("tenant_settings");
    const current = settingsFor(app.store, TENANT);
    settings.set({ ...current, ai: { ...current.ai, externalMcpClients: true, externalClientMaxTier: 1 } });
    const ok = await consentFor(cookie);
    expect(ok.searchParams.get("state")).toBe("xyz");
    const code = ok.searchParams.get("code")!;

    const tok = await (await fetch(`${base}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: "http://localhost:7777/cb" }) })).json();
    expect(tok.access_token).toMatch(/^pa_/);

    const rpc = (method: string, params: object, id: number) =>
      fetch(`${base}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    const init = await (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }, 1)).json();
    expect(init.result.serverInfo.name).toBe("practy");
    const tools = (await (await rpc("tools/list", {}, 2)).json()).result.tools.map((t: any) => t.name);
    expect(tools).toContain("create_matter");
    expect(tools).not.toContain("confirm_key_date");
    expect(tools).not.toContain("prepare_trust_payment");

    const refreshed = await (await fetch(`${base}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id }) })).json();
    expect(refreshed.access_token).toMatch(/^pa_/);
    expect((await fetch(`${base}/mcp`, { method: "POST", headers: { Authorization: "Bearer pa_bogus", "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
  });

  it("shows where the code goes and refuses non-https redirect URIs other than loopback", async () => {
    const { base } = await start();
    const register = (redirect: string, name = "Claude Desktop") =>
      fetch(`${base}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: "none" }) });
    expect((await register("http://attacker.example/cb")).status).toBe(400);
    expect((await register("javascript:alert(1)")).status).toBe(400);

    const reg = await (await register("https://attacker.example/cb", "Claude Desktop<script>")).json();
    const challenge = createHash("sha256").update("v").digest("base64url");
    const a = await get(`${base}/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("https://attacker.example/cb")}&code_challenge=${challenge}&code_challenge_method=S256`);
    const cookie = await signIn(base, "u-sol@soullegal.com.au");
    const page = await (await get(`${base}${a.headers.get("location")!}`, cookie)).text();
    expect(page).toContain("<strong>attacker.example</strong>");
    expect(page).toContain(reg.client_id);
    expect(page).toContain("Unverified client");
    expect(page).not.toContain("<script>");

    const known = await (await register("https://claude.ai/api/mcp/auth_callback")).json();
    const b = await get(`${base}/authorize?response_type=code&client_id=${known.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&code_challenge=${challenge}&code_challenge_method=S256`);
    const knownPage = await (await get(`${base}${b.headers.get("location")!}`, cookie)).text();
    expect(knownPage).toContain("<strong>claude.ai</strong>");
    expect(knownPage).not.toContain("Unverified client");
  });

  it("issues no code to a redirect host the firm has not allowed, even if Allow is posted", async () => {
    const { base, app } = await start();
    const settings = app.store.collection<TenantSettings>("tenant_settings");
    const current = settingsFor(app.store, TENANT);
    settings.set({ ...current, ai: { ...current.ai, externalMcpClients: true } });
    const reg = await (await fetch(`${base}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://attacker.example/cb"], token_endpoint_auth_method: "none" }) })).json();
    const challenge = createHash("sha256").update("v").digest("base64url");
    const cookie = await signIn(base, "u-sol@soullegal.com.au");
    const session = await (await get(`${base}/api/session`, cookie)).json();
    const attempt = async () => {
      const a = await get(`${base}/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("https://attacker.example/cb")}&code_challenge=${challenge}&code_challenge_method=S256`);
      const consentPath = a.headers.get("location")!;
      const page = await (await get(`${base}${consentPath}`, cookie)).text();
      const request = new URL(consentPath, base).searchParams.get("request")!;
      const decided = await fetch(`${base}/oauth/consent`, { method: "POST", redirect: "manual", headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request, csrf: session.csrf, decision: "approve" }) });
      return { page, location: new URL(decided.headers.get("location")!) };
    };
    const blocked = await attempt();
    expect(blocked.page).toContain("not on your firm's list of allowed AI clients");
    expect(blocked.page).toMatch(/value="approve" disabled/);
    expect(blocked.location.searchParams.get("error")).toBe("access_denied");
    expect(blocked.location.searchParams.get("code")).toBeNull();

    // A principal adds the host through settings: the same client can now connect.
    settings.set({ ...settingsFor(app.store, TENANT), ai: { ...settingsFor(app.store, TENANT).ai, externalClientRedirectHosts: ["claude.ai", "attacker.example"] } });
    expect((await attempt()).location.searchParams.get("code")).toBeTruthy();
  });
});
