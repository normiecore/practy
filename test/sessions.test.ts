import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usersOf } from "../src/admin/commands.js";
import { settingsFor, type TenantSettings } from "../src/admin/settings.js";
import { PractyOAuthProvider } from "../src/auth/mcp-oauth.js";
import type { Session } from "../src/auth/model.js";
import { AuthService } from "../src/auth/service.js";
import { describeDevice, forgetExpiredSessionDetails, LAST_SEEN_EVERY_MS, OAUTH_CODE_KIND, OAUTH_TOKEN_KIND, truncateIp } from "../src/auth/sessions.js";
import type { Actor, InvocationContext, Surface } from "../src/core/types.js";
import { as, setup, TENANT, users } from "./helpers.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

afterEach(() => vi.useRealTimers());

describe("device and network descriptions", () => {
  it("keeps only the browser and platform from a User-Agent", () => {
    expect(describeDevice(IPHONE)).toBe("Safari on iPhone");
    expect(describeDevice(WINDOWS_CHROME)).toBe("Chrome on Windows");
    expect(describeDevice(MAC_SAFARI)).toBe("Safari on Mac");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1")).toBe("Chrome on iPhone");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0")).toBe("Edge on Windows");
    expect(describeDevice("Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox on Linux");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(describeDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).toBe("Safari on iPad");
    expect(describeDevice("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36")).toBe("Chrome on Linux");
    expect(describeDevice("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Unknown browser on Linux");
    expect(describeDevice("curl/8.5.0")).toBe("Unknown device");
    expect(describeDevice(undefined)).toBe("Unknown device");
  });

  it("cuts addresses to the network: IPv4 /24 and IPv6 /48", () => {
    expect(truncateIp("203.0.113.45")).toBe("203.0.113.0/24");
    expect(truncateIp("::ffff:203.0.113.45")).toBe("203.0.113.0/24");
    expect(truncateIp("2001:db8:abcd:12:3456:789a:bcde:f012")).toBe("2001:db8:abcd::/48");
    expect(truncateIp("2001:DB8::1")).toBe("2001:db8::/48");
    expect(truncateIp("2001:0:abcd::1")).toBe("2001:0:abcd::/48");
    expect(truncateIp("fe80::1%eth0")).toBe("fe80::/48");
    expect(truncateIp("::1")).toBe("::/48");
    expect(truncateIp("64:ff9b:1::192.0.2.1")).toBe("64:ff9b:1::/48");
    expect(truncateIp("not an address")).toBeUndefined();
    expect(truncateIp(undefined)).toBeUndefined();
  });
});

function world() {
  const t = setup();
  const people: Actor[] = [users.principal, users.solicitor, users.paralegal, users.outsider];
  for (const u of people) {
    usersOf(t.app.store).set({ id: u.userId, tenantId: u.tenantId, email: `${u.userId}@example.com`, displayName: u.displayName, roles: u.roles, active: true, createdAt: "2026-01-01T00:00:00Z" });
  }
  const auth = new AuthService(t.app.store, new Map(), { baseUrl: "http://localhost" });
  /** Signs in as a user and returns the raw token plus the context a web request with that cookie would carry. */
  const signIn = (actor: Actor, client: { userAgent?: string; ip?: string } = {}) => {
    const raw = auth.createSession(usersOf(t.app.store).get(actor.userId)!, "dev", client);
    const ctx = (surface: Surface = "ui"): InvocationContext => ({ actor, surface, sessionId: hash(raw) });
    return { raw, ctx };
  };
  return { ...t, auth, signIn };
}

describe("sign-in session commands", () => {
  it("lists the caller's active sessions with device, network and this device, never the token or its hash", async () => {
    const { exec, signIn, auth } = world();
    const phone = signIn(users.solicitor, { userAgent: IPHONE, ip: "203.0.113.45" });
    const desk = signIn(users.solicitor, { userAgent: WINDOWS_CHROME, ip: "2001:db8:abcd:12::7" });
    const ended = signIn(users.solicitor, { userAgent: MAC_SAFARI });
    auth.endSession(ended.raw);
    signIn(users.principal, { userAgent: MAC_SAFARI });

    const list = await exec<any[]>("list_my_sessions", {}, desk.ctx());
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.current)).toMatchObject({ device: "Chrome on Windows", location: "2001:db8:abcd::/48" });
    expect(list.find((s) => !s.current)).toMatchObject({ device: "Safari on iPhone", location: "203.0.113.0/24" });
    for (const s of list) {
      expect(Object.keys(s).sort()).toEqual(["createdAt", "current", "device", "expiresAt", "id", "lastSeenAt", "location"]);
      expect(s.lastSeenAt).toBe(s.createdAt);
    }
    const text = JSON.stringify(list);
    for (const { raw } of [phone, desk]) {
      const record = auth.session(raw)!.session;
      expect(text).not.toContain(raw);
      expect(text).not.toContain(hash(raw));
      expect(text).not.toContain(record.csrf);
    }
    // The full User-Agent is not kept, only its summary.
    expect(JSON.stringify(auth.session(phone.raw)!.session)).not.toContain("AppleWebKit");
  });

  it("ends one of the caller's sessions, which then stops authenticating", async () => {
    const { exec, signIn, auth } = world();
    const phone = signIn(users.solicitor, { userAgent: IPHONE });
    const desk = signIn(users.solicitor, { userAgent: WINDOWS_CHROME });
    const id = (await exec<any[]>("list_my_sessions", {}, desk.ctx())).find((s) => !s.current).id;
    expect(await exec("end_session", { sessionId: id }, desk.ctx())).toMatchObject({ ended: 1, device: "Safari on iPhone", current: false });
    expect(auth.session(phone.raw)).toBeUndefined();
    expect(auth.sessions.get(hash(phone.raw))).toMatchObject({ endedReason: "ended_by_user" });
    expect(auth.session(desk.raw)).toBeDefined();
    expect(await exec<any[]>("list_my_sessions", {}, desk.ctx())).toHaveLength(1);
    // Ending it again finds nothing.
    await expect(exec("end_session", { sessionId: id }, desk.ctx())).rejects.toMatchObject({ code: "not_found" });
  });

  it("signs out all other devices and keeps the current session", async () => {
    const { exec, signIn, auth } = world();
    const desk = signIn(users.solicitor, { userAgent: WINDOWS_CHROME });
    const others = [signIn(users.solicitor, { userAgent: IPHONE }), signIn(users.solicitor, { userAgent: MAC_SAFARI })];
    const colleague = signIn(users.paralegal);
    expect(await exec("end_other_sessions", {}, desk.ctx())).toEqual({ ended: 2 });
    for (const o of others) expect(auth.session(o.raw)).toBeUndefined();
    expect(auth.session(desk.raw)).toBeDefined();
    expect(auth.session(colleague.raw)).toBeDefined();
    expect((await exec<any[]>("list_my_sessions", {}, desk.ctx())).map((s) => s.current)).toEqual([true]);
  });

  it("never lets a user see or end another user's sessions, in the firm or outside it", async () => {
    const { exec, signIn, auth } = world();
    const mine = signIn(users.solicitor);
    const principal = signIn(users.principal, { userAgent: IPHONE });
    const outsider = signIn(users.outsider, { userAgent: IPHONE });
    const principalId = (await exec<any[]>("list_my_sessions", {}, principal.ctx()))[0].id;
    const outsiderId = (await exec<any[]>("list_my_sessions", {}, outsider.ctx()))[0].id;

    expect((await exec<any[]>("list_my_sessions", {}, mine.ctx())).map((s) => s.id)).not.toContain(principalId);
    for (const id of [principalId, outsiderId]) {
      await expect(exec("end_session", { sessionId: id }, mine.ctx())).rejects.toMatchObject({ code: "not_found" });
    }
    await exec("end_other_sessions", {}, mine.ctx());
    expect(auth.session(principal.raw)).toBeDefined();
    expect(auth.session(outsider.raw)).toBeDefined();

    // Only a principal may sign someone else out, and only within the firm.
    await expect(exec("end_user_sessions", { userId: users.principal.userId }, mine.ctx())).rejects.toMatchObject({ code: "forbidden" });
    await expect(exec("end_user_sessions", { userId: users.outsider.userId }, principal.ctx())).rejects.toMatchObject({ code: "not_found" });
    await expect(exec("end_user_sessions", { userId: users.solicitor.userId }, outsider.ctx())).rejects.toMatchObject({ code: "not_found" });
    expect(auth.session(outsider.raw)).toBeDefined();
    expect(auth.session(mine.raw)).toBeDefined();
  });

  it("refuses every session command on AI surfaces", async () => {
    const { run, exec, signIn, auth } = world();
    const desk = signIn(users.principal);
    const phone = signIn(users.principal, { userAgent: IPHONE });
    const staff = signIn(users.solicitor);
    const id = (await exec<any[]>("list_my_sessions", {}, desk.ctx())).find((s) => !s.current).id;
    for (const surface of ["mcp", "agent"] as const) {
      for (const [name, input] of [
        ["list_my_sessions", {}],
        ["end_session", { sessionId: id }],
        ["end_other_sessions", {}],
        ["end_user_sessions", { userId: users.solicitor.userId }],
      ] as const) {
        await expect(run(name, input, desk.ctx(surface)), `${name} on ${surface}`).rejects.toMatchObject({ code: "forbidden" });
      }
    }
    for (const s of [desk, phone, staff]) expect(auth.session(s.raw)).toBeDefined();
  });

  it("lets a principal sign another user out everywhere: sessions, AI clients and API keys", async () => {
    const { app, exec, signIn, auth } = world();
    const principal = signIn(users.principal);
    const sessions = [signIn(users.solicitor, { userAgent: IPHONE }), signIn(users.solicitor, { userAgent: WINDOWS_CHROME })];
    const colleague = signIn(users.paralegal);
    const solicitor = usersOf(app.store).get(users.solicitor.userId)!;
    const apiKey = auth.createApiKey(solicitor, "Reporting");

    // A connected AI client, as the MCP OAuth server records it.
    const settings = app.store.collection<TenantSettings>("tenant_settings");
    settings.set({ ...settingsFor(app.store, TENANT), ai: { ...settingsFor(app.store, TENANT).ai, externalMcpClients: true } });
    const oauth = new PractyOAuthProvider(app.store, auth);
    const access = "pa_test-access";
    const base = { tenantId: TENANT, clientId: "client-1", userId: solicitor.id, redirectUri: "http://localhost:7777/cb", revoked: false };
    const tokens = app.store.collection<any>(OAUTH_TOKEN_KIND);
    tokens.set({ ...base, id: hash(access), kind: "access", expiresAt: Date.now() + 3_600_000 });
    tokens.set({ ...base, id: hash("pr_test-refresh"), kind: "refresh", expiresAt: Date.now() + 86_400_000 });
    await expect(oauth.verifyAccessToken(access)).resolves.toMatchObject({ extra: { userId: solicitor.id } });
    expect(auth.apiKeyUser(apiKey)?.id).toBe(solicitor.id);

    const out = await exec("end_user_sessions", { userId: solicitor.id }, principal.ctx());
    expect(out).toEqual({ userId: solicitor.id, displayName: "Solicitor", sessionsEnded: 2, aiClientsDisconnected: 1, apiKeysRevoked: 1 });
    for (const s of sessions) expect(auth.session(s.raw)).toBeUndefined();
    expect(auth.sessions.get(hash(sessions[0]!.raw))).toMatchObject({ endedReason: "ended_by_principal" });
    await expect(oauth.verifyAccessToken(access)).rejects.toThrow();
    const client = { client_id: "client-1", redirect_uris: ["http://localhost:7777/cb"] } as any;
    await expect(oauth.exchangeRefreshToken(client, "pr_test-refresh")).rejects.toThrow();
    expect(auth.apiKeyUser(apiKey)).toBeUndefined();
    // Nobody else is touched, and the user is still active (they can sign in again).
    expect(auth.session(principal.raw)).toBeDefined();
    expect(auth.session(colleague.raw)).toBeDefined();
    expect(usersOf(app.store).get(solicitor.id)!.active).toBe(true);
    // A principal ends their own other sessions with end_other_sessions, not here.
    await expect(exec("end_user_sessions", { userId: users.principal.userId }, principal.ctx())).rejects.toMatchObject({ code: "invalid" });
  });

  it("will not exchange a sign-in code handed out before the user was signed out everywhere", async () => {
    const { app, exec, signIn, auth } = world();
    const principal = signIn(users.principal);
    const solicitor = usersOf(app.store).get(users.solicitor.userId)!;
    const settings = app.store.collection<TenantSettings>("tenant_settings");
    settings.set({ ...settingsFor(app.store, TENANT), ai: { ...settingsFor(app.store, TENANT).ai, externalMcpClients: true } });
    const oauth = new PractyOAuthProvider(app.store, auth);
    const client = { client_id: "client-1", redirect_uris: ["http://localhost:7777/cb"] } as any;
    const code = (raw: string, userId: string) =>
      app.store.collection<any>(OAUTH_CODE_KIND).set({ id: hash(raw), tenantId: TENANT, clientId: "client-1", userId, codeChallenge: "x", redirectUri: "http://localhost:7777/cb", expiresAt: Date.now() + 300_000, used: false });
    code("code-before", solicitor.id);
    await exec("end_user_sessions", { userId: solicitor.id }, principal.ctx());
    await expect(oauth.exchangeAuthorizationCode(client, "code-before")).rejects.toThrow();
    // A code for someone made inactive since is refused too.
    code("code-inactive", users.paralegal.userId);
    usersOf(app.store).set({ ...usersOf(app.store).get(users.paralegal.userId)!, active: false });
    await expect(oauth.exchangeAuthorizationCode(client, "code-inactive")).rejects.toThrow(/no longer active/);
  });

  it("forgets the device and network of a session once it has ended or expired", async () => {
    const { app, exec, signIn, auth } = world();
    const desk = signIn(users.principal, { userAgent: MAC_SAFARI, ip: "203.0.113.45" });
    const phone = signIn(users.principal, { userAgent: IPHONE, ip: "198.51.100.7" });
    const ended = (await exec<any[]>("list_my_sessions", {}, desk.ctx())).find((s) => !s.current);
    await exec("end_session", { sessionId: ended.id }, desk.ctx());
    expect(auth.sessions.get(hash(phone.raw))).toMatchObject({ endedReason: "ended_by_user" });
    expect(auth.sessions.get(hash(phone.raw))!.device).toBeUndefined();
    expect(auth.sessions.get(hash(phone.raw))!.network).toBeUndefined();
    // One that simply ran out is cleared by the hourly job; an active one keeps its details.
    const later = signIn(users.solicitor, { userAgent: WINDOWS_CHROME, ip: "192.0.2.10" });
    auth.sessions.set({ ...auth.sessions.get(hash(later.raw))!, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(forgetExpiredSessionDetails(app.store)).toBe(1);
    expect(auth.sessions.get(hash(later.raw))!.device).toBeUndefined();
    expect(auth.sessions.get(hash(desk.raw))).toMatchObject({ device: "Safari on Mac", network: "203.0.113.0/24" });
  });

  it("will not sign out every device from an API key", async () => {
    const { run, signIn, auth } = world();
    const desk = signIn(users.principal);
    const phone = signIn(users.principal, { userAgent: IPHONE });
    await expect(run("end_other_sessions", {}, { actor: users.principal, surface: "api" })).rejects.toMatchObject({ code: "invalid" });
    for (const s of [desk, phone]) expect(auth.session(s.raw)).toBeDefined();
  });

  it("ends a deactivated user's sessions, so reactivating them revives nothing", async () => {
    const { app, run, exec, signIn, auth } = world();
    const staff = signIn(users.solicitor, { userAgent: IPHONE });
    const solicitor = usersOf(app.store).get(users.solicitor.userId)!;
    const apiKey = auth.createApiKey(solicitor, "Script");
    const upsert = async (active: boolean) => {
      const req = await run("upsert_user", { email: solicitor.email, displayName: solicitor.displayName, roles: solicitor.roles, active }, as(users.principal));
      if (req.status !== "pending_approval") throw new Error("expected approval");
      await exec("decide_approval", { approvalId: req.approvalId, decision: "approve" }, as(users.principal));
    };
    await upsert(false);
    expect(auth.sessions.get(hash(staff.raw))).toMatchObject({ endedReason: "deactivated" });
    await upsert(true);
    expect(usersOf(app.store).get(solicitor.id)!.active).toBe(true);
    expect(auth.session(staff.raw)).toBeUndefined();
    expect(auth.apiKeyUser(apiKey)).toBeUndefined();
  });
});

describe("last seen", () => {
  it("records use at most every few minutes rather than on every request", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T01:00:00Z"));
    const { signIn, auth } = world();
    const { raw } = signIn(users.solicitor);
    const writes = vi.spyOn(auth.sessions, "set");
    for (let i = 0; i < 5; i++) auth.session(raw);
    vi.setSystemTime(new Date(Date.parse("2026-11-03T01:00:00Z") + LAST_SEEN_EVERY_MS - 1000));
    auth.session(raw);
    expect(writes).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-11-03T01:06:00Z"));
    expect(auth.session(raw)!.session.lastSeenAt).toBe("2026-11-03T01:06:00.000Z");
    auth.session(raw);
    expect(writes).toHaveBeenCalledTimes(1);
    expect((auth.sessions.get(hash(raw)) as Session).lastSeenAt).toBe("2026-11-03T01:06:00.000Z");
  });
});
