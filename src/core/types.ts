/**
 * Shared vocabulary for every surface (web UI, REST API, MCP, background agents).
 * See docs/architecture/MCP-FIRST.md.
 */

export type Role =
  | "principal"
  | "solicitor"
  | "paralegal"
  | "accounts"
  /** May authorise trust money movements (one of two required approvers). */
  | "trust_authoriser";

export interface Actor {
  userId: string;
  tenantId: string;
  displayName: string;
  roles: Role[];
}

/**
 * Where a command was invoked from. AI surfaces ("mcp", "agent") are subject to
 * per-matter no-AI flags and are recorded in the AI-use log.
 */
export type Surface = "ui" | "api" | "mcp" | "agent" | "job";

export const AI_SURFACES: readonly Surface[] = ["mcp", "agent"];

/**
 * Approval tiers (MCP-FIRST.md §3).
 * 0 read · 1 internal draft · 2 outward/legal-risk (practitioner approval in UI)
 * 3 money (two-person approval in UI; never executable from an AI surface).
 */
export type Tier = 0 | 1 | 2 | 3;

export interface InvocationContext {
  actor: Actor;
  surface: Surface;
  /** Set when executing a command whose approval has been granted. */
  approvalId?: string;
  /**
   * The sign-in session behind a request from the web app (its internal record id), so session
   * commands can mark and keep "this device". Set only by the HTTP layer; never returned to anyone.
   */
  sessionId?: string;
}
