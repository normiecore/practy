import { z } from "zod";
import { ApprovalStore, type Approval } from "./approvals.js";
import { AuditLog, canonicalJson, sha256 } from "./audit.js";
import { PractyError, forbidden, invalid, notFound } from "./errors.js";
import { defineCommand, type CommandDef, type Registry } from "./registry.js";
import { AI_SURFACES, type InvocationContext, type Role } from "./types.js";

/** Throws not_found if the actor may not see the matter on this surface (walls, no-AI flag, tenant). */
export type MatterGuard = (ctx: InvocationContext, matterId: string) => void;

export type CommandResult =
  | { status: "executed"; result: unknown }
  | { status: "pending_approval"; approvalId: string; requiredApprovals: number; message: string };

const DEFAULT_APPROVERS: Record<2 | 3, Role[]> = {
  2: ["principal", "solicitor"],
  3: ["trust_authoriser"],
};

/**
 * Single execution path for every surface. Enforces roles, matter access,
 * approval tiers and writes the audit / AI-use log.
 */
export class CommandBus {
  constructor(
    readonly registry: Registry,
    readonly audit: AuditLog,
    readonly approvals: ApprovalStore,
    private readonly guardMatter: MatterGuard,
    /** Awaited after every command so responses are only sent once changes are durable. */
    private readonly flush: () => Promise<void> = async () => {},
  ) {
    registry.register(...this.approvalCommands());
  }

  /** Public entry point for every surface. Callers can never supply an approval themselves. */
  async execute(name: string, rawInput: unknown, ctx: InvocationContext): Promise<CommandResult> {
    const { approvalId: _ignored, ...clean } = ctx;
    try {
      return await this.run(name, rawInput, clean);
    } finally {
      await this.flush();
    }
  }

  private async run(name: string, rawInput: unknown, ctx: InvocationContext): Promise<CommandResult> {
    const def = this.registry.get(name);
    if (!def) throw notFound(`Command ${name}`);
    const inputHash = sha256(canonicalJson(rawInput ?? {}));
    let matterIds: string[] = [];
    const record = (outcome: "executed" | "pending_approval" | "denied" | "failed", extra: { approvalId?: string; detail?: string } = {}) =>
      this.audit.append({
        tenantId: ctx.actor.tenantId,
        userId: ctx.actor.userId,
        surface: ctx.surface,
        command: name,
        outcome,
        inputHash,
        matterIds,
        ...extra,
      });

    try {
      if (def.humanOnly && AI_SURFACES.includes(ctx.surface)) {
        throw forbidden(`${name} cannot be invoked from an AI surface`);
      }
      if (def.roles?.length && !def.roles.some((r) => ctx.actor.roles.includes(r))) {
        throw forbidden(`${name} requires one of: ${def.roles.join(", ")}`);
      }
      const parsed = def.input.safeParse(rawInput ?? {});
      if (!parsed.success) throw invalid(z.prettifyError(parsed.error));
      const input = parsed.data;
      matterIds = def.matterIds?.(input) ?? [];
      for (const id of matterIds) this.guardMatter(ctx, id);

      if (def.tier >= 2 && !ctx.approvalId) {
        const tier = def.tier as 2 | 3;
        const approval = this.approvals.create({
          tenantId: ctx.actor.tenantId,
          command: name,
          tier,
          input,
          matterIds,
          requestedBy: ctx.actor.userId,
          requestedVia: ctx.surface,
          requestedAt: new Date().toISOString(),
          requiredApprovals: tier === 3 ? 2 : 1,
        });
        record("pending_approval", { approvalId: approval.id });
        return {
          status: "pending_approval",
          approvalId: approval.id,
          requiredApprovals: approval.requiredApprovals,
          message:
            tier === 3
              ? "Prepared for two-person approval in Practy. Money is never moved from an AI or API surface."
              : "Drafted and sent to a practitioner's approval inbox in Practy.",
        };
      }

      const result = await def.handler(input, ctx);
      record("executed", ctx.approvalId ? { approvalId: ctx.approvalId } : {});
      return { status: "executed", result };
    } catch (err) {
      const denied = err instanceof PractyError && (err.code === "forbidden" || err.code === "not_found");
      record(denied ? "denied" : "failed", { detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async decide(approval: Approval, decision: "approve" | "reject", ctx: InvocationContext, note?: string) {
    if (approval.status !== "pending") throw invalid(`Approval is ${approval.status}`);
    const def = this.registry.get(approval.command);
    if (!def) throw notFound(`Command ${approval.command}`);
    const approverRoles = def.approverRoles ?? DEFAULT_APPROVERS[approval.tier];
    if (!approverRoles.some((r) => ctx.actor.roles.includes(r))) {
      throw forbidden(`Approving ${def.name} requires one of: ${approverRoles.join(", ")}`);
    }
    if (approval.tier === 3 && approval.requestedBy === ctx.actor.userId) {
      throw forbidden("The requester cannot approve their own trust transaction");
    }
    if (approval.decisions.some((d) => d.userId === ctx.actor.userId)) {
      throw forbidden("You have already decided this approval");
    }
    for (const id of approval.matterIds) this.guardMatter(ctx, id);

    approval.decisions.push({ userId: ctx.actor.userId, decision, at: new Date().toISOString(), note });
    if (decision === "reject") {
      approval.status = "rejected";
      return this.approvals.save(approval);
    }
    if (approval.decisions.filter((d) => d.decision === "approve").length < approval.requiredApprovals) {
      return this.approvals.save(approval);
    }
    approval.status = "approved";
    try {
      const out = await this.run(approval.command, approval.input, { ...ctx, approvalId: approval.id });
      approval.status = "executed";
      approval.result = out.status === "executed" ? out.result : undefined;
    } catch (err) {
      approval.status = "failed";
      approval.error = err instanceof Error ? err.message : String(err);
    }
    return this.approvals.save(approval);
  }

  private approvalCommands(): CommandDef<any, any>[] {
    const requireUi = (ctx: InvocationContext) => {
      if (ctx.surface !== "ui") throw forbidden("Approvals are decided in the Practy app, not via API or AI");
    };
    return [
      defineCommand({
        name: "list_approvals",
        title: "List approvals",
        description: "List approval requests (drafts awaiting a practitioner or trust authoriser).",
        tier: 0,
        input: z.object({ status: z.enum(["pending", "approved", "rejected", "executed", "failed"]).optional() }),
        handler: ({ status }, ctx) =>
          this.approvals
            .list(ctx.actor.tenantId, status)
            .filter((a) => {
              try {
                a.matterIds.forEach((id) => this.guardMatter(ctx, id));
                return true;
              } catch {
                return false;
              }
            }),
      }),
      defineCommand({
        name: "decide_approval",
        title: "Approve or reject",
        description: "Approve or reject a pending request. Human-only, in the Practy app.",
        tier: 1,
        humanOnly: true,
        input: z.object({ approvalId: z.string(), decision: z.enum(["approve", "reject"]), note: z.string().optional() }),
        handler: async ({ approvalId, decision, note }, ctx) => {
          requireUi(ctx);
          const approval = this.approvals.get(ctx.actor.tenantId, approvalId);
          if (!approval) throw notFound("Approval");
          return this.decide(approval, decision, ctx, note);
        },
      }),
    ];
  }
}
