import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { settingsFor } from "../admin/settings.js";
import type { Store } from "../domain/store.js";
import { parseCookies, SESSION_COOKIE, type AuthService } from "./service.js";
import { OAUTH_CODE_KIND, OAUTH_TOKEN_KIND } from "./sessions.js";

/**
 * OAuth 2.1 authorization server for MCP clients (Claude Desktop, claude.ai, Claude Code).
 * The user signs in with the firm's IdP, sees a consent screen, and the client receives a
 * token that acts as that user on the "mcp" surface. Disabled unless the firm turns on
 * external MCP clients in settings (APP 8 cross-border consideration).
 */
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 86_400;

interface StoredClient extends OAuthClientInformationFull {
  id: string;
  tenantId: string;
}

interface PendingAuthorization {
  id: string;
  tenantId: string;
  clientId: string;
  params: { state?: string; scopes?: string[]; codeChallenge: string; redirectUri: string; resource?: string };
  expiresAt: number;
}

interface IssuedCode {
  id: string; // hash(code)
  tenantId: string;
  clientId: string;
  userId: string;
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
  expiresAt: number;
  used: boolean;
}

interface IssuedToken {
  id: string; // hash(token)
  tenantId: string;
  kind: "access" | "refresh";
  clientId: string;
  userId: string;
  resource?: string;
  /** Where the authorization code was sent. Re-checked against the firm's allowed hosts on every use. */
  redirectUri?: string;
  expiresAt: number;
  revoked: boolean;
}

/** Clients register globally (pre-login); the tenant is fixed when a user consents. */
const GLOBAL = "_global";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Redirect hosts of the AI clients we know. Anything else is shown as unverified on the consent screen. */
const KNOWN_REDIRECT_HOSTS = new Set(["claude.ai", "claude.com"]);

/** Registration accepts only https redirect URIs, or http on a loopback host (native clients). */
function allowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
}

/** Whether a firm lets an authorization code go to this redirect URI: loopback, or a host a principal listed in Settings. */
export function redirectHostAllowed(store: Store, tenantId: string, redirectUri: string): boolean {
  const { hostname } = new URL(redirectUri);
  if (LOOPBACK.has(hostname)) return true;
  return settingsFor(store, tenantId).ai.externalClientRedirectHosts.some((h) => h.trim().toLowerCase() === hostname.toLowerCase());
}

export interface ConsentRequest extends PendingAuthorization {
  clientName: string;
  /** Where the authorization code will be sent. Shown on the consent screen so a look-alike client is visible. */
  redirectHost: string;
  verified: boolean;
}

export class PractyOAuthProvider implements OAuthServerProvider {
  readonly pending = new Map<string, PendingAuthorization>();
  private readonly clients;
  private readonly codes;
  private readonly tokens;

  constructor(
    private readonly store: Store,
    private readonly auth: AuthService,
  ) {
    this.clients = store.collection<StoredClient>("oauth_client");
    this.codes = store.collection<IssuedCode>(OAUTH_CODE_KIND);
    this.tokens = store.collection<IssuedToken>(OAUTH_TOKEN_KIND);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => {
        const c = this.clients.get(clientId);
        if (!c) return undefined;
        const { id: _id, tenantId: _t, ...info } = c;
        return info;
      },
      registerClient: (client) => {
        const full = client as OAuthClientInformationFull;
        const bad = (full.redirect_uris ?? []).find((u) => !allowedRedirectUri(String(u)));
        if (bad !== undefined) throw new InvalidClientMetadataError("redirect_uris must use https, or http on a loopback host");
        const clientId = full.client_id ?? randomUUID();
        this.clients.set({ ...full, client_id: clientId, id: clientId, tenantId: GLOBAL });
        void this.store.flush();
        return { ...full, client_id: clientId };
      },
    };
  }

  /** Stores the request and sends the browser to the consent screen (which requires sign-in). */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const id = randomUUID();
    this.pending.set(id, {
      id,
      tenantId: GLOBAL,
      clientId: client.client_id,
      params: { ...params, resource: params.resource?.href },
      expiresAt: Date.now() + 10 * 60_000,
    });
    res.redirect(302, `/oauth/consent?request=${id}`);
  }

  pendingRequest(id: string): ConsentRequest | undefined {
    const p = this.pending.get(id);
    if (!p || p.expiresAt < Date.now()) return undefined;
    const { host, hostname } = new URL(p.params.redirectUri);
    return {
      ...p,
      clientName: this.clients.get(p.clientId)?.client_name ?? p.clientId,
      redirectHost: host,
      verified: KNOWN_REDIRECT_HOSTS.has(hostname) || LOOPBACK.has(hostname),
    };
  }

  /** Called from the consent form. Returns the redirect URL for the client. */
  decide(requestId: string, sessionCookie: string | undefined, approve: boolean): string {
    const p = this.pending.get(requestId);
    this.pending.delete(requestId);
    if (!p || p.expiresAt < Date.now()) throw new Error("Authorization request expired");
    const signedIn = this.auth.session(sessionCookie);
    if (!signedIn) throw new Error("Not signed in");
    const url = new URL(p.params.redirectUri);
    if (p.params.state) url.searchParams.set("state", p.params.state);
    if (!approve) {
      url.searchParams.set("error", "access_denied");
      return url.href;
    }
    if (!settingsFor(this.store, signedIn.user.tenantId).ai.externalMcpClients) {
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("error_description", "External AI clients are disabled for this firm");
      return url.href;
    }
    if (!redirectHostAllowed(this.store, signedIn.user.tenantId, p.params.redirectUri)) {
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("error_description", "This client's address is not on the firm's list of allowed AI clients");
      return url.href;
    }
    const code = randomBytes(32).toString("base64url");
    this.codes.set({
      id: hash(code),
      tenantId: signedIn.user.tenantId,
      clientId: p.clientId,
      userId: signedIn.user.id,
      codeChallenge: p.params.codeChallenge,
      redirectUri: p.params.redirectUri,
      resource: p.params.resource,
      expiresAt: Date.now() + 5 * 60_000,
      used: false,
    });
    url.searchParams.set("code", code);
    return url.href;
  }

  private code(client: OAuthClientInformationFull, code: string): IssuedCode {
    const c = this.codes.get(hash(code));
    if (!c || c.clientId !== client.client_id || c.used || c.expiresAt < Date.now()) throw new InvalidGrantError("Invalid authorization code");
    return c;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.code(client, code).codeChallenge;
  }

  private issue(tenantId: string, clientId: string, userId: string, resource: string | undefined, redirectUri: string | undefined): OAuthTokens {
    const access = `pa_${randomBytes(32).toString("base64url")}`;
    const refresh = `pr_${randomBytes(32).toString("base64url")}`;
    const now = Date.now();
    this.tokens.set({ id: hash(access), tenantId, kind: "access", clientId, userId, resource, redirectUri, expiresAt: now + ACCESS_TTL_S * 1000, revoked: false });
    this.tokens.set({ id: hash(refresh), tenantId, kind: "refresh", clientId, userId, resource, redirectUri, expiresAt: now + REFRESH_TTL_S * 1000, revoked: false });
    return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh };
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const c = this.code(client, code);
    if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError("redirect_uri mismatch");
    if (!this.auth.userById(c.userId)) throw new InvalidGrantError("User is no longer active");
    this.codes.set({ ...c, used: true });
    const tokens = this.issue(c.tenantId, c.clientId, c.userId, c.resource, c.redirectUri);
    await this.store.flush();
    return tokens;
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const t = this.tokens.get(hash(refreshToken));
    if (!t || t.kind !== "refresh" || t.revoked || t.clientId !== client.client_id || t.expiresAt < Date.now()) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (!this.auth.userById(t.userId)) throw new InvalidGrantError("User is no longer active");
    if (!this.grantAllowed(t)) throw new InvalidGrantError("This client's address is no longer on the firm's list of allowed AI clients");
    this.tokens.set({ ...t, revoked: true }); // rotate
    const tokens = this.issue(t.tenantId, t.clientId, t.userId, t.resource, t.redirectUri);
    await this.store.flush();
    return tokens;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const t = this.tokens.get(hash(token));
    if (!t || t.kind !== "access" || t.revoked || t.expiresAt < Date.now()) throw new InvalidTokenError("Invalid or expired token");
    if (!this.auth.userById(t.userId)) throw new InvalidTokenError("User is no longer active");
    if (!settingsFor(this.store, t.tenantId).ai.externalMcpClients) throw new InvalidTokenError("External AI clients are disabled for this firm");
    if (!this.grantAllowed(t)) throw new InvalidTokenError("This client's address is no longer on the firm's list of allowed AI clients");
    return {
      token,
      clientId: t.clientId,
      scopes: ["practy"],
      expiresAt: Math.floor(t.expiresAt / 1000),
      resource: t.resource ? new URL(t.resource) : undefined,
      extra: { userId: t.userId, tenantId: t.tenantId },
    };
  }

  /**
   * A grant stays usable only while its redirect host is on the firm's list, so removing a host
   * cuts off clients already connected through it. Tokens issued before the address was recorded
   * fall back to every address the client registered.
   */
  private grantAllowed(t: IssuedToken): boolean {
    const uris = t.redirectUri ? [t.redirectUri] : (this.clients.get(t.clientId)?.redirect_uris ?? []).map(String);
    return uris.length > 0 && uris.every((u) => redirectHostAllowed(this.store, t.tenantId, u));
  }

  async revokeToken(_client: OAuthClientInformationFull, request: { token: string }): Promise<void> {
    const t = this.tokens.get(hash(request.token));
    if (t) this.tokens.set({ ...t, revoked: true });
    await this.store.flush();
  }
}

export const sessionCookieFrom = (cookieHeader: string | undefined) => parseCookies(cookieHeader)[SESSION_COOKIE];
