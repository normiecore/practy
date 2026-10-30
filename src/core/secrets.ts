import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Collection } from "./collection.js";

/**
 * Connector credentials (OAuth refresh tokens, API keys) encrypted at rest with
 * AES-256-GCM. The data key comes from PRACTY_SECRET_KEY (32 bytes, base64); in
 * production it is supplied from AWS KMS / Secrets Manager, never committed.
 */
export interface SecretRecord {
  id: string; // `${tenantId}:${name}`
  tenantId: string;
  name: string;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
}

export class SecretStore {
  private readonly key: Buffer;

  constructor(
    private readonly records: Collection<SecretRecord>,
    keyBase64: string,
  ) {
    this.key = Buffer.from(keyBase64, "base64");
    if (this.key.length !== 32) throw new Error("PRACTY_SECRET_KEY must be 32 bytes, base64-encoded");
  }

  static generateKey(): string {
    return randomBytes(32).toString("base64");
  }

  set(tenantId: string, name: string, value: unknown): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${tenantId}:${name}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    this.records.set({
      id: `${tenantId}:${name}`,
      tenantId,
      name,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      updatedAt: new Date().toISOString(),
    });
  }

  get<T>(tenantId: string, name: string): T | undefined {
    const r = this.records.find(tenantId, `${tenantId}:${name}`);
    if (!r) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(r.iv, "base64"));
    decipher.setAAD(Buffer.from(`${tenantId}:${name}`));
    decipher.setAuthTag(Buffer.from(r.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(r.ciphertext, "base64")), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as T;
  }

  has(tenantId: string, name: string): boolean {
    return !!this.records.find(tenantId, `${tenantId}:${name}`);
  }
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  scope?: string;
}

/**
 * Returns a valid access token, refreshing and re-storing it when within 60s of expiry.
 * Connectors only ever see `getAccessToken`.
 */
export function tokenProvider(
  secrets: SecretStore,
  tenantId: string,
  name: string,
  refresh: (refreshToken: string) => Promise<OAuthToken>,
): () => Promise<string> {
  return async () => {
    const tok = secrets.get<OAuthToken>(tenantId, name);
    if (!tok) throw new Error(`Connector ${name} is not connected`);
    if (tok.expiresAt && tok.expiresAt - 60_000 < Date.now()) {
      if (!tok.refreshToken) throw new Error(`Connector ${name} token expired; reconnect required`);
      const next = await refresh(tok.refreshToken);
      secrets.set(tenantId, name, { ...next, refreshToken: next.refreshToken ?? tok.refreshToken });
      return next.accessToken;
    }
    return tok.accessToken;
  };
}
