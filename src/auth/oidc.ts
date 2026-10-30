import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Staff sign-in through the firm's identity provider. Google Workspace (Soul Legal)
 * and Microsoft Entra ID are both supported; MFA is enforced at the IdP.
 */
export interface OidcClaims {
  email: string;
  name?: string;
  /** Authentication methods (Entra returns "mfa" when MFA was performed). */
  amr?: string[];
  hostedDomain?: string;
}

export interface OidcLoginRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcProvider {
  readonly id: string;
  readonly label: string;
  begin(redirectUri: string): Promise<OidcLoginRequest>;
  complete(args: { code: string; redirectUri: string; nonce: string; codeVerifier: string }): Promise<OidcClaims>;
}

export interface OidcConfig {
  id: "google" | "microsoft";
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Google: restrict to the firm's Workspace domain (`hd`). */
  hostedDomain?: string;
  fetch?: typeof fetch;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

const b64url = (b: Buffer) => b.toString("base64url");

export const GOOGLE_ISSUER = "https://accounts.google.com";
export const microsoftIssuer = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/v2.0`;

export class DiscoveryOidcProvider implements OidcProvider {
  readonly id: string;
  readonly label: string;
  private discovery?: Promise<Discovery>;
  private jwks?: JWTVerifyGetKey;

  constructor(private readonly cfg: OidcConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
  }

  private get fetch() {
    return this.cfg.fetch ?? fetch;
  }

  private meta(): Promise<Discovery> {
    this.discovery ??= this.fetch(`${this.cfg.issuer}/.well-known/openid-configuration`).then(async (r) => {
      if (!r.ok) throw new Error(`OIDC discovery failed for ${this.cfg.issuer}: HTTP ${r.status}`);
      return (await r.json()) as Discovery;
    });
    return this.discovery;
  }

  async begin(redirectUri: string): Promise<OidcLoginRequest> {
    const m = await this.meta();
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const codeVerifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(codeVerifier).digest());
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    if (this.cfg.hostedDomain) params.set("hd", this.cfg.hostedDomain);
    return { url: `${m.authorization_endpoint}?${params}`, state, nonce, codeVerifier };
  }

  async complete(args: { code: string; redirectUri: string; nonce: string; codeVerifier: string }): Promise<OidcClaims> {
    const m = await this.meta();
    const res = await this.fetch(m.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: args.redirectUri,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code_verifier: args.codeVerifier,
      }),
    });
    if (!res.ok) throw new Error(`OIDC token exchange failed: HTTP ${res.status}`);
    const { id_token } = (await res.json()) as { id_token?: string };
    if (!id_token) throw new Error("OIDC response had no id_token");
    this.jwks ??= createRemoteJWKSet(new URL(m.jwks_uri));
    const { payload } = await jwtVerify(id_token, this.jwks, { issuer: m.issuer, audience: this.cfg.clientId });
    if (payload.nonce !== args.nonce) throw new Error("OIDC nonce mismatch");
    if (payload.email_verified === false) throw new Error("Email not verified by identity provider");
    const email = String(payload.email ?? payload.preferred_username ?? "").toLowerCase();
    if (!email) throw new Error("Identity provider returned no email");
    if (this.cfg.hostedDomain && payload.hd !== this.cfg.hostedDomain) throw new Error("Account is not in the firm's domain");
    return {
      email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      amr: Array.isArray(payload.amr) ? payload.amr.map(String) : undefined,
      hostedDomain: typeof payload.hd === "string" ? payload.hd : undefined,
    };
  }
}

/** Development-only provider: signs in as any configured user by email. Never enabled in production. */
export class DevOidcProvider implements OidcProvider {
  readonly id = "dev";
  readonly label = "Development login";

  async begin(redirectUri: string): Promise<OidcLoginRequest> {
    const state = b64url(randomBytes(16));
    return { url: `/auth/dev?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`, state, nonce: "", codeVerifier: "" };
  }

  async complete(args: { code: string }): Promise<OidcClaims> {
    return { email: args.code.toLowerCase() };
  }
}
