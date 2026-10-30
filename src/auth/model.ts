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
  /** sha256 of the cookie value; the raw token is never stored. */
  id: string;
  tenantId: string;
  userId: string;
  csrf: string;
  createdAt: string;
  expiresAt: string;
  idp: string;
}

export interface ApiKey {
  /** sha256 of the key. */
  id: string;
  tenantId: string;
  userId: string;
  label: string;
  createdAt: string;
  revokedAt?: string;
}
