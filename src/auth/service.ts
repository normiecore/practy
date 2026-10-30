import { createHash, randomBytes } from "node:crypto";
import { findUserByEmail, usersOf } from "../admin/commands.js";
import { settingsFor } from "../admin/settings.js";
import type { Actor } from "../core/types.js";
import type { Store } from "../domain/store.js";
import type { ApiKey, Session, User } from "./model.js";
import type { OidcProvider } from "./oidc.js";

export const SESSION_COOKIE = "practy_session";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

interface PendingLogin {
  providerId: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Only same-origin relative paths are accepted as post-login destinations: "/" or "/" followed by
 * a character other than "/" or a backslash. Browsers read a backslash as a slash, so "/\evil" is refused,
 * as is any value containing a backslash or a control character.
 */
export function safeReturnTo(v: unknown): string {
  if (typeof v !== "string" || /[\\\u0000-\u001f\u007f]/.test(v)) return "/";
  return v === "/" || /^\/[^/\\]/.test(v) ? v : "/";
}

export class AuthService {
  private readonly pending = new Map<string, PendingLogin>();
  readonly sessions;
  readonly apiKeys;

  constructor(
    private readonly store: Store,
    readonly providers: Map<string, OidcProvider>,
    readonly opts: { baseUrl: string; sessionHours?: number; defaultTenantId?: string },
  ) {
    this.sessions = store.collection<Session>("session");
    this.apiKeys = store.collection<ApiKey>("api_key");
  }

  callbackUrl(providerId: string): string {
    return `${this.opts.baseUrl}/auth/callback/${providerId}`;
  }

  async beginLogin(providerId: string, returnTo: string): Promise<string> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown identity provider ${providerId}`);
    const req = await provider.begin(this.callbackUrl(providerId));
    this.pending.set(req.state, {
      providerId,
      nonce: req.nonce,
      codeVerifier: req.codeVerifier,
      returnTo: safeReturnTo(returnTo),
      expiresAt: Date.now() + 10 * 60_000,
    });
    return req.url;
  }

  /** Completes an IdP callback; returns a session token and where to send the browser. */
  async completeLogin(providerId: string, state: string, code: string): Promise<{ token: string; returnTo: string; user: User }> {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || p.providerId !== providerId || p.expiresAt < Date.now()) throw new Error("Login request expired or invalid");
    const provider = this.providers.get(providerId)!;
    const claims = await provider.complete({ code, redirectUri: this.callbackUrl(providerId), nonce: p.nonce, codeVerifier: p.codeVerifier });
    const user = findUserByEmail(this.store, claims.email);
    if (!user || !user.active) throw new Error(`${claims.email} is not an active Practy user`);
    const settings = settingsFor(this.store, user.tenantId);
    const domain = claims.email.split("@")[1] ?? "";
    if (providerId !== "dev") {
      if (!settings.identity.providers.includes(providerId as "google" | "microsoft")) throw new Error(`Sign-in with ${providerId} is not enabled for this firm`);
      if (settings.identity.allowedDomains.length && !settings.identity.allowedDomains.includes(domain)) throw new Error("Email domain not allowed");
      if (settings.identity.requireMfaClaim && !claims.amr?.includes("mfa")) throw new Error("Multi-factor authentication is required");
    }
    usersOf(this.store).set({ ...user, lastLoginAt: new Date().toISOString() });
    return { token: this.createSession(user, providerId), returnTo: p.returnTo, user };
  }

  createSession(user: User, idp: string): string {
    const raw = token("ps");
    const now = Date.now();
    this.sessions.set({
      id: hash(raw),
      tenantId: user.tenantId,
      userId: user.id,
      csrf: randomBytes(24).toString("base64url"),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (this.opts.sessionHours ?? 12) * 3_600_000).toISOString(),
      idp,
    });
    return raw;
  }

  session(raw: string | undefined): { session: Session; user: User } | undefined {
    if (!raw) return undefined;
    const s = this.sessions.get(hash(raw));
    if (!s || s.expiresAt < new Date().toISOString()) return undefined;
    const user = usersOf(this.store).get(s.userId);
    if (!user?.active) return undefined;
    return { session: s, user };
  }

  endSession(raw: string | undefined): void {
    const found = raw && this.sessions.get(hash(raw));
    if (found) this.sessions.set({ ...found, expiresAt: new Date(0).toISOString() });
  }

  createApiKey(user: User, label: string): string {
    const raw = token("pk");
    this.apiKeys.set({ id: hash(raw), tenantId: user.tenantId, userId: user.id, label, createdAt: new Date().toISOString() });
    return raw;
  }

  apiKeyUser(raw: string): User | undefined {
    const k = this.apiKeys.get(hash(raw));
    if (!k || k.revokedAt) return undefined;
    const user = usersOf(this.store).get(k.userId);
    return user?.active ? user : undefined;
  }

  userById(id: string): User | undefined {
    const u = usersOf(this.store).get(id);
    return u?.active ? u : undefined;
  }
}

export const actorFor = (u: User): Actor => ({ userId: u.id, tenantId: u.tenantId, displayName: u.displayName, roles: u.roles });
