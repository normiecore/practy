import type { Role } from "../core/types.js";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  roles: Role[];
  /** Fee-earner category for costs scales. */
  feeEarnerCategory?: "SP" | "JP" | "CPL";
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface Session {
  /** sha256 of the cookie value; the raw token is never stored. Never shown to anyone. */
  id: string;
  tenantId: string;
  userId: string;
  csrf: string;
  createdAt: string;
  expiresAt: string;
  idp: string;
  /** Random reference used to name the session in lists and when ending it; unrelated to the token. */
  ref?: string;
  /** Browser and platform only, such as "Safari on iPhone" (see `describeDevice`). The User-Agent itself is not kept. */
  device?: string;
  /** The client address cut to its network: IPv4 /24 or IPv6 /48 (see `truncateIp`). */
  network?: string;
  /** Updated on use, at most every few minutes. */
  lastSeenAt?: string;
  endedAt?: string;
  endedReason?: SessionEndReason;
}

export type SessionEndReason = "signed_out" | "ended_by_user" | "ended_by_principal" | "deactivated";

export interface ApiKey {
  /** sha256 of the key. */
  id: string;
  tenantId: string;
  userId: string;
  label: string;
  createdAt: string;
  revokedAt?: string;
}
