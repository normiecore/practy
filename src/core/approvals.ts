import { randomUUID } from "node:crypto";
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
  private readonly items = new Map<string, Approval>();

  create(a: Omit<Approval, "id" | "decisions" | "status">): Approval {
    const approval: Approval = { ...a, id: randomUUID(), decisions: [], status: "pending" };
    this.items.set(approval.id, approval);
    return approval;
  }

  get(tenantId: string, id: string): Approval | undefined {
    const a = this.items.get(id);
    return a && a.tenantId === tenantId ? a : undefined;
  }

  list(tenantId: string, status?: Approval["status"]): Approval[] {
    return [...this.items.values()].filter(
      (a) => a.tenantId === tenantId && (!status || a.status === status),
    );
  }
}
