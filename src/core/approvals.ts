import { randomUUID } from "node:crypto";
import type { Collection } from "./collection.js";
import type { Surface, Tier } from "./types.js";

export interface ApprovalDecision {
  userId: string;
  decision: "approve" | "reject";
  at: string;
  note?: string;
}

export interface Approval {
  id: string;
  tenantId: string;
  command: string;
  tier: Exclude<Tier, 0 | 1>;
  input: unknown;
  /** Server-resolved detail for the approver; informational, never executed. */
  context?: Record<string, unknown>;
  matterIds: string[];
  requestedBy: string;
  requestedVia: Surface;
  requestedAt: string;
  requiredApprovals: number;
  decisions: ApprovalDecision[];
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  result?: unknown;
  error?: string;
}

export class ApprovalStore {
  constructor(private readonly items: Collection<Approval>) {}

  create(a: Omit<Approval, "id" | "decisions" | "status">): Approval {
    return this.items.set({ ...a, id: randomUUID(), decisions: [], status: "pending" });
  }

  get(tenantId: string, id: string): Approval | undefined {
    return this.items.find(tenantId, id);
  }

  save(a: Approval): Approval {
    return this.items.set(a);
  }

  list(tenantId: string, status?: Approval["status"]): Approval[] {
    return this.items.list(tenantId, (a) => !status || a.status === status);
  }
}
