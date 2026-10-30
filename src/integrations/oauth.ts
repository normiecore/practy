import { createHash, randomBytes } from "node:crypto";
import type { OAuthToken } from "../core/secrets.js";

/**
 * OAuth 2.0 "connect" flows for data connectors (separate from staff sign-in, which
 * only asks for identity). Mailbox and calendar access are per user; Xero and
 * PracticePanther are per firm. Refresh tokens are stored encrypted in the SecretStore.
 */
export interface ConnectProvider {
  id: "google" | "microsoft" | "xero" | "practicepanther";
  label: string;
  scope: "user" | "firm";
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
  extraParams?: Record<string, string>;
}

export function connectProviders(env: NodeJS.ProcessEnv = process.env): Map<string, ConnectProvider> {
  const out = new Map<string, ConnectProvider>();
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    out.set("google", {
      id: "google",
      label: "Google (Gmail and Calendar)",
      scope: "user",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.events"],
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      extraParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    });
  }
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_TENANT_ID) {
    const base = `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0`;
    out.set("microsoft", {
      id: "microsoft",
      label: "Microsoft 365 (Outlook mail and calendar)",
      scope: "user",
      authorizeUrl: `${base}/authorize`,
      tokenUrl: `${base}/token`,
      scopes: ["offline_access", "openid", "email", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"],
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    });
  }
  if (env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET) {
    out.set("xero", {
      id: "xero",
      label: "Xero (read-only trust and office records)",
      scope: "firm",
      authorizeUrl: "https://login.xero.com/identity/connect/authorize",
      tokenUrl: "https://identity.xero.com/connect/token",
      scopes: ["openid", "offline_access", "accounting.transactions.read", "accounting.contacts.read", "accounting.settings.read"],
      clientId: env.XERO_CLIENT_ID,
      clientSecret: env.XERO_CLIENT_SECRET,
    });
  }
  if (env.PRACTICEPANTHER_CLIENT_ID && env.PRACTICEPANTHER_CLIENT_SECRET) {
    out.set("practicepanther", {
      id: "practicepanther",
      label: "PracticePanther (matter import)",
      scope: "firm",
      authorizeUrl: "https://app.practicepanther.com/OAuth/Authorize",
      tokenUrl: "https://app.practicepanther.com/OAuth/Token",
      scopes: [],
      clientId: env.PRACTICEPANTHER_CLIENT_ID,
      clientSecret: env.PRACTICEPANTHER_CLIENT_SECRET,
    });
  }
  return out;
}

/** Secret name under which a connection's token is stored. */
export const connectionSecretName = (p: Pick<ConnectProvider, "id" | "scope">, userId: string) => (p.scope === "user" ? `${p.id}:${userId}` : p.id);

export function beginConnect(p: ConnectProvider, redirectUri: string): { url: string; state: string; verifier: string } {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...(p.scopes.length ? { scope: p.scopes.join(" ") } : {}),
    ...p.extraParams,
  });
  return { url: `${p.authorizeUrl}?${params}`, state, verifier };
}

async function tokenRequest(p: ConnectProvider, body: Record<string, string>, f: typeof fetch): Promise<OAuthToken> {
  const res = await f(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, ...body }),
  });
  if (!res.ok) throw new Error(`${p.label}: token request failed (HTTP ${res.status})`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined, scope: j.scope };
}

export const exchangeCode = (p: ConnectProvider, code: string, redirectUri: string, verifier: string, f: typeof fetch = fetch) =>
  tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }, f);

export const refreshToken = (p: ConnectProvider, refresh: string, f: typeof fetch = fetch) =>
  tokenRequest(p, { grant_type: "refresh_token", refresh_token: refresh }, f);
