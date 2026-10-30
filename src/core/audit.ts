import { createHash } from "node:crypto";
import type { Surface } from "./types.js";

export interface AuditEntry {
  seq: number;
  at: string;
  tenantId: string;
  userId: string;
  surface: Surface;
  command: string;
  outcome: "executed" | "pending_approval" | "denied" | "failed";
  /** SHA-256 of the canonical input, so prompts/arguments are evidenced without storing raw content. */
  inputHash: string;
  matterIds: string[];
  approvalId?: string;
  detail?: string;
  prevHash: string;
  hash: string;
}

export type AuditDraft = Omit<AuditEntry, "seq" | "at" | "prevHash" | "hash">;

const GENESIS = "0".repeat(64);

/** Deterministic JSON: object keys sorted recursively so hashes are stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Append-only, hash-chained audit log. Each entry commits to the previous one,
 * so any edit or deletion breaks verification. Production storage is WORM
 * (object lock) with trusted timestamps; this in-memory version holds the chain logic.
 */
export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  append(draft: AuditDraft): AuditEntry {
    const prevHash = this.entries.at(-1)?.hash ?? GENESIS;
    const body = { ...draft, seq: this.entries.length + 1, at: this.now().toISOString(), prevHash };
    const entry: AuditEntry = { ...body, hash: sha256(canonicalJson(body)) };
    this.entries.push(Object.freeze(entry));
    return entry;
  }

  list(filter: { tenantId: string; matterId?: string; aiOnly?: boolean }): AuditEntry[] {
    return this.entries.filter(
      (e) =>
        e.tenantId === filter.tenantId &&
        (!filter.matterId || e.matterIds.includes(filter.matterId)) &&
        (!filter.aiOnly || e.surface === "mcp" || e.surface === "agent"),
    );
  }

  /** Returns the first broken sequence number, or null if the chain is intact. */
  verify(entries: readonly AuditEntry[] = this.entries): number | null {
    let prev = GENESIS;
    for (const e of entries) {
      const { hash, ...body } = e;
      if (e.prevHash !== prev || sha256(canonicalJson(body)) !== hash) return e.seq;
      prev = hash;
    }
    return null;
  }
}
